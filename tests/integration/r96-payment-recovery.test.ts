import { gatewayScopeHash } from "../../src/commerce/payments/terminalPolicy";
import { describe, expect, it } from "vitest";
import {
  startOrderPayment, verifyPaymentAttempt, adminAttemptInquiry, adminResolveReviewCase,
} from "../../src/api/modules/billing";
import { providerInquiryStatements, TERMINAL_RELEASE_MIN_ATTEMPT_AGE_HOURS } from "../../src/commerce/reconciliation";
import {
  openRealDatabase, seedUser, makeSession, authedRequest, seedBillingPrices,
  createOrder, reserveAttempt, countRows, withFakedFetch, zarinpalIssued, zarinpalVerified,
  type AuthedSession,
} from "../helpers/realDatabase";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * R96-N06 acceptance — terminal payment-session recovery.
 *
 *  A. The terminal release (provider_not_paid_confirmed) lands ONLY with the
 *     full proof stack: the explicit new-attempt policy, the provider inquiry
 *     API's fresh merchant-scoped reversal response (REVERSED only) as the LATEST observation,
 *     the local cooldown and deployment-owned policy, a current operator and reconciled
 *     evidence. Anything less refuses and the session stays.
 *  B. One order can never acquire two concurrently payable attempts: the
 *     reserve guard holds while a session is live, and the release creates
 *     nothing — it only makes a NEW attempt legal once the old one is terminal.
 *  C. A LATE settlement of a released session can never auto-fulfill: the
 *     money lands in explicit review with an honest reason.
 */

function liveEnv(db: D1Database) {
  return {
    DB: db,
    SESSION_COOKIE_NAME: "hr_session",
    ZARINPAL_MERCHANT_ID: "merchant-uuid-1234",
    ZARINPAL_BASE_URL: "https://gateway.test",
    ZARINPAL_APPROVED_ORIGINS: "https://gateway.test",
    PAYMENT_CALLBACK_BASE_URL: "https://registry.example",
    BILLING_LIVE_PAYMENTS_ENABLED: "true",
    PAYMENT_TERMINAL_RELEASE_ENABLED: "true",
    PAYMENT_TERMINAL_RELEASE_APPROVAL_REF: "synthetic-reviewed-reversal-policy-r97",
  } as never;
}

async function recoveryWorld(db: D1Database, key: string) {
  await seedUser(db, "buyer", "user");
  await seedUser(db, "admin-1", "admin");
  const session = await makeSession(db, "buyer");
  const admin = await makeSession(db, "admin-1");
  await seedBillingPrices(db);
  const order = (await createOrder(db, { buyer: "buyer", key }))!;
  return { session, admin, order };
}

/** A redirected attempt older than the local cooldown, with an open case. */
async function agedAttemptWithCase(db: D1Database, key: string) {
  const world = await recoveryWorld(db, key);
  const restore = withFakedFetch(() => new Response(JSON.stringify({ data: { code: 100, authority: `AUTH-${key}`, ref_id: 1 } }), { status: 200 }));
  let attemptId: number;
  try {
    const start = await startOrderPayment(authedRequest(`/api/billing/orders/${world.order.id}/pay`, {}, { session: world.session }), liveEnv(db), world.order.id);
    attemptId = ((await start.json()) as { attempt_id: number }).attempt_id;
  } finally { restore(); }
  await db.exec(`UPDATE payment_attempts SET created_at=datetime('now','-${TERMINAL_RELEASE_MIN_ATTEMPT_AGE_HOURS + 2} hours') WHERE id=${attemptId}`);
  await db.exec(`INSERT INTO billing_review_cases(payment_attempt_id,reason,details_json) VALUES(${attemptId},'stale_unverified','{}')`);
  const caseId = Number((await db.prepare("SELECT id FROM billing_review_cases WHERE payment_attempt_id=? AND status='open'").bind(attemptId).first<{ id: number }>())!.id);
  return { ...world, attemptId, caseId, evidence: {
    attempt_id: attemptId, order_id: world.order.id, order_key: world.order.order_key,
    amount_minor: Number(world.order.total_minor), currency: "IRR", authority: `AUTH-${key}`, provider_reference: null,
  } };
}

async function recordInquiry(db: D1Database, attemptId: number, outcome: "reversed" | "failed_observed" | "in_bank" | "not_paid" | "timeout", operator = "admin-1") {
  const current = await db.prepare("SELECT authority FROM payment_attempts WHERE id=?").bind(attemptId).first<{authority:string|null}>();
  await db.batch(providerInquiryStatements(db, { attemptId, operatorUserId: operator, outcome,providerScopeHash:await gatewayScopeHash(liveEnv(db)),observedAuthority:current?.authority ?? null }));
}

describe("N06 A. the terminal release proof stack", () => {
  it("the full proof releases the session: case resolved, attempt terminal, ONE receipt, audit recorded", async () => {
    const db = await openRealDatabase();
    const { admin, attemptId, caseId, evidence } = await agedAttemptWithCase(db, "n06-release-1");
    await recordInquiry(db, attemptId, "reversed");
    const resolve = await adminResolveReviewCase(authedRequest(`/api/admin/billing/review-cases/${caseId}/resolve`, {
      outcome: "provider_not_paid_confirmed",
      resolution_note: "Provider inquiry reports REVERSED; the session is terminal and the buyer may start a new attempt.",
      evidence,
      new_attempt_policy: "allow_new_attempt",
    }, { session: admin }), liveEnv(db), caseId);
    expect(resolve.status).toBe(200);
    const attempt = await db.prepare("SELECT state FROM payment_attempts WHERE id=?").bind(attemptId).first<{ state: string }>();
    expect(attempt?.state).toBe("failed");
    expect(await countRows(db, "billing_review_cases", "status='resolved' AND resolution_outcome='provider_not_paid_confirmed'")).toBe(1);
    // ONE operation receipt: exactly one terminal_release payment event.
    const events = await db.prepare("SELECT payload_json FROM payment_events WHERE payment_attempt_id=? AND payload_json LIKE '%terminal_release%'").bind(attemptId).all<{ payload_json: string }>();
    expect(events.results).toHaveLength(1);
    expect(JSON.parse(events.results[0]!.payload_json)).toMatchObject({ terminal_release: true, new_attempt_policy: "allow_new_attempt" });
    expect(await countRows(db, "audit_events", "action='payment.terminal_released'")).toBe(1);
  });

  it("without the explicit new-attempt policy the release stays unavailable (501)", async () => {
    const db = await openRealDatabase();
    const { admin, attemptId, caseId, evidence } = await agedAttemptWithCase(db, "n06-nopolicy-1");
    await recordInquiry(db, attemptId, "reversed");
    await expect(adminResolveReviewCase(authedRequest(`/api/admin/billing/review-cases/${caseId}/resolve`, {
      outcome: "provider_not_paid_confirmed", resolution_note: "Terminal evidence exists but no policy confirmation.", evidence,
    }, { session: admin }), liveEnv(db), caseId)).rejects.toMatchObject({ status: 501, code: "terminal_payment_proof_required" });
    expect((await db.prepare("SELECT state FROM payment_attempts WHERE id=?").bind(attemptId).first<{ state: string }>())?.state).toBe("redirected");
    expect((await db.prepare("SELECT status FROM billing_review_cases WHERE id=?").bind(caseId).first<{ status: string }>())?.status).toBe("open");
  });

  it("a NOT-PAID or TIMEOUT observation is NOT terminal proof — the release refuses (409)", async () => {
    const db = await openRealDatabase();
    const { admin, attemptId, caseId, evidence } = await agedAttemptWithCase(db, "n06-notpaid-1");
    await recordInquiry(db, attemptId, "not_paid");
    await expect(adminResolveReviewCase(authedRequest(`/api/admin/billing/review-cases/${caseId}/resolve`, {
      outcome: "provider_not_paid_confirmed", resolution_note: "Panel shows not paid.", evidence, new_attempt_policy: "allow_new_attempt",
    }, { session: admin }), liveEnv(db), caseId)).rejects.toMatchObject({ status: 409, code: "evidence_mismatch" });
    await recordInquiry(db, attemptId, "timeout");
    await expect(adminResolveReviewCase(authedRequest(`/api/admin/billing/review-cases/${caseId}/resolve`, {
      outcome: "provider_not_paid_confirmed", resolution_note: "Inquiry timed out.", evidence, new_attempt_policy: "allow_new_attempt",
    }, { session: admin }), liveEnv(db), caseId)).rejects.toMatchObject({ status: 409, code: "evidence_mismatch" });
    expect((await db.prepare("SELECT state FROM payment_attempts WHERE id=?").bind(attemptId).first<{ state: string }>())?.state).toBe("redirected");
  });

  it("a LATER contradictory observation (IN_BANK after REVERSED) blocks the release", async () => {
    const db = await openRealDatabase();
    const { admin, attemptId, caseId, evidence } = await agedAttemptWithCase(db, "n06-contradiction-1");
    await recordInquiry(db, attemptId, "reversed");
    await recordInquiry(db, attemptId, "in_bank"); // the money moved after all
    await expect(adminResolveReviewCase(authedRequest(`/api/admin/billing/review-cases/${caseId}/resolve`, {
      outcome: "provider_not_paid_confirmed", resolution_note: "Reversal was observed, then in-bank.", evidence, new_attempt_policy: "allow_new_attempt",
    }, { session: admin }), liveEnv(db), caseId)).rejects.toMatchObject({ status: 409, code: "evidence_mismatch" });
    expect((await db.prepare("SELECT state FROM payment_attempts WHERE id=?").bind(attemptId).first<{ state: string }>())?.state).toBe("redirected");
    expect((await db.prepare("SELECT status FROM billing_review_cases WHERE id=?").bind(caseId).first<{ status: string }>())?.status).toBe("open");
  });

  it("a session younger than the local cooldown and deployment-owned policy is NOT releasable", async () => {
    const db = await openRealDatabase();
    const world = await recoveryWorld(db, "n06-young-1");
    const restore = withFakedFetch(() => new Response(JSON.stringify({ data: { code: 100, authority: "AUTH-n06-young", ref_id: 1 } }), { status: 200 }));
    let attemptId: number;
    try {
      const start = await startOrderPayment(authedRequest(`/api/billing/orders/${world.order.id}/pay`, {}, { session: world.session }), liveEnv(db), world.order.id);
      attemptId = ((await start.json()) as { attempt_id: number }).attempt_id;
    } finally { restore(); }
    await db.exec(`INSERT INTO billing_review_cases(payment_attempt_id,reason,details_json) VALUES(${attemptId},'stale_unverified','{}')`);
    const caseId = Number((await db.prepare("SELECT id FROM billing_review_cases WHERE payment_attempt_id=? AND status='open'").bind(attemptId).first<{ id: number }>())!.id);
    await recordInquiry(db, attemptId, "reversed");
    await expect(adminResolveReviewCase(authedRequest(`/api/admin/billing/review-cases/${caseId}/resolve`, {
      outcome: "provider_not_paid_confirmed", resolution_note: "Reversed, but only minutes old.", evidence: {
        attempt_id: attemptId, order_id: world.order.id, order_key: world.order.order_key,
        amount_minor: Number(world.order.total_minor), currency: "IRR", authority: "AUTH-n06-young", provider_reference: null,
      }, new_attempt_policy: "allow_new_attempt",
    }, { session: world.admin }), liveEnv(db), caseId)).rejects.toMatchObject({ status: 409, code: "evidence_mismatch" });
    expect((await db.prepare("SELECT state FROM payment_attempts WHERE id=?").bind(attemptId).first<{ state: string }>())?.state).toBe("redirected");
  });

  it("a VERIFIED attempt is never releasable (money DID move)", async () => {
    const db = await openRealDatabase();
    const { admin, attemptId, caseId, evidence } = await agedAttemptWithCase(db, "n06-verified-1");
    await recordInquiry(db, attemptId, "reversed");
    await db.exec(`UPDATE payment_attempts SET state='verified' WHERE id=${attemptId}`);
    await expect(adminResolveReviewCase(authedRequest(`/api/admin/billing/review-cases/${caseId}/resolve`, {
      outcome: "provider_not_paid_confirmed", resolution_note: "Trying to release a verified attempt.", evidence, new_attempt_policy: "allow_new_attempt",
    }, { session: admin }), liveEnv(db), caseId)).rejects.toMatchObject({ status: 409, code: "evidence_mismatch" });
    expect((await db.prepare("SELECT state FROM payment_attempts WHERE id=?").bind(attemptId).first<{ state: string }>())?.state).toBe("verified");
  });
});

describe("N06 B. one payable attempt per order, before and after recovery", () => {
  it("while the session is LIVE a retry returns the SAME attempt; after the release a NEW attempt is legal — never two payable at once", async () => {
    const db = await openRealDatabase();
    const { session, admin, attemptId, caseId, evidence, order } = await agedAttemptWithCase(db, "n06-onepayable-1");
    // While the session is live, the buyer's retry returns the SAME attempt.
    const restoreLive = withFakedFetch(() => new Response("no-network-needed", { status: 500 }));
    try {
      const retry = await startOrderPayment(authedRequest(`/api/billing/orders/${order.id}/pay`, {}, { session }), liveEnv(db), order.id);
      const retryBody = await retry.json() as { attempt_id: number };
      expect(retryBody.attempt_id).toBe(attemptId);
    } finally { restoreLive(); }

    // Release the session with full proof, then a NEW attempt is legal.
    await recordInquiry(db, attemptId, "reversed");
    const resolve = await adminResolveReviewCase(authedRequest(`/api/admin/billing/review-cases/${caseId}/resolve`, {
      outcome: "provider_not_paid_confirmed", resolution_note: "Fresh merchant-scoped reversal under the approved policy; releasing the session.",
      evidence, new_attempt_policy: "allow_new_attempt",
    }, { session: admin }), liveEnv(db), caseId);
    expect(resolve.status).toBe(200);
    const restoreNew = withFakedFetch(() => new Response(JSON.stringify({ data: { code: 100, authority: "AUTH-n06-onepayable-NEW", ref_id: 2 } }), { status: 200 }));
    try {
      const again = await startOrderPayment(authedRequest(`/api/billing/orders/${order.id}/pay`, {}, { session }), liveEnv(db), order.id);
      const againBody = await again.json() as { attempt_id: number; state?: string };
      expect(again.status).toBe(201);
      expect(againBody.attempt_id).not.toBe(attemptId);
      // Exactly ONE payable attempt exists for the order.
      expect(await countRows(db, "payment_attempts", `order_id=${order.id} AND state IN ('created','redirected')`)).toBe(1);
    } finally { restoreNew(); }
  });
});

describe("N06 C. late settlement after release can never auto-fulfill", () => {
  it("a released session that the provider LATER verifies lands in explicit review — no entitlement", async () => {
    const db = await openRealDatabase();
    const { session, admin, attemptId, caseId, evidence } = await agedAttemptWithCase(db, "n06-late-1");
    await recordInquiry(db, attemptId, "reversed");
    const resolve = await adminResolveReviewCase(authedRequest(`/api/admin/billing/review-cases/${caseId}/resolve`, {
      outcome: "provider_not_paid_confirmed", resolution_note: "Reversed per provider inquiry; releasing.",
      evidence, new_attempt_policy: "allow_new_attempt",
    }, { session: admin }), liveEnv(db), caseId);
    expect(resolve.status).toBe(200);

    // The money settles LATE: the provider's verify now succeeds for the
    // released attempt. Fulfillment must refuse — explicit review instead.
    const restore = withFakedFetch(() => zarinpalVerified(999777, 100));
    try {
      const verify = await verifyPaymentAttempt(authedRequest("/api/billing/payments/verify", { attempt_id: attemptId }, { session }), liveEnv(db));
      expect(verify.status).toBe(202);
      const body = await verify.json() as { verified: boolean; fulfilled: boolean; review_required: boolean };
      expect(body.verified).toBe(true);
      expect(body.fulfilled).toBe(false);
      expect(body.review_required).toBe(true);
      expect(await countRows(db, "entitlement_events")).toBe(0); // NO entitlement from a released session
      const review = await db.prepare("SELECT details_json FROM billing_review_cases WHERE payment_attempt_id=? AND reason='verified_unfulfillable'").bind(attemptId).first<{ details_json: string }>();
      expect(review).toBeDefined();
      expect(JSON.parse(review!.details_json)).toMatchObject({ reason: "released_attempt_late_settlement" });
    } finally { restore(); }
  });
});

import { describe, expect, it } from "vitest";
import {
  startOrderPayment, paymentCallback, verifyPaymentAttempt, adminAttemptInquiry,
  adminResolveReviewCase, adminReconciliation,
} from "../../src/api/modules/billing";
import {
  APPROVED_GATEWAY_ORIGINS, approvedGatewayOrigins, gatewayConfigurationStatus, getPaymentProvider,
} from "../../src/commerce/payments/zarinpal";
import {
  openRealDatabase, seedUser, makeSession, authedRequest, seedBillingPrices,
  createOrder, countRows, withFakedFetch, zarinpalIssued, zarinpalVerified,
  type AuthedSession,
} from "../helpers/realDatabase";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * R95-N05 evidence: the gateway-uncertainty scenario matrix on a real database
 * with every migration applied. Only the provider network IO is faked — every
 * handler runs its real SQL.
 *
 * Scenario matrix required by the ticket:
 *  request timeout BEFORE provider acceptance / AFTER acceptance (unreadable
 *  body), malformed response, delayed/repeated callback, verify codes 100/101,
 *  amount mismatch, configuration rejection, unknown status — each must keep
 *  evidence WITHOUT storing card/contact secrets and never guess an outcome.
 * Plus the operator workflow: inquiry (evidence only) -> resolution (closes
 * only against reconciled evidence), and the read-only reconciliation scan.
 */

function liveEnv(db: D1Database, extra: Record<string, string> = {}) {
  return {
    DB: db,
    SESSION_COOKIE_NAME: "hr_session",
    ZARINPAL_MERCHANT_ID: "merchant-uuid-1234",
    ZARINPAL_BASE_URL: "https://gateway.test",
    ZARINPAL_APPROVED_ORIGINS: "https://gateway.test",
    PAYMENT_CALLBACK_BASE_URL: "https://registry.example",
    BILLING_LIVE_PAYMENTS_ENABLED: "true",
    ...extra,
  } as never;
}

/** A responder whose fetch times out (the AbortSignal.timeout error shape). */
function timeoutResponder(): (url: string) => Promise<Response> {
  const error = new Error("The operation was aborted due to timeout");
  error.name = "TimeoutError";
  return () => Promise.reject(error);
}

async function buyerWithOrder(db: D1Database, key: string): Promise<{ session: AuthedSession; orderId: number; orderKey: string; total: number }> {
  await seedUser(db, "buyer", "user");
  const session = await makeSession(db, "buyer");
  await seedBillingPrices(db);
  const order = await createOrder(db, { buyer: "buyer", key });
  return { session, orderId: order!.id, orderKey: order!.order_key, total: Number(order!.total_minor) };
}

async function adminSession(db: D1Database): Promise<AuthedSession> {
  await seedUser(db, "admin-1", "admin");
  return makeSession(db, "admin-1");
}

async function openCaseForAttempt(db: D1Database, attemptId: number): Promise<{ caseId: number; reason: string }> {
  const row = await db.prepare("SELECT id, reason FROM billing_review_cases WHERE payment_attempt_id=? AND status='open' ORDER BY id LIMIT 1").bind(attemptId).first<{ id: number; reason: string }>();
  if (!row) throw new Error(`no open review case for attempt ${attemptId}`);
  return { caseId: Number(row.id), reason: row.reason };
}

describe("R95-N05 gateway origin validation (approved live/sandbox origins)", () => {
  it("the approved list is exactly the official live + sandbox Zarinpal origins", () => {
    expect(APPROVED_GATEWAY_ORIGINS).toEqual(["https://payment.zarinpal.com", "https://sandbox.zarinpal.com"]);
  });

  it("an unapproved gateway origin fails CLOSED: no provider, no charge, no verify", () => {
    const env = { ZARINPAL_MERCHANT_ID: "m", ZARINPAL_BASE_URL: "https://attacker.example" };
    expect(getPaymentProvider(env)).toBeNull();
    const status = gatewayConfigurationStatus(env);
    expect(status.problems).toContain("gateway_origin_unapproved");
    expect(status.ok).toBe(false);
  });

  it("operators may explicitly extend the list with clean https origins only", () => {
    expect(approvedGatewayOrigins({ ZARINPAL_APPROVED_ORIGINS: "https://banktest.example, https://sandbox.zarinpal.com" }))
      .toEqual(["https://payment.zarinpal.com", "https://sandbox.zarinpal.com", "https://banktest.example"]);
    // Junk entries (paths, query, http) are dropped, never trusted.
    expect(approvedGatewayOrigins({ ZARINPAL_APPROVED_ORIGINS: "https://x.example/pg/v4, http://plain.example, notaurl" }))
      .toEqual([...APPROVED_GATEWAY_ORIGINS]);
    expect(getPaymentProvider({ ZARINPAL_MERCHANT_ID: "m", ZARINPAL_BASE_URL: "https://banktest.example", ZARINPAL_APPROVED_ORIGINS: "https://banktest.example" })).not.toBeNull();
  });

  it("the default (unset base) is the official live origin — approved", () => {
    const status = gatewayConfigurationStatus({ ZARINPAL_MERCHANT_ID: "m" });
    expect(status.ok).toBe(true);
    expect(getPaymentProvider({ ZARINPAL_MERCHANT_ID: "m" })).not.toBeNull();
  });

  it("an unapproved origin on a live order: /pay refuses with 503 and the problem list", async () => {
    const db = await openRealDatabase();
    const { session, orderId } = await buyerWithOrder(db, "origin-order-1");
    await expect(startOrderPayment(authedRequest(`/api/billing/orders/${orderId}/pay`, {}, { session }),
      liveEnv(db, { ZARINPAL_BASE_URL: "https://attacker.example", ZARINPAL_APPROVED_ORIGINS: "" }), orderId))
      .rejects.toMatchObject({ status: 503, code: "payment_provider_unconfigured" });
    expect(await countRows(db, "payment_attempts")).toBe(0);
  });
});

describe("R95-N05 request-phase uncertainty", () => {
  it("timeout BEFORE provider acceptance: reservation retained, review queued, NO second charge", async () => {
    const db = await openRealDatabase();
    const { session, orderId } = await buyerWithOrder(db, "timeout-order-1");
    let gatewayCalls = 0;
    const responder = timeoutResponder();
    const restore = withFakedFetch((url) => { gatewayCalls += 1; return responder(url); });
    try {
      const response = await startOrderPayment(authedRequest(`/api/billing/orders/${orderId}/pay`, {}, { session }), liveEnv(db), orderId);
      expect(response.status).toBe(202);
      const body = await response.json() as { review_required: boolean };
      expect(body.review_required).toBe(true);

      // A retried /pay must NOT send a second gateway request.
      const retry = await startOrderPayment(authedRequest(`/api/billing/orders/${orderId}/pay`, {}, { session }), liveEnv(db), orderId);
      const retryBody = await retry.json() as { attempt_id: number; note: string };
      expect(retryBody.note).toContain("Operator reconciliation");
      expect(gatewayCalls).toBe(1);
      expect(await countRows(db, "payment_attempts")).toBe(1); // exactly one reservation
      const attempt = await db.prepare("SELECT state, authority FROM payment_attempts").first<{ state: string; authority: string | null }>();
      expect(attempt?.state).toBe("created"); // never guessed into failed
      expect(attempt?.authority).toBeNull();
      const review = await db.prepare("SELECT reason FROM billing_review_cases").all<{ reason: string }>();
      expect(review.results.map((r) => r.reason)).toContain("request_outcome_unknown");
    } finally {
      restore();
    }
  });

  it("timeout AFTER acceptance (200 but unreadable body): unknown outcome, never a fabricated authority", async () => {
    const db = await openRealDatabase();
    const { session, orderId } = await buyerWithOrder(db, "timeout-order-2");
    const restore = withFakedFetch(async () => new Response("half of a JS", { status: 200, headers: { "content-type": "application/json" } }));
    try {
      const response = await startOrderPayment(authedRequest(`/api/billing/orders/${orderId}/pay`, {}, { session }), liveEnv(db), orderId);
      expect(response.status).toBe(202);
      const attempt = await db.prepare("SELECT state, authority FROM payment_attempts").first<{ state: string; authority: string | null }>();
      expect(attempt?.authority).toBeNull(); // nothing was invented
      expect(await countRows(db, "billing_review_cases", "reason='request_outcome_unknown'")).toBe(1);
    } finally {
      restore();
    }
  });

  it("malformed provider responses never become an authority", async () => {
    const db = await openRealDatabase();
    const { session, orderId } = await buyerWithOrder(db, "malformed-order-1");
    for (const payload of ["null", "[]", "{\"unexpected\":true}", ""]) {
      const restore = withFakedFetch(() => new Response(payload, { status: 200, headers: { "content-type": "application/json" } }));
      try {
        // Each call returns the SAME retained attempt (no new charge path).
        await startOrderPayment(authedRequest(`/api/billing/orders/${orderId}/pay`, {}, { session }), liveEnv(db), orderId);
        const attempt = await db.prepare("SELECT authority FROM payment_attempts").first<{ authority: string | null }>();
        expect(attempt?.authority).toBeNull();
      } finally {
        restore();
      }
    }
    expect(await countRows(db, "payment_attempts")).toBe(1);
  });
});

describe("R95-N05 callback + verification outcomes", () => {
  it("a delayed/repeated callback reports the STORED state and writes NOTHING", async () => {
    const db = await openRealDatabase();
    await buyerWithOrder(db, "callback-order-1");
    const restore = withFakedFetch(() => zarinpalIssued("CALLBACK-AUTH-1"));
    let attemptId: number;
    try {
      const session = await makeSession(db, "buyer");
      const order = await db.prepare("SELECT id FROM orders WHERE order_key='callback-order-1'").first<{ id: number }>();
      const start = await startOrderPayment(authedRequest(`/api/billing/orders/${order!.id}/pay`, {}, { session }), liveEnv(db), order!.id);
      attemptId = ((await start.json() as { attempt_id: number })).attempt_id;
    } finally {
      restore();
    }
    const eventsBefore = await countRows(db, "payment_events");
    for (let i = 0; i < 3; i++) {
      const landing = await paymentCallback(new Request(`https://registry.example/api/billing/payments/callback?Authority=CALLBACK-AUTH-1&Status=OK&paid=yes&code=100`), liveEnv(db));
      const body = await landing.json() as { state: string };
      expect(body.state).toBe("redirected"); // still unverified — the query string is ignored
    }
    expect(await countRows(db, "payment_events")).toBe(eventsBefore);
    expect(await countRows(db, "entitlements")).toBe(0);
    expect(attemptId!).toBeGreaterThan(0);
  });

  it("code 100 verifies and fulfills once; code 101 (already verified) replays with NO new benefit", async () => {
    const db = await openRealDatabase();
    const { session, orderId } = await buyerWithOrder(db, "verify-order-1");
    const restore = withFakedFetch((url) => {
      if (url.includes("request.json")) return zarinpalIssued("VERIFY-AUTH-1");
      return zarinpalVerified(999001, 100);
    });
    let attemptId: number;
    try {
      const start = await startOrderPayment(authedRequest(`/api/billing/orders/${orderId}/pay`, {}, { session }), liveEnv(db), orderId);
      attemptId = ((await start.json() as { attempt_id: number })).attempt_id;
      const verify = await verifyPaymentAttempt(authedRequest("/api/billing/payments/verify", { attempt_id: attemptId }, { session }), liveEnv(db));
      expect(((await verify.json() as { fulfilled: boolean })).fulfilled).toBe(true);
      const expiry = await db.prepare("SELECT expires_at FROM entitlements").first<{ expires_at: string }>();
    } finally {
      restore();
    }
    // Now the provider says 101 (already verified) on a replay: stored result.
    const restore101 = withFakedFetch(() => zarinpalVerified(999001, 101));
    try {
      const replay = await verifyPaymentAttempt(authedRequest("/api/billing/payments/verify", { attempt_id: attemptId! }, { session }), liveEnv(db));
      const body = await replay.json() as { verified: boolean; idempotent_replay: boolean };
      expect(body.verified).toBe(true);
      expect(body.idempotent_replay).toBe(true);
      expect(await countRows(db, "entitlements")).toBe(1);
    } finally {
      restore101();
    }
  });

  it("amount mismatch (-50), configuration (-53) and unknown (-999) verify outcomes: never verified, never guessed", async () => {
    const db = await openRealDatabase();
    const { session, orderId } = await buyerWithOrder(db, "verify-order-2");
    const restore = withFakedFetch((url) => {
      if (url.includes("request.json")) return zarinpalIssued("VERIFY-AUTH-2");
      return new Response("no gateway hit expected before request", { status: 500 });
    });
    let attemptId: number;
    try {
      const start = await startOrderPayment(authedRequest(`/api/billing/orders/${orderId}/pay`, {}, { session }), liveEnv(db), orderId);
      attemptId = ((await start.json() as { attempt_id: number })).attempt_id;
    } finally {
      restore();
    }
    for (const [payload, failure] of [
      [{ data: { code: -50 } }, "amount_mismatch"],
      [{ data: { code: -53 } }, "configuration"],
      [{ data: { code: -999 } }, "provider_rejected"],
    ] as const) {
      const restoreOne = withFakedFetch(() => new Response(JSON.stringify(payload), { status: 200 }));
      try {
        const response = await verifyPaymentAttempt(authedRequest("/api/billing/payments/verify", { attempt_id: attemptId }, { session }), liveEnv(db));
        const body = await response.json() as { verified: boolean; failure: string };
        expect(body.verified).toBe(false);
        expect(body.failure).toBe(failure);
        expect(await countRows(db, "entitlements")).toBe(0);
        const attempt = await db.prepare("SELECT state FROM payment_attempts WHERE id=?").bind(attemptId).first<{ state: string }>();
        expect(attempt?.state).toBe("redirected"); // unchanged — no guessing
      } finally {
        restoreOne();
      }
    }
  });
});

describe("R95-N05 operator workflow: inquiry -> resolution", () => {
  it("inquiry RECORDS evidence and never mutates state; not-paid release is fail-closed; buyer verify fulfills; the case resolves", async () => {
    const db = await openRealDatabase();
    const { session, orderId, orderKey, total } = await buyerWithOrder(db, "inquiry-order-1");
    const admin = await adminSession(db);
    // Request phase times out -> unknown outcome case.
    const restoreTimeout = withFakedFetch(timeoutResponder());
    try {
      await startOrderPayment(authedRequest(`/api/billing/orders/${orderId}/pay`, {}, { session }), liveEnv(db), orderId);
    } finally {
      restoreTimeout();
    }
    const attempt = await db.prepare("SELECT id, state FROM payment_attempts").first<{ id: number; state: string }>();
    // No authority yet: inquiry honestly refuses (nothing to ask the provider).
    await expect(adminAttemptInquiry(authedRequest(`/api/admin/billing/attempts/${attempt!.id}/inquiry`, {}, { session: admin }), liveEnv(db), attempt!.id))
      .rejects.toMatchObject({ status: 409, code: "authority_pending" });

    // R96 (F12): resolving by 'provider_not_paid_confirmed' is FAIL-CLOSED —
    // a not-paid observation or a missing local authority does not prove the
    // gateway session can never settle. No attempt is released.
    const case1 = await openCaseForAttempt(db, attempt!.id);
    await expect(adminResolveReviewCase(authedRequest(`/api/admin/billing/review-cases/${case1.caseId}/resolve`, {
      outcome: "provider_not_paid_confirmed",
      resolution_note: "Merchant panel shows no session for this order; the buyer never received a payment URL.",
      evidence: { attempt_id: attempt!.id, order_id: orderId, order_key: orderKey, amount_minor: total, currency: "IRR", authority: null, provider_reference: null },
    }, { session: admin }), liveEnv(db), case1.caseId)).rejects.toMatchObject({ status: 501, code: "terminal_payment_proof_required" });
    const unreleased = await db.prepare("SELECT state FROM payment_attempts WHERE id=?").bind(attempt!.id).first<{ state: string }>();
    expect(unreleased?.state).toBe("created"); // NOT released
    const stillOpenCase = await db.prepare("SELECT status FROM billing_review_cases WHERE id=?").bind(case1.caseId).first<{ status: string }>();
    expect(stillOpenCase?.status).toBe("open");

    // The buyer retries while the first attempt is open: the SAME attempt is
    // returned (202) — one order cannot acquire two concurrently payable
    // attempts. No second gateway request is sent.
    const restoreRetry = withFakedFetch((url) => {
      if (url.includes("request.json")) return zarinpalIssued("INQUIRY-AUTH-2");
      return new Response("unexpected", { status: 500 });
    });
    try {
      const retry = await startOrderPayment(authedRequest(`/api/billing/orders/${orderId}/pay`, {}, { session }), liveEnv(db), orderId);
      expect(retry.status).toBe(200); // the SAME open attempt is returned
      const retryBody = await retry.json() as { attempt_id: number };
      expect(retryBody.attempt_id).toBe(attempt!.id);
    } finally {
      restoreRetry();
    }
    expect(await countRows(db, "payment_attempts")).toBe(1); // history: exactly one attempt

    // A SECOND order completes the fulfilled journey: authority issued, the
    // stale sweep opens a case, operator inquiry observes verified (evidence
    // ONLY), the BUYER verification fulfills, and the case resolves.
    const order2 = await createOrder(db, { buyer: "buyer", key: "inquiry-order-2" });
    const restoreIssue = withFakedFetch((url) => {
      if (url.includes("request.json")) return zarinpalIssued("INQUIRY-AUTH-1");
      return new Response("unexpected", { status: 500 });
    });
    let attempt2: number;
    try {
      const start = await startOrderPayment(authedRequest(`/api/billing/orders/${order2!.id}/pay`, {}, { session }), liveEnv(db), order2!.id);
      const startBody = await start.json() as { attempt_id: number };
      attempt2 = startBody.attempt_id;
    } finally {
      restoreIssue();
    }
    expect(await countRows(db, "payment_attempts")).toBe(2); // history retained

    // The second attempt sits unverified past the staleness horizon: the
    // operator sweep queues it (stale_unverified) while it is still pending.
    await db.exec(`UPDATE payment_attempts SET created_at=datetime('now','-2 days') WHERE id=${attempt2}`);
    await adminReconciliation(authedRequest("/api/admin/billing/reconciliation", {}, { session: admin }), liveEnv(db));
    const case2 = await openCaseForAttempt(db, attempt2);

    // Operator inquiry on the redirected attempt: provider reports VERIFIED.
    // R96 (F11): the inquiry envelope must carry the documented code+status;
    // the observation is evidence ONLY and never marks the attempt verified.
    const restoreVerify = withFakedFetch((url) => url.includes("inquiry.json") ? new Response(JSON.stringify({ data: { code: 100, status: "VERIFIED" } }), { status: 200 }) : new Response("unexpected", { status: 500 }));
    try {
      const inquiry = await adminAttemptInquiry(authedRequest(`/api/admin/billing/attempts/${attempt2}/inquiry`, {}, { session: admin }), liveEnv(db), attempt2);
      const body = await inquiry.json() as { inquiry: string; verified: boolean; outcome: string; provider_status: string | null; evidence: { authority: string; provider_reference: string | null } };
      expect(body.verified).toBe(false); // an observation NEVER verifies
      expect(body.outcome).toBe("verified");
      expect(body.provider_status).toBe("VERIFIED");
      expect(body.evidence.authority).toBe("INQUIRY-AUTH-1");
      expect(body.evidence.provider_reference).toBeNull(); // no receipt from inquiry
      // Inquiry is evidence ONLY: no fulfillment, no state change.
      expect(await countRows(db, "entitlements")).toBe(0);
      const still = await db.prepare("SELECT state FROM payment_attempts WHERE id=?").bind(attempt2).first<{ state: string }>();
      expect(still?.state).toBe("redirected");
      const events = await db.prepare("SELECT actor, inquiry_outcome FROM payment_events WHERE payment_attempt_id=? AND actor='operator'").bind(attempt2).all<{ actor: string; inquiry_outcome: string }>();
      expect(events.results).toHaveLength(1);
      expect(events.results[0]?.inquiry_outcome).toBe("verified");
    } finally {
      restoreVerify();
    }

    // The BUYER verification fulfills (the only fulfillment path).
    const restoreBuyer = withFakedFetch(() => zarinpalVerified(888001, 101));
    try {
      const verify = await verifyPaymentAttempt(authedRequest("/api/billing/payments/verify", { attempt_id: attempt2 }, { session }), liveEnv(db));
      expect(((await verify.json() as { fulfilled: boolean })).fulfilled).toBe(true);
    } finally {
      restoreBuyer();
    }
    expect(await countRows(db, "entitlements")).toBe(1);

    // Resolve the stale case as fulfilled now that the receipt exists.
    const resolve2 = await adminResolveReviewCase(authedRequest(`/api/admin/billing/review-cases/${case2.caseId}/resolve`, {
      outcome: "provider_verified_fulfilled",
      resolution_note: "Provider inquiry confirmed paid; buyer verification fulfilled exactly once.",
      evidence: { attempt_id: attempt2, order_id: order2!.id, order_key: order2!.order_key, amount_minor: Number(order2!.total_minor), currency: "IRR", authority: "INQUIRY-AUTH-1", provider_reference: "888001" },
    }, { session: admin }), liveEnv(db), case2.caseId);
    expect(((await resolve2.json() as { resolved: boolean })).resolved).toBe(true);
  });

  it("resolution REFUSES mismatched evidence (wrong amount/authority) — the case stays open", async () => {
    const db = await openRealDatabase();
    const { session, orderId, orderKey, total } = await buyerWithOrder(db, "mismatch-order-1");
    const admin = await adminSession(db);
    const restore = withFakedFetch(timeoutResponder());
    let attemptId: number;
    try {
      await startOrderPayment(authedRequest(`/api/billing/orders/${orderId}/pay`, {}, { session }), liveEnv(db), orderId);
      attemptId = (await db.prepare("SELECT id FROM payment_attempts").first<{ id: number }>())!.id;
    } finally {
      restore();
    }
    const { caseId } = await openCaseForAttempt(db, attemptId);
    // Wrong amount
    await expect(adminResolveReviewCase(authedRequest(`/api/admin/billing/review-cases/${caseId}/resolve`, {
      outcome: "operator_error_dismissed", resolution_note: "Wrong amount evidence test.",
      evidence: { attempt_id: attemptId, order_id: orderId, order_key: orderKey, amount_minor: total + 1, currency: "IRR", authority: null, provider_reference: null },
    }, { session: admin }), liveEnv(db), caseId)).rejects.toMatchObject({ status: 409, code: "evidence_mismatch" });
    // Wrong order key
    await expect(adminResolveReviewCase(authedRequest(`/api/admin/billing/review-cases/${caseId}/resolve`, {
      outcome: "operator_error_dismissed", resolution_note: "Wrong order key evidence test.",
      evidence: { attempt_id: attemptId, order_id: orderId, order_key: "not-the-order-key", amount_minor: total, currency: "IRR", authority: null, provider_reference: null },
    }, { session: admin }), liveEnv(db), caseId)).rejects.toMatchObject({ status: 409, code: "evidence_mismatch" });
    // Wrong attempt linkage
    await expect(adminResolveReviewCase(authedRequest(`/api/admin/billing/review-cases/${caseId}/resolve`, {
      outcome: "operator_error_dismissed", resolution_note: "Wrong attempt evidence test.",
      evidence: { attempt_id: attemptId + 999, order_id: orderId, order_key: orderKey, amount_minor: total, currency: "IRR", authority: null, provider_reference: null },
    }, { session: admin }), liveEnv(db), caseId)).rejects.toMatchObject({ status: 409, code: "evidence_mismatch" });
    // Still open, still nothing changed.
    const stillOpen = await db.prepare("SELECT status FROM billing_review_cases WHERE id=?").bind(caseId).first<{ status: string }>();
    expect(stillOpen?.status).toBe("open");
    const attempt = await db.prepare("SELECT state FROM payment_attempts WHERE id=?").bind(attemptId).first<{ state: string }>();
    expect(attempt?.state).toBe("created");
  });

  it("provider_not_paid_confirmed with an authority REQUIRES a recorded not-paid inquiry first", async () => {
    const db = await openRealDatabase();
    const { session, orderId, orderKey, total } = await buyerWithOrder(db, "notpaid-order-1");
    const admin = await adminSession(db);
    const restore = withFakedFetch((url) => {
      if (url.includes("request.json")) return zarinpalIssued("NOTPAID-AUTH-1");
      return new Response("unexpected", { status: 500 });
    });
    let attemptId: number;
    try {
      const start = await startOrderPayment(authedRequest(`/api/billing/orders/${orderId}/pay`, {}, { session }), liveEnv(db), orderId);
      attemptId = ((await start.json() as { attempt_id: number })).attempt_id;
      // Force a review case on this attempt (stale) so a case exists to resolve.
      await db.exec("UPDATE payment_attempts SET created_at=datetime('now','-2 days')");
      await adminReconciliation(authedRequest("/api/admin/billing/reconciliation", {}, { session: admin }), liveEnv(db));
    } finally {
      restore();
    }
    const { caseId } = await openCaseForAttempt(db, attemptId);
    const evidence = { attempt_id: attemptId, order_id: orderId, order_key: orderKey, amount_minor: total, currency: "IRR", authority: "NOTPAID-AUTH-1", provider_reference: null };
    // R96 (F12): the fail-closed terminal-proof gate fires BEFORE evidence
    // reconciliation — the outcome itself is deliberately unavailable.
    await expect(adminResolveReviewCase(authedRequest(`/api/admin/billing/review-cases/${caseId}/resolve`, {
      outcome: "provider_not_paid_confirmed", resolution_note: "Panel shows not paid (no inquiry yet).", evidence,
    }, { session: admin }), liveEnv(db), caseId)).rejects.toMatchObject({ status: 501, code: "terminal_payment_proof_required" });

    // Inquiry returns a -51 error envelope. R96 (F11): the inquiry contract
    // parses ONLY documented success statuses (code 100 + VERIFIED/PAID/...);
    // an error envelope is an honest failed observation (provider_rejected),
    // never a manufactured 'not_paid' settlement claim.
    const restoreInquiry = withFakedFetch(() => new Response(JSON.stringify({ data: { code: -51 } }), { status: 200 }));
    try {
      const inquiry = await adminAttemptInquiry(authedRequest(`/api/admin/billing/attempts/${attemptId}/inquiry`, {}, { session: admin }), liveEnv(db), attemptId);
      expect(((await inquiry.json() as { outcome: string })).outcome).toBe("provider_rejected");
    } finally {
      restoreInquiry();
    }
    // R96 (F12): even with a recorded inquiry observation, release stays
    // fail-closed — no observation proves the session can never settle.
    // The attempt is retained; no second payable attempt.
    await expect(adminResolveReviewCase(authedRequest(`/api/admin/billing/review-cases/${caseId}/resolve`, {
      outcome: "provider_not_paid_confirmed", resolution_note: "Provider inquiry observed; release still requires terminal-session proof.", evidence,
    }, { session: admin }), liveEnv(db), caseId)).rejects.toMatchObject({ status: 501, code: "terminal_payment_proof_required" });
    const attempt = await db.prepare("SELECT state FROM payment_attempts WHERE id=?").bind(attemptId).first<{ state: string }>();
    expect(attempt?.state).toBe("redirected"); // NOT released (authority retained)
    const openCase = await db.prepare("SELECT status FROM billing_review_cases WHERE id=?").bind(caseId).first<{ status: string }>();
    expect(openCase?.status).toBe("open");
    // The buyer retry returns the SAME attempt (202) — never a second gateway
    // request while the first session's outcome is unproven.
    const restoreRetry = withFakedFetch((url) => url.includes("request.json") ? zarinpalIssued("NOTPAID-AUTH-2") : new Response("x", { status: 500 }));
    try {
      const retry = await startOrderPayment(authedRequest(`/api/billing/orders/${orderId}/pay`, {}, { session }), liveEnv(db), orderId);
      expect(retry.status).toBe(200); // the SAME open attempt is returned
      const retryBody = await retry.json() as { attempt_id: number };
      expect(retryBody.attempt_id).toBe(attemptId);
    } finally {
      restoreRetry();
    }
    expect(await countRows(db, "payment_attempts")).toBe(1);
  });
});

describe("R95-N05 reconciliation scan + privacy of evidence", () => {
  it("the scan is read-only and reports both violations and honest observations", async () => {
    const db = await openRealDatabase();
    await seedUser(db, "admin-1", "admin");
    const admin = await makeSession(db, "admin-1");
    const before = await db.prepare("SELECT COUNT(*) AS n FROM payment_events").first<{ n: number }>();
    const response = await adminReconciliation(authedRequest("/api/admin/billing/reconciliation", undefined, { method: "GET", session: admin }), liveEnv(db));
    const body = await response.json() as { scan: { checks: Array<{ name: string; kind: string; count: number }> } };
    const checks = Object.fromEntries(body.scan.checks.map((c) => [c.name, c]));
    expect(checks.paid_order_without_verified_attempt.kind).toBe("violation");
    expect(checks.paid_order_without_verified_attempt.count).toBe(0);
    expect(checks.verified_attempt_without_settlement_record.kind).toBe("observation");
    expect(body.scan.checks.every((c) => c.count === 0)).toBe(true);
    const after = await db.prepare("SELECT COUNT(*) AS n FROM payment_events").first<{ n: number }>();
    expect(Number(after?.n)).toBe(Number(before?.n)); // GET wrote nothing
  });

  it("persisted evidence contains provider codes/references only — never card or contact secrets", async () => {
    const db = await openRealDatabase();
    const { session, orderId } = await buyerWithOrder(db, "privacy-order-1");
    const restore = withFakedFetch((url) => {
      if (url.includes("request.json")) return zarinpalIssued("PRIVACY-AUTH-1");
      return zarinpalVerified(777001, 100);
    });
    let attemptId: number;
    try {
      const start = await startOrderPayment(authedRequest(`/api/billing/orders/${orderId}/pay`, {}, { session }), liveEnv(db), orderId);
      attemptId = ((await start.json() as { attempt_id: number })).attempt_id;
      await verifyPaymentAttempt(authedRequest("/api/billing/payments/verify", { attempt_id: attemptId }, { session }), liveEnv(db));
    } finally {
      restore();
    }
    const events = await db.prepare("SELECT payload_json FROM payment_events WHERE payment_attempt_id=?").bind(attemptId).all<{ payload_json: string }>();
    expect(events.results.length).toBeGreaterThan(0);
    for (const row of events.results) {
      const lowered = row.payload_json.toLowerCase();
      for (const forbidden of ["card", "pan", "cvv", "cvc", "pin", "password", "email", "phone", "mobile", "contact"]) {
        expect(lowered).not.toContain(forbidden);
      }
    }
  });
});

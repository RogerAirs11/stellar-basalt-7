import { describe, expect, it } from "vitest";
import {
  buildZarinpalRequestInit,
  buildZarinpalVerifyInit,
  zarinpalStartPayUrl,
  zarinpalProvider,
  getPaymentProvider,
} from "../../src/commerce/payments/zarinpal";
import {
  entitlementEventKey,
  addDaysIso,
  renewalAnchor,
} from "../../src/commerce/entitlements";
import { startOrderPayment, paymentCallback, verifyPaymentAttempt, myEntitlements, adminRefundOrder, adminReconciliation } from "../../src/api/modules/billing";
import { HttpError } from "../../src/api/http";
import {
  openRealDatabase, seedUser, makeSession, authedRequest, seedBillingPrices,
  createOrder, reserveAttempt, verifyOrder, countRows, withFakedFetch,
  zarinpalIssued, zarinpalVerified, type AuthedSession,
} from "../helpers/realDatabase";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * R95-N01: schema-backed route tests. Real SQLite with every migration
 * applied; real HTTP handlers; only the provider gateway fetch is faked.
 *
 * Acceptance pinned (R95 semantics):
 *  - new charges stay disabled until the live-payments gate is explicitly on;
 *  - a request key identifies a retried command, a fresh operation id proves
 *    which execution won, a provider response supplies payment evidence;
 *  - replayed verification grants NOTHING — entitlements extend only from
 *    the fresh winner's stored state;
 *  - refunds are unavailable (501) rather than falsely successful;
 *  - unknown provider outcomes stay unknown — never guessed paid/failed.
 */

const ORIGIN = "https://registry.example";

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

function deadEnv(db: D1Database, extra: Record<string, string> = {}) {
  return { DB: db, SESSION_COOKIE_NAME: "hr_session", ...extra } as never;
}

async function seededBuyer(db: D1Database): Promise<AuthedSession> {
  await seedUser(db, "buyer", "user");
  return makeSession(db, "buyer");
}

// ---------------------------------------------------------------------------
// 1. The provider adapter wire contract (pure functions).
// ---------------------------------------------------------------------------

describe("P18 zarinpal adapter", () => {
  const config = { merchantId: "merchant-uuid-1234" };

  it("request: rial-integer amount, explicit IRR currency, merchant id, callback URL — the exact v4 wire shape", () => {
    const { url, init } = buildZarinpalRequestInit(config, 19_000_000, "Order k-1", "https://registry.example/api/billing/payments/callback");
    expect(url).toBe("https://payment.zarinpal.com/pg/v4/payment/request.json");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toEqual({ merchant_id: "merchant-uuid-1234", amount: 19_000_000, currency: "IRR", callback_url: "https://registry.example/api/billing/payments/callback", description: "Order k-1" });
  });

  it("verify: the STORED amount travels to the provider — never a client figure", () => {
    const { url, init } = buildZarinpalVerifyInit(config, 19_000_000, "AUTH-0001");
    expect(url).toBe("https://payment.zarinpal.com/pg/v4/payment/verify.json");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toEqual({ merchant_id: "merchant-uuid-1234", amount: 19_000_000, authority: "AUTH-0001" });
  });

  it("start-pay URL uses the documented /pg/StartPay/ form + sandbox base override", () => {
    expect(zarinpalStartPayUrl(config, "A1")).toBe("https://payment.zarinpal.com/pg/StartPay/A1");
    expect(zarinpalStartPayUrl({ ...config, baseUrl: "https://sandbox.zarinpal.com/" }, "A1")).toBe("https://sandbox.zarinpal.com/pg/StartPay/A1");
  });

  it("maps provider codes honestly: 100/101 verified, -50 amount mismatch, -51 not paid, -54 authority not found", async () => {
    const provider = zarinpalProvider({ merchantId: "m", baseUrl: "https://gateway.test" });
    const originalFetch = globalThis.fetch;
    const withPayload = (payload: unknown, status = 200) => async () => new Response(JSON.stringify(payload), { status });
    try {
      globalThis.fetch = withPayload({ data: { code: 100, ref_id: 999 } }) as typeof fetch;
      expect(await provider.verifyPayment(1000, "AUTH-00001")).toEqual({ ok: true, alreadyVerified: false, providerReference: "999", providerCode: 100 });
      globalThis.fetch = withPayload({ data: { code: 101, ref_id: 999 } }) as typeof fetch;
      expect((await provider.verifyPayment(1000, "AUTH-00001")).alreadyVerified).toBe(true);
      globalThis.fetch = withPayload({ data: { code: -50 } }) as typeof fetch;
      expect(await provider.verifyPayment(1000, "AUTH-00001")).toMatchObject({ ok: false, failure: "amount_mismatch" });
      globalThis.fetch = withPayload({ data: { code: -51 } }) as typeof fetch;
      expect(await provider.verifyPayment(1000, "AUTH-00001")).toMatchObject({ ok: false, failure: "not_paid" });
      globalThis.fetch = withPayload({ data: { code: -54 } }) as typeof fetch;
      expect(await provider.verifyPayment(1000, "AUTH-00001")).toMatchObject({ ok: false, failure: "authority_not_found" });
      globalThis.fetch = withPayload({ data: { code: -53 } }) as typeof fetch;
      expect(await provider.verifyPayment(1000, "AUTH-00001")).toMatchObject({ ok: false, failure: "configuration" });
      // A 100 with an unusable reference is NOT a success — no fabricated proof.
      globalThis.fetch = withPayload({ data: { code: 100, ref_id: 0 } }) as typeof fetch;
      expect(await provider.verifyPayment(1000, "AUTH-00001")).toMatchObject({ ok: false, failure: "provider_rejected" });
      // An HTTP 404 with an unusable body is an UNKNOWN outcome, not proof the
      // authority never existed — R95 never upgrades it to a definite state.
      globalThis.fetch = (async () => new Response("{}", { status: 404 })) as typeof fetch;
      expect(await provider.verifyPayment(1000, "AUTH-00001")).toMatchObject({ ok: false, failure: "provider_rejected" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects malformed authorities and amounts before any network call", async () => {
    const provider = zarinpalProvider({ merchantId: "m" });
    expect(await provider.verifyPayment(1000, "SHORT")).toMatchObject({ ok: false, failure: "configuration" });
    expect(await provider.verifyPayment(0, "AUTH-00001")).toMatchObject({ ok: false, failure: "configuration" });
  });

  it("is null until the OWNER supplies ZARINPAL_MERCHANT_ID (fail-closed)", () => {
    expect(getPaymentProvider({})).toBeNull();
    expect(getPaymentProvider({ ZARINPAL_MERCHANT_ID: " " })).toBeNull();
    expect(getPaymentProvider({ ZARINPAL_MERCHANT_ID: "m" })).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Entitlement math (pure) + verified-order statements (real database).
// ---------------------------------------------------------------------------

describe("P18 entitlement statements", () => {
  it("event keys are deterministic per attempt (concurrent callbacks = same key)", () => {
    expect(entitlementEventKey(7)).toBe("payment:7:entitlement");
    expect(entitlementEventKey(7)).toBe(entitlementEventKey(7));
  });

  it("renewal extends from the CURRENT expiry — no gap, no double-count", () => {
    expect(renewalAnchor("2026-10-01T00:00:00Z", null)).toBe("2026-10-01T00:00:00Z");
    expect(renewalAnchor("2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z")).toBe("2026-11-01T00:00:00Z");
    expect(renewalAnchor("2026-12-01T00:00:00Z", "2026-11-01T00:00:00Z")).toBe("2026-12-01T00:00:00Z");
    expect(addDaysIso("2026-11-01T00:00:00Z", 30)).toBe("2026-12-01T00:00:00.000Z");
  });

  it("the verified batch credits EVERY frozen line and quantity exactly once (real database)", async () => {
    const db = await openRealDatabase();
    await seedUser(db, "buyer", "user");
    await seedBillingPrices(db);
    const order = await createOrder(db, {
      buyer: "buyer",
      lines: [
        { sku: "farm_workspace_monthly", price_id: 1, version: 1, title_en: "Farm", title_fa: "Farm", unit_minor: 19_000_000, quantity: 2, line_total_minor: 38_000_000, period_days: 30 },
        { sku: "provider_pro_monthly", price_id: 2, version: 1, title_en: "Pro", title_fa: "Pro", unit_minor: 4_900_000, quantity: 1, line_total_minor: 4_900_000, period_days: 30 },
      ],
    });
    const { attemptId } = await reserveAttempt(db, order!.id, "buyer");
    await verifyOrder(db, order!, attemptId!);

    const entitlements = await db.prepare("SELECT sku, expires_at FROM entitlements ORDER BY sku").all<{ sku: string; expires_at: string }>();
    expect(entitlements.results).toHaveLength(2);
    // ONE event per frozen line; quantity multiplies the granted days.
    expect(Number(await countRows(db, "entitlement_events", "kind IN ('grant','renewal')"))).toBe(2);
    const farmEvent = await db.prepare("SELECT granted_days FROM entitlement_events WHERE sku='farm_workspace_monthly'").first<{ granted_days: number }>();
    expect(Number(farmEvent?.granted_days)).toBe(60); // 30 days x quantity 2
    const paidOrder = await db.prepare("SELECT status FROM orders WHERE id=?").bind(order!.id).first<{ status: string }>();
    expect(paidOrder?.status).toBe("paid");
    expect(Number(await countRows(db, "billing_command_receipts"))).toBeGreaterThanOrEqual(1);
  });

  it("a one-time purchase (no period) verifies without any entitlement rows", async () => {
    const db = await openRealDatabase();
    await seedUser(db, "buyer", "user");
    await seedBillingPrices(db);
    const order = await createOrder(db, {
      buyer: "buyer",
      lines: [{ sku: "sponsored_promotion", price_id: 1, version: 1, title_en: "Promo", title_fa: "Promo", unit_minor: 9_000_000, quantity: 1, line_total_minor: 9_000_000, period_days: null }],
    });
    const { attemptId } = await reserveAttempt(db, order!.id, "buyer");
    await verifyOrder(db, order!, attemptId!);
    expect(await countRows(db, "entitlements")).toBe(0);
    expect(await countRows(db, "entitlement_events", "kind IN ('grant','renewal')")).toBe(0);
    expect((await db.prepare("SELECT status FROM orders WHERE id=?").bind(order!.id).first<{ status: string }>())?.status).toBe("paid");
  });

  it("a REPLAYED verification with a fresh operation id grants nothing extra — stored state wins", async () => {
    const db = await openRealDatabase();
    await seedUser(db, "buyer", "user");
    await seedBillingPrices(db);
    const order = await createOrder(db, { buyer: "buyer" });
    const { attemptId } = await reserveAttempt(db, order!.id, "buyer");
    await verifyOrder(db, order!, attemptId!, crypto.randomUUID());
    const firstExpiry = await db.prepare("SELECT expires_at FROM entitlements WHERE sku='farm_workspace_monthly'").first<{ expires_at: string }>();

    // Replay: a NEW operation id attempting the same fulfillment.
    await verifyOrder(db, order!, attemptId!, crypto.randomUUID());
    const after = await db.prepare("SELECT expires_at FROM entitlements WHERE sku='farm_workspace_monthly'").first<{ expires_at: string }>();
    expect(after?.expires_at).toBe(firstExpiry?.expires_at); // unchanged — no extra subscription time
    expect(Number(await countRows(db, "entitlements"))).toBe(1);
  });

  it("renewal extends from the CURRENT stored expiry against the real schema", async () => {
    const db = await openRealDatabase();
    await seedUser(db, "buyer", "user");
    await seedBillingPrices(db);
    const order = await createOrder(db, { buyer: "buyer" });
    const { attemptId } = await reserveAttempt(db, order!.id, "buyer");
    await verifyOrder(db, order!, attemptId!, crypto.randomUUID(), "2026-10-03T00:00:00.000Z");
    const first = await db.prepare("SELECT expires_at FROM entitlements WHERE sku='farm_workspace_monthly'").first<{ expires_at: string }>();
    expect(first?.expires_at).toBe("2026-11-02 00:00:00");

    // A second PAID period (new attempt) extends from the stored expiry.
    const order2 = await createOrder(db, { buyer: "buyer", key: "renewal-order-0002" });
    const { attemptId: attempt2 } = await reserveAttempt(db, order2!.id, "buyer");
    await verifyOrder(db, order2!, attempt2!, crypto.randomUUID(), "2026-10-10T00:00:00.000Z");
    const renewed = await db.prepare("SELECT expires_at, activated_at FROM entitlements WHERE sku='farm_workspace_monthly'").first<{ expires_at: string; activated_at: string }>();
    expect(renewed?.expires_at).toBe("2026-12-02 00:00:00"); // extends from 2026-11-02, not from 2026-10-10
  });
});

// ---------------------------------------------------------------------------
// 3. Handler boundaries — real database, real sessions.
// ---------------------------------------------------------------------------

describe("P18 handlers", () => {
  it("startOrderPayment fails CLOSED while the live-payments gate is off — no attempt, honest 503", async () => {
    const db = await openRealDatabase();
    const session = await seededBuyer(db);
    await seedBillingPrices(db);
    const order = await createOrder(db, { buyer: "buyer" });

    // Even WITH merchant credentials configured, the release gate refuses.
    await expect(startOrderPayment(authedRequest(`/api/billing/orders/${order!.id}/pay`, {}, { session }), liveEnv(db, { BILLING_LIVE_PAYMENTS_ENABLED: "false" }), order!.id))
      .rejects.toMatchObject({ status: 503, code: "payments_disabled" });
    expect(await countRows(db, "payment_attempts")).toBe(0);
    expect(session.userId).toBe("buyer");
  });

  it("with the gate ON but no merchant credentials: 503 payment_provider_unconfigured, still no attempt", async () => {
    const db = await openRealDatabase();
    const session = await seededBuyer(db);
    await seedBillingPrices(db);
    const order = await createOrder(db, { buyer: "buyer" });
    await expect(startOrderPayment(authedRequest(`/api/billing/orders/${order!.id}/pay`, {}, { session }), liveEnv(db, { ZARINPAL_MERCHANT_ID: "" }), order!.id))
      .rejects.toMatchObject({ status: 503, code: "payment_provider_unconfigured" });
    expect(await countRows(db, "payment_attempts")).toBe(0);
  });

  it("the one-active-attempt policy returns the EXISTING attempt — no second gateway charge", async () => {
    const db = await openRealDatabase();
    const session = await seededBuyer(db);
    await seedBillingPrices(db);
    const order = await createOrder(db, { buyer: "buyer" });
    const restore = withFakedFetch(() => zarinpalIssued());

    try {
      const first = await startOrderPayment(authedRequest(`/api/billing/orders/${order!.id}/pay`, {}, { session }), liveEnv(db), order!.id);
      const firstBody = await first.json() as { attempt_id: number; authority?: string };
      expect(first.status).toBe(201);
      expect(firstBody.authority).toBe("A000000000001");
      expect(await countRows(db, "payment_attempts")).toBe(1);

      const second = await startOrderPayment(authedRequest(`/api/billing/orders/${order!.id}/pay`, {}, { session }), liveEnv(db), order!.id);
      const secondBody = await second.json() as { attempt_id: number; note: string };
      expect(secondBody.attempt_id).toBe(firstBody.attempt_id);
      expect(secondBody.note).toContain("Existing payment attempt returned");
      expect(await countRows(db, "payment_attempts")).toBe(1); // still ONE attempt
    } finally {
      restore();
    }
  });

  it("a gateway request with an UNKNOWN outcome keeps the reservation and flags review — no auto-retry", async () => {
    const db = await openRealDatabase();
    const session = await seededBuyer(db);
    await seedBillingPrices(db);
    const order = await createOrder(db, { buyer: "buyer" });
    const restore = withFakedFetch(() => new Response("gateway exploded", { status: 502 }));

    try {
      const response = await startOrderPayment(authedRequest(`/api/billing/orders/${order!.id}/pay`, {}, { session }), liveEnv(db), order!.id);
      expect(response.status).toBe(202);
      const body = await response.json() as { review_required: boolean; note: string };
      expect(body.review_required).toBe(true);
      expect(body.note).toContain("no automatic second payment attempt");
      const review = await db.prepare("SELECT reason FROM billing_review_cases").all<{ reason: string }>();
      expect(review.results.map((r) => r.reason)).toContain("request_outcome_unknown");
    } finally {
      restore();
    }
  });

  it("the redirect callback NEVER trusts the query status — it reports the stored state only", async () => {
    const db = await openRealDatabase();
    await seededBuyer(db);
    await seedBillingPrices(db);
    const order = await createOrder(db, { buyer: "buyer" });
    const { attemptId } = await reserveAttempt(db, order!.id, "buyer");
    const attempt = await db.prepare("SELECT authority FROM payment_attempts WHERE id=?").bind(attemptId).first<{ authority: string }>();

    const before = await countRows(db, "payment_events");
    const response = await paymentCallback(new Request(`${ORIGIN}/api/billing/payments/callback?Authority=${attempt!.authority}&Status=OK&paid=yes`), liveEnv(db));
    const body = await response.json() as { state: string; note: string };
    expect(body.state).toBe("redirected");
    expect(body.note).toContain("never trusted");
    expect(await countRows(db, "payment_events")).toBe(before); // the callback itself writes NOTHING
  });

  it("a replayed verify of an ALREADY-VERIFIED attempt grants nothing (fresh operation receipts checked)", async () => {
    const db = await openRealDatabase();
    const session = await seededBuyer(db);
    await seedBillingPrices(db);
    const order = await createOrder(db, { buyer: "buyer" });
    const { attemptId } = await reserveAttempt(db, order!.id, "buyer");
    await verifyOrder(db, order!, attemptId!, crypto.randomUUID());

    const restore = withFakedFetch(() => zarinpalVerified());
    try {
      const response = await verifyPaymentAttempt(authedRequest("/api/billing/payments/verify", { attempt_id: attemptId }, { session }), liveEnv(db));
      const body = await response.json() as { verified: boolean; fulfilled?: boolean; idempotent_replay?: boolean; entitlements?: unknown[] };
      expect(body.verified).toBe(true);
      expect(body.idempotent_replay).toBe(true);
      expect(body.entitlements).toHaveLength(1);
      // One entitlement row, unchanged expiry — the replay extended nothing.
      expect(await countRows(db, "entitlements")).toBe(1);
    } finally {
      restore();
    }
  });

  it("a legacy verified attempt WITHOUT an R95 receipt is retained but never re-fulfilled — review queued", async () => {
    const db = await openRealDatabase();
    const session = await seededBuyer(db);
    await seedBillingPrices(db);
    const order = await createOrder(db, { buyer: "buyer" });
    const { attemptId } = await reserveAttempt(db, order!.id, "buyer");
    // Simulate a pre-R95 row: verified state, but no billing_command_receipts row.
    await db.prepare("UPDATE payment_attempts SET state='verified', verified_at='2026-09-01 00:00:00' WHERE id=?").bind(attemptId).run();

    const restore = withFakedFetch(() => zarinpalVerified());
    try {
      const response = await verifyPaymentAttempt(authedRequest("/api/billing/payments/verify", { attempt_id: attemptId }, { session }), liveEnv(db));
      const body = await response.json() as { verified: boolean; review_required: boolean; note: string };
      expect(body.verified).toBe(true);
      expect(body.review_required).toBe(true);
      expect(body.note).toContain("no additional entitlement");
      expect(await countRows(db, "entitlements")).toBe(0); // legacy money grants nothing automatically
      const review = await db.prepare("SELECT reason FROM billing_review_cases").all<{ reason: string }>();
      expect(review.results.map((r) => r.reason)).toContain("legacy_paid_unreconciled");
    } finally {
      restore();
    }
  });

  it("a FAILED verification (not_paid) leaves the attempt PENDING — never guessed", async () => {
    const db = await openRealDatabase();
    const session = await seededBuyer(db);
    await seedBillingPrices(db);
    const order = await createOrder(db, { buyer: "buyer" });
    const { attemptId } = await reserveAttempt(db, order!.id, "buyer");

    const restore = withFakedFetch(() => new Response(JSON.stringify({ data: { code: -51 } }), { status: 200 }));
    try {
      const response = await verifyPaymentAttempt(authedRequest("/api/billing/payments/verify", { attempt_id: attemptId }, { session }), liveEnv(db));
      const body = await response.json() as { verified: boolean; state: string; failure: string };
      expect(body.verified).toBe(false);
      expect(body.state).toBe("redirected");
      expect(body.failure).toBe("not_paid");
      expect(await countRows(db, "entitlements")).toBe(0);
      expect((await db.prepare("SELECT status FROM orders WHERE id=?").bind(order!.id).first<{ status: string }>())?.status).not.toBe("paid");
    } finally {
      restore();
    }
  });

  it("myEntitlements carries the trust boundary note (paid plans buy conveniences, never access)", async () => {
    const db = await openRealDatabase();
    const session = await seededBuyer(db);
    const response = await myEntitlements(authedRequest("/api/billing/entitlements", undefined, { method: "GET", session }), deadEnv(db));
    const body = await response.json() as { boundary_note: string };
    expect(body.boundary_note).toContain("never grants access");
    expect(body.boundary_note).toContain("never confers official status");
  });

  it("adminRefundOrder is 501-unavailable for ANY order — money state is never touched", async () => {
    const db = await openRealDatabase();
    await seedUser(db, "admin-1", "admin");
    const admin = await makeSession(db, "admin-1");
    await seededBuyer(db);
    await seedBillingPrices(db);
    const order = await createOrder(db, { buyer: "buyer" });
    const { attemptId } = await reserveAttempt(db, order!.id, "buyer");
    await verifyOrder(db, order!, attemptId!);

    await expect(adminRefundOrder(authedRequest(`/api/admin/billing/orders/${order!.id}/refund`, { note: "Customer request, duplicate charge." }, { session: admin }), deadEnv(db), order!.id))
      .rejects.toMatchObject({ status: 501, code: "refund_workflow_unavailable" });
    // Nothing changed: order still paid, entitlement still active.
    expect((await db.prepare("SELECT status FROM orders WHERE id=?").bind(order!.id).first<{ status: string }>())?.status).toBe("paid");
    expect(await countRows(db, "entitlements", "active=1")).toBe(1);
    expect(await countRows(db, "entitlement_events", "kind='refund_reversal'")).toBe(0);
  });

  it("reconciliation GET is read-only; POST queues stale cases without guessing outcomes", async () => {
    const db = await openRealDatabase();
    await seedUser(db, "admin-1", "admin");
    const admin = await makeSession(db, "admin-1");
    await seededBuyer(db);
    await seedBillingPrices(db);
    const order = await createOrder(db, { buyer: "buyer" });
    await reserveAttempt(db, order!.id, "buyer");
    // Make the attempt look stale (created two days ago, never verified).
    await db.exec("UPDATE payment_attempts SET created_at=datetime('now','-2 days')");

    const getResponse = await adminReconciliation(authedRequest("/api/admin/billing/reconciliation", undefined, { method: "GET", session: admin }), deadEnv(db));
    const getBody = await getResponse.json() as { review_cases: unknown[]; attempt_counts: Record<string, number>; note: string };
    expect(getBody.note).toContain("GET is read-only");
    expect(getBody.attempt_counts).toHaveProperty("redirected", 1); // authority attached by the reservation helper

    const postResponse = await adminReconciliation(authedRequest("/api/admin/billing/reconciliation", {}, { session: admin }), deadEnv(db));
    const postBody = await postResponse.json() as { note: string };
    expect(postBody.note).toContain("never guesses");
    expect(await countRows(db, "billing_review_cases")).toBe(1); // queued, not expired/settled
    const attempt = await db.prepare("SELECT state FROM payment_attempts").first<{ state: string }>();
    expect(attempt?.state).toBe("redirected"); // still pending — an unknown outcome is never guessed
  });
});

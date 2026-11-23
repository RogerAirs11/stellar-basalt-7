import { describe, expect, it } from "vitest";
import { billingCatalog, createOrder, orderDetail, startOrderPayment, paymentCallback, verifyPaymentAttempt, myEntitlements, myOrders } from "../../src/api/modules/billing";
import { myNotifications } from "../../src/notifications/outbox";
import {
  openRealDatabase, seedUser, makeSession, authedRequest, seedBillingPrices,
  countRows, withFakedFetch, zarinpalIssued, zarinpalVerified, type AuthedSession,
} from "../helpers/realDatabase";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * R95-N01 integration evidence: ONE complete paid-workflow journey over a real
 * SQLite database with every migration applied — the exact chain the Master AI
 * review called the platform's largest missing integration:
 *
 *   published offer -> order -> payment status -> correct entitlement
 *   -> notification evidence -> receipt/support history.
 *
 * Only the provider gateway network IO is faked. Every handler runs its real
 * SQL against the real schema with foreign keys enforced.
 */

function liveEnvMap(db: D1Database) {
  return {
    DB: db,
    SESSION_COOKIE_NAME: "hr_session",
    ZARINPAL_MERCHANT_ID: "merchant-uuid-1234",
    ZARINPAL_BASE_URL: "https://gateway.test",
    ZARINPAL_APPROVED_ORIGINS: "https://gateway.test",
    PAYMENT_CALLBACK_BASE_URL: "https://registry.example",
    BILLING_LIVE_PAYMENTS_ENABLED: "true",
  };
}
function liveEnv(db: D1Database) {
  return liveEnvMap(db) as never;
}

describe("R95 integration: the complete paid workflow over real SQLite", () => {
  it("offer -> order -> gateway -> verification -> entitlement -> receipt, with every guard honest", async () => {
    const db = await openRealDatabase();
    await seedUser(db, "buyer", "user");
    const session = await makeSession(db, "buyer");
    await seedBillingPrices(db);

    // 1. The public catalog publishes the offer (live-purchasable flags honest).
    const catalog = await billingCatalog(authedRequest("/api/billing/catalog", undefined, { method: "GET" }), liveEnv(db));
    const catalogBody = await catalog.json() as { prices: Array<{ sku: string; price_toman: number }> };
    expect(catalogBody.prices.some((p) => p.sku === "farm_workspace_monthly" && p.price_toman === 1_900_000)).toBe(true);

    // 2. The buyer orders 2x the plan; the total is server-side math.
    const orderResponse = await createOrder(authedRequest("/api/billing/orders", {
      order_key: "integration-order-0001", items: [{ sku: "farm_workspace_monthly", quantity: 2 }],
    }, { session }), liveEnv(db));
    expect(orderResponse.status).toBe(201);
    const order = (await orderResponse.json() as { order: { id: number; total_minor: number } }).order;
    expect(order.total_minor).toBe(38_000_000);

    // 3. Before payment: no entitlement, no attempt.
    expect(await countRows(db, "payment_attempts")).toBe(0);
    expect(await countRows(db, "entitlements")).toBe(0);

    // 4. The gateway flow starts; only the gateway fetch is faked.
    const restore = withFakedFetch((url) => {
      if (url.includes("payment/request.json")) return zarinpalIssued("INTEGRATION-AUTH-1");
      if (url.includes("payment/verify.json")) return zarinpalVerified(999777);
      return new Response("unexpected gateway call", { status: 500 });
    });
    let attemptId: number;
    let authority: string;
    try {
      const start = await startOrderPayment(authedRequest(`/api/billing/orders/${order.id}/pay`, {}, { session }), liveEnv(db), order.id);
      expect(start.status).toBe(201);
      const startBody = await start.json() as { attempt_id: number; authority: string; amount_minor: number; amount_toman: number };
      attemptId = startBody.attempt_id;
      authority = startBody.authority;
      expect(startBody.amount_minor).toBe(38_000_000);
      expect(startBody.amount_toman).toBe(3_800_000); // display conversion only

      // 5. The redirect landing NEVER trusts the query string.
      const landing = await paymentCallback(new Request(`https://registry.example/api/billing/payments/callback?Authority=${authority}&Status=OK&paid=yes`), liveEnv(db));
      const landingBody = await landing.json() as { state: string };
      expect(landingBody.state).toBe("redirected"); // still unverified
      expect(await countRows(db, "entitlements")).toBe(0);

      // 6. Server-side verification against the provider: money confirmed once.
      const verify = await verifyPaymentAttempt(authedRequest("/api/billing/payments/verify", { attempt_id: attemptId }, { session }), liveEnv(db));
      const verifyBody = await verify.json() as { verified: boolean; fulfilled: boolean; idempotent_replay: boolean; entitlements: Array<{ sku: string; granted_days: number; expires_at: string }> };
      expect(verifyBody.verified).toBe(true);
      expect(verifyBody.fulfilled).toBe(true);
      expect(verifyBody.idempotent_replay).toBe(false);
      expect(verifyBody.entitlements).toHaveLength(1);
      expect(verifyBody.entitlements[0]?.sku).toBe("farm_workspace_monthly");
      expect(Number(verifyBody.entitlements[0]?.granted_days)).toBe(60); // 30 days x quantity 2

      // 7. A replayed verification grants NOTHING extra.
      const replay = await verifyPaymentAttempt(authedRequest("/api/billing/payments/verify", { attempt_id: attemptId }, { session }), liveEnv(db));
      const replayBody = await replay.json() as { idempotent_replay: boolean };
      expect(replayBody.idempotent_replay).toBe(true);
      expect(await countRows(db, "entitlements")).toBe(1);
    } finally {
      restore();
    }

    // 8. The order is paid with the attempt visible in the support history.
    const detail = await orderDetail(authedRequest(`/api/billing/orders/${order.id}`, undefined, { method: "GET", session }), liveEnv(db), order.id);
    const detailBody = await detail.json() as { order: { status: string; total_minor: number }; payment_attempts: Array<{ id: number; state: string; authority: string }> };
    expect(detailBody.order.status).toBe("paid");
    expect(Number(detailBody.order.total_minor)).toBe(38_000_000);
    expect(detailBody.payment_attempts).toHaveLength(1);
    expect(detailBody.payment_attempts[0]?.state).toBe("verified");
    expect(detailBody.payment_attempts[0]?.authority).toBe("INTEGRATION-AUTH-1");

    // 9. The buyer's entitlement is active with the trust boundary note.
    const entitlements = await myEntitlements(authedRequest("/api/billing/entitlements", undefined, { method: "GET", session }), liveEnv(db));
    const entitlementsBody = await entitlements.json() as { entitlements: Array<{ sku: string; currently_active: number; expires_at: string }>; boundary_note: string };
    expect(entitlementsBody.entitlements).toHaveLength(1);
    expect(Number(entitlementsBody.entitlements[0]?.currently_active)).toBe(1);
    expect(entitlementsBody.boundary_note).toContain("never grants access");

    // 10. myOrders shows the paid order with the currency honesty note.
    const orders = await myOrders(authedRequest("/api/billing/orders/mine", undefined, { method: "GET", session }), liveEnv(db));
    const ordersBody = await orders.json() as { orders: Array<{ status: string; total_toman: number }>; currency_note: string };
    expect(ordersBody.orders[0]?.status).toBe("paid");
    expect(ordersBody.orders[0]?.total_toman).toBe(3_800_000);
    expect(ordersBody.currency_note).toContain("rial");

    // 11. Notification boundary (honest current state): payment verification
    // does NOT yet enqueue buyer notifications — wiring the durable worker is
    // ticket R95-N09. The endpoint answers honestly with an empty history.
    const notifications = await myNotifications(authedRequest("/api/notifications/mine", undefined, { method: "GET", session }), liveEnv(db));
    const notificationsBody = await notifications.json() as { notifications: Array<{ event_key: string; status: string }>; status_vocabulary: Record<string, string> };
    expect(Array.isArray(notificationsBody.notifications)).toBe(true);
    expect(notificationsBody.notifications.filter((n) => n.event_key.includes("payment"))).toHaveLength(0);
    expect(notificationsBody.status_vocabulary.suppressed).toContain("preferences");

    // 12. The command receipt exists — support can trace exactly this fulfillment.
    expect(await countRows(db, "billing_command_receipts", "kind='verify'")).toBe(1);
    expect(await countRows(db, "payment_events", "to_state='verified'")).toBe(1);
  });

  it("the honest-refusal journey: gate off -> 503; no order state, no attempt, no entitlement", async () => {
    const db = await openRealDatabase();
    await seedUser(db, "buyer", "user");
    const session = await makeSession(db, "buyer");
    await seedBillingPrices(db);
    const orderResponse = await createOrder(authedRequest("/api/billing/orders", {
      order_key: "integration-order-0002", items: [{ sku: "farm_workspace_monthly", quantity: 1 }],
    }, { session }), { DB: db, SESSION_COOKIE_NAME: "hr_session" } as never);
    const order = (await orderResponse.json() as { order: { id: number } }).order;

    const restore = withFakedFetch(() => zarinpalIssued());
    try {
      // Live-payments gate OFF: even a fully configured merchant cannot charge.
      const gateOff = { ...liveEnvMap(db), BILLING_LIVE_PAYMENTS_ENABLED: "false" } as never;
      await expect(startOrderPayment(authedRequest(`/api/billing/orders/${order.id}/pay`, {}, { session }), gateOff, order.id))
        .rejects.toMatchObject({ status: 503, code: "payments_disabled" });
    } finally {
      restore();
    }
    expect(await countRows(db, "payment_attempts")).toBe(0);
    expect(await countRows(db, "entitlements")).toBe(0);
    expect((await db.prepare("SELECT status FROM orders WHERE id=?").bind(order.id).first<{ status: string }>())?.status).toBe("pending");
  });
});

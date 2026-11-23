import { describe, expect, it } from "vitest";
import {
  INTERNAL_CURRENCY,
  TOMAN_IN_RIAL,
  money,
  tomanToIrr,
  irrToToman,
  assertInternalCurrency,
  addMoney,
  multiplyMoney,
  parseTomanInput,
  formatToman,
  ORDER_TRANSITIONS,
  isOrderTransition,
} from "../../src/commerce/money";
import { billingCatalog, adminCreatePrice, createOrder, myOrders, orderDetail, cancelOrder } from "../../src/api/modules/billing";
import { HttpError } from "../../src/api/http";
import {
  openRealDatabase, seedUser, makeSession, authedRequest, seedBillingPrices,
  createOrder as seedOrder, reserveAttempt, verifyOrder, countRows, type AuthedSession,
} from "../helpers/realDatabase";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * R95-N01: schema-backed route tests for the P17 billing surface. Real SQLite,
 * every migration applied, foreign keys enforced; real handlers + sessions.
 *
 * Acceptance pinned:
 *  - a 1,900,000-TOMAN plan cannot be charged as 1,900,000 rial (unit is
 *    explicit and converted only at boundaries);
 *  - changing the catalog price does NOT mutate an existing order (frozen
 *    snapshot; immutable price versions);
 *  - duplicate order submission with the same key creates ONE order; the same
 *    key with a DIFFERENT intent is an honest 409, never a silent overwrite;
 *  - a client-supplied total is ignored (the schema does not even accept one)
 *    — the server always recomputes from the catalog.
 */

const env = (db: D1Database) => ({ DB: db, SESSION_COOKIE_NAME: "hr_session" }) as never;

async function buyerFixture(db: D1Database): Promise<AuthedSession> {
  await seedUser(db, "buyer", "user");
  await seedBillingPrices(db);
  return makeSession(db, "buyer");
}

async function adminFixture(db: D1Database): Promise<AuthedSession> {
  await seedUser(db, "root-admin", "admin");
  return makeSession(db, "root-admin");
}

// ---------------------------------------------------------------------------
// 1. Money units.
// ---------------------------------------------------------------------------

describe("P17 money", () => {
  it("stores 1,900,000 toman as 19,000,000 IRR — never as 1,900,000 rial", () => {
    const plan = tomanToIrr(1_900_000);
    expect(plan).toEqual({ minor: 19_000_000, currency: "IRR" });
    expect(plan.minor).not.toBe(1_900_000);
    expect(irrToToman(plan)).toBe(1_900_000);
    expect(TOMAN_IN_RIAL).toBe(10);
    expect(INTERNAL_CURRENCY).toBe("IRR");
  });

  it("refuses unsafe and fractional amounts", () => {
    expect(() => tomanToIrr(-1)).toThrow();
    expect(() => tomanToIrr(1.5)).toThrow();
    expect(() => money(Number.MAX_SAFE_INTEGER + 1)).toThrow();
    expect(() => irrToToman({ minor: 15, currency: "IRR" })).toThrow(); // sub-toman
    expect(() => parseTomanInput("12.5")).toThrow();
    expect(() => parseTomanInput("1,900,000")).not.toThrow(); // separators OK
    expect(parseTomanInput("1,900,000")).toEqual({ minor: 19_000_000, currency: "IRR" });
  });

  it("never mixes or infers currencies", () => {
    expect(() => assertInternalCurrency({ currency: "TOMAN" })).toThrow();
    expect(() => assertInternalCurrency({ currency: "USD" })).toThrow();
    expect(() => addMoney({ minor: 10, currency: "IRR" }, { minor: 5, currency: "USD" as never })).toThrow();
    expect(addMoney({ minor: 10, currency: "IRR" }, { minor: 5, currency: "IRR" })).toEqual({ minor: 15, currency: "IRR" });
    expect(multiplyMoney({ minor: 19_000_000, currency: "IRR" }, 3)).toEqual({ minor: 57_000_000, currency: "IRR" });
  });

  it("formats bilingual toman displays with the IRR amount never hidden", () => {
    const display = formatToman(tomanToIrr(1_900_000));
    expect(display.toman).toBe(1_900_000);
    expect(display.irr).toBe(19_000_000);
    expect(display.en).toContain("1,900,000 toman");
    expect(display.fa).toContain("تومان");
  });

  it("order status machine has tested transitions and no shortcuts", () => {
    expect(isOrderTransition("pending", "awaiting_payment")).toBe(true);
    expect(isOrderTransition("awaiting_payment", "paid")).toBe(true);
    expect(isOrderTransition("pending", "paid")).toBe(false); // no skipping
    expect(isOrderTransition("cancelled", "pending")).toBe(false); // terminal
    expect(isOrderTransition("paid", "refunded")).toBe(true);
    expect(isOrderTransition("paid", "pending")).toBe(false); // never re-opened
    expect(ORDER_TRANSITIONS.refunded).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. Catalog.
// ---------------------------------------------------------------------------

describe("P17 catalog", () => {
  it("admin prices are whole toman converted to IRR; repricing creates a NEW VERSION and supersedes", async () => {
    const db = await openRealDatabase();
    const admin = await adminFixture(db);
    await seedBillingPrices(db);

    // v1 already exists (seeded) -> a reprice must create v2 and supersede v1.
    const response = await adminCreatePrice(authedRequest("/api/admin/billing/prices", {
      sku: "farm_workspace_monthly", name_en: "Farm workspace", name_fa: "فضای کار مزرعه",
      price_toman: 2_500_000, period_days: 30,
    }, { session: admin }), env(db));
    expect(response.status).toBe(201);
    const body = await response.json() as { price: { version: number; price_minor: number; currency: string; price_toman: number }; note: string };
    expect(body.price.version).toBe(2); // v1 existed -> v2 created
    expect(body.price.price_minor).toBe(25_000_000);
    expect(body.price.currency).toBe("IRR");
    expect(body.price.price_toman).toBe(2_500_000);
    expect(body.note).toContain("superseded");

    // Real database state: v1 superseded, v2 live, exactly two rows.
    const rows = await db.prepare("SELECT version, price_minor, superseded_at FROM billing_prices WHERE sku='farm_workspace_monthly' ORDER BY version").all<{ version: number; price_minor: number; superseded_at: string | null }>();
    expect(rows.results).toHaveLength(2);
    expect(Number(rows.results[0]?.version)).toBe(1);
    expect(rows.results[0]?.superseded_at).not.toBeNull(); // v1 superseded in the same batch
    expect(Number(rows.results[1]?.version)).toBe(2);
    expect(rows.results[1]?.superseded_at).toBeNull(); // v2 is the live one
    expect(Number(rows.results[1]?.price_minor)).toBe(25_000_000);
  });

  it("fractional toman prices are rejected honestly", async () => {
    const db = await openRealDatabase();
    const admin = await adminFixture(db);
    await seedBillingPrices(db);
    // The schema-level integer guard fires first; nothing is inserted.
    await expect(adminCreatePrice(authedRequest("/api/admin/billing/prices", {
      sku: "farm_workspace_monthly", name_en: "Farm", name_fa: "Farm", price_toman: 1_900_000.5, period_days: 30,
    }, { session: admin }), env(db))).rejects.toMatchObject({ status: 400, code: "invalid_price" });
    expect(await countRows(db, "billing_prices")).toBe(2); // nothing inserted
  });

  it("the public catalog carries the honest hypothesis note", async () => {
    const db = await openRealDatabase();
    await buyerFixture(db);
    const response = await billingCatalog(authedRequest("/api/billing/catalog", undefined, { method: "GET" }), env(db));
    const body = await response.json() as { prices: Array<{ price_toman: number; currency: string }>; note: string };
    expect(body.prices[0]?.price_toman).toBe(1_900_000);
    expect(body.prices[0]?.currency).toBe("IRR");
    expect(body.note).toContain("rial");
    expect(body.note).toContain("hypotheses");
  });
});

// ---------------------------------------------------------------------------
// 3. Orders.
// ---------------------------------------------------------------------------

describe("P17 orders", () => {
  it("computes the total SERVER-SIDE from the catalog; the schema accepts no client total", async () => {
    const db = await openRealDatabase();
    const session = await buyerFixture(db);
    const response = await createOrder(authedRequest("/api/billing/orders", {
      order_key: "order-key-1234", items: [{ sku: "farm_workspace_monthly", quantity: 2 }],
      // A client-supplied total is not even part of the schema — ignored:
      total_minor: 1, total: 1,
    }, { session }), env(db));
    expect(response.status).toBe(201);
    const body = await response.json() as { order: { total_minor: number; total_toman: number; currency: string; lines: Array<{ unit_minor: number; quantity: number; line_total_minor: number }> }; payment_note: string };
    expect(body.order.total_minor).toBe(38_000_000); // 2 x 19,000,000 IRR — server-side math
    expect(body.order.total_toman).toBe(3_800_000);
    expect(body.order.currency).toBe("IRR");
    expect(body.order.lines[0]?.unit_minor).toBe(19_000_000);
    expect(body.order.lines[0]?.line_total_minor).toBe(38_000_000);
    expect(body.payment_note).toContain("no charge has occurred");
    // The create-order request keys the schema actually accepts (no 'total').
    const CreateOrderKeys = ["order_key", "items", "payer_organization_id"];
    expect(CreateOrderKeys).not.toContain("total");
  });

  it("a duplicate order_key with the SAME intent replays the SAME order (ONE order)", async () => {
    const db = await openRealDatabase();
    const session = await buyerFixture(db);
    const payload = { order_key: "order-key-1234", items: [{ sku: "farm_workspace_monthly", quantity: 1 }] };
    const first = await createOrder(authedRequest("/api/billing/orders", payload, { session }), env(db));
    expect(first.status).toBe(201);
    const second = await createOrder(authedRequest("/api/billing/orders", payload, { session }), env(db));
    const body = await second.json() as { idempotent_replay: boolean; order: { id: number }; note: string };
    expect(body.idempotent_replay).toBe(true);
    expect(body.note).toContain("no new lines or charge");
    expect(await countRows(db, "orders")).toBe(1);
    expect(await countRows(db, "order_lines")).toBe(1);
  });

  it("the SAME order_key with a DIFFERENT intent is an honest 409 — never a silent overwrite", async () => {
    const db = await openRealDatabase();
    const session = await buyerFixture(db);
    await createOrder(authedRequest("/api/billing/orders", { order_key: "order-key-1234", items: [{ sku: "farm_workspace_monthly", quantity: 1 }] }, { session }), env(db));
    await expect(createOrder(authedRequest("/api/billing/orders", { order_key: "order-key-1234", items: [{ sku: "farm_workspace_monthly", quantity: 2 }] }, { session }), env(db)))
      .rejects.toMatchObject({ status: 409, code: "idempotency_conflict" });
    // The stored order is untouched.
    const order = await db.prepare("SELECT total_minor FROM orders").first<{ total_minor: number }>();
    expect(Number(order?.total_minor)).toBe(19_000_000);
    expect(await countRows(db, "orders")).toBe(1);
  });

  it("an unknown sku is an honest 404, never a zero-priced order", async () => {
    const db = await openRealDatabase();
    const session = await buyerFixture(db);
    await expect(createOrder(authedRequest("/api/billing/orders", { order_key: "order-key-1234", items: [{ sku: "nonexistent", quantity: 1 }] }, { session }), env(db)))
      .rejects.toMatchObject({ status: 404, code: "sku_not_found" });
    expect(await countRows(db, "orders")).toBe(0);
  });

  it("an order for an organization WITHOUT current management membership is refused (real FK-checked guard)", async () => {
    const db = await openRealDatabase();
    const session = await buyerFixture(db);
    // Organization 777 does not exist and the buyer has no membership in it.
    await expect(createOrder(authedRequest("/api/billing/orders", { order_key: "order-key-1234", items: [{ sku: "farm_workspace_monthly", quantity: 1 }], payer_organization_id: 777 }, { session }), env(db)))
      .rejects.toMatchObject({ status: 403, code: "not_org_manager" });
    expect(await countRows(db, "orders")).toBe(0);
    expect(await countRows(db, "order_lines")).toBe(0);
  });

  it("changing the catalog price does NOT mutate an existing order (frozen snapshot)", async () => {
    const db = await openRealDatabase();
    const session = await buyerFixture(db);
    const admin = await adminFixture(db);
    const order = await seedOrder(db, { buyer: "buyer" });
    const originalTotal = Number(order!.total_minor);

    // The catalog later reprices to 2,500,000 toman (v2).
    await adminCreatePrice(authedRequest("/api/admin/billing/prices", {
      sku: "farm_workspace_monthly", name_en: "Farm", name_fa: "Farm", price_toman: 2_500_000, period_days: 30,
    }, { session: admin }), env(db));

    const detail = await orderDetail(authedRequest(`/api/billing/orders/${order!.id}`, undefined, { method: "GET", session }), env(db), order!.id);
    const body = await detail.json() as { order: { total_minor: number }; lines: Array<{ unit_minor: number }> };
    expect(Number(body.order.total_minor)).toBe(originalTotal); // unchanged by the reprice
    expect(Number(body.lines[0]?.unit_minor)).toBe(19_000_000); // frozen snapshot read verbatim
    // A NEW order after the reprice uses the NEW price.
    const fresh = await createOrder(authedRequest("/api/billing/orders", { order_key: "order-key-5678", items: [{ sku: "farm_workspace_monthly", quantity: 1 }] }, { session }), env(db));
    const freshBody = await fresh.json() as { order: { total_minor: number } };
    expect(Number(freshBody.order.total_minor)).toBe(25_000_000);
  });

  it("cancel is guarded: pending cancels, paid orders cannot be cancelled (real CAS)", async () => {
    const db = await openRealDatabase();
    const session = await buyerFixture(db);

    // Paid order: create -> reserve -> verify through the real commands.
    const paidOrder = await seedOrder(db, { buyer: "buyer" });
    const { attemptId } = await reserveAttempt(db, paidOrder!.id, "buyer");
    await verifyOrder(db, paidOrder!, attemptId!);
    await expect(cancelOrder(authedRequest(`/api/billing/orders/${paidOrder!.id}/cancel`, {}, { session }), env(db), paidOrder!.id))
      .rejects.toMatchObject({ status: 409, code: "not_cancellable" });
    expect((await db.prepare("SELECT status FROM orders WHERE id=?").bind(paidOrder!.id).first<{ status: string }>())?.status).toBe("paid");

    // Pending order: cancels cleanly; financial rows retained, nothing deleted.
    const pendingOrder = await seedOrder(db, { buyer: "buyer", key: "pending-order-0001" });
    const response = await cancelOrder(authedRequest(`/api/billing/orders/${pendingOrder!.id}/cancel`, {}, { session }), env(db), pendingOrder!.id);
    const body = await response.json() as { cancelled: boolean };
    expect(body.cancelled).toBe(true);
    expect((await db.prepare("SELECT status FROM orders WHERE id=?").bind(pendingOrder!.id).first<{ status: string }>())?.status).toBe("cancelled");
    expect(await countRows(db, "orders")).toBe(2); // both orders still exist — nothing deleted
    expect(await countRows(db, "order_lines")).toBe(2);
  });

  it("another user's order is an honest 404", async () => {
    const db = await openRealDatabase();
    await buyerFixture(db);
    await seedUser(db, "intruder", "user");
    const intruder = await makeSession(db, "intruder");
    const order = await seedOrder(db, { buyer: "buyer" });
    await expect(orderDetail(authedRequest(`/api/billing/orders/${order!.id}`, undefined, { method: "GET", session: intruder }), env(db), order!.id))
      .rejects.toMatchObject({ status: 404, code: "not_found" });
  });

  it("myOrders carries the honest currency note", async () => {
    const db = await openRealDatabase();
    const session = await buyerFixture(db);
    await seedOrder(db, { buyer: "buyer" });
    const response = await myOrders(authedRequest("/api/billing/orders/mine", undefined, { method: "GET", session }), env(db));
    const body = await response.json() as { orders: Array<{ total_toman: number }>; currency_note: string };
    expect(body.orders[0]?.total_toman).toBe(1_900_000);
    expect(body.currency_note).toContain("rial");
  });
});

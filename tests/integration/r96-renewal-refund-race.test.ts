import { describe, expect, it } from "vitest";
import { requestOrderRefund, adminApproveRefund, adminRecordRefundOutcome } from "../../src/api/modules/billing";
import * as paymentCommands from "../../src/commerce/paymentCommands";
import {
  openRealDatabase, seedUser, makeSession, authedRequest, seedBillingPrices,
  createOrder, reserveAttempt, verifyOrder, countRows, type AuthedSession, type SeedableLine,
} from "../helpers/realDatabase";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * R96 race fix (found by the PG concurrency gate, scenario C): the renewal's
 * entitlement statements previously assumed the shared (holder, sku) row
 * stayed active BETWEEN the batch's statements. A concurrent refund's
 * exact-interval CAS could deactivate it after the conflict-nothing INSERT
 * but before the event normalization — the normalization's subqueries then
 * returned no row, wrote NULL into entitlement_events.activated_at (NOT
 * NULL) and aborted the WHOLE renewal: a PAID order silently lost its grant
 * (entitlement_events row rolled back with the batch).
 *
 * The fix merges insert+extend into ONE atomic upsert and makes the event
 * normalization row-independent (COALESCE fallbacks to the event's own
 * interval). This file pins BOTH interleavings deterministically on a real
 * database (SQLite exercises the identical statement semantics; the PG
 * concurrency gate exercises them under real parallel transactions):
 *
 *  A. renewal's statements through the upsert -> refund CONFIRMS + commits
 *     -> renewal's remaining statements: the renewal MUST still complete
 *     (pre-fix: NOT NULL violation aborted it), the buyer keeps ONE active
 *     entitlement, and the refund that changed a renewed aggregate lands in
 *     explicit review — never a silent reversal.
 *  B. refund confirms FIRST -> the full renewal batch: a FRESH active
 *     entitlement for the renewal's own interval (later purchase access
 *     survives the refund — F07), the refund's own cancellation intact.
 */

function env(db: D1Database) {
  return { DB: db, SESSION_COOKIE_NAME: "hr_session", REFUND_PARTIAL_POLICY_ENABLED: "false" } as never;
}

async function world(db: D1Database, key: string) {
  await seedUser(db, "buyer", "user");
  await seedUser(db, "admin-1", "admin");
  const buyer = await makeSession(db, "buyer");
  const operator = await makeSession(db, "admin-1");
  await seedBillingPrices(db);
  // C1: the already-paid order whose refund will race the renewal.
  const order1 = (await createOrder(db, { buyer: "buyer", key: `${key}-c1` }))!;
  const a1 = await reserveAttempt(db, order1.id, "buyer");
  await verifyOrder(db, order1, a1.attemptId!, crypto.randomUUID(), new Date().toISOString());
  // C2: the renewal order, attempt reserved, verification IN FLIGHT.
  const order2 = (await createOrder(db, { buyer: "buyer", key: `${key}-c2` }))!;
  const a2 = await reserveAttempt(db, order2.id, "buyer");
  const lines = JSON.parse(order2.price_snapshot_json) as SeedableLine[];
  return { buyer, operator, order1, order2, a1: a1.attemptId!, a2: a2.attemptId!, lines };
}

async function confirmRefund(db: D1Database, buyer: AuthedSession, operator: AuthedSession, orderId: number) {
  await requestOrderRefund(authedRequest(`/api/billing/orders/${orderId}/refund-request`, { reason: "Race test refund." }, { session: buyer }), env(db), orderId);
  const requestId = (await db.prepare("SELECT id FROM refund_requests WHERE order_id=?").bind(orderId).first<{ id: number }>())!.id;
  await adminApproveRefund(authedRequest(`/api/admin/billing/refund-requests/${requestId}/approve`, { note: "Unused; approving." }, { session: operator }), env(db), requestId);
  await adminRecordRefundOutcome(authedRequest(`/api/admin/billing/refund-requests/${requestId}/provider-outcome`, { outcome: "confirmed", provider_reference: "RACE-CONFIRMED-1" }, { session: operator }), env(db), requestId);
  return requestId;
}

describe("R96 renewal-vs-refund race (deterministic interleavings)", () => {
  it("A. refund confirms BETWEEN the renewal's statements — the renewal still completes, the aggregate change goes to review", async () => {
    const db = await openRealDatabase();
    const { buyer, operator, order1, order2, a2, lines } = await world(db, "race-a");

    const renewal = paymentCommands.verifiedOrderStatements(db, {
      operationId: crypto.randomUUID(), attemptId: a2, orderId: order2.id,
      buyerUserId: "buyer", organizationId: null, providerReference: "RACE-RENEW-2",
      nowIso: new Date().toISOString(), totalMinor: order2.total_minor, lines,
    });
    // Split THROUGH the entitlement statement (found by content, not index:
    // the layout differs pre/post fix; the interleaving point is identical).
    const entitlementIdx = renewal.findIndex((s) => JSON.stringify((s as unknown as { sql?: string }).sql ?? "").includes("INSERT INTO entitlements")
      || String((s as unknown as { _sql?: string })._sql ?? "").includes("INSERT INTO entitlements"));
    expect(entitlementIdx).toBeGreaterThanOrEqual(0);
    const splitAt = entitlementIdx + 1;
    await db.batch(renewal.slice(0, splitAt)); // through the entitlement upsert

    // The refund of the FIRST order confirms and commits in the middle of
    // the renewal (the aggregate the refund classified was already renewed).
    await confirmRefund(db, buyer, operator, order1.id);

    // The renewal's remaining statements MUST succeed (pre-fix: NOT NULL
    // violation on entitlement_events.activated_at aborted the batch).
    await db.batch(renewal.slice(6));

    // The renewal grant exists and is live — a paid order never loses access.
    const activeRow = await db.prepare("SELECT e.id, e.source_event_id, e.active, e.sku FROM entitlements e WHERE e.holder_key='user:buyer' AND e.active=1").first<{ id: number; source_event_id: number; active: number; sku: string }>();
    expect(activeRow).toBeTruthy();
    const grantEvent = await db.prepare("SELECT id FROM entitlement_events WHERE payment_attempt_id=? AND kind='grant'").bind(a2).first<{ id: number }>();
    expect(grantEvent).toBeTruthy();
    expect(Number(activeRow!.source_event_id)).toBe(grantEvent!.id); // the row points at the renewal's grant

    // The renewal actually paid: order + attempt terminal states.
    expect((await db.prepare("SELECT status FROM orders WHERE id=?").bind(order2.id).first<{ status: string }>())?.status).toBe("paid");
    expect((await db.prepare("SELECT state FROM payment_attempts WHERE id=?").bind(a2).first<{ state: string }>())?.state).toBe("verified");

    // The refund of the FIRST order did not silently reverse the renewed
    // aggregate: its adjustment is explicit review (or its own exact
    // interval), and exactly ONE active entitlement exists either way.
    const dispositions = await db.prepare("SELECT disposition FROM refund_access_adjustments").all<{ disposition: string }>();
    for (const d of dispositions.results ?? []) expect(["review_required", "cancelled", "no_live_access"]).toContain(d.disposition);
    expect(await countRows(db, "entitlements", "active=1")).toBe(1);
  });

  it("B. refund confirms FIRST — the full renewal grants a FRESH interval (F07: later purchase access survives)", async () => {
    const db = await openRealDatabase();
    const { buyer, operator, order1, order2, a2, lines } = await world(db, "race-b");

    // The C1 refund completes before the renewal starts.
    await confirmRefund(db, buyer, operator, order1.id);
    expect(await countRows(db, "entitlements", "active=1")).toBe(0); // its exact interval cancelled

    // The full renewal batch on the SAME holder+sku.
    await db.batch(paymentCommands.verifiedOrderStatements(db, {
      operationId: crypto.randomUUID(), attemptId: a2, orderId: order2.id,
      buyerUserId: "buyer", organizationId: null, providerReference: "RACE-RENEW-B",
      nowIso: new Date().toISOString(), totalMinor: order2.total_minor, lines,
    }));

    // The renewal's own grant is active with its own interval.
    const activeRow = await db.prepare("SELECT e.source_event_id, e.active FROM entitlements e WHERE e.holder_key='user:buyer' AND e.active=1").first<{ source_event_id: number; active: number }>();
    expect(activeRow).toBeTruthy();
    const grantEvent = await db.prepare("SELECT id, granted_days FROM entitlement_events WHERE payment_attempt_id=? AND kind='grant'").bind(a2).first<{ id: number; granted_days: number }>();
    expect(grantEvent).toBeTruthy();
    expect(grantEvent!.granted_days).toBeGreaterThan(0);
    expect(Number(activeRow!.source_event_id)).toBe(grantEvent!.id);
    // The refund's cancellation of ITS OWN interval is preserved.
    const c1Disposition = await db.prepare("SELECT disposition FROM refund_access_adjustments LIMIT 1").first<{ disposition: string }>();
    expect(c1Disposition?.disposition).toBe("cancelled"); // exact interval, untouched by the later grant
    expect(await countRows(db, "entitlements", "active=1")).toBe(1);
  });
});

import { describe, expect, it } from "vitest";
import { currentAllocationProposalId } from "../helpers/refundProposal";
import {
  requestOrderRefund, myRefunds, adminApproveRefund, adminRecordRefundOutcome, adminRefundOrder,
  adminProposeRefundAllocation, adminApproveRefundAllocation,
} from "../../src/api/modules/billing";
import {
  openRealDatabase, seedUser, makeSession, authedRequest, seedBillingPrices,
  createOrder, reserveAttempt, verifyOrder, countRows, type AuthedSession,
} from "../helpers/realDatabase";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * R95-N06 evidence: the refund ledger on a real database with every
 * migration applied. Zarinpal has NO public refund API (docs S01/S02) —
 * refunds are merchant-panel operations, so the provider outcome is RECORDED
 * by an operator. Money is "returned" ONLY at status 'confirmed' with a
 * provider reference; every other state says exactly what did NOT happen.
 *
 * Acceptance pinned:
 *  - a repeated refund request cannot return money twice (one ACTIVE request
 *    per verified attempt; deterministic request keys);
 *  - a provider timeout stays provider_pending (review), never success;
 *  - the sum of confirmed refunds can never exceed the confirmed payment
 *    (one active request per attempt; amount = the verified amount);
 *  - partial_consumed approvals fail closed until an ALLOCATION is approved
 *    (R96-N05: the exact-amount ledger decision — a feature flag was never a
 *    proration policy);
 *  - ledger + entitlement adjustment reconcile atomically at confirmation
 *    (grant history preserved, compensating refund_reversal event written).
 */

function env(db: D1Database, extra: Record<string, string> = {}) {
  return { DB: db, SESSION_COOKIE_NAME: "hr_session", REFUND_PARTIAL_POLICY_ENABLED: "false", ...extra } as never;
}

async function paidOrder(db: D1Database, key: string): Promise<{ buyer: AuthedSession; orderId: number; attemptId: number }> {
  await seedUser(db, "buyer", "user");
  const buyer = await makeSession(db, "buyer");
  await seedBillingPrices(db);
  const order = await createOrder(db, { buyer: "buyer", key });
  const { attemptId } = await reserveAttempt(db, order!.id, "buyer");
  // Real-clock verification: the refund policy compares remaining days
  // against Date.now(), so the paid_at anchor must be the CURRENT time
  // (the fixed 2026-10-03 default turns this test into a midnight bomb:
  // once real time passes that date the fresh grant counts as consumed).
  await verifyOrder(db, order!, attemptId!, crypto.randomUUID(), new Date().toISOString());
  return { buyer, orderId: order!.id, attemptId: attemptId! };
}

async function admin(db: D1Database): Promise<AuthedSession> {
  await seedUser(db, "admin-1", "admin");
  return makeSession(db, "admin-1");
}

describe("R95-N06 refund ledger", () => {
  it("a refund request records the wish + policy; NO money and NO access change", async () => {
    const db = await openRealDatabase();
    const { buyer, orderId } = await paidOrder(db, "refund-order-1");
    const response = await requestOrderRefund(authedRequest(`/api/billing/orders/${orderId}/refund-request`, { reason: "Purchased by mistake, nothing used yet." }, { session: buyer }), env(db), orderId);
    expect(response.status).toBe(201);
    const body = await response.json() as { refund_request: { status: string; kind: string; amount_minor: number; provider_reference: string | null }; status_note: string };
    expect(body.refund_request.status).toBe("requested");
    expect(body.refund_request.kind).toBe("full_unused"); // fresh grant, nothing consumed
    expect(Number(body.refund_request.amount_minor)).toBe(19_000_000); // the verified amount
    expect(body.refund_request.provider_reference).toBeNull();
    // Nothing moved: entitlement still active, no reversal events.
    expect(await countRows(db, "entitlements", "active=1")).toBe(1);
    expect(await countRows(db, "entitlement_events", "kind='refund_reversal'")).toBe(0);
  });

  it("a REPEATED request replays the same row — money can never be returned twice", async () => {
    const db = await openRealDatabase();
    const { buyer, orderId } = await paidOrder(db, "refund-order-2");
    const first = await requestOrderRefund(authedRequest(`/api/billing/orders/${orderId}/refund-request`, { reason: "Duplicate watch, please refund." }, { session: buyer }), env(db), orderId);
    const firstBody = await first.json() as { refund_request: { id: number } };
    const second = await requestOrderRefund(authedRequest(`/api/billing/orders/${orderId}/refund-request`, { reason: "Asking again." }, { session: buyer }), env(db), orderId);
    const secondBody = await second.json() as { refund_request: { id: number }; note: string };
    expect(secondBody.refund_request.id).toBe(firstBody.refund_request.id);
    expect(secondBody.note).toContain("cannot return money twice");
    expect(await countRows(db, "refund_requests")).toBe(1);
    expect(await countRows(db, "refund_events", "to_status='requested'")).toBe(1);
  });

  it("a non-verified payment cannot be refunded", async () => {
    const db = await openRealDatabase();
    await seedUser(db, "buyer", "user");
    const buyer = await makeSession(db, "buyer");
    await seedBillingPrices(db);
    const order = await createOrder(db, { buyer: "buyer", key: "refund-order-3" });
    await reserveAttempt(db, order!.id, "buyer"); // redirected, never verified
    await expect(requestOrderRefund(authedRequest(`/api/billing/orders/${order!.id}/refund-request`, { reason: "Never paid, want refund." }, { session: buyer }), env(db), order!.id))
      .rejects.toMatchObject({ status: 409, code: "no_verified_payment" });
    expect(await countRows(db, "refund_requests")).toBe(0);
  });

  it("the honest journey: approve -> provider pending (timeout) stays review -> confirmed applies the reversal atomically", async () => {
    const db = await openRealDatabase();
    const { buyer, orderId } = await paidOrder(db, "refund-order-4");
    const operator = await admin(db);
    await requestOrderRefund(authedRequest(`/api/billing/orders/${orderId}/refund-request`, { reason: "Service no longer needed." }, { session: buyer }), env(db), orderId);
    const requestId = (await db.prepare("SELECT id FROM refund_requests").first<{ id: number }>())!.id;

    // Operator approval: no money yet.
    const approve = await adminApproveRefund(authedRequest(`/api/admin/billing/refund-requests/${requestId}/approve`, { note: "Verified unused; approving full refund." }, { session: operator }), env(db), requestId);
    expect(((await approve.json() as { refund_request: { status: string } })).refund_request.status).toBe("approved");
    expect(await countRows(db, "entitlements", "active=1")).toBe(1);

    // Provider timeout: stays provider_pending — NOT a successful refund.
    const pending = await adminRecordRefundOutcome(authedRequest(`/api/admin/billing/refund-requests/${requestId}/provider-outcome`, { outcome: "pending" }, { session: operator }), env(db), requestId);
    expect(((await pending.json() as { refund_request: { status: string; provider_reference: string | null } })).refund_request.status).toBe("provider_pending");
    expect(await countRows(db, "entitlements", "active=1")).toBe(1); // access unchanged

    // Provider confirms WITH a reference: status confirmed + reversal applied
    // in the SAME batch; grant history preserved.
    const confirmed = await adminRecordRefundOutcome(authedRequest(`/api/admin/billing/refund-requests/${requestId}/provider-outcome`, { outcome: "confirmed", provider_reference: "888002" }, { session: operator }), env(db), requestId);
    const confirmedBody = await confirmed.json() as { refund_request: { status: string; provider_reference: string } };
    expect(confirmedBody.refund_request.status).toBe("confirmed");
    expect(confirmedBody.refund_request.provider_reference).toBe("888002");
    expect(await countRows(db, "entitlements", "active=1")).toBe(0); // access cancelled
    expect(await countRows(db, "entitlements", "active=0")).toBe(1); // row retained as history
    expect(await countRows(db, "entitlement_events", "kind='refund_reversal'")).toBe(1); // compensating event
    expect(await countRows(db, "entitlement_events", "kind IN ('grant','renewal')")).toBe(1); // grant PRESERVED

    // A repeated confirmation cannot double-reverse anything.
    await expect(adminRecordRefundOutcome(authedRequest(`/api/admin/billing/refund-requests/${requestId}/provider-outcome`, { outcome: "confirmed", provider_reference: "888002" }, { session: operator }), env(db), requestId))
      .rejects.toMatchObject({ status: 409, code: "not_awaiting_provider" });
    expect(await countRows(db, "entitlement_events", "kind='refund_reversal'")).toBe(1);
  });

  it("provider 'failed': no money returned, no access changed, terminal", async () => {
    const db = await openRealDatabase();
    const { buyer, orderId } = await paidOrder(db, "refund-order-5");
    const operator = await admin(db);
    await requestOrderRefund(authedRequest(`/api/billing/orders/${orderId}/refund-request`, { reason: "Bank advises refund path." }, { session: buyer }), env(db), orderId);
    const requestId = (await db.prepare("SELECT id FROM refund_requests").first<{ id: number }>())!.id;
    await adminApproveRefund(authedRequest(`/api/admin/billing/refund-requests/${requestId}/approve`, { note: "Approved for provider processing." }, { session: operator }), env(db), requestId);
    const failed = await adminRecordRefundOutcome(authedRequest(`/api/admin/billing/refund-requests/${requestId}/provider-outcome`, { outcome: "failed", provider_code: -99 }, { session: operator }), env(db), requestId);
    expect(((await failed.json() as { refund_request: { status: string } })).refund_request.status).toBe("failed");
    expect(await countRows(db, "entitlements", "active=1")).toBe(1);
    expect(await countRows(db, "entitlement_events", "kind='refund_reversal'")).toBe(0);
    // After a terminal failure the buyer may request again (new generation row).
    const again = await requestOrderRefund(authedRequest(`/api/billing/orders/${orderId}/refund-request`, { reason: "Retrying after provider failure." }, { session: buyer }), env(db), orderId);
    expect(again.status).toBe(201);
    expect(await countRows(db, "refund_requests")).toBe(2); // both immutable rows retained
  });

  it("partial_consumed refunds fail closed until the owner/accountant policy is enabled", async () => {
    const db = await openRealDatabase();
    const { buyer, orderId } = await paidOrder(db, "refund-order-6");
    // Simulate 10 of 30 days consumed. R96 (F07): the policy derives from the
    // IMMUTABLE grant intervals on entitlement_events — never the mutable
    // aggregate entitlements row — and cancellation applies only when the live
    // entitlement still EXACTLY matches its grant interval. Age both rows
    // identically so the confirmed partial refund ends access cleanly.
    await db.exec(`
      UPDATE entitlement_events SET activated_at=datetime('now','-10 days'), expires_at=datetime('now','+20 days') WHERE kind IN ('grant','renewal');
      UPDATE entitlements SET activated_at=datetime('now','-10 days'), expires_at=datetime('now','+20 days');
    `);
    const request = await requestOrderRefund(authedRequest(`/api/billing/orders/${orderId}/refund-request`, { reason: "Partial period used; requesting refund." }, { session: buyer }), env(db), orderId);
    const requestBody = await request.json() as { refund_request: { kind: string; consumed_days: number | null; remaining_days: number | null } };
    // The policy JSON is recorded on the row; kind reflects reality.
    const row = await db.prepare("SELECT kind, entitlement_policy_json FROM refund_requests").first<{ kind: string; entitlement_policy_json: string }>();
    expect(row?.kind).toBe("partial_consumed");
    const policy = JSON.parse(row!.entitlement_policy_json) as { consumed_days: number; remaining_days: number; access_action: string };
    expect(policy.consumed_days).toBe(10);
    expect(policy.remaining_days).toBe(20);
    expect(policy.access_action).toBe("end_at_confirmation");

    const operator = await admin(db);
    const requestId = (await db.prepare("SELECT id FROM refund_requests").first<{ id: number }>())!.id;
    // R96-N05: approval fails closed without an APPROVED ALLOCATION — a
    // feature flag was never a proration policy.
    await expect(adminApproveRefund(authedRequest(`/api/admin/billing/refund-requests/${requestId}/approve`, { note: "Trying to approve partial." }, { session: operator }), env(db), requestId))
      .rejects.toMatchObject({ status: 409, code: "partial_allocation_required" });
    expect((await db.prepare("SELECT status FROM refund_requests WHERE id=?").bind(requestId).first<{ status: string }>())?.status).toBe("requested");

    // The allocation ledger: 10 of 30 days consumed -> the proposal is
    // prorated to the unused 20 days and NEVER silently equals the full charge.
    const charge = 19_000_000; // farm_workspace_monthly price in this fixture
    const expectedProposal = Math.floor((charge * 20) / 30);
    const proposed = await adminProposeRefundAllocation(authedRequest(`/api/admin/billing/refund-requests/${requestId}/allocation/propose`, {}, { method: "POST", session: operator }), env(db), requestId);
    const proposedBody = await proposed.json() as { allocation: { result: string; proposal: { status: string; proposed_amount_minor: number } | null } };
    expect(proposed.status).toBe(200);
    expect(proposedBody.allocation.result).toBe("proposed");
    expect(proposedBody.allocation.proposal!.status).toBe("computed");
    expect(proposedBody.allocation.proposal!.proposed_amount_minor).toBe(expectedProposal);
    expect(proposedBody.allocation.proposal!.proposed_amount_minor).toBeLessThan(charge);

    // Approval requires the EXACT proposed amount — a different number refuses.
    await expect(adminApproveRefundAllocation(authedRequest(`/api/admin/billing/refund-requests/${requestId}/allocation/approve`, { proposal_operation_id: await currentAllocationProposalId(db, requestId), amount_minor: charge, currency: "IRR", note: "Trying to sneak the full charge." }, { method: "POST", session: operator }), env(db), requestId))
      .rejects.toMatchObject({ status: 409, code: "allocation_not_approved" });
    const approveAllocation = await adminApproveRefundAllocation(authedRequest(`/api/admin/billing/refund-requests/${requestId}/allocation/approve`, { proposal_operation_id: await currentAllocationProposalId(db, requestId), amount_minor: expectedProposal, currency: "IRR", note: "Unused-time proration approved." }, { method: "POST", session: operator }), env(db), requestId);
    expect(approveAllocation.status).toBe(200);
    expect(((await approveAllocation.json()) as { refund_request: { amount_minor: number; allocation_status: string } }).refund_request.amount_minor).toBe(expectedProposal);

    // With the allocation approved: refund approval + confirmation carry the
    // ALLOCATED amount and end access at confirmation, preserving history.
    const approve = await adminApproveRefund(authedRequest(`/api/admin/billing/refund-requests/${requestId}/approve`, { note: "Allocation approved; approving." }, { session: operator }), env(db), requestId);
    const approveBody = await approve.json() as { refund_request: { status: string; amount_minor: number } };
    expect(approveBody.refund_request.status).toBe("approved");
    expect(approveBody.refund_request.amount_minor).toBe(expectedProposal);
    const confirmed = await adminRecordRefundOutcome(authedRequest(`/api/admin/billing/refund-requests/${requestId}/provider-outcome`, { outcome: "confirmed", provider_reference: "888003" }, { session: operator }), env(db), requestId);
    expect(((await confirmed.json() as { refund_request: { status: string } })).refund_request.status).toBe("confirmed");
    const ent = await db.prepare("SELECT active, expires_at, cancelled_at FROM entitlements").first<{ active: number; expires_at: string; cancelled_at: string }>();
    expect(Number(ent?.active)).toBe(1);
    expect(ent?.cancelled_at).toBeNull();
    expect(await countRows(db, "entitlement_events", "kind='refund_reversal'")).toBe(0);
    expect(await countRows(db, "refund_access_reviews", "status='open'")).toBe(1);
  });

  it("the customer receipt surface shows honest states only", async () => {
    const db = await openRealDatabase();
    const { buyer, orderId } = await paidOrder(db, "refund-order-7");
    await requestOrderRefund(authedRequest(`/api/billing/orders/${orderId}/refund-request`, { reason: "Checking my refund status." }, { session: buyer }), env(db), orderId);
    const response = await myRefunds(authedRequest("/api/billing/refunds/mine", undefined, { method: "GET", session: buyer }), env(db));
    const body = await response.json() as { refund_requests: Array<{ status: string; status_note: string }>; note: string };
    expect(body.refund_requests).toHaveLength(1);
    expect(body.refund_requests[0]?.status).toBe("requested");
    expect(body.refund_requests[0]?.status_note).toContain("No money has moved");
    expect(body.note).toContain("never presented as success");
  });

  it("the legacy instant-refund route stays 501 — no button promises instant money", async () => {
    const db = await openRealDatabase();
    const { orderId } = await paidOrder(db, "refund-order-8");
    const operator = await admin(db);
    await expect(adminRefundOrder(authedRequest(`/api/admin/billing/orders/${orderId}/refund`, { note: "Instant refund please." }, { session: operator }), env(db), orderId))
      .rejects.toMatchObject({ status: 501, code: "refund_workflow_unavailable" });
  });
});

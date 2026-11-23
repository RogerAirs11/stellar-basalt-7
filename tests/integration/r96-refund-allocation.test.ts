import { describe, expect, it } from "vitest";
import { currentAllocationProposalId } from "../helpers/refundProposal";
import {
  adminApproveRefund, adminRecordRefundOutcome, adminProposeRefundAllocation, adminApproveRefundAllocation,
  adminRefundReviewDetail, adminResolveRefundReview, requestOrderRefund,
} from "../../src/api/modules/billing";
import {
  computeRefundAllocation, CONSERVATIVE_ALLOCATION_POLICY_V1, resolveRefundAccessReviewStatements,
  type AllocationGrantInterval, type AllocationPolicy,
} from "../../src/commerce/refundAllocation";
import {
  openRealDatabase, seedUser, seedBillingPrices, createOrder, reserveAttempt, verifyOrder, countRows, authedRequest, type AuthedSession,
} from "../helpers/realDatabase";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * R96-N05 acceptance — the precise refund/access allocation ledger.
 *
 *  A. Pure proposal computation: a partially consumed service NEVER silently
 *     refunds the full charge; unknown legacy intervals invent no amount; a
 *     full-refund-despite-consumption policy is an EXPLICIT owner field.
 *  B. The ledger flow: exact-amount approval (re-stating the proposed number),
 *     the refund request carries the ALLOCATED amount, and totals never
 *     exceed the verified receipt.
 *  C. Review resolution: grant-specific VERSIONED decisions; later renewals
 *     and combined balances are never cancelled wholesale; history is
 *     immutable; re-resolution refuses until an owner re-opens.
 */

const CHARGE = 19_000_000; // farm_workspace_monthly in the fixture
const env = (db: D1Database) => ({ DB: db, SESSION_COOKIE_NAME: "hr_session" }) as never;

async function operatorSession(db: D1Database): Promise<AuthedSession> {
  return (await import("../helpers/realDatabase")).makeSession(db, "owner-1");
}

async function paidWorld(db: D1Database, key: string, buyer = "buyer-1") {
  await seedUser(db, buyer, "user");
  await seedUser(db, "owner-1", "admin");
  await seedBillingPrices(db);
  const order = (await createOrder(db, { buyer, key }))!;
  const { attemptId } = await reserveAttempt(db, order.id, buyer);
  await verifyOrder(db, order, attemptId as number, crypto.randomUUID(), new Date().toISOString());
  return { order, attemptId };
}

function grantRow(id: number, grantedDays: number, activatedAt: string | null, expiresAt: string | null): AllocationGrantInterval {
  return { grant_event_id: id, sku: "farm_workspace_monthly", granted_days: grantedDays, activated_at: activatedAt, expires_at: expiresAt };
}

const NOW = "2026-10-05T12:00:00.000Z";

// ---------------------------------------------------------------------------
// A. Pure proposal computation
// ---------------------------------------------------------------------------

describe("N05 A. proposal computation — never silently the full charge", () => {
  const policy = CONSERVATIVE_ALLOCATION_POLICY_V1;

  it("full_unused proposes the full charge", () => {
    const outcome = computeRefundAllocation({ amount_minor: CHARGE, currency: "IRR" },
      [grantRow(1, 30, "2026-11-01T00:00:00.000Z", "2026-12-01T00:00:00.000Z")], policy, NOW);
    expect(outcome.status).toBe("computed");
    if (outcome.status === "computed") {
      expect(outcome.proposed_amount_minor).toBe(CHARGE);
      expect(outcome.basis.proration).toBe("none");
    }
  });

  it("10 of 30 days consumed proposes prorated unused time, strictly below the charge", () => {
    const outcome = computeRefundAllocation({ amount_minor: CHARGE, currency: "IRR" },
      [grantRow(1, 30, "2026-09-25T00:00:00.000Z", "2026-10-25T00:00:00.000Z")], policy, NOW);
    expect(outcome.status).toBe("computed");
    if (outcome.status === "computed") {
      expect(outcome.proposed_amount_minor).toBe(Math.floor((CHARGE * 20) / 30));
      expect(outcome.proposed_amount_minor).toBeLessThan(CHARGE);
      expect(outcome.basis.consumed_days).toBe(10);
      expect(outcome.basis.proration).toBe("unused_time");
    }
  });

  it("the FULL amount despite consumption exists ONLY as an explicit owner policy field", () => {
    const explicit: AllocationPolicy = { ...policy, full_refund_despite_consumption: true };
    const outcome = computeRefundAllocation({ amount_minor: CHARGE, currency: "IRR" },
      [grantRow(1, 30, "2026-09-25T00:00:00.000Z", "2026-10-25T00:00:00.000Z")], explicit, NOW);
    expect(outcome.status).toBe("computed");
    if (outcome.status === "computed") {
      expect(outcome.proposed_amount_minor).toBe(CHARGE);
      expect(outcome.basis.proration).toBe("policy_full");
    }
    // The default policy NEVER does this.
    const conservative = computeRefundAllocation({ amount_minor: CHARGE, currency: "IRR" },
      [grantRow(1, 30, "2026-09-25T00:00:00.000Z", "2026-10-25T00:00:00.000Z")], policy, NOW);
    if (conservative.status === "computed") expect(conservative.proposed_amount_minor).toBeLessThan(CHARGE);
  });

  it("unknown legacy intervals invent no amount — manual review", () => {
    const outcome = computeRefundAllocation({ amount_minor: CHARGE, currency: "IRR" },
      [grantRow(1, 30, null, null)], policy, NOW);
    expect(outcome.status).toBe("manual_review_required");
  });

  it("no recorded grants at all — manual review, never a fabricated full refund", () => {
    const outcome = computeRefundAllocation({ amount_minor: CHARGE, currency: "IRR" }, [], policy, NOW);
    expect(outcome.status).toBe("manual_review_required");
  });

  it("a prorated proposal below the policy minimum goes to manual review", () => {
    const strict: AllocationPolicy = { ...policy, minimum_refund_minor: CHARGE };
    const outcome = computeRefundAllocation({ amount_minor: CHARGE, currency: "IRR" },
      [grantRow(1, 30, "2026-09-25T00:00:00.000Z", "2026-10-25T00:00:00.000Z")], strict, NOW);
    expect(outcome.status).toBe("manual_review_required");
  });
});

// ---------------------------------------------------------------------------
// B. The ledger flow over HTTP
// ---------------------------------------------------------------------------

describe("N05 B. exact-amount allocation approval over the routes", () => {
  it("unknown legacy intervals: manual review, no approvable amount, then the operator override path", async () => {
    const db = await openRealDatabase();
    const { order } = await paidWorld(db, "n05-legacy-1");
    // Legacy damage: the grant interval evidence is unparseable (the schema's
    // activated_at is NOT NULL, so real legacy corruption is an unparseable
    // string — exactly what parseUtcTimestamp honestly refuses).
    await db.exec("UPDATE entitlement_events SET activated_at='legacy-unparseable', expires_at='unknown' WHERE kind IN ('grant','renewal')");
    const buyer = await (await import("../helpers/realDatabase")).makeSession(db, "buyer-1");
    const operator = await operatorSession(db);
    await requestOrderRefund(authedRequest(`/api/billing/orders/${order.id}/refund-request`, { reason: "Legacy interval refund." }, { session: buyer }), env(db), order.id);
    const requestId = (await db.prepare("SELECT id FROM refund_requests").first<{ id: number }>())!.id;

    const proposed = await adminProposeRefundAllocation(authedRequest(`/api/admin/billing/refund-requests/${requestId}/allocation/propose`, {}, { method: "POST", session: operator }), env(db), requestId);
    const proposedBody = await proposed.json() as { allocation: { result: string; proposal: { status: string } | null } };
    expect(proposedBody.allocation.result).toBe("manual_review");
    if (proposedBody.allocation.proposal) expect(proposedBody.allocation.proposal.status).toBe("manual_review_required");
    // No amount was invented: nothing is approvable, and the refund stays gated.
    await expect(adminApproveRefundAllocation(authedRequest(`/api/admin/billing/refund-requests/${requestId}/allocation/approve`, { proposal_operation_id: await currentAllocationProposalId(db, requestId), amount_minor: 1, currency: "IRR", note: "Nothing was proposed." }, { method: "POST", session: operator }), env(db), requestId))
      .rejects.toMatchObject({ status: 409, code: "allocation_not_approved" });
    await expect(adminApproveRefund(authedRequest(`/api/admin/billing/refund-requests/${requestId}/approve`, { note: "Trying to approve." }, { session: operator }), env(db), requestId))
      .rejects.toMatchObject({ status: 409, code: "partial_allocation_required" });

    // The manual path: an operator override with an explicit justification.
    const override = await adminProposeRefundAllocation(authedRequest(`/api/admin/billing/refund-requests/${requestId}/allocation/propose`, { override_amount_minor: 5_000_000, override_justification: "Accountant reviewed the bank statement; unused balance agreed at 5,000,000 IRR." }, { method: "POST", session: operator }), env(db), requestId);
    const overrideBody = await override.json() as { allocation: { result: string; proposal: { proposed_amount_minor: number } | null } };
    expect(overrideBody.allocation.result).toBe("proposed");
    expect(overrideBody.allocation.proposal!.proposed_amount_minor).toBe(5_000_000);
    const approved = await adminApproveRefundAllocation(authedRequest(`/api/admin/billing/refund-requests/${requestId}/allocation/approve`, { proposal_operation_id: await currentAllocationProposalId(db, requestId), amount_minor: 5_000_000, currency: "IRR", note: "Override amount affirmed." }, { method: "POST", session: operator }), env(db), requestId);
    expect(approved.status).toBe(200);
    expect(((await approved.json()) as { refund_request: { amount_minor: number } }).refund_request.amount_minor).toBe(5_000_000);
    // The audit trail: proposal, override basis, approval note all recorded.
    const events = await countRows(db, "refund_events", "to_status IN ('allocation_proposed','allocation_approved')");
    expect(events).toBe(3);
  });

  it("totals never exceed the verified receipt across sequential refunds", async () => {
    const db = await openRealDatabase();
    const { order } = await paidWorld(db, "n05-totals-1");
    const buyer = await (await import("../helpers/realDatabase")).makeSession(db, "buyer-1");
    const operator = await operatorSession(db);
    // 20 of 30 days remain: the first refund is prorated to 12,666,666.
    await db.exec("UPDATE entitlement_events SET activated_at=datetime('now','-10 days'), expires_at=datetime('now','+20 days') WHERE kind IN ('grant','renewal'); UPDATE entitlements SET activated_at=datetime('now','-10 days'), expires_at=datetime('now','+20 days')");
    await requestOrderRefund(authedRequest(`/api/billing/orders/${order.id}/refund-request`, { reason: "First partial refund." }, { session: buyer }), env(db), order.id);
    const first = (await db.prepare("SELECT id FROM refund_requests").first<{ id: number }>())!.id;
    await adminProposeRefundAllocation(authedRequest(`/api/admin/billing/refund-requests/${first}/allocation/propose`, {}, { method: "POST", session: operator }), env(db), first);
    await adminApproveRefundAllocation(authedRequest(`/api/admin/billing/refund-requests/${first}/allocation/approve`, { proposal_operation_id: await currentAllocationProposalId(db, first), amount_minor: 12_666_666, currency: "IRR", note: "Proration approved." }, { method: "POST", session: operator }), env(db), first);
    await adminApproveRefund(authedRequest(`/api/admin/billing/refund-requests/${first}/approve`, { note: "First refund approved." }, { session: operator }), env(db), first);
    const confirmed = await adminRecordRefundOutcome(authedRequest(`/api/admin/billing/refund-requests/${first}/provider-outcome`, { outcome: "confirmed", provider_reference: "889001" }, { session: operator }), env(db), first);
    expect(confirmed.status).toBe(200);

    // Totals never exceed the verified receipt — structurally and at the
    // ledger. The structural guard: after the first confirmation, a second
    // refund request for the same payment returns the EXISTING confirmed
    // request (the 0063 partial unique index + the active check) — money
    // cannot return twice.
    const repeat = await requestOrderRefund(authedRequest(`/api/billing/orders/${order.id}/refund-request`, { reason: "Trying to refund the remainder too." }, { session: buyer }), env(db), order.id);
    const repeatBody = await repeat.json() as { refund_request: { id: number; status: string } | null };
    expect(repeatBody.refund_request?.status).toBe("confirmed");
    expect(await countRows(db, "refund_requests")).toBe(1);
    // The ledger guard: an override above the unrefunded receipt remainder
    // (the full charge — nothing is confirmed for THIS new request's
    // attempt) refuses at propose time.
    const freshDb = await openRealDatabase();
    const freshWorld = await paidWorld(freshDb, "n05-totals-2");
    const freshBuyer = await (await import("../helpers/realDatabase")).makeSession(freshDb, "buyer-1");
    const freshOperator = await operatorSession(freshDb);
    await requestOrderRefund(authedRequest(`/api/billing/orders/${freshWorld.order.id}/refund-request`, { reason: "Override bounds check." }, { session: freshBuyer }), env(freshDb), freshWorld.order.id);
    const freshId = (await freshDb.prepare("SELECT id FROM refund_requests LIMIT 1").first<{ id: number }>())!.id;
    await expect(adminProposeRefundAllocation(authedRequest(`/api/admin/billing/refund-requests/${freshId}/allocation/propose`, { override_amount_minor: CHARGE + 1, override_justification: "Trying to exceed the verified receipt." }, { method: "POST", session: freshOperator }), env(freshDb), freshId))
      .rejects.toMatchObject({ status: 400, code: "invalid_override_amount" });
  });
});

// ---------------------------------------------------------------------------
// C. Review resolution — grant-specific, versioned, renewal-preserving
// ---------------------------------------------------------------------------

describe("N05 C. refund_access_reviews resolve with versioned grant decisions", () => {
  it("a combined balance (renewal landed) stays intact: retain resolves the review without cancelling the renewal", async () => {
    const db = await openRealDatabase();
    const { order } = await paidWorld(db, "n05-review-1");
    // A renewal for the same holder+sku: the aggregate balance now covers two
    // grants, so the confirmed refund of attempt 1 must enter review.
    const renewalOrder = (await createOrder(db, { buyer: "buyer-1", key: "n05-review-renewal" }))!;
    const { attemptId } = await reserveAttempt(db, renewalOrder.id, "buyer-1");
    const renewalAttempt = attemptId as number;
    await verifyOrder(db, renewalOrder, renewalAttempt, crypto.randomUUID(), new Date().toISOString());

    const buyer = await (await import("../helpers/realDatabase")).makeSession(db, "buyer-1");
    const operator = await operatorSession(db);
    await requestOrderRefund(authedRequest(`/api/billing/orders/${order.id}/refund-request`, { reason: "Refund the first period." }, { session: buyer }), env(db), order.id);
    const refundId = (await db.prepare("SELECT id FROM refund_requests").first<{ id: number }>())!.id;
    // full_unused (the renewal is a SEPARATE attempt's grant): the direct
    // approval path needs no allocation; confirmation classifies the combined
    // balance into review.
    await adminApproveRefund(authedRequest(`/api/admin/billing/refund-requests/${refundId}/approve`, { note: "Full-unused refund of the first period." }, { session: operator }), env(db), refundId);
    const confirmed = await adminRecordRefundOutcome(authedRequest(`/api/admin/billing/refund-requests/${refundId}/provider-outcome`, { outcome: "confirmed", provider_reference: "889002" }, { session: operator }), env(db), refundId);
    expect(confirmed.status).toBe(200);

    const request = await db.prepare("SELECT access_reconciliation_status FROM refund_requests WHERE id=?").bind(refundId).first<{ access_reconciliation_status: string }>();
    expect(request?.access_reconciliation_status).toBe("review_required");
    expect(await countRows(db, "refund_access_reviews", "status='open'")).toBe(1);

    // The review detail shows the grant intervals and their live entitlements.
    const detailResponse = await adminRefundReviewDetail(authedRequest(`/api/admin/billing/refund-requests/${refundId}/review`, undefined, { method: "GET", session: operator }), env(db), refundId);
    const detail = await detailResponse.json() as { grants: Array<{ grant_event_id: number; sku: string }>; review: { status: string } };
    expect(detailResponse.status).toBe(200);
    expect(detail.review.status).toBe("open");
    const refundedGrant = detail.grants.find((g) => g.sku === "farm_workspace_monthly")!;
    expect(refundedGrant).toBeDefined();

    // Resolve: the combined balance stays (retain) — the renewal survives.
    const entitlementsBefore = await db.prepare("SELECT id, active, expires_at FROM entitlements").all<{ id: number; active: number; expires_at: string }>();
    const resolve = await adminResolveRefundReview(authedRequest(`/api/admin/billing/refund-requests/${refundId}/review/resolve`, {
      resolution_note: "Renewal covers the combined balance; access retained.",
      decisions: [{ grant_event_id: refundedGrant.grant_event_id, decision: "retain", note: "Later renewal purchased separately; access preserved." }],
    }, { method: "POST", session: operator }), env(db), refundId);
    expect(resolve.status).toBe(200);
    const entitlementsAfter = await db.prepare("SELECT id, active, expires_at FROM entitlements").all<{ id: number; active: number; expires_at: string }>();
    expect(entitlementsAfter).toEqual(entitlementsBefore); // nothing cancelled
    expect(await countRows(db, "refund_access_reviews", "status='resolved'")).toBe(1);
    expect(await countRows(db, "audit_events", "action='refund.review_resolved'")).toBe(1);
    const decisions = await db.prepare("SELECT decision_version, decision FROM refund_access_review_decisions WHERE refund_request_id=?").bind(refundId).all<{ decision_version: number; decision: string }>();
    expect(decisions.results).toHaveLength(1);
    expect(decisions.results[0]?.decision_version).toBe(1);
    expect(decisions.results[0]?.decision).toBe("retain");

    // Re-resolving the resolved review refuses (re-open is an owner action).
    await expect(adminResolveRefundReview(authedRequest(`/api/admin/billing/refund-requests/${refundId}/review/resolve`, {
      resolution_note: "Second attempt.", decisions: [{ grant_event_id: refundedGrant.grant_event_id, decision: "retain", note: "Should refuse." }],
    }, { method: "POST", session: operator }), env(db), refundId)).rejects.toMatchObject({ status: 409, code: "already_resolved" });
  });

  it("cancel_interval executes ONLY the exact grant interval — and an owner re-open appends versioned decisions", async () => {
    const db = await openRealDatabase();
    const { order } = await paidWorld(db, "n05-cancel-1");
    const buyer = await (await import("../helpers/realDatabase")).makeSession(db, "buyer-1");
    const operator = await operatorSession(db);
    await db.exec("UPDATE entitlement_events SET activated_at=datetime('now','-10 days'), expires_at=datetime('now','+20 days') WHERE kind IN ('grant','renewal'); UPDATE entitlements SET activated_at=datetime('now','-10 days'), expires_at=datetime('now','+20 days')");
    await requestOrderRefund(authedRequest(`/api/billing/orders/${order.id}/refund-request`, { reason: "Partial refund with exact interval." }, { session: buyer }), env(db), order.id);
    const refundId = (await db.prepare("SELECT id FROM refund_requests").first<{ id: number }>())!.id;
    // R97: the money confirmation must exist BEFORE an access review can cancel.
    await adminProposeRefundAllocation(authedRequest(`/api/admin/billing/refund-requests/${refundId}/allocation/propose`, {}, { method: "POST", session: operator }), env(db), refundId);
    const allocation = await db.prepare("SELECT proposed_amount_minor FROM refund_allocations WHERE refund_request_id=?").bind(refundId).first<{proposed_amount_minor:number}>();
    await adminApproveRefundAllocation(authedRequest(`/api/admin/billing/refund-requests/${refundId}/allocation/approve`, {proposal_operation_id:await currentAllocationProposalId(db,refundId),amount_minor:allocation!.proposed_amount_minor,currency:"IRR",note:"Exact proposal reviewed"}, {method:"POST",session:operator}),env(db),refundId);
    await adminApproveRefund(authedRequest(`/api/admin/billing/refund-requests/${refundId}/approve`, {note:"Allocation reviewed"}, {method:"POST",session:operator}),env(db),refundId);
    await adminRecordRefundOutcome(authedRequest(`/api/admin/billing/refund-requests/${refundId}/provider-outcome`, {outcome:"confirmed",provider_reference:"889007"}, {method:"POST",session:operator}),env(db),refundId);
    const grant = (await db.prepare("SELECT id FROM entitlement_events WHERE kind IN ('grant','renewal') ORDER BY id LIMIT 1").first<{ id: number }>())!;
    const resolve = await adminResolveRefundReview(authedRequest(`/api/admin/billing/refund-requests/${refundId}/review/resolve`, {
      resolution_note: "Exact interval confirmed; cancelling the refunded period only.",
      decisions: [{ grant_event_id: Number(grant.id), decision: "cancel_interval", note: "Entitlement exactly matches the refunded grant interval." }],
    }, { method: "POST", session: operator }), env(db), refundId);
    expect(resolve.status).toBe(200);
    const ent = await db.prepare("SELECT active, cancelled_at FROM entitlements").first<{ active: number; cancelled_at: string | null }>();
    expect(Number(ent?.active)).toBe(0);
    expect(ent?.cancelled_at).not.toBeNull();
    expect(await countRows(db, "entitlement_events", "kind='refund_reversal' AND event_key LIKE 'review_cancel:%'")).toBe(1);

    // An owner re-open (documented owner action) appends decision_version 2 —
    // the v1 decision row is never rewritten.
    await db.exec(`UPDATE refund_access_reviews SET status='open' WHERE refund_request_id=${refundId}`);
    const second = await adminResolveRefundReview(authedRequest(`/api/admin/billing/refund-requests/${refundId}/review/resolve`, {
      resolution_note: "Owner re-opened; affirming the earlier cancellation.",
      decisions: [{ grant_event_id: Number(grant.id), decision: "retain", note: "Cancellation already executed; nothing further to change." }],
    }, { method: "POST", session: operator }), env(db), refundId);
    expect(second.status).toBe(200);
    const decisions = await db.prepare("SELECT decision_version, decision FROM refund_access_review_decisions WHERE refund_request_id=? ORDER BY decision_version").bind(refundId).all<{ decision_version: number; decision: string }>();
    expect(decisions.results.map((d) => d.decision_version)).toEqual([1, 2]);
    expect(decisions.results[0]?.decision).toBe("cancel_interval");
    expect(decisions.results[1]?.decision).toBe("retain");
  });

  it("command-level: a decision for a grant OUTSIDE this refund's payment refuses (marker-gated, no rows)", async () => {
    const db = await openRealDatabase();
    const { order } = await paidWorld(db, "n05-foreign-1");
    const foreignBuyer = await (await import("../helpers/realDatabase")).makeSession(db, "buyer-1");
    await requestOrderRefund(authedRequest(`/api/billing/orders/${order.id}/refund-request`, { reason: "Foreign grant decision." }, { session: foreignBuyer }), env(db), order.id);
    await db.exec(`INSERT INTO refund_access_reviews(refund_request_id,reason) VALUES((SELECT id FROM refund_requests LIMIT 1),'operator_confirmation_required')`);
    const foreignGrant = await db.prepare("SELECT id+1000 AS id FROM entitlement_events WHERE kind IN ('grant','renewal') LIMIT 1").first<{ id: number }>();
    const results = await db.batch(resolveRefundAccessReviewStatements(db, {
      refundId: (await db.prepare("SELECT id FROM refund_requests LIMIT 1").first<{ id: number }>())!.id,
      operatorUserId: "owner-1",
      decisions: [{ grantEventId: Number(foreignGrant!.id), decision: "cancel_interval", note: "A grant from another payment attempt." }],
      resolutionNote: "Should record no decisions.",
    }));
    // The claim itself may land, but the foreign-grant decision inserts zero
    // rows and nothing is cancelled — no review row is resolved either.
    expect(Number(results[1]?.meta.changes ?? 0)).toBe(0);
    expect(await countRows(db, "refund_access_review_decisions")).toBe(0);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM entitlements WHERE active=0").first<{ n: number }>())?.n).toBe(0);
    expect((await db.prepare("SELECT status FROM refund_access_reviews").first<{ status: string }>())?.status).toBe("open");
  });
});

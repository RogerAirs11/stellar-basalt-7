/**
 * R96-N05 — the precise refund/access allocation ledger.
 *
 * Design truths this module enforces (each pinned by tests):
 *  - A partially consumed service NEVER silently refunds the full charge.
 *    The proposal is computed against the IMMUTABLE grant-interval ledger
 *    (entitlement_events for this exact payment attempt); only a policy that
 *    EXPLICITLY says full_refund_despite_consumption may propose the full
 *    amount, and that field is owner-set, never defaulted.
 *  - Unknown/legacy grant intervals produce NO invented proposal: the
 *    allocation is marked manual_review and approvals refuse until an
 *    operator enters an explicit, justified amount (which still needs the
 *    same exact-amount approval).
 *  - Approval affirms the EXACT amount and currency — the operator re-states
 *    the proposed number; a mismatch refuses. The refund request's recorded
 *    amount becomes the approved allocation, so provider-confirmation
 *    evidence binds the allocated money, not the original charge.
 *  - Totals never exceed the verified receipt: the approval refuses when
 *    already-confirmed refunds for the same attempt plus this amount would
 *    exceed the attempt's verified amount.
 *  - Review resolution is grant-specific and VERSIONED: each decision
 *    (cancel_interval / retain / credit_review) appends a new immutable
 *    row; later renewals and unrelated SKUs are never touched.
 *
 * The policy below is the conservative default (v1). It is explicitly NOT
 * owner/accountant-ratified: eligibility windows, fees, taxes and cooling-off
 * terms require the operator's signed-off policy. Until then it computes the
 * NARROWEST defensible proposal: unused-time proration, zero fees, zero tax
 * adjustments, no cooling-off shortcut.
 */
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { HttpError } from "../api/http";
import type { RefundKind } from "./refunds";
import { parseUtcTimestamp } from "../shared/utcTimestamp";
import { validateFrozenLines, type FrozenOrderLine } from "./paymentCommands";

export const ALLOCATION_POLICY_VERSION = 1;

export interface AllocationPolicy {
  version: number;
  /** Proration basis for partial_consumed refunds. */
  partial_basis: "unused_time_proration";
  /** Fees subtracted from the proposal (minor units). Owner/accountant set. */
  fee_minor: number;
  /** Tax treatment note — taxes are NEVER silently computed. */
  tax_note: string;
  /**
   * ONLY the owner may set this: a policy that refunds the FULL charge
   * despite consumed days (e.g. a statutory cooling-off window). Defaults to
   * false — the narrowest defensible proposal.
   */
  full_refund_despite_consumption: boolean;
  /** Minimum refundable amount; proposals below it require manual review. */
  minimum_refund_minor: number;
}

/** v1 conservative default — unused-time proration, no fees, no cooling-off. */
export const CONSERVATIVE_ALLOCATION_POLICY_V1: AllocationPolicy = {
  version: ALLOCATION_POLICY_VERSION,
  partial_basis: "unused_time_proration",
  fee_minor: 0,
  tax_note: "Tax treatment not yet defined by the operator/accountant; no tax is added or subtracted from proposals.",
  full_refund_despite_consumption: false,
  minimum_refund_minor: 0,
};

export interface AllocationGrantInterval {
  grant_event_id: number;
  sku: string;
  granted_days: number;
  activated_at: string | null;
  expires_at: string | null;
  /** Verified frozen order-line contribution, never inferred from duration. */
  paid_amount_minor?: number;
}

export type AllocationProposal =
  | {
      status: "computed";
      proposed_amount_minor: number;
      basis: {
        kind: RefundKind;
        charge_amount_minor: number;
        granted_days: number;
        consumed_days: number | null;
        remaining_days: number | null;
        proration: "none" | "unused_time" | "policy_full" | "operator_override";
        fee_minor: number;
        tax_note: string;
        grants: AllocationGrantInterval[];
      };
    }
  | {
      status: "manual_review_required";
      reason: string;
      basis: { grants: AllocationGrantInterval[] };
    };

/** Pure proposal computation against the immutable grant-interval ledger. */
export function computeRefundAllocation(
  charge: { amount_minor: number; currency: string },
  grants: readonly AllocationGrantInterval[],
  policy: AllocationPolicy,
  nowIso: string,
): AllocationProposal {
  if (!Number.isSafeInteger(charge.amount_minor) || charge.amount_minor <= 0 || charge.currency !== "IRR") {
    throw new HttpError(409, "invalid_charge", "Allocation requires a positive verified IRR charge");
  }
  if (!Number.isSafeInteger(policy.version) || policy.version < 1
    || !Number.isSafeInteger(policy.fee_minor) || policy.fee_minor < 0
    || !Number.isSafeInteger(policy.minimum_refund_minor) || policy.minimum_refund_minor < 0
    || typeof policy.full_refund_despite_consumption !== "boolean"
    || policy.partial_basis !== "unused_time_proration" || typeof policy.tax_note !== "string" || policy.tax_note.length > 2000) {
    throw new RangeError("A versioned, nonnegative, bounded allocation policy is required");
  }
  const manual = (reason:string):AllocationProposal => ({status:"manual_review_required",reason,basis:{grants:[...grants]}});
  if (!grants.length || grants.length > 100) return manual("no_or_unbounded_recorded_grants");
  const now = parseUtcTimestamp(nowIso);
  if (now === null) throw new RangeError("Allocation requires a valid UTC timestamp");
  const ids = new Set<number>();
  let granted=0, remaining=0;
  const intervals:Array<{grant:AllocationGrantInterval;remaining:number}>=[];
  for (const grant of grants) {
    if (!Number.isSafeInteger(grant.grant_event_id) || grant.grant_event_id<1 || ids.has(grant.grant_event_id)) return manual("duplicate_or_invalid_grant");
    ids.add(grant.grant_event_id);
    if (!Number.isSafeInteger(grant.granted_days) || grant.granted_days<1 || grant.granted_days>365000) return manual("invalid_grant_duration");
    const start=parseUtcTimestamp(grant.activated_at),end=parseUtcTimestamp(grant.expires_at);
    if (start===null || end===null || end<=start) return manual("unknown_grant_interval");
    if (end-start!==grant.granted_days*86_400_000) return manual("grant_interval_duration_mismatch");
    const unused=Math.min(grant.granted_days,Math.max(0,Math.ceil((end-Math.max(start,now))/86_400_000)));
    granted+=grant.granted_days;remaining+=unused;intervals.push({grant,remaining:unused});
  }
  const consumed=granted-remaining;
  const kind:RefundKind=consumed>0?"partial_consumed":"full_unused";
  // Different products can have radically different prices. Days are NOT
  // interchangeable currency. The one-grant compatibility path is unambiguous;
  // multiple grants require exact frozen line amounts that sum to this charge.
  const prices=intervals.map(({grant})=>grant.paid_amount_minor ?? (grants.length===1?charge.amount_minor:NaN));
  if (prices.some(value=>!Number.isSafeInteger(value)||value<0)
    || prices.reduce((sum,value)=>sum+BigInt(value),0n)!==BigInt(charge.amount_minor)) return manual("priced_grant_allocation_required");
  const full=kind==="full_unused"||policy.full_refund_despite_consumption;
  const beforeFee=full?BigInt(charge.amount_minor):intervals.reduce((sum,item,index)=>
    sum+BigInt(prices[index])*BigInt(item.remaining)/BigInt(item.grant.granted_days),0n);
  const proposed=Number(beforeFee>BigInt(policy.fee_minor)?beforeFee-BigInt(policy.fee_minor):0n);
  if (proposed<=0 || proposed<policy.minimum_refund_minor) return manual("proposal_below_minimum");
  return {status:"computed",proposed_amount_minor:proposed,basis:{
    kind,charge_amount_minor:charge.amount_minor,granted_days:granted,consumed_days:consumed,remaining_days:remaining,
    proration:kind==="full_unused"?"none":policy.full_refund_despite_consumption?"policy_full":"unused_time",
    fee_minor:policy.fee_minor,tax_note:policy.tax_note,grants:[...grants],
  }};
}

const ACTIVE_OPERATOR_SQL = "EXISTS(SELECT 1 FROM users WHERE id=? AND is_active=1 AND role IN ('admin','super_admin'))";

export interface ProposeAllocationInput {
  refundId: number;
  operatorUserId: string;
  nowIso: string;
  /** Operator-entered explicit amount with justification (manual review path). */
  override?: { amount_minor: number; justification: string };
  policy?: AllocationPolicy;
}

/**
 * Compute and record a versioned allocation proposal for a refund request.
 * Supersedes any prior proposal of the same policy version. Sets
 * allocation_status: 'proposed' (computed), 'manual_review' (unknown
 * intervals and no override), or 'not_applicable' (the attempt is already
 * fully refunded — nothing left to allocate).
 */
export async function proposeRefundAllocation(db: D1Database, input: ProposeAllocationInput): Promise<{
  result:"proposed"|"manual_review"|"not_applicable";proposal:AllocationProposal|null;allocation_id:number|null;proposal_operation_id:string|null;
}> {
  if (!Number.isSafeInteger(input.refundId)||input.refundId<1) throw new RangeError("A valid refund id is required");
  if (!await db.prepare("SELECT id FROM users WHERE id=? AND is_active=1 AND role IN ('admin','super_admin')").bind(input.operatorUserId).first()) {
    throw new HttpError(403,"allocation_operator_required","A current operator must propose the allocation");
  }
  if (input.override && (!Number.isSafeInteger(input.override.amount_minor)||input.override.amount_minor<=0)) throw new HttpError(400,"invalid_override_amount","A positive safe integer of minor units is required");
  if (input.override && (!input.override.justification || input.override.justification.trim().length<10 || input.override.justification.length>2000)) throw new HttpError(400,"invalid_override_justification","An override requires 10-2000 characters of justification");
  const charge=await db.prepare(`SELECT rr.id,rr.payment_attempt_id,rr.currency,rr.status,rr.allocation_status,rr.last_operation_id,
      p.amount_minor,o.price_snapshot_json,
      (SELECT COALESCE(SUM(x.amount_minor),0) FROM refund_requests x WHERE x.payment_attempt_id=p.id AND x.status='confirmed' AND x.id<>rr.id) AS already_confirmed_minor
    FROM refund_requests rr JOIN payment_attempts p ON p.id=rr.payment_attempt_id JOIN orders o ON o.id=rr.order_id AND o.id=p.order_id
    WHERE rr.id=? AND p.state='verified' AND p.currency=rr.currency AND o.currency=p.currency AND o.total_minor=p.amount_minor`)
    .bind(input.refundId).first<{id:number;payment_attempt_id:number;currency:string;status:string;allocation_status:string;last_operation_id:string|null;amount_minor:number;price_snapshot_json:string;already_confirmed_minor:number}>();
  if (!charge || charge.status!=="requested" || !["none","proposed","manual_review"].includes(charge.allocation_status)) throw new HttpError(409,"not_proposable","An unapproved requested refund with reconciled payment evidence is required");
  const previous=await db.prepare("SELECT * FROM refund_allocations WHERE refund_request_id=? ORDER BY id").bind(input.refundId).all<Record<string,unknown>>();
  if (previous.results.some(row=>row.status==="approved")) throw new HttpError(409,"allocation_already_approved","Approved allocation evidence cannot be overwritten");
  const rows=await db.prepare("SELECT id AS grant_event_id,sku,granted_days,activated_at,expires_at FROM entitlement_events WHERE payment_attempt_id=? AND kind IN ('grant','renewal') ORDER BY id")
    .bind(charge.payment_attempt_id).all<AllocationGrantInterval>();
  const grants=rows.results ?? [];
  let prices:FrozenOrderLine[]|null=null;
  try { const parsed=JSON.parse(charge.price_snapshot_json);validateFrozenLines(parsed,charge.amount_minor);prices=parsed; } catch { /* Unknown evidence is not a zero-price product. */ }
  const pricedGrants=grants.map(grant=>{
    const line=prices?.find(line=>line.sku===grant.sku);
    return {...grant,...(line?.period_days && line.period_days*line.quantity===grant.granted_days ? {paid_amount_minor:line.line_total_minor}: {})};
  });
  const remainder=charge.amount_minor-Number(charge.already_confirmed_minor);
  if (!Number.isSafeInteger(remainder)||remainder<=0) throw new HttpError(409,"nothing_refundable","No unrefunded verified amount remains");
  if (input.override && input.override.amount_minor>remainder) throw new HttpError(400,"invalid_override_amount","An override cannot exceed the verified unrefunded receipt");
  const policy=input.policy ?? CONSERVATIVE_ALLOCATION_POLICY_V1;
  let computed:AllocationProposal;
  if (input.override) computed={status:"computed",proposed_amount_minor:input.override.amount_minor,basis:{kind:"partial_consumed",charge_amount_minor:remainder,granted_days:0,consumed_days:null,remaining_days:null,proration:"operator_override",fee_minor:0,tax_note:`Operator override: ${input.override.justification.trim()}`,grants:pricedGrants}};
  else if (!prices || pricedGrants.some(grant=>grant.paid_amount_minor===undefined)
    || pricedGrants.reduce((sum,grant)=>sum+Number(grant.paid_amount_minor ?? 0),0)!==remainder) {
    computed={status:"manual_review_required",reason:"priced_grant_allocation_required",basis:{grants:pricedGrants}};
  } else computed=computeRefundAllocation({amount_minor:remainder,currency:charge.currency},pricedGrants,policy,input.nowIso);
  const isComputed=computed.status==="computed";
  const amount=computed.status==="computed"?computed.proposed_amount_minor:0;
  const operation=crypto.randomUUID();
  const gate="EXISTS(SELECT 1 FROM refund_requests r WHERE r.id=? AND r.last_operation_id=? AND r.status='requested')";
  const basis=JSON.stringify(computed.status==="computed"?computed.basis:{manual_review:computed.reason,grants:pricedGrants});
  const statements=[
    // Claim FIRST. Every following write depends on this exact successful CAS.
    db.prepare(`UPDATE refund_requests SET allocation_status=?,last_operation_id=?
      WHERE id=? AND status='requested' AND allocation_status IN ('none','proposed','manual_review')
        AND ((last_operation_id IS NULL AND CAST(? AS TEXT) IS NULL) OR last_operation_id=?) AND ${ACTIVE_OPERATOR_SQL}
        AND NOT EXISTS(SELECT 1 FROM refund_allocations a WHERE a.refund_request_id=refund_requests.id AND a.status='approved')`)
      .bind(isComputed?"proposed":"manual_review",operation,input.refundId,charge.last_operation_id,charge.last_operation_id,input.operatorUserId),
    db.prepare(`UPDATE refund_allocations SET status='superseded' WHERE refund_request_id=? AND status='proposed' AND ${gate}`)
      .bind(input.refundId,input.refundId,operation),
    db.prepare(`INSERT INTO refund_allocations(refund_request_id,policy_version,charge_amount_minor,proposed_amount_minor,currency,basis_json,status,proposed_by_user_id,proposal_operation_id)
      SELECT ?,?,?,?,?,?,'proposed',?,? WHERE ${gate}
      ON CONFLICT(refund_request_id,policy_version) DO UPDATE SET charge_amount_minor=excluded.charge_amount_minor,
        proposed_amount_minor=excluded.proposed_amount_minor,currency=excluded.currency,basis_json=excluded.basis_json,status='proposed',
        proposed_by_user_id=excluded.proposed_by_user_id,proposal_operation_id=excluded.proposal_operation_id,
        approved_by_user_id=NULL,approved_at=NULL,approval_note=NULL,created_at=CURRENT_TIMESTAMP
      WHERE refund_allocations.status<>'approved'`)
      .bind(input.refundId,policy.version,remainder,amount,charge.currency,basis,input.operatorUserId,operation,input.refundId,operation),
    // The compatibility table is a current projection. Immutable event payloads
    // preserve EVERY new proposal and the prior legacy projection, not just a summary.
    db.prepare(`INSERT INTO refund_events(refund_request_id,actor,from_status,to_status,payload_json)
      SELECT id,'operator','allocation','allocation_proposed',? FROM refund_requests WHERE id=? AND last_operation_id=?`)
      .bind(JSON.stringify({proposal_operation_id:operation,policy,computed_at:input.nowIso,proposal:computed,previous_allocations:previous.results,override:input.override ?? null}),input.refundId,operation),
  ];
  const result=await db.batch(statements);
  if (Number(result[0]?.meta.changes ?? 0)!==1) throw new HttpError(409,"allocation_changed","Authority or refund state changed; nothing was proposed");
  const allocation=await db.prepare("SELECT id FROM refund_allocations WHERE refund_request_id=? AND proposal_operation_id=?").bind(input.refundId,operation).first<{id:number}>();
  return {result:isComputed?"proposed":"manual_review",proposal:computed,allocation_id:allocation?.id ?? null,proposal_operation_id:operation};
}

export interface ApproveAllocationInput {
  expectedProposalOperationId: string;
  refundId: number;
  operatorUserId: string;
  amountMinor: number;
  currency: string;
  note: string;
}

/**
 * Approve the EXACT proposed amount. The operator re-states the number; any
 * mismatch with the current single proposed allocation refuses. Totals are
 * checked against the verified receipt: confirmed refunds for the same
 * attempt plus this amount may never exceed the attempt amount. On success
 * the refund request's amount_minor becomes the approved allocation.
 */
export function approveRefundAllocationStatements(db: D1Database, input: ApproveAllocationInput): D1PreparedStatement[] {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new HttpError(400, "invalid_amount", "The approved amount must be a positive integer of minor units");
  }
  if (!input.note || input.note.trim().length < 3 || input.note.length > 2000) {
    throw new HttpError(400, "invalid_approval_note", "An approval note (3-2000 chars) is required");
  }
  if (!input.expectedProposalOperationId || !/^[0-9a-f-]{36}$/i.test(input.expectedProposalOperationId)) throw new HttpError(400,"proposal_identity_required","Approval must identify the exact proposal operation");
  const operation = crypto.randomUUID();
  const allocationGate = `EXISTS(
    SELECT 1 FROM refund_allocations a
    WHERE a.refund_request_id=refund_requests.id AND a.status='proposed'
      AND a.proposed_amount_minor=? AND a.currency=? AND a.proposal_operation_id=?
      AND NOT EXISTS(SELECT 1 FROM refund_allocations b WHERE b.refund_request_id=a.refund_request_id AND b.status='proposed' AND b.id<>a.id))`;
  return [
    db.prepare(`UPDATE refund_requests SET allocation_status='approved', amount_minor=?, last_operation_id=?
      WHERE id=? AND status='requested' AND allocation_status='proposed' AND currency=?
        AND ${allocationGate}
        AND ${ACTIVE_OPERATOR_SQL}
        AND EXISTS(SELECT 1 FROM payment_attempts p WHERE p.id=refund_requests.payment_attempt_id AND p.state='verified'
          AND (SELECT COALESCE(SUM(x.amount_minor),0) FROM refund_requests x
            WHERE x.payment_attempt_id=p.id AND x.status='confirmed' AND x.id<>refund_requests.id) + ? <= p.amount_minor)`)
      .bind(input.amountMinor, operation, input.refundId, input.currency, input.amountMinor, input.currency, input.expectedProposalOperationId, input.operatorUserId, input.amountMinor),
    db.prepare(`UPDATE refund_allocations SET status='approved', approved_by_user_id=?, approved_at=CURRENT_TIMESTAMP, approval_note=?
      WHERE refund_request_id=? AND status='proposed' AND proposed_amount_minor=? AND currency=? AND proposal_operation_id=?
        AND EXISTS(SELECT 1 FROM refund_requests r WHERE r.id=refund_allocations.refund_request_id AND r.last_operation_id=? AND r.allocation_status='approved')`)
      .bind(input.operatorUserId, input.note.trim(), input.refundId, input.amountMinor, input.currency,input.expectedProposalOperationId,operation),
    db.prepare(`INSERT INTO refund_events(refund_request_id,actor,from_status,to_status,payload_json)
      SELECT id,'operator','allocation','allocation_approved',? FROM refund_requests WHERE id=? AND last_operation_id=?`)
      .bind(JSON.stringify({ amount_minor: input.amountMinor, currency: input.currency, proposal_operation_id:input.expectedProposalOperationId, note: input.note.trim() }), input.refundId, operation),
  ];
}

// Compatibility export: review decisions are separate from monetary allocation.
export { resolveRefundAccessReviewStatements } from "./refundAccessReview";
export type { ReviewDecisionInput, ResolveReviewInput } from "./refundAccessReview";

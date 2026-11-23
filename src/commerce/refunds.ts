/** Refund evidence and access reconciliation are separate facts.
 *
 * This module records operator-reviewed provider outcomes; it does not call a
 * money-moving API and does not cryptographically verify a merchant-panel claim.
 * Zarinpal DOES document reversal and refund methods (official docs checked
 * 2026-10-04). Their merchant permissions, IP restrictions, timing and evidence
 * requirements must be integrated separately, not inferred from this ledger.
 *
 * Every execution has a fresh operation id. Only the winning mutation may
 * append events or change access. A mixed/legacy entitlement balance is retained
 * and queued for allocation review, never cancelled wholesale for one refund.
 */
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { HttpError } from "../api/http";

export type RefundKind = "full_unused" | "partial_consumed";
export type RefundStatus = "requested" | "approved" | "provider_pending" | "confirmed" | "failed" | "rejected" | "cancelled";
export type RefundAccessStatus = "pending" | "applied" | "not_applicable" | "review_required";

export const REFUND_STATUS_NOTE: Record<RefundStatus,string> = {
  requested:"Refund requested. No money has moved and no access has changed.",
  approved:"An operator approved the request. A refund has not yet been recorded.",
  provider_pending:"The provider outcome is unknown and under review; this is not a successful refund.",
  confirmed:"An operator recorded provider-confirmation evidence. Check access_reconciliation_status separately; combined or legacy paid credits remain active pending review.",
  failed:"The recorded provider outcome was failure. No refund or access reversal is claimed.",
  rejected:"The request was rejected. No refund or access reversal is claimed.",
  cancelled:"The request was cancelled. No refund or access reversal is claimed.",
};
export function refundRequestKey(attemptId:number,generation:number):string {
  return `refund:attempt:${attemptId}:#${generation}`;
}
export interface RefundEntitlementPolicy {
  kind:RefundKind; sku:string|null; granted_days:number|null; consumed_days:number|null; remaining_days:number|null;
  access_action:"cancel_full_period"|"end_at_confirmation"|"none"; history_note:string;
}
export interface RequestRefundInput {
  orderId:number; attemptId:number; buyerUserId:string; reason:string; generation:number;
}
const ACTIVE_OPERATOR_SQL="EXISTS(SELECT 1 FROM users WHERE id=? AND is_active=1 AND role IN ('admin','super_admin'))";
const OPERATION_GATE="EXISTS(SELECT 1 FROM refund_requests WHERE id=? AND last_operation_id=?)";
function validateId(value:number,label:string):void {
  if(!Number.isSafeInteger(value)||value<1)throw new RangeError(`${label} must be a positive safe integer`);
}
function validateKind(kind:RefundKind):void {
  if(kind!=="full_unused"&&kind!=="partial_consumed")throw new RangeError("Unknown refund policy kind");
}

/** Create the wish, not a transfer. The partial unique index also protects
 * distinct racing request keys; ON CONFLICT allows a safe read/replay. */
export function requestRefundStatements(db:D1Database,input:RequestRefundInput,policy:RefundEntitlementPolicy):D1PreparedStatement[] {  validateId(input.orderId,"orderId");validateId(input.attemptId,"attemptId");validateId(input.generation,"generation");validateKind(policy.kind);
  if(!input.reason||input.reason.trim().length<3||input.reason.length>2000)throw new HttpError(400,"invalid_refund_request","A substantive reason (3-2000 chars) is required");
  const operation=crypto.randomUUID();
  return [
    db.prepare(`INSERT INTO refund_requests(order_id,payment_attempt_id,request_key,kind,amount_minor,currency,status,reason,
        requested_by_user_id,entitlement_policy_json,last_operation_id)
      SELECT o.id,p.id,?,?,p.amount_minor,'IRR','requested',?,?,?,?
      FROM payment_attempts p JOIN orders o ON o.id=p.order_id
      WHERE p.id=? AND o.id=? AND p.state='verified' AND p.amount_minor=o.total_minor
        AND p.currency='IRR' AND o.currency='IRR' AND o.status='paid' AND o.buyer_user_id=? AND p.amount_minor>0
        AND EXISTS(SELECT 1 FROM users WHERE id=o.buyer_user_id AND is_active=1)
        AND NOT EXISTS(SELECT 1 FROM refund_requests rr WHERE rr.payment_attempt_id=p.id AND rr.status IN ('requested','approved','provider_pending','confirmed'))
      ON CONFLICT DO NOTHING`)
      .bind(refundRequestKey(input.attemptId,input.generation),policy.kind,input.reason.trim(),input.buyerUserId,JSON.stringify(policy),operation,
        input.attemptId,input.orderId,input.buyerUserId),
    db.prepare(`INSERT INTO refund_events(refund_request_id,actor,from_status,to_status,payload_json)
      SELECT id,'buyer',NULL,'requested',? FROM refund_requests WHERE last_operation_id=?`)
      .bind(JSON.stringify({reason:input.reason.trim()}),operation),
  ];
}

export function approveRefundStatements(db:D1Database,input:{refundId:number;operatorUserId:string;note:string}):D1PreparedStatement[] {
  validateId(input.refundId,"refundId");
  if(!input.operatorUserId||!input.note||input.note.trim().length<3||input.note.length>2000)throw new HttpError(400,"invalid_approval","An operator note (3-2000 chars) is required");
  const operation=crypto.randomUUID();
  // R96-N05: the partial-consumed gate is the ALLOCATION LEDGER, never a
  // feature flag. A partially consumed refund is approvable only with an
  // APPROVED allocation (exact amount + currency affirmed by a separate
  // operator action); a full_unused refund keeps the exact-amount equality
  // with the verified attempt.
  return [
    db.prepare(`UPDATE refund_requests SET status='approved',last_from_status=status,last_operation_id=?,
        approved_by_user_id=?,approved_at=CURRENT_TIMESTAMP
      WHERE id=? AND status='requested' AND ${ACTIVE_OPERATOR_SQL}
        AND ((kind='full_unused' AND allocation_status IN ('none','not_applicable','approved'))
          OR (kind='partial_consumed' AND allocation_status='approved' AND amount_minor>0))
        AND (allocation_status<>'approved' OR EXISTS(SELECT 1 FROM refund_allocations a WHERE a.refund_request_id=refund_requests.id AND a.status='approved' AND a.proposed_amount_minor=refund_requests.amount_minor AND a.currency=refund_requests.currency AND a.proposal_operation_id IS NOT NULL))
        AND EXISTS(SELECT 1 FROM payment_attempts p JOIN orders o ON o.id=p.order_id
          WHERE p.id=refund_requests.payment_attempt_id AND o.id=refund_requests.order_id AND p.state='verified'
            AND p.amount_minor>=refund_requests.amount_minor AND o.total_minor=p.amount_minor
            AND p.currency=refund_requests.currency AND o.currency=p.currency) `)
      .bind(operation,input.operatorUserId,input.refundId,input.operatorUserId),
    db.prepare(`INSERT INTO refund_events(refund_request_id,actor,from_status,to_status,payload_json)
      SELECT id,'operator',last_from_status,'approved',? FROM refund_requests WHERE id=? AND last_operation_id=?`)
      .bind(JSON.stringify({operator_user_id:input.operatorUserId,note:input.note.trim()}),input.refundId,operation),
  ];
}

export type ProviderRefundOutcome=
  |{outcome:"confirmed";providerReference:string}
  |{outcome:"failed";providerCode?:number}
  |{outcome:"pending"};

/** Record an operator's evidence. A fresh winning operation gates all effects.
 * Automatic access cancellation is deliberately narrow: the current balance
 * must be attributable to one exact grant. Otherwise money evidence is recorded
 * while access remains untouched and an explicit allocation review is opened. */
export function recordProviderRefundOutcomeStatements(db:D1Database,input:{refundId:number;operatorUserId:string;kind:RefundKind;result:ProviderRefundOutcome}):D1PreparedStatement[] {
  validateId(input.refundId,"refundId");validateKind(input.kind);
  const operation=crypto.randomUUID();
  const confirmed=input.result.outcome==="confirmed";
  const next=confirmed?"confirmed":input.result.outcome==="failed"?"failed":"provider_pending";
  const reference=confirmed?(input.result as {providerReference:string}).providerReference.trim():null;
  if(confirmed&&(!reference||reference.length>128||/[\u0000-\u001f\u007f]/.test(reference)))throw new HttpError(400,"invalid_provider_reference","A bounded provider reference from reviewed evidence is required");
  if(!["confirmed","failed","pending"].includes(input.result.outcome))throw new RangeError("Unknown provider outcome");
  const payload=JSON.stringify({recorded_by:input.operatorUserId,confirmation_source:"operator_recorded",...input.result});
  const statements:D1PreparedStatement[]=[
    db.prepare(`UPDATE refund_requests SET status=?,last_from_status=status,last_operation_id=?,provider_status=?,
        provider_reference=COALESCE(?,provider_reference),confirmation_source='operator_recorded',
        decided_at=CASE WHEN ?='provider_pending' THEN NULL ELSE CURRENT_TIMESTAMP END
      WHERE id=? AND kind=? AND status IN ('approved','provider_pending') AND ${ACTIVE_OPERATOR_SQL}
        AND EXISTS(SELECT 1 FROM payment_attempts p JOIN orders o ON o.id=p.order_id
          WHERE p.id=refund_requests.payment_attempt_id AND o.id=refund_requests.order_id AND p.state='verified'
            AND p.amount_minor>=refund_requests.amount_minor AND p.amount_minor=o.total_minor
            AND p.currency='IRR' AND o.currency='IRR' AND refund_requests.currency='IRR'
            AND ((refund_requests.allocation_status IN ('none','not_applicable') AND refund_requests.amount_minor=p.amount_minor)
              OR (refund_requests.allocation_status='approved' AND refund_requests.amount_minor>0 AND EXISTS(SELECT 1 FROM refund_allocations a WHERE a.refund_request_id=refund_requests.id AND a.status='approved' AND a.proposed_amount_minor=refund_requests.amount_minor AND a.currency=refund_requests.currency AND a.proposal_operation_id IS NOT NULL))))`)
      .bind(next,operation,next,reference,next,input.refundId,input.kind,input.operatorUserId),
    db.prepare(`INSERT INTO refund_events(refund_request_id,actor,from_status,to_status,payload_json)
      SELECT id,'operator',last_from_status,status,? FROM refund_requests WHERE id=? AND last_operation_id=?`)
      .bind(payload,input.refundId,operation),
  ];
  if(!confirmed)return statements;
  statements.push(
    db.prepare(`INSERT INTO refund_access_adjustments(refund_request_id,grant_event_id,entitlement_id,disposition)
      SELECT r.id,ge.id,e.id,
        CASE WHEN e.id IS NULL OR datetime(e.expires_at)<=CURRENT_TIMESTAMP THEN 'no_live_access'
          WHEN r.amount_minor<(SELECT amount_minor FROM payment_attempts WHERE id=r.payment_attempt_id) THEN 'review_required'
          WHEN e.source_event_id=ge.id AND datetime(e.activated_at)=datetime(ge.activated_at)
            AND datetime(e.expires_at)=datetime(ge.expires_at) THEN 'cancelled'
          ELSE 'review_required' END
      FROM refund_requests r JOIN entitlement_events ge ON ge.payment_attempt_id=r.payment_attempt_id AND ge.kind IN ('grant','renewal')
      LEFT JOIN entitlements e ON e.active=1 AND e.sku=ge.sku
        AND e.holder_key=CASE WHEN ge.payer_organization_id IS NULL THEN 'user:'||ge.buyer_user_id ELSE 'org:'||CAST(ge.payer_organization_id AS TEXT) END
      WHERE r.id=? AND r.last_operation_id=? AND r.status='confirmed'
      ON CONFLICT(refund_request_id,grant_event_id) DO NOTHING`).bind(input.refundId,operation),
    db.prepare(`UPDATE entitlements SET active=0,cancelled_at=CURRENT_TIMESTAMP,cancelled_by_user_id=?,
        updated_at=CURRENT_TIMESTAMP,last_refund_operation_id=?
      WHERE active=1 AND EXISTS(SELECT 1 FROM refund_access_adjustments a JOIN entitlement_events ge ON ge.id=a.grant_event_id
        WHERE a.refund_request_id=? AND a.disposition='cancelled' AND a.entitlement_id=entitlements.id
          AND entitlements.source_event_id=ge.id AND datetime(entitlements.activated_at)=datetime(ge.activated_at)
          AND datetime(entitlements.expires_at)=datetime(ge.expires_at)) AND ${OPERATION_GATE}`)
      .bind(input.operatorUserId,operation,input.refundId,input.refundId,operation),
    // A concurrent renewal may have changed the aggregate after classification.
    // The CAS above refuses to remove it; classify that case as review instead
    // of falsely emitting an applied reversal.
    db.prepare(`UPDATE refund_access_adjustments SET disposition='review_required'
      WHERE refund_request_id=? AND disposition='cancelled' AND ${OPERATION_GATE}
        AND NOT EXISTS(SELECT 1 FROM entitlements e WHERE e.id=refund_access_adjustments.entitlement_id AND e.last_refund_operation_id=?)`)
      .bind(input.refundId,input.refundId,operation,operation),
    db.prepare(`INSERT INTO entitlement_events(event_key,order_id,payment_attempt_id,buyer_user_id,payer_organization_id,sku,kind,granted_days,activated_at,expires_at)
      SELECT 'refund_reversal:'||CAST(r.id AS TEXT)||':sku:'||ge.sku,r.order_id,r.payment_attempt_id,ge.buyer_user_id,ge.payer_organization_id,
        ge.sku,'refund_reversal',0,CURRENT_TIMESTAMP,NULL
      FROM refund_requests r JOIN refund_access_adjustments a ON a.refund_request_id=r.id
      JOIN entitlement_events ge ON ge.id=a.grant_event_id
      WHERE r.id=? AND r.last_operation_id=? AND a.disposition IN ('cancelled','no_live_access')
      ON CONFLICT(event_key) DO NOTHING`).bind(input.refundId,operation),
    db.prepare(`UPDATE refund_requests SET access_reconciliation_status=CASE
        WHEN NOT EXISTS(SELECT 1 FROM refund_access_adjustments a WHERE a.refund_request_id=refund_requests.id) THEN 'not_applicable'
        WHEN EXISTS(SELECT 1 FROM refund_access_adjustments a WHERE a.refund_request_id=refund_requests.id AND a.disposition='review_required') THEN 'review_required'
        ELSE 'applied' END
      WHERE id=? AND last_operation_id=?`).bind(input.refundId,operation),
    db.prepare(`INSERT INTO refund_access_reviews(refund_request_id,reason)
      SELECT id,'combined_or_unattributed_paid_credits' FROM refund_requests
      WHERE id=? AND last_operation_id=? AND access_reconciliation_status='review_required'
      ON CONFLICT(refund_request_id) DO NOTHING`).bind(input.refundId,operation),
    db.prepare(`UPDATE orders SET status=CASE WHEN (SELECT COALESCE(SUM(rr.amount_minor),0) FROM refund_requests rr WHERE rr.order_id=orders.id AND rr.status='confirmed')>=orders.total_minor
        THEN 'refunded' ELSE 'partially_refunded' END,row_version=row_version+1,updated_at=CURRENT_TIMESTAMP
      WHERE id IN(SELECT order_id FROM refund_requests WHERE id=? AND last_operation_id=? AND status='confirmed')`)
      .bind(input.refundId,operation),
  );
  return statements;
}

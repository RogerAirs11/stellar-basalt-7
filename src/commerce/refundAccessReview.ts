import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { HttpError } from "../api/http";

export interface ReviewDecisionInput {
  grantEventId: number;
  decision: "cancel_interval" | "retain" | "credit_review";
  note: string;
}
export interface ResolveReviewInput {
  refundId: number;
  operatorUserId: string;
  decisions: ReviewDecisionInput[];
  resolutionNote: string;
}

/**
 * Decide every grant for one CONFIRMED refund, atomically. A proposal is not
 * proof that money was returned. Unknown/foreign/omitted grants reject the
 * entire command. Each side effect is bound to a fresh operation, not merely
 * an old decision. Credit review remains open; inexact cancellation never
 * reports success. Later renewals and unrelated entitlements are preserved.
 */
export function resolveRefundAccessReviewStatements(db: D1Database, input: ResolveReviewInput): D1PreparedStatement[] {
  if (!Number.isSafeInteger(input.refundId) || input.refundId < 1 || !input.operatorUserId) throw new HttpError(400, "invalid_refund", "A refund and operator are required");
  if (!input.decisions.length || input.decisions.length > 100) throw new HttpError(400, "invalid_decisions", "Provide decisions for 1-100 grant events");
  if (!input.resolutionNote || input.resolutionNote.trim().length < 3 || input.resolutionNote.length > 2000) throw new HttpError(400, "invalid_resolution_note", "A resolution note (3-2000 chars) is required");
  const seen = new Set<number>();
  for (const d of input.decisions) {
    if (!Number.isSafeInteger(d.grantEventId) || d.grantEventId < 1 || seen.has(d.grantEventId)) throw new HttpError(400, "invalid_grant", "Grant IDs must be positive and unique");
    seen.add(d.grantEventId);
    if (!["cancel_interval", "retain", "credit_review"].includes(d.decision)) throw new HttpError(400, "invalid_decision", "Unknown grant decision");
    if (!d.note || d.note.trim().length < 3 || d.note.length > 2000) throw new HttpError(400, "invalid_decision_note", "Every decision needs a note (3-2000 chars)");
  }
  const operation = crypto.randomUUID();
  const grantIds = input.decisions.map(d => d.grantEventId);
  const cancelIds = input.decisions.filter(d => d.decision === "cancel_interval").map(d => d.grantEventId);
  const slots = (ids: number[]) => ids.map(() => "?").join(",");
  // A requested cancellation must be possible NOW. If entitlement state moves
  // subsequently, the UPDATE and resolution gates recheck the exact interval.
  const cancelGate = cancelIds.length ? `AND (SELECT COUNT(*) FROM entitlement_events ge
    JOIN entitlements e ON e.source_event_id=ge.id AND e.active=1
      AND datetime(e.activated_at)=datetime(ge.activated_at) AND datetime(e.expires_at)=datetime(ge.expires_at)
    WHERE ge.payment_attempt_id=refund_requests.payment_attempt_id AND ge.id IN (${slots(cancelIds)}))=?` : "";
  const statements: D1PreparedStatement[] = [
    db.prepare(`UPDATE refund_requests SET last_operation_id=?
      WHERE id=? AND status='confirmed'
        AND EXISTS(SELECT 1 FROM refund_access_reviews rv WHERE rv.refund_request_id=refund_requests.id AND rv.status='open')
        AND EXISTS(SELECT 1 FROM users u WHERE u.id=? AND u.is_active=1 AND u.role IN ('admin','super_admin'))
        AND (SELECT COUNT(*) FROM entitlement_events ge WHERE ge.payment_attempt_id=refund_requests.payment_attempt_id AND ge.kind IN ('grant','renewal'))=?
        AND (SELECT COUNT(*) FROM entitlement_events ge WHERE ge.payment_attempt_id=refund_requests.payment_attempt_id AND ge.kind IN ('grant','renewal') AND ge.id IN (${slots(grantIds)}))=?
        ${cancelGate}`)
      .bind(operation,input.refundId,input.operatorUserId,grantIds.length,...grantIds,grantIds.length,...(cancelIds.length?[...cancelIds,cancelIds.length]:[])),
  ];
  for (const d of input.decisions) {
    statements.push(db.prepare(`INSERT INTO refund_access_review_decisions(refund_request_id,grant_event_id,decision_version,decision,decided_by_user_id,note,resolution_operation_id)
      SELECT r.id,?,(SELECT COALESCE(MAX(v.decision_version),0)+1 FROM refund_access_review_decisions v WHERE v.refund_request_id=r.id AND v.grant_event_id=?),?,?,?,?
      FROM refund_requests r WHERE r.id=? AND r.status='confirmed' AND r.last_operation_id=?`)
      .bind(d.grantEventId,d.grantEventId,d.decision,input.operatorUserId,d.note.trim(),operation,input.refundId,operation));
  }
  statements.push(db.prepare(`UPDATE entitlements SET active=0,cancelled_at=CURRENT_TIMESTAMP,cancelled_by_user_id=?,updated_at=CURRENT_TIMESTAMP,last_refund_operation_id=?
    WHERE active=1 AND EXISTS(SELECT 1 FROM refund_requests r
      JOIN refund_access_review_decisions d ON d.refund_request_id=r.id AND d.decision='cancel_interval' AND d.resolution_operation_id=?
      JOIN entitlement_events ge ON ge.id=d.grant_event_id AND ge.payment_attempt_id=r.payment_attempt_id
      WHERE r.id=? AND r.last_operation_id=? AND r.status='confirmed'
        AND entitlements.source_event_id=ge.id AND datetime(entitlements.activated_at)=datetime(ge.activated_at) AND datetime(entitlements.expires_at)=datetime(ge.expires_at))`)
    .bind(input.operatorUserId,operation,operation,input.refundId,operation));
  statements.push(db.prepare(`INSERT INTO entitlement_events(event_key,order_id,payment_attempt_id,buyer_user_id,payer_organization_id,sku,kind,granted_days,activated_at,expires_at)
    SELECT 'review_cancel:'||CAST(r.id AS TEXT)||':grant:'||CAST(ge.id AS TEXT),r.order_id,r.payment_attempt_id,ge.buyer_user_id,ge.payer_organization_id,ge.sku,'refund_reversal',0,CURRENT_TIMESTAMP,NULL
    FROM refund_requests r JOIN refund_access_review_decisions d ON d.refund_request_id=r.id AND d.decision='cancel_interval' AND d.resolution_operation_id=?
    JOIN entitlement_events ge ON ge.id=d.grant_event_id
    WHERE r.id=? AND r.last_operation_id=? AND EXISTS(SELECT 1 FROM entitlements e WHERE e.source_event_id=ge.id AND e.active=0 AND e.last_refund_operation_id=?)
    ON CONFLICT(event_key) DO NOTHING`).bind(operation,input.refundId,operation,operation));
  statements.push(db.prepare(`UPDATE refund_access_reviews SET status='resolved',resolved_at=CURRENT_TIMESTAMP,resolved_by_user_id=?,resolution_note=?
    WHERE refund_request_id=? AND status='open'
      AND EXISTS(SELECT 1 FROM refund_requests r WHERE r.id=refund_access_reviews.refund_request_id AND r.last_operation_id=? AND r.status='confirmed')
      AND (SELECT COUNT(*) FROM refund_access_review_decisions d WHERE d.refund_request_id=refund_access_reviews.refund_request_id AND d.resolution_operation_id=?)=?
      AND NOT EXISTS(SELECT 1 FROM refund_access_review_decisions d WHERE d.refund_request_id=refund_access_reviews.refund_request_id AND d.resolution_operation_id=?
        AND (d.decision='credit_review' OR (d.decision='cancel_interval' AND NOT EXISTS(SELECT 1 FROM entitlements e WHERE e.source_event_id=d.grant_event_id AND e.active=0 AND e.last_refund_operation_id=?))))`)
    .bind(input.operatorUserId,input.resolutionNote.trim(),input.refundId,operation,operation,grantIds.length,operation,operation));
  statements.push(db.prepare(`UPDATE refund_requests SET access_reconciliation_status='applied'
    WHERE id=? AND last_operation_id=? AND EXISTS(SELECT 1 FROM refund_access_reviews rv WHERE rv.refund_request_id=refund_requests.id AND rv.status='resolved')`)
    .bind(input.refundId,operation));
  statements.push(db.prepare(`INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
    SELECT ?,CASE WHEN rv.status='resolved' THEN 'refund.review_resolved' ELSE 'refund.review_decisions_recorded' END,'refund_access_reviews',CAST(rv.refund_request_id AS TEXT),'{"status":"open"}',?,CURRENT_TIMESTAMP
    FROM refund_access_reviews rv JOIN refund_requests r ON r.id=rv.refund_request_id WHERE r.id=? AND r.last_operation_id=?`)
    .bind(input.operatorUserId,JSON.stringify({operation_id:operation,resolution_note:input.resolutionNote.trim(),decisions:input.decisions}),input.refundId,operation));
  return statements;
}

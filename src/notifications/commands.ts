import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
export function retryNotificationStatements(db: D1Database, input: {id: number; actorUserId: string; operationId: string}): D1PreparedStatement[] {
  return [
    // R96-N04: the operator retry also RESETS the idempotency window anchor.
    // An explicit, audited operator action takes responsibility for one more
    // keyed attempt; without the reset the drain would immediately re-dead-
    // letter the row as idempotency_window_expired.
    db.prepare(`UPDATE notification_outbox SET status='queued',attempts=0,first_attempt_at=NULL,lease_token=NULL,lease_until=NULL,
      next_attempt_at=CURRENT_TIMESTAMP,last_error='operator_retry',updated_at=CURRENT_TIMESTAMP,last_operation_id=?
      WHERE id=? AND status IN ('failed','dead_letter','suppressed')
        AND EXISTS(SELECT 1 FROM users WHERE id=? AND is_active=1 AND role IN ('admin','super_admin'))`)
      .bind(input.operationId,input.id,input.actorUserId),
    db.prepare(`INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
      SELECT ?,'notification.retry','notification_outbox',CAST(id AS TEXT),'{}','{"status":"queued","by":"operator","idempotency_window":"reset"}',CURRENT_TIMESTAMP
      FROM notification_outbox WHERE id=? AND last_operation_id=?`).bind(input.actorUserId,input.id,input.operationId),
  ];
}

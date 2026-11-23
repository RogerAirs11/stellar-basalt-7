-- R95: operation-scoped task side effects and notification delivery claims.
ALTER TABLE workspace_tasks ADD COLUMN last_operation_id TEXT;
ALTER TABLE notification_outbox ADD COLUMN lease_token TEXT;
ALTER TABLE notification_outbox ADD COLUMN lease_until TEXT;
ALTER TABLE notification_outbox ADD COLUMN provider_name TEXT;
ALTER TABLE notification_outbox ADD COLUMN delivery_operation_id TEXT;
ALTER TABLE notification_preferences ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Asia/Tehran';
CREATE INDEX IF NOT EXISTS idx_notification_outbox_lease ON notification_outbox(status,lease_until,next_attempt_at);

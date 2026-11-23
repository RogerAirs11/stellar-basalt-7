-- R97 additive integrity metadata. Historical evidence is not rewritten.
-- A proposal identity binds approval to the exact immutable event snapshot.
ALTER TABLE refund_allocations ADD COLUMN proposal_operation_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_refund_allocation_proposal_operation
  ON refund_allocations(proposal_operation_id) WHERE proposal_operation_id IS NOT NULL;

-- Fair bounded reminder scans, including temporarily ineligible recipients.
ALTER TABLE workspace_tasks ADD COLUMN reminder_checked_at TEXT;
CREATE INDEX IF NOT EXISTS idx_workspace_reminder_scan
  ON workspace_tasks(status,COALESCE(reminder_checked_at,''),due_date,id);

-- Hash of the outbound request AND provider/account identity, never raw mail
-- or credentials. A retry may not silently change provider or content.
ALTER TABLE notification_outbox ADD COLUMN dispatch_fingerprint TEXT;

-- Reviews reuse entitlements.last_refund_operation_id from migration 0063.

-- Old/unscoped inquiry observations never become merchant-bound release proof.
ALTER TABLE payment_events ADD COLUMN inquiry_provider_scope TEXT;
ALTER TABLE payment_events ADD COLUMN inquiry_authority TEXT;

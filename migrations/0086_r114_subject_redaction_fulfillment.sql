-- R114-01 (Master AI R113 handoff): the subject-request FULFILLMENT executor
-- model. A decision (grant) stays a decision; execution is a separate audited
-- operation with its own receipt. This migration is ADDITIVE ONLY.
--
-- Guarantees encoded here:
--  - execution_status is NULL until a fulfillment attempt actually completes;
--    a refused/blocked/failed attempt writes nothing to this table.
--  - one request -> at most one execution receipt (the conditional UPDATE in
--    the executor guards on execution_status IS NULL, so a retry can never
--    claim a second completion; it reads the stored receipt instead).
--  - the receipt marker (execution_receipt_operation_id) is distinct from the
--    decision's operation_id and from the immutable intake operation_id.
ALTER TABLE subject_redaction_requests ADD COLUMN execution_status TEXT
  CHECK (execution_status IS NULL OR execution_status IN ('completed','partial'));
ALTER TABLE subject_redaction_requests ADD COLUMN executed_at TEXT;
ALTER TABLE subject_redaction_requests ADD COLUMN execution_receipt_operation_id TEXT;
ALTER TABLE subject_redaction_requests ADD COLUMN execution_receipt_json TEXT
  CHECK (execution_receipt_json IS NULL OR length(execution_receipt_json) <= 2000);
CREATE INDEX IF NOT EXISTS idx_subject_redaction_execution_pending
  ON subject_redaction_requests(status, execution_status) WHERE execution_status IS NULL;

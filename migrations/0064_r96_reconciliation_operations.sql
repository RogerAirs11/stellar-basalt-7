-- Append-only operation provenance; no financial rows are deleted or guessed.
ALTER TABLE billing_review_cases ADD COLUMN last_operation_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_review_operation ON billing_review_cases(last_operation_id) WHERE last_operation_id IS NOT NULL;

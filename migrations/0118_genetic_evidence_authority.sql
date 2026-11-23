-- R148: legacy genetic intake/review has explicit scoped authority. Existing
-- reports retain their raw content and unknown submitters remain unknown.
-- No professional grants are automatically created or broadened.
ALTER TABLE genetic_tests ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE genetic_tests ADD COLUMN created_by_user_id TEXT REFERENCES users(id);
ALTER TABLE genetic_tests ADD COLUMN intake_operation_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS genetic_tests_intake_operation ON genetic_tests(intake_operation_id);

-- Private immutable command receipts. request_json/decision_json may contain
-- confidential report or review information and must never enter public or
-- generic staff audit/export surfaces. A successful operation has one receipt
-- and one minimal audit row in the same transaction.
CREATE TABLE IF NOT EXISTS genetic_evidence_operations (
  operation_id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL,
  test_id INTEGER NOT NULL REFERENCES genetic_tests(id),
  horse_id INTEGER NOT NULL REFERENCES horses(id),
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL CHECK(action IN ('intake','interpretation','pairing_review')),
  request_json TEXT NOT NULL,
  decision_json TEXT NOT NULL,
  private_detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS genetic_evidence_operations_history ON genetic_evidence_operations(test_id,created_at,operation_id);

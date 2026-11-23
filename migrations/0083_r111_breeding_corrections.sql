-- Additive, row-preserving concurrency and idempotency for reviewed date corrections.
-- Existing historical calendar values are deliberately left unchanged.
ALTER TABLE breeding_records ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE breeding_records ADD COLUMN last_correction_id TEXT;

CREATE TABLE IF NOT EXISTS breeding_record_corrections (
  operation_id TEXT PRIMARY KEY,
  write_token TEXT NOT NULL UNIQUE,
  record_id INTEGER NOT NULL REFERENCES breeding_records(id),
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  expected_version INTEGER NOT NULL,
  request_json TEXT NOT NULL,
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS breeding_record_corrections_record ON breeding_record_corrections(record_id, created_at);

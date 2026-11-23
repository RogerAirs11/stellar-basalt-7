-- Master-Ai plan T11: complete new-horse submission and review.
--
-- A structured submission lives on its change_requests row (request_type
-- 'create_horse'): the typed payload in submission_json, the client dedupe
-- key in idempotency_key, the reviewer's structured outcome in review_outcome
-- and — only after the canonical horse actually landed — the new record's id
-- in canonical_horse_id. The status CHECK of 0001 is NOT widened (SQLite
-- cannot ALTER a CHECK; a table rebuild would cascade-delete every
-- change_request_items row): 'needs_changes' is recorded as status='draft'
-- plus review_outcome='needs_changes' so the submitter can edit and
-- resubmit, which is exactly the workflow the plan asks for
-- (draft -> pending -> needs_changes -> draft -> ... -> approved/rejected).
ALTER TABLE change_requests ADD COLUMN submission_json TEXT;
ALTER TABLE change_requests ADD COLUMN review_outcome TEXT;
ALTER TABLE change_requests ADD COLUMN canonical_horse_id INTEGER REFERENCES horses(id) ON DELETE SET NULL;
ALTER TABLE change_requests ADD COLUMN idempotency_key TEXT;

-- True idempotency: one row per (submitter, client key). A double-clicked
-- submit hits this index and the API replays the original row instead of
-- creating a second pending submission. NULL keys (legacy rows, non-submission
-- requests) are unlimited.
CREATE UNIQUE INDEX IF NOT EXISTS uq_change_requests_idempotency
  ON change_requests(submitted_by_user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- The review queue reads undecided create_horse submissions first.
CREATE INDEX IF NOT EXISTS idx_change_requests_review_queue
  ON change_requests(status, request_type, created_at DESC);

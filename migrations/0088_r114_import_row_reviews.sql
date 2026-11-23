-- R114-03 (Master AI R113 handoff, NEXT_BACKEND.md D31-A): the staged-import
-- operator review surface. Additive only.
--
-- Guarantees encoded here:
--  - import_row_reviews is the IMMUTABLE decision history: every reviewer
--    decision records the prior row state (action/outcome/horse_id) and the
--    state it produced, so the original staged row and every prior decision
--    stay inspectable forever.
--  - one receipt per caller operation key (UNIQUE): an exact same-key retry
--    replays the stored response; a reused key with different content is
--    refused by the handler before any write.
--  - decisions never write canonical data: they only move a staging row's
--    outcome/classification. The apply command remains the only canonical
--    writer; merges stay on their separately authorized command.
--  - last_review_operation_id marks the exact decision that produced the
--    current state; the receipt and audit are gated on that marker inside
--    the same transaction (a losing or demoted writer claims nothing).
ALTER TABLE import_staging_rows ADD COLUMN last_review_operation_id TEXT;

CREATE TABLE IF NOT EXISTS import_row_reviews (
  id INTEGER PRIMARY KEY,
  row_id INTEGER NOT NULL REFERENCES import_staging_rows(id) ON DELETE CASCADE,
  batch_id INTEGER NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK (decision IN ('skip','reclassify','target_override')),
  reason TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  prior_row_action TEXT NOT NULL,
  prior_outcome TEXT NOT NULL,
  prior_horse_id INTEGER,
  new_row_action TEXT NOT NULL,
  new_outcome TEXT NOT NULL,
  new_horse_id INTEGER,
  decided_by_user_id TEXT NOT NULL,
  operation_id TEXT NOT NULL UNIQUE,
  receipt_json TEXT NOT NULL CHECK (length(receipt_json) <= 4000),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_import_row_reviews_batch ON import_row_reviews(batch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_import_row_reviews_row ON import_row_reviews(row_id, created_at DESC);

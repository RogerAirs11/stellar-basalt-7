-- R108-08: durable per-row task-import receipts.
-- import_intent_key records WHICH client import intent accepted a row, so an
-- interrupted import can be replayed with the SAME intent and reconciled to
-- the exact accepted rows: rows a previous attempt already accepted report
-- "already_imported" and are never re-executed or duplicated, while the rows
-- that never landed are imported normally. Rows that pre-date the intent (a
-- different import or a manual creation of the same occurrence) keep the
-- honest "occurrence_exists" skip. Additive-only; NULL for every pre-existing
-- and manually-created task (no backfill, no semantics change for them).

ALTER TABLE workspace_tasks ADD COLUMN import_intent_key TEXT;

CREATE INDEX IF NOT EXISTS idx_workspace_tasks_import_intent
  ON workspace_tasks(collection_id, import_intent_key);

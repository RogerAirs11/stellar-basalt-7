-- A policy revision exists even when there are no active rules. Taking its
-- row lock in a separate statement gives PostgreSQL the same post-lock
-- context check as an atomic SQLite/D1 batch.
CREATE TABLE IF NOT EXISTS registry_policy_state (
  id INTEGER PRIMARY KEY CHECK (id=1),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision>=0),
  commit_guard INTEGER NOT NULL DEFAULT 1 CONSTRAINT registry_policy_context_current CHECK (commit_guard=1),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO registry_policy_state(id,revision) VALUES(1,0);

ALTER TABLE registry_rules ADD COLUMN last_policy_operation_id TEXT;
-- Review pins the exact draft/proposal content it evaluated. Child item
-- edits are conditioned on the parent command marker, including CAS losers.
ALTER TABLE change_requests ADD COLUMN content_revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE change_requests ADD COLUMN last_edit_operation_id TEXT;
ALTER TABLE registry_rule_outcomes ADD COLUMN operation_id TEXT;
ALTER TABLE registry_rule_outcomes ADD COLUMN policy_revision INTEGER;
CREATE INDEX IF NOT EXISTS idx_registry_rule_outcomes_operation ON registry_rule_outcomes(operation_id);

-- Immutable decision evidence. subject_ref is a historical reference, not a
-- live horse foreign key: merge/unmerge must not rewrite the original input.
CREATE TABLE IF NOT EXISTS registry_policy_receipts (
  operation_id TEXT PRIMARY KEY,
  policy_revision INTEGER NOT NULL,
  subject_type TEXT NOT NULL,
  subject_ref TEXT,
  decision TEXT NOT NULL CHECK (decision IN ('accepted','rejected')),
  evaluated_rules_json TEXT NOT NULL,
  context_json TEXT NOT NULL,
  actor_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_registry_policy_receipts_subject ON registry_policy_receipts(subject_type,subject_ref,created_at);

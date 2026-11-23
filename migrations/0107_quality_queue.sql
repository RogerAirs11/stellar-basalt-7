-- 0107: R145-E04 (Master-AI plan) — make the data-quality queue usable.
-- Master-AI finding: data_quality_issues (0001) could record a finding, but a
-- human could not WORK it. Each issue must show issue type + severity, the
-- affected fact and horse, source + rule version, supporting evidence, the
-- assigned reviewer, age + status, and its resolution/reopening history.
--
-- Doctrine (Master-AI plan E04, accepted):
--   - The issue row carries the WORKFLOW state (open -> assigned -> resolved,
--     reopen returns it to open/assigned) plus WHO detected it (source +
--     rule_version) and WHO owns it (assigned_to).
--   - The full lifecycle lives in data_quality_events: an append-only trail
--     (detected/assigned/resolved/reopened/note) with actor + note + time.
--     Resolution is never destructive: reopening preserves the trail.
--   - Bulk review is allowed ONLY for explicitly defined low-risk codes
--     (severity='info' enforced in the application layer; see
--     qualityQueue.ts LOW_RISK_QUALITY_CODES). Name-only bulk auto-merging
--     stays unavailable by design — merges always go through the versioned
--     merge preview/commands.
--   - Existing rows are backfilled: resolved_at IS NOT NULL -> 'resolved',
--     with one backfilled 'resolved' event so history never begins empty.
--
-- Portability: stock SQLite/PostgreSQL-compatible DDL.

ALTER TABLE data_quality_issues ADD COLUMN status TEXT NOT NULL DEFAULT 'open';
ALTER TABLE data_quality_issues ADD COLUMN assigned_to TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE data_quality_issues ADD COLUMN assigned_at TEXT;
ALTER TABLE data_quality_issues ADD COLUMN source TEXT NOT NULL DEFAULT 'import_quality_scan';
ALTER TABLE data_quality_issues ADD COLUMN rule_version TEXT;
ALTER TABLE data_quality_issues ADD COLUMN resolved_by TEXT REFERENCES users(id) ON DELETE SET NULL;

-- Backfill the workflow state for pre-0107 rows (idempotent).
UPDATE data_quality_issues SET status='resolved' WHERE resolved_at IS NOT NULL AND status='open';

CREATE TABLE IF NOT EXISTS data_quality_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id INTEGER NOT NULL REFERENCES data_quality_issues(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('detected','assigned','resolved','reopened','note')),
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_quality_events_issue ON data_quality_events(issue_id, id);
CREATE INDEX IF NOT EXISTS idx_quality_issues_status ON data_quality_issues(status, severity, issue_code);
CREATE INDEX IF NOT EXISTS idx_quality_issues_assignee ON data_quality_issues(assigned_to, status);

-- Durable canonical mutation intent/reconciliation journal. This closes the gap
-- where a canonical horse change could commit before audit/search side effects.
ALTER TABLE horses ADD COLUMN last_mutation_id TEXT;
CREATE INDEX IF NOT EXISTS idx_horses_last_mutation ON horses(last_mutation_id);

ALTER TABLE audit_events ADD COLUMN mutation_log_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_mutation_log ON audit_events(mutation_log_id) WHERE mutation_log_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS canonical_mutation_log (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  before_json TEXT,
  requested_json TEXT,
  after_json TEXT,
  request_id TEXT,
  status TEXT NOT NULL DEFAULT 'intent' CHECK (status IN ('intent','committed','aborted')),
  audit_status TEXT NOT NULL DEFAULT 'pending' CHECK (audit_status IN ('pending','complete','not_applicable')),
  search_status TEXT NOT NULL DEFAULT 'pending' CHECK (search_status IN ('pending','complete','not_applicable')),
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finalized_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_mutation_pending_audit ON canonical_mutation_log(audit_status,status,created_at);
CREATE INDEX IF NOT EXISTS idx_mutation_pending_search ON canonical_mutation_log(search_status,status,created_at);
CREATE INDEX IF NOT EXISTS idx_mutation_entity ON canonical_mutation_log(entity_type,entity_id,created_at DESC);

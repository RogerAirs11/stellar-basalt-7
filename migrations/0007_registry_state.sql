-- Lightweight canonical/derived generation state. Online canonical mutations mark
-- analytics stale in the same D1 batch; offline analytics generation clears it.
CREATE TABLE IF NOT EXISTS registry_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  canonical_revision INTEGER NOT NULL DEFAULT 0,
  analytics_stale INTEGER NOT NULL DEFAULT 1 CHECK (analytics_stale IN (0,1)),
  analytics_source_revision TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO registry_state(id,canonical_revision,analytics_stale) VALUES(1,0,1);

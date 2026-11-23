CREATE TABLE IF NOT EXISTS horse_search_reindex_queue (
  horse_id INTEGER PRIMARY KEY REFERENCES horses(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  queued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_search_reindex_queued ON horse_search_reindex_queue(queued_at);

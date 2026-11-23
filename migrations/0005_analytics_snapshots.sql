-- Disposable, rebuildable analytics. Canonical horse/person records remain the source of truth.
CREATE TABLE IF NOT EXISTS analytics_snapshots (
  key TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  algorithm_version TEXT NOT NULL,
  source_revision TEXT NOT NULL,
  source_horse_count INTEGER NOT NULL,
  generated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_analytics_snapshots_generated ON analytics_snapshots(generated_at DESC);

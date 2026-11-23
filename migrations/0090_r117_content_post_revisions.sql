-- R117-17 (Master AI handoff D26): the bilingual editorial workflow gains an
-- immutable per-post version history. Every governed transition — create,
-- update, publish, retract — records one snapshot row so editors can review
-- exactly what changed and when, while public reads keep serving only the
-- current published projection. Snapshots are append-only: the application
-- never rewrites history rows.
CREATE TABLE IF NOT EXISTS content_post_revisions (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES content_posts(id) ON DELETE CASCADE,
  revision_no INTEGER NOT NULL,
  cause TEXT NOT NULL CHECK (cause IN ('create','update','publish','retract')),
  from_status TEXT NOT NULL CHECK (from_status IN ('draft','published','archived')),
  to_status TEXT NOT NULL CHECK (to_status IN ('draft','published','archived')),
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_label TEXT,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_content_post_revisions_post ON content_post_revisions(post_id, revision_no);
CREATE INDEX IF NOT EXISTS idx_content_post_revisions_recent ON content_post_revisions(created_at DESC);

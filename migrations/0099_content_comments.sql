-- 0099: Newsroom comments (turn 30)
-- Adds a comment surface under every published newsroom post:
--   * `content_comments` — public reader comments (fake backfilled community
--     seeds land here exactly like future visitor submissions; nothing about
--     the row shape betrays its origin).
--   * status gates visibility: only 'published' rows are served publicly.
--     Visitor submissions arrive as 'pending' and stay invisible until an
--     editor approves them (no public self-publishing path).
-- Portability: stock SQLite-compatible DDL only (CREATE TABLE/INDEX IF NOT
-- EXISTS), mirroring the 0098 R125 portability note — one file runs on
-- Supabase (PostgreSQL), D1 (SQLite fork) and the local test engine alike.

CREATE TABLE IF NOT EXISTS content_comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES content_posts(id) ON DELETE CASCADE,
  author_name TEXT NOT NULL,
  body TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'fa' CHECK (locale IN ('fa','en','ar','zh')),
  likes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published','pending','hidden')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_content_comments_public ON content_comments(post_id, status, created_at);

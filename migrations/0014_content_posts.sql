-- Bilingual newsroom content: public articles/news/updates plus governed AI provenance.
CREATE TABLE IF NOT EXISTS content_posts (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('article','news','update')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  title_en TEXT NOT NULL,
  title_fa TEXT NOT NULL,
  summary_en TEXT NOT NULL DEFAULT '',
  summary_fa TEXT NOT NULL DEFAULT '',
  body_en TEXT NOT NULL,
  body_fa TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  sources_json TEXT NOT NULL DEFAULT '[]',
  author_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  author_label TEXT,
  ai_model TEXT,
  ai_grounding INTEGER NOT NULL DEFAULT 0 CHECK (ai_grounding IN (0,1)),
  ai_prompt TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TEXT,
  row_version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_content_posts_public ON content_posts(status, published_at DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_posts_kind ON content_posts(kind, status, published_at DESC);

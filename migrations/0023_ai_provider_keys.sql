-- Admin-managed AI provider API keys.
-- Keys added here extend/rotate the environment-provided keys (GEMINI_API_KEY /
-- GEMINI_API_KEYS). Rotation is per-request: when a key is rate-limited (429)
-- the runtime advances to the next available key before falling back to the
-- alternate provider. Keys are never returned in full by any API surface.
CREATE TABLE IF NOT EXISTS ai_provider_keys (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  api_key TEXT NOT NULL,
  is_enabled INTEGER NOT NULL DEFAULT 1,
  last_status TEXT,
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_provider_keys_provider
  ON ai_provider_keys(provider, is_enabled, created_at);

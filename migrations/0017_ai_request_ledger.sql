-- Conservative provider-request quota/cost ledger. Attempts are recorded before network I/O.
CREATE TABLE IF NOT EXISTS ai_request_ledger (
  id TEXT PRIMARY KEY,
  conversation_id TEXT REFERENCES ai_conversations(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  request_kind TEXT NOT NULL DEFAULT 'chat',
  attempted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  status TEXT NOT NULL DEFAULT 'attempted' CHECK (status IN ('attempted','success','failed','cancelled','rejected')),
  estimated_input_tokens INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  thought_tokens INTEGER NOT NULL DEFAULT 0,
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  tool_tokens INTEGER NOT NULL DEFAULT 0,
  cache_hit_tokens INTEGER NOT NULL DEFAULT 0,
  cache_miss_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd REAL NOT NULL DEFAULT 0,
  actual_cost_usd REAL NOT NULL DEFAULT 0,
  error_code TEXT,
  latency_ms INTEGER
);
CREATE INDEX IF NOT EXISTS idx_ai_requests_provider_attempted ON ai_request_ledger(provider,attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_requests_conversation ON ai_request_ledger(conversation_id,attempted_at DESC);

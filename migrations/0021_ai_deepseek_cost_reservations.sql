-- Reserve full-cache-miss worst-case DeepSeek cost before network I/O.
CREATE TABLE IF NOT EXISTS ai_cost_reservations (
  id TEXT PRIMARY KEY,
  request_ledger_id TEXT NOT NULL UNIQUE REFERENCES ai_request_ledger(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  reserved_cost_usd REAL NOT NULL CHECK (reserved_cost_usd >= 0),
  reconciled_cost_usd REAL,
  status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','reconciled','released')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ai_cost_reservations_provider_created ON ai_cost_reservations(provider,created_at DESC);

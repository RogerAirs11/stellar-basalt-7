CREATE TABLE IF NOT EXISTS horse_claims (
  id TEXT PRIMARY KEY,
  horse_id INTEGER NOT NULL REFERENCES horses(id) ON DELETE RESTRICT,
  claimant_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','revoked')),
  evidence_json TEXT,
  reviewed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  review_note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT,
  UNIQUE(horse_id, claimant_user_id)
);
CREATE INDEX IF NOT EXISTS idx_horse_claims_status ON horse_claims(status, created_at DESC);

-- 0047_dossiers.sql
-- R88 agent plan P15: shareable sale dossiers with expiry and evidence limits.
--
-- Doctrine:
--   1. A dossier is a VERSIONED, FROZEN snapshot of PERMITTED data. The
--      snapshot_json never changes after creation — a later canonical
--      correction does not silently rewrite an already-shared dossier; it
--      only makes the view report staleness live (horse.updated_at vs the
--      snapshot's generated_at).
--   2. Share links carry a HIGH-ENTROPY token (32 random bytes, base64url).
--      Only the SHA-256 HASH of the token is stored — the token itself
--      exists solely in the URL handed to the recipient.
--   3. Links are revocable and expire; a revoked or expired link returns
--      410 and reveals NOTHING, including to caches (no-store).
--   4. Every section records its source, review state and generated_at;
--      redacted sections stay VISIBLE as "not shared" — absence is never
--      presented as a clean/verified state.
--   5. A dossier is neither a title transfer nor a veterinary purchase
--      examination — the warning ships with every view. Paid formatting
--      could never buy a verification badge here (none exists).
--
-- Portable relational SQL (SQLite/D1 + Postgres translation verified).

CREATE TABLE IF NOT EXISTS dossier_snapshots (
  id INTEGER PRIMARY KEY,
  horse_id INTEGER NOT NULL REFERENCES horses(id) ON DELETE CASCADE,
  created_by_user_id TEXT NOT NULL,
  -- Version of the dossier format (starts at 1; bump only for format changes).
  version INTEGER NOT NULL DEFAULT 1,
  -- The FROZEN permitted snapshot (identity + explicitly included sections).
  snapshot_json TEXT NOT NULL,
  -- Per-section provenance: name -> { source, review_state, generated_at }.
  sections_meta_json TEXT NOT NULL,
  -- Active by default; revocation is terminal for the dossier's links.
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  row_version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_dossier_snapshots_horse
  ON dossier_snapshots(horse_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dossier_snapshots_creator
  ON dossier_snapshots(created_by_user_id, created_at DESC);

-- Share links: token HASH only, expiry, optional authenticated-recipient
-- restriction, revocation and access counters.
CREATE TABLE IF NOT EXISTS dossier_share_links (
  id INTEGER PRIMARY KEY,
  dossier_id INTEGER NOT NULL REFERENCES dossier_snapshots(id) ON DELETE CASCADE,
  -- sha256(token) — the raw token is never stored anywhere.
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  recipient_user_id TEXT,
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT,
  revoked_by_user_id TEXT,
  access_count INTEGER NOT NULL DEFAULT 0,
  last_accessed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_dossier_links_dossier
  ON dossier_share_links(dossier_id, revoked_at, expires_at);

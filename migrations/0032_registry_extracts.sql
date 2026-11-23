-- Master-Ai plan T06 (finding F04): replace mutable certificates with
-- versioned registry extracts. The legacy registry_certificates table hashed
-- horseId+language+code (not facts), and the SVG renders LIVE data, so an old
-- verification code could appear next to changed facts. This table stores the
-- full canonical payload snapshot per issuance: each extract gets its own
-- secure random code, and verification replays the STORED facts (never live),
-- flags revoked status, and notes when the registry has changed since
-- issuance. Payloads are visibility-filtered at build time, so private
-- evidence never enters an extract.
CREATE TABLE IF NOT EXISTS registry_extracts (
  id TEXT PRIMARY KEY,
  horse_id INTEGER NOT NULL REFERENCES horses(id) ON DELETE CASCADE,
  extract_code TEXT NOT NULL UNIQUE,
  language TEXT NOT NULL DEFAULT 'fa' CHECK (language IN ('fa','en')),
  template_version TEXT NOT NULL,
  payload TEXT NOT NULL,
  payload_digest TEXT NOT NULL,
  issued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  issued_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  revoked_at TEXT,
  revoked_reason TEXT,
  CHECK (status='active' OR (revoked_at IS NOT NULL AND revoked_reason IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_registry_extracts_horse ON registry_extracts(horse_id, issued_at DESC);

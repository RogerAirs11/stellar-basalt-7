-- R98-N04: structured issuer scopes — versioned approval, effective
-- intervals, suspension and revocation as ENFORCED access rules (never
-- free-text), plus documented registration evidence for issuers.
-- R98-N05: immutable server-derived attestation evidence snapshots, bound to
-- the issuance operation in one consistency boundary.
-- Additive only: no existing row is rewritten, no history is deleted.

-- N04 -----------------------------------------------------------------------
-- One APPROVED (or SUSPENDED, which keeps visible history while blocking
-- commands) scope per issuer + record kind. Revoked/superseded versions stay
-- as history rows; scope_version makes re-approval an explicit new version.
CREATE TABLE IF NOT EXISTS issuer_scopes (
  id TEXT PRIMARY KEY,
  issuer_id TEXT NOT NULL REFERENCES issuers(id) ON DELETE CASCADE,
  record_kind TEXT NOT NULL CHECK (record_kind IN ('genetic_test','media','competition_result','horse_identity')),
  status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('approved','suspended','revoked','superseded')),
  scope_version INTEGER NOT NULL CHECK (scope_version >= 1),
  valid_from TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  valid_until TEXT,
  evidence_note TEXT NOT NULL,
  approved_by_user_id TEXT NOT NULL REFERENCES users(id),
  approved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  suspended_at TEXT,
  suspended_reason TEXT,
  revoked_at TEXT,
  revoked_reason TEXT,
  superseded_by TEXT REFERENCES issuer_scopes(id) DEFERRABLE INITIALLY DEFERRED,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (status='approved' OR (status='suspended' AND suspended_at IS NOT NULL)
         OR (status='revoked' AND revoked_at IS NOT NULL AND revoked_reason IS NOT NULL)
         OR (status='superseded' AND superseded_by IS NOT NULL)),
  UNIQUE (issuer_id, record_kind, scope_version)
);
CREATE INDEX IF NOT EXISTS idx_issuer_scopes_live ON issuer_scopes(issuer_id, record_kind, status);
CREATE UNIQUE INDEX IF NOT EXISTS issuer_one_live_scope ON issuer_scopes(issuer_id, record_kind)
  WHERE status IN ('approved','suspended');

-- Structured permitted actions: a scope row alone never implies supersede
-- rights; each action is its own enforceable row.
CREATE TABLE IF NOT EXISTS issuer_scope_actions (
  scope_id TEXT NOT NULL REFERENCES issuer_scopes(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('attest','supersede')),
  PRIMARY KEY (scope_id, action)
);

-- N04 step 1: documentary evidence establishing issuer authority is recorded
-- at registration. Legacy issuers carry NULL and REQUIRE platform review
-- before any scope may be approved for them.
ALTER TABLE issuers ADD COLUMN registration_evidence TEXT;
ALTER TABLE issuers ADD COLUMN registration_reviewed_at TEXT;
ALTER TABLE issuers ADD COLUMN registration_reviewed_by_user_id TEXT REFERENCES users(id);

-- N05 -----------------------------------------------------------------------
-- The immutable evidence snapshot bound to an attestation at issuance.
-- canonical_json is PRIVATE (authorized review only); public verification
-- exposes the digest and per-row version markers, never the bytes.
CREATE TABLE IF NOT EXISTS attestation_snapshots (
  id TEXT PRIMARY KEY,
  attestation_id TEXT NOT NULL UNIQUE REFERENCES attestations(id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL,
  record_kind TEXT NOT NULL CHECK (record_kind IN ('genetic_test','media','competition_result','horse_identity')),
  record_id TEXT NOT NULL,
  horse_id INTEGER NOT NULL REFERENCES horses(id) ON DELETE CASCADE,
  canonical_json TEXT NOT NULL,
  content_digest TEXT NOT NULL,
  source_row_versions TEXT NOT NULL,
  issuer_scope_snapshot TEXT NOT NULL,
  operation_id TEXT NOT NULL UNIQUE,
  is_private INTEGER NOT NULL DEFAULT 1 CHECK (is_private IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_attestation_snapshots_record ON attestation_snapshots(record_kind, record_id);

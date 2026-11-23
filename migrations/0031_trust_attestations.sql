-- Master-Ai plan T05 (finding F03): separate editorial review from issuer
-- attestation. Today a platform editor can stamp "federation" vocabulary on
-- records through ordinary write endpoints; nothing models WHO is actually
-- entitled to attest, in WHICH scope, for WHICH issuer. This migration adds
-- the issuer substrate: organizations (labs, federations, clinics), scoped
-- memberships with validity windows, evidence-bound attestations, and an
-- append-only attestation event log.
--
-- Vocabulary note: the existing horse_media.verification value
-- 'federation_verified' is a LEGACY STORAGE TOKEN that has only ever been set
-- by platform staff review (no external federation integration exists). T05
-- renames the concept at the API/UI layer to "platform_reviewed"; the storage
-- token is unchanged in this migration to avoid a risky parent-table rebuild.
-- A future migration may rebuild the vocabulary once warranted.

CREATE TABLE IF NOT EXISTS issuers (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  name_native TEXT,
  kind TEXT NOT NULL DEFAULT 'organization' CHECK (kind IN ('organization','laboratory','federation','clinic','government')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','retired')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL
);

-- One user may hold at most one ACTIVE membership per issuer; history rows
-- (status='revoked') are retained so the audit trail never loses a grant.
CREATE TABLE IF NOT EXISTS issuer_memberships (
  id TEXT PRIMARY KEY,
  issuer_id TEXT NOT NULL REFERENCES issuers(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'attester' CHECK (role IN ('owner','attester')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  valid_from TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  valid_until TEXT,
  revoked_at TEXT,
  revoked_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (status='active' OR (revoked_at IS NOT NULL AND revoked_reason IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_issuer_memberships_user ON issuer_memberships(user_id, status);
CREATE INDEX IF NOT EXISTS idx_issuer_memberships_issuer ON issuer_memberships(issuer_id, status);

-- Attestations are evidence-bound statements by an issuer, scoped to a record
-- (genetic test, media item, competition result or horse identity) and
-- optionally to specific fields. None of this is a universal horse-quality
-- guarantee; the public DTO must always carry scope and limitations.
CREATE TABLE IF NOT EXISTS attestations (
  id TEXT PRIMARY KEY,
  issuer_id TEXT NOT NULL REFERENCES issuers(id) ON DELETE CASCADE,
  horse_id INTEGER REFERENCES horses(id) ON DELETE CASCADE,
  record_kind TEXT NOT NULL CHECK (record_kind IN ('genetic_test','media','competition_result','horse_identity')),
  record_id TEXT NOT NULL,
  field_scope TEXT,
  statement TEXT,
  evidence_media_id TEXT REFERENCES horse_media(id) ON DELETE SET NULL,
  source_version TEXT,
  issued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','superseded')),
  revoked_at TEXT,
  revoked_reason TEXT,
  superseded_by TEXT REFERENCES attestations(id) ON DELETE SET NULL,
  superseded_at TEXT,
  superseded_reason TEXT,
  attested_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (status='active' OR (status='revoked' AND revoked_at IS NOT NULL AND revoked_reason IS NOT NULL)
         OR (status='superseded' AND superseded_by IS NOT NULL AND superseded_at IS NOT NULL AND superseded_reason IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_attestations_record ON attestations(record_kind, record_id, status);
CREATE INDEX IF NOT EXISTS idx_attestations_horse ON attestations(horse_id, status);

-- Append-only audit trail: every issuance, revocation and supersession is
-- recorded with its actor and reason. Rows are NEVER deleted or updated.
CREATE TABLE IF NOT EXISTS attestation_events (
  id TEXT PRIMARY KEY,
  attestation_id TEXT NOT NULL REFERENCES attestations(id) ON DELETE CASCADE,
  event TEXT NOT NULL CHECK (event IN ('issued','revoked','superseded')),
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_attestation_events_attestation ON attestation_events(attestation_id, created_at);

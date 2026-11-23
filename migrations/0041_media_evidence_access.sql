-- 0041_media_evidence_access.sql
-- R88 agent plan P09: secure evidence upload + private document delivery.
--
-- Three additive concerns, no data removal:
--   1. EXPLICIT publication consent for media (default PRIVATE). Until now
--      "public" was inferred from media_type/role/verification (the
--      PUBLIC_MEDIA_PREDICATE). consent_state records the publication
--      decision as a first-class fact: 'shared_public' is BACKFILLED only
--      onto rows the existing predicate already serves publicly today
--      (photo + profile/gallery + owner_submitted|federation_verified) —
--      nothing becomes MORE public than before; documents and every other
--      role stay 'private'.
--   2. Quarantine bookkeeping: quarantine_reason is the operator-visible
--      failure/staff-rejection reason. It is NEVER rendered in public
--      projections (tests pin the projection allowlist).
--   3. Short-lived access records: every minted media access token gets a
--      row with expiry + revocation, so "revoked access prevents obtaining
--      new URLs; existing URL lifetime is bounded" is auditable.
--
-- Portable relational SQL (SQLite/D1 + Postgres translation verified).

ALTER TABLE horse_media ADD COLUMN consent_state TEXT NOT NULL DEFAULT 'private'
  CHECK (consent_state IN ('private','shared_public'));

ALTER TABLE horse_media ADD COLUMN quarantine_reason TEXT;

ALTER TABLE horse_media ADD COLUMN quarantined_at TEXT;

-- Honest backfill: rows the legacy predicate ALREADY serves publicly get the
-- matching consent state. No row becomes more visible than it is today.
UPDATE horse_media
SET consent_state = 'shared_public'
WHERE media_type = 'photo'
  AND role IN ('profile','gallery')
  AND verification IN ('federation_verified','owner_submitted');

CREATE TABLE IF NOT EXISTS media_access_grants (
  id INTEGER PRIMARY KEY,
  media_id TEXT NOT NULL REFERENCES horse_media(id) ON DELETE CASCADE,
  granted_to_user_id TEXT NOT NULL,
  granted_by_user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_media_access_grants_media ON media_access_grants(media_id, revoked_at);
CREATE INDEX IF NOT EXISTS idx_media_access_grants_user ON media_access_grants(granted_to_user_id, expires_at);

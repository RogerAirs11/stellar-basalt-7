-- 0043_directory_credentials.sql
-- R88 agent plan P11: model people, organizations and professional
-- credentials separately from login users.
--
-- Existing foundations reused (not duplicated):
--   - people (0001) — registry persons (legal/historical actors)
--   - organizations + organization_memberships (0034) — login-linked orgs
--   - user_person_links (0034) — verified user<->person links (T10 doctrine)
--
-- New structures:
--   1. directory_profiles — the PUBLIC professional profile of a registry
--      person: service categories (reviewed 22-item starting vocabulary),
--      coarse service area (approved province codes + canonical city text),
--      contact preference + PRIVATE contact value, languages, availability,
--      and EXPLICIT publication consent (default 0 = not published).
--      One row per person — a person holding rider AND trainer roles is ONE
--      profile with two categories, never two records.
--   2. organization_profiles — the public service profile of an organization
--      (same consent model).
--   3. person_credentials — professional credentials with issuer, role,
--      identifier, issue/expiry dates, evidence reference and verification
--      state. Roles are distinct (dc / judge / steward / ringmaster / ...);
--      an EXPIRED credential stays as history but loses its active state
--      (computed at read time, never faked). Self-declared credentials stay
--      'unverified' — platform review and issuer attestation are the only
--      paths to higher states, mirroring the T05 verification vocabulary.
--   4. directory_claims — claim/represent requests with evidence, moderation
--      and an appeal path (appeal_for_claim_id). Approving a person claim
--      creates a VERIFIED user_person_link; approving an organization claim
--      creates a MANAGER organization_membership. Nothing auto-publishes.
--
-- Portable relational SQL (SQLite/D1 + Postgres translation verified).

CREATE TABLE IF NOT EXISTS directory_profiles (
  id INTEGER PRIMARY KEY,
  person_id INTEGER NOT NULL UNIQUE REFERENCES people(id) ON DELETE CASCADE,
  service_categories TEXT NOT NULL DEFAULT '[]',
  province_code TEXT,
  city TEXT,
  contact_preference TEXT NOT NULL DEFAULT 'platform_message' CHECK (contact_preference IN ('platform_message','phone','email')),
  contact_value TEXT,
  languages TEXT,
  availability_text TEXT,
  publication_consent INTEGER NOT NULL DEFAULT 0 CHECK (publication_consent IN (0,1)),
  published_at TEXT,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_directory_profiles_published ON directory_profiles(publication_consent, person_id);

CREATE TABLE IF NOT EXISTS organization_profiles (
  id INTEGER PRIMARY KEY,
  organization_id INTEGER NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  description TEXT,
  service_categories TEXT NOT NULL DEFAULT '[]',
  province_code TEXT,
  city TEXT,
  contact_preference TEXT NOT NULL DEFAULT 'platform_message' CHECK (contact_preference IN ('platform_message','phone','email')),
  contact_value TEXT,
  publication_consent INTEGER NOT NULL DEFAULT 0 CHECK (publication_consent IN (0,1)),
  published_at TEXT,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_organization_profiles_published ON organization_profiles(publication_consent, organization_id);

CREATE TABLE IF NOT EXISTS person_credentials (
  id INTEGER PRIMARY KEY,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  issuer_name TEXT NOT NULL,
  identifier TEXT NOT NULL,
  issued_at TEXT,
  expires_at TEXT,
  evidence_media_id TEXT,
  verification_state TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_state IN ('unverified','platform_reviewed','issuer_attested')),
  verified_by_user_id TEXT,
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(person_id, role, identifier)
);

CREATE INDEX IF NOT EXISTS idx_person_credentials_person ON person_credentials(person_id, role);

CREATE TABLE IF NOT EXISTS directory_claims (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL,
  claim_type TEXT NOT NULL CHECK (claim_type IN ('person','organization')),
  person_id INTEGER REFERENCES people(id) ON DELETE CASCADE,
  organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
  evidence_note TEXT NOT NULL,
  evidence_media_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by_user_id TEXT,
  reviewed_at TEXT,
  review_note TEXT,
  appeal_for_claim_id INTEGER REFERENCES directory_claims(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_directory_claims_status ON directory_claims(status, created_at);
CREATE INDEX IF NOT EXISTS idx_directory_claims_user ON directory_claims(user_id, status);

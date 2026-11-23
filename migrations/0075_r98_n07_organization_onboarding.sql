-- 0075_r98_n07_organization_onboarding.sql
-- R98-N07: finish organization and professional onboarding.
--
-- Entity separation stays intact: a person, a login account, a legal
-- organization and a horse owner are different entities. This migration adds
-- the pieces the reviewed plan requires WITHOUT collapsing them:
--   1. organization_profiles gains the same integrity columns the person
--      directory_profiles already carry (row_version, last_operation_id) plus
--      the N07 business fields: specialties, service areas, accessibility
--      notes, opening hours. Province scheme confirmation already exists
--      (0070) and is reused, not duplicated.
--   2. organization_staff_invites: staff invitation/acceptance lifecycle with
--      bounded expiry, no self-escalation (invitee <> inviter enforced in the
--      command layer where both ids are known), and full audit lineage.
--   3. organization_official_appointments: judge / steward / ringmaster /
--      disciplinary-committee appointments are PERSON-level official roles an
--      organization records — never organization staff roles, and never
--      satisfiable by a membership alone. A current credential in the same
--      officiating role is required at write time (command layer).
--   4. organization_credentials: organization-level credential evidence
--      (license numbers, chamber registrations, transport permits) with the
--      same verification states and revocation semantics as person
--      credentials. Absence of dates is never evidence of validity.
--
-- Portable relational SQL (SQLite/D1 + Postgres translation verified).

-- ---------------------------------------------------------------------------
-- 1. organization_profiles integrity + N07 business fields
-- ---------------------------------------------------------------------------
ALTER TABLE organization_profiles ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE organization_profiles ADD COLUMN last_operation_id TEXT;
ALTER TABLE organization_profiles ADD COLUMN specialties TEXT NOT NULL DEFAULT '[]';
ALTER TABLE organization_profiles ADD COLUMN service_areas TEXT NOT NULL DEFAULT '[]';
ALTER TABLE organization_profiles ADD COLUMN accessibility_notes TEXT;
ALTER TABLE organization_profiles ADD COLUMN opening_hours TEXT;

CREATE INDEX IF NOT EXISTS idx_organization_profiles_version
  ON organization_profiles(organization_id, row_version);

-- ---------------------------------------------------------------------------
-- 2. Staff invitation lifecycle
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organization_staff_invites (
  id INTEGER PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invitee_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  proposed_role TEXT NOT NULL CHECK (proposed_role IN ('owner','manager','member')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','revoked','expired')),
  note TEXT,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  responded_at TEXT,
  granted_membership_id INTEGER,
  row_version INTEGER NOT NULL DEFAULT 1,
  last_operation_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, invitee_user_id, invited_by_user_id, expires_at)
);

CREATE INDEX IF NOT EXISTS idx_org_staff_invites_invitee
  ON organization_staff_invites(invitee_user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_org_staff_invites_org
  ON organization_staff_invites(organization_id, status, created_at DESC);

-- ---------------------------------------------------------------------------
-- 3. Officiating appointments (person-level official roles)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organization_official_appointments (
  id INTEGER PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  official_role TEXT NOT NULL CHECK (official_role IN ('judge','steward','ringmaster','dc')),
  scope_note TEXT,
  valid_from TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  valid_until TEXT,
  revoked_at TEXT,
  revoked_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  revoke_reason TEXT,
  credential_id INTEGER NOT NULL REFERENCES person_credentials(id) ON DELETE CASCADE,
  appointed_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  row_version INTEGER NOT NULL DEFAULT 1,
  last_operation_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, person_id, official_role)
);

CREATE INDEX IF NOT EXISTS idx_org_official_appointments_org
  ON organization_official_appointments(organization_id, official_role, revoked_at);
CREATE INDEX IF NOT EXISTS idx_org_official_appointments_person
  ON organization_official_appointments(person_id, official_role, revoked_at);

-- ---------------------------------------------------------------------------
-- 4. Organization credential evidence
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organization_credentials (
  id INTEGER PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  issuer_name TEXT NOT NULL,
  identifier TEXT NOT NULL,
  issued_at TEXT,
  expires_at TEXT,
  evidence_media_id TEXT,
  verification_state TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_state IN ('unverified','platform_reviewed','issuer_attested')),
  verified_by_user_id TEXT,
  verified_at TEXT,
  revoked_at TEXT,
  revoked_by_user_id TEXT,
  revoke_reason TEXT,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  row_version INTEGER NOT NULL DEFAULT 1,
  last_operation_id TEXT,
  UNIQUE(organization_id, role, identifier)
);

CREATE INDEX IF NOT EXISTS idx_organization_credentials_org
  ON organization_credentials(organization_id, role, revoked_at);

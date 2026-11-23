-- Master-Ai plan T10: separate the authenticated user account, the historical
-- person record, the organization, and the horse-scoped permission to act.
-- An approved evidence-reviewed claim maps to an explicit grant; selecting an
-- arbitrary person_id proves nothing. Legal ownership (horse_people) stays a
-- historical record — grants are permissions, never title.
CREATE TABLE IF NOT EXISTS user_person_links (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','rejected','revoked')),
  verification_method TEXT,
  verified_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, person_id)
);
CREATE INDEX IF NOT EXISTS idx_user_person_links_person ON user_person_links(person_id, status);

CREATE TABLE IF NOT EXISTS organizations (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name_native TEXT,
  name_latin TEXT,
  kind TEXT NOT NULL DEFAULT 'stable' CHECK (kind IN ('stable','breeder','club','association','service')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','closed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS organization_memberships (
  id INTEGER PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','manager','member')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','revoked')),
  valid_from TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  valid_until TEXT,
  revoked_at TEXT,
  revoked_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  revoke_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_organization_memberships_user ON organization_memberships(user_id, status);

-- Horse-scoped action grants. actions is a comma-separated list drawn from the
-- HORSE_GRANT_ACTIONS vocabulary in src/access/horseAccess.ts (single source).
-- basis_ref records what evidence produced the grant (e.g. the horse_claims id);
-- revoked_at + revoked_by_user_id make every revocation auditable, and a
-- revocation takes effect on the very next request (no cache in front).
CREATE TABLE IF NOT EXISTS horse_access_grants (
  id TEXT PRIMARY KEY,
  horse_id INTEGER NOT NULL REFERENCES horses(id) ON DELETE CASCADE,
  grantee_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  grantee_organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
  relationship TEXT NOT NULL CHECK (relationship IN ('owner','breeder','manager','seller')),
  actions TEXT NOT NULL,
  basis TEXT NOT NULL DEFAULT 'claim_approval' CHECK (basis IN ('claim_approval','admin_grant','organization_mandate')),
  basis_ref TEXT,
  granted_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  valid_from TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  valid_until TEXT,
  revoked_at TEXT,
  revoked_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  revoke_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (grantee_user_id IS NOT NULL OR grantee_organization_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_horse_access_grants_horse ON horse_access_grants(horse_id, relationship);
CREATE INDEX IF NOT EXISTS idx_horse_access_grants_user ON horse_access_grants(grantee_user_id, revoked_at);
CREATE INDEX IF NOT EXISTS idx_horse_access_grants_org ON horse_access_grants(grantee_organization_id, revoked_at);

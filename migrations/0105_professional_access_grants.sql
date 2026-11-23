-- 0105: R144-D01 (Master-AI plan) — professional grants scoped to horse,
-- data and purpose. Master-AI finding: the existing horse_access_grants
-- model (0034) covers owner/breeder/manager/seller editorial mandates only.
-- A veterinarian, laboratory or federation professional who needs private
-- health access has NO grant path: today only staff with horse.edit can see
-- private evidence, and a generic horse.edit grant would be far too broad.
--
-- Doctrine (Master-AI plan D01, accepted):
--   - Distinct permission vocabulary — private health reading, clinical
--     writing, sample/test submission, evidence review, official attestation
--     and private file access/export are SEPARATE permissions, never a
--     single "professional" umbrella.
--   - A grant is bound to the horse, the grantee (user or institution),
--     the professional kind, a professional-authority reference (license/
--     registration) and an assignment reference (who assigned the work).
--   - Validity windows + immediate revocation, identical semantics to the
--     0034 grants: revocation takes effect on the very next request, nothing
--     caches grants in front of the authorization check.
--   - Generic horse-edit permission NEVER implies private health access:
--     staff capability (horse.edit) stays a separate path; a professional
--     grant is the only non-staff path to private health data.
--
-- Portability: stock SQLite-compatible DDL, runs on Supabase (PostgreSQL),
-- D1 (SQLite fork) and the local test engine.

CREATE TABLE IF NOT EXISTS professional_access_grants (
  id TEXT PRIMARY KEY,
  horse_id INTEGER NOT NULL REFERENCES horses(id) ON DELETE CASCADE,
  grantee_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  grantee_organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
  -- veterinarian | laboratory | farrier | physiotherapist | dentist |
  -- nutritionist | federation_official (vocabulary in
  -- src/access/professionalAccess.ts, single source of truth)
  professional_kind TEXT NOT NULL,
  -- Comma-separated list from PROFESSIONAL_GRANT_PERMISSIONS:
  -- private_health_read, clinical_write, sample_submit, evidence_review,
  -- official_attestation, private_file_export
  permissions TEXT NOT NULL,
  -- Professional authority: license/registration reference of the grantee
  -- (e.g. veterinary license number, lab accreditation id).
  authority_ref TEXT NOT NULL,
  -- Assignment: what authorized this grant for THIS horse (case ref,
  -- owner request id, institution assignment).
  assignment_ref TEXT NOT NULL,
  basis TEXT NOT NULL DEFAULT 'admin_grant' CHECK (basis IN ('admin_grant','owner_consent','institution_assignment')),
  basis_ref TEXT,
  granted_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  valid_from TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  valid_until TEXT,
  revoked_at TEXT,
  revoked_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  revoke_reason TEXT,
  -- R74-style operation marker: the revoke audit INSERT is conditioned on
  -- THIS call's marker having landed (GRANT_REVOKE_AUDIT_SQL pattern).
  last_operation_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (grantee_user_id IS NOT NULL OR grantee_organization_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_professional_grants_horse
  ON professional_access_grants(horse_id, revoked_at);
CREATE INDEX IF NOT EXISTS idx_professional_grants_user
  ON professional_access_grants(grantee_user_id, revoked_at);
CREATE INDEX IF NOT EXISTS idx_professional_grants_org
  ON professional_access_grants(grantee_organization_id, revoked_at);

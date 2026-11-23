-- R98: additive only. Legacy location codes are NOT silently reinterpreted.
ALTER TABLE directory_profiles ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE directory_profiles ADD COLUMN last_operation_id TEXT;
ALTER TABLE directory_profiles ADD COLUMN province_code_scheme TEXT NOT NULL DEFAULT 'legacy_r97_unconfirmed';
ALTER TABLE organization_profiles ADD COLUMN province_code_scheme TEXT NOT NULL DEFAULT 'legacy_r97_unconfirmed';
ALTER TABLE directory_claims ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE directory_claims ADD COLUMN last_operation_id TEXT;
ALTER TABLE person_credentials ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE person_credentials ADD COLUMN last_operation_id TEXT;
ALTER TABLE person_credentials ADD COLUMN created_by_user_id TEXT;
ALTER TABLE person_credentials ADD COLUMN revoked_at TEXT;
ALTER TABLE person_credentials ADD COLUMN revoked_by_user_id TEXT;
ALTER TABLE person_credentials ADD COLUMN revoke_reason TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS directory_profile_operation ON directory_profiles(last_operation_id) WHERE last_operation_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS directory_claim_operation ON directory_claims(last_operation_id) WHERE last_operation_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS person_credential_operation ON person_credentials(last_operation_id) WHERE last_operation_id IS NOT NULL;
ALTER TABLE service_requests ADD COLUMN province_code_scheme TEXT NOT NULL DEFAULT 'legacy_r97_unconfirmed';

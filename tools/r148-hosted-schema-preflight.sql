-- READ ONLY PostgreSQL preflight. Run against the explicitly selected staging
-- or production primary with an authorized operator role; never paste secrets
-- into reports. This verifies schema shape, not migration checksum/history or
-- clinical authority. Save output + selected schema + source/migration digests.
-- psql "$EXPLICIT_SELECTED_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f tools/r148-hosted-schema-preflight.sql
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='3s';
SELECT CURRENT_TIMESTAMP AS observed_at, current_database() AS database_name,
       current_schema() AS selected_schema, current_setting('transaction_read_only') AS read_only;

WITH required(table_name,column_name) AS (VALUES
 ('request_evidence','id'),('request_evidence_blobs','data'),
 ('equine_clinical_events','id'),('equine_reproductive_episodes','id'),
 ('equine_samples','id'),('equine_lab_reports','id'),
 ('registry_metadata_fields','field_key'),('registry_metadata_versions','field_key'),
 ('registry_metadata_values','horse_id'),('registry_metadata_operations','operation_id'),
 ('registry_metadata_history','id'),('registry_policy_state','revision'),
 ('registry_policy_receipts','operation_id'),('registry_rules','last_policy_operation_id'),
 ('registry_rule_outcomes','policy_revision'),('change_requests','content_revision'),
 ('genetic_tests','row_version'),('genetic_tests','created_by_user_id'),
 ('genetic_evidence_operations','operation_id'),
 ('auth_mfa_factors','secret_ciphertext'),('auth_mfa_recovery_codes','code_hash'),
 ('auth_mfa_session_assurance','token_hash'),('auth_mfa_events','event_type'),('auth_mfa_commit_checks','ok'),
 ('media_access_grants','granted_to_session_id'),('media_access_grants','granted_to_token_hash')
)
SELECT r.table_name,r.column_name,(c.column_name IS NOT NULL) AS present
FROM required r LEFT JOIN information_schema.columns c
 ON c.table_schema=current_schema() AND c.table_name=r.table_name AND c.column_name=r.column_name
ORDER BY r.table_name,r.column_name;

-- Independent aborting gate: a zero denominator causes a nonzero psql exit
-- under ON_ERROR_STOP if ANY required structure/column is absent. No DDL/DML.
WITH required(table_name,column_name) AS (VALUES
 ('request_evidence','id'),('request_evidence_blobs','data'),
 ('equine_clinical_events','id'),('equine_reproductive_episodes','id'),
 ('equine_samples','id'),('equine_lab_reports','id'),
 ('registry_metadata_fields','field_key'),('registry_metadata_versions','field_key'),
 ('registry_metadata_values','horse_id'),('registry_metadata_operations','operation_id'),
 ('registry_metadata_history','id'),('registry_policy_state','revision'),
 ('registry_policy_receipts','operation_id'),('registry_rules','last_policy_operation_id'),
 ('registry_rule_outcomes','policy_revision'),('change_requests','content_revision'),
 ('genetic_tests','row_version'),('genetic_tests','created_by_user_id'),
 ('genetic_evidence_operations','operation_id'),
 ('auth_mfa_factors','secret_ciphertext'),('auth_mfa_recovery_codes','code_hash'),
 ('auth_mfa_session_assurance','token_hash'),('auth_mfa_events','event_type'),('auth_mfa_commit_checks','ok'),
 ('media_access_grants','granted_to_session_id'),('media_access_grants','granted_to_token_hash')
)
SELECT 1 / CASE WHEN COUNT(*) FILTER (WHERE c.column_name IS NULL)=0 THEN 1 ELSE 0 END AS schema_preflight_passed
FROM required r LEFT JOIN information_schema.columns c
 ON c.table_schema=current_schema() AND c.table_name=r.table_name AND c.column_name=r.column_name;
ROLLBACK;

-- R147 aggregate coverage supplement; requires schema through migration 0116.
-- This file contains SELECT statements only. It complements the older,
-- SQLite-only tools/audit-data-coverage.py with publication, identifier,
-- permission, staging, claim and private-report coverage. No record IDs,
-- names, identifier values, source/issuer names, free text or report payloads
-- are emitted. Namespace names are reduced to fixed classes deliberately.
-- Counts describe stored state, not authenticity, permission sufficiency,
-- scientific validity, complete ancestry, or production readiness. Private
-- aggregates are for an authorized operator and must not become a public API.
-- Each result has a fixed, bounded set of categories; queries may scan tables.
--
-- PostgreSQL: an authorized operator should use a read-only libpq service
-- (credentials configured outside command history) and one repeatable snapshot:
--   psql "service=registry_readonly" -X -v ON_ERROR_STOP=1 <<'SQL'
--   BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
--   SET LOCAL statement_timeout = '30s';
--   SET LOCAL lock_timeout = '2s';
--   SET LOCAL idle_in_transaction_session_timeout = '60s';
--   SET LOCAL TIME ZONE 'UTC';
--   SELECT CURRENT_TIMESTAMP AS snapshot_as_of_utc,
--          pg_current_snapshot() AS snapshot_id;
--   \i tools/r147-readonly-data-coverage.sql
--   ROLLBACK;
--   SQL
-- Preserve the as-of/snapshot receipt and every result together. An error or
-- timeout means the report is incomplete; do not combine separately rerun
-- sections and present them as one snapshot. This does not query old history
-- "as of" an arbitrary date: the timestamp identifies this transaction's view.
--
-- SQLite: use an approved RESTORED snapshot, a mode=ro connection, query_only
-- enabled, and one BEGIN/ROLLBACK read transaction. Set a progress-handler
-- deadline (30 seconds is the existing coverage tool's default). Do not run
-- migrations or updates against the inspected file. Current SQLite and stock
-- PostgreSQL accept the SELECT syntax below; no adapter translation is needed.

-- audit-section: snapshot_receipt
SELECT 'r147-readonly-data-coverage-v1' AS audit_version,
       'schema through 0116 required; not independently certified' AS schema_requirement,
       CURRENT_TIMESTAMP AS observed_at_utc;

-- audit-section: canonical_audience
SELECT CASE WHEN deleted_at IS NOT NULL THEN 'archived'
            WHEN is_active=1 THEN 'public_active'
            WHEN is_active=0 THEN 'withheld_live'
            ELSE 'unexpected_visibility' END AS horse_cohort,
       COUNT(*) AS stored_horses
FROM horses
GROUP BY 1 ORDER BY 1;

-- audit-section: identifier_namespace_status
WITH categorized AS (
  SELECT horse_id,
    CASE WHEN kind IN ('register_no','microchip_no','uel_no','life_number','passport_no','foreign_registration_no') THEN kind ELSE 'other_or_unknown' END AS kind_class,
    CASE WHEN issuer_namespace='registry:platform' THEN 'platform_registry'
         WHEN issuer_namespace='registry:legacy:unattributed' THEN 'legacy_registry_unattributed'
         WHEN issuer_namespace='microchip' THEN 'global_microchip'
         WHEN issuer_namespace='uel' THEN 'uel'
         WHEN issuer_namespace='life' THEN 'life_number'
         WHEN issuer_namespace IN ('passport:legacy:unattributed','foreign:legacy:unattributed') THEN 'legacy_document_unattributed'
         WHEN issuer_namespace LIKE 'passport:%' THEN 'named_passport_issuer'
         WHEN issuer_namespace LIKE 'foreign:%' THEN 'named_foreign_issuer'
         WHEN TRIM(COALESCE(issuer_namespace,''))='' THEN 'missing_namespace'
         ELSE 'other_namespace' END AS namespace_class,
    CASE WHEN status IN ('live','superseded','conflict','archived') THEN status ELSE 'unexpected_status' END AS status_class
  FROM horse_identifiers
)
SELECT kind_class,namespace_class,status_class,
       COUNT(*) AS identifier_rows,COUNT(DISTINCT horse_id) AS referenced_horses
FROM categorized GROUP BY 1,2,3 ORDER BY 1,2,3;

-- audit-section: identifier_conflict_queue
SELECT CASE WHEN kind IN ('register_no','microchip_no','uel_no','life_number','passport_no','foreign_registration_no') THEN kind ELSE 'other_or_unknown' END AS kind_class,
       CASE WHEN resolved_at IS NULL THEN 'unresolved' ELSE 'resolved' END AS resolution_state,
       COUNT(*) AS conflict_pairs,
       COUNT(DISTINCT kept_horse_id) AS distinct_kept_subjects,
       COUNT(DISTINCT conflicting_horse_id) AS distinct_conflicting_subjects
FROM identifier_conflicts GROUP BY 1,2 ORDER BY 1,2;

-- audit-section: live_horse_identifier_coverage
SELECT CASE WHEN h.is_active=1 THEN 'public_active' ELSE 'withheld_or_unexpected' END AS horse_cohort,
       COUNT(*) AS horses,
       COALESCE(SUM(CASE WHEN EXISTS(SELECT 1 FROM horse_identifiers i WHERE i.horse_id=h.id AND i.status='live') THEN 1 ELSE 0 END),0) AS with_any_live_identifier,
       COALESCE(SUM(CASE WHEN EXISTS(SELECT 1 FROM horse_identifiers i WHERE i.horse_id=h.id AND i.status='live' AND i.kind='register_no') THEN 1 ELSE 0 END),0) AS with_live_register_identifier,
       COALESCE(SUM(CASE WHEN NOT EXISTS(SELECT 1 FROM horse_identifiers i WHERE i.horse_id=h.id AND i.status='live') THEN 1 ELSE 0 END),0) AS without_live_identifier,
       COALESCE(SUM(CASE WHEN TRIM(COALESCE(h.register_no,''))<>'' AND NOT EXISTS(SELECT 1 FROM horse_identifiers i WHERE i.horse_id=h.id AND i.status='live' AND i.kind='register_no') THEN 1 ELSE 0 END),0) AS canonical_register_present_without_live_register_row,
       COALESCE(SUM(CASE WHEN EXISTS(SELECT 1 FROM identifier_conflicts c WHERE c.resolved_at IS NULL AND (c.kept_horse_id=h.id OR c.conflicting_horse_id=h.id)) THEN 1 ELSE 0 END),0) AS with_unresolved_identifier_conflict
FROM horses h WHERE h.deleted_at IS NULL GROUP BY 1 ORDER BY 1;

-- audit-section: parent_reference_coverage
-- Missing, dangling, archived and withheld parents are distinct conditions.
-- A recorded reference is not proof of biological parentage or a complete graph.
SELECT CASE WHEN h.is_active=1 THEN 'public_active' ELSE 'withheld_or_unexpected' END AS child_cohort,
       COUNT(*) AS live_children,
       COALESCE(SUM(CASE WHEN h.father_id IS NULL THEN 1 ELSE 0 END),0) AS missing_sire_reference,
       COALESCE(SUM(CASE WHEN h.mother_id IS NULL THEN 1 ELSE 0 END),0) AS missing_dam_reference,
       COALESCE(SUM(CASE WHEN h.father_id IS NULL AND h.mother_id IS NULL THEN 1 ELSE 0 END),0) AS both_parent_references_missing,
       COALESCE(SUM(CASE WHEN h.father_id IS NOT NULL AND sire.id IS NULL THEN 1 ELSE 0 END),0) AS dangling_sire_reference,
       COALESCE(SUM(CASE WHEN h.mother_id IS NOT NULL AND dam.id IS NULL THEN 1 ELSE 0 END),0) AS dangling_dam_reference,
       COALESCE(SUM(CASE WHEN sire.deleted_at IS NOT NULL THEN 1 ELSE 0 END),0) AS archived_sire_reference,
       COALESCE(SUM(CASE WHEN dam.deleted_at IS NOT NULL THEN 1 ELSE 0 END),0) AS archived_dam_reference,
       COALESCE(SUM(CASE WHEN sire.id IS NOT NULL AND sire.deleted_at IS NULL AND sire.is_active=0 THEN 1 ELSE 0 END),0) AS withheld_sire_reference,
       COALESCE(SUM(CASE WHEN dam.id IS NOT NULL AND dam.deleted_at IS NULL AND dam.is_active=0 THEN 1 ELSE 0 END),0) AS withheld_dam_reference,
       COALESCE(SUM(CASE WHEN h.father_id=h.id OR h.mother_id=h.id THEN 1 ELSE 0 END),0) AS self_parent_reference,
       COALESCE(SUM(CASE WHEN h.father_id=h.mother_id THEN 1 ELSE 0 END),0) AS same_reference_both_roles
FROM horses h
LEFT JOIN horses sire ON sire.id=h.father_id
LEFT JOIN horses dam ON dam.id=h.mother_id
WHERE h.deleted_at IS NULL GROUP BY 1 ORDER BY 1;

-- audit-section: import_source_permissions
-- import_sources has no lifecycle/status column. Batch status is below.
SELECT CASE WHEN is_synthetic=1 THEN 'synthetic' WHEN is_synthetic=0 THEN 'non_synthetic' ELSE 'unexpected' END AS source_class,
       CASE WHEN redistribution_allowed=1 THEN 'redistribution_recorded_allowed' WHEN redistribution_allowed=0 THEN 'redistribution_not_allowed' ELSE 'unexpected' END AS permission_class,
       COUNT(*) AS source_agreements,
       COALESCE(SUM(CASE WHEN TRIM(COALESCE(scope_note,''))='' THEN 1 ELSE 0 END),0) AS missing_scope_note,
       COALESCE(SUM(CASE WHEN TRIM(COALESCE(responsible_operator_user_id,''))='' THEN 1 ELSE 0 END),0) AS missing_responsible_operator,
       COALESCE(SUM(CASE WHEN TRIM(COALESCE(license_note,''))='' THEN 1 ELSE 0 END),0) AS missing_license_note,
       COALESCE(SUM(CASE WHEN TRIM(COALESCE(retention_note,''))='' THEN 1 ELSE 0 END),0) AS missing_retention_note
FROM import_sources GROUP BY 1,2 ORDER BY 1,2;

-- audit-section: import_batch_status
-- These are stored batch counters; compare with actual staging rows below.
SELECT CASE WHEN b.status IN ('staged','applying','partial','completed','failed') THEN b.status ELSE 'unexpected_status' END AS batch_status,
       CASE WHEN s.id IS NULL THEN 'missing_source' WHEN s.is_synthetic=1 THEN 'synthetic' WHEN s.redistribution_allowed=1 THEN 'redistribution_recorded_allowed' ELSE 'redistribution_not_allowed' END AS source_permission,
       COUNT(*) AS batches,
       COALESCE(SUM(b.rows_total),0) AS declared_rows,
       COALESCE(SUM(b.rows_created),0) AS recorded_created,
       COALESCE(SUM(b.rows_updated),0) AS recorded_updated,
       COALESCE(SUM(b.rows_conflict),0) AS recorded_conflict,
       COALESCE(SUM(b.rows_skipped),0) AS recorded_skipped
FROM import_batches b LEFT JOIN import_sources s ON s.id=b.source_id
GROUP BY 1,2 ORDER BY 1,2;

-- audit-section: import_staging_outcomes
SELECT CASE WHEN r.row_action IN ('create','update','conflict','skip') THEN r.row_action ELSE 'unexpected_action' END AS staged_action,
       CASE WHEN r.outcome IN ('pending','applied_create','applied_update','conflict','failed','skipped') THEN r.outcome ELSE 'unexpected_outcome' END AS outcome,
       CASE WHEN s.id IS NULL THEN 'missing_source' WHEN s.is_synthetic=1 THEN 'synthetic' WHEN s.redistribution_allowed=1 THEN 'redistribution_recorded_allowed' ELSE 'redistribution_not_allowed' END AS source_permission,
       COUNT(*) AS staging_rows,
       COALESCE(SUM(CASE WHEN r.horse_id IS NOT NULL AND h.id IS NULL THEN 1 ELSE 0 END),0) AS dangling_horse_references,
       COALESCE(SUM(CASE WHEN h.deleted_at IS NULL AND h.is_active=1 THEN 1 ELSE 0 END),0) AS links_to_current_public_horses,
       COALESCE(SUM(CASE WHEN h.deleted_at IS NULL AND h.is_active=0 THEN 1 ELSE 0 END),0) AS links_to_current_withheld_horses
FROM import_staging_rows r
LEFT JOIN import_batches b ON b.id=r.batch_id
LEFT JOIN import_sources s ON s.id=b.source_id
LEFT JOIN horses h ON h.id=r.horse_id
GROUP BY 1,2,3 ORDER BY 1,2,3;

-- audit-section: field_claim_review_queue
SELECT CASE WHEN review_status IN ('pending','selected','rejected','superseded') THEN review_status ELSE 'unexpected_status' END AS review_status,
       CASE WHEN source_type IN ('import','external_scrape','owner_statement','professional','review','prior_canonical') THEN source_type ELSE 'unexpected_source' END AS source_type,
       COUNT(*) AS claims,COUNT(DISTINCT horse_id) AS affected_horses
FROM field_claims GROUP BY 1,2 ORDER BY 1,2;

-- audit-section: pending_field_categories
SELECT CASE WHEN field_name IN ('father_id','mother_id') THEN 'parentage'
            WHEN field_name IN ('register_no','microchip_no','uel_no','life_number','passport_no','passport_issuer','foreign_registration_no','foreign_registration_issuer') THEN 'identifiers'
            WHEN field_name IN ('birth_year','birth_date','death_date','life_status') THEN 'dates_or_lifecycle'
            WHEN field_name IN ('name_latin','name_native','birth_name','previous_names') THEN 'names'
            ELSE 'other_fields' END AS field_category,
       COUNT(*) AS pending_claims,COUNT(DISTINCT horse_id) AS affected_horses
FROM field_claims WHERE review_status='pending' GROUP BY 1 ORDER BY 1;

-- audit-section: private_laboratory_reports
-- All equine_lab_reports are private by policy. Accepted is a review state,
-- never public permission or independent confirmation of a laboratory result.
SELECT CASE WHEN r.review_state IN ('pending','accepted','rejected','withdrawn') THEN r.review_state ELSE 'unexpected_status' END AS review_state,
       CASE WHEN r.panel_type IN ('base_color','str_parentage','disease','other') THEN r.panel_type ELSE 'unexpected_panel' END AS panel_class,
       'private_by_policy' AS report_audience,
       COUNT(*) AS reports,
       COALESCE(SUM(CASE WHEN m.id IS NULL THEN 1 ELSE 0 END),0) AS missing_evidence_metadata,
       COALESCE(SUM(CASE WHEN m.id IS NOT NULL AND (m.media_type<>'document' OR m.role<>'veterinary' OR m.consent_state<>'private') THEN 1 ELSE 0 END),0) AS attachments_outside_private_veterinary_policy,
       COALESCE(SUM(CASE WHEN h.id IS NULL OR h.deleted_at IS NOT NULL OR h.is_active<>1 THEN 1 ELSE 0 END),0) AS unavailable_subjects
FROM equine_lab_reports r
LEFT JOIN horse_media m ON m.id=r.evidence_media_id
LEFT JOIN horses h ON h.id=r.horse_id
GROUP BY 1,2,3 ORDER BY 1,2;

-- audit-section: genetic_result_publication_coverage
-- This is separate from report acceptance. It mirrors the stored public
-- projection flags only; it does not validate an assay, result or consent file.
SELECT CASE WHEN g.test_category='disease' THEN 'disease'
            WHEN g.test_category='coat_color' THEN 'coat_color'
            ELSE 'other_category' END AS result_category,
       COUNT(*) AS stored_results,
       COALESCE(SUM(CASE WHEN g.verified=1 THEN 1 ELSE 0 END),0) AS marked_verified,
       COALESCE(SUM(CASE WHEN g.test_category='disease' AND g.public_disclosed=1 THEN 1 ELSE 0 END),0) AS disease_disclosure_flag_set,
       COALESCE(SUM(CASE WHEN h.deleted_at IS NULL AND h.is_active=1 AND g.verified=1 AND (g.test_category<>'disease' OR g.public_disclosed=1) THEN 1 ELSE 0 END),0) AS eligible_for_current_public_projection,
       COALESCE(SUM(CASE WHEN h.id IS NULL OR h.deleted_at IS NOT NULL OR h.is_active<>1 OR g.verified<>1 OR (g.test_category='disease' AND COALESCE(g.public_disclosed,0)<>1) THEN 1 ELSE 0 END),0) AS withheld_by_current_projection_flags
FROM genetic_tests g LEFT JOIN horses h ON h.id=g.horse_id
GROUP BY 1 ORDER BY 1;

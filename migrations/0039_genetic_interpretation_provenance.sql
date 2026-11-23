-- 0039_genetic_interpretation_provenance.sql
-- R88 agent plan P06: append-only interpretation provenance for genetic tests.
--
-- Doctrine: a laboratory report is NEVER rewritten to match a newer catalog.
-- The raw evidence columns (result, result_interpretation, lab_name,
-- lab_accession, notes) stay exactly as the laboratory and the original
-- submitter recorded them. When a qualified reviewer records a structured,
-- catalog-versioned interpretation, that act lands in THESE provenance
-- columns plus an append-only audit_events row — the scientific history of
-- what was interpreted, when, by whom and against which catalog version.
--
-- Distinctions kept explicit (P06): report authenticity review (issuer
-- attestations, T05) is separate from scientific interpretation (this
-- migration) and from clinical diagnosis (never automated — the public
-- projection always carries clinical_diagnosis: false).
--
-- Additive only: three nullable columns, no defaults, no data mutation.
-- Existing rows mean "never reviewed through the structured path" (NULL),
-- which the read path already treats as catalog-only interpretation.

ALTER TABLE genetic_tests ADD COLUMN interpretation_version TEXT;
ALTER TABLE genetic_tests ADD COLUMN interpreted_at TEXT;
ALTER TABLE genetic_tests ADD COLUMN catalog_reviewed_by TEXT;

-- Reviewer identity is a user id reference by convention (no FK: audit_events
-- uses the same convention so revocation/deletion never orphans history).
CREATE INDEX IF NOT EXISTS idx_genetic_tests_reviewed
  ON genetic_tests(catalog_reviewed_by, interpreted_at DESC);

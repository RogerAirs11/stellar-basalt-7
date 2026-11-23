-- 0103: R140-F — name provenance + Phase-1 profile completeness fields
-- (markings, height) from the client proposal's §1 field list.
--
-- 1) name_native_provenance: the second Master-AI audit flagged that
--    generated transliterations sit in `name_native` indistinguishable from
--    official/source names. Distinct provenance labels make the distinction
--    visible: 'official' (issued by the studbook/federation), 'source'
--    (read from a licensed source document), 'generated' (machine
--    transliteration, holdout-validated), NULL (legacy/unknown — displayed as
--    unrecorded, never as official).
-- 2) markings / height_cm: proposal §1 asks for white markings and wither
--    height on every profile. Nullable free-text / numeric columns, no
--    backfill invented.
--
-- Portability: stock SQLite-compatible DDL, runs on Supabase (PostgreSQL),
-- D1 (SQLite fork) and the local test engine.

ALTER TABLE horses ADD COLUMN name_native_provenance TEXT;
ALTER TABLE horses ADD COLUMN markings TEXT;
ALTER TABLE horses ADD COLUMN height_cm REAL;

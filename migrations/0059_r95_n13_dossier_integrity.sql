-- 0059_r95_n13_dossier_integrity.sql
-- R95-N13: dossier creation and sharing transactionally consistent.
--
-- Doctrine:
--   1. An issued dossier carries an IMMUTABLE DIGEST bound to its exact
--      included content (snapshot_json + sections_meta_json bytes). The view
--      recomputes and compares; a mismatch is controlled operator review,
--      never a 500 and never silent service of altered bytes.
--   2. Snapshots minted before this migration keep working (issued_digest
--      NULL -> digest_verified: null, honestly reported as un-digested
--      historical evidence). Nothing is rewritten retroactively.
--
-- Portable relational SQL (SQLite/D1 + Postgres translation verified).

ALTER TABLE dossier_snapshots ADD COLUMN issued_digest TEXT;

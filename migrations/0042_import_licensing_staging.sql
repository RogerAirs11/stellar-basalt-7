-- 0042_import_licensing_staging.sql
-- R88 agent plan P10: licensed ingestion, staging and duplicate
-- adjudication.
--
-- Four additive structures, no data changes:
--   1. import_sources — the source AGREEMENT registry. Publicly visible data
--      is not automatically reusable: every ingestion source must carry its
--      scope, redistribution permission, retention rule, update cadence and
--      the responsible operator BEFORE any row is staged. is_synthetic marks
--      demo/synthetic namespaces (R88 demo data policy) that can NEVER be
--      selected as a production canonical source — the command layer refuses
--      them and tests pin the refusal.
--   2. import_batches — resumable batch state. (source_id, file_sha256) is
--      UNIQUE: reimporting an identical file REPLAYS the same batch instead
--      of staging a second one (idempotency at the batch level).
--   3. import_staging_rows — raw + normalized copies per row (originals are
--      NEVER overwritten by normalization), the dry-run classification
--      (create/update/conflict/skip) and the per-row apply outcome. Staging
--      writes NOTHING canonical; the apply command is the only canonical
--      writer and is reviewed, resumable and per-row transactional.
--   4. horse_merges + horse_redirect_aliases — reviewer merge/unmerge with a
--      replayable moved-reference manifest: every FK row moved from the
--      merged horse to the kept horse is recorded (table, row id, column,
--      from, to) so unmerge can restore it exactly. Two horses sharing a
--      name are NEVER silently collapsed — merge is an explicit reviewed
--      command with a mandatory reason.
--
-- Portable relational SQL (SQLite/D1 + Postgres translation verified).

CREATE TABLE IF NOT EXISTS import_sources (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  issuer_namespace TEXT NOT NULL,
  scope_note TEXT NOT NULL,
  redistribution_allowed INTEGER NOT NULL DEFAULT 0 CHECK (redistribution_allowed IN (0,1)),
  retention_note TEXT,
  update_cadence TEXT,
  responsible_operator_user_id TEXT,
  license_note TEXT,
  is_synthetic INTEGER NOT NULL DEFAULT 0 CHECK (is_synthetic IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS import_batches (
  id INTEGER PRIMARY KEY,
  source_id INTEGER NOT NULL REFERENCES import_sources(id),
  file_name TEXT NOT NULL,
  file_sha256 TEXT NOT NULL,
  mapping_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'staged' CHECK (status IN ('staged','applying','partial','completed','failed')),
  rows_total INTEGER NOT NULL DEFAULT 0,
  rows_created INTEGER NOT NULL DEFAULT 0,
  rows_updated INTEGER NOT NULL DEFAULT 0,
  rows_conflict INTEGER NOT NULL DEFAULT 0,
  rows_skipped INTEGER NOT NULL DEFAULT 0,
  operator_minutes INTEGER,
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

-- Reimporting an identical file (same source + same content digest) replays
-- the SAME batch — a second staging of identical bytes can never exist.
CREATE UNIQUE INDEX IF NOT EXISTS uq_import_batches_source_file ON import_batches(source_id, file_sha256);

CREATE TABLE IF NOT EXISTS import_staging_rows (
  id INTEGER PRIMARY KEY,
  batch_id INTEGER NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  normalized_json TEXT NOT NULL,
  row_checksum TEXT NOT NULL,
  row_action TEXT NOT NULL CHECK (row_action IN ('create','update','conflict','skip')),
  outcome TEXT NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending','applied_create','applied_update','conflict','failed','skipped')),
  outcome_detail TEXT,
  horse_id INTEGER,
  processed_at TEXT,
  UNIQUE(batch_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_import_staging_batch ON import_staging_rows(batch_id, outcome);

CREATE TABLE IF NOT EXISTS horse_merges (
  id INTEGER PRIMARY KEY,
  kept_horse_id INTEGER NOT NULL,
  merged_horse_id INTEGER NOT NULL,
  moved_manifest TEXT NOT NULL,
  reason TEXT NOT NULL,
  merged_by_user_id TEXT NOT NULL,
  merged_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  unmerged_at TEXT,
  unmerged_by_user_id TEXT
);

CREATE TABLE IF NOT EXISTS horse_redirect_aliases (
  alias_horse_id INTEGER PRIMARY KEY,
  kept_horse_id INTEGER NOT NULL
);

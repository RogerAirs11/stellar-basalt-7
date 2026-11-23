#!/usr/bin/env node
/**
 * R88 agent plan P10 Supabase-first step: apply migration 0042 (import
 * licensing + staging + merge/adjudication structures) to the Supabase
 * canonical database BEFORE the worker push. Additive only: 5 new tables
 * (import_sources, import_batches, import_staging_rows, horse_merges,
 * horse_redirect_aliases) + the unique reimport index. No data changes.
 *
 * Usage:
 *   SUPABASE_DATABASE_URL=... node scripts/apply-0042-to-supabase.mjs
 */
import { requireCanonicalMigrationApproval } from "./lib/migration-approval.mjs";

const url = process.env.SUPABASE_DATABASE_URL;
if (!url) {
  console.error("Need SUPABASE_DATABASE_URL");
  process.exit(2);
}
requireCanonicalMigrationApproval(url, "0042");
const { default: postgres } = await import("postgres");
const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 15 });

try {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS import_sources (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      issuer_namespace TEXT NOT NULL,
      scope_note TEXT NOT NULL,
      redistribution_allowed bigint NOT NULL DEFAULT 0 CHECK (redistribution_allowed IN (0,1)),
      retention_note TEXT,
      update_cadence TEXT,
      responsible_operator_user_id TEXT,
      license_note TEXT,
      is_synthetic bigint NOT NULL DEFAULT 0 CHECK (is_synthetic IN (0,1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS import_batches (
      id BIGSERIAL PRIMARY KEY,
      source_id bigint NOT NULL REFERENCES import_sources(id),
      file_name TEXT NOT NULL,
      file_sha256 TEXT NOT NULL,
      mapping_version TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'staged' CHECK (status IN ('staged','applying','partial','completed','failed')),
      rows_total bigint NOT NULL DEFAULT 0,
      rows_created bigint NOT NULL DEFAULT 0,
      rows_updated bigint NOT NULL DEFAULT 0,
      rows_conflict bigint NOT NULL DEFAULT 0,
      rows_skipped bigint NOT NULL DEFAULT 0,
      operator_minutes bigint,
      created_by_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT
    )
  `);
  await sql.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS uq_import_batches_source_file ON import_batches(source_id, file_sha256)`);
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS import_staging_rows (
      id BIGSERIAL PRIMARY KEY,
      batch_id bigint NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
      external_id TEXT NOT NULL,
      raw_json TEXT NOT NULL,
      normalized_json TEXT NOT NULL,
      row_checksum TEXT NOT NULL,
      row_action TEXT NOT NULL CHECK (row_action IN ('create','update','conflict','skip')),
      outcome TEXT NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending','applied_create','applied_update','conflict','failed','skipped')),
      outcome_detail TEXT,
      horse_id bigint,
      processed_at TEXT,
      UNIQUE(batch_id, external_id)
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_import_staging_batch ON import_staging_rows(batch_id, outcome)`);
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS horse_merges (
      id BIGSERIAL PRIMARY KEY,
      kept_horse_id bigint NOT NULL,
      merged_horse_id bigint NOT NULL,
      moved_manifest TEXT NOT NULL,
      reason TEXT NOT NULL,
      merged_by_user_id TEXT NOT NULL,
      merged_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      unmerged_at TEXT,
      unmerged_by_user_id TEXT
    )
  `);
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS horse_redirect_aliases (
      alias_horse_id bigint PRIMARY KEY,
      kept_horse_id bigint NOT NULL
    )
  `);

  for (const table of ["import_sources", "import_batches", "import_staging_rows", "horse_merges", "horse_redirect_aliases"]) {
    const rows = await sql`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=${table} ORDER BY ordinal_position`;
    console.log(`OK ${table}:`, rows.map((row) => row.column_name).join(", "));
  }
  console.log("apply-0042: Supabase canonical updated (P10 licensing + staging + merge structures; additive only)");
} finally {
  await sql.end({ timeout: 5 });
}

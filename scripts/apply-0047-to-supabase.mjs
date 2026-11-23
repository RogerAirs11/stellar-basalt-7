#!/usr/bin/env node
/**
 * R88 agent plan P15 Supabase-first step: apply migration 0047 (sale
 * dossiers) to the Supabase canonical database BEFORE the worker push.
 * Additive only: 2 new tables + 3 indexes. No data changes.
 *
 * Usage:
 *   SUPABASE_DATABASE_URL=... node scripts/apply-0047-to-supabase.mjs
 */
import { requireCanonicalMigrationApproval } from "./lib/migration-approval.mjs";

const url = process.env.SUPABASE_DATABASE_URL;
if (!url) {
  console.error("Need SUPABASE_DATABASE_URL");
  process.exit(2);
}
requireCanonicalMigrationApproval(url, "0047");
const { default: postgres } = await import("postgres");
const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 15 });

try {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS dossier_snapshots (
      id BIGSERIAL PRIMARY KEY,
      horse_id bigint NOT NULL REFERENCES horses(id) ON DELETE CASCADE,
      created_by_user_id TEXT NOT NULL,
      version bigint NOT NULL DEFAULT 1,
      snapshot_json TEXT NOT NULL,
      sections_meta_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      row_version bigint NOT NULL DEFAULT 1
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_dossier_snapshots_horse ON dossier_snapshots(horse_id, status, created_at DESC)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_dossier_snapshots_creator ON dossier_snapshots(created_by_user_id, created_at DESC)`);

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS dossier_share_links (
      id BIGSERIAL PRIMARY KEY,
      dossier_id bigint NOT NULL REFERENCES dossier_snapshots(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      recipient_user_id TEXT,
      created_by_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      revoked_at TEXT,
      revoked_by_user_id TEXT,
      access_count bigint NOT NULL DEFAULT 0,
      last_accessed_at TEXT
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_dossier_links_dossier ON dossier_share_links(dossier_id, revoked_at, expires_at)`);

  for (const table of ["dossier_snapshots", "dossier_share_links"]) {
    const rows = await sql`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=${table} ORDER BY ordinal_position`;
    console.log(`OK ${table}:`, rows.map((row) => row.column_name).join(", "));
  }
  console.log("apply-0047: Supabase canonical updated (P15 dossiers; additive only)");
} finally {
  await sql.end({ timeout: 5 });
}

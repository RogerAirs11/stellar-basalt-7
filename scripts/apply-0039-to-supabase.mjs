#!/usr/bin/env node
/**
 * R88 agent plan P06 Supabase pre-deploy step: apply migration 0039
 * (genetic interpretation provenance) to the Supabase canonical database
 * BEFORE the worker deploy. Purely additive: 3 nullable columns + 1 index,
 * no data mutation, no defaults — existing rows keep NULL provenance
 * (meaning "catalog-only interpretation", the current behavior).
 *
 * Usage:
 *   SUPABASE_DATABASE_URL=... node scripts/apply-0039-to-supabase.mjs
 */
import { requireCanonicalMigrationApproval } from "./lib/migration-approval.mjs";

const url = process.env.SUPABASE_DATABASE_URL;
if (!url) {
  console.error("Need SUPABASE_DATABASE_URL");
  process.exit(2);
}
requireCanonicalMigrationApproval(url, "0039");
const { default: postgres } = await import("postgres");
const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 15 });

const ADD_COLUMNS = [
  ["genetic_tests", "interpretation_version", "text"],
  ["genetic_tests", "interpreted_at", "text"],
  ["genetic_tests", "catalog_reviewed_by", "text"],
];

try {
  for (const [table, column, definition] of ADD_COLUMNS) {
    await sql.unsafe(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${definition}`);
  }
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_genetic_tests_reviewed ON genetic_tests(catalog_reviewed_by, interpreted_at DESC)`);

  for (const [table, column] of ADD_COLUMNS) {
    const rows = await sql`
      SELECT column_name, is_nullable, data_type, column_default
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name=${table} AND column_name=${column}
    `;
    const col = rows[0];
    if (!col) throw new Error(`${table}.${column} missing after apply`);
    if (col.is_nullable !== "YES" || col.column_default !== null) {
      throw new Error(`${table}.${column} must be nullable with no default (append-only provenance), got ${JSON.stringify(col)}`);
    }
    console.log(`OK ${table}.${column} (${col.data_type}, nullable, no default)`);
  }
  const index = await sql`SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname='idx_genetic_tests_reviewed'`;
  if (!index.length) throw new Error("idx_genetic_tests_reviewed missing after apply");
  console.log("OK idx_genetic_tests_reviewed");
  console.log("apply-0039: Supabase canonical updated (3 additive columns + 1 index, zero data mutation)");
} finally {
  await sql.end({ timeout: 5 });
}

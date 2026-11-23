#!/usr/bin/env node
/**
 * R88 agent plan P02 Supabase pre-deploy step: apply migration 0037
 * (operation markers for transactional revocation audit) to the Supabase
 * canonical database BEFORE the worker deploy (R81 lesson: no 500 window).
 * Purely additive: two nullable text columns, no data mutation.
 *
 * Usage:
 *   SUPABASE_DATABASE_URL=... node scripts/apply-0037-to-supabase.mjs
 */
import { requireCanonicalMigrationApproval } from "./lib/migration-approval.mjs";

const url = process.env.SUPABASE_DATABASE_URL;
if (!url) {
  console.error("Need SUPABASE_DATABASE_URL");
  process.exit(2);
}
requireCanonicalMigrationApproval(url, "0037");
const { default: postgres } = await import("postgres");
const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 15 });

const ADD_COLUMNS = [
  ["horse_access_grants", "last_operation_id", "text"],
  ["organization_memberships", "last_operation_id", "text"],
];

try {
  for (const [table, column, type] of ADD_COLUMNS) {
    await sql.unsafe(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${type}`);
  }
  // Verify both columns exist and are nullable (additive, no default).
  for (const [table, column] of ADD_COLUMNS) {
    const rows = await sql`
      SELECT column_name, is_nullable, data_type
      FROM information_schema.columns
      WHERE table_name = ${table} AND column_name = ${column}
    `;
    if (rows.length !== 1) throw new Error(`column ${table}.${column} missing after ALTER`);
    console.log(`OK ${table}.${column}: ${rows[0].data_type}, nullable=${rows[0].is_nullable}`);
  }
  console.log("migration 0037 applied to Supabase: 2 additive columns, 0 data changes");
} finally {
  await sql.end({ timeout: 10 });
}

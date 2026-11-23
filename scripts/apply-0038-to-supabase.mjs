#!/usr/bin/env node
/**
 * R88 agent plan P03 Supabase pre-deploy step: apply migration 0038
 * (marketplace command versions + idempotency receipts) to the Supabase
 * canonical database BEFORE the worker deploy (R81 lesson: no 500 window).
 * Purely additive: 4 nullable/defaulted columns + 1 new table + 1 index,
 * no data mutation. Existing listing/inquiry rows backfill to row_version 1.
 *
 * Usage:
 *   SUPABASE_DATABASE_URL=... node scripts/apply-0038-to-supabase.mjs
 */
import { requireCanonicalMigrationApproval } from "./lib/migration-approval.mjs";

const url = process.env.SUPABASE_DATABASE_URL;
if (!url) {
  console.error("Need SUPABASE_DATABASE_URL");
  process.exit(2);
}
requireCanonicalMigrationApproval(url, "0038");
const { default: postgres } = await import("postgres");
const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 15 });

const ADD_COLUMNS = [
  ["sales_listings", "row_version", "integer NOT NULL DEFAULT 1 CHECK (row_version >= 1)"],
  ["sales_listings", "last_operation_id", "text"],
  ["sales_inquiries", "row_version", "integer NOT NULL DEFAULT 1 CHECK (row_version >= 1)"],
  ["sales_inquiries", "last_operation_id", "text"],
];

try {
  for (const [table, column, definition] of ADD_COLUMNS) {
    await sql.unsafe(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${definition}`);
  }
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS command_receipts (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT NOT NULL,
      command TEXT NOT NULL CHECK (command IN ('listing.create','listing.status','listing.renew','inquiry.create','inquiry.status')),
      target_id TEXT NOT NULL,
      request_digest TEXT NOT NULL,
      status_code INTEGER NOT NULL CHECK (status_code IN (200, 201)),
      response_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_command_receipts_actor ON command_receipts(actor_user_id, command, created_at DESC)`);

  // Verify every column landed with the right shape.
  for (const [table, column] of ADD_COLUMNS) {
    const rows = await sql`
      SELECT column_name, is_nullable, data_type, column_default
      FROM information_schema.columns
      WHERE table_name = ${table} AND column_name = ${column}
    `;
    if (rows.length !== 1) throw new Error(`column ${table}.${column} missing after ALTER`);
    console.log(`OK ${table}.${column}: ${rows[0].data_type}, nullable=${rows[0].is_nullable}, default=${rows[0].column_default}`);
  }
  const table = await sql`
    SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_name = 'command_receipts'
  `;
  if (table[0].n !== 1) throw new Error("command_receipts table missing after CREATE");
  const index = await sql`
    SELECT COUNT(*)::int AS n FROM pg_indexes WHERE indexname = 'idx_command_receipts_actor'
  `;
  if (index[0].n !== 1) throw new Error("idx_command_receipts_actor missing after CREATE INDEX");
  const backfill = await sql`SELECT COUNT(*)::int AS n FROM sales_listings`;
  console.log(`migration 0038 applied to Supabase: 4 additive columns + command_receipts + index; ${backfill[0].n} listing rows backfilled to row_version=1`);
} finally {
  await sql.end({ timeout: 10 });
}

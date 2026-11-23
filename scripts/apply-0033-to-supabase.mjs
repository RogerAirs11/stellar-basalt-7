#!/usr/bin/env node
/**
 * R82: apply the additive 0033 Postgres DDL (horse_identifiers +
 * identifier_conflicts) to the Supabase canonical database.
 * Runs BEFORE the worker deploy so production never writes to a missing table.
 * Usage: SUPABASE_DATABASE_URL=... node scripts/apply-0033-to-supabase.mjs
 */
import { requireCanonicalMigrationApproval } from "./lib/migration-approval.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const url = process.env.SUPABASE_DATABASE_URL;
if (!url) {
  console.error("Need SUPABASE_DATABASE_URL");
  process.exit(2);
}
requireCanonicalMigrationApproval(url, "0033");
const { default: postgres } = await import("postgres");
const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 15 });
const ddl = readFileSync(join(process.cwd(), "sandbox", "postgres-0033-additive.sql"), "utf8");

try {
  await sql.unsafe(ddl);
  const tables = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_name IN ('horse_identifiers','identifier_conflicts')
    ORDER BY table_name`;
  const indexes = await sql`
    SELECT indexname FROM pg_indexes
    WHERE schemaname='public' AND indexname IN ('uq_horse_identifiers_live','idx_horse_identifiers_lookup','idx_horse_identifiers_horse','idx_identifier_conflicts_open')
    ORDER BY indexname`;
  console.log("tables:", tables.map((row) => row.table_name).join(", "));
  console.log("indexes:", indexes.map((row) => row.indexname).join(", "));
  if (tables.length !== 2 || indexes.length !== 4) {
    console.error("EXPECTED 2 tables + 4 indexes");
    process.exit(1);
  }
  console.log("0033 additive DDL applied to Supabase: OK");
} finally {
  await sql.end({ timeout: 5 });
}

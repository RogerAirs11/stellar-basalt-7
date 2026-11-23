#!/usr/bin/env node
/**
 * R88 agent plan P05 Supabase chain-parity step: apply migration 0040
 * (rate_limit_counters) to the Supabase canonical database.
 *
 * NOTE: at runtime the D1 enforcement layer ALWAYS uses the D1 binding (the
 * worker enforces rate limits BEFORE resolveDatabaseForRequest swaps DB for
 * the request's provider), so this table is UNUSED on Supabase — it exists
 * only so the migration chain stays identical across engines (P01 parity
 * discipline: the same chain must apply cleanly on every supported provider).
 *
 * Usage:
 *   SUPABASE_DATABASE_URL=... node scripts/apply-0040-to-supabase.mjs
 */
import { requireCanonicalMigrationApproval } from "./lib/migration-approval.mjs";

const url = process.env.SUPABASE_DATABASE_URL;
if (!url) {
  console.error("Need SUPABASE_DATABASE_URL");
  process.exit(2);
}
requireCanonicalMigrationApproval(url, "0040");
const { default: postgres } = await import("postgres");
const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 15 });

try {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS rate_limit_counters (
      key TEXT PRIMARY KEY,
      window_start TEXT NOT NULL,
      count bigint NOT NULL CHECK (count >= 0)
    )
  `);
  const rows = await sql`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema='public' AND table_name='rate_limit_counters' ORDER BY ordinal_position
  `;
  const columns = rows.map((row) => `${row.column_name}:${row.data_type}`);
  console.log("OK rate_limit_counters", columns.join(", "));
  console.log("apply-0040: Supabase chain parity updated (table unused at runtime; D1 owns rate limiting)");
} finally {
  await sql.end({ timeout: 5 });
}

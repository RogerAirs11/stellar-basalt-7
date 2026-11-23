#!/usr/bin/env node
/**
 * R88 agent plan P19 Supabase-first step: apply migration 0051 (sponsored
 * visibility plumbing) to Supabase canonical BEFORE the worker push.
 * Additive only: 1 ALTER TABLE ADD COLUMN.
 */
import { requireCanonicalMigrationApproval } from "./lib/migration-approval.mjs";

const url = process.env.SUPABASE_DATABASE_URL;
if (!url) {
  console.error("Need SUPABASE_DATABASE_URL");
  process.exit(2);
}
requireCanonicalMigrationApproval(url, "0051");
const { default: postgres } = await import("postgres");
const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 15 });

try {
  const column = await sql`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='sales_listings' AND column_name='sponsored_until'`;
  if (column.length === 0) {
    await sql.unsafe(`ALTER TABLE sales_listings ADD COLUMN sponsored_until TEXT`);
    console.log("OK sales_listings: + sponsored_until");
  } else {
    console.log("OK sales_listings: sponsored_until already present");
  }
  console.log("apply-0051: Supabase canonical updated (P19 sponsored placement; additive only)");
} finally {
  await sql.end({ timeout: 5 });
}

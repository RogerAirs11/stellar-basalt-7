#!/usr/bin/env node
/**
 * R88 agent plan P16 Supabase-first step: apply migration 0048 (moderation,
 * reporting and marketplace trust) to the Supabase canonical database BEFORE
 * the worker push. Additive only: 4 new tables + 4 indexes + 1 ALTER TABLE
 * ADD COLUMN. No data changes.
 *
 * Usage:
 *   SUPABASE_DATABASE_URL=... node scripts/apply-0048-to-supabase.mjs
 */
import { requireCanonicalMigrationApproval } from "./lib/migration-approval.mjs";

const url = process.env.SUPABASE_DATABASE_URL;
if (!url) {
  console.error("Need SUPABASE_DATABASE_URL");
  process.exit(2);
}
requireCanonicalMigrationApproval(url, "0048");
const { default: postgres } = await import("postgres");
const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 15 });

try {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS moderation_cases (
      id BIGSERIAL PRIMARY KEY,
      target_table TEXT NOT NULL CHECK (target_table IN ('sales_listings','sales_inquiries','service_requests','directory_profiles')),
      target_id TEXT NOT NULL,
      reporter_user_id TEXT NOT NULL,
      reason TEXT NOT NULL CHECK (reason IN ('fraud_suspected','misrepresentation','offensive_content','spam','counterfeit_documents','animal_welfare','other')),
      details TEXT,
      status TEXT NOT NULL DEFAULT 'new'
        CHECK (status IN ('new','triaged','action_pending','resolved_dismissed','resolved_hidden','resolved_reinstated')),
      severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','urgent')),
      assigned_operator_user_id TEXT,
      resolution_note TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      resolved_at TEXT,
      UNIQUE(reporter_user_id, target_table, target_id, status)
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_moderation_cases_queue ON moderation_cases(status, severity, created_at)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_moderation_cases_target ON moderation_cases(target_table, target_id, status)`);

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS moderation_case_events (
      id BIGSERIAL PRIMARY KEY,
      case_id bigint NOT NULL REFERENCES moderation_cases(id) ON DELETE CASCADE,
      actor_user_id TEXT NOT NULL,
      event_type TEXT NOT NULL CHECK (event_type IN ('created','assigned','note','decision','appeal','reversal')),
      event_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_moderation_case_events_case ON moderation_case_events(case_id, id)`);

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS moderation_appeals (
      id BIGSERIAL PRIMARY KEY,
      case_id bigint NOT NULL REFERENCES moderation_cases(id) ON DELETE CASCADE,
      appellant_user_id TEXT NOT NULL,
      statement TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','upheld','overturned')),
      decided_by_user_id TEXT,
      decided_at TEXT,
      decision_note TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_moderation_appeals_case ON moderation_appeals(case_id, status)`);

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS listing_suspensions (
      id BIGSERIAL PRIMARY KEY,
      listing_id TEXT NOT NULL REFERENCES sales_listings(id) ON DELETE CASCADE,
      case_id bigint REFERENCES moderation_cases(id) ON DELETE SET NULL,
      suspended_by_user_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      suspended_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      reinstated_at TEXT,
      reinstated_by_user_id TEXT
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_listing_suspensions_listing ON listing_suspensions(listing_id, reinstated_at)`);

  // P16: last-confirmed-availability exposure (additive column).
  const column = await sql`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='sales_listings' AND column_name='availability_confirmed_at'`;
  if (column.length === 0) {
    await sql.unsafe(`ALTER TABLE sales_listings ADD COLUMN availability_confirmed_at TEXT`);
    console.log("OK sales_listings: + availability_confirmed_at");
  }

  for (const table of ["moderation_cases", "moderation_case_events", "moderation_appeals", "listing_suspensions"]) {
    const rows = await sql`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=${table} ORDER BY ordinal_position`;
    console.log(`OK ${table}:`, rows.map((row) => row.column_name).join(", "));
  }
  console.log("apply-0048: Supabase canonical updated (P16 moderation; additive only)");
} finally {
  await sql.end({ timeout: 5 });
}

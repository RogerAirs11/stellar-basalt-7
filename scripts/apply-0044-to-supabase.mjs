#!/usr/bin/env node
/**
 * R88 agent plan P12 Supabase-first step: apply migration 0044 (service
 * requests inbox) to the Supabase canonical database BEFORE the worker push.
 * Additive only: 4 new tables + 5 indexes. No data changes.
 *
 * Usage:
 *   SUPABASE_DATABASE_URL=... node scripts/apply-0044-to-supabase.mjs
 */
import { requireCanonicalMigrationApproval } from "./lib/migration-approval.mjs";

const url = process.env.SUPABASE_DATABASE_URL;
if (!url) {
  console.error("Need SUPABASE_DATABASE_URL");
  process.exit(2);
}
requireCanonicalMigrationApproval(url, "0044");
const { default: postgres } = await import("postgres");
const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 15 });

try {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS service_requests (
      id BIGSERIAL PRIMARY KEY,
      requester_user_id TEXT NOT NULL,
      provider_person_id bigint NOT NULL REFERENCES people(id) ON DELETE CASCADE,
      provider_organization_id bigint REFERENCES organizations(id) ON DELETE SET NULL,
      category TEXT NOT NULL,
      province_code TEXT,
      city TEXT,
      horse_id bigint REFERENCES horses(id) ON DELETE SET NULL,
      note TEXT NOT NULL,
      share_contact bigint NOT NULL DEFAULT 0 CHECK (share_contact IN (0,1)),
      status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','acknowledged','discussing','closed','withdrawn','spam')),
      first_response_at TEXT,
      row_version bigint NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      closed_at TEXT,
      last_transition_by_user_id TEXT
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_service_requests_requester ON service_requests(requester_user_id, status, created_at DESC)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_service_requests_provider ON service_requests(provider_person_id, status, created_at ASC)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_service_requests_open_pair ON service_requests(requester_user_id, provider_person_id) WHERE status IN ('new','acknowledged','discussing')`);
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS service_request_receipts (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT NOT NULL,
      target_person_id bigint NOT NULL,
      request_digest TEXT NOT NULL,
      status_code bigint NOT NULL CHECK (status_code IN (200, 201)),
      response_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await sql.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS uq_service_request_receipts ON service_request_receipts(actor_user_id, id)`);
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS service_request_blocks (
      id BIGSERIAL PRIMARY KEY,
      blocker_user_id TEXT NOT NULL,
      blocked_person_id bigint NOT NULL REFERENCES people(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(blocker_user_id, blocked_person_id)
    )
  `);
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS service_request_reports (
      id BIGSERIAL PRIMARY KEY,
      service_request_id bigint NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
      reporter_user_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_service_request_reports_request ON service_request_reports(service_request_id)`);

  for (const table of ["service_requests", "service_request_receipts", "service_request_blocks", "service_request_reports"]) {
    const rows = await sql`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=${table} ORDER BY ordinal_position`;
    console.log(`OK ${table}:`, rows.map((row) => row.column_name).join(", "));
  }
  console.log("apply-0044: Supabase canonical updated (P12 service request inbox; additive only)");
} finally {
  await sql.end({ timeout: 5 });
}

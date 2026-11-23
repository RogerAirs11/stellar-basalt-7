#!/usr/bin/env node
/**
 * Master-Ai plan T11 Supabase pre-deploy step: apply migration 0035
 * (change_requests submission columns + idempotency index) to the Supabase
 * canonical database BEFORE the worker deploy (R81 lesson: no 500 window).
 *
 * The D1 migration is ALTER TABLE ADD COLUMN + indexes — natively
 * Postgres-compatible except the canonical_horse_id type, which is bigint on
 * Supabase (horses.id is bigint there). Usage:
 *   SUPABASE_DATABASE_URL=... node scripts/apply-0035-to-supabase.mjs
 */
import { requireCanonicalMigrationApproval } from "./lib/migration-approval.mjs";
import { join } from "node:path";

const url = process.env.SUPABASE_DATABASE_URL;
if (!url) {
  console.error("Need SUPABASE_DATABASE_URL");
  process.exit(2);
}
requireCanonicalMigrationApproval(url, "0035");
const { default: postgres } = await import("postgres");
const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 15 });

const STATEMENTS = [
  `ALTER TABLE change_requests ADD COLUMN IF NOT EXISTS submission_json text`,
  `ALTER TABLE change_requests ADD COLUMN IF NOT EXISTS review_outcome text`,
  `ALTER TABLE change_requests ADD COLUMN IF NOT EXISTS canonical_horse_id bigint REFERENCES horses(id) ON DELETE SET NULL`,
  `ALTER TABLE change_requests ADD COLUMN IF NOT EXISTS idempotency_key text`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_change_requests_idempotency
     ON change_requests(submitted_by_user_id, idempotency_key)
     WHERE idempotency_key IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_change_requests_review_queue
     ON change_requests(status, request_type, created_at DESC)`,
];

const EXPECTED_COLUMNS = ["submission_json", "review_outcome", "canonical_horse_id", "idempotency_key"];
const EXPECTED_INDEXES = ["uq_change_requests_idempotency", "idx_change_requests_review_queue"];

try {
  for (const statement of STATEMENTS) {
    await sql.unsafe(statement);
  }
  const columns = await sql`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema='public' AND table_name='change_requests'
      AND column_name::text IN ('submission_json','review_outcome','canonical_horse_id','idempotency_key')
    ORDER BY column_name`;
  console.log("columns:", columns.map((row) => `${row.column_name}:${row.data_type}`).join(", "));
  const indexes = await sql`
    SELECT indexname FROM pg_indexes
    WHERE schemaname='public' AND indexname IN ('uq_change_requests_idempotency','idx_change_requests_review_queue')
    ORDER BY indexname`;
  console.log("indexes:", indexes.map((row) => row.indexname).join(", "));
  if (columns.length !== 4 || indexes.length !== 2) {
    console.error(`EXPECTED 4 columns + 2 indexes (got ${columns.length} + ${indexes.length})`);
    process.exit(1);
  }
  const horseIdType = columns.find((row) => row.column_name === "canonical_horse_id");
  if (horseIdType && horseIdType.data_type !== "bigint") {
    console.error(`canonical_horse_id must be bigint (got ${horseIdType.data_type})`);
    process.exit(1);
  }
  // The partial unique index is the idempotency guarantee — verify it really is partial.
  const partial = await sql`
    SELECT indexdef FROM pg_indexes
    WHERE schemaname='public' AND indexname='uq_change_requests_idempotency'`;
  if (!partial[0] || !partial[0].indexdef.includes("WHERE")) {
    console.error("uq_change_requests_idempotency is not a partial index");
    process.exit(1);
  }
  console.log("0035 applied and verified on Supabase canonical (T11 submission columns + idempotency index).");
} catch (cause) {
  console.error("FAILED:", cause);
  process.exit(1);
} finally {
  await sql.end({ timeout: 10 });
}

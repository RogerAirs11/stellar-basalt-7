#!/usr/bin/env node
/**
 * R88 agent plan P18 Supabase-first step: apply migration 0050 (payments,
 * entitlements, reconciliation) to the Supabase canonical database BEFORE
 * the worker push. Additive only: 5 new tables + 6 indexes.
 *
 * Usage:
 *   SUPABASE_DATABASE_URL=... node scripts/apply-0050-to-supabase.mjs
 */
import { requireCanonicalMigrationApproval } from "./lib/migration-approval.mjs";

const url = process.env.SUPABASE_DATABASE_URL;
if (!url) {
  console.error("Need SUPABASE_DATABASE_URL");
  process.exit(2);
}
requireCanonicalMigrationApproval(url, "0050");
const { default: postgres } = await import("postgres");
const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 15 });

try {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS entitlement_events (
      id BIGSERIAL PRIMARY KEY,
      event_key TEXT NOT NULL UNIQUE,
      order_id bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      payment_attempt_id bigint NOT NULL REFERENCES payment_attempts(id) ON DELETE CASCADE,
      buyer_user_id TEXT NOT NULL,
      payer_organization_id bigint,
      sku TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('grant','renewal','refund_reversal','cancellation')),
      granted_days bigint NOT NULL CHECK (granted_days >= 0),
      activated_at TEXT NOT NULL,
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_entitlement_events_buyer ON entitlement_events(buyer_user_id, sku, created_at DESC)`);

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS entitlements (
      id BIGSERIAL PRIMARY KEY,
      buyer_user_id TEXT NOT NULL,
      payer_organization_id bigint,
      sku TEXT NOT NULL,
      source_event_id bigint NOT NULL REFERENCES entitlement_events(id) ON DELETE CASCADE,
      active bigint NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
      activated_at TEXT NOT NULL,
      expires_at TEXT,
      cancelled_at TEXT,
      cancelled_by_user_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_entitlements_holder ON entitlements(buyer_user_id, sku, active, expires_at)`);

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS payment_events (
      id BIGSERIAL PRIMARY KEY,
      payment_attempt_id bigint NOT NULL REFERENCES payment_attempts(id) ON DELETE CASCADE,
      actor TEXT NOT NULL CHECK (actor IN ('system','provider','operator','buyer')),
      from_state TEXT,
      to_state TEXT NOT NULL CHECK (to_state IN ('created','redirected','verified','failed','cancelled','expired')),
      payload_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_payment_events_attempt ON payment_events(payment_attempt_id, id)`);

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS payment_settlements (
      id BIGSERIAL PRIMARY KEY,
      payment_attempt_id bigint NOT NULL REFERENCES payment_attempts(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      provider_reference TEXT,
      settled_gross_minor bigint NOT NULL CHECK (settled_gross_minor >= 0),
      fee_minor bigint NOT NULL DEFAULT 0 CHECK (fee_minor >= 0),
      currency TEXT NOT NULL DEFAULT 'IRR' CHECK (currency = 'IRR'),
      settled_at TEXT NOT NULL,
      recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(payment_attempt_id)
    )
  `);

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS reconciliation_cases (
      id BIGSERIAL PRIMARY KEY,
      payment_attempt_id bigint REFERENCES payment_attempts(id) ON DELETE SET NULL,
      mismatch_type TEXT NOT NULL CHECK (mismatch_type IN ('missing_settlement','amount_mismatch','duplicate_settlement','stale_unverified')),
      details TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
      detected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      resolved_by_user_id TEXT,
      resolved_at TEXT,
      resolution_note TEXT
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_reconciliation_cases_open ON reconciliation_cases(status, detected_at)`);

  for (const table of ["entitlement_events", "entitlements", "payment_events", "payment_settlements", "reconciliation_cases"]) {
    const rows = await sql`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=${table} ORDER BY ordinal_position`;
    console.log(`OK ${table}:`, rows.map((row) => row.column_name).join(", "));
  }
  console.log("apply-0050: Supabase canonical updated (P18 payments ledger; additive only)");
} finally {
  await sql.end({ timeout: 5 });
}

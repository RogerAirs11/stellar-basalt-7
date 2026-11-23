#!/usr/bin/env node
/**
 * R88 agent plan P17 Supabase-first step: apply migration 0049 (billing
 * catalog, orders, unambiguous money) to the Supabase canonical database
 * BEFORE the worker push. Additive only: 4 new tables + 4 indexes.
 *
 * Usage:
 *   SUPABASE_DATABASE_URL=... node scripts/apply-0049-to-supabase.mjs
 */
import { requireCanonicalMigrationApproval } from "./lib/migration-approval.mjs";

const url = process.env.SUPABASE_DATABASE_URL;
if (!url) {
  console.error("Need SUPABASE_DATABASE_URL");
  process.exit(2);
}
requireCanonicalMigrationApproval(url, "0049");
const { default: postgres } = await import("postgres");
const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 15 });

try {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS billing_prices (
      id BIGSERIAL PRIMARY KEY,
      sku TEXT NOT NULL,
      version bigint NOT NULL DEFAULT 1,
      name_en TEXT NOT NULL,
      name_fa TEXT NOT NULL,
      description TEXT,
      price_minor bigint NOT NULL CHECK (price_minor >= 0),
      currency TEXT NOT NULL DEFAULT 'IRR' CHECK (currency = 'IRR'),
      period_days bigint CHECK (period_days IS NULL OR (period_days >= 1 AND period_days <= 3650)),
      active bigint NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
      created_by_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      superseded_at TEXT,
      UNIQUE(sku, version)
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_billing_prices_sku_live ON billing_prices(sku, active, superseded_at)`);

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS orders (
      id BIGSERIAL PRIMARY KEY,
      order_key TEXT NOT NULL,
      buyer_user_id TEXT NOT NULL,
      payer_organization_id bigint REFERENCES organizations(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','awaiting_payment','paid','cancelled','refunded','partially_refunded')),
      total_minor bigint NOT NULL CHECK (total_minor >= 0),
      currency TEXT NOT NULL DEFAULT 'IRR' CHECK (currency = 'IRR'),
      price_snapshot_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      cancelled_at TEXT,
      row_version bigint NOT NULL DEFAULT 1,
      UNIQUE(buyer_user_id, order_key)
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders(buyer_user_id, status, created_at DESC)`);

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS order_lines (
      id BIGSERIAL PRIMARY KEY,
      order_id bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      price_id bigint NOT NULL REFERENCES billing_prices(id),
      sku TEXT NOT NULL,
      title_en TEXT NOT NULL,
      title_fa TEXT NOT NULL,
      unit_minor bigint NOT NULL CHECK (unit_minor >= 0),
      quantity bigint NOT NULL CHECK (quantity >= 1 AND quantity <= 100),
      line_total_minor bigint NOT NULL CHECK (line_total_minor >= 0)
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_order_lines_order ON order_lines(order_id)`);

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS payment_attempts (
      id BIGSERIAL PRIMARY KEY,
      order_id bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      authority TEXT,
      amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
      currency TEXT NOT NULL DEFAULT 'IRR' CHECK (currency = 'IRR'),
      state TEXT NOT NULL DEFAULT 'created'
        CHECK (state IN ('created','redirected','verified','failed','cancelled','expired')),
      verification_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      verified_at TEXT,
      UNIQUE(provider, authority)
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_payment_attempts_order ON payment_attempts(order_id, state)`);

  for (const table of ["billing_prices", "orders", "order_lines", "payment_attempts"]) {
    const rows = await sql`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=${table} ORDER BY ordinal_position`;
    console.log(`OK ${table}:`, rows.map((row) => row.column_name).join(", "));
  }
  console.log("apply-0049: Supabase canonical updated (P17 billing; additive only)");
} finally {
  await sql.end({ timeout: 5 });
}

#!/usr/bin/env node
/**
 * R88 agent plan P13 Supabase-first step: apply migration 0045 (transactional
 * notification outbox) to the Supabase canonical database BEFORE the worker
 * push. Additive only: 4 new tables + 3 indexes. No data changes.
 *
 * Usage:
 *   SUPABASE_DATABASE_URL=... node scripts/apply-0045-to-supabase.mjs
 */
import { requireCanonicalMigrationApproval } from "./lib/migration-approval.mjs";

const url = process.env.SUPABASE_DATABASE_URL;
if (!url) {
  console.error("Need SUPABASE_DATABASE_URL");
  process.exit(2);
}
requireCanonicalMigrationApproval(url, "0045");
const { default: postgres } = await import("postgres");
const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 15 });

try {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS notification_outbox (
      id BIGSERIAL PRIMARY KEY,
      event_key TEXT NOT NULL UNIQUE,
      channel TEXT NOT NULL CHECK (channel IN ('email','sms')),
      purpose TEXT NOT NULL,
      essential bigint NOT NULL DEFAULT 0 CHECK (essential IN (0,1)),
      recipient_user_id TEXT,
      recipient_masked TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued','provider_accepted','delivered','failed','dead_letter','suppressed')),
      attempts bigint NOT NULL DEFAULT 0,
      max_attempts bigint NOT NULL DEFAULT 5,
      next_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_error TEXT,
      provider_message_id TEXT,
      payload_ref TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      provider_accepted_at TEXT,
      delivered_at TEXT
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_notification_outbox_due ON notification_outbox(status, next_attempt_at)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_notification_outbox_recipient ON notification_outbox(recipient_user_id, created_at DESC)`);

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS notification_deliveries (
      id BIGSERIAL PRIMARY KEY,
      event_key TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_message_id TEXT,
      confirmed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(event_key)
    )
  `);

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS notification_callbacks (
      id BIGSERIAL PRIMARY KEY,
      provider TEXT NOT NULL,
      event_key TEXT,
      signature_state TEXT NOT NULL CHECK (signature_state IN ('verified','rejected')),
      payload_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_notification_callbacks_event ON notification_callbacks(event_key, created_at DESC)`);

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS notification_preferences (
      user_id TEXT PRIMARY KEY,
      unsubscribed_purposes TEXT NOT NULL DEFAULT '',
      quiet_hour_start bigint CHECK (quiet_hour_start IS NULL OR (quiet_hour_start >= 0 AND quiet_hour_start < 24)),
      quiet_hour_end bigint CHECK (quiet_hour_end IS NULL OR (quiet_hour_end >= 0 AND quiet_hour_end < 24)),
      monthly_send_limit bigint,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  for (const table of ["notification_outbox", "notification_deliveries", "notification_callbacks", "notification_preferences"]) {
    const rows = await sql`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=${table} ORDER BY ordinal_position`;
    console.log(`OK ${table}:`, rows.map((row) => row.column_name).join(", "));
  }
  console.log("apply-0045: Supabase canonical updated (P13 transactional notification outbox; additive only)");
} finally {
  await sql.end({ timeout: 5 });
}

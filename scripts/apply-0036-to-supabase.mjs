#!/usr/bin/env node
/**
 * Master-Ai plan T12 Supabase pre-deploy step: apply migration 0036
 * (horses typed-date columns + places + private precise address; the honest
 * year-only backfill; horse_ownership_periods + horse_lifecycle_events) to
 * the Supabase canonical database BEFORE the worker deploy (R81 lesson: no
 * 500 window).
 *
 * Usage:
 *   SUPABASE_DATABASE_URL=... node scripts/apply-0036-to-supabase.mjs
 */
import { requireCanonicalMigrationApproval } from "./lib/migration-approval.mjs";

const url = process.env.SUPABASE_DATABASE_URL;
if (!url) {
  console.error("Need SUPABASE_DATABASE_URL");
  process.exit(2);
}
requireCanonicalMigrationApproval(url, "0036");
const { default: postgres } = await import("postgres");
const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 15 });

const HORSE_COLUMNS = [
  ["birth_date_value", "text"],
  ["birth_date_precision", "text"],
  ["birth_date_calendar", "text"],
  ["birth_date_source", "text"],
  ["death_date_value", "text"],
  ["death_date_precision", "text"],
  ["death_date_calendar", "text"],
  ["castration_date_value", "text"],
  ["castration_date_precision", "text"],
  ["castration_date_calendar", "text"],
  ["birth_city", "text"],
  ["birth_province", "text"],
  ["keeping_city", "text"],
  ["keeping_province", "text"],
  ["precise_address", "text"],
];

const CHECK_CONSTRAINTS = [
  ["horses_birth_date_precision_check", "horses", "birth_date_precision IN ('day','month','year')"],
  ["horses_death_date_precision_check", "horses", "death_date_precision IN ('day','month','year')"],
  ["horses_castration_date_precision_check", "horses", "castration_date_precision IN ('day','month','year')"],
];

try {
  for (const [column, type] of HORSE_COLUMNS) {
    await sql.unsafe(`ALTER TABLE horses ADD COLUMN IF NOT EXISTS ${column} ${type}`);
  }
  for (const [name, table, predicate] of CHECK_CONSTRAINTS) {
    await sql.unsafe(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='${name}') THEN
        ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (${predicate});
      END IF;
    END $$`);
  }
  // Honest backfill: legacy birth_year was always year-precision Gregorian.
  await sql.unsafe(`UPDATE horses
    SET birth_date_value = CAST(birth_year AS TEXT),
        birth_date_precision = 'year',
        birth_date_calendar = 'gregorian'
    WHERE birth_year IS NOT NULL AND birth_date_value IS NULL`);

  await sql.unsafe(`CREATE TABLE IF NOT EXISTS horse_ownership_periods (
    id bigserial PRIMARY KEY,
    horse_id bigint NOT NULL REFERENCES horses(id) ON DELETE CASCADE,
    owner_person_id bigint NOT NULL REFERENCES people(id) ON DELETE RESTRICT,
    start_value text NOT NULL,
    start_precision text NOT NULL CHECK (start_precision IN ('day','month','year')),
    start_calendar text NOT NULL CHECK (start_calendar IN ('gregorian','solar_hijri')),
    end_value text,
    end_precision text CHECK (end_precision IS NULL OR end_precision IN ('day','month','year')),
    end_calendar text CHECK (end_calendar IS NULL OR end_calendar IN ('gregorian','solar_hijri')),
    share_percent double precision CHECK (share_percent IS NULL OR (share_percent > 0 AND share_percent <= 100)),
    evidence_note text,
    source text,
    created_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
    created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK ((end_value IS NULL AND end_precision IS NULL AND end_calendar IS NULL)
        OR (end_value IS NOT NULL AND end_precision IS NOT NULL AND end_calendar IS NOT NULL))
  )`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_horse_ownership_periods_horse
    ON horse_ownership_periods(horse_id, owner_person_id)`);

  await sql.unsafe(`CREATE TABLE IF NOT EXISTS horse_lifecycle_events (
    id bigserial PRIMARY KEY,
    horse_id bigint NOT NULL REFERENCES horses(id) ON DELETE CASCADE,
    event_type text NOT NULL CHECK (event_type IN ('death','castration','retirement','export','import','other')),
    date_value text NOT NULL,
    date_precision text NOT NULL CHECK (date_precision IN ('day','month','year')),
    date_calendar text NOT NULL CHECK (date_calendar IN ('gregorian','solar_hijri')),
    uncertain_time integer NOT NULL DEFAULT 0 CHECK (uncertain_time IN (0,1)),
    note text,
    source_ref text,
    created_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
    created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_horse_lifecycle_events_horse
    ON horse_lifecycle_events(horse_id, event_type)`);

  // ---- Verification -------------------------------------------------------
  const columns = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='horses'
      AND column_name::text IN ('birth_date_value','birth_date_precision','birth_date_calendar','birth_date_source',
        'death_date_value','death_date_precision','death_date_calendar',
        'castration_date_value','castration_date_precision','castration_date_calendar',
        'birth_city','birth_province','keeping_city','keeping_province','precise_address')
    ORDER BY column_name`;
  if (columns.length !== 15) {
    console.error(`EXPECTED 15 new horses columns (got ${columns.length})`);
    process.exit(1);
  }
  const backfilled = await sql`
    SELECT COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE birth_year IS NOT NULL AND birth_date_value IS NOT NULL AND birth_date_precision='year' AND birth_date_calendar='gregorian')::int AS typed
    FROM horses`;
  const total = backfilled[0]?.total ?? 0;
  const typed = backfilled[0]?.typed ?? 0;
  const yearRows = await sql`SELECT COUNT(*)::int AS n FROM horses WHERE birth_year IS NOT NULL`;
  console.log(`horses rows=${total} yearRows=${yearRows[0]?.n ?? 0} typedYearBackfill=${typed}`);
  if (typed !== (yearRows[0]?.n ?? 0)) {
    console.error("Backfill mismatch: not every legacy birth_year row gained its typed year projection");
    process.exit(1);
  }
  const tables = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_name IN ('horse_ownership_periods','horse_lifecycle_events')
    ORDER BY table_name`;
  if (tables.length !== 2) {
    console.error(`EXPECTED 2 new tables (got ${tables.length})`);
    process.exit(1);
  }
  const indexes = await sql`
    SELECT indexname FROM pg_indexes
    WHERE schemaname='public' AND indexname IN ('idx_horse_ownership_periods_horse','idx_horse_lifecycle_events_horse')
    ORDER BY indexname`;
  if (indexes.length !== 2) {
    console.error(`EXPECTED 2 new indexes (got ${indexes.length})`);
    process.exit(1);
  }
  console.log("0036 applied and verified on Supabase canonical (T12 typed dates + places + ownership periods + lifecycle events).");
} catch (cause) {
  console.error("FAILED:", cause);
  process.exit(1);
} finally {
  await sql.end({ timeout: 10 });
}

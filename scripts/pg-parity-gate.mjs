#!/usr/bin/env node
/**
 * pg-parity-gate — B01/TEST-01: automated SQLite→PostgreSQL migration parity gate.
 *
 * The audit's ask: "disposable PostgreSQL fixture + migration gate for the actual
 * primary DB". Production runs supabase_full (Postgres canonical); the D1/SQLite
 * migration chain is the schema source of truth. This gate proves, on every push,
 * that the ENTIRE migrations/*.sql chain translates through the production
 * translator (src/db/sqliteSqlToPostgres.ts) and applies cleanly to a disposable
 * PostgreSQL, producing the integrity objects R74 verified live — plus the
 * structural tables the record modules depend on.
 *
 * SQLite FTS5 virtual tables are skipped with a note: production Postgres serves
 * search through horse_search_source (tsvector + pg_trgm) — the same documented
 * mapping tools/supabase-full-sync.mjs uses (FTS shadow tables excluded).
 *
 * Usage:
 *   PG_CONNECTION_STRING=postgres://postgres:postgres@localhost:5432/postgres \
 *     node scripts/pg-parity-gate.mjs
 *
 * Exit codes: 0 = gate passed; 1 = parity failure; 2 = configuration error.
 */
import postgres from "postgres";
import { requireDisposableLocalDatabase } from "./lib/disposable-schema.mjs";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compileTsRuntime } from "../tools/ts-runtime-loader.mjs";
import { splitStatements, ddlNormalize } from "./lib/pg-ddl.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const connectionString = process.env.PG_CONNECTION_STRING;
if (!connectionString) {
  console.error("PG_CONNECTION_STRING is required (e.g. postgres://postgres:postgres@localhost:5432/postgres)");
  process.exit(2);
}

try { requireDisposableLocalDatabase(connectionString, process.env.PG_PARITY_DISPOSABLE); }
catch (error) { console.error(error.message); process.exit(2); }

const rt = compileTsRuntime(["src/db/sqliteSqlToPostgres.ts"]);
const { sqliteSqlToPostgres, stripLeadingComments } = rt.load("src/db/sqliteSqlToPostgres.ts");

// splitStatements + ddlNormalize live in scripts/lib/pg-ddl.mjs (shared with
// pg-execution-parity.mjs so the two parity gates can never drift apart).

const sql = postgres(connectionString, { max: 1, idle_timeout: 5, connect_timeout: 10 });

const migrations = readdirSync(join(root, "migrations"))
  .filter(name => name.endsWith(".sql"))
  .sort();
if (!migrations.length) {
  console.error("No migrations found — gate misconfigured");
  process.exit(2);
}

let failures = 0;
let applied = 0;
let skippedFts = 0;
const failedAt = [];

try {
  // The gate journal mirrors D1's d1_migrations semantics (fresh DB every run in CI).
  await sql.unsafe("CREATE TABLE IF NOT EXISTS pg_parity_gate_journal (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
  for (const name of migrations) {
    const already = await sql.unsafe("SELECT 1 FROM pg_parity_gate_journal WHERE name=$1", [name]);
    if (already.length) continue;
    const raw = readFileSync(join(root, "migrations", name), "utf8");
    const statements = splitStatements(raw);
    let fileSkippedFts = 0;
    try {
      await sql.unsafe("BEGIN");
      for (const statement of statements) {
        const bare = stripLeadingComments(statement);
        if (/^\s*PRAGMA\b/i.test(bare)) {
          // SQLite connection-level directive (e.g. foreign_keys=ON). Postgres
          // enforces FKs structurally; the pragma has no schema meaning.
          continue;
        }
        if (/^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(bare)) {
          // Production mapping: Postgres serves FTS via horse_search_source
          // (tsvector + pg_trgm); FTS5 shadow tables are D1-only.
          skippedFts += 1;
          fileSkippedFts += 1;
          continue;
        }
        const translated = sqliteSqlToPostgres(ddlNormalize(statement));
        if (!translated.trim() || !stripLeadingComments(translated).trim()) continue;
        await sql.unsafe(translated);
      }
      await sql.unsafe(`INSERT INTO pg_parity_gate_journal(name) VALUES($1)`, [name]);
      await sql.unsafe("COMMIT");
      applied += 1;
      if (fileSkippedFts) console.log(`  ${name}: applied (${fileSkippedFts} FTS5 virtual-table statement(s) skipped — Postgres serves search via horse_search_source)`);
    } catch (error) {
      await sql.unsafe("ROLLBACK");
      failures += 1;
      failedAt.push(name);
      console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
      console.error("      (a failing migration means SQLite→Postgres parity is broken for the primary DB — fix the translator or the migration, never the gate)");
    }
  }

  // Integrity + structural probes — the objects R74 verified live on production
  // Postgres, asserted here to materialize from the migration chain alone.
  const checks = [
    {
      name: "uq_competition_results_entry expression index (COALESCE null-class bucket, REV-03)",
      query: `SELECT pg_get_indexdef(i.indexrelid) AS def FROM pg_index i
              JOIN pg_class c ON c.oid = i.indexrelid
              WHERE c.relname = 'uq_competition_results_entry'`,
      expect: rows => rows.length === 1 && /COALESCE\(class_name,\s*''(::text)?\)/i.test(rows[0].def),
    },
    {
      name: "uq_phone_identities_phone unique index (public auth)",
      query: `SELECT 1 FROM pg_indexes WHERE indexname = 'uq_phone_identities_phone'`,
      expect: rows => rows.length === 1,
    },
    {
      name: "horse_claims.person_id column (R74 owner-link guard depends on it)",
      query: `SELECT 1 FROM information_schema.columns WHERE table_name='horse_claims' AND column_name='person_id'`,
      expect: rows => rows.length === 1,
    },
    {
      name: "horses.row_version + last_mutation_id (R74 stale-version guards depend on them)",
      query: `SELECT COUNT(*) AS n FROM information_schema.columns
              WHERE table_name='horses' AND column_name IN ('row_version','last_mutation_id')`,
      expect: rows => Number(rows[0].n) === 2,
    },
    {
      name: "ai_provider_keys table + api_key column (A19 envelope storage)",
      query: `SELECT 1 FROM information_schema.columns WHERE table_name='ai_provider_keys' AND column_name='api_key'`,
      expect: rows => rows.length === 1,
    },
    {
      name: "record-module tables exist (competitions, competition_results, genetic_tests, breeding_records, horse_media, sales_listings)",
      query: `SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema='public' AND table_name IN
              ('competitions','competition_results','genetic_tests','breeding_records','horse_media','sales_listings')`,
      expect: rows => Number(rows[0].n) === 6,
    },
    {
      name: "horse_search_source exists (the Postgres FTS mapping target)",
      query: `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='horse_search_source'`,
      expect: rows => rows.length === 1,
    },
  ];
  for (const check of checks) {
    try {
      const rows = await sql.unsafe(check.query);
      const ok = check.expect(rows);
      console.log(`${ok ? "PASS" : "FAIL"} — ${check.name}`);
      if (!ok) { failures += 1; console.log("   rows:", JSON.stringify(rows).slice(0, 300)); }
    } catch (error) {
      failures += 1;
      console.log(`FAIL — ${check.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log("");
  console.log(`pg-parity-gate: ${applied}/${migrations.length} migrations applied, ${skippedFts} FTS5 statement(s) skipped by design, ${failures} failure(s)`);
} finally {
  await sql.end({ timeout: 5 });
}

process.exit(failures ? 1 : 0);

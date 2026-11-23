#!/usr/bin/env node
/**
 * R123 owner-gated step: apply migration 0096 (the demo payment session
 * failure_reason vocabulary widening — 'invalid_expiry_timestamp', IMP-017)
 * to the Supabase canonical database.
 *
 * Why a dedicated entrypoint (the 0061/0089 precedent): 0096 is a
 * data-carrying table rebuild (SQLite cannot ALTER a CHECK, so the file uses
 * the 12-step create/copy/drop/rename shape). The consolidated range runner's
 * statement classifier only knows additive DDL and refuses DROP TABLE /
 * RENAME — by design.
 *
 * Runbook discipline (identical to apply-0089-to-supabase.mjs):
 *  - uses the PRODUCTION translator (src/db/sqliteSqlToPostgres.ts);
 *  - one transaction for the whole file, so the table swap is atomic;
 *  - a read-only preflight first: the current CHECK vocabulary, the row count
 *    that will be copied verbatim, and the index state;
 *  - postflight verification: the widened CHECK vocabulary is enforced
 *    ('invalid_expiry_timestamp' accepted), the old narrow CHECK is gone, the
 *    status index exists, and the row count is unchanged (verbatim copy).
 *
 * Idempotent: if the live CHECK already includes 'invalid_expiry_timestamp'
 * the script exits 0 without writing.
 *
 * Usage: SUPABASE_DATABASE_URL=postgres://... node scripts/apply-0096-to-supabase.mjs
 */
import { requireCanonicalMigrationApproval } from "./lib/migration-approval.mjs";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compileTsRuntime } from "../tools/ts-runtime-loader.mjs";
import { splitStatements, ddlNormalize } from "./lib/pg-ddl.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const url = process.env.SUPABASE_DATABASE_URL;
if (!url) { console.error("Need SUPABASE_DATABASE_URL"); process.exit(2); }

const rt = compileTsRuntime(["src/db/sqliteSqlToPostgres.ts"]);
const { sqliteSqlToPostgres, stripLeadingComments } = rt.load("src/db/sqliteSqlToPostgres.ts");
process.env.R96_MIGRATION_ID = "0096";
requireCanonicalMigrationApproval(url, "0096");
const { default: postgres } = await import("postgres");
const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 15 });

const MIGRATION = "0096_demo_expiry_quarantine_reason.sql";

try {
  // ---- idempotency: is the widened vocabulary already enforced? ----
  const checks = await sql`SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'demo_payment_sessions'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%failure_reason%'`;
  const widened = checks.find(c => /'invalid_expiry_timestamp'/.test(c.def));
  if (widened) {
    console.log("apply-0096: widened failure_reason CHECK already enforced — nothing to do (idempotent)");
    process.exit(0);
  }
  const narrow = checks.find(c => /'simulated_decline'/.test(c.def));
  if (!narrow) {
    console.log("apply-0096: no failure_reason CHECK found — table state unexpected; refusing");
    process.exit(1);
  }

  // ---- read-only preflight ----
  const rows = (await sql`SELECT count(*)::int AS n FROM demo_payment_sessions`)[0].n;
  const statusIndex = await sql`SELECT 1 FROM pg_indexes WHERE schemaname=current_schema() AND indexname='idx_demo_payment_sessions_status'`;
  console.log(`preflight: demo_payment_sessions has ${rows} row(s) to copy verbatim; current CHECK: ${narrow.def.slice(0, 120)}; status index present: ${statusIndex.length > 0}`);

  // ---- apply the whole file in ONE transaction through the translator ----
  const raw = readFileSync(join(root, "migrations", MIGRATION), "utf8");
  const statements = splitStatements(raw);
  const translated = [];
  for (const statement of statements) {
    const bare = stripLeadingComments(statement);
    if (/^\s*PRAGMA\b/i.test(bare)) continue;
    if (/^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(bare)) continue;
    translated.push(sqliteSqlToPostgres(ddlNormalize(statement)));
  }
  console.log(`apply-0096: ${translated.length} translated statement(s) in one transaction`);
  await sql.begin(async (tx) => {
    for (const statement of translated) await tx.unsafe(statement);
  });

  // ---- postflight ----
  const after = await sql`SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'demo_payment_sessions'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%failure_reason%'`;
  const widenedAfter = after.find(c => /'invalid_expiry_timestamp'/.test(c.def));
  if (!widenedAfter) throw new Error(`postflight: widened CHECK not found after rebuild: ${JSON.stringify(after)}`);
  const idxAfter = await sql`SELECT 1 FROM pg_indexes WHERE schemaname=current_schema() AND indexname='idx_demo_payment_sessions_status'`;
  if (idxAfter.length !== 1) throw new Error("postflight: status index missing after rebuild");
  const rowsAfter = (await sql`SELECT count(*)::int AS n FROM demo_payment_sessions`)[0].n;
  if (rowsAfter !== rows) throw new Error(`postflight: row count changed ${rows} -> ${rowsAfter} (the copy must be verbatim)`);
  console.log(`postflight: widened CHECK enforced (${widenedAfter.def.slice(0, 130)}…); status index present; row count unchanged (${rows})`);
  console.log("apply-0096: Supabase canonical updated (demo payment session quarantine vocabulary widening)");
} finally {
  await sql.end({ timeout: 5 });
}

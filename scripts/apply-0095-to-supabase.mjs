#!/usr/bin/env node
/**
 * R123 owner-gated step: apply migration 0095 (entitlement grant provenance
 * and scope — the R119 remediation / COM-01) to the Supabase canonical
 * database.
 *
 * Why a dedicated entrypoint (the 0061/0089 precedent): 0095 carries two
 * classification UPDATE statements against NON-EMPTY canonical tables
 * (entitlement_events / entitlements). The consolidated range runner is
 * DDL-only by design and refuses data statements unless the target table is
 * empty — so this migration gets its own reviewed entrypoint.
 *
 * Runbook discipline (identical to apply-0089-to-supabase.mjs):
 *  - uses the PRODUCTION translator (src/db/sqliteSqlToPostgres.ts), never
 *    ad hoc copied SQL;
 *  - one transaction for the whole file — additive columns, the two
 *    deterministic classification UPDATEs and the scoped unique index swap
 *    commit atomically;
 *  - a read-only preflight first: current grant_scope presence, the exact
 *    row counts that will be classified, and the active-index state;
 *  - postflight verification: both columns exist with the CHECK enforced,
 *    the classification is total (every row in a known class or the explicit
 *    legacy_unclassified), the scoped one-active-holder index exists, the old
 *    unscoped index is gone, and the row counts are unchanged.
 *
 * Idempotent: if grant_scope already exists on entitlement_events the script
 * exits 0 without writing.
 *
 * Usage: SUPABASE_DATABASE_URL=postgres://... node scripts/apply-0095-to-supabase.mjs
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
process.env.R96_MIGRATION_ID = "0095";
requireCanonicalMigrationApproval(url, "0095");
const { default: postgres } = await import("postgres");
const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 15 });

const MIGRATION = "0095_entitlement_grant_provenance.sql";

try {
  // ---- idempotency: is the provenance column already present? ----
  const scopeColumn = await sql`SELECT 1 FROM information_schema.columns
    WHERE table_schema=current_schema() AND table_name='entitlement_events' AND column_name='grant_scope'`;
  if (scopeColumn.length > 0) {
    console.log("apply-0095: grant_scope already present — nothing to do (idempotent)");
    process.exit(0);
  }

  // ---- read-only preflight ----
  const events = (await sql`SELECT count(*)::int AS n FROM entitlement_events`)[0].n;
  const entitlements = (await sql`SELECT count(*)::int AS n FROM entitlements`)[0].n;
  const grantRenewal = (await sql`SELECT count(*)::int AS n FROM entitlement_events WHERE kind IN ('grant','renewal')`)[0].n;
  const activeOld = await sql`SELECT 1 FROM pg_indexes WHERE schemaname=current_schema() AND indexname='idx_entitlements_one_active_holder'`;
  console.log(`preflight: entitlement_events=${events} rows (grant/renewal=${grantRenewal}), entitlements=${entitlements} rows; old unscoped active index present: ${activeOld.length > 0}`);

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
  console.log(`apply-0095: ${translated.length} translated statement(s) in one transaction`);
  await sql.begin(async (tx) => {
    for (const statement of translated) await tx.unsafe(statement);
  });

  // ---- postflight ----
  const eventsAfter = (await sql`SELECT count(*)::int AS n FROM entitlement_events`)[0].n;
  const entsAfter = (await sql`SELECT count(*)::int AS n FROM entitlements`)[0].n;
  if (eventsAfter !== events) throw new Error(`postflight: entitlement_events row count changed ${events} -> ${eventsAfter}`);
  if (entsAfter !== entitlements) throw new Error(`postflight: entitlements row count changed ${entitlements} -> ${entsAfter}`);
  const scopeCheck = await sql`SELECT 1 FROM pg_constraint
    WHERE conrelid = 'entitlement_events'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%production%demo%legacy_unclassified%'`;
  if (scopeCheck.length === 0) throw new Error("postflight: the grant_scope CHECK vocabulary is not enforced on entitlement_events");
  const classification = await sql`SELECT grant_scope, count(*)::int AS n FROM entitlement_events GROUP BY grant_scope ORDER BY n DESC`;
  const entClassification = await sql`SELECT grant_scope, count(*)::int AS n FROM entitlements GROUP BY grant_scope ORDER BY n DESC`;
  const scopedIndex = await sql`SELECT 1 FROM pg_indexes WHERE schemaname=current_schema() AND indexname='idx_entitlements_one_active_holder_scope'`;
  if (scopedIndex.length !== 1) throw new Error("postflight: idx_entitlements_one_active_holder_scope missing after apply");
  const oldIndex = await sql`SELECT 1 FROM pg_indexes WHERE schemaname=current_schema() AND indexname='idx_entitlements_one_active_holder'`;
  if (oldIndex.length !== 0) throw new Error("postflight: the old unscoped one-active-holder index still exists");
  const eventsIndex = await sql`SELECT 1 FROM pg_indexes WHERE schemaname=current_schema() AND indexname='idx_entitlement_events_scope'`;
  if (eventsIndex.length !== 1) throw new Error("postflight: idx_entitlement_events_scope missing after apply");
  console.log(`postflight: CHECK enforced; row counts unchanged (events=${eventsAfter}, entitlements=${entsAfter})`);
  console.log(`postflight: event classification: ${JSON.stringify(classification.map(r => ({ [r.grant_scope]: r.n })))}`);
  console.log(`postflight: entitlement classification: ${JSON.stringify(entClassification.map(r => ({ [r.grant_scope]: r.n })))}`);
  console.log("apply-0095: Supabase canonical updated (entitlement grant provenance + scope)");
} finally {
  await sql.end({ timeout: 5 });
}

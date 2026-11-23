#!/usr/bin/env node
/**
 * R95-N14 owner-gated step: apply migration 0061 (the moderation parent
 * swap + active-case dedupe) to the Supabase canonical database.
 *
 * Runbook discipline (R95_MIGRATION_RUNBOOK.md):
 *  - uses the PRODUCTION translator (src/db/sqliteSqlToPostgres.ts), never
 *    ad hoc copied SQL;
 *  - one transaction for the whole file, so the table swap is atomic;
 *  - a read-only preflight first: it reports every duplicate ACTIVE group
 *    the deterministic merge will fold (oldest stays active) and every
 *    stuck-in-triage case the old 4-column UNIQUE left behind;
 *  - postflight verification: the partial unique indexes exist and the old
 *    status-in-key constraint is gone.
 *
 * Usage: SUPABASE_DATABASE_URL=postgres://... node scripts/apply-0061-to-supabase.mjs
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
requireCanonicalMigrationApproval(url, "0061");
const { default: postgres } = await import("postgres");
const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 15 });

const MIGRATION = "0061_r95_n14_moderation_active_case.sql";

try {
  const already = await sql`SELECT indexname FROM pg_indexes WHERE schemaname=current_schema() AND indexname IN ('uq_moderation_cases_active','uq_moderation_appeals_one_open')`;
  if (already.length === 1) throw new Error("Incomplete 0061 schema: only one required index exists; stop for reviewed repair");
  if (already.length === 2) {
    console.log("apply-0061: partial indexes already present — nothing to do (idempotent)");
    process.exit(0);
  }

  // ---- read-only preflight: what the merge will fold, what was stuck ----
  const duplicateGroups = await sql`
    SELECT reporter_user_id, target_table, target_id,
           COUNT(*) AS active_rows, MIN(id) AS keep_case_id,
           (SELECT array_agg(id ORDER BY id) FROM moderation_cases m2
             WHERE m2.status NOT LIKE 'resolved%'
               AND m2.reporter_user_id = moderation_cases.reporter_user_id
               AND m2.target_table = moderation_cases.target_table
               AND m2.target_id = moderation_cases.target_id) AS will_merge_case_ids
    FROM moderation_cases
    WHERE status NOT LIKE 'resolved%'
    GROUP BY reporter_user_id, target_table, target_id
    HAVING COUNT(*) > 1`;
  const stuckDecisions = await sql`
    SELECT id, status FROM moderation_cases
    WHERE status IN ('triaged','action_pending')
      AND EXISTS(SELECT 1 FROM moderation_cases earlier
                 WHERE earlier.status LIKE 'resolved%'
                   AND earlier.reporter_user_id = moderation_cases.reporter_user_id
                   AND earlier.target_table = moderation_cases.target_table
                   AND earlier.target_id = moderation_cases.target_id)`;
  console.log(`preflight: ${duplicateGroups.length} duplicate active group(s); ${stuckDecisions.length} case(s) stuck in triage by the old constraint`);
  // Do not print reporter identities or target IDs in shared execution logs.
  // Review the linked migration evidence in the restricted operator record.
  if (duplicateGroups.length) {
    console.log("  (the merge is deterministic: oldest active case stays; younger actives become resolved_merged with full provenance events)");
  }

  // ---- apply the whole file in ONE transaction through the translator ----
  const raw = readFileSync(join(root, "migrations", MIGRATION), "utf8");
  const statements = splitStatements(raw);
  const translated = [];
  for (const statement of statements) {
    const bare = stripLeadingComments(statement);
    if (/^\s*PRAGMA\b/i.test(bare)) continue; // SQLite connection directive; no PG schema meaning
    if (/^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(bare)) continue; // FTS5 is D1-only (documented mapping)
    translated.push(sqliteSqlToPostgres(ddlNormalize(statement)));
  }
  console.log(`apply-0061: ${translated.length} translated statement(s) in one transaction`);
  await sql.begin(async (tx) => {
    for (const statement of translated) await tx.unsafe(statement);
  });

  // ---- postflight ----
  const indexes = await sql`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname=current_schema() AND indexname IN ('uq_moderation_cases_active','uq_moderation_appeals_one_open')`;
  const tableDef = await sql`SELECT count(*)::int AS n FROM pg_indexes WHERE schemaname=current_schema() AND tablename='moderation_cases' AND indexdef LIKE '%ON moderation_cases%' AND indexdef LIKE '%status%' AND indexdef LIKE '%UNIQUE%' AND indexname NOT IN ('uq_moderation_cases_active')`;
  if (indexes.length !== 2) throw new Error(`postflight: expected both partial indexes, found ${JSON.stringify(indexes)}`);
  if (tableDef[0].n > 0) throw new Error(`postflight: a status-in-key unique index still exists on moderation_cases`);
  const merged = await sql`SELECT count(*)::int AS n FROM moderation_cases WHERE status='resolved_merged'`;
  const mergedEvents = await sql`SELECT count(*)::int AS n FROM moderation_case_events WHERE actor_user_id='migration_0061'`;
  console.log(`postflight: both partial indexes present; old status-in-key unique gone; ${merged[0].n} case(s) resolved_merged with ${mergedEvents[0].n} provenance event(s)`);
  console.log("apply-0061: Supabase canonical updated (N14 moderation dedup + standing lifecycle)");
} finally {
  await sql.end({ timeout: 5 });
}

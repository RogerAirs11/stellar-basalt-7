#!/usr/bin/env node
/**
 * R117-15 owner-gated step: apply migration 0089 (the command_receipts
 * CHECK-vocabulary widening) to the Supabase canonical database.
 *
 * Why a dedicated entrypoint (the 0061 precedent): 0089 is a data-carrying
 * table rebuild (SQLite cannot ALTER a CHECK, so the file uses the 12-step
 * create/copy/drop/rename shape). The consolidated range runner's statement
 * classifier only knows additive DDL and refuses DROP TABLE / RENAME — by
 * design, so every non-additive migration gets its own reviewed entrypoint.
 *
 * Runbook discipline (identical to apply-0061-to-supabase.mjs):
 *  - uses the PRODUCTION translator (src/db/sqliteSqlToPostgres.ts), never
 *    ad hoc copied SQL;
 *  - one transaction for the whole file, so the table swap is atomic;
 *  - a read-only preflight first: it reports the current CHECK vocabulary,
 *    the row count that will be copied verbatim, and the index state;
 *  - postflight verification: the widened CHECK vocabulary is enforced
 *    (inquiry.reply + inquiry.buyer_close accepted by the parser), the old
 *    narrow CHECK is gone, the actor index exists, and the row count is
 *    unchanged (the copy is verbatim — no data changes, no fabricated
 *    receipts).
 *
 * Idempotent: if the live CHECK already includes the two new commands the
 * script exits 0 without writing.
 *
 * Usage: SUPABASE_DATABASE_URL=postgres://... node scripts/apply-0089-to-supabase.mjs
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
requireCanonicalMigrationApproval(url, "0089");
const { default: postgres } = await import("postgres");
const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 15 });

const MIGRATION = "0089_r117_marketplace_receipt_commands.sql";

try {
  // ---- idempotency: is the widened vocabulary already enforced? ----
  const checks = await sql`SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'command_receipts'::regclass AND contype = 'c'`;
  const commandCheck = checks.find(c => /command/i.test(c.conname) || /command\s*(=|IN|ANY)/i.test(c.def));
  if (commandCheck && /'inquiry\.reply'/.test(commandCheck.def) && /'inquiry\.buyer_close'/.test(commandCheck.def)) {
    console.log("apply-0089: widened CHECK already enforced — nothing to do (idempotent)");
    process.exit(0);
  }

  // ---- read-only preflight ----
  const rows = (await sql`SELECT count(*)::int AS n FROM command_receipts`)[0].n;
  const actorIndex = await sql`SELECT 1 FROM pg_indexes WHERE schemaname=current_schema() AND indexname='idx_command_receipts_actor'`;
  console.log(`preflight: command_receipts has ${rows} row(s) to copy verbatim; current CHECK: ${commandCheck ? commandCheck.def : "none found"}; actor index present: ${actorIndex.length > 0}`);

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
  console.log(`apply-0089: ${translated.length} translated statement(s) in one transaction`);
  await sql.begin(async (tx) => {
    for (const statement of translated) await tx.unsafe(statement);
  });

  // ---- postflight ----
  const after = await sql`SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'command_receipts'::regclass AND contype = 'c'`;
  const widened = after.find(c => /'inquiry\.reply'/.test(c.def) && /'inquiry\.buyer_close'/.test(c.def));
  if (!widened) throw new Error(`postflight: widened CHECK not found after apply: ${JSON.stringify(after)}`);
  const narrow = after.find(c => /'listing\.create'/.test(c.def) && !/'inquiry\.reply'/.test(c.def));
  if (narrow) throw new Error(`postflight: an old narrow CHECK still exists: ${narrow.conname}`);
  const idxAfter = await sql`SELECT 1 FROM pg_indexes WHERE schemaname=current_schema() AND indexname='idx_command_receipts_actor'`;
  if (idxAfter.length !== 1) throw new Error("postflight: idx_command_receipts_actor missing after rebuild");
  const rowsAfter = (await sql`SELECT count(*)::int AS n FROM command_receipts`)[0].n;
  if (rowsAfter !== rows) throw new Error(`postflight: row count changed ${rows} -> ${rowsAfter} (the copy must be verbatim)`);
  console.log(`postflight: widened CHECK enforced (${widened.def.slice(0, 120)}…); actor index present; row count unchanged (${rows})`);
  console.log("apply-0089: Supabase canonical updated (marketplace receipt vocabulary widening)");
} finally {
  await sql.end({ timeout: 5 });
}

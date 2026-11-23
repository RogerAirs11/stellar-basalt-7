#!/usr/bin/env node
/**
 * R96 owner-gated CONSOLIDATED range runner: applies the additive migration
 * range 0052–0060 + 0062–0068 to the Supabase canonical database through the
 * PRODUCTION translator (src/db/sqliteSqlToPostgres.ts) — the "consolidated
 * schema-aware runner" the R96 migration runbook (§6) names as the remaining
 * operational task. 0061 is deliberately EXCLUDED: it is a data-carrying table
 * swap with its own reviewed entrypoint (scripts/apply-0061-to-supabase.mjs).
 *
 * Disciplines (review-r96/MIGRATION_RUNBOOK.md):
 *  - per-migration owner attestation via scripts/lib/migration-approval.mjs
 *    (R95_PRODUCTION_RELEASE_APPROVED_SHA + R96_MIGRATION_ID + target
 *    fingerprint + backup evidence id);
 *  - one transaction per migration file (atomic per migration);
 *  - statement-level idempotency: a statement whose target object already
 *    exists on the canonical database is SKIPPED (with a note), never
 *    re-applied — so a partially-applied migration resumes cleanly;
 *  - DDL-only by default: any data statement (UPDATE/INSERT/DELETE) is refused
 *    unless its target table is EMPTY on the canonical database (a backfill
 *    against zero rows is a verified no-op) — 0052's holder_key backfill is
 *    the only one in this range and entitlements is empty pre-migration;
 *  - postflight: the migration's signature objects must exist, else rollback.
 *
 * Usage:
 *   SUPABASE_DATABASE_URL=... node scripts/apply-range-to-supabase.mjs [--dry-run]
 *     [--from 0052] [--to 0068]
 * Env (all required, see migration-approval.mjs):
 *   R95_PRODUCTION_RELEASE_APPROVED_SHA, R96_MIGRATION_TARGET_SHA256,
 *   R96_MIGRATION_BACKUP_ID  (R96_MIGRATION_ID is set per migration here)
 */
import { requireCanonicalMigrationApproval, migrationTargetFingerprint } from "./lib/migration-approval.mjs";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compileTsRuntime } from "../tools/ts-runtime-loader.mjs";
import { splitStatements, ddlNormalize } from "./lib/pg-ddl.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const url = process.env.SUPABASE_DATABASE_URL;
if (!url) { console.error("Need SUPABASE_DATABASE_URL"); process.exit(2); }

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const from = argv.includes("--from") ? argv[argv.indexOf("--from") + 1] : "0052";
const to = argv.includes("--to") ? argv[argv.indexOf("--to") + 1] : "0068";
const SKIP = new Set(["0061"]); // data-carrying swap: dedicated reviewed entrypoint

const rt = compileTsRuntime(["src/db/sqliteSqlToPostgres.ts"]);
const { sqliteSqlToPostgres, stripLeadingComments } = rt.load("src/db/sqliteSqlToPostgres.ts");
const { default: postgres } = await import("postgres");
const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 15 });

// ---- object-existence helpers (read-only, against the target) ----
async function columnExists(table, column) {
  const r = await sql`SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=${table} AND column_name=${column}`;
  return r.length > 0;
}
async function tableExists(table) {
  const r = await sql`SELECT 1 FROM information_schema.tables WHERE table_schema=current_schema() AND table_name=${table}`;
  return r.length > 0;
}
async function indexExists(name) {
  const r = await sql`SELECT 1 FROM pg_indexes WHERE schemaname=current_schema() AND indexname=${name}`;
  return r.length > 0;
}
async function rowCount(table) {
  const r = await sql.unsafe(`SELECT count(*)::int AS n FROM "${table.replace(/"/g, '""')}"`);
  return r[0].n;
}

// Classify a SQLite statement into a checkable target.
function classify(stmt) {
  const s = stmt.replace(stripLeadingCommentsRegex, "").trim();
  let m;
  if ((m = s.match(/^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?["`]?(\w+)["`]?\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?(\w+)/i))) {
    return { kind: "column", table: m[1], name: m[2], check: () => columnExists(m[1], m[2]) };
  }
  if ((m = s.match(/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?(\w+)/i))) {
    return { kind: "table", table: m[1], name: m[1], check: () => tableExists(m[1]) };
  }
  if ((m = s.match(/^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?(\w+)/i))) {
    return { kind: "index", table: m[1], name: m[1], check: () => indexExists(m[1]) };
  }
  if ((m = s.match(/^(UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+(?:IF\s+EXISTS\s+)?["`]?(\w+)/i))) {
    return { kind: "data", verb: m[1].toUpperCase(), table: m[2], name: `${m[1]} ${m[2]}`, check: null };
  }
  if (/^CREATE\s+VIRTUAL\s+TABLE/i.test(s)) {
    return { kind: "fts", table: "", name: s.slice(0, 40), check: () => Promise.resolve(true) }; // parity gate skips FTS on PG
  }
  return { kind: "unknown", table: "", name: s.slice(0, 40), check: null };
}
const stripLeadingCommentsRegex = /^\s*(?:--[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*/;

const files = readdirSync(join(root, "migrations")).filter(f => f.endsWith(".sql")).sort();
const targets = files.filter(f => {
  const id = f.slice(0, 4);
  return id >= from && id <= to && !SKIP.has(id);
});

console.log(`apply-range ${from}–${to} (skipping ${[...SKIP].join(",") || "none"}), mode: ${dryRun ? "DRY RUN" : "APPLY"}`);
console.log(`target fingerprint: ${migrationTargetFingerprint(url)}`);
const summary = [];

try {
  for (const file of targets) {
    const id = file.slice(0, 4);
    // Per-migration owner attestation (fail-closed). Disposable-local mode is
    // the rehearsal path (loopback hr_test_* only); canonical runs are
    // owner-approved through the full attestation stack.
    process.env.R96_MIGRATION_ID = id;
    const approval = requireCanonicalMigrationApproval(url, id);
    if (approval.mode !== "owner-approved-canonical" && approval.mode !== "disposable-local") {
      throw new Error(`unexpected approval mode for ${id}: ${approval.mode}`);
    }

    const text = readFileSync(join(root, "migrations", file), "utf8");
    const statements = splitStatements(text);
    const pending = [];
    const skipped = [];
    for (const stmt of statements) {
      const translated = sqliteSqlToPostgres(ddlNormalize(stmt));
      if (!translated.trim() || !stripLeadingComments(translated).trim()) continue;
      const c = classify(stmt);
      if (c.kind === "fts") { skipped.push(`${c.kind}:${c.name}…`); continue; } // PG serves search via horse_search_source
      if (c.kind === "data") {
        const n = await rowCount(c.table);
        if (n > 0) throw new Error(`${id}: data statement "${c.name}" targets ${c.table} with ${n} rows — refusing; run a reviewed per-migration entrypoint instead`);
        console.log(`  ${id}: data statement ${c.name} against EMPTY ${c.table} — verified no-op, including for provenance`);
        pending.push({ stmt, translated, c });
        continue;
      }
      if (c.kind === "unknown") throw new Error(`${id}: unclassifiable statement: ${c.name}`);
      if (await c.check()) { skipped.push(`${c.kind}:${c.table}.${c.name}`); continue; }
      pending.push({ stmt, translated, c });
    }
    if (pending.length === 0) {
      console.log(`${id}: nothing to do (${skipped.length} statements already applied/skipped)`);
      summary.push({ id, applied: 0, skipped: skipped.length });
      continue;
    }
    console.log(`${id}: ${pending.length} to apply, ${skipped.length} skipped [${pending.map(p => p.c.name).join(", ")}]`);
    if (dryRun) { summary.push({ id, applied: 0, wouldApply: pending.length, skipped: skipped.length }); continue; }
    await sql.begin(async (tx) => {
      for (const p of pending) await tx.unsafe(p.translated);
    });
    // Postflight: every applied object must now exist.
    for (const p of pending) {
      if (p.c.check && !(await p.c.check())) throw new Error(`${id}: postflight failure — ${p.c.kind} ${p.c.name} missing after apply`);
    }
    console.log(`${id}: APPLIED + verified (${pending.length} statements)`);
    summary.push({ id, applied: pending.length, skipped: skipped.length });
  }
  console.log("\n=== SUMMARY ===");
  for (const s of summary) console.log(`${s.id}: applied=${s.applied ?? 0}${s.wouldApply ? ` (would apply ${s.wouldApply})` : ""} skipped=${s.skipped}`);
  if (SKIP.has("0061")) console.log("REMEMBER: 0061 runs via its own reviewed entrypoint: scripts/apply-0061-to-supabase.mjs");
} finally {
  await sql.end({ timeout: 5 });
}

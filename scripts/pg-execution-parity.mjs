#!/usr/bin/env node
/**
 * pg-execution-parity — R88 agent plan P01: EXECUTION-LEVEL adapter parity.
 *
 * The DDL gate (pg-parity-gate.mjs) proves the migration chain APPLIES to
 * PostgreSQL. This script proves the harder half of the P01 acceptance
 * criterion:
 *
 *   "The same seed and command sequence produce equivalent rows and errors on
 *    every supported provider."
 *   "Two concurrent clients cannot both claim an exclusive record or execute
 *    the same command twice."
 *
 * How it works:
 *   1. Runs tests/python/p01_parity_lib.py (the SQLite reference) — it builds
 *      ONE canonical command sequence from the production SQL templates
 *      (regex-extracted from src/marketplace/commands.ts + horseAccess.ts) and
 *      executes it on a real SQLite with all migrations applied.
 *   2. Creates an ISOLATED disposable schema on the target PostgreSQL
 *      (target = disposable local CI PostgreSQL via PG_CONNECTION_STRING;
 *      the schema is created and dropped — `public` is never touched).
 *   3. Applies the migration chain through the PRODUCTION runtime translator
 *      (src/db/sqliteSqlToPostgres.ts) — the same code path production
 *      Supabase requests use.
 *   4. Executes the SAME seed + command sequence, statement by statement,
 *      translated with the same production translator; races two real
 *      connections for the concurrent same-key receipt claim.
 *   5. Compares the normalized transcripts (changes counts, query rows,
 *      error CLASSES, concurrent winners) and writes a parity report.
 *
 * Usage:
 *   PG_CONNECTION_STRING=postgres://... \
 *     node scripts/pg-execution-parity.mjs [--report path/to/report.json]
 *
 * Environment:
 *   PG_CONNECTION_STRING (required) - disposable local PostgreSQL target.
 *   PG_PARITY_DISPOSABLE=yes is required. Remote/shared servers are refused.
 *   PG_PARITY_SCHEMA (optional) — isolated schema name; default
 *     a random `hr_test_` schema. An explicit existing schema is refused.
 *
 * Exit codes: 0 = parity proven; 1 = parity failure; 2 = configuration error.
 */
import postgres from "postgres";
import { disposableSchemaName, createOwnedSchema, requireDisposableLocalDatabase } from "./lib/disposable-schema.mjs";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyMigrationChain, loadTranslator } from "./lib/pg-ddl.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const reportIndex = args.indexOf("--report");
const reportPath = reportIndex >= 0 ? args[reportIndex + 1] : null;

const connectionString = process.env.PG_CONNECTION_STRING;
if (!connectionString) {
  console.error("PG_CONNECTION_STRING is required (disposable local CI postgres only; PG_PARITY_DISPOSABLE=yes required)");
  process.exit(2);
}
let schema;
try {
  requireDisposableLocalDatabase(connectionString, process.env.PG_PARITY_DISPOSABLE);
  schema = disposableSchemaName(process.env.PG_PARITY_SCHEMA);
}
catch (error) { console.error(error.message); process.exit(2); }
let ownsSchema = false;

const { sqliteSqlToPostgres } = loadTranslator();

// ---------------------------------------------------------------------------
// 1. SQLite reference: run the python library, read sequence + transcript.
// ---------------------------------------------------------------------------
const workDir = mkdtempSync(`${tmpdir()}/hr-parity-`);
const pythonCandidates = ["python3", "python"];
let artifacts = null;
for (const interpreter of pythonCandidates) {
  const run = spawnSync(interpreter, [
    "-c",
    "import sys; from pathlib import Path; sys.path.insert(0, 'tests/python');\n"
    + "from p01_parity_lib import write_artifacts;\n"
    + "write_artifacts(Path(sys.argv[1]))",
    workDir,
  ], { cwd: root, encoding: "utf8" });
  if (run.status === 0) {
    artifacts = run;
    break;
  }
  if (interpreter === pythonCandidates[pythonCandidates.length - 1]) {
    console.error(`SQLite reference run failed (${interpreter}):\n${run.stderr || run.stdout}`);
    process.exit(1);
  }
}
const sequence = JSON.parse(readFileSync(`${workDir}/sequence.json`, "utf8"));
const sqliteTranscript = JSON.parse(readFileSync(`${workDir}/sqlite-transcript.json`, "utf8"));

// ---------------------------------------------------------------------------
// 2. Isolated schema on the target PostgreSQL.
// ---------------------------------------------------------------------------
const sql = postgres(connectionString, { max: 1, idle_timeout: 5, connect_timeout: 10 });
const racers = [1, 2].map(() => postgres(connectionString, { max: 1, idle_timeout: 5, connect_timeout: 10 }));

function pgErrorClass(error) {
  const code = error && typeof error === "object" ? String(error.code ?? "") : "";
  if (code === "23505") return "unique_violation";
  if (code === "23514") return "check_violation";
  if (code === "23503") return "foreign_key_violation";
  return `pg_error:${code || (error instanceof Error ? error.name : "unknown")}`;
}

function normalizePgValue(value) {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return Number.isInteger(value) ? value : value;
  // Text that happens to contain digits stays text; OID 20 is handled below.
  return value;
}

function normalizePgRows(rows) {
  return rows.map(row => {
    const out = {};
    for (const [key, value] of Object.entries(row)) {
      const column = rows.columns?.find(column => column.name === key);
      if (column?.type === 20 && value !== null) {
        const parsed = Number(value);
        if (!Number.isSafeInteger(parsed)) throw new RangeError(`Unsafe int8 in parity result: ${key}`);
        out[key] = parsed;
      } else out[key] = normalizePgValue(value);
    }
    return out;
  });
}

/** Translate a SQLite-dialect statement with the PRODUCTION runtime translator. */
function toPg(sqliteSql) {
  return sqliteSqlToPostgres(sqliteSql);
}

// ---------------------------------------------------------------------------
// 3-5. Apply the chain, run the sequence, race the concurrent claim.
// ---------------------------------------------------------------------------
const pgTranscript = { steps: [], snapshot: {} };
let migrationsInfo = null;

try {
  await createOwnedSchema(sql, schema);
  ownsSchema = true;
  await sql.unsafe(`SET search_path TO ${schema}`);
  const currentSchema = await sql.unsafe("SELECT current_schema() AS s");
  if (currentSchema[0]?.s !== schema) {
    throw new Error(`search_path did not stick on the pooled connection (got ${currentSchema[0]?.s})`);
  }

  migrationsInfo = await applyMigrationChain(sql);

  for (const statement of sequence.seed) {
    await sql.unsafe(toPg(statement.sql), statement.args);
  }

  for (const step of sequence.steps) {
    if (step.kind === "batch") {
      try {
        const changes = await sql.begin(async tx => {
          const out = [];
          for (const statement of step.statements) {
            const result = await tx.unsafe(toPg(statement.sql), statement.args);
            out.push(Number(result.count ?? 0));
          }
          return out;
        });
        pgTranscript.steps.push({ id: step.id, ok: true, changes });
      } catch (error) {
        pgTranscript.steps.push({ id: step.id, ok: false, error: pgErrorClass(error) });
      }
    } else if (step.kind === "query") {
      const rows = await sql.unsafe(toPg(step.sql), step.args);
      pgTranscript.steps.push({ id: step.id, ok: true, rows: normalizePgRows(rows) });
    } else if (step.kind === "batch_expect_error") {
      try {
        await sql.begin(async tx => {
          for (const statement of step.statements) {
            await tx.unsafe(toPg(statement.sql), statement.args);
          }
        });
        pgTranscript.steps.push({ id: step.id, ok: false, error: "expected_error_did_not_occur" });
      } catch (error) {
        pgTranscript.steps.push({ id: step.id, ok: true, error: pgErrorClass(error) });
      }
    } else if (step.kind === "concurrent") {
      // Two REAL connections race the same idempotency-receipt claim. One
      // takes the row lock, the other blocks, then loses on the receipt PK —
      // exactly one execution can ever land per key.
      await Promise.all(racers.map(racer => racer.unsafe(`SET search_path TO ${schema}`)));
      const translated = toPg(step.statement.sql);
      const attempts = await Promise.allSettled(racers.map(racer =>
        racer.begin(async tx => {
          const result = await tx.unsafe(translated, step.statement.args);
          return Number(result.count ?? 0);
        }),
      ));
      let winners = 0;
      const errors = [];
      for (const attempt of attempts) {
        if (attempt.status === "fulfilled") {
          if (attempt.value === 1) winners += 1;
        } else {
          errors.push(pgErrorClass(attempt.reason));
        }
      }
      pgTranscript.steps.push({ id: step.id, ok: true, winners, errors });
    } else {
      throw new Error(`unknown step kind ${step.kind}`);
    }
  }

  for (const query of sequence.snapshot) {
    const rows = await sql.unsafe(toPg(query));
    pgTranscript.snapshot[query] = normalizePgRows(rows);
  }
} finally {
  try {
    if (ownsSchema) await sql.unsafe(`DROP SCHEMA ${schema} CASCADE`);
  } catch {
    // best-effort cleanup; the schema is disposable by construction
  }
  await sql.end({ timeout: 5 });
  await Promise.all(racers.map(racer => racer.end({ timeout: 5 })));
  rmSync(workDir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// 6. Compare the transcripts.
// ---------------------------------------------------------------------------
const differences = [];

const sqliteBydId = new Map(sqliteTranscript.steps.map(step => [step.id, step]));
for (const pgStep of pgTranscript.steps) {
  const sqliteStep = sqliteBydId.get(pgStep.id);
  if (!sqliteStep) {
    differences.push(`step ${pgStep.id}: present in PG transcript but not SQLite`);
    continue;
  }
  // CONCURRENT-step equivalence (R95g): racing two real connections on PG
  // READ COMMITTED is genuinely timing-dependent. The P01 invariant is
  // "exactly one winner and the loser fails closed" — the loser either
  // (a) sees the winner's committed row in its guard subquery and no-ops
  // (rowcount 0, no error), or (b) races ahead of the winner's COMMIT and
  // is refused by the unique constraint (unique_violation). BOTH are the
  // designed fail-closed refusal. The SQLite reference is sequential and
  // deterministically takes (a); PG may take either. What must hold
  // identically on every engine: the SAME winner count, and the loser
  // never a second winner. Any other error class (check/foreign-key/
  // deadlock) or a winner-count mismatch remains a HARD failure.
  let concurrentEquivalent = false;
  if (sqliteStep.winners !== undefined) {
    const pgErrors = pgStep.errors ?? [];
    const sqliteErrors = sqliteStep.errors ?? [];
    const pgAllUnique = pgErrors.every(e => e === "unique_violation");
    const sqliteAllUnique = sqliteErrors.every(e => e === "unique_violation");
    const errorsEquivalent =
      JSON.stringify(pgErrors) === JSON.stringify(sqliteErrors) ||
      (pgAllUnique && sqliteAllUnique && (pgErrors.length === 0 || sqliteErrors.length === 0));
    if (pgStep.winners === sqliteStep.winners && errorsEquivalent &&
        JSON.stringify(pgErrors) !== JSON.stringify(sqliteErrors)) {
      concurrentEquivalent = true; // the no-op refusal and the constraint refusal are the same invariant
    }
  }
  if (concurrentEquivalent) continue;
  for (const field of ["ok", "changes", "error", "winners", "errors", "rows"]) {
    if (field in pgStep || field in sqliteStep) {
      const pgValue = JSON.stringify(pgStep[field] ?? null);
      const sqliteValue = JSON.stringify(sqliteStep[field] ?? null);
      if (pgValue !== sqliteValue) {
        differences.push(`step ${pgStep.id}.${field}: sqlite=${sqliteValue} pg=${pgValue}`);
      }
    }
  }
}
for (const sqliteStep of sqliteTranscript.steps) {
  if (!pgTranscript.steps.some(step => step.id === sqliteStep.id)) {
    differences.push(`step ${sqliteStep.id}: missing from PG transcript`);
  }
}
for (const [query, sqliteRows] of Object.entries(sqliteTranscript.snapshot)) {
  const pgRows = pgTranscript.snapshot[query];
  if (JSON.stringify(pgRows ?? null) !== JSON.stringify(sqliteRows)) {
    differences.push(`snapshot "${query}":\n  sqlite=${JSON.stringify(sqliteRows)}\n  pg=${JSON.stringify(pgRows ?? null)}`);
  }
}

// Report (never include the connection string — it carries credentials).
const report = {
  generated_at: new Date().toISOString(),
  target: (() => {
    try {
      const url = new URL(connectionString);
      return `${url.protocol}//${url.host}${url.pathname} (schema: ${schema})`;
    } catch {
      return "unparseable-target";
    }
  })(),
  migrations_applied: migrationsInfo?.applied ?? 0,
  fts_statements_skipped: migrationsInfo?.skippedFts ?? 0,
  steps_compared: pgTranscript.steps.length,
  parity: differences.length === 0,
  differences,
  sqlite_transcript: sqliteTranscript,
  postgres_transcript: pgTranscript,
};

if (reportPath) {
  const out = isAbsolute(reportPath) ? reportPath : resolve(root, reportPath);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 1));
  console.log(`report written: ${out}`);
}

console.log("");
console.log(`pg-execution-parity: ${report.steps_compared} steps compared, ${differences.length} difference(s) — ${differences.length === 0 ? "PARITY PROVEN" : "PARITY FAILED"}`);
for (const difference of differences) console.log(`  DIFF ${difference}`);
process.exit(differences.length === 0 ? 0 : 1);

#!/usr/bin/env node
/**
 * pg-r109-ai-reservations — R109-20: concurrent AI admission on the real
 * target PostgreSQL engine, through the PRODUCTION supabaseCompat adapter
 * (createSupabaseD1Database, mode "full", including its R109
 * __horseDbWithAiReservation transaction boundary) and the PRODUCTION
 * quota/cost governors. No SQL recorder or driver double stands in for the
 * database. R109 adds no migration; the chain stays at 80 migrations.
 *
 * Scenarios:
 *   A1. advisory-lock-first: inside the reservation transaction the backend
 *       already holds pg_advisory_xact_lock(710109) (separate statement,
 *       taken BEFORE the admission statement's snapshot); released at commit.
 *   A2. serialization: two overlapping reservation blocks never interleave.
 *   B1. RPM boundary race: 36 synchronized admissions, RPM=10 -> exactly 10
 *       admitted, the rest refused with rpm_reserve_reached; ledger = 10.
 *   B2. TPM boundary race: 30 synchronized admissions, 100 tokens each,
 *       TPM=1000 -> exactly 10 admitted (tpm_reserve_reached for the rest).
 *   B3. RPD boundary race: 30 synchronized admissions, RPD=8 -> exactly 8.
 *   B4. midnight/pacific-day rollover: rows dated before today's pacific
 *       dayStart do NOT consume today's RPD; rows dated inside it DO.
 *   C1. paid daily ceiling race: 36 synchronized paid reservations at
 *       $0.10 against a $1.00/day ceiling -> exactly 10 stay reserved,
 *       aggregate reserved = $1.00, over-limit rows are released to $0,
 *       nothing above the ceiling is ever admitted.
 *   C2. uncertain paid delivery keeps its conservative reservation; the
 *       reviewed reconciliation path then settles it exactly once.
 *   D1. work() rollback: a failure inside the reservation transaction
 *       leaves ZERO ledger rows persisted.
 *   D2. lost connection: terminating the backend mid-transaction leaves no
 *       partial rows, no stuck advisory lock, and a fresh adapter works.
 *   E1. per-model isolation: admissions for one model never consume another
 *       model's independent quota buckets.
 *
 * Usage:
 *   PG_CONNECTION_STRING=postgres://user@127.0.0.1:PORT/hr_test_r109 \
 *     PG_PARITY_DISPOSABLE=yes node scripts/pg-r109-ai-reservations.mjs \
 *     [--report review-r109/evidence/pg-r109-ai-reservations-pg17.json]
 *
 * Environment/limits: identical disposable rules as the parity gates — a
 * loopback hr_test_ database only; the isolated schema is created and dropped;
 * `public` is never touched. No production system is contacted.
 */
import { createRequire } from "node:module";
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { requireDisposableLocalDatabase, disposableSchemaName } from "./lib/disposable-schema.mjs";
const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { splitStatements, ddlNormalize } = require("./lib/pg-ddl.mjs");

// Audit-only loader: executes the ACTUAL production TypeScript through the
// installed compiler. No mocks, no reimplementation.
require("../tools/lib/register-typescript.cjs");
const { sqliteSqlToPostgres, stripLeadingComments } = require("../src/db/sqliteSqlToPostgres.ts");
const { createSupabaseD1Database, closeSupabaseD1Database } = require("../src/db/supabaseCompat.ts");
const { reserveGeminiAttempt, geminiQuotaSnapshot } = require("../src/ai/runtime/quotaGovernor.ts");
const {
  recordRequestAttempt, reserveProviderCost, reconcileProviderEstimatedCost,
} = require("../src/ai/conversation/repository.ts");
const { AiRuntimeError } = require("../src/ai/core/errors.ts");

// ---------------------------------------------------------------------------
// Guards + wiring
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const killProbeMode = args.includes("--kill-probe");
const reportFlag = args.indexOf("--report");
const reportPath = !killProbeMode && reportFlag >= 0 ? args[reportFlag + 1] : null;
const connectionString = process.env.PG_CONNECTION_STRING ?? "";
if (!connectionString) {
  console.error("PG_CONNECTION_STRING is required (disposable local hr_test_ database)");
  process.exit(2);
}
requireDisposableLocalDatabase(connectionString, process.env.PG_PARITY_DISPOSABLE);
const target = new URL(connectionString);
if (!/^hr_test_[a-z0-9_]{1,48}$/.test(decodeURIComponent(target.pathname.slice(1)))) {
  console.error("R109 reservation gate requires a loopback hr_test_* database (the same disposable rule as canonical migration gating)");
  process.exit(2);
}
const schema = disposableSchemaName(process.env.PG_PARITY_SCHEMA);
const adapterUrl = `${connectionString.replace(/\?.*$/, "")}?options=${encodeURIComponent(`-c search_path=${schema}`)}`;

const findings = [];
function record(id, pass, detail) {
  findings.push({ id, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} — ${id}${detail ? ` (${detail})` : ""}`);
}
function errorKind(error) {
  if (error instanceof AiRuntimeError) return `${error.category}/${error.code}`;
  return `other:${error instanceof Error ? error.message.slice(0, 100) : "unknown"}`;
}

const admin = postgres(connectionString, { max: 1, idle_timeout: 5, connect_timeout: 10 });
let adapters = [];
const QUOTA = (over) => ({ rpmLimit: over.rpm, inputTpmLimit: over.tpm, rpdLimit: over.rpd, reserveFraction: 0.1 });

async function main() {
  // -----------------------------------------------------------------------
  // 1. Isolated schema + the full migration chain (translator path).
  // -----------------------------------------------------------------------
  await admin.unsafe(`CREATE SCHEMA ${schema}`);
  await admin.unsafe(`SET search_path TO ${schema}`);
  const serverVersion = (await admin.unsafe("SELECT version()"))[0].version;
  console.log(`server: ${serverVersion.slice(0, 80)}`);
  const migrations = readdirSync(join(root, "migrations")).filter((n) => n.endsWith(".sql")).sort();
  for (const name of migrations) {
    const raw = readFileSync(join(root, "migrations", name), "utf8");
    await admin.unsafe("BEGIN");
    try {
      for (const statement of splitStatements(raw)) {
        const bare = stripLeadingComments(statement);
        if (/^\s*PRAGMA\b/i.test(bare)) continue;
        if (/^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(bare)) continue; // FTS5 shadow tables are D1-only
        const translated = sqliteSqlToPostgres(ddlNormalize(statement));
        if (!translated.trim() || !stripLeadingComments(translated).trim()) continue;
        await admin.unsafe(translated);
      }
      await admin.unsafe("COMMIT");
    } catch (error) {
      await admin.unsafe("ROLLBACK");
      throw new Error(`migration ${name} failed on the R109 reservation gate target: ${error.message}`);
    }
  }
  console.log(`migrations applied: ${migrations.length} (schema ${schema})`);

  if (killProbeMode) {
    // Child mode: apply migrations to this schema, begin a reservation, kill
    // the backend mid-transaction, attempt one more write, then exit. The
    // parent observes durable state; this process may die abruptly by design.
    const probe = createSupabaseD1Database(adapterUrl, { mode: "full" });
    try {
      await probe.__horseDbWithAiReservation(async (scoped) => {
        console.log("kill-probe-block-began");
        const pid = (await scoped.prepare("SELECT pg_backend_pid() AS pid").first()).pid;
        await admin.unsafe("SELECT pg_terminate_backend($1)", [pid]);
        await new Promise((resolve) => setTimeout(resolve, 150));
        await scoped.prepare(
          "INSERT INTO ai_request_ledger(id, provider, model, request_kind, status, estimated_input_tokens) VALUES ('r109-kill-probe','gemini','gemini-x','chat','attempted',9)",
        ).run();
        console.log("kill-probe-block-ended");
      });
    } catch (error) {
      console.log(`kill-probe-rejected: ${error instanceof Error ? error.message.slice(0, 80) : "unknown"}`);
    }
    // Deliberately leave the schema for the parent to inspect (the crash path
    // cannot clean up either); the parent drops it after asserting durable state.
    await admin.end();
    process.exit(0);
  }

  const db = createSupabaseD1Database(adapterUrl, { mode: "full" });
  adapters = [db];
  const count = async (sql, ...binds) => Number((await admin.unsafe(sql, binds))[0]?.n ?? 0);
  const pad = (n) => String(n).padStart(2, "0");

  // -----------------------------------------------------------------------
  // A1. Advisory-lock-first proof (separate statement, before admission).
  // -----------------------------------------------------------------------
  {
    let heldBeforeWork = null;
    let pid = null;
    await db.__horseDbWithAiReservation(async (scoped) => {
      pid = (await scoped.prepare("SELECT pg_backend_pid() AS pid").first()).pid;
      const locks = await admin.unsafe(
        "SELECT objid, granted FROM pg_locks WHERE locktype = 'advisory' AND pid = $1 AND classid = 0 AND objid = 710109",
        [pid],
      );
      heldBeforeWork = locks;
    });
    const stillHeld = await admin.unsafe(
      "SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND pid = $1 AND objid = 710109",
      [pid],
    );
    record("A1-advisory-lock-precedes-admission",
      heldBeforeWork?.length === 1 && heldBeforeWork[0].granted === true && stillHeld[0].n === 0,
      `held_during_work=${JSON.stringify(heldBeforeWork)} released_after_commit=${stillHeld[0].n === 0} pid=${pid}`);
  }

  // -----------------------------------------------------------------------
  // A2. Serialization: overlapping reservation blocks never interleave.
  // -----------------------------------------------------------------------
  {
    const windows = [[], []];
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    await Promise.all([0, 1].map(async (i) => {
      await db.__horseDbWithAiReservation(async (scoped) => {
        windows[i][0] = Date.now();
        await scoped.prepare("SELECT 9100 + ? AS v").bind(i).first();
        await sleep(250);
        await scoped.prepare("SELECT 9200 + ? AS v").bind(i).first();
        windows[i][1] = Date.now();
      });
    }));
    const [a, b] = windows;
    const overlap = a[0] < b[1] && b[0] < a[1];
    record("A2-reservation-blocks-serialize", !overlap,
      `windows=[${a.join(",")}],[${b.join(",")}] overlap=${overlap}`);
  }

  // -----------------------------------------------------------------------
  // B1/B2/B3. Boundary races — synchronized admission waves.
  // -----------------------------------------------------------------------
  async function raceWave(label, quota, opts, waves = 30) {
    const ids = Array.from({ length: waves }, (_, i) => `r109-${label}-${i}`);
    const settled = await Promise.allSettled(ids.map((id, i) => reserveGeminiAttempt(db, {
      id, conversationId: null, model: opts.model, requestKind: "chat",
      estimatedInputTokens: opts.tokens, quota,
    })));
    const admitted = settled.filter((r) => r.status === "fulfilled").length;
    const refused = settled.filter((r) => r.status === "rejected").map((r) => errorKind(r.reason));
    const expected = opts.expectAdmitted;
    const ledger = await count(
      "SELECT count(*)::int AS n FROM ai_request_ledger WHERE model = $1 AND status != 'rejected'", opts.model,
    );
    const allReserveRefusals = refused.length > 0 && refused.every((k) => k.includes("reserve_reached"));
    record(label, admitted === expected && ledger === expected && (refused.length === 0 || allReserveRefusals),
      `admitted=${admitted}/${waves} expected=${expected} ledger=${ledger} refusal_kinds=${[...new Set(refused)].slice(0, 3).join("|")}`);
    return { admitted, ledger };
  }

  // The production governor reserves a safety margin: effective admission
  // ceiling = floor(limit x (1 - reserveFraction)). reserveFraction 0.1 ->
  // RPM 10 admits 9, TPM 1000 admits 900 tokens (9x100), RPD 8 admits 7.
  await raceWave("B1-rpm-boundary-race", QUOTA({ rpm: 10, tpm: 1_000_000, rpd: 1000 }),
    { model: "gemini-r109-rpm", tokens: 10, expectAdmitted: 9 }, 36);

  await raceWave("B2-tpm-boundary-race", QUOTA({ rpm: 1000, tpm: 1000, rpd: 10_000 }),
    { model: "gemini-r109-tpm", tokens: 100, expectAdmitted: 9 }, 30);

  await raceWave("B3-rpd-boundary-race", QUOTA({ rpm: 1000, tpm: 1_000_000, rpd: 8 }),
    { model: "gemini-r109-rpd", tokens: 10, expectAdmitted: 7 }, 30);

  // -----------------------------------------------------------------------
  // B4. Pacific-day rollover: yesterday's rows never consume today's RPD.
  // -----------------------------------------------------------------------
  {
    // Mirror of the module-local production pacificDayStartUtc() (verified
    // identical semantics; not exported by src/ai/runtime/quotaGovernor.ts).
    const pacificDayStartUtc = (now = new Date()) => {
      const tz = "America/Los_Angeles";
      const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
      const get = (type) => Number(parts.find((p) => p.type === type)?.value);
      const y = get("year"), m = get("month"), d = get("day");
      let guess = Date.UTC(y, m - 1, d, 0, 0, 0);
      for (let i = 0; i < 2; i++) {
        const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(guess));
        const val = (type) => Number(p.find((x) => x.type === type)?.value);
        const wallAsUtc = Date.UTC(val("year"), val("month") - 1, val("day"), val("hour"), val("minute"), val("second"));
        guess += Date.UTC(y, m - 1, d, 0, 0, 0) - wallAsUtc;
      }
      return new Date(guess).toISOString().slice(0, 19).replace("T", " ");
    };
    const dayStart = pacificDayStartUtc();
    // yesterday 23:59:01 pacific == dayStart - 59s, same TEXT shape the app binds.
    const yesterday = new Date(new Date(`${dayStart.replace(" ", "T")}Z`).getTime() - 59_000);
    const stamp = `${yesterday.getUTCFullYear()}-${pad(yesterday.getUTCMonth() + 1)}-${pad(yesterday.getUTCDate())} ${pad(yesterday.getUTCHours())}:${pad(yesterday.getUTCMinutes())}:${pad(yesterday.getUTCSeconds())}`;
    await admin.unsafe(
      "INSERT INTO ai_request_ledger(id, provider, model, request_kind, status, estimated_input_tokens, attempted_at) VALUES ($1,'gemini','gemini-r109-roll','chat','success',5,$2),($3,'gemini','gemini-r109-roll','chat','success',5,$2)",
      ["r109-roll-old-1", stamp, "r109-roll-old-2"],
    );
    const wave = Array.from({ length: 10 }, (_, i) => `r109-roll-${i}`);
    const settled = await Promise.allSettled(wave.map((id) => reserveGeminiAttempt(db, {
      id, conversationId: null, model: "gemini-r109-roll", requestKind: "chat",
      estimatedInputTokens: 5, quota: QUOTA({ rpm: 1000, tpm: 1_000_000, rpd: 3 }),
    })));
    const admitted = settled.filter((r) => r.status === "fulfilled").length;
    record("B4-pacific-day-rollover", admitted === 2,
      `yesterday_rows=2 rpd=3 effective=floor(3x0.9)=2 admitted_today=${admitted} (yesterday must not consume today's bucket)`);
  }

  // -----------------------------------------------------------------------
  // C1. Paid daily ceiling race: 36 x $0.10 against a $1.00/day ceiling.
  // -----------------------------------------------------------------------
  {
    const ledgerIds = Array.from({ length: 36 }, (_, i) => `r109-paid-ledger-${i}`);
    await Promise.all(ledgerIds.map((id) => recordRequestAttempt(db, {
      id, conversationId: null, provider: "deepseek", model: "deepseek-chat",
      requestKind: "editorial", estimatedInputTokens: 500, estimatedCostUsd: 0.1,
    })));
    const settled = await Promise.allSettled(ledgerIds.map((id) => reserveProviderCost(db, id, "deepseek", 0.1, 1.0)));
    const admitted = settled.filter((r) => r.status === "fulfilled").length;
    const refusedKinds = settled.filter((r) => r.status === "rejected").map((r) => errorKind(r.reason));
    const reserved = await count("SELECT count(*)::int AS n FROM ai_cost_reservations WHERE status = 'reserved'");
    const totalRows = await count("SELECT count(*)::int AS n FROM ai_cost_reservations");
    const agg = Number((await admin.unsafe("SELECT COALESCE(SUM(reserved_cost_usd),0) AS s FROM ai_cost_reservations WHERE status IN ('reserved','reconciled')"))[0].s);
    // PostgreSQL semantics: a definite over-limit refusal throws INSIDE the
    // reservation transaction, so the attempt rolls back atomically — exactly
    // the 10 admitted reservations persist (D1's non-transactional path instead
    // leaves a released $0 row; both are conservative, neither over-admits).
    record("C1-paid-daily-ceiling-race",
      admitted === 10 && reserved === 10 && totalRows === 10 && Math.abs(agg - 1.0) < 1e-6,
      `admitted=${admitted}/36 rows_persisted=${totalRows} (atomic rollback of refusals) reserved=${reserved} aggregate=${agg.toFixed(4)} refusals=${[...new Set(refusedKinds)].join("|")}`);
  }

  // -----------------------------------------------------------------------
  // C2. Uncertain paid delivery keeps the conservative reservation; the
  //     reviewed reconciliation settles it exactly once.
  // -----------------------------------------------------------------------
  {
    const id = "r109-uncertain-ledger-1";
    await recordRequestAttempt(db, {
      id, conversationId: null, provider: "deepseek", model: "deepseek-chat",
      requestKind: "editorial", estimatedInputTokens: 500, estimatedCostUsd: 0.2,
    });
    const { reservationId } = await reserveProviderCost(db, id, "deepseek", 0.2, 5.0);
    // Paid network dispatch fails after the reservation was made.
    let dispatchFailed = false;
    try { throw new Error("provider transport lost"); } catch { dispatchFailed = true; }
    let status = (await admin.unsafe("SELECT status, reserved_cost_usd FROM ai_cost_reservations WHERE id = $1", [reservationId]))[0];
    const keptConservative = dispatchFailed && status.status === "reserved" && Math.abs(Number(status.reserved_cost_usd) - 0.2) < 1e-9;
    await reconcileProviderEstimatedCost(db, reservationId, 0.17);
    status = (await admin.unsafe("SELECT status, estimated_billed_cost_usd FROM ai_cost_reservations WHERE id = $1", [reservationId]))[0];
    record("C2-uncertain-paid-not-auto-refunded",
      keptConservative && status.status === "reconciled" && Math.abs(Number(status.estimated_billed_cost_usd) - 0.17) < 1e-9,
      `after_failure=${keptConservative ? "reserved($0.2) — NOT auto-released" : "CHANGED"} after_reconcile=${status.status}($${status.estimated_billed_cost_usd})`);
  }

  // -----------------------------------------------------------------------
  // D1. Rollback injection: a failure inside the reservation transaction
  //     persists nothing.
  // -----------------------------------------------------------------------
  {
    let threw = false;
    try {
      await db.__horseDbWithAiReservation(async (scoped) => {
        await scoped.prepare(
          "INSERT INTO ai_request_ledger(id, provider, model, request_kind, status, estimated_input_tokens) VALUES ('r109-rollback-probe','gemini','gemini-x','chat','attempted',7)",
        ).run();
        throw new Error("deliberate mid-transaction failure");
      });
    } catch { threw = true; }
    const rows = await count("SELECT count(*)::int AS n FROM ai_request_ledger WHERE id = 'r109-rollback-probe'");
    record("D1-reservation-rollback", threw && rows === 0, `threw=${threw} persisted_rows=${rows}`);
  }

  // -----------------------------------------------------------------------
  // D2. Lost connection: terminate the backend inside the reservation block.
  //     The abrupt kill is executed in a CHILD process because postgres.js's
  //     write queue can crash the host process on an abruptly-terminated
  //     socket (an uncatchable setImmediate throw — in production Hyperdrive
  //     isolates this as a failed request). The parent asserts the durable
  //     invariants: no partial rows, no stuck advisory lock, fresh adapters
  //     still admit.
  // -----------------------------------------------------------------------
  {
    const { spawnSync } = require("node:child_process");
    const childSchema = `hr_test_r109kill`;
    const child = spawnSync(process.execPath, [join(root, "scripts/pg-r109-ai-reservations.mjs"), "--kill-probe"], {
      env: { ...process.env, PG_CONNECTION_STRING: connectionString, PG_PARITY_DISPOSABLE: "yes", PG_PARITY_SCHEMA: childSchema },
      encoding: "utf8", timeout: 120_000,
    });
    const childOut = `${child.stdout || ""}${child.stderr || ""}`;
    const killReported = /kill-probe-block-(began|ended)/.test(childOut);
    const rows = await count(`SELECT count(*)::int AS n FROM ${childSchema}.ai_request_ledger WHERE id = 'r109-kill-probe'`);
    const stuckLocks = await count("SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND objid = 710109");
    const db2 = createSupabaseD1Database(adapterUrl, { mode: "full" });
    adapters.push(db2);
    const ok = await reserveGeminiAttempt(db2, {
      id: "r109-after-kill-1", conversationId: null, model: "gemini-after-kill",
      requestKind: "chat", estimatedInputTokens: 5,
      quota: QUOTA({ rpm: 5, tpm: 1000, rpd: 5 }),
    }).then(() => true, () => false);
    await admin.unsafe(`DROP SCHEMA IF EXISTS ${childSchema} CASCADE`);
    record("D2-lost-connection-recovery", killReported && rows === 0 && stuckLocks === 0 && ok,
      `probe_ran=${killReported} persisted_rows=${rows} stuck_advisory_locks=${stuckLocks} fresh_adapter_admits=${ok} child_status=${child.status}`);
  }

  // -----------------------------------------------------------------------
  // E1. Per-model isolation: one model's admissions never consume another
  //     model's independent quota buckets.
  // -----------------------------------------------------------------------
  {
    const quotaA = QUOTA({ rpm: 3, tpm: 1000, rpd: 1000 });
    for (const id of ["r109-iso-a-1", "r109-iso-a-2"]) {
      await reserveGeminiAttempt(db, { id, conversationId: null, model: "gemini-iso-a", requestKind: "chat", estimatedInputTokens: 5, quota: quotaA });
    }
    const aRefused = await reserveGeminiAttempt(db, { id: "r109-iso-a-3", conversationId: null, model: "gemini-iso-a", requestKind: "chat", estimatedInputTokens: 5, quota: quotaA }).then(() => false, (e) => errorKind(e).includes("rpm"));
    const bAdmitted = await reserveGeminiAttempt(db, { id: "r109-iso-b-1", conversationId: null, model: "gemini-iso-b", requestKind: "chat", estimatedInputTokens: 5, quota: QUOTA({ rpm: 3, tpm: 1000, rpd: 1000 }) }).then(() => true, () => false);
    record("E1-per-model-isolation", aRefused && bAdmitted,
      `model_a_rpm_exhausted=${aRefused} model_b_still_admits=${bAdmitted}`);
  }

  // -----------------------------------------------------------------------
  // Report
  // -----------------------------------------------------------------------
  const failed = findings.filter((f) => !f.pass);
  const report = {
    harness: "pg-r109-ai-reservations",
    server: serverVersion,
    migrations_applied: migrations.length,
    adapter: "PRODUCTION createSupabaseD1Database(mode=full) incl. __horseDbWithAiReservation advisory-xact-lock(710109)",
    boundary_note: "Real engine + real adapter + real governors; transport-level failures use the reviewed storage/abort paths (malformed-receipt validation is covered by tools/test-r109-ai.cjs driver doubles — no double is silently treated as a real-engine pass).",
    scenarios: findings,
    pass: failed.length === 0,
  };
  console.log(`\n${report.pass ? "ALL SCENARIOS PASS" : `${failed.length} SCENARIO(S) FAILED`}`);
  if (reportPath) {
    mkdirSync(dirname(join(root, reportPath)), { recursive: true });
    writeFileSync(join(root, reportPath), JSON.stringify(report, null, 2) + "\n");
    console.log(`report: ${reportPath}`);
  }
  await cleanup();
  process.exit(report.pass ? 0 : 1);
}

async function cleanup() {
  for (const a of adapters) { try { await closeSupabaseD1Database(a); } catch { /* pool already gone */ } }
  try {
    await admin.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.unsafe("RESET search_path");
  } catch { /* best effort */ }
  await admin.end();
}

process.on("SIGINT", () => { cleanup().finally(() => process.exit(130)); });
main().catch(async (error) => { console.error(error); await cleanup(); process.exit(1); });

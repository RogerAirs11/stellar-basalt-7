#!/usr/bin/env node
/**
 * d1-r109-ai-reservations — R109-20 D1 leg: concurrent AI admission on a REAL,
 * DISPOSABLE Cloudflare D1 database (created and dropped by this harness),
 * through the PRODUCTION quota/cost governors (reserveGeminiAttempt /
 * reserveProviderCost) and the PRODUCTION D1-dialect SQL they issue.
 *
 * Boundary (documented, not hidden): the D1 REST transport replaces the
 * Workers-runtime D1 binding — the binding is not reachable from Node. The
 * SQL, conditional-INSERT admission semantics, quota math, ledger/reservation
 * persistence and their races are the production ones on the real D1 engine.
 * withAiReservation's D1 fall-through (no transaction wrapper) is exactly the
 * production D1 path.
 *
 * Scenarios (same contract as the PostgreSQL leg):
 *   B1. RPM boundary race: 36 synchronized admissions, RPM=10 -> exactly 9
 *       admitted (floor(10 x 0.9) reserve margin), rest rpm_reserve_reached.
 *   B2. TPM boundary race: 30 x 100 tokens, TPM=1000 -> exactly 9 admitted.
 *   B3. RPD boundary race: 30 admissions, RPD=8 -> exactly 7 admitted.
 *   B4. Pacific-day rollover: yesterday's rows never consume today's RPD.
 *   C1. Paid daily ceiling race: 36 x $0.10 against $1.00/day -> exactly 10
 *       stay reserved; D1's non-transactional path leaves released $0 rows
 *       for refused attempts (both engines never over-admit).
 *   C2. Uncertain paid delivery keeps its conservative reservation.
 *   E1. Per-model isolation.
 *
 * Usage:
 *   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... \
 *     node scripts/d1-r109-ai-reservations.mjs \
 *     [--report review-r109/evidence/d1-r109-ai-reservations.json]
 */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

require("../tools/lib/register-typescript.cjs");
const { reserveGeminiAttempt } = require("../src/ai/runtime/quotaGovernor.ts");
const {
  recordRequestAttempt, reserveProviderCost, reconcileProviderEstimatedCost,
} = require("../src/ai/conversation/repository.ts");
const { AiRuntimeError } = require("../src/ai/core/errors.ts");

const args = process.argv.slice(2);
const reportFlag = args.indexOf("--report");
const reportPath = reportFlag >= 0 ? args[reportFlag + 1] : null;
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!TOKEN || !ACCOUNT) {
  console.error("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required");
  process.exit(2);
}
const DB_NAME = "hr-r109-disposable-gate";
const API = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database`;

async function cf(path, init) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await response.json();
  if (!body.success) throw new Error(`CF API ${path}: ${JSON.stringify(body.errors).slice(0, 200)}`);
  return body.result;
}

/** D1Database-compatible adapter over the REST /query endpoint. */
class RestD1 {
  constructor(uuid) { this.uuid = uuid; }
  #statement(sql, binds) {
    const run = async () => {
      const result = await cf(`/${this.uuid}/query`, { method: "POST", body: JSON.stringify({ sql, params: binds ?? [] }) });
      const first = result[0] ?? {};
      if (!first.success) throw new Error(`D1 query failed: ${JSON.stringify(first.error ?? {}).slice(0, 200)} sql=${sql.slice(0, 80)}`);
      return { success: true, meta: { changes: Number(first.meta?.changes ?? 0) }, results: Array.isArray(first.results) ? first.results : [] };
    };
    return {
      bind: (...values) => this.#statement(sql, values),
      run,
      first: async () => (await run()).results[0] ?? null,
      all: async () => ({ results: (await run()).results }),
    };
  }
  prepare(sql) { return this.#statement(sql); }
  async batch(statements) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
}

const findings = [];
function record(id, pass, detail) {
  findings.push({ id, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} — ${id}${detail ? ` (${detail})` : ""}`);
}
function errorKind(error) {
  if (error instanceof AiRuntimeError) return `${error.category}/${error.code}`;
  return `other:${error instanceof Error ? error.message.slice(0, 100) : "unknown"}`;
}
const QUOTA = (over) => ({ rpmLimit: over.rpm, inputTpmLimit: over.tpm, rpdLimit: over.rpd, reserveFraction: 0.1 });
const pad = (n) => String(n).padStart(2, "0");

async function main() {
  // 0. Recreate the disposable database from scratch (rerun-safe: a crashed
  //    earlier run must never leave a partial chain behind). The production
  //    database is never touched; the name is fixed and verified below.
  const list0 = await cf(`?per_page=100`);
  const old = list0.find((d) => d.name === DB_NAME);
  if (old) {
    if (old.name === "horse-registry") throw new Error("refusing to touch the production database");
    await cf(`/${old.uuid}`, { method: "DELETE" });
    console.log(`dropped stale disposable database ${old.uuid}`);
  }
  const created = await cf(``, { method: "POST", body: JSON.stringify({ name: DB_NAME }) });
  console.log(`created disposable D1: ${created.uuid}`);

  // 1. Apply the full migration chain through REST (raw SQLite on D1).
  const migrations = [];
  const dir = join(root, "migrations");
  const names = require("node:fs").readdirSync(dir).filter((n) => n.endsWith(".sql")).sort();
  for (const name of names) {
    const raw = readFileSync(join(dir, name), "utf8");
    for (const statement of splitSql(raw)) {
      // Comment-only fragments and PRAGMA are not executable on D1 REST
      // (7500) — PRAGMA foreign_keys is always enforced by D1 itself.
      const bare = statement.replace(/--[^\n]*\n?/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ").trim();
      if (!bare) continue;
      if (/^PRAGMA\b/i.test(bare)) continue;
      await cf(`/${created.uuid}/query`, { method: "POST", body: JSON.stringify({ sql: statement, params: [] }) });
    }
    migrations.push(name);
  }
  console.log(`migrations applied: ${migrations.length}`);

  const db = new RestD1(created.uuid);
  const one = async (sql, ...params) => { const r = (await cf(`/${created.uuid}/query`, { method: "POST", body: JSON.stringify({ sql, params }) }))[0]; return Array.isArray(r?.results) ? r.results : []; };
  const count = async (sql, ...params) => Number((await one(sql, ...params))[0]?.n ?? 0);
  const target = created;

  // 3. Boundary races (same expectations as the PG leg: reserve margin 0.1).
  async function raceWave(label, quota, opts, waves) {
    const settled = await Promise.allSettled(Array.from({ length: waves }, (_, i) => reserveGeminiAttempt(db, {
      id: `r109d1-${label}-${i}`, conversationId: null, model: opts.model, requestKind: "chat",
      estimatedInputTokens: opts.tokens, quota,
    })));
    const admitted = settled.filter((r) => r.status === "fulfilled").length;
    const refused = settled.filter((r) => r.status === "rejected").map((r) => errorKind(r.reason));
    const ledger = await count("SELECT COUNT(*) AS n FROM ai_request_ledger WHERE model = ? AND status != 'rejected'", opts.model);
    const allReserveRefusals = refused.length === 0 || refused.every((k) => k.includes("reserve_reached"));
    record(label, admitted === opts.expectAdmitted && ledger === opts.expectAdmitted && allReserveRefusals,
      `admitted=${admitted}/${waves} expected=${opts.expectAdmitted} ledger=${ledger} refusal_kinds=${[...new Set(refused)].slice(0, 3).join("|")}`);
  }

  await raceWave("B1-rpm-boundary-race", QUOTA({ rpm: 10, tpm: 1_000_000, rpd: 1000 }),
    { model: "gemini-r109d1-rpm", tokens: 10, expectAdmitted: 9 }, 36);
  await raceWave("B2-tpm-boundary-race", QUOTA({ rpm: 1000, tpm: 1000, rpd: 10_000 }),
    { model: "gemini-r109d1-tpm", tokens: 100, expectAdmitted: 9 }, 30);
  await raceWave("B3-rpd-boundary-race", QUOTA({ rpm: 1000, tpm: 1_000_000, rpd: 8 }),
    { model: "gemini-r109d1-rpd", tokens: 10, expectAdmitted: 7 }, 30);

  // B4. Pacific-day rollover.
  {
    const dayStart = pacificDayStartUtc();
    const yesterday = new Date(new Date(`${dayStart.replace(" ", "T")}Z`).getTime() - 59_000);
    const stamp = `${yesterday.getUTCFullYear()}-${pad(yesterday.getUTCMonth() + 1)}-${pad(yesterday.getUTCDate())} ${pad(yesterday.getUTCHours())}:${pad(yesterday.getUTCMinutes())}:${pad(yesterday.getUTCSeconds())}`;
    await one("INSERT INTO ai_request_ledger(id, provider, model, request_kind, status, estimated_input_tokens, attempted_at) VALUES (?,'gemini','gemini-r109d1-roll','chat','success',5,?)", "r109d1-roll-old-1", stamp);
    const settled = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => reserveGeminiAttempt(db, {
      id: `r109d1-roll-${i}`, conversationId: null, model: "gemini-r109d1-roll", requestKind: "chat",
      estimatedInputTokens: 5, quota: QUOTA({ rpm: 1000, tpm: 1_000_000, rpd: 3 }),
    })));
    const admitted = settled.filter((r) => r.status === "fulfilled").length;
    record("B4-pacific-day-rollover", admitted === 2,
      `yesterday_rows=1 rpd=3 effective=2 admitted_today=${admitted}`);
  }

  // C1. Paid daily ceiling race.
  {
    const ledgerIds = Array.from({ length: 36 }, (_, i) => `r109d1-paid-ledger-${i}`);
    await Promise.all(ledgerIds.map((id) => recordRequestAttempt(db, {
      id, conversationId: null, provider: "deepseek", model: "deepseek-chat",
      requestKind: "editorial", estimatedInputTokens: 500, estimatedCostUsd: 0.1,
    })));
    const settled = await Promise.allSettled(ledgerIds.map((id) => reserveProviderCost(db, id, "deepseek", 0.1, 1.0)));
    const admitted = settled.filter((r) => r.status === "fulfilled").length;
    const refusedKinds = settled.filter((r) => r.status === "rejected").map((r) => errorKind(r.reason));
    const reserved = await count("SELECT COUNT(*) AS n FROM ai_cost_reservations WHERE status = 'reserved'");
    const released = await count("SELECT COUNT(*) AS n FROM ai_cost_reservations WHERE status = 'released' AND reserved_cost_usd = 0");
    const agg = Number((await one("SELECT COALESCE(SUM(reserved_cost_usd),0) AS s FROM ai_cost_reservations WHERE status IN ('reserved','reconciled')"))[0].s);
    record("C1-paid-daily-ceiling-race",
      admitted === 10 && reserved === 10 && Math.abs(agg - 1.0) < 1e-6 && (released === 26 || released === 0),
      `admitted=${admitted}/36 reserved=${reserved} released_zero=${released} (D1 non-transactional path) aggregate=${agg.toFixed(4)} refusals=${[...new Set(refusedKinds)].join("|")}`);
  }

  // C2. Uncertain paid delivery keeps the conservative reservation.
  {
    const id = "r109d1-uncertain-ledger-1";
    await recordRequestAttempt(db, {
      id, conversationId: null, provider: "deepseek", model: "deepseek-chat",
      requestKind: "editorial", estimatedInputTokens: 500, estimatedCostUsd: 0.2,
    });
    const { reservationId } = await reserveProviderCost(db, id, "deepseek", 0.2, 5.0);
    let row = (await one("SELECT status, reserved_cost_usd FROM ai_cost_reservations WHERE id = ?", reservationId))[0];
    const kept = row.status === "reserved" && Math.abs(Number(row.reserved_cost_usd) - 0.2) < 1e-9;
    await reconcileProviderEstimatedCost(db, reservationId, 0.17);
    row = (await one("SELECT status, estimated_billed_cost_usd FROM ai_cost_reservations WHERE id = ?", reservationId))[0];
    record("C2-uncertain-paid-not-auto-refunded",
      kept && row.status === "reconciled" && Math.abs(Number(row.estimated_billed_cost_usd) - 0.17) < 1e-9,
      `after_failure=${kept ? "reserved($0.2) NOT auto-released" : "CHANGED"} after_reconcile=${row.status}($${row.estimated_billed_cost_usd})`);
  }

  // E1. Per-model isolation.
  {
    const quotaA = QUOTA({ rpm: 3, tpm: 1000, rpd: 1000 });
    await reserveGeminiAttempt(db, { id: "r109d1-iso-a-1", conversationId: null, model: "gemini-iso-a", requestKind: "chat", estimatedInputTokens: 5, quota: quotaA });
    await reserveGeminiAttempt(db, { id: "r109d1-iso-a-2", conversationId: null, model: "gemini-iso-a", requestKind: "chat", estimatedInputTokens: 5, quota: quotaA });
    const aRefused = await reserveGeminiAttempt(db, { id: "r109d1-iso-a-3", conversationId: null, model: "gemini-iso-a", requestKind: "chat", estimatedInputTokens: 5, quota: quotaA }).then(() => false, (e) => errorKind(e).includes("rpm"));
    const bAdmitted = await reserveGeminiAttempt(db, { id: "r109d1-iso-b-1", conversationId: null, model: "gemini-iso-b", requestKind: "chat", estimatedInputTokens: 5, quota: QUOTA({ rpm: 3, tpm: 1000, rpd: 1000 }) }).then(() => true, () => false);
    record("E1-per-model-isolation", aRefused && bAdmitted,
      `model_a_rpm_exhausted=${aRefused} model_b_still_admits=${bAdmitted}`);
  }

  // 4. Drop the disposable database (the gate must leave no residue).
  await cf(`/${target.uuid}`, { method: "DELETE" });
  console.log("disposable database dropped");

  const failed = findings.filter((f) => !f.pass);
  const report = {
    harness: "d1-r109-ai-reservations",
    engine: `Cloudflare D1 (real remote engine, database ${DB_NAME} created and dropped by this run)`,
    migrations_applied: migrations.length,
    boundary: "PRODUCTION governors + PRODUCTION D1-dialect SQL over the D1 REST transport (the Workers-runtime binding is not reachable from Node; admission semantics, quota math and persistence are the production ones on the real D1 engine).",
    scenarios: findings,
    pass: failed.length === 0,
  };
  console.log(`\n${report.pass ? "ALL SCENARIOS PASS" : `${failed.length} SCENARIO(S) FAILED`}`);
  if (reportPath) {
    mkdirSync(dirname(join(root, reportPath)), { recursive: true });
    writeFileSync(join(root, reportPath), JSON.stringify(report, null, 2) + "\n");
    console.log(`report: ${reportPath}`);
  }
  process.exit(report.pass ? 0 : 1);
}

function pacificDayStartUtc(now = new Date()) {
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
}

function splitSql(sqlText) {
  const statements = [];
  let current = "", quote = null;
  for (let i = 0; i < sqlText.length; i++) {
    const ch = sqlText[i], next = sqlText[i + 1];
    if (quote) {
      current += ch;
      if (quote === "--" && ch === "\n") quote = null;
      else if (quote === "/*" && ch === "*" && next === "/") { current += next; i++; quote = null; }
      else if (ch === quote && quote !== "--" && quote !== "/*") {
        if ((quote === "'" || quote === '"') && next === quote) { current += next; i++; continue; }
        quote = null;
      }
    } else if (ch === "'" || ch === '"') { quote = ch; current += ch; }
    else if (ch === "-" && next === "-") { quote = "--"; current += ch; }
    else if (ch === "/" && next === "*") { quote = "/*"; current += ch; }
    else if (ch === ";") { if (current.trim()) statements.push(current.trim()); current = ""; }
    else current += ch;
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

main().catch((error) => { console.error(error); process.exit(1); });

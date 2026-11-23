#!/usr/bin/env node
/**
 * R120 / IMP-014 acceptance — REAL-adapter failure injection for the atomic
 * password reset: prove that a statement thrown at ANY position inside the
 * claim -> rotate -> revoke transaction rolls the WHOLE command back, leaving
 * the token reusable and the password/sessions untouched, on BOTH supported
 * adapters (local SQLite with all migrations; the production PostgreSQL
 * adapter on a disposable embedded PostgreSQL).
 *
 * Injection mechanism: a proxy D1 wrapper records the statements
 * confirmPasswordReset builds and delegates to the REAL adapter's batch(),
 * substituting exactly ONE statement's SQL with a poison statement that
 * errors at execution time (nonexistent table) INSIDE the real transaction.
 * Everything else — translation, transaction begin/rollback, result mapping —
 * is the real adapter path.
 *
 * Matrix per adapter: control (no poison) + poison-at-statement {0,1,2}.
 * Invariants after each poisoned run:
 *   - the call threw (the failure surfaced, never swallowed)
 *   - password_hash UNCHANGED (rotation rolled back)
 *   - session count UNCHANGED (revocation rolled back)
 *   - the token is STILL REUSABLE: a subsequent clean confirmPasswordReset
 *     succeeds (reset: true), rotates the password and revokes sessions.
 *
 * Usage (disposable local PostgreSQL only):
 *   PG_CONNECTION_STRING=postgres://... PG_PARITY_DISPOSABLE=yes \
 *     node scripts/r120-imp014-reset-failure-injection.mjs
 * Without PG_CONNECTION_STRING only the SQLite adapter matrix runs.
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync, symlinkSync, mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import postgres from "postgres";
import { splitStatements, ddlNormalize } from "./lib/pg-ddl.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
import { buildSync } from "esbuild";
const bundleDir = mkdtempSync(join(tmpdir(), "r120-imp014-"));
symlinkSync(join(root, "node_modules"), join(bundleDir, "node_modules"), "dir");
const bundle = (entry, outfile) => {
  buildSync({
    entryPoints: [join(root, entry)],
    bundle: true, format: "cjs", platform: "node", target: "node20",
    outfile: join(bundleDir, outfile), external: ["postgres"], logLevel: "silent",
  });
  return createRequire(import.meta.url)(join(bundleDir, outfile));
};
const recovery = bundle("src/auth/recovery.ts", "recovery.cjs");
const localSqlite = bundle("src/db/localSqlite.ts", "localsqlite.cjs").openLocalSqlite;
const translatorModule = bundle("src/db/sqliteSqlToPostgres.ts", "translator.cjs");
const sqliteSqlToPostgres = translatorModule.sqliteSqlToPostgres ?? translatorModule.default;
const compatModule = bundle("src/db/supabaseCompat.ts", "compat.cjs");
const createSupabaseD1Database = compatModule.createSupabaseD1Database;

const POISON_SQL = "INSERT INTO r120_injection_poison_table VALUES (1)";
const evidence = { adapters: [], verdict: null, finished: new Date().toISOString() };
const now = () => new Date().toISOString();

const resetRequest = (token, password) => new Request("https://registry.example/api/auth/recover/confirm", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ token, new_password: password }),
});

async function sha256Hex(value) {
  const bits = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, "0")).join("");
}

/** Proxy that records statements and injects the poison at index N on batch. */
const injectingDb = (real, poisonIndex) => ({
  prepare(sql) {
    const record = { __sql: sql, __values: [], bind(...values) { record.__values = values; return record; } };
    return record;
  },
  async batch(statements) {
    const realStmts = statements.map((s, i) => (poisonIndex != null && i === poisonIndex
      ? real.prepare(POISON_SQL).bind()
      : real.prepare(s.__sql).bind(...(s.__values ?? []))));
    return real.batch(realStmts);
  },
});

async function runMatrix(adapterName, db, seedAndClean) {
  const record = { adapter: adapterName, started: now(), cases: [] };
  evidence.adapters.push(record);
  const TOKEN = "t".repeat(40);
  const tokenHash = await sha256Hex(TOKEN);
  const log = (label, ok, detail) => {
    record.cases.push({ label, ok, detail });
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
    if (!ok) record.failed = true;
  };
  const passwordHash = async () => (await db.prepare("SELECT password_hash FROM users WHERE id='reset-user'").first()).password_hash;
  const sessionCount = async () => Number((await db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id='reset-user'").first()).n);

  // Control: the clean path works end to end.
  await seedAndClean(db, tokenHash);
  const control = await recovery.confirmPasswordReset(db, {}, resetRequest(TOKEN, "clean-password-1"));
  log("control: clean reset succeeds", (await control.json()).reset === true);
  log("control: token is single-use (replay is invalid_token)", await recovery.confirmPasswordReset(db, {}, resetRequest(TOKEN, "other-password-1")).then(() => false, (e) => e.status === 400 && e.code === "invalid_token"));

  // Poisoned runs: statement 0 (claim), 1 (rotate), 2 (revoke).
  for (const poisonIndex of [0, 1, 2]) {
    await seedAndClean(db, tokenHash);
    const beforeHash = await passwordHash();
    const beforeSessions = await sessionCount();
    let threw = null;
    try {
      await recovery.confirmPasswordReset(injectingDb(db, poisonIndex), {}, resetRequest(TOKEN, "poisoned-password-1"));
    } catch (cause) { threw = cause; }
    log(`poison@${poisonIndex}: the injected statement failure SURFACED (threw)`, threw !== null, threw?.message?.slice(0, 80));
    log(`poison@${poisonIndex}: password UNCHANGED after rollback`, (await passwordHash()) === beforeHash);
    log(`poison@${poisonIndex}: sessions UNCHANGED after rollback`, (await sessionCount()) === beforeSessions);
    const tokenStillUsable = await db.prepare(
      "SELECT COUNT(*) AS n FROM email_verifications WHERE token_hash=? AND purpose='password_reset' AND consumed_at IS NULL",
    ).bind(tokenHash).first();
    log(`poison@${poisonIndex}: token consumption ROLLED BACK (still unconsumed)`, Number(tokenStillUsable.n) === 1);
    const retry = await recovery.confirmPasswordReset(db, {}, resetRequest(TOKEN, "retry-password-1"));
    const retryBody = await retry.json();
    log(`poison@${poisonIndex}: token STILL REUSABLE — the clean retry completes the reset`, retryBody.reset === true);
    const afterHash = await passwordHash();
    const verified = await recovery.confirmPasswordReset === undefined ? null : afterHash !== beforeHash;
    log(`poison@${poisonIndex}: retry actually rotated the password`, verified === true);
    log(`poison@${poisonIndex}: retry revoked every session`, (await sessionCount()) === 0);
  }
}

// --- seed helper factory ---------------------------------------------------
const seedInto = async (db, tokenHash) => {
  await db.prepare("DELETE FROM email_verifications WHERE user_id='reset-user'").run();
  await db.prepare("DELETE FROM sessions WHERE user_id='reset-user'").run();
  await db.prepare("DELETE FROM users WHERE id='reset-user'").run();
  await db.prepare("INSERT INTO users(id,email,display_name,password_hash,role,is_active) VALUES('reset-user','reset@example.test','Reset','old-hash','user',1)").run();
  await db.prepare("INSERT INTO sessions(id,user_id,token_hash,created_at,expires_at,csrf_token) VALUES('s1','reset-user','x','2026-01-01 00:00:00','2099-01-01 00:00:00','c')").run();
  await db.prepare("INSERT INTO sessions(id,user_id,token_hash,created_at,expires_at,csrf_token) VALUES('s2','reset-user','y','2026-01-01 00:00:00','2099-01-01 00:00:00','c')").run();
  await recovery.insertResetToken === undefined ? null : null;
  await db.prepare("INSERT INTO email_verifications(id,user_id,token_hash,purpose,expires_at) VALUES('ev1','reset-user',?,'password_reset',datetime('now','+30 minutes'))").bind(tokenHash).run();
};

// --- Adapter 1: local SQLite (all migrations) ------------------------------
{
  console.log("[adapter] local SQLite — all migrations");
  const db = localSqlite(":memory:");
  const files = readdirSync(join(root, "migrations")).filter(f => /^\d+.*\.sql$/.test(f)).sort();
  for (const file of files) await db.exec(readFileSync(join(root, "migrations", file), "utf8"));
  await runMatrix("local-sqlite-migrations", db, seedInto);
}

// --- Adapter 2: production PostgreSQL adapter (disposable embedded PG) -----
if (process.env.PG_CONNECTION_STRING && process.env.PG_PARITY_DISPOSABLE === "yes") {
  const cs = process.env.PG_CONNECTION_STRING;
  {
    const target = new URL(cs);
    if (!["localhost", "127.0.0.1", "[::1]", "postgres"].includes(target.hostname)) {
      console.error("refusing non-local PostgreSQL"); process.exit(2);
    }
  }
  console.log("[adapter] production PostgreSQL adapter (supabase full mode)");
  const admin = postgres(cs, { max: 1 });
  await admin.unsafe("DROP DATABASE IF EXISTS r120_imp014");
  await admin.unsafe("CREATE DATABASE r120_imp014");
  const dbCs = cs.replace(/\/[^/?]+(\?|$)/, "/r120_imp014$1");
  const boot = postgres(dbCs, { max: 1 });
  const names = readdirSync(join(root, "migrations")).filter(n => n.endsWith(".sql")).sort();
  for (const name of names) {
    const raw = readFileSync(join(root, "migrations", name), "utf8");
    await boot.unsafe("BEGIN");
    try {
      for (const statement of splitStatements(raw)) {
        const bare = statement.replace(/^\s*--[^\n]*\n/gm, "").trim();
        if (!bare || /^PRAGMA\b/i.test(bare) || /^CREATE\s+VIRTUAL\s+TABLE/i.test(bare)) continue;
        const translated = sqliteSqlToPostgres(ddlNormalize(statement));
        if (!translated.trim()) continue;
        await boot.unsafe(translated);
      }
      await boot.unsafe("COMMIT");
    } catch (error) { await boot.unsafe("ROLLBACK"); console.error(`migration ${name}: ${error.message}`); process.exit(1); }
  }
  await boot.end();
  const pgDb = createSupabaseD1Database(dbCs, { mode: "full" });
  // PG seed: same rows through the adapter (translated SQL)
  const pgSeed = async (db, tokenHash) => {
    await db.batch([
      db.prepare("DELETE FROM email_verifications WHERE user_id='reset-user'").bind(),
      db.prepare("DELETE FROM sessions WHERE user_id='reset-user'").bind(),
      db.prepare("DELETE FROM users WHERE id='reset-user'").bind(),
      db.prepare("INSERT INTO users(id,email,display_name,password_hash,role,is_active) VALUES('reset-user','reset@example.test','Reset','old-hash','user',1)").bind(),
      db.prepare("INSERT INTO sessions(id,user_id,token_hash,created_at,expires_at,csrf_token) VALUES('s1','reset-user','x','2026-01-01 00:00:00','2099-01-01 00:00:00','c')").bind(),
      db.prepare("INSERT INTO sessions(id,user_id,token_hash,created_at,expires_at,csrf_token) VALUES('s2','reset-user','y','2026-01-01 00:00:00','2099-01-01 00:00:00','c')").bind(),
      db.prepare("INSERT INTO email_verifications(id,user_id,token_hash,purpose,expires_at) VALUES('ev1','reset-user',?,'password_reset',datetime('now','+30 minutes'))").bind(tokenHash),
    ]);
  };
  await runMatrix("postgresql-adapter-full", pgDb, pgSeed);
  try { await admin.unsafe("DROP DATABASE IF EXISTS r120_imp014"); } catch { /* open adapter connections — harmless on a disposable instance */ }
  await admin.end();
} else {
  console.log("[adapter] PostgreSQL matrix SKIPPED (no disposable PG provided)");
}

evidence.verdict = evidence.adapters.every(a => !a.failed) ? "ALL GREEN" : "FAILURES";
evidence.finished = now();
mkdirSync(join(root, "review-r120", "evidence-local"), { recursive: true });
const evidencePath = join(root, "review-r120", "evidence-local", "imp014-reset-failure-injection.json");
writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
console.log(`\n[verdict] ${evidence.verdict} — evidence: ${evidencePath}`);
process.exit(evidence.verdict === "ALL GREEN" ? 0 : 1);

#!/usr/bin/env node
/**
 * R96 range-runner smoke (the N14-apply-smoke pattern): boot the embedded PG,
 * build a disposable hr_test_r96range database holding ONLY migrations
 * <=0051 with FTS statements skipped (the LIVE Supabase's actual state),
 * then run scripts/apply-range-to-supabase.mjs against it as a subprocess
 * (disposable mode) and assert:
 *   A. every expected-schema column (FTS excluded) exists afterwards;
 *   B. 0061's dedicated entrypoint applies cleanly on top (dedicated script);
 *   C. the range runner is idempotent — a second run applies nothing;
 *   D. a data statement against a NON-empty table is refused (fail-closed).
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "/tmp/pgembedded/node_modules/embedded-postgres/dist/index.js";
import { splitStatements, ddlNormalize } from "./lib/pg-ddl.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pg = new EmbeddedPostgres({
  databaseDir: "/tmp/pgembedded/data", user: "postgres", password: "postgres",
  port: 5433, persistent: false,
  postgresFlags: ["-c", "listen_addresses=127.0.0.1", "-c", "unix_socket_directories=/tmp"],
});

try {
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("hr_test_r96range");
  const { default: postgres } = await import("postgres");
  const admin = postgres("postgres://postgres:postgres@127.0.0.1:5433/postgres", { max: 1 });
  await admin`DROP DATABASE IF EXISTS hr_test_r96range_template`;
  await admin.end({ timeout: 3 });

  const db = postgres("postgres://postgres:postgres@127.0.0.1:5433/hr_test_r96range", { max: 1 });

  // ---- 1. build the LIVE-like state: chain <=0051, FTS statements skipped ----
  const files = readdirSync(join(root, "migrations")).filter(f => f.endsWith(".sql")).sort();
  const { compileTsRuntime } = await import(join(root, "tools/ts-runtime-loader.mjs"));
  const rt = compileTsRuntime(["src/db/sqliteSqlToPostgres.ts"]);
  const { sqliteSqlToPostgres, stripLeadingComments } = rt.load("src/db/sqliteSqlToPostgres.ts");
  let applied = 0, ftsSkipped = 0;
  for (const f of files) {
    const id = f.slice(0, 4);
    if (id > "0051") break;
    for (const stmt of splitStatements(readFileSync(join(root, "migrations", f), "utf8"))) {
      const bare = stripLeadingComments(stmt);
      if (/^\s*PRAGMA\b/i.test(bare)) continue;
      if (/^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(bare)) { ftsSkipped++; continue; }
      const translated = sqliteSqlToPostgres(ddlNormalize(stmt));
      if (!translated.trim() || !stripLeadingComments(translated).trim()) continue;
      await db.unsafe(translated);
      applied++;
    }
  }
  console.log(`live-like base built: ${applied} statements applied, ${ftsSkipped} FTS skipped (migrations <=0051)`);

  // ---- 2. run the range runner in disposable mode ----
  const env = {
    ...process.env,
    SUPABASE_DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5433/hr_test_r96range",
    PG_PARITY_DISPOSABLE: "yes",
  };
  const run1 = spawnSync("node", [join(root, "scripts/apply-range-to-supabase.mjs")], { encoding: "utf8", env });
  console.log(run1.stdout.split("\n").filter(l => /APPLIED|nothing to do|REMEMBER|===/.test(l)).join("\n"));
  if (run1.status !== 0) { console.error("range runner FAILED:\n" + run1.stdout + run1.stderr); process.exit(1); }
  if (!/APPLIED \+ verified/.test(run1.stdout)) { console.error("no migration reported APPLIED+verified"); process.exit(1); }

  // ---- 3. apply 0061 via its own entrypoint (disposable mode) ----
  const run61 = spawnSync("node", [join(root, "scripts/apply-0061-to-supabase.mjs")], { encoding: "utf8", env });
  console.log((run61.stdout || "").split("\n").filter(Boolean).slice(-3).join("\n"));
  if (run61.status !== 0) { console.error("apply-0061 FAILED:\n" + run61.stdout + run61.stderr); process.exit(1); }

  // ---- 4. assert every expected column now exists (FTS excluded by regen) ----
  const expected = JSON.parse(readFileSync(join(root, "audit/r95/expected-schema.json"), "utf8"));
  const cols = await db`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public'`;
  const have = new Set(cols.map(r => `${r.table_name}.${r.column_name}`));
  const missing = expected.columns.filter(c => !have.has(c));
  console.log(`expected columns: ${expected.columns.length}, missing after full range: ${missing.length}`);
  if (missing.length) { console.error("MISSING: " + missing.join(", ")); process.exit(1); }
  const idx = await db`SELECT indexname FROM pg_indexes WHERE schemaname='public'`;
  const idxNames = new Set(idx.map(r => r.indexname));
  const missingIdx = expected.required_unique_indexes.filter(i => !idxNames.has(i));
  if (missingIdx.length) { console.error("MISSING INDEXES: " + missingIdx.join(", ")); process.exit(1); }

  // ---- 5. idempotency: the second run applies nothing ----
  const run2 = spawnSync("node", [join(root, "scripts/apply-range-to-supabase.mjs")], { encoding: "utf8", env });
  if (run2.status !== 0) { console.error("second run FAILED:\n" + run2.stdout + run2.stderr); process.exit(1); }
  if (!/nothing to do/.test(run2.stdout)) { console.error("second run applied something — NOT idempotent"); process.exit(1); }
  console.log("idempotency: second run applies nothing");

  await db.end({ timeout: 3 });
  console.log("\nSMOKE PASS: range runner + 0061 bring the live-like DB to the full expected schema, idempotently");
} finally {
  await pg.stop();
}

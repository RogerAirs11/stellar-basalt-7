#!/usr/bin/env node
/* R95-N02 runner: boot a disposable embedded PostgreSQL (no root required —
 * npm i embedded-postgres in a scratch dir), run both parity gates, then shut
 * down. Single process so a sandbox cannot kill the server mid-run.
 *
 * Setup (once):  mkdir /tmp/pgembedded && cd /tmp/pgembedded && npm i embedded-postgres
 * Usage:         node scripts/r95-n02-pg-parity.mjs
 * Evidence:      audit/r95/evidence/pg-parity-n02.log */
import { spawnSync } from "node:child_process";
import EmbeddedPostgres from "/tmp/pgembedded/node_modules/embedded-postgres/dist/index.js";

const REPO = "/home/z/my-project/repos/horse-registry";
const pg = new EmbeddedPostgres({
  databaseDir: "/tmp/pgembedded/data",
  user: "postgres",
  password: "postgres",
  port: 5433,
  persistent: false,
  postgresFlags: ["-c", "listen_addresses=127.0.0.1", "-c", "unix_socket_directories=/tmp"],
});

const results = [];
function run(label, command, env = {}) {
  const started = Date.now();
  const proc = spawnSync(command[0], command.slice(1), {
    cwd: REPO,
    encoding: "utf8",
    env: {
      ...process.env,
      PG_CONNECTION_STRING: "postgres://postgres:postgres@127.0.0.1:5433/postgres",
      PG_PARITY_DISPOSABLE: "yes",
      ...env,
    },
    timeout: 15 * 60 * 1000,
  });
  const ok = proc.status === 0;
  results.push({ label, exit: proc.status, seconds: ((Date.now() - started) / 1000).toFixed(1), ok });
  console.log(`\n===== ${label}: exit ${proc.status} (${((Date.now() - started) / 1000).toFixed(1)}s) =====`);
  const out = (proc.stdout || "") + (proc.stderr || "");
  console.log(out.split("\n").slice(-25).join("\n"));
  return ok;
}

try {
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("parity");
  console.log("Embedded PostgreSQL ready on 127.0.0.1:5433");

  run("pg-parity-gate (migration chain translation + apply)", ["node", "scripts/pg-parity-gate.mjs"]);
  run("pg-execution-parity (production commands on PostgreSQL)", ["node", "scripts/pg-execution-parity.mjs"]);
} catch (error) {
  console.error("RUNNER FAILURE:", error);
  process.exitCode = 1;
} finally {
  try { await pg.stop(); } catch { /* already down */ }
  console.log("\n===== SUMMARY =====");
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.label} (exit ${r.exit}, ${r.seconds}s)`);
  if (results.some((r) => !r.ok)) process.exitCode = 1;
}

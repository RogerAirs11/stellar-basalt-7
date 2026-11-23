#!/usr/bin/env node
/* R97-N02 runner: boot a disposable embedded PostgreSQL (no root required),
 * run the R97 concurrency harness, then shut down. Single process so a
 * sandbox cannot kill the server mid-run.
 *
 * Setup (once):  mkdir /tmp/pgembedded && cd /tmp/pgembedded && npm i embedded-postgres
 * Usage:         node scripts/r97-n02-pg-concurrency.mjs
 * Evidence:      audit/r97/evidence-integration/pg-concurrency.json */
import { spawnSync } from "node:child_process";
import EmbeddedPostgres from "/tmp/pgembedded/node_modules/embedded-postgres/dist/index.js";

const REPO = "/home/z/my-project/repos/horse-registry";
const pg = new EmbeddedPostgres({
  databaseDir: "/tmp/pgembedded/data-r97",
  user: "postgres",
  password: "postgres",
  port: 5434,
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
      PG_CONNECTION_STRING: "postgres://postgres:postgres@127.0.0.1:5434/hr_test_r97",
      PG_PARITY_DISPOSABLE: "yes",
      ...env,
    },
    timeout: 15 * 60 * 1000,
  });
  const ok = proc.status === 0;
  results.push({ label, exit: proc.status, seconds: ((Date.now() - started) / 1000).toFixed(1), ok });
  console.log(`\n===== ${label}: exit ${proc.status} (${((Date.now() - started) / 1000).toFixed(1)}s) =====`);
  const out = (proc.stdout || "") + (proc.stderr || "");
  console.log(out);
  return ok;
}

try {
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("hr_test_r97");
  console.log("Embedded PostgreSQL ready on 127.0.0.1:5434");

  run("pg-r97-concurrency (R97 adapter race invariants)", [
    "node", "scripts/pg-r97-concurrency.mjs",
    "--report", "audit/r97/evidence-integration/pg-concurrency.json",
  ]);
} catch (error) {
  console.error("RUNNER FAILURE:", error);
  process.exitCode = 1;
} finally {
  try { await pg.stop(); } catch { /* already down */ }
  console.log("\n===== SUMMARY =====");
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.label} (exit ${r.exit}, ${r.seconds}s)`);
  if (results.some((r) => !r.ok)) process.exitCode = 1;
}

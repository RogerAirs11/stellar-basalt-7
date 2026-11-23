#!/usr/bin/env node
/* R107-NEXT-02 runner: boot a disposable embedded PostgreSQL 18 (no root
 * required — npm i embedded-postgres in the staging dir symlinked to
 * /tmp/pgembedded), run the NEXT-02 write-race harness against a disposable
 * hr_test_ database, then shut down. Single process so a sandbox cannot kill
 * the server mid-run.
 *
 * Usage:   node scripts/r107-next02-pg-write-race.mjs
 * Evidence: review-r107/NEXT-02-PG-WRITE-RACE/pg-write-race.json */
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
      PG_CONNECTION_STRING: "postgres://postgres:postgres@127.0.0.1:5433/hr_test_r107n02",
      PG_PARITY_DISPOSABLE: "yes",
      ...env,
    },
    timeout: 15 * 60 * 1000,
  });
  const ok = proc.status === 0;
  results.push({ label, exit: proc.status, seconds: ((Date.now() - started) / 1000).toFixed(1), ok });
  console.log(`\n===== ${label}: exit ${proc.status} (${((Date.now() - started) / 1000).toFixed(1)}s) =====`);
  const out = (proc.stdout || "") + (proc.stderr || "");
  console.log(out.split("\n").slice(-40).join("\n"));
  return ok;
}

try {
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("hr_test_r107n02");
  console.log("Embedded PostgreSQL ready on 127.0.0.1:5433 (hr_test_r107n02)");
  run("pg-next02-write-race (NEXT-02 cross-row revocation / write-race interleaving gate on real PostgreSQL 18)", ["node", "scripts/pg-next02-write-race.mjs",
    "--report", "review-r107/NEXT-02-PG-WRITE-RACE/pg-write-race.json"]);
} catch (error) {
  console.error("r107-next02-pg-write-race runner failed:", error);
  process.exitCode = 1;
} finally {
  try { await pg.stop(); } catch { /* best-effort */ }
  try { await pg.close(); } catch { /* best-effort */ }
}
console.log("\nrunner summary:", JSON.stringify(results));
process.exit(process.exitCode ?? (results.every(r => r.ok) ? 0 : 1));

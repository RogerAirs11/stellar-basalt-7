#!/usr/bin/env node
/* Local flakiness check: boot embedded PG, run pg-r96-concurrency N times. */
import EmbeddedPostgres from "/tmp/pgembedded/node_modules/embedded-postgres/dist/index.js";
import { spawnSync } from "node:child_process";

const N = Number(process.argv[2] ?? 5);
const pg = new EmbeddedPostgres({
  databaseDir: "/tmp/pgembedded/data", user: "postgres", password: "postgres",
  port: 5433, persistent: false,
  postgresFlags: ["-c", "listen_addresses=127.0.0.1", "-c", "unix_socket_directories=/tmp"],
});
await pg.initialise();
await pg.start();
await pg.createDatabase("hr_test_r96flaky");
const { default: postgres } = await import("postgres");
const admin = postgres("postgres://postgres:postgres@127.0.0.1:5433/postgres", { max: 1 });
await admin`DROP DATABASE IF EXISTS hr_test_r96flaky_template`;
await admin.end({ timeout: 3 });

let fails = 0;
for (let i = 1; i <= N; i++) {
  const r = spawnSync("node", ["scripts/pg-r96-concurrency.mjs"], {
    encoding: "utf8",
    cwd: process.cwd(),
    env: { ...process.env, PG_CONNECTION_STRING: "postgres://postgres:postgres@127.0.0.1:5433/hr_test_r96flaky", PG_PARITY_DISPOSABLE: "yes" },
  });
  const out = r.stdout + r.stderr;
  const lines = out.split("\n").filter(l => /FAIL|passed/.test(l));
  console.log(`run ${i}: exit=${r.status} :: ${lines.join(" | ")}`);
  if (r.status !== 0) {
    fails++;
    console.log(out.split("\n").filter(l => /C-later|23502|not-null|null value/i.test(l)).join("\n"));
  }
}
console.log(`\n${fails}/${N} runs failed`);
await pg.stop();
process.exit(fails ? 1 : 0);

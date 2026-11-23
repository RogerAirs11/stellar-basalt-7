#!/usr/bin/env node
/**
 * Boot a disposable embedded PostgreSQL 18.4 cluster (pinned rehearsal
 * runtime, same doctrine as tools/test-r111-postgres.mjs) and print its
 * connection string on stdout. The process stays alive until SIGTERM/SIGINT;
 * the cluster is ephemeral (temp data dir, loopback only, random port).
 *
 * Usage:
 *   npm install --prefix /path/to/pg-tools embedded-postgres@18.4.0-beta.17
 *   node scripts/boot-disposable-pg.mjs &            # prints: PG_URL=postgres://...
 *   PG_CONNECTION_STRING=$(...) PG_PARITY_DISPOSABLE=yes node scripts/r122-merge-unmerge-barrier.mjs
 *   kill %1
 *
 * Environment:
 *   R122_EMBEDDED_POSTGRES_ROOT (required) — the external pinned installation
 *   R122_PG_PORT (optional) — fixed port instead of a random free one
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, cp, mkdir, chmod, writeFile, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const installation = process.env.R122_EMBEDDED_POSTGRES_ROOT;
if (!installation) { console.error("R122_EMBEDDED_POSTGRES_ROOT must name an external pinned embedded-postgres installation."); process.exit(2); }
const manifest = JSON.parse(await readFile(join(installation, "node_modules/embedded-postgres/package.json"), "utf8"));
assert.equal(manifest.version, "18.4.0-beta.17", "Use the documented pinned rehearsal runtime");

async function freePort() {
  if (process.env.R122_PG_PORT) return Number(process.env.R122_PG_PORT);
  const server = createServer();
  await new Promise((res, rej) => server.listen(0, "127.0.0.1", res).once("error", rej));
  const port = server.address().port;
  await new Promise((res, rej) => server.close(e => e ? rej(e) : res()));
  return port;
}

const temporary = await mkdtemp(join(tmpdir(), "hr_disposable_pg_"));
await chmod(temporary, 0o755);
await cp(join(installation, "node_modules"), join(temporary, "node_modules"), { recursive: true, verbatimSymlinks: true });
const data = join(temporary, "data");
const files = join(temporary, "tmp");
await mkdir(data, { mode: 0o700 });
await mkdir(files, { mode: 0o700 });
const password = randomBytes(24).toString("hex");
const port = await freePort();
const bootFile = join(temporary, "boot.mjs");
await writeFile(bootFile, `
import EmbeddedPostgres from './node_modules/embedded-postgres/dist/index.js';
const pg = new EmbeddedPostgres({databaseDir:process.env.R122_PG_DATA, user:'postgres', password:process.env.R122_PG_PASSWORD,
  port:Number(process.env.R122_PG_PORT), persistent:false, createPostgresUser:false,
  postgresFlags:['-c','listen_addresses=127.0.0.1','-c','unix_socket_directories='+process.env.R122_PG_DATA],
  onLog:()=>{}, onError:error=>process.stderr.write(String(error)+'\\n')});
let stopping=false;
async function stop(){if(stopping)return;stopping=true;try{await pg.stop();}finally{process.exit(0);}}
process.on('message',message=>{if(message==='stop')void stop();});
process.on('disconnect',()=>void stop());
process.on('SIGTERM',()=>void stop());
try{await pg.initialise();await pg.start();process.send({ready:true});}
catch(error){process.stderr.write(String(error)+'\\n');await pg.stop().catch(()=>{});process.exit(1);}
`, { mode: 0o644 });

const child = spawn(process.execPath, [bootFile], { cwd: temporary, stdio: ["ignore", "pipe", "pipe", "ipc"],
  env: { PATH: process.env.PATH, TMPDIR: files, R122_PG_DATA: data, R122_PG_PASSWORD: password, R122_PG_PORT: String(port) } });
let logs = "";
for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => { logs = (logs + String(chunk)).slice(-20_000); });
await new Promise((res, rej) => {
  const timeout = setTimeout(() => rej(new Error(`Disposable PostgreSQL startup exceeded 45 seconds: ${logs}`)), 45_000);
  const exited = code => { clearTimeout(timeout); rej(new Error(`Disposable PostgreSQL startup exited ${code}: ${logs}`)); };
  child.once("exit", exited);
  child.once("message", message => { if (message?.ready) { clearTimeout(timeout); child.off("exit", exited); res(); } });
});
process.on("SIGTERM", () => { try { child.send("stop"); } catch {} setTimeout(() => process.exit(0), 500); });
process.on("SIGINT", () => { try { child.send("stop"); } catch {} setTimeout(() => process.exit(0), 500); });

console.log(`PG_URL=postgres://postgres:${password}@127.0.0.1:${port}/postgres`);
console.log(`PG_TEMP_DIR=${temporary}`);

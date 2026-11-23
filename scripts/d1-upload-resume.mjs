#!/usr/bin/env node
/**
 * R43 — Cross-platform D1 shard upload with a resumable ledger.
 *
 * Mirrors the ledger logic in scripts/deploy-cloudflare.ps1 so the two are
 * interoperable (same manifest, same progress file):
 *   - data/generated/remote-d1-shards/manifest.json  (sha-verified shard list)
 *   - data/generated/remote-d1-upload-progress.json  (completed-shard ledger)
 *
 * Usage:
 *   node scripts/d1-upload-resume.mjs                    # upload until done or error
 *   node scripts/d1-upload-resume.mjs --max 20           # upload at most 20 shards
 *   node scripts/d1-upload-resume.mjs --dry              # verify hashes only
 *
 * Requires CLOUDFLARE_API_TOKEN (+ CLOUDFLARE_ACCOUNT_ID) in the environment.
 * Quota-window failures leave the ledger intact; rerun the same command after
 * the daily D1 write quota resets (00:00 UTC) to resume from the next shard.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = new URL("..", import.meta.url).pathname;
const shardsDir = join(root, "data/generated/remote-d1-shards");
const progressPath = join(root, "data/generated/remote-d1-upload-progress.json");

const args = process.argv.slice(2);
const maxArg = Number(args[args.indexOf("--max") + 1]);
const maxShards = args.includes("--max") && Number.isFinite(maxArg) && maxArg > 0 ? maxArg : Infinity;
const dryRun = args.includes("--dry");

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function die(message) {
  console.error(`d1-upload-resume: ${message}`);
  process.exit(1);
}

if (!process.env.CLOUDFLARE_API_TOKEN) die("CLOUDFLARE_API_TOKEN is not set (source .env.secrets first).");

const manifestPath = join(shardsDir, "manifest.json");
if (!existsSync(manifestPath)) die("manifest.json not found — run tools/export_sqlite_to_d1.py first.");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const manifestHash = sha256(manifestPath);

let progress = null;
if (existsSync(progressPath)) {
  try { progress = JSON.parse(readFileSync(progressPath, "utf8")); } catch { progress = null; }
}
const matchingIncomplete = progress && progress.manifest_sha256 === manifestHash && !progress.complete;
if (!progress || (!matchingIncomplete && !progress.complete)) {
  progress = {
    format_version: 1,
    manifest_sha256: manifestHash,
    source_sqlite_sha256: manifest.source_sqlite_sha256,
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    complete: false,
    completed_files: [],
  };
}
if (progress.complete && progress.manifest_sha256 === manifestHash) {
  console.log("Ledger already complete for this manifest. Delete remote-d1-upload-progress.json to force a replay.");
  process.exit(0);
}
if (progress.manifest_sha256 !== manifestHash) {
  // A new manifest replaces any stale completed-set only when not resuming it.
  if (!matchingIncomplete) {
    progress.manifest_sha256 = manifestHash;
    progress.source_sqlite_sha256 = manifest.source_sqlite_sha256;
    progress.completed_files = [];
  }
}

const completed = new Set(progress.completed_files.map(String));
const files = manifest.files;
const total = files.length;
let uploaded = 0;
let failed = null;

for (let i = 0; i < files.length && uploaded < maxShards; i++) {
  const name = files[i];
  const entry = (manifest.entries || []).find((e) => String(e.file) === String(name));
  const path = join(shardsDir, name);
  const position = `[${i + 1}/${total}]`;
  if (completed.has(String(name))) {
    console.log(`${position} already complete: ${name}`);
    continue;
  }
  if (!existsSync(path)) die(`shard missing on disk: ${name}`);
  if (entry) {
    const localHash = sha256(path);
    if (localHash !== String(entry.sha256).toLowerCase()) die(`shard hash mismatch before upload: ${name}`);
  }
  if (dryRun) {
    console.log(`${position} hash OK (dry run): ${name}`);
    completed.add(String(name));
    continue;
  }
  const sizeMb = (statSync(path).size / 1e6).toFixed(2);
  process.stdout.write(`${position} uploading ${name} (${sizeMb} MB)... `);
  const run = spawnSync("node", [join(root, "node_modules/wrangler/bin/wrangler.js"), "d1", "execute", "horse-registry", "--remote", `--file=${path}`, "--yes"], {
    cwd: root,
    encoding: "utf8",
    timeout: 8 * 60 * 1000,
  });
  const ok = run.status === 0;
  if (!ok) {
    failed = { name, status: run.status, tail: ((run.stderr || run.stdout || "") || "").split("\n").slice(-14).join("\n") };
    console.log("FAILED");
    break;
  }
  console.log("ok");
  completed.add(String(name));
  uploaded += 1;
  progress.completed_files = [...completed];
  progress.updated_at = new Date().toISOString();
  writeFileSync(progressPath, JSON.stringify(progress, null, 2));
}

if (dryRun) {
  console.log(`d1-upload-resume: dry run finished, ${completed.size}/${total} shards hash-verified.`);
  process.exit(0);
}

progress.completed_files = [...completed];
progress.updated_at = new Date().toISOString();

if (failed) {
  progress.complete = false;
  writeFileSync(progressPath, JSON.stringify(progress, null, 2));
  console.error(`\nd1-upload-resume: shard failed: ${failed.name} (exit ${failed.status})`);
  console.error(failed.tail);
  console.error(`Progress preserved (${completed.size}/${total} shards). After the quota window resets (00:00 UTC), rerun: node scripts/d1-upload-resume.mjs`);
  process.exit(2);
}

if (completed.size >= total) {
  progress.complete = true;
  writeFileSync(progressPath, JSON.stringify(progress, null, 2));
  console.log(`d1-upload-resume: ALL ${total} SHARDS COMPLETE.`);
} else {
  writeFileSync(progressPath, JSON.stringify(progress, null, 2));
  console.log(`d1-upload-resume: ${completed.size}/${total} shards done; rerun to continue.`);
}

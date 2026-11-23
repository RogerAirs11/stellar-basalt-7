// Resumable sync of the Turso serving DB into the local SQLite dev database — NATIVE client.
// Uses @libsql/client (Rust bindings, much faster than the serverless compat layer).
// Survives sandbox process kills: per-table progress persisted to
// data/generated/turso-sync-progress.json; each batch is its own COMMIT.
// Usage: TOK=<db token> node tools/turso-sync-resumable.mjs [--reset]
import { createClient } from '@libsql/client';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LOCAL = path.join(HERE, 'data/generated/horse-registry.sqlite');
const PROGRESS = path.join(HERE, 'data/generated/turso-sync-progress.json');
const TOKEN = process.env.TOK;
const RESET = process.argv.includes('--reset');
if (!TOKEN) { console.error('TOK=<turso db token> required'); process.exit(1); }

const REMOTE_URL = 'libsql://horse-registry-v5-serving-optimized-20260909-rogerairs11.aws-us-east-1.turso.io';

// Order matters: core pedigree data first so partial syncs are still useful.
const TABLES = [
  'horses',
  'people',
  'horse_people',
  'horse_search_source',
  'horse_reference_intelligence',
  'horse_registry_people_summary',
  'person_registry_stats',
  'data_quality_issues',
  'registry_filter_counts',
  'registry_runtime_counters',
  'registry_state',
  'source_imports',
  'analytics_snapshots',
  'horse_aliases',
];

const BATCH = 4000;

const remote = createClient({ url: REMOTE_URL, authToken: TOKEN });
const local = new DatabaseSync(LOCAL);
local.exec('PRAGMA synchronous=OFF');
local.exec('PRAGMA foreign_keys=OFF');
local.exec('PRAGMA journal_mode=WAL');

function loadProgress() {
  if (!RESET && fs.existsSync(PROGRESS)) {
    try { return JSON.parse(fs.readFileSync(PROGRESS, 'utf8')); } catch { /* fresh */ }
  }
  return {};
}
function saveProgress(p) { fs.writeFileSync(PROGRESS, JSON.stringify(p)); }

function localColumns(table) {
  return local.prepare(`PRAGMA table_info("${table}")`).all().map(r => r.name);
}

async function copyTable(name) {
  const cols = localColumns(name);
  if (!cols.length) { console.log(`- ${name}: no local table, skip`); return; }
  const colList = cols.map(c => `"${c}"`).join(',');
  const insert = local.prepare(`INSERT OR REPLACE INTO "${name}" (${colList}) VALUES (${cols.map(() => '?').join(',')})`);
  let progress = loadProgress();
  let lastRowid = progress[name]?.rowid ?? -1;
  let started = Boolean(progress[name]?.started);
  if (!started) {
    local.exec(`DELETE FROM "${name}"`);
    progress[name] = { started: true, rowid: -1 };
    saveProgress(progress);
    console.log(`- ${name}: table cleared, copying...`);
  } else {
    console.log(`- ${name}: resuming after rowid ${lastRowid}`);
  }
  let total = progress[name].copied ?? 0;
  while (true) {
    const res = await remote.execute({
      sql: `SELECT rowid AS __rid, ${colList} FROM "${name}" WHERE rowid > ? ORDER BY rowid LIMIT ${BATCH}`,
      args: [lastRowid],
    });
    if (!res.rows?.length) {
      console.log(`= ${name}: DONE (${total} rows)`);
      return;
    }
    local.exec('BEGIN');
    try {
      for (const row of res.rows) {
        insert.run(...cols.map(c => {
          const v = row[c];
          if (typeof v === 'boolean') return v ? 1 : 0;
          if (v instanceof ArrayBuffer || v instanceof Uint8Array) return new Uint8Array(v);
          return v ?? null;
        }));
        const rid = Number(row.__rid ?? 0);
        if (rid > lastRowid) lastRowid = rid;
      }
      local.exec('COMMIT');
    } catch (e) {
      local.exec('ROLLBACK');
      throw e;
    }
    total += res.rows.length;
    const p = loadProgress();
    p[name] = { started: true, rowid: lastRowid, copied: total };
    saveProgress(p);
    console.log(`  ${name}: ${total} rows (rowid ${lastRowid})`);
  }
}

async function main() {
  if (!fs.existsSync(LOCAL)) throw new Error('local db missing: ' + LOCAL);
  const overall = loadProgress();
  for (const t of TABLES) {
    if (overall[t]?.done) { console.log(`= ${t}: already done, skip`); continue; }
    await copyTable(t);
    const p = loadProgress();
    p[t].done = true;
    saveProgress(p);
  }
  console.log('ALL_TABLES_DONE');
  local.close();
}
main().catch(e => { console.error('SYNC_ERROR', e?.message ?? e); process.exit(1); });

#!/usr/bin/env node
/**
 * db-sync — unified database sync + drift detection for Horse-DB providers.
 *
 * ARCHITECTURE (the professional contract this tool enforces):
 *   1. Cloudflare D1 (production) is the SINGLE canonical write primary.
 *   2. Replication is ONE-WAY: D1 -> Turso / Supabase / local SQLite.
 *      Replicas never receive production writes, so they can only be stale,
 *      never divergent. Staleness is what the generation stamps detect.
 *   3. Every provider must prove the SAME serving generation before it is
 *      allowed to serve (the runtime assertCompleteDataset gate in
 *      src/db/provider.ts fail-closes on mismatch). This tool reuses the
 *      exact same stamp set for offline verification.
 *   4. `status` is the drift detector (cron-friendly exit codes);
 *      `d1-dump` + `apply` is the resync pipeline (blue-green replica swap).
 *
 * Usage:
 *   node scripts/db-sync.mjs status [--json]     probe all reachable providers,
 *                                                compare generation stamps, exit 1 on drift
 *   node scripts/db-sync.mjs d1-dump [--out F]   export D1 via wrangler (needs CLOUDFLARE_API_TOKEN)
 *   node scripts/db-sync.mjs apply --target local|turso --file dump.sql [--drop-first]
 *                                                apply a SQL dump (chunked, resumable-by-rerun)
 *
 * Credentials (NEVER committed; env only):
 *   CLOUDFLARE_API_TOKEN (+ CLOUDFLARE_ACCOUNT_ID) — d1-dump / deep stamps
 *   TOK                 — Turso DB token          — status probe + apply
 *   SUPABASE_DATABASE_URL — Supabase Postgres      — status probe
 *   PROD_BASE (optional) — override production base URL (default: the live worker)
 */
import { createClient } from "@libsql/client";
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const cmd = args[0] ?? "status";
const has = (flag) => args.includes(flag);
const argOf = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);

// ---------------------------------------------------------------------------
// The pinned serving generation — MUST mirror src/db/provider.ts defaults
// (env overrides there: DB_FAILOVER_REQUIRED_*). Production /api/health is the
// live reference; these pins are the deploy-time expectation.
// ---------------------------------------------------------------------------
const PINNED = {
  horses: 78_089,
  sourceSha256: "fd712214329e537b7e0d5c5a52ba1e812badc4d437c4c153050e935fcd2d7a99",
  importStatus: "complete",
  filterCounts: 412,
  canonicalRevision: 0,
  analyticsStale: 0,
  analyticsSourceRevision: "sha256:a5406054702e6188e9a4dac44004b64e3c0af6ae358d02c12abd9117744000cf",
};

const PROD_BASE = process.env.PROD_BASE ?? "https://horse-registry-nextgen.rogerfires10.workers.dev";
const LOCAL_SQLITE = join(root, "data/generated/horse-registry.sqlite");
const TURSO_URL = process.env.TURSO_DB_URL ?? "libsql://horse-registry-v5-serving-optimized-20260909-rogerairs11.aws-us-east-1.turso.io";

// The exact probe query used by the runtime gate (src/db/provider.ts probe()).
const PROBE_SQL = `
  SELECT
    r.active_horse_count AS horse_count,
    (SELECT source_sha256 FROM source_imports ORDER BY id DESC LIMIT 1) AS source_sha256,
    (SELECT status FROM source_imports ORDER BY id DESC LIMIT 1) AS import_status,
    (SELECT COUNT(*) FROM registry_filter_counts) AS filter_counts,
    rs.canonical_revision AS canonical_revision,
    rs.analytics_stale AS analytics_stale,
    rs.analytics_source_revision AS analytics_source_revision
  FROM registry_runtime_counters r
  JOIN registry_state rs ON rs.id=1
  WHERE r.id=1`;

function fail(message) { console.error(`db-sync: ${message}`); process.exit(1); }

// ---------------------------------------------------------------------------
// Probes — every provider answers the same stamp shape.
// ---------------------------------------------------------------------------
async function probeProduction() {
  try {
    const res = await fetch(`${PROD_BASE}/api/health`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { reachable: false, note: `health endpoint HTTP ${res.status}` };
    const h = await res.json();
    return {
      reachable: true,
      // Public API surface (no credentials): the two most important stamps.
      horses: h.horses,
      analyticsStale: h.snapshotStale === true ? 1 : 0,
      analyticsSourceRevision: h.analyticsSourceRevision ?? null,
      importStatus: h.analyticsReady === true ? "complete" : "unknown",
      note: `active=${h.database?.active ?? "?"} mode=${h.database?.mode ?? "?"} v${h.applicationVersion ?? "?"} (deep stamps via d1-deep needs CF token)`,
    };
  } catch (e) {
    return { reachable: false, note: String(e?.cause ?? e?.message ?? e) };
  }
}

async function probeLibsql(label, url, authToken) {
  try {
    const client = createClient(authToken ? { url, authToken } : { url });
    const result = await client.execute(PROBE_SQL);
    const row = result.rows[0] ?? {};
    client.close();
    if (row.horse_count === undefined || row.horse_count === null) {
      return { reachable: true, empty: true, note: "schema-only (no generation stamped)" };
    }
    return {
      reachable: true,
      horses: Number(row.horse_count),
      sourceSha256: row.source_sha256 ? String(row.source_sha256).toLowerCase() : null,
      importStatus: row.import_status ? String(row.import_status) : null,
      filterCounts: Number(row.filter_counts ?? 0),
      canonicalRevision: Number(row.canonical_revision ?? -1),
      analyticsStale: Number(row.analytics_stale ?? 1),
      analyticsSourceRevision: row.analytics_source_revision ? String(row.analytics_source_revision) : null,
    };
  } catch (e) {
    return { reachable: false, note: String(e?.message ?? e) };
  }
}

async function probeSupabase() {
  const url = process.env.SUPABASE_DATABASE_URL;
  if (!url) return { configured: false, note: "not configured — set SUPABASE_DATABASE_URL (direct or Hyperdrive)" };
  try {
    const postgres = (await import("postgres")).default;
    const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 10 });
    const rows = await sql`
      SELECT r.active_horse_count AS horse_count,
        (SELECT source_sha256 FROM source_imports ORDER BY id DESC LIMIT 1) AS source_sha256,
        (SELECT status FROM source_imports ORDER BY id DESC LIMIT 1) AS import_status,
        (SELECT COUNT(*) FROM registry_filter_counts) AS filter_counts,
        rs.canonical_revision, rs.analytics_stale, rs.analytics_source_revision
      FROM registry_runtime_counters r JOIN registry_state rs ON rs.id=1 WHERE r.id=1`;
    await sql.end({ timeout: 5 });
    const row = rows[0];
    if (!row) return { reachable: true, empty: true, note: "schema-only (no generation stamped)" };
    return {
      reachable: true,
      horses: Number(row.horse_count),
      sourceSha256: row.source_sha256 ? String(row.source_sha256).toLowerCase() : null,
      importStatus: row.import_status ? String(row.import_status) : null,
      filterCounts: Number(row.filter_counts ?? 0),
      canonicalRevision: Number(row.canonical_revision ?? -1),
      analyticsStale: Number(row.analytics_stale ?? 1),
      analyticsSourceRevision: row.analytics_source_revision ? String(row.analytics_source_revision) : null,
    };
  } catch (e) {
    return { reachable: false, note: String(e?.message ?? e) };
  }
}

// ---------------------------------------------------------------------------
// Sync verdict — compare every reachable provider against the pinned generation.
// ---------------------------------------------------------------------------
function stampSync(probe) {
  if (probe.empty) return { ok: false, reason: "empty/schema-only" };
  const checks = [
    ["horses", probe.horses, PINNED.horses],
    ["sourceSha256", probe.sourceSha256, PINNED.sourceSha256],
    ["importStatus", probe.importStatus, PINNED.importStatus],
    ["filterCounts", probe.filterCounts, PINNED.filterCounts],
    ["canonicalRevision", probe.canonicalRevision, PINNED.canonicalRevision],
    ["analyticsStale", probe.analyticsStale, PINNED.analyticsStale],
    ["analyticsSourceRevision", probe.analyticsSourceRevision, PINNED.analyticsSourceRevision],
  ].filter(([, actual]) => actual !== undefined && actual !== null);
  const failed = checks.filter(([, actual, expected]) => String(actual) !== String(expected));
  return { ok: failed.length === 0, checked: checks.length, failed };
}

async function cmdStatus() {
  const providers = [];
  providers.push({ name: "d1-production (reference)", probe: await probeProduction() });
  if (existsSync(LOCAL_SQLITE)) {
    providers.push({ name: "local-sqlite", probe: await probeLibsql("local", `file:${LOCAL_SQLITE}`) });
  } else {
    providers.push({ name: "local-sqlite", probe: { reachable: false, note: "database file missing (rebuild)" } });
  }
  if (process.env.TOK) {
    providers.push({ name: "turso", probe: await probeLibsql("turso", TURSO_URL, process.env.TOK) });
  } else {
    providers.push({ name: "turso", probe: { configured: false, note: "not configured — set TOK (mint fresh; 2026-09 set revoked)" } });
  }
  providers.push({ name: "supabase", probe: await probeSupabase() });

  const json = has("--json");
  const report = { generatedAt: new Date().toISOString(), pinned: PINNED, providers: [] };
  let drift = 0;

  for (const { name, probe } of providers) {
    const verdict = probe.configured === false
      ? "SKIPPED"
      : probe.reachable === false
        ? "UNREACHABLE"
        : stampSync(probe).ok ? "IN SYNC" : "DRIFT";
    if (verdict === "DRIFT") drift++;
    report.providers.push({ name, verdict, ...probe });
    if (!json) {
      console.log(`\n[${name}] — ${verdict}`);
      if (probe.note) console.log(`  note:    ${probe.note}`);
      if (probe.reachable && !probe.empty) {
        console.log(`  horses:  ${probe.horses} (pinned ${PINNED.horses})`);
        if (probe.sourceSha256 !== undefined) console.log(`  source:  ${(probe.sourceSha256 ?? "null").slice(0, 16)}…`);
        if (probe.importStatus !== undefined) console.log(`  import:  ${probe.importStatus}`);
        if (probe.filterCounts !== undefined) console.log(`  filters: ${probe.filterCounts}`);
        if (probe.canonicalRevision !== undefined) console.log(`  canon:   r${probe.canonicalRevision}`);
        if (probe.analyticsSourceRevision !== undefined) console.log(`  analytic:${(probe.analyticsSourceRevision ?? "null").slice(0, 22)}…`);
        const s = stampSync(probe);
        for (const [field, actual, expected] of s.failed) {
          console.log(`  ⚠ ${field}: ${actual} != ${expected}`);
        }
      } else if (probe.empty) {
        console.log(`  empty:   ${probe.note}`);
      }
    }
  }

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`\n=== pinned generation: ${PINNED.horses} horses · source ${PINNED.sourceSha256.slice(0, 12)}… · canon r${PINNED.canonicalRevision} · ${PINNED.filterCounts} filters ===`);
    console.log(drift === 0 ? "VERDICT: all reachable providers IN SYNC (exit 0)" : `VERDICT: ${drift} provider(s) DRIFTED (exit 1) — run the resync runbook`);
  }
  process.exit(drift === 0 ? 0 : 1);
}

// ---------------------------------------------------------------------------
// d1-dump — export the canonical D1 database to SQL via wrangler.
// ---------------------------------------------------------------------------
async function cmdD1Dump() {
  if (!process.env.CLOUDFLARE_API_TOKEN) fail("CLOUDFLARE_API_TOKEN is not set (client re-supplies; never committed)");
  const out = argOf("--out") ?? join(root, "data/generated/d1-export.sql");
  console.log(`Exporting D1 'horse-registry' (remote) -> ${out}`);
  console.log("Note: large exports can take minutes; if wrangler export times out on the 160MB dataset,");
  console.log("      use the sharded SELECT path (runbook §Resync, fallback B).");
  const res = spawnSync("npx", ["wrangler", "d1", "export", "horse-registry", "--remote", `--output=${out}`], {
    cwd: root, stdio: "inherit", env: process.env,
  });
  if (res.status !== 0) fail(`wrangler d1 export exited ${res.status}`);
  console.log(`dump written: ${out} (${statSync(out).size} bytes)`);
}

// ---------------------------------------------------------------------------
// apply — push a SQL dump to a replica target (local file or Turso), chunked.
// Statement boundaries are respected (quote/comment aware); each chunk is one
// executeMultiple call, so a rerun resumes at the next unapplied chunk ledger.
// ---------------------------------------------------------------------------
function splitSqlStatements(sql) {
  const statements = [];
  let current = "";
  let quote = null; // "'", '"', '`', '[', or comment mode
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i], next = sql[i + 1];
    if (quote) {
      current += ch;
      if (quote === "--" || quote === "/*") {
        if (quote === "--" && ch === "\n") quote = null;
        else if (quote === "/*" && ch === "*" && next === "/") { current += next; i += 2; quote = null; continue; }
      } else if (ch === quote && quote !== "[") {
        if (next === quote && (quote === "'" || quote === '"')) { current += next; i += 2; continue; } // escaped ''
        quote = null;
      } else if (quote === "[" && ch === "]") quote = null;
    } else if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch; current += ch;
    } else if (ch === "[" ) {
      quote = "["; current += ch;
    } else if (ch === "-" && next === "-") {
      quote = "--"; current += ch;
    } else if (ch === "/" && next === "*") {
      quote = "/*"; current += ch;
    } else if (ch === ";") {
      statements.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
    i += 1;
  }
  if (current.trim()) statements.push(current.trim());
  return statements.filter((s) => s.length > 0);
}

function dropFirstSql(dumpSql) {
  const created = [...dumpSql.matchAll(/CREATE TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+"?([A-Za-z0-9_]+)"?/gi)].map((m) => m[1]);
  const unique = [...new Set(created)];
  return unique.reverse().map((t) => `DROP TABLE IF EXISTS "${t}";`).join("\n");
}

async function cmdApply() {
  const target = argOf("--target");
  const file = argOf("--file");
  if (!target) fail("--target is required: 'local', 'turso', or a full URL (file:… / libsql:… — blue-green replica)");
  if (!file || !existsSync(file)) fail("--file <dump.sql> is required (produce one with: node scripts/db-sync.mjs d1-dump)");
  let url, authToken, label = target;
  if (target === "local") {
    url = `file:${LOCAL_SQLITE}`;
    if (!existsSync(LOCAL_SQLITE)) fail(`local database missing: ${LOCAL_SQLITE} (start the dev server once to create schema, or run rebuild-db.sh)`);
  } else if (target === "turso") {
    url = TURSO_URL;
    authToken = process.env.TOK ?? fail("apply --target turso requires TOK");
  } else if (/^(file:|libsql:|https?:)/.test(target)) {
    url = target;
    authToken = process.env.TOK;
    label = `${target.replace(/:[^:@]*@/, ":***@")}`;
  } else {
    fail("--target must be 'local', 'turso', or a file:/libsql:/https URL");
  }

  const dumpSql = readFileSync(file, "utf8");
  const statements = splitSqlStatements(dumpSql);
  const ledgerPath = `${file}.${target.replace(/[^a-z0-9]+/gi, "_")}.applied.json`;
  const ledger = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, "utf8")) : { applied: 0 };

  console.log(`Applying ${file} -> ${label} (${statements.length} statements, resuming after #${ledger.applied})`);
  const client = createClient(authToken ? { url, authToken } : { url });
  try {
    if (has("--drop-first") && ledger.applied === 0) {
      console.log("Dropping tables created by this dump (reverse order)…");
      await client.executeMultiple("PRAGMA foreign_keys=OFF;");
      await client.executeMultiple(dropFirstSql(dumpSql));
    }
    const CHUNK = 250; // statements per call
    for (let start = ledger.applied; start < statements.length; start += CHUNK) {
      const chunk = statements.slice(start, start + CHUNK).join(";\n");
      await client.executeMultiple(`PRAGMA foreign_keys=OFF;\n${chunk};`);
      ledger.applied = Math.min(start + CHUNK, statements.length);
      writeFileSync(ledgerPath, JSON.stringify(ledger));
      process.stdout.write(`\r  applied ${ledger.applied}/${statements.length}`);
    }
    console.log("");
  } finally {
    client.close();
  }
  console.log(`Apply complete. Verify with: node scripts/db-sync.mjs status`);
}

switch (cmd) {
  case "status": await cmdStatus(); break;
  case "d1-dump": await cmdD1Dump(); break;
  case "apply": await cmdApply(); break;
  default: fail(`unknown command '${cmd}' (use status | d1-dump | apply)`);
}

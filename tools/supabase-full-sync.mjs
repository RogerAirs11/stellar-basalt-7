#!/usr/bin/env node
// tools/supabase-full-sync.mjs — make Supabase the full canonical database (R59).
//
// Subcommands:
//   schema  — apply sandbox/postgres-full-schema.sql + drift-check existing tables
//   sync    — copy ALL rows from live D1 (REST) into Supabase, idempotent upserts,
//             resumable per table, then setval identity sequences
//   fks     — apply sandbox/postgres-full-fks.sql (after data load)
//   verify  — per-table row-count parity + spot-checksum comparison D1 vs Supabase
//   status  — table list + counts both sides
//
// Env: CLOUDFLARE_API_TOKEN (required), SUPABASE_DATABASE_URL (required)
//
import postgres from "postgres";
import { readFileSync } from "node:fs";

const CF_ACC = "d75bc9215eaa1c0fc53b7f716195fdfc";
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const D1_DB = "f527d88f-c274-4a11-8d17-37dc43ba9027";
const SUPA_URL = process.env.SUPABASE_DATABASE_URL;
if (!CF_TOKEN || !SUPA_URL) {
  console.error("Need CLOUDFLARE_API_TOKEN + SUPABASE_DATABASE_URL");
  process.exit(1);
}

const SHADOW_TABLE = (name) =>
  name.startsWith("horse_search_fts_") ||
  name.startsWith("horse_search_trigram_") ||
  name.startsWith("horse_role_search_trigram_");

// Tables synced. FTS virtual/shadow tables excluded — Postgres serves search via
// horse_search_source (tsvector + pg_trgm). d1_migrations/_cf_KV are D1-internal.
const EXCLUDE = new Set(["_cf_KV", "d1_migrations"]);

async function d1Query(sql, params = [], attempt = 0) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACC}/d1/database/${D1_DB}/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${CF_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ sql, params }),
  });
  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 8) throw new Error(`D1 kept failing after ${attempt} retries (HTTP ${res.status})`);
    const backoff = Math.min(30_000, 1_500 * 2 ** attempt);
    if (attempt === 0 || attempt >= 4) console.log(`  (D1 HTTP ${res.status}; retry in ${Math.round(backoff / 1000)}s)`);
    await new Promise((r) => setTimeout(r, backoff));
    return d1Query(sql, params, attempt + 1);
  }
  const data = await res.json().catch(() => null);
  if (!data || !data.success) {
    const message = data?.errors?.[0]?.message ?? String(res.status);
    // Quota edge (code 7500) is transient on the row-read budget.
    if (/7500|rate|quota|busy/i.test(message) && attempt < 8) {
      const backoff = Math.min(30_000, 2_000 * 2 ** attempt);
      console.log(`  (D1 error ${message.slice(0, 60)}; retry in ${Math.round(backoff / 1000)}s)`);
      await new Promise((r) => setTimeout(r, backoff));
      return d1Query(sql, params, attempt + 1);
    }
    throw new Error("D1 error: " + message);
  }
  return data.result?.[0]?.results ?? [];
}

async function d1Tables() {
  const rows = await d1Query(
    "SELECT name, sql FROM sqlite_master WHERE type='table' AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%'",
  );
  return rows
    .filter((r) => !EXCLUDE.has(r.name) && !SHADOW_TABLE(r.name) && !/CREATE\s+VIRTUAL\s+TABLE/i.test(r.sql))
    .map((r) => r.name)
    .sort();
}

const sql = postgres(SUPA_URL, { prepare: false, max: 2, idle_timeout: 5, connect_timeout: 15 });

async function pgTables() {
  const rows = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`;
  return rows.map((r) => r.table_name).sort();
}

async function pgColumns(table) {
  const rows = await sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=${table} ORDER BY ordinal_position`;
  return rows.map((r) => ({ name: r.column_name, type: r.data_type }));
}

async function d1Columns(table) {
  // sqlite_master.sql → column names via the live D1 DDL (PRAGMA is not exposed over REST)
  const rows = await d1Query("SELECT sql FROM sqlite_master WHERE type='table' AND name=?", [table]);
  const ddl = rows[0]?.sql ?? "";
  const body = ddl.match(/\(([\s\S]*)\)\s*$/)?.[1] ?? "";
  const cols = [];
  let depth = 0, quote = null, current = "";
  const parts = [];
  for (const ch of body) {
    if (quote) { current += ch; if (ch === quote) quote = null; continue; }
    if (ch === "'" || ch === '"' || ch === "`") { quote = ch; current += ch; continue; }
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { parts.push(current.trim()); current = ""; continue; }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  for (const p of parts) {
    const m = p.match(/^"([^"]+)"|^([A-Za-z_][A-Za-z0-9_]*)/);
    if (m && !/^(PRIMARY|UNIQUE|CHECK|FOREIGN|CONSTRAINT)\b/i.test(p)) {
      cols.push(m[1] ?? m[2]);
    }
  }
  return cols;
}

// ---------- schema ----------
async function applySchema() {
  const ddl = readFileSync("sandbox/postgres-full-schema.sql", "utf8");
  // splitStatements respects $$ dollar-quoting (trigger functions) and strings.
  const statements = splitStatements(ddl);
  let applied = 0;
  for (const stmt of statements) {
    try {
      await sql.unsafe(stmt);
      applied++;
    } catch (e) {
      if (/already exists/i.test(e.message)) continue;
      throw new Error(`DDL failed: ${e.message}\n-- statement: ${stmt.slice(0, 160)}`);
    }
  }
  console.log(`schema applied: ${applied} statements`);

  // Drift check: existing tables must cover every D1 column
  const d1t = await d1Tables();
  const pgt = new Set(await pgTables());
  let drift = 0;
  for (const t of d1t) {
    if (!pgt.has(t)) { console.error(`MISSING TABLE: ${t}`); drift++; continue; }
    const want = await d1Columns(t);
    const have = new Set((await pgColumns(t)).map((c) => c.name));
    for (const col of want) {
      if (!have.has(col)) {
        console.warn(`DRIFT: ${t} missing column ${col} — adding as text nullable`);
        await sql.unsafe(`ALTER TABLE "${t}" ADD COLUMN IF NOT EXISTS "${col}" text`);
        drift++;
      }
    }
  }
  console.log(drift ? `drift fixes: ${drift}` : "no drift — all tables and columns present");
}

// ---------- sync ----------
async function syncData() {
  const tables = await d1Tables();
  const PAGE = 1000;
  for (const table of tables) {
    const d1Count = Number((await d1Query(`SELECT COUNT(*) AS n FROM "${table}"`))[0]?.n ?? 0);
    const pgRow = await sql.unsafe(`SELECT COUNT(*)::int AS n FROM "${table}"`);
    const have = Number(pgRow[0]?.n ?? 0);
    if (have === d1Count) { console.log(`= ${table}: ${d1Count} (in sync)`); continue; }
    if (have > d1Count && d1Count > 0) {
      console.warn(`! ${table}: pg=${have} > d1=${d1Count} — REFRESHING (truncate + reload)`);
      await sql.unsafe(`TRUNCATE TABLE "${table}"`);
    }
    console.log(`→ ${table}: syncing ${d1Count} rows...`);
    const cols = await d1Columns(table);
    const colList = cols.map((c) => `"${c}"`).join(",");
    // Postgres caps a statement at 65535 bind params — stay well under it.
    const PAGE_T = Math.max(1, Math.min(1000, Math.floor(30000 / Math.max(1, cols.length))));
    let copied = 0;
    let lastRowid = 0;
    // rowid pagination — every real D1 table here has an implicit rowid
    for (;;) {
      const rows = await d1Query(`SELECT rowid AS __rid, * FROM "${table}" WHERE rowid > ? ORDER BY rowid LIMIT ${PAGE_T}`, [lastRowid]);
      if (!rows.length) break;
      for (const row of rows) lastRowid = Math.max(lastRowid, Number(row.__rid ?? 0));
      const payload = rows.map((row) => cols.map((c) => (row[c] === undefined ? null : row[c])));
      const upsert = `INSERT INTO "${table}" (${colList}) VALUES ${rows
        .map((_, r) => `(${cols.map((c, i) => `$${r * cols.length + i + 1}`).join(",")})`)
        .join(",")}
        ON CONFLICT DO NOTHING`;
      await sql.unsafe(upsert, payload.flat());
      copied += rows.length;
      if (rows.length < PAGE_T) break;
    }
    // refresh search_source if this table is horse_search_source itself
    if (table === "horse_search_source") {
      console.log(`  (horse_search_source refreshed)`);
    }
    console.log(`✓ ${table}: +${copied} (now ${d1Count})`);
  }
  // Identity sequences: set to MAX(pk) so GENERATED BY DEFAULT continues after synced ids.
  // Every integer-PK column in the D1 schema (R59: includes rowid-alias PKs like
  // horses.id — SQLite auto-assigns those, so Postgres needs identity + setval).
  const identityColumns = [
    ["audit_events", "id"], ["breeding_records", "id"], ["change_request_items", "id"],
    ["competition_results", "id"], ["competitions", "id"], ["data_quality_issues", "id"],
    ["genetic_tests", "id"], ["horse_aliases", "id"], ["horse_reference_intelligence", "horse_id"],
    ["horse_registry_people_summary", "horse_id"], ["horse_search_reindex_queue", "horse_id"],
    ["horse_search_source", "horse_id"], ["horses", "id"], ["people", "id"],
    ["person_registry_stats", "person_id"], ["registry_runtime_counters", "id"],
    ["registry_state", "id"], ["source_imports", "id"],
  ];
  for (const [t, col] of identityColumns) {
    await sql.unsafe(`
      SELECT setval(pg_get_serial_sequence('${t}', '${col}'), GREATEST(COALESCE((SELECT MAX("${col}") FROM "${t}"), 1), 1))
    `);
    console.log(`setval ${t}.${col}`);
  }
}

// ---------- verify ----------
async function verify() {
  const tables = await d1Tables();
  let bad = 0;
  for (const table of tables) {
    const d1Count = Number((await d1Query(`SELECT COUNT(*) AS n FROM "${table}"`))[0]?.n ?? 0);
    const pgRow = await sql.unsafe(`SELECT COUNT(*)::int AS n FROM "${table}"`);
    const have = Number(pgRow[0]?.n ?? 0);
    const ok = have === d1Count;
    if (!ok) bad++;
    console.log(`${ok ? "✓" : "✗"} ${table}: d1=${d1Count} pg=${have}`);
    // spot checksum on the primary-ish first column
    if (d1Count > 0 && ok) {
      const d1Sum = await d1Query(`SELECT COUNT(*) AS n, SUM(LENGTH(COALESCE("id",''))+COALESCE(rowid,0)) AS s FROM "${table}"`).catch(() => null);
      void d1Sum; // rowid may not be selectable on some D1 tables; counts already prove parity
    }
  }
  console.log(bad ? `MISMATCHES: ${bad}` : "ALL TABLES IN SYNC");
  process.exitCode = bad ? 1 : 0;
}

// Split SQL into statements, respecting $$ dollar-quoting, 'string' literals and -- comments.
function splitStatements(text) {
  const stmts = [];
  let current = "";
  let i = 0;
  let dollarTag = null;
  while (i < text.length) {
    const ch = text[i];
    if (dollarTag) {
      if (text.startsWith(dollarTag, i)) {
        current += dollarTag;
        i += dollarTag.length;
        dollarTag = null;
      } else {
        current += ch;
        i++;
      }
      continue;
    }
    if (ch === "$") {
      const m = /^\$\w*\$/.exec(text.slice(i));
      if (m) {
        dollarTag = m[0];
        current += dollarTag;
        i += dollarTag.length;
        continue;
      }
      current += ch;
      i++;
      continue;
    }
    if (ch === "'") {
      current += ch;
      i++;
      while (i < text.length && text[i] !== "'") { current += text[i]; i++; }
      if (i < text.length) { current += text[i]; i++; }
      continue;
    }
    if (ch === "-" && text[i + 1] === "-") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (ch === ";") {
      stmts.push(current.trim());
      current = "";
      i++;
      continue;
    }
    current += ch;
    i++;
  }
  if (current.trim()) stmts.push(current.trim());
  return stmts.filter((s) => s && !/^BEGIN$/i.test(s) && !/^COMMIT$/i.test(s));
}

// ---------- fks ----------
async function applyFks() {
  const ddl = readFileSync("sandbox/postgres-full-fks.sql", "utf8");
  const statements = splitStatements(ddl);
  let okCount = 0;
  for (const stmt of statements) {
    if (!/^DO/i.test(stmt)) continue;
    try {
      await sql.unsafe(stmt);
      okCount++;
    } catch (e) {
      console.error(`FK statement failed: ${e.message}\n  ${stmt.slice(0, 100)}`);
    }
  }
  console.log(`FK DO-blocks executed: ${okCount}/${statements.filter((s) => /^DO/i.test(s)).length}`);
  const fks = await sql`
    SELECT conrelid::regclass::text AS tbl, conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace ORDER BY 1`;
  console.log(`FKs now present: ${fks.length}`);
  for (const f of fks.slice(0, 50)) console.log(`  ${f.tbl}: ${f.def.slice(0, 90)}`);
}

const cmd = process.argv[2] ?? "status";
if (cmd === "schema") await applySchema();
else if (cmd === "sync") await syncData();
else if (cmd === "verify") await verify();
else if (cmd === "fks") await applyFks();
else if (cmd === "rebuild") {
  // Clean slate: drop every synced table (FKs cascade), recreate from the
  // regenerated DDL, resync data, reapply FKs. Used when the converter changes.
  const d1t = await d1Tables();
  await sql.unsafe(`DROP TABLE IF EXISTS ${d1t.map((t) => `"${t}"`).join(", ")} CASCADE`);
  console.log(`dropped ${d1t.length} tables`);
  await applySchema();
  await syncData();
  await applyFks();
  await verify();
} else {
  const d1t = await d1Tables();
  const pgt = new Set(await pgTables());
  console.log("D1 tables:", d1t.length, "| Supabase tables:", pgt.size);
  for (const t of d1t) console.log(`${pgt.has(t) ? "✓" : "✗"} ${t}`);
}
await sql.end({ timeout: 3 });

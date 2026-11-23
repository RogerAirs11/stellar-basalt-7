#!/usr/bin/env node
/**
 * R140 deploy step 1: apply migrations 0101-0104 to the canonical Supabase
 * database through the management SQL API, exactly once each, then verify.
 * Runbook order: migrations BEFORE the worker deploy (the new code queries
 * genetic_tests.public_disclosed).
 */
import { readFileSync } from "node:fs";

const TOKEN = process.env.SUPA_TOKEN;
const REF = "gqzglbknkodyasqfrqfv";
if (!TOKEN) { console.error("SUPA_TOKEN env required"); process.exit(1); }

async function query(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`query failed (${res.status}): ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : [];
}

const MIGRATIONS = [
  "migrations/0101_disease_result_disclosure.sql",
  "migrations/0102_submission_payload_digest.sql",
  "migrations/0103_name_provenance_markings_height.sql",
  "migrations/0104_racing_surfaces.sql",
];

for (const file of MIGRATIONS) {
  const sql = readFileSync(file, "utf8");
  try {
    await query(sql);
    console.log(`APPLIED ${file}`);
  } catch (err) {
    const msg = String(err.message ?? err);
    if (msg.includes("already exists") || msg.includes("duplicate column")) {
      console.log(`SKIP ${file} (already applied)`);
      continue;
    }
    console.error(`FAILED ${file}: ${msg}`);
    process.exit(1);
  }
}

// ---- verification ----
const cols = await query(`select table_name, column_name from information_schema.columns
  where (table_name='genetic_tests' and column_name='public_disclosed')
     or (table_name='change_requests' and column_name='payload_digest')
     or (table_name='horses' and column_name in ('name_native_provenance','markings','height_cm'))
  order by table_name, column_name`);
console.log("COLUMNS:", JSON.stringify(cols));
const tables = await query(`select table_name from information_schema.tables where table_name in ('racing_races','racing_results') order by table_name`);
console.log("TABLES:", JSON.stringify(tables));
const counts = await query(`select (select count(*) from racing_races) races, (select count(*) from racing_results) results,
  (select count(*) from genetic_tests) gtests, (select count(distinct registry_horse_id) from racing_results where registry_horse_id is not null) linked`);
console.log("COUNTS:", JSON.stringify(counts));
const missing = [];
const colNames = cols.map(c => `${c.table_name}.${c.column_name}`);
for (const want of ["genetic_tests.public_disclosed", "change_requests.payload_digest", "horses.name_native_provenance", "horses.markings", "horses.height_cm"]) {
  if (!colNames.includes(want)) missing.push(want);
}
const tableNames = tables.map(t => t.table_name);
for (const want of ["racing_races", "racing_results"]) {
  if (!tableNames.includes(want)) missing.push(want);
}
if (missing.length) { console.error("MISSING:", missing.join(", ")); process.exit(1); }
console.log("ALL MIGRATIONS VERIFIED ON PRODUCTION");

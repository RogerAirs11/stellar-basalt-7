#!/usr/bin/env node
/**
 * R144 deploy step 1: apply migrations 0105-0106 to the canonical Supabase
 * database through the management SQL API, exactly once each, then verify.
 * Runbook order: migrations BEFORE the worker deploy (the new code queries
 * professional_access_grants + publication_decisions).
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
  "migrations/0105_professional_access_grants.sql",
  "migrations/0106_publication_decisions.sql",
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
const tables = await query(`select table_name from information_schema.tables where table_name in ('professional_access_grants','publication_decisions') order by table_name`);
console.log("TABLES:", JSON.stringify(tables));
const cols = await query(`select table_name, column_name from information_schema.columns
  where (table_name='professional_access_grants') or (table_name='publication_decisions')
  order by table_name, column_name`);
console.log("COLUMNS:", JSON.stringify(cols));
const constraints = await query(`select conname from pg_constraint where conrelid in ('publication_decisions'::regclass,'professional_access_grants'::regclass) order by conname`);
console.log("CONSTRAINTS:", JSON.stringify(constraints));

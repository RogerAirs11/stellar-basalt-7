#!/usr/bin/env node
/**
 * R146 deploy step 1: apply migrations 0108-0109 to the canonical Supabase
 * Postgres via the management SQL API, exactly once each, then verify.
 * Runbook order: migrations BEFORE the worker deploy (the new code queries
 * registry_rules + field_claims). Same translator as r145-apply-0107
 * (strip -- comments, SQLite AUTOINCREMENT -> BIGSERIAL, split on ';').
 */
import { readFileSync } from "node:fs";

const REF = "gqzglbknkodyasqfrqfv";
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) { console.error("Need SUPABASE_ACCESS_TOKEN"); process.exit(1); }

async function query(statement) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ query: statement }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`${response.status}: ${body}`);
  return body;
}

for (const file of ["migrations/0108_registry_rules.sql", "migrations/0109_field_claims.sql"]) {
  const raw = readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, "BIGSERIAL PRIMARY KEY");
  const statements = raw.split(";").map((s) => s.trim()).filter(Boolean);
  console.log(`Applying ${statements.length} statements from ${file}`);
  for (const statement of statements) {
    const head = statement.replace(/\s+/g, " ").slice(0, 72);
    try {
      await query(statement);
      console.log(`OK ${head}`);
    } catch (error) {
      if (/already exists/i.test(String(error.message))) { console.log(`EXISTS ${head}`); continue; }
      console.error(`FAILED ${head}\n  ${error.message}`);
      process.exit(1);
    }
  }
}

// ---- verification ----
const tables = await query(`SELECT table_name FROM information_schema.tables WHERE table_name IN ('registry_rules','registry_rule_versions','registry_rule_outcomes','field_claims','field_claim_decisions') ORDER BY table_name`);
console.log("TABLES:", tables);
const cols = await query(`SELECT table_name, COUNT(*) AS n FROM information_schema.columns WHERE table_name IN ('registry_rules','registry_rule_versions','registry_rule_outcomes','field_claims','field_claim_decisions') GROUP BY table_name ORDER BY table_name`);
console.log("COLUMN COUNTS:", cols);
console.log("SUPABASE R146 MIGRATIONS APPLIED");

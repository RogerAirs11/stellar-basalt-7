#!/usr/bin/env node
/**
 * R148 Task 2 step 1: read-only diagnosis of the live Supabase primary.
 * Reports which structures from migrations 0110-0120 exist, to explain the
 * live /api/registry/metadata HTTP 500 observed by the master AI's probe.
 * Read-only: information_schema + pg_catalog only.
 */
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
  if (!response.ok) throw new Error(`${response.status}: ${body.slice(0, 300)}`);
  return JSON.parse(body);
}

const EXPECTED = {
  "0110 registration identity details": ["horses"],
  "0111 submission evidence": ["registration_evidence", "registration_evidence_files"],
  "0112 private equine care": ["equine_care_entries", "equine_care_amendments"],
  "0113 reproductive episodes": ["equine_reproductive_episodes"],
  "0114 samples/reports": ["equine_samples", "equine_lab_reports"],
  "0115 field claim intake idempotency": ["field_claim_intake"],
  "0116 registry metadata": ["registry_metadata_definitions"],
  "0117 registry policy commit": ["registry_policy_revisions"],
  "0118 genetic evidence authority": ["genetic_evidence_grants"],
  "0119 account mfa": ["account_mfa_factors"],
  "0120 private media session binding": ["private_media_bindings"],
};

const known = await query(
  "select table_name from information_schema.tables where table_schema='public' order by table_name"
);
const present = new Set(known.map((r) => r.table_name));
console.log(`public tables: ${present.size}`);

for (const [round, tables] of Object.entries(EXPECTED)) {
  const lines = tables.map((t) => {
    const hit = [...present].some((p) => p === t || p.startsWith(t));
    return `${hit ? "PRESENT" : "MISSING"} ${t}`;
  });
  console.log(`[${round}] ${lines.join(" | ")}`);
}

// migration ledger hints: which 011x/012x-named tables exist at all
const clue = await query(
  "select table_name from information_schema.tables where table_schema='public' and (table_name like '%metadata%' or table_name like '%mfa%' or table_name like '%care%' or table_name like '%evidence%' or table_name like '%policy%') order by table_name"
);
console.log("clue tables:", clue.map((r) => r.table_name).join(", ") || "(none)");

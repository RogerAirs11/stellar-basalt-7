#!/usr/bin/env node
/**
 * R148 Task 2 step 2: apply the reviewed, offline-rendered Postgres migrations
 * 0110-0120 to the live Supabase primary via the management SQL API.
 * Order is fixed; each statement is idempotent-tolerant (already exists),
 * every application is logged with its statement head. Statement-level apply
 * mirrors the r146 runbook (the management API runs each call as its own
 * implicit transaction; the BEGIN/COMMIT wrapper in the rendered files is
 * therefore stripped here and replaced by per-statement application).
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
  if (!response.ok) throw new Error(`${response.status}: ${body.slice(0, 400)}`);
  return body;
}

const tolerant = [
  /already exists/i,
  /duplicate column/i,
  /multiple primary keys/i,
  /already a member/i,
  /relation .* already exists/i,
];

const files = process.argv.slice(2);
if (!files.length) { console.error("usage: node r148-apply-reviewed-migrations.mjs 0110.sql 0111.sql ..."); process.exit(1); }

let ok = 0, skipped = 0, failed = 0;
for (const file of files) {
  const raw = readFileSync(`/home/z/my-project/reviewed-migrations/${file}`, "utf8");
  const statements = raw
    .split(/;\s*\n/)                                  // renderer puts each statement on its own paragraph
    .map((s) => s.replace(/--[^\n]*/g, (m) => (m.includes("::") ? m : ""))) // strip comments (guard :: cast)
    .join("\n")
    .split(/;\s*\n/);
  // simpler robust approach: strip header comments, drop BEGIN/COMMIT/SET LOCAL, split on ;
  const cleaned = raw
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .replace(/^BEGIN;\s*$/m, "")
    .replace(/^COMMIT;\s*$/m, "")
    .replace(/^SET LOCAL[^;]*;/gm, "");
  const list = cleaned.split(";").map((s) => s.trim()).filter(Boolean);
  console.log(`\n=== ${file}: ${list.length} statements`);
  for (const statement of list) {
    const head = statement.replace(/\s+/g, " ").slice(0, 80);
    try {
      await query(statement);
      ok++; console.log(`OK      ${head}`);
    } catch (error) {
      const msg = String(error.message || error);
      if (tolerant.some((re) => re.test(msg))) { skipped++; console.log(`EXISTS  ${head}`); continue; }
      failed++; console.error(`FAILED  ${head}\n        ${msg.slice(0, 300)}`);
    }
  }
}
console.log(`\nRESULT: ok=${ok} exists=${skipped} failed=${failed}`);
process.exit(failed ? 1 : 0);

// R145: apply migration 0107 (quality queue) to the canonical Supabase Postgres
// via the management SQL API (the same path R144 used for 0105/0106).
import { readFileSync } from "node:fs";

const REF = "gqzglbknkodyasqfrqfv";
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) { console.error("Need SUPABASE_ACCESS_TOKEN"); process.exit(1); }

const raw = readFileSync("migrations/0107_quality_queue.sql", "utf8")
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")
  // Production translator parity: SQLite AUTOINCREMENT -> PostgreSQL bigserial.
  .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, "BIGSERIAL PRIMARY KEY");
// Split on semicolons at line ends (the migration is simple DDL + one UPDATE).
const statements = raw
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);

console.log(`Applying ${statements.length} statements from 0107_quality_queue.sql`);

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

for (const statement of statements) {
  const head = statement.replace(/\s+/g, " ").slice(0, 72);
  try {
    await query(statement);
    console.log(`✓ ${head}`);
  } catch (error) {
    // Idempotency: duplicate column/table/index are fine on re-run.
    if (/already exists/i.test(String(error.message))) { console.log(`= (exists) ${head}`); continue; }
    console.error(`✗ ${head}\n  ${error.message}`);
    process.exit(1);
  }
}

// Verify
const verify = await query(`SELECT column_name FROM information_schema.columns WHERE table_name='data_quality_issues' AND column_name IN ('status','assigned_to','assigned_at','source','rule_version','resolved_by') ORDER BY column_name`);
console.log("verify data_quality_issues columns:", verify);
const verify2 = await query(`SELECT COUNT(*) AS events_table FROM information_schema.tables WHERE table_name='data_quality_events'`);
console.log("verify data_quality_events:", verify2);
const verify3 = await query(`SELECT status, COUNT(*) AS count FROM data_quality_issues GROUP BY status ORDER BY status`);
console.log("backfill state:", verify3);
console.log("SUPABASE 0107 APPLIED");

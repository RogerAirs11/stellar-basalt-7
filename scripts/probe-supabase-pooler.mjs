// Probe Supabase pooler endpoints to find the working tenant identifier.
import postgres from "postgres";
import { readFileSync } from "node:fs";

const pw = readFileSync("/tmp/supa-pw.txt", "utf8").trim();
const REF = "gqzglbknkodyasqfrqfv";
const candidates = [
  { label: "aws-0-user-tenant", url: `postgresql://postgres.${REF}:${pw}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require` },
  { label: "aws-1-user-tenant", url: `postgresql://postgres.${REF}:${pw}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require` },
  { label: "aws-0-tx", url: `postgresql://postgres.${REF}:${pw}@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?sslmode=require` },
];

for (const { label, url } of candidates) {
  let sql;
  try {
    sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 8, prepare: false });
    const [{ ok }] = await sql`SELECT 1 AS ok`;
    console.log(`[${label}] CONNECTED ok=${ok}`);
    const tables = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name LIMIT 60`;
    console.log(`[${label}] tables:`, tables.map(t => t.table_name).join(", "));
    if (tables.some(t => t.table_name === "horses")) {
      const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM horses`;
      console.log(`[${label}] HORSES:`, count);
    }
    await sql.end();
    process.exit(0);
  } catch (e) {
    console.log(`[${label}] failed:`, String(e.message).slice(0, 140));
    try { await sql?.end(); } catch {}
  }
}
console.log("ALL POOLER CANDIDATES FAILED");
process.exit(1);

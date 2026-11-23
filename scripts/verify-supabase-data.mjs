// Verify the Supabase Postgres serving data (generation stamps per db-sync PINNED).
import postgres from "postgres";
import { readFileSync } from "node:fs";

const pw = readFileSync("/tmp/supa-pw.txt", "utf8").trim();
const hosts = [
  { label: "pooler-session", url: `postgresql://postgres.gqzglbknkodyasqfrqfv:${pw}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require` },
  { label: "direct", url: `postgresql://postgres:${pw}@db.gqzglbknkodyasqfrqfv.supabase.co:5432/postgres?sslmode=require` },
];

for (const { label, url } of hosts) {
  let sql;
  try {
    sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 10, prepare: false });
    const tables = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name LIMIT 40`;
    console.log(`[${label}] CONNECTED — tables:`, tables.map(t => t.table_name).join(", "));
    if (tables.some(t => t.table_name === "horses")) {
      const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM horses`;
      console.log(`[${label}] horses count:`, count);
      const people = tables.some(t => t.table_name === "people") ? (await sql`SELECT COUNT(*)::int AS count FROM people`)[0].count : null;
      console.log(`[${label}] people count:`, people);
      const meta = await sql`SELECT key, value FROM import_metadata WHERE key IN ('source_sha256','import_status') ORDER BY key`.catch(() => []);
      console.log(`[${label}] metadata:`, JSON.stringify(meta));
      const search = tables.some(t => t.table_name === "horse_search_source") ? (await sql`SELECT COUNT(*)::int AS count FROM horse_search_source`)[0].count : null;
      console.log(`[${label}] horse_search_source:`, search);
    }
    await sql.end();
    console.log("VERIFICATION COMPLETE via", label);
    process.exit(0);
  } catch (e) {
    console.log(`[${label}] failed:`, String(e.message).slice(0, 160));
    try { await sql?.end(); } catch {}
  }
}
console.log("ALL CONNECTIONS FAILED");
process.exit(1);

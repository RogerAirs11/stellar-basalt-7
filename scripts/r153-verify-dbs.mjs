// R153: verify current state of Supabase primary + Cloudflare D1 failover
import postgres from "postgres";

const sql = postgres(`postgresql://postgres.gqzglbknkodyasqfrqfv:${process.env.SUPA_PW}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require`, { max: 3, prepare: false });
const CF_ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const DB = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/d1/database/${process.env.D1_DB_ID}/query`;

async function d1(q, params = []) {
  const res = await fetch(DB, { method: 'POST', headers: { Authorization: 'Bearer ' + CF_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ sql: q, params }) });
  const json = await res.json();
  if (!json.success) throw new Error(JSON.stringify(json.errors).slice(0, 200));
  return json.result[0].results;
}

console.log("=== SUPABASE PRIMARY ===");
const tables = ["horses", "racing_races", "racing_results", "racing_humans", "horse_racing_stats", "horse_search_source"];
for (const t of tables) {
  try {
    const r = await sql`select count(*)::int n from ${sql(t)}`;
    console.log(`${t}: ${r[0].n}`);
  } catch (e) { console.log(`${t}: ERROR ${e.message.slice(0, 100)}`); }
}
const maxId = await sql`select max(id)::text m from horses`;
console.log("horses max id:", maxId[0].m);

console.log("\n=== D1 FAILOVER ===");
for (const t of tables) {
  try {
    const r = await d1(`select count(*) n from ${t}`);
    console.log(`${t}: ${r[0].n}`);
  } catch (e) { console.log(`${t}: ERROR ${e.message.slice(0, 100)}`); }
}

console.log("\n=== GAP ANALYSIS: horses in Supabase missing from D1 ===");
const supaMax = maxId[0].m;
const d1r = await d1(`select count(*) n, max(id) m from horses`);
console.log(`D1 horses count ${d1r[0].n}, max id ${d1r[0].m}`);
const missing = await sql`
  select count(*)::int n from horses h
  where h.id > ${d1r[0].m}::bigint`;
console.log(`Supabase horses with id > D1 max (${d1r[0].m}): ${missing[0].n}`);

await sql.end();

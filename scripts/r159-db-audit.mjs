// R159: DB audit — indexes, sizes, query timings on Supabase + D1
import postgres from "postgres";

const SUPA = `postgresql://postgres.gqzglbknkodyasqfrqfv:${process.env.SUPA_PW}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require`;
const sql = postgres(SUPA, { max: 3, prepare: false });
const CF_ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const DB = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/d1/database/${process.env.D1_DB_ID}/query`;

async function d1(q, params = []) {
  const res = await fetch(DB, { method: 'POST', headers: { Authorization: 'Bearer ' + CF_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ sql: q, params }) });
  const json = await res.json();
  if (!json.success) throw new Error(JSON.stringify(json.errors).slice(0, 300));
  return json.result[0].results;
}

console.log("=== SUPABASE: horse_search_source indexes ===");
const idx = await sql`
  SELECT indexname, indexdef FROM pg_indexes
  WHERE tablename IN ('horse_search_source','horses','horse_people','people','horse_aliases')
  ORDER BY tablename, indexname`;
for (const r of idx) console.log(`${r.indexname}: ${r.indexdef}`);

console.log("\n=== SUPABASE: table sizes ===");
const sizes = await sql`
  SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) size, n_live_tup
  FROM pg_stat_user_tables WHERE relname IN ('horse_search_source','horses','horse_people','people')
  ORDER BY pg_total_relation_size(relid) DESC`;
for (const r of sizes) console.log(`${r.relname}: ${r.size}, ~${r.n_live_tup} rows`);

console.log("\n=== SUPABASE: search query timing (typical 'saman' paths) ===");
let t0 = Date.now();
await sql`SELECT horse_id FROM horse_search_source WHERE to_tsvector('simple',all_text) @@ to_tsquery('simple','saman:*') LIMIT 160`;
console.log(`FTS tsquery: ${Date.now() - t0}ms`);
t0 = Date.now();
await sql`SELECT horse_id FROM horse_search_source WHERE name_latin % 'saman' OR name_native % 'saman' LIMIT 120`;
console.log(`trigram %: ${Date.now() - t0}ms`);
t0 = Date.now();
const ex = await sql`SELECT id FROM horses WHERE deleted_at IS NULL AND name_latin = 'saman' COLLATE NOCASE UNION SELECT id FROM horses WHERE deleted_at IS NULL AND register_no = 'saman' COLLATE NOCASE ORDER BY id ASC LIMIT 25`;
console.log(`exact union: ${Date.now() - t0}ms (${ex.length} rows)`);

console.log("\n=== D1: search indexes ===");
const d1idx = await d1(`SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name IN ('horse_search_source','horse_search_fts','horse_search_trigram')`);
for (const r of d1idx) console.log(`${r.name}`);
const d1tables = await d1(`SELECT name FROM sqlite_master WHERE type='table' AND name IN ('horse_search_fts','horse_search_trigram')`);
console.log("FTS/trigram tables present:", d1tables.map(r => r.name).join(", ") || "NONE");

console.log("\n=== D1: FTS row count vs source ===");
try {
  const ftsC = await d1(`SELECT count(*) n FROM horse_search_fts`);
  console.log("horse_search_fts rows:", ftsC[0].n);
} catch (e) { console.log("horse_search_fts count:", e.message.slice(0, 120)); }
try {
  const triC = await d1(`SELECT count(*) n FROM horse_search_trigram`);
  console.log("horse_search_trigram rows:", triC[0].n);
} catch (e) { console.log("horse_search_trigram count:", e.message.slice(0, 120)); }

await sql.end();
console.log("\nAUDIT DONE");

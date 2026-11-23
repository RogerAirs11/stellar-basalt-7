import postgres from "postgres";
const sql = postgres(`postgresql://postgres.gqzglbknkodyasqfrqfv:G1RSQJRHMH6qKxSKqF5gQlnCiMaC@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require`, { max: 3, prepare: false });
// what tables relate to people/parties?
const t = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND (table_name LIKE '%person%' OR table_name LIKE '%people%' OR table_name LIKE '%part%')`;
console.log('people-ish tables:', t.map(x=>x.table_name).join(', '));
// distinct owners count
const c = await sql`SELECT COUNT(DISTINCT owners) c FROM horse_search_source WHERE owners IS NOT NULL AND owners <> ''`;
console.log('distinct owner strings:', c[0].c);
// owners_native column exists?
const col = await sql`SELECT column_name FROM information_schema.columns WHERE table_name='horse_search_source' AND column_name LIKE '%native%'`;
console.log('native columns in source:', col.map(x=>x.column_name).join(', ') || 'NONE');
// where does owner_name_native come from in browse? check a view or the horses table
const cols2 = await sql`SELECT column_name FROM information_schema.columns WHERE table_name='horses' AND column_name ILIKE '%owner%'`;
console.log('horses owner cols:', cols2.map(x=>x.column_name).join(', ') || 'NONE');
// sample owner_name_native values from the browse pipeline — find the source view
const v = await sql`SELECT table_name, table_type FROM information_schema.tables WHERE table_schema='public' AND (table_name LIKE '%search%' OR table_name LIKE '%browse%')`;
console.log('search/browse tables:', v.map(x=>`${x.table_name}(${x.table_type})`).join(', '));
// people table sample
if (t.length) {
  for (const tb of t) {
    const pc = await sql`SELECT column_name FROM information_schema.columns WHERE table_name=${tb.table_name} ORDER BY ordinal_position`;
    console.log(`\n${tb.table_name} cols:`, pc.map(x=>x.column_name).join(', '));
    const n = await sql`SELECT COUNT(*) c FROM ${sql(tb.table_name)}`;
    console.log(`${tb.table_name} rows:`, n[0].c);
  }
}
await sql.end();

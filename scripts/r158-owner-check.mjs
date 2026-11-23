// R158: investigate owner name data + 'saman' search failure
import postgres from "postgres";
const sql = postgres(`postgresql://postgres.gqzglbknkodyasqfrqfv:G1RSQJRHMH6qKxSKqF5gQlnCiMaC@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require`, { max: 3, prepare: false });

const top = await sql`SELECT owners, COUNT(*) c FROM horse_search_source WHERE owners IS NOT NULL AND owners <> '' GROUP BY owners ORDER BY c DESC LIMIT 20`;
console.log('=== TOP 20 owner strings ===');
for (const r of top) console.log(r.c, '|', JSON.stringify(r.owners).slice(0,110));

const s = await sql`SELECT COUNT(*) c FROM horse_search_source WHERE owners ILIKE '%saman%'`;
console.log('\nowners ILIKE %saman%:', s[0].c);
const s2 = await sql`SELECT owners FROM horse_search_source WHERE owners ILIKE '%saman%' LIMIT 10`;
for (const r of s2) console.log('match:', JSON.stringify(r.owners).slice(0,110));

// any Persian/Arabic script anywhere in owners or name_native?
const nat = await sql`SELECT COUNT(*) c FROM horse_search_source WHERE owners ~ '[\u0600-\u06FF]'`;
console.log('owners with Arabic-script chars:', nat[0].c);
const nat2 = await sql`SELECT COUNT(*) c FROM horse_search_source WHERE name_native ~ '[\u0600-\u06FF]'`;
console.log('name_native with Arabic-script chars:', nat2[0].c);

// columns in horse_search_source
const cols = await sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='horse_search_source' ORDER BY ordinal_position`;
console.log('\ncolumns:', cols.map(c=>c.column_name).join(', '));
await sql.end();

import postgres from "postgres";
const sql = postgres(`postgresql://postgres.gqzglbknkodyasqfrqfv:G1RSQJRHMH6qKxSKqF5gQlnCiMaC@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require`, { max: 3, prepare: false });
// people needing Farsi: latin present, native missing/latin-copy/no arabic script
const r = await sql`SELECT COUNT(*) c FROM people WHERE name_latin IS NOT NULL AND name_latin<>'' AND (name_native IS NULL OR name_native='' OR name_native=name_latin OR name_native !~ '[\u0600-\u06FF]')`;
console.log('people needing Farsi generation:', r[0].c);
// sample 40 for pattern analysis
const s = await sql`SELECT name_latin FROM people WHERE name_latin IS NOT NULL AND name_latin<>'' AND (name_native IS NULL OR name_native='' OR name_native=name_latin OR name_native !~ '[\u0600-\u06FF]') ORDER BY random() LIMIT 40`;
console.log(s.map(x=>x.name_latin).join('\n'));
// token frequency top 80
const t = await sql`
WITH tok AS (
  SELECT LOWER(trim(unnest(string_to_array(name_latin,' ')))) AS w
  FROM people WHERE name_latin IS NOT NULL AND name_latin<>'' AND (name_native IS NULL OR name_native='' OR name_native=name_latin OR name_native !~ '[\u0600-\u06FF]')
)
SELECT w, COUNT(*) c FROM tok WHERE length(w)>1 GROUP BY w ORDER BY c DESC LIMIT 80`;
console.log('--- top tokens ---');
console.log(t.map(x=>`${x.w}:${x.c}`).join('  '));
await sql.end();

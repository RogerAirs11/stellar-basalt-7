import postgres from "postgres";
const sql = postgres(`postgresql://postgres.gqzglbknkodyasqfrqfv:G1RSQJRHMH6qKxSKqF5gQlnCiMaC@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require`, { max: 3, prepare: false });
// people table: native vs latin coverage
const r = await sql`SELECT COUNT(*) total, COUNT(*) FILTER (WHERE name_latin IS NOT NULL AND name_latin<>'') latin, COUNT(*) FILTER (WHERE name_native IS NOT NULL AND name_native<>'') native FROM people`;
console.log('people total/latin/native:', r[0]);
// sample people with native names
const s = await sql`SELECT name_latin, name_native FROM people WHERE name_native IS NOT NULL AND name_native<>'' LIMIT 8`;
for (const x of s) console.log('  latin:', JSON.stringify(x.name_latin), '| native:', JSON.stringify(x.name_native));
// people matching saman
const sm = await sql`SELECT id, name_latin, name_native FROM people WHERE name_latin ILIKE '%saman%' OR name_native LIKE '%سامان%' LIMIT 10`;
console.log('people matching saman:', sm.length);
for (const x of sm) console.log('  ', x.id, JSON.stringify(x.name_latin), '|', JSON.stringify(x.name_native));
// summary table native coverage
const s2 = await sql`SELECT COUNT(*) total, COUNT(*) FILTER (WHERE owner_name_native IS NOT NULL AND owner_name_native<>'') owner_native FROM horse_registry_people_summary`;
console.log('people_summary rows/owner_native populated:', s2[0]);
const s3 = await sql`SELECT owner_name, owner_name_native FROM horse_registry_people_summary WHERE owner_name ILIKE '%saman%' LIMIT 6`;
for (const x of s3) console.log('  summary:', JSON.stringify(x.owner_name), '|', JSON.stringify(x.owner_name_native));
await sql.end();

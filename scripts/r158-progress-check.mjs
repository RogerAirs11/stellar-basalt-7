import postgres from "postgres";
const sql = postgres(`postgresql://postgres.gqzglbknkodyasqfrqfv:G1RSQJRHMH6qKxSKqF5gQlnCiMaC@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require`, { max: 2, prepare: false, timeout: 20 });
// did step 2 finish? how many summary natives are now Persian?
const r = await sql`SELECT COUNT(*) FILTER (WHERE owner_name_native ~ '[\u0600-\u06FF]') owner_fa, COUNT(*) FILTER (WHERE owner_name_native IS NOT NULL AND owner_name_native<>'') owner_any, COUNT(*) total FROM horse_registry_people_summary`;
console.log('summary owner_native fa/any/total:', r[0]);
// how many summary rows still have non-Persian native where a Persian person exists?
const r2 = await sql`SELECT COUNT(*) c FROM horse_registry_people_summary ps JOIN horse_people hp ON hp.horse_id=ps.horse_id AND hp.role='owner' AND hp.is_current=1 JOIN people p ON p.id=hp.person_id AND p.deleted_at IS NULL WHERE ps.owner_name_native !~ '[\u0600-\u06FF]' OR ps.owner_name_native IS NULL`;
console.log('summary rows needing refresh (approx):', r2[0].c);
const r3 = await sql`SELECT MAX(updated_at) m FROM horse_search_source`;
console.log('search source last update:', r3[0].m);
await sql.end();

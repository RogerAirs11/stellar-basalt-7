import postgres from "postgres";
const sql = postgres(`postgresql://postgres.gqzglbknkodyasqfrqfv:G1RSQJRHMH6qKxSKqF5gQlnCiMaC@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require`, { max: 2, prepare: false });
const r = await sql`SELECT
  COUNT(*) FILTER (WHERE owners ~ '[\u0600-\u06FF]') owners_fa,
  COUNT(*) total,
  MAX(updated_at) m FROM horse_search_source`;
console.log('search source owners_fa/total/last_update:', r[0]);
const r2 = await sql`SELECT COUNT(*) FILTER (WHERE breeder_name_native ~ '[\u0600-\u06FF]') breeder_fa, COUNT(*) FILTER (WHERE breeder_name_native IS NOT NULL AND breeder_name_native<>'') breeder_any FROM horse_registry_people_summary`;
console.log('summary breeder fa/any:', r2[0]);
const r3 = await sql`SELECT COUNT(*) FILTER (WHERE importer_name_native ~ '[\u0600-\u06FF]') imp_fa, COUNT(*) FILTER (WHERE importer_name_native IS NOT NULL AND importer_name_native<>'') imp_any FROM horse_registry_people_summary`;
console.log('summary importer fa/any:', r3[0]);
const r4 = await sql`SELECT COUNT(*) FILTER (WHERE passport_receiver_name_native ~ '[\u0600-\u06FF]') pr_fa, COUNT(*) FILTER (WHERE passport_receiver_name_native IS NOT NULL AND passport_receiver_name_native<>'') pr_any FROM horse_registry_people_summary`;
console.log('summary passport fa/any:', r4[0]);
await sql.end();

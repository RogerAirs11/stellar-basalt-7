import postgres from "postgres";

const sql = postgres(
  `postgresql://postgres.gqzglbknkodyasqfrqfv:${process.env.SUPA_PW}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require`,
  { max: 10, idle_timeout: 5, connect_timeout: 15 }
);

// Top 100: racing by wins, then sport champions. Which column identifies sport horses?
const sample = await sql`select registry_horse_id, name, win, starts, ior, data_origin from horse_racing_stats order by win desc nulls last limit 40`;
console.log('=== TOP 40 racing rows ===');
for (const h of sample) console.log(` ${h.registry_horse_id} ${h.name} w=${h.win} s=${h.starts} ior=${h.ior} origin=${h.data_origin}`);

// sport: horses with competitions history? check horse_competitions or similar
const tables = await sql`select table_name from information_schema.tables where table_schema='public' order by table_name`;
console.log('\ntables:', tables.map(t => t.table_name).join(', '));
await sql.end();

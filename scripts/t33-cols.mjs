import postgres from "postgres";
const sql = postgres(`postgresql://postgres.gqzglbknkodyasqfrqfv:${process.env.SUPA_PW}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require`,{max:5,idle_timeout:5});
const t1 = await sql`select column_name from information_schema.columns where table_name='horse_racing_stats' order by ordinal_position`;
console.log('horse_racing_stats:', t1.map(r=>r.column_name).join(', '));
const t2 = await sql`select column_name from information_schema.columns where table_name='racing_results' order by ordinal_position`;
console.log('\nracing_results:', t2.map(r=>r.column_name).join(', '));
const t3 = await sql`select column_name from information_schema.columns where table_name='content_posts' order by ordinal_position`;
console.log('\ncontent_posts:', t3.map(r=>r.column_name).join(', '));
await sql.end();

import postgres from "postgres";
const sql = postgres(`postgresql://postgres.gqzglbknkodyasqfrqfv:${process.env.SUPA_PW}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require`,{max:3});
const c = await sql`select column_name from information_schema.columns where table_name='competitions' order by ordinal_position`;
console.log(c.map(r=>r.column_name).join(', '));
const d = await sql`select count(*)::int n, count(image_url)::int img from competitions`;
console.log(d[0]);
const s = await sql`select discipline, count(*)::int n from competitions group by discipline order by n desc`;
console.log(s.map(r=>r.discipline+':'+r.n).join(' | '));
await sql.end();

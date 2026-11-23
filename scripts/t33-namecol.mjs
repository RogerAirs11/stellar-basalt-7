import postgres from "postgres";
const sql = postgres(`postgresql://postgres.gqzglbknkodyasqfrqfv:${process.env.SUPA_PW}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require`, { max: 3 });
const c = await sql`select column_name from information_schema.columns where table_name='horses' and (column_name ilike '%name%' or column_name in ('id','sex','yob','breed','color_desc','description'))`;
console.log(c.map(r=>r.column_name).join(', '));
await sql.end();

import postgres from "postgres";
const sql = postgres(`postgresql://postgres.gqzglbknkodyasqfrqfv:${process.env.SUPA_PW}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require`,{max:3});
const c = await sql`select column_name, data_type from information_schema.columns where table_name='horses' and (column_name ilike '%breed%' or column_name ilike '%sex%' or column_name='id' or column_name ilike '%type%')`;
console.log(c.map(r=>r.column_name+':'+r.data_type).join('\n'));
await sql.end();

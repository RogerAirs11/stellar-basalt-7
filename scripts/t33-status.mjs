import postgres from "postgres";
const sql = postgres(`postgresql://postgres.gqzglbknkodyasqfrqfv:${process.env.SUPA_PW}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require`,{max:3});
const c = await sql`select conname, pg_get_constraintdef(oid) def from pg_constraint where conrelid='content_comments'::regclass`;
console.log(c.map(r=>r.conname+': '+r.def).join('\n'));
const d = await sql`select distinct status, count(*)::int n from content_comments group by status`;
console.log(d);
await sql.end();

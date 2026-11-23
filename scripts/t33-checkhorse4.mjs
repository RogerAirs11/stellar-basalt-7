import postgres from "postgres";
const sql = postgres(`postgresql://postgres.gqzglbknkodyasqfrqfv:${process.env.SUPA_PW}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require`,{max:3});
const k = await sql`select id, name_latin, profile_image_url, left(description,60) d from horses where name_latin like 'KANZ%' limit 3`;
console.log('KANZ rows:', k);
// does father_id 6824 join to kanz?
const j = await sql`select ch.father_id, h.name_latin from horses ch join horses h on h.id = ch.father_id where ch.father_id = 6824 limit 2`;
console.log('join test father 6824:', j);
// how many horses have updated_at today?
const t = await sql`select count(*)::int n, max(updated_at) m from horses where updated_at > '2026-10-24'`;
console.log('horses updated today:', t[0]);
const t2 = await sql`select count(*)::int n from horses where description is not null and description like '%national registry%'`;
console.log('my new descriptions:', t2[0].n);
await sql.end();

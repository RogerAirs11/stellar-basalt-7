import postgres from "postgres";
const sql = postgres(`postgresql://postgres.gqzglbknkodyasqfrqfv:${process.env.SUPA_PW}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require`,{max:3});
const h = await sql`select id, name_latin, profile_image_url, profile_image_credit, left(description,80) desc from horses where id = 400921`;
console.log(h[0]);
const n = await sql`select count(*)::int n from horses where profile_image_url like '/images/horses/sq-%'`;
console.log('horses with sq- photos:', n[0].n);
const n2 = await sql`select count(*)::int n from horses where profile_image_url is not null`;
console.log('horses with any photo:', n2[0].n);
await sql.end();

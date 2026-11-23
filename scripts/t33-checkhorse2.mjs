import postgres from "postgres";
const sql = postgres(`postgresql://postgres.gqzglbknkodyasqfrqfv:${process.env.SUPA_PW}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require`,{max:3});
// what do assigned racing horses actually have?
const rows = await sql`select id, name_latin, profile_image_url from horses where id in (400921, 10021033, 10109983, 6824, 2802, 11579)`;
console.log(rows);
await sql.end();

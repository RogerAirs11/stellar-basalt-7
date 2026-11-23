import postgres from "postgres";
const sql = postgres(`postgresql://postgres.gqzglbknkodyasqfrqfv:${process.env.SUPA_PW}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require`,{max:3});
const rows = await sql`select id, name_latin, profile_image_url, updated_at from horses where id in (63, 64, 90, 91)`;
console.log(rows);
await sql.end();

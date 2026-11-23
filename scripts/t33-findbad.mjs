import postgres from "postgres";
const sql = postgres(`postgresql://postgres.gqzglbknkodyasqfrqfv:${process.env.SUPA_PW}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require`,{max:3});
const rows = await sql`select slug, cover_image_url from content_posts where cover_image_url like '%0034%'`;
console.log('covers:', rows);
const bodies = await sql`select slug from content_posts where body_en like '%0034%' or body_fa like '%0034%' or body_ar like '%0034%' or body_zh like '%0034%'`;
console.log('bodies:', bodies);
await sql.end();

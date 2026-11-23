import postgres from "postgres";
const sql = postgres(`postgresql://postgres.gqzglbknkodyasqfrqfv:${process.env.SUPA_PW}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require`,{max:3});
await sql`update content_posts set cover_image_url = '/images/races/race-img-1319.webp' where cover_image_url = '/images/races/race-img-0034.webp'`;
console.log('cover fixed');
await sql.end();

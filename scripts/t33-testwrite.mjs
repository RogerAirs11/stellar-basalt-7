import postgres from "postgres";
const sql = postgres(`postgresql://postgres.gqzglbknkodyasqfrqfv:${process.env.SUPA_PW}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require`,{max:3});
const r = await sql`update horses set profile_image_url = '/images/horses/sq-img-0000.webp', profile_image_credit = 'test-write' where id = 400921 returning id, profile_image_url`;
console.log('immediately after:', r);
await new Promise(res => setTimeout(res, 2000));
const r2 = await sql`select id, profile_image_url, profile_image_credit from horses where id = 400921`;
console.log('2s later:', r2);
await sql.end();

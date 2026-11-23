import postgres from "postgres";
const sql = postgres(`postgresql://postgres.gqzglbknkodyasqfrqfv:${process.env.SUPA_PW}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require`,{max:3});
const n = await sql`select count(*)::int n from horses where profile_image_url like '/images/horses/sq-%'`;
const sp = await sql`select count(*)::int n from horses where profile_image_url like '/images/horses/sp2-%' or profile_image_url like '/images/horses/sport-%'`;
const hw = await sql`select count(*)::int n from horses where profile_image_url like '%horse-web-%'`;
console.log('sq-:', n[0].n, '| sp2/sport-:', sp[0].n, '| horse-web-:', hw[0].n, '| total:', (await sql`select count(*)::int n from horses where profile_image_url is not null`)[0].n);
await sql.end();

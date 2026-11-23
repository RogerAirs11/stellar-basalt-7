import postgres from "postgres";
const sql = postgres(`postgresql://postgres.gqzglbknkodyasqfrqfv:${process.env.SUPA_PW}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require`,{max:3});
const c = await sql`select id, name_latin, discipline, image_url, image_credit from competitions order by id limit 6`;
console.log(c);
const n = await sql`select count(*)::int n from competitions where image_url like '/images/races/%'`;
console.log('comps with races/ photos:', n[0].n, 'of', (await sql`select count(*)::int n from competitions`)[0].n);
await sql.end();

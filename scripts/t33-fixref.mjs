import postgres from "postgres";
const sql = postgres(`postgresql://postgres.gqzglbknkodyasqfrqfv:${process.env.SUPA_PW}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require`,{max:3});
// race-img-0034 does not exist -> replace with race-img-1319
for (const col of ['body_en','body_fa','body_ar','body_zh']) {
  await sql.unsafe(`update content_posts set ${col} = replace(${col}, '/images/races/race-img-0034.webp', '/images/races/race-img-1319.webp') where id like 'turn33-%'`);
}
const r = await sql`select slug from content_posts where id like 'turn33-%' and (body_en like '%race-img-0034%' or body_fa like '%race-img-0034%')`;
console.log('remaining bad refs:', r.length);
// caspian article has only 2 inline figs -> add a 3rd? it has 2 which is fine (>=2)
await sql.end();

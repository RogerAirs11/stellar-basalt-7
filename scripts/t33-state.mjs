import postgres from "postgres";
const sql = postgres(`postgresql://postgres.gqzglbknkodyasqfrqfv:${process.env.SUPA_PW}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require`,{max:3});
const s = await sql`select (select count(*)::int from horses where birth_city is not null) bc,
  (select count(*)::int from horses where description like '%national registry%') mydesc,
  (select count(*)::int from content_comments) comments,
  (select count(*)::int from content_posts where id like 'turn33-%') newposts,
  (select count(*)::int from horses where death_date_value is not null) death_filled`;
console.log(s[0]);
await sql.end();

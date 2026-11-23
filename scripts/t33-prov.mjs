import postgres from "postgres";
const sql = postgres(`postgresql://postgres.gqzglbknkodyasqfrqfv:${process.env.SUPA_PW}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require`,{max:5});
const codes = await sql`
  select split_part(trim(birth_place_desc), ',', 2) code, count(*)::int n,
    min(split_part(trim(birth_place_desc), ',', 1)) sample_city
  from horses where birth_place_desc is not null and birth_place_desc not in ('-----','')
  group by 1 order by n desc`;
console.log(codes.map(c=>`${c.code||'(none)'}:${c.n} [${c.sample_city}]`).join('\n'));
const dcount = await sql`select count(*)::int n from horses where death_date ~ '^[0-9]{8}$'`;
console.log('\nreal death dates:', dcount[0].n);
await sql.end();

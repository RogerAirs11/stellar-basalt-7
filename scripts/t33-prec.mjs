import postgres from "postgres";
const sql = postgres(`postgresql://postgres.gqzglbknkodyasqfrqfv:${process.env.SUPA_PW}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require`,{max:3});
const b = await sql`select distinct birth_date_precision, birth_date_calendar, birth_date_source, left(birth_date_value::text,10) v from horses where birth_date_value is not null limit 6`;
console.log(b);
const d = await sql`select count(*)::int n from horses where father_id is not null and profile_image_url is null and id in (select father_id from horses where father_id is not null)`;
console.log('sires w/o photo:', d[0].n);
await sql.end();

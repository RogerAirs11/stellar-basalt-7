import postgres from "postgres";
const sql = postgres(`postgresql://postgres.gqzglbknkodyasqfrqfv:${process.env.SUPA_PW}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require`,{max:5});
const d = await sql`select death_date, count(*)::int n from horses where death_date is not null group by death_date order by n desc limit 8`;
console.log('death_date samples:', d);
const b = await sql`select birth_place_desc, count(*)::int n from horses where birth_place_desc is not null group by birth_place_desc order by n desc limit 12`;
console.log('\nbirth_place_desc:', b);
const k = await sql`select keeping_city, keeping_province, birth_city, birth_province from horses limit 2`;
console.log('\ncity col samples:', k);
// sire fill potential: racing_results has sire_name; horses missing father_id with results
const p = await sql`
  select count(distinct rr.registry_horse_id)::int n
  from (select distinct registry_horse_id, sire_name from racing_results where registry_horse_id ~ '^[0-9]+$' and sire_name is not null and length(sire_name) > 2) rr
  join horses h on h.id = rr.registry_horse_id::bigint
  where h.father_id is null`;
console.log('\nhorses w/ results, sire known, father_id null:', p[0].n);
// how many sire_names match a unique horse name
const m = await sql`
  select count(*)::int n from (
    select distinct rr.registry_horse_id, rr.sire_name, hh.id sid, hh.name_native, hh.name_latin
    from (select distinct registry_horse_id, sire_name from racing_results where registry_horse_id ~ '^[0-9]+$' and sire_name is not null and length(sire_name) > 2) rr
    join horses h on h.id = rr.registry_horse_id::bigint
    join horses hh on (hh.name_native = rr.sire_name or hh.name_latin = rr.sire_name)
    where h.father_id is null
  ) x`;
console.log('matchable (name match any):', m[0].n);
const desc = await sql`select description, length(description) l from horses where description is not null order by l desc limit 3`;
console.log('\ndescription samples:', desc.map(x=>x.description.slice(0,120)));
await sql.end();

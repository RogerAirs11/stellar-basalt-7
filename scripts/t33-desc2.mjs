import postgres from "postgres";
const sql = postgres(`postgresql://postgres.gqzglbknkodyasqfrqfv:${process.env.SUPA_PW}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require`,{max:5});
const sport = await sql`
  select h.id, h.name_latin, h.name_native, h.breed_desc, left(h.birth_date_value::text,4) yob,
    count(*) filter (where cr.placement = 1)::int wins,
    count(*) filter (where cr.placement <= 3)::int top3, count(*)::int starts
  from competition_results cr join horses h on h.id = cr.horse_id
  where h.profile_image_url is not null and h.description is null
  group by h.id, h.name_latin, h.name_native, h.breed_desc, yob
  order by wins desc`;
let n = 0;
for (const h of sport) {
  const name = h.name_latin || h.name_native || 'This horse';
  const bio = `${name} is a ${h.breed_desc || 'registered'}${h.yob ? `, born ${h.yob},` : ''} sport horse in the national registry with ${h.wins} wins and ${h.top3} top-three finishes across ${h.starts} recorded competition starts. Its results, pedigree and ownership history are documented on this page.`;
  await sql`update horses set description = ${bio} where id = ${h.id}`;
  n++;
}
const remaining = await sql`select count(*)::int n from horses where profile_image_url is not null and description is null`;
console.log('sport descriptions:', n, '| top-100 still without description:', remaining[0].n);
await sql.end();

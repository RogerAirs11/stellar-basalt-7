// Turn 33 gap fills (Supabase, additive only — never overwrites existing values):
// 1. death_date_value/precision/calendar from real 8-digit death_date (923 rows)
// 2. birth_city/birth_province parsed from birth_place_desc "City, CODE" (~58k rows)
// 3. descriptions for the top-100 photographed horses (biography from racing/breeding stats)
import postgres from "postgres";

const sql = postgres(`postgresql://postgres.gqzglbknkodyasqfrqfv:${process.env.SUPA_PW}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require`, { max: 5, idle_timeout: 5 });

const PROVINCES = {
  KZ: 'Khuzestan', YA: 'Yazd', GK: 'Golestan', TE: 'Tehran', AL: 'Alborz', KS: 'Kermanshah',
  ES: 'Isfahan', GO: 'Golestan', KE: 'Kerman', FA: 'Fars', KN: 'North Khorasan', AE: 'East Azerbaijan',
  KR: 'Razavi Khorasan', CM: 'Chaharmahal and Bakhtiari', HD: 'Hamadan', LO: 'Lorestan', MZ: 'Markazi',
  KD: 'Kurdistan', GL: 'Golestan', AW: 'West Azerbaijan', AR: 'Ardabil', QZ: 'Qazvin', ZA: 'Zanjan',
  QM: 'Qom', SM: 'Semnan', BH: 'Bushehr', IL: 'Ilam', Ho: 'Hormozgan', HO: 'Hormozgan',
  KB: 'Kohgiluyeh and Boyer-Ahmad', MA: 'Mazandaran', SN: 'Semnan',
};

// 1. death dates
const r1 = await sql`
  update horses set death_date_value = death_date, death_date_precision = 'day', death_date_calendar = 'gregorian'
  where death_date ~ '^[0-9]{8}$' and death_date_value is null`;
console.log('death_date_value filled:', r1.count);

// 2. birth city/province
const rows = await sql`
  select id, split_part(trim(birth_place_desc), ',', 1) city, split_part(trim(birth_place_desc), ',', 2) code
  from horses
  where birth_place_desc is not null and birth_place_desc not in ('-----', '')
    and birth_place_desc like '%,%' and birth_city is null`;
let filled = 0;
const chunk = [];
for (const r of rows) {
  const prov = PROVINCES[r.code?.trim()];
  if (!prov || !r.city) continue;
  chunk.push({ id: r.id, city: r.city.trim(), prov });
  if (chunk.length === 500) {
    const res = await sql`
      update horses h set birth_city = c.city, birth_province = c.prov
      from unnest(${chunk.map(c => c.id)}::text[], ${chunk.map(c => c.city)}::text[], ${chunk.map(c => c.prov)}::text[]) as c(id, city, prov)
      where h.id::text = c.id and h.birth_city is null`;
    filled += res.count; chunk.length = 0;
  }
}
if (chunk.length) {
  const res = await sql`
    update horses h set birth_city = c.city, birth_province = c.prov
    from unnest(${chunk.map(c => c.id)}::text[], ${chunk.map(c => c.city)}::text[], ${chunk.map(c => c.prov)}::text[]) as c(id, city, prov)
    where h.id::text = c.id and h.birth_city is null`;
  filled += res.count;
}
console.log('birth_city/province filled:', filled);

// 3. descriptions for top-100
const top = await sql`
  select h.id, h.name_latin, h.name_native, h.breed_desc, left(h.birth_date_value::text, 4) yob, h.sex_desc, rs.win, rs.starts, rs.ior,
    (select count(*)::int from horses ch where ch.father_id = h.id) foals
  from horses h join horse_racing_stats rs on rs.registry_horse_id = h.id::text
  where h.profile_image_url is not null and h.description is null and rs.win > 0
  order by rs.win desc limit 60`;
const sires = await sql`
  select h.id, h.name_latin, h.name_native, h.breed_desc, left(h.birth_date_value::text, 4) yob, h.sex_desc,
    (select count(*)::int from horses ch where ch.father_id = h.id) foals
  from horses h
  where h.profile_image_url is not null and h.description is null
    and h.id in (select father_id from horses where father_id is not null)
  order by foals desc limit 40`;
let d = 0;
for (const h of [...top, ...sires]) {
  const name = h.name_latin || h.name_native || 'This horse';
  const parts = [];
  if (h.breed_desc) parts.push(h.breed_desc);
  if (h.yob) parts.push(`born ${h.yob}`);
  let bio = '';
  if (h.win > 0) {
    bio = `${name} is a ${parts.join(', ') || 'registered'} racehorse in the national registry with ${h.win} wins from ${h.starts} recorded starts${h.ior ? ` and a rating of ${h.ior}` : ''}. Its full racing record, pedigree and family links are documented on this page and updated as new results are published.`;
  } else if (h.foals >= 40) {
    bio = `${name} is a ${parts.join(', ') || 'registered'} breeding stallion with ${h.foals} registered foals in the national registry, making it one of the influential sire lines of the Iranian population. Its progeny, pedigree and registration history are documented on this page.`;
  } else {
    bio = `${name} is a ${parts.join(', ') || 'registered'} horse in the national registry. Its pedigree, registration history and related records are documented on this page.`;
  }
  const res = await sql`update horses set description = ${bio} where id = ${h.id} and description is null`;
  d += res.count;
}
console.log('descriptions written:', d);

// final counts
const c = await sql`select count(birth_city)::int bc, count(birth_province)::int bp, count(death_date_value)::int dd from horses`;
console.log('now filled — birth_city:', c[0].bc, 'birth_province:', c[0].bp, 'death_date_value:', c[0].dd);
await sql.end();

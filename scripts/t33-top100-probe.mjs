import postgres from "postgres";
const sql = postgres(`postgresql://postgres.gqzglbknkodyasqfrqfv:${process.env.SUPA_PW}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require`, { max: 8, idle_timeout: 5 });

const sires = await sql`
  select ch.father_id, h.name_latin, h.name_native, count(*)::int foals
  from horses ch join horses h on h.id = ch.father_id
  where ch.father_id is not null
  group by ch.father_id, h.name_latin, h.name_native having count(*) >= 40
  order by foals desc limit 50`;
console.log('=== TOP SIRES (>=40 foals) ===');
for (const s of sires) console.log(` ${s.father_id} ${s.name_latin||''} / ${s.name_native} ${s.foals} foals`);

const dams = await sql`
  select ch.mother_id, h.name_latin, h.name_native, count(*)::int foals
  from horses ch join horses h on h.id = ch.mother_id
  where ch.mother_id is not null
  group by ch.mother_id, h.name_latin, h.name_native having count(*) >= 25
  order by foals desc limit 30`;
console.log('\n=== TOP DAMS (>=25 foals) ===');
for (const s of dams) console.log(` ${s.mother_id} ${s.name_latin||''} / ${s.name_native} ${s.foals} foals`);

// sport: horses with most competition_results
const sport = await sql`
  select cr.horse_id, h.name_latin, h.name_native, count(*)::int starts,
         count(*) filter (where cr.placement = 1)::int wins,
         count(*) filter (where cr.placement <= 3)::int top3
  from competition_results cr join horses h on h.id = cr.horse_id
  group by cr.horse_id, h.name_latin, h.name_native
  order by wins desc, top3 desc limit 40`;
console.log('\n=== TOP SPORT HORSES (competition_results) ===');
for (const s of sport) console.log(` ${s.horse_id} ${s.name_latin||''} / ${s.name_native} w=${s.wins} top3=${s.top3} starts=${s.starts}`);

// show_scorecards horses by appearance
const show = await sql`
  select horse_slug, horse_name, count(*)::int n
  from show_scorecards where horse_slug is not null
  group by horse_slug, horse_name order by n desc limit 25`;
console.log('\n=== TOP SHOW HORSES (scorecards) ===');
for (const s of show) console.log(` ${s.horse_slug} ${s.horse_name} ${s.n}`);
await sql.end();

// Turn 33: wire top-100 horse photos + real race photos into DB & public/
import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, existsSync } from "node:fs";
import postgres from "postgres";

const sql = postgres(`postgresql://postgres.gqzglbknkodyasqfrqfv:${process.env.SUPA_PW}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require`, { max: 8, idle_timeout: 5 });

// ---------- 1. Copy assets into public/ ----------
mkdirSync('public/images/races', { recursive: true });
let copied = 0;
for (const f of readdirSync('scripts/gen-tmp/t33-out')) {
  copyFileSync(`scripts/gen-tmp/t33-out/${f}`, `public/images/races/${f}`); copied++;
}
for (const f of readdirSync('scripts/gen-tmp/t33-sq')) {
  copyFileSync(`scripts/gen-tmp/t33-sq/${f}`, `public/images/horses/${f}`); copied++;
}
for (const f of readdirSync('scripts/gen-tmp/t33-horses')) {
  copyFileSync(`scripts/gen-tmp/t33-horses/${f}`, `public/images/horses/${f}`); copied++;
}
console.log('assets copied:', copied);

// ---------- 2. Build top-100 list ----------
const racing = await sql`
  select h.id, h.name_latin, h.name_native, h.breed_desc, h.sex_code, rs.win, rs.starts, h.profile_image_url
  from horse_racing_stats rs join horses h on h.id = rs.registry_horse_id::bigint
  where rs.win is not null and rs.win > 0 and rs.registry_horse_id ~ '^[0-9]+$'
  order by rs.win desc, rs.starts desc nulls last limit 60`;
console.log('racing candidates:', racing.length, '(already pictured:', racing.filter(r => r.profile_image_url).length + ')');

const racingIds = new Set(racing.map(r => r.id));
const sires = (await sql`
  select ch.father_id id, h.name_latin, h.name_native, h.breed_desc, count(*)::int foals
  from horses ch join horses h on h.id = ch.father_id
  where ch.father_id is not null
  group by ch.father_id, h.name_latin, h.name_native, h.breed_desc having count(*) >= 40
  order by foals desc limit 30`).filter(s => !racingIds.has(s.id));
console.log('sire candidates (excluding racing):', sires.length);

const sireIds = new Set(sires.map(s => s.id));
const sport = (await sql`
  select cr.horse_id id, h.name_latin, h.name_native, h.breed_desc,
         count(*) filter (where cr.placement = 1)::int wins,
         count(*) filter (where cr.placement <= 3)::int top3
  from competition_results cr join horses h on h.id = cr.horse_id
  group by cr.horse_id, h.name_latin, h.name_native, h.breed_desc
  order by wins desc, top3 desc limit 20`).filter(s => !racingIds.has(s.id) && !sireIds.has(s.id));
console.log('sport candidates (excluding above):', sport.length);

const top100 = [
  ...racing.map(r => ({ ...r, cat: 'racing', rank: r.win, sub: `${r.win} wins / ${r.starts} starts` })),
  ...sires.slice(0, 30).map(s => ({ ...s, cat: 'sire', rank: s.foals, sub: `${s.foals} registered foals` })),
  ...sport.slice(0, Math.max(0, 100 - racing.length - Math.min(30, sires.length))).map(s => ({ ...s, cat: 'sport', rank: s.wins, sub: `${s.wins} wins / ${s.top3} top-3` })),
].slice(0, 100);
console.log('TOP-100 total:', top100.length, '| racing:', top100.filter(t => t.cat === 'racing').length, 'sires:', top100.filter(t => t.cat === 'sire').length, 'sport:', top100.filter(t => t.cat === 'sport').length);

// ---------- 3. Assign portraits ----------
// pools of square portraits
const sqRace = readdirSync('scripts/gen-tmp/t33-sq').filter(f => f.startsWith('sq-') && (f.includes('img-') || f.includes('yt-'))).sort();
const sqRaceNamed = sqRace; // already unique
const sqWeb = readdirSync('scripts/gen-tmp/t33-horses').filter(f => f.startsWith('horse-web-')).sort();
const existing = readdirSync('public/images/horses').filter(f => /^(arabian|caspian|kurdish|racing|turkoman)-\d+\.webp$/.test(f));

// For racing champions: use existing pool photos for first 15 (turn32 did that) — actually overwrite all 100 fresh for consistency:
let raceIdx = 0, webIdx = 0;
const usedSire = new Set();
const assignments = [];
for (const h of top100) {
  if (h.cat === 'racing') {
    // rotate through square race portraits
    const f = sqRace[raceIdx % sqRace.length]; raceIdx++;
    const descMatch = f.startsWith('sq-yt') ? 'Race video frame' : 'Race-day photograph';
    const srcName = f.replace('sq-', '').replace('.webp', '');
    assignments.push({ ...h, file: f, url: `/images/horses/${f}`, credit: `${descMatch} (asbdavani.app blog) — representative of the horse's racing career, not a passport photo` });
  } else if (h.cat === 'sire') {
    const f = sqWeb[webIdx % sqWeb.length]; webIdx++;
    assignments.push({ ...h, file: f, url: `/images/horses/${f}`, credit: `Representative stallion portrait (web source) — not the horse's passport photo` });
  } else {
    const f = sqWeb[webIdx % sqWeb.length]; webIdx++;
    assignments.push({ ...h, file: f, url: `/images/horses/${f}`, credit: `Representative sport-horse portrait (web source) — not the horse's passport photo` });
  }
}

// ---------- 4. Write DB ----------
const webBase = 'https://iraho.ir';
let updated = 0;
for (const a of assignments) {
  await sql`
    update horses set profile_image_url = ${a.url}, profile_image_credit = ${a.credit}
    where id = ${a.id}`;
  updated++;
}
console.log('horses updated:', updated);

// ---------- 5. Competitions: real race photos for racing events ----------
const racePhotos = readdirSync('public/images/races').filter(f => f.startsWith('race-') || f.startsWith('web-')).sort();
const compRacing = await sql`select id, name_latin, discipline, image_url, image_credit from competitions where discipline = 'racing'`;
console.log('racing competitions:', compRacing.length);
let ci = 0;
for (const c of compRacing) {
  const f = racePhotos[(ci * 3) % racePhotos.length]; ci++;
  await sql`
    update competitions set image_url = ${'/images/races/' + f},
      image_credit = ${'Race-day photograph from the Iranian racing calendar (asbdavani.app blog) — representative image'}
    where id = ${c.id}`;
}
console.log('racing competitions illustrated with real photos:', ci);

// sport competitions: assign new web jumping/dressage photos
const webLandscape = racePhotos.filter(f => f.startsWith('web-'));
const compSport = await sql`select id from competitions where lower(discipline) not like '%racing%' and lower(discipline) not like '%race%'`;
let si = 0;
for (const c of compSport) {
  const f = webLandscape[(si * 2) % webLandscape.length]; si++;
  await sql`update competitions set image_url = ${'/images/races/' + f},
    image_credit = ${'Representative competition photograph (web source)'} where id = ${c.id}`;
}
console.log('sport competitions refreshed:', si);

// ---------- 6. Save mapping ----------
writeFileSync('scripts/t33-top100-assignments.json', JSON.stringify(assignments.map(a => ({ id: a.id, name: a.name_latin || a.name_native, cat: a.cat, file: a.file, url: a.url })), null, 1));
await sql.end();
console.log('DONE');

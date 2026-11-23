// Fix bad portrait assignments: crop sport squares from web landscapes, replace specific horses
import { readFileSync, writeFileSync, readdirSync, mkdirSync, copyFileSync } from "node:fs";
import sharp from "sharp";
import postgres from "postgres";

const sql = postgres(`postgresql://postgres.gqzglbknkodyasqfrqfv:${process.env.SUPA_PW}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require`, { max: 5, idle_timeout: 5 });

// 1. Square crops from good sport/discipline web landscapes
const SPORT_CROPS = [41, 44, 45, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 61, 62, 63, 65, 68, 70, 71, 72, 10, 36, 14, 9, 13, 39, 16, 20, 21, 23, 30, 32, 33, 34, 35, 40, 42, 60, 64, 69, 79];
mkdirSync('scripts/gen-tmp/t33-sport-sq', { recursive: true });
const sportSq = [];
for (const i of SPORT_CROPS) {
  const safe = `web-${String(i).padStart(3, '0')}`;
  const src = `scripts/gen-tmp/t33-web/${safe}.bin`;
  let out;
  for (const [w, q] of [[640, 70], [560, 68], [500, 64], [460, 60]]) {
    out = await sharp(src).resize(w, w, { fit: 'cover', position: 'attention' }).webp({ quality: q }).toBuffer();
    if (out.length <= 50 * 1024) break;
  }
  const name = `sport-sq-${safe}.webp`;
  writeFileSync(`scripts/gen-tmp/t33-sport-sq/${name}`, out);
  if (out.length <= 50 * 1024) sportSq.push(name); else console.log('SKIP too big', name, out.length);
}
console.log('sport squares made:', sportSq.length);

// 2. Replacement plan: horse id -> new file
const all = JSON.parse(readFileSync('scripts/t33-top100-assignments.json', 'utf8'));
const byIdx = (idx) => all[idx];
// racing fixes (idx in top100 array)
const racingRepl = { 9: null, 35: null, 56: null, 57: null, 58: null, 59: null };
// pool of unused race squares: sqRace has 96 files; racing used indexes 0..59 by rotation. Find unused:
const used = new Set(all.map(a => a.file));
const raceSqAll = readdirSync('scripts/gen-tmp/t33-sq').filter(f => f.startsWith('sq-') && !used.has(f)).sort();
console.log('unused race squares:', raceSqAll.length);
let ri = 0;
for (const idx of Object.keys(racingRepl)) {
  const repl = raceSqAll[ri++] || sportSq[ri % sportSq.length];
  racingRepl[idx] = repl;
}
// sire/sport fixes
const sireRepl = { 63: 'sport-sq-web-016.webp', 66: 'sport-sq-web-060.webp', 69: 'sport-sq-web-030.webp', 74: 'sport-sq-web-032.webp', 75: 'sport-sq-web-033.webp', 76: 'sport-sq-web-039.webp', 77: 'sport-sq-web-042.webp', 85: 'sport-sq-web-060.webp', 88: 'sport-sq-web-030.webp', 89: 'sport-sq-web-064.webp', 93: 'sport-sq-web-053.webp', 94: 'sport-sq-web-056.webp', 95: 'sport-sq-web-055.webp', 96: 'sport-sq-web-041.webp' };
// dedupe duplicates in sire assignments (same file twice) — replace second occurrences
const seen = new Set();
const dupFix = [];
for (let i = 0; i < all.length; i++) {
  const a = all[i];
  if (racingRepl[i] !== undefined || sireRepl[i] !== undefined) continue;
  if (a.cat !== 'racing') {
    if (seen.has(a.file)) dupFix.push(i); else seen.add(a.file);
  } else seen.add(a.file);
}
console.log('dup indexes to fix:', dupFix);
let di = 0;
const allRepl = {};
for (const [idx, f] of Object.entries(racingRepl)) allRepl[idx] = f;
for (const [idx, f] of Object.entries(sireRepl)) allRepl[idx] = f;
for (const idx of dupFix) {
  allRepl[idx] = sportSq[(30 + di * 7) % sportSq.length] || raceSqAll[ri++];
  di++;
}
// copy replacements into public
mkdirSync("public/images/horses", { recursive: true });
for (const [idx, f] of Object.entries(allRepl)) {
  if (!f) continue;
  const src = f.startsWith('sport-sq-') ? `scripts/gen-tmp/t33-sport-sq/${f}` : `scripts/gen-tmp/t33-sq/${f}`;
  copyFileSync(src, `public/images/horses/${f}`);
  const a = byIdx(+idx);
  const credit = a.cat === 'racing'
    ? 'Race-day photograph (asbdavani.app blog) — representative of the horse\'s racing career, not a passport photo'
    : 'Representative portrait (web source) — not the horse\'s passport photo';
  await sql`update horses set profile_image_url = ${'/images/horses/' + f}, profile_image_credit = ${credit} where id = ${a.id}`;
  a.file = f; a.url = '/images/horses/' + f;
  console.log(idx, (a.name || '').slice(0, 24), '->', f);
}
writeFileSync('scripts/t33-top100-assignments.json', JSON.stringify(all, null, 1));
// final duplicate check
const final = JSON.parse(readFileSync('scripts/t33-top100-assignments.json', 'utf8'));
const fc = {};
for (const a of final) fc[a.file] = (fc[a.file] || 0) + 1;
console.log('files used more than twice:', Object.entries(fc).filter(([f, n]) => n > 2).map(([f, n]) => f + ':' + n).join(', ') || 'none');
await sql.end();
console.log('DONE');

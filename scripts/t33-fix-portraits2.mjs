// Correct fix: map SHEET indexes (visual review) -> actual safe filenames
import { readFileSync, writeFileSync, readdirSync, mkdirSync, copyFileSync } from "node:fs";
import sharp from "sharp";
import postgres from "postgres";

const sql = postgres(`postgresql://postgres.gqzglbknkodyasqfrqfv:${process.env.SUPA_PW}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require`, { max: 5, idle_timeout: 5 });
const ok = JSON.parse(readFileSync('scripts/t33-web-results.json', 'utf8')).filter(r => r.status === 'ok');

// Good sheet indexes (from visual review of wsheet-*.jpg)
const GOOD_SHEET = [0, 4, 5, 6, 8, 9, 10, 11, 13, 14, 15, 16, 17, 18, 19, 20, 21, 23, 25, 29, 30, 31, 32, 33, 34, 35, 36, 37, 39, 40, 41, 42, 44, 45, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 60, 61, 62, 63, 64, 65, 66, 68, 69, 70, 71, 72, 74, 78, 79];
const sheetToFile = new Map();
for (let s = 0; s < ok.length; s++) sheetToFile.set(s, ok[s].safe);
console.log('sheet->file sample:', [...sheetToFile.entries()].slice(0, 5));

// Which sheet indexes are portrait-worthy (jumping/dressage/chogan/confirmation)
const PORTRAIT_SHEET = [41, 44, 45, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 61, 62, 63, 65, 68, 70, 71, 72, 10, 36, 14, 9, 13, 39, 16, 20, 21, 23, 30, 32, 33, 34, 35, 40, 42, 60, 64, 69, 79, 0, 15, 17, 19, 25, 29, 31, 37];
mkdirSync('scripts/gen-tmp/t33-sport-sq', { recursive: true });
const sportSq = [];
for (const s of PORTRAIT_SHEET) {
  const safe = sheetToFile.get(s);
  if (!safe) continue;
  const src = `scripts/gen-tmp/t33-web/${safe}.bin`;
  let out;
  for (const [w, q] of [[640, 70], [560, 68], [500, 64], [460, 60]]) {
    out = await sharp(src).resize(w, w, { fit: 'cover', position: 'attention' }).webp({ quality: q }).toBuffer();
    if (out.length <= 50 * 1024) break;
  }
  if (out.length > 50 * 1024) { console.log('skip', safe); continue; }
  const name = `sp2-${safe}.webp`;
  writeFileSync(`scripts/gen-tmp/t33-sport-sq/${name}`, out);
  sportSq.push(name);
}
console.log('sport squares v2:', sportSq.length);

const all = JSON.parse(readFileSync('scripts/t33-top100-assignments.json', 'utf8'));
// Bad assignments to replace: file contains watermark sources or dup/bad visuals
// Identify by current file name patterns from previous bad fix pass + original web ones
const BAD_FILES = new Set(['sport-sq-web-016.webp','sport-sq-web-060.webp','sport-sq-web-030.webp','sport-sq-web-032.webp','sport-sq-web-033.webp','sport-sq-web-039.webp','sport-sq-web-042.webp','sport-sq-web-021.webp','sport-sq-web-040.webp','sport-sq-web-044.webp','sport-sq-web-052.webp','sport-sq-web-062.webp','sport-sq-web-010.webp','sport-sq-web-020.webp','sport-sq-web-064.webp','sport-sq-web-035.webp','sport-sq-web-041.webp','sport-sq-web-053.webp','sport-sq-web-056.webp','sport-sq-web-055.webp','sport-sq-web-061.webp','sport-sq-web-072.webp','horse-web-web-017.webp','horse-web-web-019.webp']);
// also horse-web-* originals (18 Arab championship text, 43 watermark, 46 art) and any 'web-0NN' referenced wrongly
const alsoBad = ['horse-web-web-003.webp','horse-web-web-007.webp','horse-web-web-012.webp','horse-web-web-018.webp','horse-web-web-022.webp','horse-web-web-024.webp','horse-web-web-026.webp','horse-web-web-027.webp','horse-web-web-028.webp','horse-web-web-033.webp','horse-web-web-038.webp','horse-web-web-043.webp','horse-web-web-046.webp','horse-web-web-053.webp','horse-web-web-059.webp','horse-web-web-066.webp','horse-web-web-067.webp','horse-web-web-073.webp','horse-web-web-075.webp','horse-web-web-076.webp','horse-web-web-077.webp','horse-web-web-078.webp','horse-web-web-079.webp'];
for (const f of alsoBad) BAD_FILES.add(f);

let si = 0;
const replaced = [];
for (let i = 0; i < all.length; i++) {
  const a = all[i];
  if (a.cat === 'racing') continue; // racing assignments verified good in qa-0
  if (BAD_FILES.has(a.file)) {
    const f = sportSq[si % sportSq.length]; si++;
    copyFileSync(`scripts/gen-tmp/t33-sport-sq/${f}`, `public/images/horses/${f}`);
    await sql`update horses set profile_image_url = ${'/images/horses/' + f} where id = ${a.id}`;
    a.file = f; a.url = '/images/horses/' + f;
    replaced.push(`${i} ${(a.name || '').slice(0, 22)} -> ${f}`);
  }
}
console.log('replaced:', replaced.length);
for (const r of replaced) console.log(' ', r);
// dedupe check
const fc = {};
for (const a of all) fc[a.file] = (fc[a.file] || 0) + 1;
console.log('dups >1 among non-racing:', Object.entries(fc).filter(([f, n]) => n > 1 && !f.startsWith('sq-')).map(([f, n]) => f + ':' + n).join(', ') || 'none');
writeFileSync('scripts/t33-top100-assignments.json', JSON.stringify(all, null, 1));
await sql.end();
console.log('DONE');

import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import postgres from "postgres";
const sql = postgres(`postgresql://postgres.gqzglbknkodyasqfrqfv:${process.env.SUPA_PW}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require`, { max: 5, idle_timeout: 5 });
const all = JSON.parse(readFileSync('scripts/t33-top100-assignments.json', 'utf8'));
// hand-picked from unused sheet: real racing content
const PICK = ['sq-img-1378.webp', 'sq-yt-37.webp', 'sq-yt-26.webp', 'sq-yt-17.webp', 'sq-yt-24.webp', 'sq-yt-39.webp'];
const FIX = [9, 35, 56, 57, 58, 59];
let i = 0;
for (const idx of FIX) {
  const a = all[idx];
  const f = PICK[i++];
  copyFileSync(`scripts/gen-tmp/t33-sq/${f}`, `public/images/horses/${f}`);
  await sql`update horses set profile_image_url = ${'/images/horses/' + f} where id = ${a.id}`;
  console.log(idx, (a.name || '').slice(0, 20), '->', f);
  a.file = f; a.url = '/images/horses/' + f;
}
writeFileSync('scripts/t33-top100-assignments.json', JSON.stringify(all, null, 1));
const fc = {};
for (const a of all) fc[a.file] = (fc[a.file] || 0) + 1;
console.log('dups:', Object.entries(fc).filter(([f, n]) => n > 1).map(([f, n]) => f + ':' + n).join(', ') || 'none');
await sql.end();

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const all = JSON.parse(readFileSync('scripts/t33-asbdavani-photos.json', 'utf8'));
mkdirSync('scripts/gen-tmp/t33-samples', { recursive: true });
// download samples from different post types: race results posts (tlaayh/thsbtnm), breed articles (nilay), etc.
const picks = [
  all.find(r => r.title.includes('تاییدیه') || r.title.includes('thbtnm')),
  all.find(r => r.title.includes('نیلای') || r.slug.includes('nilay')),
  all.find(r => r.title.includes('گنبد') || r.title.includes('گنبدکاووس')),
  all.find(r => r.title.includes('میلوز') || r.title.includes('مسابقه')),
  all.find(r => r.img.includes('photo_2024')),
  all.find(r => r.img.includes('photo_2025')),
];
for (const f of picks.filter(Boolean)) {
  try {
    const r = await fetch(f.img, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) { console.log('FAIL', r.status, f.title.slice(0, 40)); continue; }
    const buf = Buffer.from(await r.arrayBuffer());
    const name = 's-' + f.img.split('/').pop().replace(/[^a-zA-Z0-9._-]/g, '').slice(-30);
    writeFileSync(`scripts/gen-tmp/t33-samples/${name}`, buf);
    console.log('OK', buf.length, 'B', name, '<-', f.title.slice(0, 55));
  } catch (e) { console.log('ERR', e.message.slice(0, 60)); }
}

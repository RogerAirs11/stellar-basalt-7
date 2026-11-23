import { readFileSync, mkdirSync } from "node:fs";
const all = JSON.parse(readFileSync('scripts/t33-asbdavani-photos.json', 'utf8'));
console.log('total:', all.length);
// first image per post = feature image
const bySlug = new Map();
for (const r of all) if (!bySlug.has(r.slug)) bySlug.set(r.slug, r);
const features = [...bySlug.values()];
console.log('unique posts w/ images:', features.length);
mkdirSync('scripts/gen-tmp/t33-samples', { recursive: true });
// download 6 samples
for (const f of features.slice(0, 6)) {
  const r = await fetch(f.img, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (r.ok) {
    const buf = Buffer.from(await r.arrayBuffer());
    const name = f.img.split('/').pop().slice(0, 40);
    writeFileSync(`scripts/gen-tmp/t33-samples/${name}`, buf);
    console.log('OK', r.status, buf.length, 'B', name, '<-', f.title.slice(0, 50));
  } else console.log('FAIL', r.status, f.img.slice(0, 60));
}
import { writeFileSync } from "node:fs";

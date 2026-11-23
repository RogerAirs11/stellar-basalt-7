// Crop square 640x640 horse portraits from real race photos + yt thumbs
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import sharp from "sharp";

mkdirSync('scripts/gen-tmp/t33-sq', { recursive: true });

// race photos (curated real)
const rm = JSON.parse(readFileSync('scripts/t33-real-photos-manifest.json', 'utf8')).filter(m => !m.hist);
const yt = readdirSync('scripts/gen-tmp/t33-out').filter(f => f.startsWith('yt-'));
let n = 0;
const manifest = [];
for (const m of rm) {
  const src = m.file; // webp already <=50KB
  let out;
  for (const [w, q] of [[640, 70], [560, 68], [500, 64]]) {
    out = await sharp(src).resize(w, w, { fit: 'cover', position: 'attention' }).webp({ quality: q }).toBuffer();
    if (out.length <= 50 * 1024) break;
  }
  const name = `sq-${m.name.replace('race-', '').replace('.webp', '')}.webp`;
  writeFileSync(`scripts/gen-tmp/t33-sq/${name}`, out);
  manifest.push({ name, kb: +(out.length / 1024).toFixed(1), from: m.name, desc: 'Race-day photo, asbdavani.app blog' });
  n++;
}
for (const f of yt) {
  const src = `scripts/gen-tmp/t33-out/${f}`;
  let out;
  for (const [w, q] of [[640, 70], [560, 68], [500, 64]]) {
    out = await sharp(src).resize(w, w, { fit: 'cover', position: 'attention' }).webp({ quality: q }).toBuffer();
    if (out.length <= 50 * 1024) break;
  }
  const name = `sq-${f.replace('.webp', '')}.webp`;
  writeFileSync(`scripts/gen-tmp/t33-sq/${name}`, out);
  manifest.push({ name, kb: +(out.length / 1024).toFixed(1), from: f, desc: 'Race video frame, asbdavani YouTube' });
  n++;
}
writeFileSync('scripts/t33-sq-manifest.json', JSON.stringify(manifest, null, 1));
console.log('square portraits:', n, '| max KB:', Math.max(...manifest.map(m => m.kb)));

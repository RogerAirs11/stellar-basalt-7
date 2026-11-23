// Build curated list of verified real photos -> convert to <=50KB webp
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import sharp from "sharp";

const raw = JSON.parse(readFileSync('scripts/t33-raw-stats.json', 'utf8'));
const ok = raw.filter(x => x.status === 'ok');
ok.forEach((x, i) => x.id = i);
const cand = ok.filter(x => x.w >= 700 && x.std >= 35).sort((a, b) => b.std - a.std);

// Verified real photos from visual review (montage numbers)
const GOOD = [4,5,6,7,9,10,17,20,26,27,30,31,32,36,37,46,47,48,49,51,55,56,57,58,
  62,63,64,65,66,70,71,72,73,75,81,82,83,84,86,91,95,96,105,106,107,115,
  123,130,131,141,155,156,164,165,166,168,169,179,
  180,187,197,199,200,206,207,211,212,218,219,233,
  254,256,257,472];

// historical/painting special ones
const HISTORICAL = new Set([212, 256, 257]);

// dedupe by base image name (strip /size/wNNN variants), prefer largest bytes
const byBase = new Map();
for (const n of GOOD) {
  const c = cand[n];
  if (!c) { console.log('MISSING', n); continue; }
  const base = c.img.replace(/\/size\/w\d+\//, '/');
  const prev = byBase.get(base);
  if (!prev || c.bytes > prev.bytes) byBase.set(base, { ...c, hist: HISTORICAL.has(n) });
}
const picked = [...byBase.values()];
console.log('picked unique real photos:', picked.length);

mkdirSync('scripts/gen-tmp/t33-out', { recursive: true });
const manifest = [];
for (const p of picked) {
  const src = `scripts/gen-tmp/t33-raw/${p.safe}.bin`;
  const name = `race-${p.safe}.webp`;
  const dst = `scripts/gen-tmp/t33-out/${name}`;
  // target: quality+width loop until <=50KB
  let buf;
  outer: for (const width of [1280, 1100, 1000, 900, 820, 740, 660]) {
    for (let quality = 74; quality >= 30; quality -= 5) {
      buf = await sharp(src).resize({ width, withoutEnlargement: true }).webp({ quality }).toBuffer();
      if (buf.length <= 50 * 1024) break outer;
    }
  }
  writeFileSync(dst, buf);
  manifest.push({ file: dst, name, kb: +(buf.length / 1024).toFixed(1), w: (await sharp(buf).metadata()).width, title: p.title, src: p.img, hist: p.hist });
}
writeFileSync('scripts/t33-real-photos-manifest.json', JSON.stringify(manifest, null, 1));
console.log('converted:', manifest.length, '| max KB:', Math.max(...manifest.map(m => m.kb)), '| total KB:', Math.round(manifest.reduce((a, m) => a + m.kb, 0)));

// Fetch asbdavani YouTube video thumbnails (real race video frames) — 2 pages
import { writeFileSync, mkdirSync } from "node:fs";
import sharp from "sharp";
mkdirSync('scripts/gen-tmp/t33-out', { recursive: true });

const ids = new Set();
let url = 'https://www.youtube.com/@asbdavani_app/videos';
for (let page = 0; page < 3 && url; page++) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36', 'Accept-Language': 'en' } });
  const t = await r.text();
  for (const m of t.matchAll(/"videoId":"([\w-]{11})"/g)) ids.add(m[1]);
  // continuation pages are not followed (single page is enough for thumbnails)
  break;
}
// supplement with search results
const sr = await fetch('https://www.youtube.com/results?search_query=%D8%A7%D8%B3%D8%A8%D8%AF%D9%88%D8%A7%D9%86%DB%8C', { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36' } });
const st = await sr.text();
for (const m of st.matchAll(/"videoId":"([\w-]{11})"/g)) ids.add(m[1]);
console.log('video ids:', ids.size);
const list = [...ids];
let ok = 0;
for (let i = 0; i < list.length && ok < 40; i++) {
  try {
    const r = await fetch(`https://i.ytimg.com/vi/${list[i]}/maxresdefault.jpg`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) continue;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 5000) continue; // placeholder
    const webp = await sharp(buf).resize({ width: 1280, withoutEnlargement: true }).webp({ quality: 70 });
    let out = await webp.toBuffer();
    let q = 62;
    while (out.length > 50 * 1024 && q >= 30) { out = await sharp(buf).resize({ width: 1100, withoutEnlargement: true }).webp({ quality: q }).toBuffer(); q -= 6; }
    if (out.length > 50 * 1024) continue;
    writeFileSync(`scripts/gen-tmp/t33-out/yt-${String(ok).padStart(2, '0')}.webp`, out);
    ok++;
  } catch { }
}
console.log('yt thumbs saved:', ok);

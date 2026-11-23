// Harvest REAL race photos from blog.asbdavani.app posts (166 posts in sitemap)
import { writeFileSync } from "node:fs";

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };

const s = await fetch('https://blog.asbdavani.app/sitemap-posts.xml', { headers: UA });
const st = await s.text();
const posts = [...st.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]).filter(u => u.includes('sitemap') === false);
console.log('posts:', posts.length);

const found = []; // {img, slug, title}
for (let i = 0; i < posts.length; i++) {
  const u = posts[i];
  try {
    const r = await fetch(u, { headers: UA });
    if (!r.ok) { await sleep(100); continue; }
    const t = await r.text();
    const title = t.match(/<title>([^<]+)</)?.[1]?.replace(/\s*\|\s*ASBDAVANI/, '') || u;
    const slug = u.replace('https://blog.asbdavani.app/', '').replace(/\/$/, '');
    const imgs = [...new Set([...t.matchAll(/(https:\/\/blog\.asbdavani\.app\/content\/images\/[^"'\s)\\]+?\.(?:jpg|jpeg|png|webp))/g)].map(m => m[1]))];
    for (const img of imgs) found.push({ img, slug, title });
    if (i % 25 === 0) console.log(i, 'done, imgs so far:', found.length);
  } catch { }
  await sleep(120);
}
console.log('TOTAL images found:', found.length);
writeFileSync('/home/z/my-project/repo/scripts/t33-asbdavani-photos.json', JSON.stringify(found, null, 1));
console.log('saved');

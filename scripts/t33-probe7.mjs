const s = await fetch('https://blog.asbdavani.app/sitemap-posts.xml', { headers: { 'User-Agent': 'Mozilla/5.0' } });
const st = await s.text();
const locs = [...st.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
console.log('sitemap-posts locs:', locs.length);
console.log(locs.slice(0, 10).join('\n'));
// try ghost content API with common public key in page source
const p = await fetch('https://blog.asbdavani.app/', { headers: { 'User-Agent': 'Mozilla/5.0' } });
const pt = await p.text();
const key = pt.match(/content_api_key["':\s]+([a-f0-9]+)/);
console.log('ghost key found:', key?.[1] || 'none');
console.log('blog page len:', pt.length, 'title:', pt.match(/<title>([^<]*)/)?.[1]);

// asbdavani blog is Ghost — try Ghost API endpoints; also scrape many asbdavani news pages for blog images
const r = await fetch('https://blog.asbdavani.app/ghost/api/v3/content/posts/?key=b7c78d7d9cf13ee4a9f7a&limit=50', { headers: { 'User-Agent': 'Mozilla/5.0' } });
console.log('ghost v3:', r.status);
if (r.ok) { const j = await r.json(); console.log('posts:', j.posts?.length); }
// try sitemap
const s = await fetch('https://blog.asbdavani.app/sitemap.xml', { headers: { 'User-Agent': 'Mozilla/5.0' } });
const st = await s.text();
console.log('sitemap:', s.status, st.slice(0, 400));

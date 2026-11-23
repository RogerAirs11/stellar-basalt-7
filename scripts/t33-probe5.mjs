// Enumerate blog.asbdavani.app posts
for (const u of ['https://blog.asbdavani.app/', 'https://blog.asbdavani.app/page/2/']) {
  const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const t = await r.text();
  const imgs = [...new Set([...t.matchAll(/(?:src|href)="(https:\/\/blog\.asbdavani\.app\/content\/images\/[^"]+)"/g)].map(m => m[1]))];
  const posts = [...new Set([...t.matchAll(/href="(https:\/\/asbdavani\.app\/news\/[^"]+)"/g)].map(m => m[1]))];
  console.log('---', u, r.status, '| imgs:', imgs.length, '| posts:', posts.length);
  console.log(imgs.slice(0, 20).join('\n'));
}

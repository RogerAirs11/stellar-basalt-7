// Probe asbdavani.app structure for horse profile pages with photos
const horseId = 400921; // اوسین بولت - top racing horse
const urls = [
  `https://asbdavani.app/horse/${horseId}`,
  `https://asbdavani.app/horses/${horseId}`,
  `https://asbdavani.app/`,
];
for (const u of urls) {
  try {
    const r = await fetch(u, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
    const t = await r.text();
    console.log('---', u, '=>', r.status, 'len', t.length);
    const imgs = [...t.matchAll(/<img[^>]+src="([^"]+)"/g)].slice(0, 10).map(m => m[1]);
    console.log('  imgs:', imgs.join(' | ') || 'none');
    if (u === urls[2]) console.log(t.slice(0, 800));
  } catch (e) { console.log('---', u, 'ERR', e.message.slice(0, 100)); }
}

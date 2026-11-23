const urls = [
  'https://asbdavani.app/news/rys-pln-hfth-swm-t-hshtm-khwrs-pyyz-1405-yzd',
  'https://asbdavani.app/racecards/cmvh69uyp007amb01pjy6xk45?round=1',
  'https://asbdavani.app/performance/horses',
];
for (const u of urls) {
  try {
    const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const t = await r.text();
    const imgs = [...new Set([...t.matchAll(/<img[^>]+src="([^"]+)"/g)].map(m => m[1]))].filter(s => !s.includes('enamad'));
    console.log('---', u, r.status, 'imgs:', imgs.slice(0, 15).join(' | ') || 'none');
    // horse links?
    const hl = [...new Set([...t.matchAll(/href="(\/(?:horse|horses|performance)[^"]*)"/g)].map(m => m[1]))].slice(0,10);
    if (hl.length) console.log('  horse links:', hl.join(' | '));
  } catch (e) { console.log('---', u, 'ERR', e.message.slice(0,80)); }
}

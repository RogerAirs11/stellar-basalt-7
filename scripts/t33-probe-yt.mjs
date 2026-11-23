const r = await fetch('https://www.youtube.com/@asbdavani_app/videos', { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
const t = await r.text();
const ids = [...new Set([...t.matchAll(/"videoId":"([\w-]{11})"/g)].map(m => m[1]))];
console.log('videos:', ids.length);
console.log(ids.slice(0, 30).join('\n'));
// thumbnail test
if (ids[0]) {
  const th = await fetch(`https://i.ytimg.com/vi/${ids[0]}/maxresdefault.jpg`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  console.log('thumb test:', th.status, th.headers.get('content-type'), th.headers.get('content-length'), 'bytes');
}

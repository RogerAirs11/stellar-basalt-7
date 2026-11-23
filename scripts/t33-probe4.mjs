// Check individual horse pages for photos + the blog images (real race photos)
const u1 = 'https://asbdavani.app/performance/horses/cm11zmzhl003lmo01rgtcn1hh/info';
const r1 = await fetch(u1, { headers: { 'User-Agent': 'Mozilla/5.0' } });
const t1 = await r1.text();
console.log('horse page:', r1.status, 'len', t1.length);
const imgs1 = [...new Set([...t1.matchAll(/(?:img[^>]+src="|url\(&quot;|"image":")([^"]+)"/g)].map(m => m[1]))].slice(0,12);
console.log('imgs:', imgs1.join(' | '));
// look for horse name
const nameM = t1.match(/<title>([^<]+)<\/title>/);
console.log('title:', nameM?.[1]);

// blog image sample - real race photo?
const u2 = 'https://blog.asbdavani.app/content/images/2026/10/yazd3-8-1.jpg';
const r2 = await fetch(u2, { headers: { 'User-Agent': 'Mozilla/5.0' } });
console.log('\nblog img:', r2.status, r2.headers.get('content-type'), r2.headers.get('content-length'), 'bytes');

const r = await fetch('https://asbdavani.app/', { headers: { 'User-Agent': 'Mozilla/5.0' } });
const t = await r.text();
// find link hrefs
const hrefs = [...new Set([...t.matchAll(/href="([^"]+)"/g)].map(m => m[1]))].filter(h => !h.includes('_next') && !h.includes('enamad'));
console.log('hrefs:', hrefs.slice(0, 60).join('\n'));
// find any api mentions
const apis = [...new Set([...t.matchAll(/(?:api|service)[^"']*/gi)])].slice(0,10);
console.log('\napi-ish:', apis.join('\n').slice(0, 500));

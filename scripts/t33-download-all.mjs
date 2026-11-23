// Download all unique asbdavani blog images + compute stats for filtering
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import sharp from "sharp";

const all = JSON.parse(readFileSync('scripts/t33-asbdavani-photos.json', 'utf8'));
// unique by URL
const uniq = [...new Map(all.map(r => [r.img, r])).values()];
console.log('unique urls:', uniq.length);
mkdirSync('scripts/gen-tmp/t33-raw', { recursive: true });

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };
const results = [];
let done = 0;
const queue = uniq.map((item, idx) => ({ item, idx }));
const worker = async () => {
  while (queue.length) {
    const { item, idx } = queue.shift();
    const safe = `img-${String(idx).padStart(4, '0')}`;
    const path = `scripts/gen-tmp/t33-raw/${safe}.bin`;
    try {
      if (!existsSync(path)) {
        const r = await fetch(item.img, { headers: UA, signal: AbortSignal.timeout(20000) });
        if (!r.ok) { results.push({ ...item, safe, status: r.status }); continue; }
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length < 8000) { results.push({ ...item, safe, status: 'too-small' }); continue; }
        writeFileSync(path, buf);
      }
      const meta = await sharp(path).metadata();
      const stats = await sharp(path).stats();
      const { size: nbytes } = await import('node:fs').then(fs => fs.promises.stat(path));
      // entropy-ish: std dev of channels; documents/stamps = low std, high flat areas
      const stdMean = stats.channels.slice(0, 3).reduce((a, c) => a + c.stdev, 0) / 3;
      results.push({ ...item, safe, status: 'ok', w: meta.width, h: meta.height, std: Math.round(stdMean), bytes: nbytes });
    } catch (e) {
      results.push({ ...item, safe, status: 'err:' + e.message.slice(0, 30) });
    }
    done++;
    if (done % 150 === 0) console.log(done, '/', uniq.length);
  }
};
await Promise.all(Array.from({ length: 8 }, worker));
writeFileSync('scripts/t33-raw-stats.json', JSON.stringify(results, null, 1));
const ok = results.filter(r => r.status === 'ok');
console.log('downloaded ok:', ok.length, '| failed:', results.length - ok.length);

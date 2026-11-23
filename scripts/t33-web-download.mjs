// Download 80 search candidates + contact sheets
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const cand = JSON.parse(readFileSync('scripts/t33-search-candidates.json', 'utf8'));
mkdirSync('scripts/gen-tmp/t33-web', { recursive: true });

const results = [];
const queue = cand.map((c, i) => ({ ...c, i }));
const worker = async () => {
  while (queue.length) {
    const c = queue.shift();
    const safe = `web-${String(c.i).padStart(3, '0')}`;
    const path = `scripts/gen-tmp/t33-web/${safe}.bin`;
    try {
      const r = await fetch(c.url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120' }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) { results.push({ ...c, safe, status: r.status }); continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 15000) { results.push({ ...c, safe, status: 'small' }); continue; }
      writeFileSync(path, buf);
      const meta = await sharp(path).metadata();
      results.push({ ...c, safe, status: 'ok', w: meta.width, h: meta.height, bytes: buf.length });
    } catch (e) { results.push({ ...c, safe, status: 'err' }); }
  }
};
await Promise.all(Array.from({ length: 8 }, worker));
writeFileSync('scripts/t33-web-results.json', JSON.stringify(results, null, 1));
const ok = results.filter(r => r.status === 'ok');
console.log('ok:', ok.length, '/', results.length);

// contact sheets (12 per sheet, larger 240px thumbs for portrait judging)
mkdirSync('scripts/gen-tmp/t33-sheets-web', { recursive: true });
const PER = 12, COLS = 4, TW = 240, TH = 200;
for (let s = 0; s * PER < ok.length; s++) {
  const batch = ok.slice(s * PER, (s + 1) * PER);
  const rows = Math.ceil(batch.length / COLS);
  const comps = [];
  for (let i = 0; i < batch.length; i++) {
    const t = await sharp(`scripts/gen-tmp/t33-web/${batch[i].safe}.bin`).resize(TW, TH, { fit: 'cover' }).jpeg({ quality: 70 }).toBuffer();
    const label = Buffer.from(`<svg width="${TW}" height="24"><rect width="${TW}" height="24" fill="black" opacity="0.75"/><text x="6" y="18" font-size="16" fill="yellow" font-family="sans-serif">${s * PER + i}</text></svg>`);
    comps.push({ input: t, left: (i % COLS) * TW, top: Math.floor(i / COLS) * (TH + 24) });
    comps.push({ input: label, left: (i % COLS) * TW, top: Math.floor(i / COLS) * (TH + 24) });
  }
  await sharp({ create: { width: COLS * TW, height: rows * (TH + 24), channels: 3, background: '#222' } }).composite(comps).jpeg({ quality: 72 }).toFile(`scripts/gen-tmp/t33-sheets-web/wsheet-${s}.jpg`);
}
console.log('web sheets:', Math.ceil(ok.length / PER));

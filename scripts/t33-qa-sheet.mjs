// Contact sheet of assigned top-100 portraits for visual QA
import { readFileSync } from "node:fs";
import sharp from "sharp";

const a = JSON.parse(readFileSync('scripts/t33-top100-assignments.json', 'utf8'));
const PER = 60, COLS = 6, TW = 170, TH = 170;
for (let s = 0; s * PER < a.length; s++) {
  const batch = a.slice(s * PER, (s + 1) * PER);
  const rows = Math.ceil(batch.length / COLS);
  const comps = [];
  for (let i = 0; i < batch.length; i++) {
    const t = await sharp(`public/images/horses/${batch[i].file}`).resize(TW, TH, { fit: 'cover' }).jpeg({ quality: 65 }).toBuffer();
    const label = Buffer.from(`<svg width="${TW}" height="22"><rect width="${TW}" height="22" fill="black" opacity="0.8"/><text x="4" y="16" font-size="13" fill="yellow" font-family="sans-serif">${s * PER + i} ${batch[i].cat[0]}${(batch[i].name || '').slice(0, 14)}</text></svg>`);
    comps.push({ input: t, left: (i % COLS) * TW, top: Math.floor(i / COLS) * (TH + 22) });
    comps.push({ input: label, left: (i % COLS) * TW, top: Math.floor(i / COLS) * (TH + 22) });
  }
  await sharp({ create: { width: COLS * TW, height: rows * (TH + 22), channels: 3, background: '#111' } }).composite(comps).jpeg({ quality: 70 }).toFile(`scripts/gen-tmp/t33-qa-${s}.jpg`);
  console.log('qa sheet', s);
}

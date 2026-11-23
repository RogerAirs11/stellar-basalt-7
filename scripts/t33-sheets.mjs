// Build numbered contact sheets for visual inspection of the 477 candidates
import { readFileSync, mkdirSync } from "node:fs";
import sharp from "sharp";

const ok = JSON.parse(readFileSync('scripts/t33-raw-stats.json', 'utf8')).filter(x => x.status === 'ok');
const cand = ok.filter(x => x.w >= 700 && x.std >= 35).sort((a, b) => b.std - a.std);
mkdirSync('scripts/gen-tmp/t33-sheets', { recursive: true });

const PER_SHEET = 60, COLS = 6, TW = 200, TH = 133;
for (let sheet = 0; sheet * PER_SHEET < cand.length; sheet++) {
  const batch = cand.slice(sheet * PER_SHEET, (sheet + 1) * PER_SHEET);
  const rows = Math.ceil(batch.length / COLS);
  const composites = [];
  for (let i = 0; i < batch.length; i++) {
    const t = await sharp(`scripts/gen-tmp/t33-raw/${batch[i].safe}.bin`)
      .resize(TW, TH, { fit: 'cover' }).jpeg({ quality: 70 }).toBuffer();
    const num = String(batch[i].id).padStart(3, '0');
    const label = Buffer.from(`<svg width="${TW}" height="26"><rect width="${TW}" height="26" fill="black" opacity="0.75"/><text x="6" y="19" font-size="17" fill="yellow" font-family="sans-serif">${sheet * PER_SHEET + i}</text></svg>`);
    composites.push({ input: t, left: (i % COLS) * TW, top: Math.floor(i / COLS) * (TH + 26) });
    composites.push({ input: label, left: (i % COLS) * TW, top: Math.floor(i / COLS) * (TH + 26) });
  }
  await sharp({ create: { width: COLS * TW, height: rows * (TH + 26), channels: 3, background: '#222' } })
    .composite(composites).jpeg({ quality: 75 }).toFile(`scripts/gen-tmp/t33-sheets/sheet-${sheet}.jpg`);
  console.log('sheet', sheet, '->', batch.length, 'imgs');
}
console.log('TOTAL candidates:', cand.length);

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import sharp from "sharp";
const all = JSON.parse(readFileSync('scripts/t33-top100-assignments.json', 'utf8'));
const used = new Set(all.map(a => a.file));
const unused = readdirSync('scripts/gen-tmp/t33-sq').filter(f => !used.has(f)).sort();
console.log('unused:', unused.length);
const COLS = 6, TW = 190, TH = 190;
const comps = [];
for (let i = 0; i < unused.length; i++) {
  const t = await sharp(`scripts/gen-tmp/t33-sq/${unused[i]}`).resize(TW, TH).jpeg({ quality: 65 }).toBuffer();
  const label = Buffer.from(`<svg width="${TW}" height="22"><rect width="${TW}" height="22" fill="black" opacity="0.8"/><text x="4" y="16" font-size="13" fill="yellow" font-family="sans-serif">${i} ${unused[i].slice(3, 16)}</text></svg>`);
  comps.push({ input: t, left: (i % COLS) * TW, top: Math.floor(i / COLS) * (TH + 22) });
  comps.push({ input: label, left: (i % COLS) * TW, top: Math.floor(i / COLS) * (TH + 22) });
}
await sharp({ create: { width: COLS * TW, height: Math.ceil(unused.length / COLS) * (TH + 22), channels: 3, background: '#111' } }).composite(comps).jpeg({ quality: 70 }).toFile('scripts/gen-tmp/t33-unused.jpg');

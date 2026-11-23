// turn 32: enforce the <=50 kB rule on ALL existing webp assets
// recompress any public/images/**/webp larger than 50 kB (round-trip via sharp)
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

const ROOT = "/home/z/my-project/repo/public/images";
const LIMIT = 50 * 1024;
let scanned = 0, recompressed = 0;

async function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) { await walk(p); continue; }
    if (!entry.name.endsWith(".webp")) continue;
    scanned++;
    const stat = fs.statSync(p);
    if (stat.size <= LIMIT) continue;
    const buf = fs.readFileSync(p);
    let webp, done = false;
    for (let q = 62; q >= 26 && !done; q -= 6) {
      webp = await sharp(buf).webp({ quality: q }).toBuffer();
      if (webp.length <= LIMIT) done = true;
    }
    if (!done) { // last resort: downscale 25%
      const meta = await sharp(buf).metadata();
      webp = await sharp(buf).resize(Math.round(meta.width * 0.75)).webp({ quality: 30 }).toBuffer();
    }
    if (webp.length < stat.size) {
      fs.writeFileSync(p, webp);
      recompressed++;
      console.log(`${path.relative(ROOT, p)}: ${(stat.size / 1024).toFixed(0)} -> ${(webp.length / 1024).toFixed(1)} kB`);
    }
  }
}
await walk(ROOT);
console.log(`scanned ${scanned}, recompressed ${recompressed}`);

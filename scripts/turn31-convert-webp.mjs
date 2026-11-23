// turn 31: convert generated PNGs to webp < 100 kB in public/images/news
import sharp from "sharp";
import fs from "node:fs";

const TMP = "/home/z/my-project/scripts/gen-tmp";
const OUT = "/home/z/my-project/repo/public/images/news";
const SIZES = {
  cover: [1344, 768],
  art: [1152, 864],
  pool: [1152, 864],
};

for (const file of fs.readdirSync(TMP).filter(f => f.endsWith(".png"))) {
  const base = file.replace(".png", "");
  const [w, h] = SIZES[base.split("-")[0]] || SIZES.art;
  const out = `${OUT}/${base}.webp`;
  const buf = fs.readFileSync(`${TMP}/${file}`);
  let q = 78, webp;
  do {
    webp = await sharp(buf).resize(w, h, { fit: "cover" }).webp({ quality: q }).toBuffer();
    q -= 8;
  } while (webp.length > 100 * 1024 && q > 30);
  fs.writeFileSync(out, webp);
  console.log(`${base}.webp ${(webp.length / 1024).toFixed(1)} kB q${q + 8}`);
}
console.log("CONVERT DONE");

// turn 32: download searched photos, convert to webp <= 50 kB
// competitions -> public/images/competitions/ (wide 960x400)
// horses       -> public/images/horses/       (square 640x640)
import sharp from "sharp";
import fs from "node:fs";

const SEARCH = "/home/z/my-project/scripts/imgsearch";
const ROOT = "/home/z/my-project/repo/public/images";
const LIMIT = 50 * 1024;

const load = (f) => JSON.parse(fs.readFileSync(`${SEARCH}/${f}.json`, "utf8")).results;
const pick = (files, n) => files.flatMap(f => load(f).map(r => ({ url: r.original_url, source: r.source }))).slice(0, n);

async function toWebp(url, out, w, h) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  let q = 72, webp;
  do {
    webp = await sharp(buf).rotate().resize(w, h, { fit: "cover", position: "attention" }).webp({ quality: q }).toBuffer();
    q -= 7;
  } while (webp.length > LIMIT && q > 28);
  fs.writeFileSync(out, webp);
  return webp.length;
}

// ---------- competitions: 2 images per discipline ----------
const COMP_PLAN = [
  ["show_jumping", ["jumping"]],
  ["racing", ["racing", "racing2"]],
  ["halter", ["beauty"]],
  ["endurance", ["endurance"]],
  ["dressage", ["dressage"]],
  ["eventing", ["eventing"]],
];
fs.mkdirSync(`${ROOT}/competitions`, { recursive: true });
const creditManifest = {};
for (const [disc, files] of COMP_PLAN) {
  const imgs = pick(files, 2);
  for (let i = 0; i < imgs.length; i++) {
    const out = `${ROOT}/competitions/${disc}-${i}.webp`;
    if (fs.existsSync(out)) { console.log("skip", disc + "-" + i); continue; }
    try {
      const size = await toWebp(imgs[i].url, out, 960, 400);
      creditManifest[`/images/competitions/${disc}-${i}.webp`] = { source: imgs[i].source, query: files.join("+") };
      console.log(`${disc}-${i}.webp ${(size / 1024).toFixed(1)} kB  <- ${imgs[i].source}`);
    } catch (e) { console.log(`FAIL ${disc}-${i}: ${String(e.message).slice(0, 80)}`); }
  }
}

// ---------- horses: breed pools, square ----------
const HORSE_PLAN = [
  ["arabian", ["arabian", "beauty"], 8],
  ["turkoman", ["turkmen"], 4],
  ["racing", ["racing", "racing2"], 6],
  ["caspian", ["caspian"], 4],
  ["kurdish", ["kurdish"], 4],
];
fs.mkdirSync(`${ROOT}/horses`, { recursive: true });
for (const [pool, files, n] of HORSE_PLAN) {
  const imgs = pick(files, n);
  for (let i = 0; i < imgs.length; i++) {
    const out = `${ROOT}/horses/${pool}-${i}.webp`;
    if (fs.existsSync(out)) { console.log("skip", pool + "-" + i); continue; }
    try {
      const size = await toWebp(imgs[i].url, out, 640, 640);
      creditManifest[`/images/horses/${pool}-${i}.webp`] = { source: imgs[i].source, query: files.join("+") };
      console.log(`${pool}-${i}.webp ${(size / 1024).toFixed(1)} kB  <- ${imgs[i].source}`);
    } catch (e) { console.log(`FAIL ${pool}-${i}: ${String(e.message).slice(0, 80)}`); }
  }
}
fs.writeFileSync("/home/z/my-project/scripts/image-credits.json", JSON.stringify(creditManifest, null, 2));
console.log("DONE");

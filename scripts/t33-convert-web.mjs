// Convert selected web images: portraits -> horses/ (640x640), landscape -> races/
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import sharp from "sharp";

const res = JSON.parse(readFileSync('scripts/t33-web-results.json', 'utf8')).filter(r => r.status === 'ok');
const sel = new Set([0,1,4,5,6,8,9,10,11,13,14,15,16,17,18,19,20,21,23,25,29,30,31,32,33,34,35,36,37,39,40,41,42,44,45,47,48,49,50,51,52,53,54,55,56,57,58,60,61,62,63,64,65,66,68,69,70,71,72,74,78,79]);

// categories
const PORTRAIT = new Set([0,15,16,17,19,20,21,23,25,29,30,31,32,33,34,35,39,42,60,25]); // square horse portraits
const DESC = {
  0: 'Decorated Kurdish horse with traditional tack', 1: 'Historic pack-horse caravan in the Iranian mountains',
  4: 'Handler with dark Kurdish-type mare', 5: 'Historic mounted archer on horseback',
  6: 'Racing from the saddle POV', 8: 'Endurance: pacer and horse at speed',
  9: 'Aerial view of a flat race', 10: 'Thoroughbred in full flight',
  11: 'Riders in morning training', 13: 'Historic black-and-white race finish',
  14: 'Packed grandstand at a racecourse', 15: 'Decorated Turkmen-type horse, ceremonial tack',
  16: 'Bay mare, halter portrait', 17: 'Dark bay stallion portrait',
  18: 'Arabian show championship class', 19: 'Brown horse at liberty',
  20: 'Dun horse head study', 21: 'Caspian pony under saddle',
  23: 'Grey horse in the arena', 25: 'Mare and foal at pasture',
  29: 'Dark foal on the lead', 30: 'Black stallion galloping',
  31: 'Cremello stallion at the stud', 32: 'Dun mare in open range',
  33: 'Golden chestnut in show condition', 34: 'Chestnut rearing in the paddock',
  35: 'Bay sporthorse in the arena', 36: 'Race day crowd at the big meeting',
  37: 'Equestrian vaulting team performance', 39: 'Bay gelding head closeup',
  40: 'Show-ring inspection', 41: 'Show jumper over blue rails',
  42: 'Arabian mare head, star marking', 44: 'Show jumping in front of the stands',
  45: 'Jumper at full stretch', 47: 'Jumper over the triple bar',
  48: 'Grey horse over painted rails', 49: 'Eventer over the wall',
  50: 'Dun jumper over the oxer', 51: 'Grand-prix jumping at a packed arena',
  52: 'Show horse in the international ring', 53: 'Dressage horse on the bit',
  54: 'Show jumper at the take-off', 55: 'Grey dressage horse being congratulated',
  56: 'Chestnut dressage horse in extended trot', 57: 'Black dressage horse in the arena',
  58: 'Caspian ponies racing', 60: 'Grey Arabian with ceremonial bridle',
  61: 'Jumper over the green parallel', 62: 'Young rider on the dark bay',
  63: 'Chogan (polo) rider at the gallop', 64: 'Riders crossing the desert plain',
  65: 'Chogan match in the dust', 66: 'Persian tile: polo player on horseback',
  68: 'Chogan player at full swing', 69: 'Horses galloping in desert light',
  70: 'Polo player in red, ball in play', 71: 'Traditional mounted games, horsemen gathering',
  72: 'Chogan crowd at the historic arena', 74: 'Chogan at Isfahan, traditional sport of kings',
  78: 'Turkmen horsemen gathered at the races', 79: 'Racehorse in front of the grandstand',
};

mkdirSync('scripts/gen-tmp/t33-out', { recursive: true });
mkdirSync('scripts/gen-tmp/t33-horses', { recursive: true });
const manifest = [];
for (const r of res) {
  if (!sel.has(r.i)) continue;
  const src = `scripts/gen-tmp/t33-web/${r.safe}.bin`;
  const isPortrait = PORTRAIT.has(r.i);
  if (isPortrait) {
    let out;
    for (const [w, q] of [[640, 72], [560, 70], [500, 68], [460, 64]]) {
      out = await sharp(src).resize(w, w, { fit: 'cover', position: 'attention' }).webp({ quality: q }).toBuffer();
      if (out.length <= 50 * 1024) break;
    }
    const name = `horse-web-${r.safe}.webp`;
    writeFileSync(`scripts/gen-tmp/t33-horses/${name}`, out);
    manifest.push({ kind: 'portrait', name, kb: +(out.length / 1024).toFixed(1), desc: DESC[r.i], src: r.url, source: r.src });
  } else {
    let out;
    outer: for (const width of [1280, 1100, 1000, 900, 820, 740, 660, 600]) {
      for (let q = 74; q >= 26; q -= 4) {
        out = await sharp(src).resize({ width, withoutEnlargement: true }).webp({ quality: q }).toBuffer();
        if (out.length <= 50 * 1024) break outer;
      }
    }
    const name = `web-${r.safe}.webp`;
    writeFileSync(`scripts/gen-tmp/t33-out/${name}`, out);
    manifest.push({ kind: 'landscape', name, kb: +(out.length / 1024).toFixed(1), desc: DESC[r.i], src: r.url, source: r.src });
  }
}
writeFileSync('scripts/t33-web-manifest.json', JSON.stringify(manifest, null, 1));
const p = manifest.filter(m => m.kind === 'portrait'), l = manifest.filter(m => m.kind === 'landscape');
console.log('portraits:', p.length, '| landscapes:', l.length);
console.log('max KB:', Math.max(...manifest.map(m => m.kb)));

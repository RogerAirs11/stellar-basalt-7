// turn 31: backfill inline figures into long newsroom posts (Supabase).
// Idempotent: skips any body that already contains a markdown image.
// Inserts 2 standalone ![alt](url) blocks per body at ~1/3 and ~2/3,
// never right after a heading and never inside an existing image block.
import postgres from "postgres";

// R131 SECURITY SCRUB: connection string comes from SUPABASE_DATABASE_URL
// (canonical store: vault TOKENS.md).
const SUPABASE_URL = process.env.SUPABASE_DATABASE_URL;
if (!SUPABASE_URL) throw new Error("Set SUPABASE_DATABASE_URL (vault TOKENS.md)");
const sql = postgres(SUPABASE_URL, { max: 1, connect_timeout: 20, prepare: false });

const MIN_LEN = 1600;

const ALTS = {
  jumping: ["مسابقه پرش با اسب", "Show jumping competition in Iran", "منافسات قفز الخيل", "伊朗马术场地障碍赛"],
  racing: ["مسابقه اسب‌دوانی در ایران", "Horse racing in Iran", "سباق الخيل في إيران", "伊朗速度赛马比赛"],
  endurance: ["مسابقه استقامت اسبان", "Endurance ride on the course", "سباق التحمل للخيول", "马术耐力赛赛道"],
  caspian: ["اسب کاسپین در میدان درساژ", "Caspian horse in the dressage arena", "حصان قزوين في حلبة الدريساج", "里海马在盛装舞步赛场"],
  chogan: ["چوگان و تیراندازی با اسب", "Horseback archery — chogan", "الرماية على ظهور الخيل", "马背射箭比赛"],
  beauty: ["اسب عربی ایرانی در نمایش", "Iranian Arabian horse presentation", "حصان عربي إيراني في العرض", "伊朗阿拉伯马展示"],
  kurdish: ["اسب کرد ایرانی", "Iranian Kurdish horse", "الحصان الكردي الإيراني", "伊朗库尔德马"],
  training: ["تمرین اسب و سوارکار", "Training session in the arena", "جلسة تدريب في الحلبة", "训练场上的马术课程"],
  vet: ["معاینه دامپزشکی اسب", "Veterinary inspection", "الفحص البيطري للخيل", "马匹兽医检查"],
  turkmen: ["اسب ترکمن در میدان", "Turkmen horse on the track", "الحصان التركماني", "土库曼马在赛道上"],
  ceremony: ["مراسم اهدای جوایز اسب‌سواری", "Award ceremony at the equestrian event", "حفل توزيع جوائز المنافسات", "马术赛事颁奖典礼"],
};

function family(slug) {
  const s = slug.toLowerCase();
  if (/(archery|chogan|tentpeg)/.test(s)) return "chogan";
  if (/(endurance)/.test(s)) return "endurance";
  if (/(dressage|pony|caspian)/.test(s)) return "caspian";
  if (/(kurdish)/.test(s)) return "kurdish";
  if (/(racing|gonbad|aq-qala|yazd|arc-|waseema|kavus)/.test(s)) return s.includes("turkmen") ? "turkmen" : "racing";
  if (/(beauty|arabian|pedigree)/.test(s)) return "beauty";
  if (/(vet|veterinary|doping|health)/.test(s)) return "vet";
  if (/(guide|training|beginner|education|course|buying)/.test(s)) return "training";
  if (/(ceremony|award|federation|congress|appeal|parliament|registry|analysis)/.test(s)) return "ceremony";
  if (/(jump|csi|azmoon|mahk|show)/.test(s)) return "jumping";
  if (/(turkmen)/.test(s)) return "turkmen";
  return "training";
}

function pickImages(f, cover) {
  const pool = [];
  for (let i = 0; i < 12; i++) pool.push(`/images/news/pool-${f}-${String(i).padStart(2, "0")}.webp`);
  const other = Object.keys(ALTS).filter(k => k !== f);
  const alt = other[(slugHash(cover || f) % other.length)];
  for (let i = 0; i < 12; i++) pool.push(`/images/news/pool-${alt}-${String(i).padStart(2, "0")}.webp`);
  return pool.filter(p => p !== cover);
}

function slugHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// insert figure blocks after block index positions; returns new body
function insertFigures(body, urls, alts) {
  const blocks = body.split(/\n{2,}/);
  const n = blocks.length;
  if (n < 6) return null; // too short structurally
  const targets = [Math.round(n / 3), Math.round((2 * n) / 3)];
  const inserted = new Set();
  for (let t = 0; t < targets.length; t++) {
    // walk forward from target to find a plain paragraph block (not heading/image/list)
    let idx = targets[t];
    while (idx < n && (inserted.has(idx) || /^(!\[|#|> |- |\* )/.test(blocks[idx].trim()) || /^!\[/.test(blocks[idx]))) idx++;
    if (idx >= n || idx === n - 1) continue; // never after the last block
    blocks[idx] = blocks[idx] + "\n\n![" + alts[t % alts.length] + "](" + urls[t % urls.length] + ")";
    inserted.add(idx);
  }
  if (inserted.size === 0) return null;
  return blocks.join("\n\n");
}

const rows = await sql`
  SELECT id, slug, body_en, body_fa, body_ar, body_zh, cover_image_url
  FROM content_posts
  WHERE LENGTH(body_en) >= ${MIN_LEN} AND status = 'published'
  ORDER BY published_at DESC`;

console.log(`candidates: ${rows.length}`);
let updated = 0, skipped = 0, failed = 0;

for (const row of rows) {
  if ((row.body_en || "").includes("](")) { skipped++; continue; }
  if ((row.body_fa || "").includes("](")) { skipped++; continue; }
  const f = family(row.slug);
  const urls = pickImages(f, row.cover_image_url);
  if (urls.length < 2) { failed++; continue; }
  const en = insertFigures(row.body_en, urls, [ALTS[f][1], ALTS[f][1]]);
  const fa = insertFigures(row.body_fa, urls, [ALTS[f][0], ALTS[f][0]]);
  const ar = insertFigures(row.body_ar, urls, [ALTS[f][2], ALTS[f][2]]);
  const zh = insertFigures(row.body_zh, urls, [ALTS[f][3], ALTS[f][3]]);
  if (!en) { failed++; continue; }
  await sql`
    UPDATE content_posts
    SET body_en = ${en},
        body_fa = ${fa ?? row.body_fa},
        body_ar = ${ar ?? row.body_ar},
        body_zh = ${zh ?? row.body_zh}
    WHERE id = ${row.id}`;
  updated++;
}

console.log(`done — updated: ${updated}, already-had-figures: ${skipped}, failed: ${failed}`);

// post-verify
const check = await sql`SELECT COUNT(*)::int c FROM content_posts WHERE body_en LIKE '%![%' AND status='published'`;
console.log(`posts with inline figures now: ${check[0].c}`);
await sql.end();

// Turn 33: raise existing articles to >=3 inline figures (currently most have 2).
// Idempotent: only touches posts with < 3 inline figures; appends one more figure at ~1/2.
// Prefers REAL race photos (/images/races/race-*, yt-*, web-*) for racing-family posts,
// falls back to the topical pool images.
import postgres from "postgres";
import { readdirSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_DATABASE_URL;
if (!SUPABASE_URL) throw new Error("Set SUPABASE_DATABASE_URL");
const sql = postgres(SUPABASE_URL, { max: 1, connect_timeout: 20, prepare: false });

const MIN_LEN = 1200;
const raceFiles = readdirSync('public/images/races').filter(f => f.endsWith('.webp'));
const raceUrls = raceFiles.map(f => `/images/races/${f}`);

const ALTS = {
  jumping: ["مسابقه پرش با اسب", "Show jumping competition in Iran", "منافسات قفز الخيل", "伊朗马术场地障碍赛"],
  racing: ["مسابقه اسب‌دوانی در ایران", "Horse racing in Iran", "سباق الخيل في إيران", "伊朗速度赛马比赛"],
  endurance: ["مسابقه استقامت اسبان", "Endurance ride on the course", "سباق التحمل للخيول", "马术耐力赛赛道"],
  caspian: ["اسب کاسپین در میدان درساژ", "Caspian horse in the arena", "حصان قزوين في الحلبة", "里海马在赛场"],
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

function slugHash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }

function figCount(body) { return ((body || '').match(/!\[/g) || []).length; }

// append ONE more figure at ~1/2, never after heading/last block
function addFigure(body, url, alt) {
  const blocks = body.split(/\n{2,}/);
  const n = blocks.length;
  if (n < 6) return null;
  let idx = Math.round(n / 2);
  while (idx < n - 1 && (/^(!\[|#|> |- |\* )/.test(blocks[idx].trim()))) idx++;
  if (idx >= n - 1) return null;
  blocks[idx] = blocks[idx] + "\n\n![" + alt + "](" + url + ")";
  return blocks.join("\n\n");
}

const rows = await sql`
  SELECT id, slug, body_en, body_fa, body_ar, body_zh, cover_image_url
  FROM content_posts
  WHERE LENGTH(body_en) >= ${MIN_LEN} AND status = 'published' AND id NOT LIKE 'turn33-%'
  ORDER BY published_at DESC`;
console.log('candidates:', rows.length);

let updated = 0, skipped = 0, failed = 0;
for (const row of rows) {
  const cnt = figCount(row.body_en);
  if (cnt >= 3) { skipped++; continue; }
  const f = family(row.slug);
  // real race photos for racing/turkmen families; pool for others
  const useReal = ['racing', 'turkmen'].includes(f);
  const realPick = useReal ? raceUrls[slugHash(row.slug) % raceUrls.length] : null;
  const poolAlt = `/images/news/pool-${f}-${String(slugHash(row.slug) % 12).padStart(2, "0")}.webp`;
  const url = row.cover_image_url !== realPick && realPick ? realPick : (poolAlt !== row.cover_image_url ? poolAlt : `/images/news/pool-${f}-00.webp`);
  const en = addFigure(row.body_en, url, ALTS[f][1]);
  const fa = addFigure(row.body_fa, url, ALTS[f][0]);
  const ar = addFigure(row.body_ar, url, ALTS[f][2]);
  const zh = addFigure(row.body_zh, url, ALTS[f][3]);
  if (!en) { failed++; continue; }
  await sql`
    UPDATE content_posts SET body_en=${en}, body_fa=${fa || row.body_fa}, body_ar=${ar || row.body_ar},
      body_zh=${zh || row.body_zh}, updated_at=now(), row_version=row_version+1
    WHERE id=${row.id}`;
  updated++;
}
console.log('updated:', updated, '| already >=3 figs:', skipped, '| structural fails:', failed);
await sql.end();

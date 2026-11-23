// turn 32: wire searched photos into competitions + prominent horses (Supabase).
// Competitions: 2 discipline photos alternate across the 60 demo events.
// Horses: top racing + sport champions get a breed-representative photo;
// the credit ALWAYS states "representative" so it can never read as the
// horse's verified passport photo.
import postgres from "postgres";

const sql = postgres(
  `postgresql://postgres.gqzglbknkodyasqfrqfv:${process.env.SUPA_PW}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require`,
  { max: 1, connect_timeout: 20, prepare: false });

const CREDITS = {
  show_jumping: ["ISNA News Agency", "Horse Network"],
  racing: ["Alamy", "Adventure Iran"],
  halter: ["The Arabian Magazine", "polskiearaby.com"],
  endurance: ["FEI.org", "EasyCare Inc"],
  dressage: ["Showhoo", "YourDressage"],
  eventing: ["Horse and Rider Magazine", "Aspen Farms Eventing"],
};

// ---- competitions ----
const comps = await sql`SELECT id, discipline FROM competitions ORDER BY id`;
let ci = 0;
for (const c of comps) {
  const imgs = CREDITS[c.discipline];
  if (!imgs) continue;
  const idx = c.id % 2;
  const url = `/images/competitions/${c.discipline}-${idx}.webp`;
  await sql`UPDATE competitions SET image_url=${url}, image_credit=${imgs[idx]} WHERE id=${c.id}`;
  ci++;
}
console.log(`competitions updated: ${ci}`);

// ---- horses ----
const racing = await sql`
  SELECT h.id, h.breed_desc, s.win FROM horse_racing_stats s
  JOIN horses h ON h.id::text = s.registry_horse_id
  WHERE s.win > 3 ORDER BY s.win DESC LIMIT 15`;
const sport = await sql`
  SELECT h.id, h.breed_desc, COUNT(*) c, SUM(CASE WHEN r.placement=1 THEN 1 ELSE 0 END) wins
  FROM competition_results r JOIN horses h ON h.id = r.horse_id
  GROUP BY h.id, h.breed_desc ORDER BY wins DESC, c DESC LIMIT 12`;

function poolFor(breed) {
  const b = (breed || "").toLowerCase();
  if (b.includes("turkoman") || b.includes("turkmen")) return "turkoman";
  if (b.includes("arabian")) return "arabian";
  return "racing"; // Part Bred / Thoroughbred / unknown -> racing action photo
}
const counters = {};
function nextUrl(pool) {
  counters[pool] = (counters[pool] ?? 0) + 1;
  return `/images/horses/${pool}-${(counters[pool] - 1) % (pool === "arabian" ? 8 : pool === "turkoman" ? 4 : 6)}.webp`;
}

const horses = [...racing.map(r => ({ id: r.id, breed: r.breed_desc, why: "top racing record" })),
                ...sport.map(r => ({ id: r.id, breed: r.breed_desc, why: "sport champion" }))];
const seen = new Set();
let hi = 0;
for (const h of horses) {
  if (seen.has(h.id)) continue;
  seen.add(h.id);
  const pool = poolFor(h.breed);
  const url = nextUrl(pool);
  const breedLabel = pool === "turkoman" ? "Turkoman" : pool === "arabian" ? "Arabian" : "racing";
  const credit = `Representative ${breedLabel} horse photo (not the horse's passport photo)`;
  await sql`UPDATE horses SET profile_image_url=${url}, profile_image_credit=${credit} WHERE id=${h.id}::bigint`;
  hi++;
}
console.log(`horses updated: ${hi}`);

// verify
const checkC = await sql`SELECT COUNT(*)::int c FROM competitions WHERE image_url IS NOT NULL`;
const checkH = await sql`SELECT COUNT(*)::int c FROM horses WHERE profile_image_url IS NOT NULL`;
console.log(`competitions with image: ${checkC[0].c}, horses with photo: ${checkH[0].c}`);
await sql.end();

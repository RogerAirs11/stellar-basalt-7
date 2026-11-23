#!/usr/bin/env node
// Seed demonstrative module data onto the REAL registry dataset.
//
// Honest-data contract: every row created here carries provenance='demo'
// (breeding_records use 'derived' — they are derived deterministically from the
// registered pedigree: sire x dam -> foal, which is real registry data, not
// invention). Competitions, riders, prices and genetic panels are ILLUSTRATIVE
// and labeled as such in every API response and UI surface that shows them.
// The script is idempotent: re-running replaces only its own rows.
//
// Usage: node scripts/seed-demo-data.mjs [--db data/generated/horse-registry.sqlite] [--skip-breedings]

import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

const argv = process.argv.slice(2);
const arg = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const DB_PATH = arg("db") ?? "data/generated/horse-registry.sqlite";
const SKIP_BREEDINGS = argv.includes("--skip-breedings");

// --- deterministic RNG (mulberry32) so the seed is reproducible ------------
let rngState = 0x9e3779b9;
function srand(seed) { rngState = seed >>> 0; }
function rand() {
  rngState = (rngState + 0x6d2b79f5) >>> 0;
  let t = rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const range = (n) => Array.from({ length: n }, (_, i) => i);

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode=WAL");
db.exec("PRAGMA foreign_keys=OFF");

// ---------------------------------------------------------------------------
// Real pools (venues, organizers, riders, clubs) — representative of the
// Iranian equestrian scene; competition NAMES are illustrative composites.
const VENUES = [
  ["باشگاه سوارکاری چمران تهران", "Tehran", "Chenaran Equestrian Club"],
  ["مجموعه سوارکاری جی اصفهان", "Isfahan", "Jey Equestrian Complex"],
  ["مرکز سوارکاری مشهد", "Mashhad", "Mashhad Equestrian Center"],
  ["شهرک اسبدوانی قصر شیرین", "Kermanshah", "Qasr-e Shirin Racing Park"],
  ["مرکز پرورش اسب ترکمن گلستان", "Golestan", "Turkoman Horse Breeding Center"],
  ["میدان سوارکاری آزادی کرج", "Karaj", "Azadi Equestrian Field"],
  ["مجموعه سوارکاری شیراز", "Shiraz", "Shiraz Equestrian Complex"],
  ["باشگاه اسب عرب یزد", "Yazd", "Yazd Arabian Horse Club"],
  ["مرکز اسبدوانی تبریز", "Tabriz", "Tabriz Racing Center"],
  ["مجموعه سوارکاری رشت", "Rasht", "Rasht Equestrian Complex"],
  ["آکادمی سوارکاری اهواز", "Ahvaz", "Ahvaz Riding Academy"],
  ["میدان champions بین‌المللی کیش", "Kish", "Kish International Champions Field"],
];
const ORGANIZERS = ["فدراسیون سوارکاری جمهوری اسلامی ایران", "انجمن اسب عرب ایران", "انجمن اسب ترکمن ایران", "انجمن اسبکرد ایران", "اداره کل ورزش و جوانان استان"];
const FIRST = ["علی", "محمد", "رضا", "حسین", "امیر", "مهدی", "سعید", "آرش", "بهزاد", "فرهاد", "کاوه", "پویا", "بابک", "سیامک", "سارا", "زهرا", "مریم", "نگار", "شیما", "الهام", "رها", "ترانه", "یاسمن", "بهاره"];
const LAST = ["احمدی", "محمدی", "رضایی", "کریمی", "حسینی", "موسوی", "صادقی", "شریفی", "نوری", "رستمی", "دهقان", "سلطانی", "مقدم", "فرهمند", "هاشمی", "اکبری", "قاسمی", "زارع", "امینی", "جهانگیری", "بیات", "افشار", "علوی", "کاظمی"];
const CLUBS = ["باشگاه سوارکاری چمران", "آکادمی چناران", "مجموعه جی اصفهان", "کانون سوارکاری خراسان", "باشگاه اسبدوانی قصر شیرین", "مرکز ترکمن گلستان", "تیم ملی جوانان", "انجمن اسب عرب یزد", "باشگاه شیراز", "تیم پارس کرج"];

const DISCIPLINES = {
  show_jumping: { fa: "پرش با مانع", events: ["جام پرش با مانع", "مسابقات پرش رده A", "جام باشگاه‌های پرش"] },
  dressage: { fa: "درساژ", events: ["قهرمانی درساژ سطح ۲", "جام درساژ", "آزمون درساژ سطح مقدماتی"] },
  endurance: { fa: "استقامت", events: ["آزمون استقامت ۸۰ کیلومتری", "کاپ استقامت ۱۲۰ کیلومتر", "جام استقامت"] },
  racing: { fa: "اسپرینت اسبدوانی", events: ["جام فجر اسپرینت", "اسپرینت ۱۰۰۰ متر", "کاپ اسبدوانی"] },
  halter: { fa: "نمایش (هالتر)", events: ["جشنواره اسب عرب", "نمایشگاه ملی اسب عرب", "جشنواره قائل‌های اصیل"] },
  eventing: { fa: "سه‌روزه", events: ["مسابقات سه‌روزه ترکیبی"] },
  freestyle: { fa: "نمایش آزاد", events: ["نمایش آزاد سوارکاری"] },
};
const TIERS = ["regional", "national", "national", "national", "international", "regional"];

const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");

// --- clear previous demo rows (idempotent re-seed) -------------------------
console.log("[seed] clearing previous demo rows ...");
db.exec("DELETE FROM competition_results WHERE provenance='demo'");
db.exec("DELETE FROM competitions WHERE provenance='demo'");
db.exec("DELETE FROM sales_listings WHERE provenance='demo'"); // cascades inquiries
db.exec("DELETE FROM genetic_tests WHERE provenance='demo'");
if (!SKIP_BREEDINGS) db.exec("DELETE FROM breeding_records WHERE provenance='derived'");

// --- real horse pools -------------------------------------------------------
const sportHorses = db.prepare("SELECT id,breed_desc,sex_desc,birth_year,name_latin FROM horses WHERE deleted_at IS NULL AND is_active=1 AND is_dead=0 AND birth_year IS NOT NULL AND birth_year BETWEEN 2005 AND 2019 ORDER BY id").all();
const arabians = db.prepare("SELECT id,breed_desc,sex_desc,birth_year,color_desc FROM horses WHERE deleted_at IS NULL AND is_active=1 AND is_dead=0 AND (breed_desc LIKE '%Arab%' OR breed_desc LIKE '%Darehshouri%' OR breed_desc LIKE '%Part Bred%') AND birth_year IS NOT NULL AND birth_year BETWEEN 2005 AND 2019 ORDER BY id").all();
const salePool = db.prepare("SELECT id,breed_desc,sex_desc,birth_year,color_desc,name_latin,name_native,register_no FROM horses WHERE deleted_at IS NULL AND is_active=1 AND is_dead=0 AND birth_year BETWEEN 2012 AND 2022 ORDER BY id").all();
console.log(`[seed] pools: sport=${sportHorses.length} arabian-like=${arabians.length} sale=${salePool.length}`);

// ---------------------------------------------------------------------------
// 1) Competitions + results (six seasons, all disciplines)
console.log("[seed] competitions ...");
srand(20260923);
let competitionId = 1001;
let resultId = 100001;
const insComp = db.prepare(`INSERT INTO competitions(id,name_native,name_latin,discipline,event_date,end_date,venue,city,organizer,tier,season,provenance,created_at,updated_at)
  VALUES(?,?,?,?,?,?,?,?,?,?,?, 'demo', ?, ?)`);
const insResult = db.prepare(`INSERT INTO competition_results(id,competition_id,horse_id,rider_name,rider_club,class_name,placement,placement_text,score,is_eliminated,is_withdrawn,provenance,created_at)
  VALUES(?,?,?,?,?,?,?,?,?,?,?, 'demo', ?)`);

const seasons = [2020, 2021, 2022, 2023, 2024, 2025];
let totalResults = 0;
for (const year of seasons) {
  const iranianYear = year - 621;
  // 8 events per season across disciplines
  const entries = [];
  for (const d of ["show_jumping", "show_jumping", "dressage", "endurance", "racing", "halter", "halter", "eventing"]) entries.push(d);
  for (const discipline of entries) {
    const month = 3 + Math.floor(rand() * 7); // April–October season
    const day = 1 + Math.floor(rand() * 27);
    const eventDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const [venueFa, city, venueEn] = pick(VENUES);
    const base = DISCIPLINES[discipline];
    const nameFa = `${pick(base.events)} — ${iranianYear >= 1400 ? toPersianDigits(String(iranianYear)) : iranianYear}`;
    const tier = pick(TIERS);
    insComp.run(competitionId, nameFa, `${base.events[0]} ${year} — ${city}`, discipline, eventDate, null, venueFa, city, pick(ORGANIZERS), tier, iranianYear, now, now);
    // 20-70 participants drawn from real registered horses
    const pool = discipline === "halter" ? arabians : sportHorses;
    const participants = new Set();
    const count = 20 + Math.floor(rand() * 45);
    while (participants.size < Math.min(count, pool.length)) participants.add(pool[Math.floor(rand() * pool.length)]);
    const list = [...participants];
    const placements = range(list.length).map((i) => i + 1);
    for (let i = 0; i < list.length; i++) {
      const horse = list[i];
      const age = year - horse.birth_year;
      if (age < 4 || age > 20) continue;
      const roll = rand();
      let placement = null, placementText = null, eliminated = 0, withdrawn = 0, score = null;
      if (roll < 0.06) { eliminated = 1; placementText = "حذف"; }
      else if (roll < 0.09) { withdrawn = 1; placementText = "انصراف"; }
      else {
        placement = placements[i];
        placementText = toPersianDigits(String(placement));
        if (discipline === "show_jumping") score = `${38 + Math.floor(rand() * 8)}-${Math.floor(rand() * 60)}s`;
        else if (discipline === "dressage") score = `${(60 + rand() * 12).toFixed(2)}%`;
        else if (discipline === "endurance") score = `${(7 + rand() * 3).toFixed(1)} km/h`;
        else if (discipline === "racing") score = `${(58 + rand() * 8).toFixed(2)}s`;
      }
      const rider = `${pick(FIRST)} ${pick(LAST)}`;
      insResult.run(resultId, competitionId, horse.id, rider, pick(CLUBS),
        discipline === "halter" ? pick(["فوال", "سالخورده", "قائل‌دار"]) : pick(["رده A", "رده B", "رده جوانان"]),
        placement, placementText, score, eliminated, withdrawn, now);
      resultId++; totalResults++;
    }
    competitionId++;
  }
}
console.log(`[seed] competitions: ${competitionId - 1001} events, ${totalResults} results on real horses`);

// ---------------------------------------------------------------------------
// 2) Sales listings (140) on real horses with realistic toman pricing
console.log("[seed] marketplace listings ...");
const insListing = db.prepare(`INSERT INTO sales_listings(id,horse_id,seller_contact_name,seller_contact_phone,seller_city,asking_price_toman,price_visible,negotiable,status,title,description,view_count,listed_at,updated_at,provenance)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'demo')`);
const breedPrice = { Arabian: [450e6, 2.4e9], "Part Bred": [220e6, 750e6], Thoroughbred: [280e6, 900e6], Turkoman: [350e6, 1.1e9], Kurdish: [120e6, 400e6], "Sport Horses": [300e6, 950e6], Caspian: [150e6, 500e6], "Persian Plateau": [180e6, 600e6], Darehshouri: [400e6, 1.4e9] };
const CITIES = ["Tehran", "Isfahan", "Mashhad", "Karaj", "Shiraz", "Tabriz", "Yazd", "Ahvaz", "Golestan", "Kermanshah"];
const sellingTitles = ["اسب آماده مسابقه", "فوال با تبار درجه یک", "مادیان اصیل قابل پرورش", "نریان اصیل کتاب اول", "اسب خانوادگی آرام", "اسب نمایشی", "فوال شیرجه‌ای", "مادیان آبستن"];
let listings = 0;
const usedHorses = new Set();
for (const horse of salePool) {
  if (listings >= 140) break;
  if (usedHorses.has(horse.id)) continue;
  if (rand() > 0.02) { continue; } // sample ~2% of the pool
  const [lo, hi] = breedPrice[horse.breed_desc] ?? [150e6, 700e6];
  const price = Math.round((lo + rand() * (hi - lo)) / 10e6) * 10e6;
  const city = pick(CITIES);
  insListing.run(randomUUID(), horse.id, `${pick(FIRST)} ${pick(LAST)}`,
    `0912${String(1000000 + Math.floor(rand() * 8999999))}`, city, price, rand() > 0.15 ? 1 : 0, rand() > 0.5 ? 1 : 0,
    "active", pick(sellingTitles), null, Math.floor(rand() * 340), now, now);
  usedHorses.add(horse.id);
  listings++;
}
console.log(`[seed] listings: ${listings} on real horses`);

// ---------------------------------------------------------------------------
// 3) Genetic panels (Arabian-related horses): SCID / CA / LFS + coat loci
console.log("[seed] genetic tests ...");
const insTest = db.prepare(`INSERT INTO genetic_tests(horse_id,test_type,test_category,result,result_interpretation,lab_name,lab_accession,tested_at,verified,provenance,created_at)
  VALUES(?,?,?,?,?,?,?,?,?, 'demo', ?)`);
const labs = ["آزمایشگاه ژنتیک دانشگاه تهران", "Laboklin (Germany)", "VHL Genetics (Netherlands)", "پژوهشگاه رویان"];
let tests = 0;
let gi = 0;
for (const horse of arabians) {
  gi++;
  if (gi > 900) break; // first ~900 arabian-like horses keep the panel meaningful
  const year = 2021 + Math.floor(rand() * 4);
  const testedAt = `${year}-${String(1 + Math.floor(rand() * 12)).padStart(2, "0")}-${String(1 + Math.floor(rand() * 27)).padStart(2, "0")}`;
  // Disease markers: mostly clear, some carriers, rare affected
  for (const [type, carrierRate, affectedRate] of [["SCID", 0.11, 0.02], ["CA", 0.09, 0.015], ["LFS", 0.06, 0.01]]) {
    const roll = rand();
    let result = "Clear (N/N)", interp = "بدون نسخه جهش‌یافته";
    if (roll < affectedRate) { result = "Affected"; interp = "هر دو آلل جهش‌یافته"; }
    else if (roll < affectedRate + carrierRate) { result = "Carrier (N/SC)"; interp = "حامل یک نسخه جهش‌یافته"; }
    insTest.run(horse.id, type, "disease", result, interp, pick(labs), `GT-${year}-${100000 + Math.floor(rand() * 899999)}`, testedAt, rand() > 0.3 ? 1 : 0, now);
    tests++;
  }
  // Coat loci from the registered colour
  const color = String(horse.color_desc ?? "").toLowerCase();
  const coat = [];
  if (color.includes("grey") || color.includes("gray") || color.includes("سرمه")) coat.push(["gray_STX17", "G/G", "تمایل به سفیدشدگی با سن"]);
  if (color.includes("bay") || color.includes("خاکستری")) coat.push(["extension_MC1R", "E/E", "پایه سیاه"], ["agouti_ASLIP", "A/a", "غیرسیال بالای تنه"]);
  if (color.includes("chestnut") || color.includes("sorrel") || color.includes("مهمان")) coat.push(["extension_MC1R", "e/e", "قرمز/مهتابی"]);
  if (color.includes("black") || color.includes("سیا")) coat.push(["extension_MC1R", "E/E", "پایه سیال"], ["agouti_ASLIP", "a/a", "سیال یکدست"]);
  for (const [locus, result, interp] of coat.slice(0, 2)) {
    insTest.run(horse.id, locus, "coat_color", result, interp, pick(labs), `GT-${year}-${100000 + Math.floor(rand() * 899999)}`, testedAt, 1, now);
    tests++;
  }
}
console.log(`[seed] genetic tests: ${tests} rows on ${Math.min(gi, 900)} arabian-like horses`);

// ---------------------------------------------------------------------------
// 4) Breeding records DERIVED from the real pedigree (not invention)
if (!SKIP_BREEDINGS) {
  console.log("[seed] deriving breeding records from registered pedigree ...");
  db.exec(`
    INSERT INTO breeding_records(sire_id,dam_id,season,outcome,foal_id,provenance,created_at)
    SELECT h.father_id, h.mother_id, h.birth_year - 1, 'foaled', h.id, 'derived', CURRENT_TIMESTAMP
    FROM horses h
    WHERE h.deleted_at IS NULL AND h.father_id IS NOT NULL AND h.mother_id IS NOT NULL AND h.birth_year IS NOT NULL
    GROUP BY h.father_id, h.mother_id, h.birth_year - 1
  `);
  const n = db.prepare("SELECT COUNT(*) AS n FROM breeding_records WHERE provenance='derived'").get().n;
  console.log(`[seed] derived breeding records: ${n}`);
}

// --- summary ----------------------------------------------------------------
db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
const summary = {
  competitions: db.prepare("SELECT COUNT(*) AS n FROM competitions").get().n,
  results: db.prepare("SELECT COUNT(*) AS n FROM competition_results").get().n,
  listings: db.prepare("SELECT COUNT(*) AS n FROM sales_listings").get().n,
  genetic_tests: db.prepare("SELECT COUNT(*) AS n FROM genetic_tests").get().n,
  breedings: db.prepare("SELECT COUNT(*) AS n FROM breeding_records").get().n,
};
console.log("[seed] SUMMARY:", JSON.stringify(summary));
db.close();

function toPersianDigits(value) {
  const map = { "0": "۰", "1": "۱", "2": "۲", "3": "۳", "4": "۴", "5": "۵", "6": "۶", "7": "۷", "8": "۸", "9": "۹" };
  return String(value).replace(/[0-9]/g, (d) => map[d]);
}

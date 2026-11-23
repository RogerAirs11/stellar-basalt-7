// R153 D1 sync stage 5: horse_search_source delta — bring D1 from 78,089 to Supabase parity (93,909)
// (a) insert rows missing in D1, (b) refresh rows stale vs Supabase updated_at, (c) delete rows for horses no longer in Supabase search_source.
// Same search-row recipe as turn49 (normalizeText + joins).
import { supa, d1, d1Statements, insertValues } from "./r153-lib.mjs";
import fs from "fs";

const COLS = ["horse_id", "name_latin", "name_native", "identifiers", "owners", "breeders", "father_name", "mother_name", "places", "breed", "all_text", "updated_at"];

const ARABIC_TO_PERSIAN = { "ي": "ی", "ى": "ی", "ك": "ک", "ة": "ه", "ۀ": "ه" };
function normalizeText(input) {
  if (input == null) return "";
  let v = String(input).normalize("NFKC").trim().toLowerCase();
  v = v.replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "");
  v = v.replace(/[يكىةۀ]/g, (c) => ARABIC_TO_PERSIAN[c] ?? c);
  v = v.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
  v = v.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  v = v.replace(/[-‐‑‒–—―_./\\|,:;()[\]{}'"`~!@#$%^&*+=<>?]+/g, " ");
  v = v.replace(/\s+/g, " ").trim();
  return v;
}
const j = (parts) => normalizeText(parts.filter((x) => x !== null && x !== undefined && x !== "").join(" "));

async function buildRows(ids) {
  const r = await supa`
    SELECT h.id, h.name_latin, h.name_native, h.register_no, h.uel_no, h.life_number,
           h.birth_place_desc, h.imported_from_desc, h.birth_year, h.sex_desc, h.color_desc,
           h.breed_desc, h.main_strain_desc, h.sub_strain_desc,
           trim(COALESCE(f.name_latin,'') || ' ' || COALESCE(f.name_native,'')) AS father_name,
           trim(COALESCE(m.name_latin,'') || ' ' || COALESCE(m.name_native,'')) AS mother_name,
           COALESCE(ps.owner_name,'') AS owner_latin, COALESCE(ps.owner_name_native,'') AS owner_native,
           COALESCE(ps.breeder_name,'') AS breeder_latin, COALESCE(ps.breeder_name_native,'') AS breeder_native,
           COALESCE(ps.importer_name,'') AS importer_latin, COALESCE(ps.passport_receiver_name,'') AS pr_latin,
           (SELECT string_agg(a.alias, ' ') FROM horse_aliases a WHERE a.horse_id = h.id) AS aliases
    FROM horses h
    LEFT JOIN horses f ON f.id = h.father_id
    LEFT JOIN horses m ON m.id = h.mother_id
    LEFT JOIN horse_registry_people_summary ps ON ps.horse_id = h.id
    WHERE h.id IN ${supa(ids)}`;
  return r.map((row) => {
    const nameLatin = normalizeText(row.name_latin);
    const nameNative = normalizeText(row.name_native);
    const identifiers = normalizeText([row.register_no, row.uel_no, row.life_number].filter(Boolean).join(" "));
    const owners = j([row.owner_latin, row.owner_native]);
    const breeders = j([row.breeder_latin, row.breeder_native]);
    const importers = normalizeText(row.importer_latin);
    const prs = normalizeText(row.pr_latin);
    const aliases = normalizeText(row.aliases);
    const fatherName = normalizeText(row.father_name);
    const motherName = normalizeText(row.mother_name);
    const places = normalizeText([row.birth_place_desc, row.imported_from_desc].filter(Boolean).join(" "));
    const breed = normalizeText([row.breed_desc, row.main_strain_desc, row.sub_strain_desc].filter(Boolean).join(" "));
    const allText = j([row.id, nameLatin, nameNative, identifiers, owners, breeders, importers, prs, aliases, fatherName, motherName, places, breed, row.birth_year, row.sex_desc, row.color_desc]);
    return {
      horse_id: Number(row.id), name_latin: nameLatin, name_native: nameNative,
      identifiers, owners, breeders, father_name: fatherName, mother_name: motherName,
      places, breed, all_text: allText, updated_at: new Date().toISOString().replace("T", " ").slice(0, 19),
    };
  });
}

// ---- (a) missing ids
console.log("pulling D1 search_source ids...");
const d1Ids = new Set();
let cursor = 0;
for (;;) {
  const r = await d1("SELECT horse_id FROM horse_search_source WHERE horse_id > ? ORDER BY horse_id LIMIT 20000", [cursor]);
  const rows = r[0].results;
  if (!rows.length) break;
  for (const x of rows) d1Ids.add(Number(x.horse_id));
  cursor = Number(rows[rows.length - 1].horse_id);
  if (rows.length < 20000) break;
}
console.log("D1 search ids:", d1Ids.size);

console.log("pulling Supabase search_source ids...");
const supaIds = [];
let sCursor = 0n;
for (;;) {
  const rows = await supa`select horse_id from horse_search_source where horse_id > ${sCursor} order by horse_id limit 20000`;
  if (!rows.length) break;
  for (const x of rows) supaIds.push(Number(x.horse_id));
  sCursor = rows[rows.length - 1].horse_id;
  if (rows.length < 20000) break;
}
console.log("Supabase search ids:", supaIds.length);
const supaSet = new Set(supaIds);

const missing = supaIds.filter((id) => !d1Ids.has(id));
const extra = [...d1Ids].filter((id) => !supaSet.has(id));
console.log(`missing in D1: ${missing.length}, stale-extra in D1: ${extra.length}`);

// ---- (c) delete extras (horses removed/deleted in Supabase)
if (extra.length) {
  const stmts = extra.map((id) => `DELETE FROM horse_search_source WHERE horse_id=${id};`);
  await d1Statements(stmts, { perRequest: 50 });
  console.log("extras deleted:", extra.length);
}

// ---- (a) insert missing
let done = 0;
for (let i = 0; i < missing.length; i += 1000) {
  const ids = missing.slice(i, i + 1000);
  const rows = await buildRows(ids);
  const stmts = insertValues("horse_search_source", COLS, rows, { orReplace: true });
  await d1Statements(stmts, { perRequest: 60 });
  done += rows.length;
  console.log(`  inserted ${done}/${missing.length}`);
}

// ---- (b) refresh stale rows
const D1_MAX = "2026-08-24 18:45:39";
// R162: optional CHUNK_MIN/CHUNK_MAX (half-open [min,max)) let a slow full-table
// refresh be run in bounded chunks that fit one command window; unset = full pass.
const chunkMin = process.env.CHUNK_MIN ? Number(process.env.CHUNK_MIN) : null;
const chunkMax = process.env.CHUNK_MAX ? Number(process.env.CHUNK_MAX) : null;
const stale = chunkMin === null
  ? await supa`select horse_id from horse_search_source where updated_at > ${D1_MAX} order by horse_id`
  : await supa`select horse_id from horse_search_source where updated_at > ${D1_MAX} and horse_id >= ${chunkMin} and horse_id < ${chunkMax} order by horse_id`;
console.log(`stale rows to refresh${chunkMin !== null ? ` [${chunkMin},${chunkMax})` : ""}: ${stale.length}`);
done = 0;
for (let i = 0; i < stale.length; i += 1000) {
  const ids = stale.slice(i, i + 1000).map((x) => Number(x.horse_id));
  const rows = await buildRows(ids);
  const stmts = insertValues("horse_search_source", COLS, rows, { orReplace: true });
  await d1Statements(stmts, { perRequest: 60 });
  done += rows.length;
  if (done % 5000 === 0 || done === stale.length) console.log(`  refreshed ${done}/${stale.length}`);
}

const v = await d1("select count(*) n from horse_search_source");
console.log("D1 horse_search_source now:", v[0].results[0].n);
fs.writeFileSync("/home/z/my-project/scripts/r153-search-ledger.json", JSON.stringify({ d1_before: d1Ids.size, supa: supaIds.size, missing: missing.length, extra_deleted: extra.length, refreshed: stale.length, d1_after: v[0].results[0].n }, null, 2));
console.log("ledger written");
await supa.end();

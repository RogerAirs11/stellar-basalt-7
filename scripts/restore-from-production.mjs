#!/usr/bin/env node
// Restore the local SQLite registry replica from the production public API.
//
// Context: the sandbox lost its Turso credentials and the original workbook is
// not present locally, but production D1 remains the live source of truth.
// This tool rebuilds a faithful local working copy using ONLY public read
// endpoints (browse + facets). Fields the browse projection does not inline
// (is_imported / imported_from_desc / is_stallion / is_sport / has_sport_card)
// are recovered losslessly through filtered slices, so the rebuilt analytics
// generation (filter counts, lifecycle, flags) matches production exactly.
//
// Provenance is honest: the created source_imports row describes this restore
// artifact (filename + real SHA-256), not the original workbook import.
//
// Usage:
//   node scripts/restore-from-production.mjs                  # fetch + persist + verify
//   node scripts/restore-from-production.mjs --phase fetch     # only fill the cache
//   node scripts/restore-from-production.mjs --phase persist   # rebuild db from cache
//   node scripts/restore-from-production.mjs --phase verify     # check a restored db
//   node scripts/restore-from-production.mjs --base http://localhost:3000
//
// After persist, finish derived data with:
//   node tools/post-sync-indexes.mjs
//   python3 tools/build_analytics_snapshot.py data/generated/horse-registry.sqlite
//
// The fetch phase is resumable: every page is cached on disk and skipped on
// re-run, so an interrupted restore costs only the missing pages.

import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
function arg(name) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

const BASE = (arg("base") ?? "https://horse-registry-nextgen.rogerfires10.workers.dev").replace(/\/+$/, "");
const DB_PATH = arg("db") ?? "data/generated/horse-registry.sqlite";
const PHASE = arg("phase") ?? "all";
const CONCURRENCY = Math.max(1, Number(arg("concurrency") ?? 6));
const PAGE = 100; // browse maxLimit
const CACHE = "data/generated/restore-cache";
const PAGES_DIR = path.join(CACHE, "pages");
const SLICES_DIR = path.join(CACHE, "slices");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, tries = 6) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(400 * 2 ** i + Math.random() * 300);
    }
  }
}

function ensureDirs() {
  for (const d of [CACHE, PAGES_DIR, SLICES_DIR]) mkdirSync(d, { recursive: true });
}

// ---------------------------------------------------------------------------
// FETCH
// ---------------------------------------------------------------------------

async function pool(items, worker, size = CONCURRENCY) {
  let next = 0;
  const runners = Array.from({ length: size }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}

async function fetchFacets() {
  const file = path.join(CACHE, "facets.json");
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  const facets = await fetchJson(`${BASE}/api/registry/facets`);
  writeFileSync(file, JSON.stringify(facets));
  return facets;
}

async function fetchBasePages() {
  const first = await fetchJson(`${BASE}/api/horses?limit=1&offset=0`);
  const total = first.total;
  if (!Number.isSafeInteger(total) || total <= 0) throw new Error(`unexpected total: ${total}`);
  const offsets = [];
  for (let o = 0; o < total; o += PAGE) offsets.push(o);
  const expectedRows = (o) => Math.min(PAGE, total - o);
  let done = 0;
  await pool(offsets, async (offset) => {
    const file = path.join(PAGES_DIR, `p${offset}.json`);
    if (existsSync(file)) { done++; return; }
    const data = await fetchJson(`${BASE}/api/horses?limit=${PAGE}&offset=${offset}`);
    if (!Array.isArray(data.rows) || data.rows.length !== expectedRows(offset)) {
      throw new Error(`page ${offset}: expected ${expectedRows(offset)} rows, got ${data.rows?.length}`);
    }
    for (let i = 1; i < data.rows.length; i++) {
      if (data.rows[i].id <= data.rows[i - 1].id) throw new Error(`page ${offset}: ids not ascending`);
    }
    writeFileSync(file, JSON.stringify(data.rows));
    done++;
    if (done % 100 === 0) console.log(`  base pages: ${done}/${offsets.length}`);
  });
  return { total, pages: offsets.length };
}

async function fetchSlice(name, query) {
  const file = path.join(SLICES_DIR, `${name}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  const ids = [];
  let offset = 0;
  for (;;) {
    const data = await fetchJson(`${BASE}/api/horses?${query}&limit=${PAGE}&offset=${offset}`);
    if (!Array.isArray(data.rows)) throw new Error(`slice ${name}: bad response`);
    for (const row of data.rows) ids.push(row.id);
    if (data.rows.length < PAGE) break;
    offset += PAGE;
    if (offset > 100_000) throw new Error(`slice ${name}: runaway pagination`);
  }
  const slice = { name, query, count: ids.length, ids };
  writeFileSync(file, JSON.stringify(slice));
  return slice;
}

async function runFetch() {
  ensureDirs();
  console.log(`[fetch] base: ${BASE}`);
  const facets = await fetchFacets();
  console.log(`[fetch] facets cached (breeds ${facets.breeds.length}, importedFrom ${facets.importedFrom.length})`);
  const { total, pages } = await fetchBasePages();
  console.log(`[fetch] base pages complete: ${pages} pages / ${total} horses`);

  const slices = {};
  for (const flag of ["isStallion", "isImported", "isSport", "hasSportCard"]) {
    const s = await fetchSlice(flag, `${flag}=1`);
    slices[flag] = s;
    console.log(`[fetch] slice ${flag}=1 -> ${s.count} horses`);
  }
  for (const f of facets.importedFrom) {
    const slug = String(f.value).toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const s = await fetchSlice(`if-${slug}`, `importedFrom=${encodeURIComponent(f.value)}`);
    slices[`importedFrom:${f.value}`] = s;
    console.log(`[fetch] slice importedFrom=${f.value} -> ${s.count} horses`);
  }
  const sum = Object.entries(slices).filter(([k]) => k.startsWith("importedFrom:")).reduce((a, [, s]) => a + s.count, 0);
  console.log(`[fetch] importedFrom slices total: ${sum}`);
  console.log("[fetch] DONE");
}

// ---------------------------------------------------------------------------
// PERSIST
// ---------------------------------------------------------------------------

// Same normalization contract as tools/import_xlsx.py normalize_text: NFKC,
// Arabic->Persian letter mapping, strip harakat, unify digits, squash tokens.
function normalizeText(v) {
  if (v == null) return "";
  let s = String(v).normalize("NFKC").trim().toLowerCase();
  for (const [from, to] of [["ي", "ی"], ["ى", "ی"], ["ك", "ک"], ["ة", "ه"], ["ۀ", "ه"]]) s = s.split(from).join(to);
  s = s.replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "");
  s = s.replace(/[۰٠]/g, "0").replace(/[۱١]/g, "1").replace(/[۲٢]/g, "2").replace(/[۳٣]/g, "3").replace(/[۴٤]/g, "4").replace(/[۵٥]/g, "5").replace(/[۶٦]/g, "6").replace(/[۷٧]/g, "7").replace(/[۸٨]/g, "8").replace(/[۹٩]/g, "9");
  s = s.replace(/[\W_]+/g, " ");
  return s.trim().split(/\s+/).filter(Boolean).join(" ");
}

function loadBaseRows() {
  const files = readdirSorted(PAGES_DIR).filter((f) => /^p\d+\.json$/.test(f));
  const rows = [];
  let lastId = 0;
  for (const f of files) {
    const page = JSON.parse(readFileSync(path.join(PAGES_DIR, f), "utf8"));
    for (const row of page) {
      if (row.id <= lastId) throw new Error(`global id order broken at ${f} (id ${row.id} after ${lastId})`);
      lastId = row.id;
      rows.push(row);
    }
  }
  return rows;
}

function readdirSorted(dir) {
  return readdirSync(dir).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

async function runPersist() {
  if (!existsSync(DB_PATH)) throw new Error(`database not found: ${DB_PATH}`);
  const rows = loadBaseRows();
  console.log(`[persist] loaded ${rows.length} base rows from cache`);
  if (rows.length === 0) throw new Error("no cached rows — run --phase fetch first");

  const facets = await fetchFacets();
  const flagSlice = (n) => new Set(JSON.parse(readFileSync(path.join(SLICES_DIR, `${n}.json`), "utf8")).ids);
  const stallion = flagSlice("isStallion");
  const imported = flagSlice("isImported");
  const sport = flagSlice("isSport");
  const sportCard = flagSlice("hasSportCard");
  const importedFrom = new Map(); // id -> desc
  for (const f of facets.importedFrom) {
    const slug = String(f.value).toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const slice = JSON.parse(readFileSync(path.join(SLICES_DIR, `if-${slug}.json`), "utf8"));
    for (const id of slice.ids) {
      if (importedFrom.has(id)) throw new Error(`horse ${id} matched two importedFrom values`);
      importedFrom.set(id, f.value);
    }
  }

  const idSet = new Set(rows.map((r) => r.id));
  // Orphan parent guard: soft-deleted parents exist in production but are not
  // visible through the public API. Null those links and record quality issues.
  const orphanParents = [];
  for (const r of rows) {
    if (r.father_id != null && !idSet.has(r.father_id)) orphanParents.push([r.id, "father_id", r.father_id]);
    if (r.mother_id != null && !idSet.has(r.mother_id)) orphanParents.push([r.id, "mother_id", r.mother_id]);
  }

  // People: dedupe owner/breeder/importer/passport_receiver by (latin|native).
  const peopleKey = (latin, native) => `${(latin ?? "").trim().toLowerCase()}|${(native ?? "").trim()}`;
  const people = new Map(); // key -> {id, latin, native}
  const horsePeople = []; // {horseId, personId, role}
  const roleTexts = new Map(); // horseId -> {owner:[],breeder:[],importer:[],passport_receiver:[]}
  for (const r of rows) {
    for (const [role, latin, native] of [
      ["owner", r.owner_name, r.owner_name_native],
      ["breeder", r.breeder_name, r.breeder_name_native],
      ["importer", r.importer_name, r.importer_name_native],
      ["passport_receiver", r.passport_receiver_name, r.passport_receiver_name_native],
    ]) {
      if (latin == null || String(latin).trim() === "") continue;
      const key = peopleKey(latin, native);
      if (!people.has(key)) people.set(key, { id: people.size + 1, latin: String(latin).trim(), native: native != null && String(native).trim() !== "" ? String(native).trim() : null });
      const person = people.get(key);
      horsePeople.push({ horseId: r.id, personId: person.id, role });
      const bag = roleTexts.get(r.id) ?? { owner: [], breeder: [], importer: [], passport_receiver: [] };
      bag[role].push(`${person.latin ?? ""} ${person.native ?? ""}`.trim());
      roleTexts.set(r.id, bag);
    }
  }
  console.log(`[persist] people deduped: ${people.size}, role links: ${horsePeople.length}`);
  console.log(`[persist] orphan parent links to null: ${orphanParents.length}`);

  // Canonical content hash of this restore artifact (rows in id order).
  const hash = createHash("sha256");
  for (const r of rows) hash.update(JSON.stringify(r) + "\n");
  const sourceSha = hash.digest("hex");

  const db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA foreign_keys=OFF");
  const clearSql = readFileSync("scripts/clear-local-registry-data.sql", "utf8");
  console.log("[persist] clearing existing registry data ...");
  db.exec(clearSql);

  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  db.prepare(
    `INSERT INTO source_imports(source_filename,source_sha256,source_sheet,source_rows,started_at,completed_at,status,notes)
     VALUES(?,?,?,?,?,?, 'complete', ?)`
  ).run(
    "production-api-restore-2026-09-23.json",
    sourceSha,
    "public-api",
    rows.length,
    now,
    now,
    "Local replica restored from the production public API (browse+facets+slices) after the sandbox wipe; Turso token unavailable. Boolean/imported flags recovered via filtered slices."
  );

  console.log("[persist] inserting horses ...");
  db.exec("BEGIN");
  const insHorse = db.prepare(`INSERT INTO horses(
      id, register_no, name_latin, name_native, father_id, mother_id,
      birth_year, birth_place_desc, breed_desc, sex_desc, color_desc,
      main_strain_desc, sub_strain_desc, is_active, is_dead,
      is_imported, imported_from_desc, is_sport, is_stallion, has_sport_card,
      created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const r of rows) {
    insHorse.run(
      r.id, r.register_no ?? null, String(r.name_latin ?? ""), r.name_native ?? null,
      idSet.has(r.father_id ?? -1) ? r.father_id : null,
      idSet.has(r.mother_id ?? -1) ? r.mother_id : null,
      r.birth_year ?? null, r.birth_place_desc ?? null, r.breed_desc ?? null, r.sex_desc ?? null, r.color_desc ?? null,
      r.main_strain_desc ?? null, r.sub_strain_desc ?? null,
      r.is_active ? 1 : 0, r.is_dead ? 1 : 0,
      imported.has(r.id) ? 1 : 0, importedFrom.get(r.id) ?? null,
      sport.has(r.id) ? 1 : 0, stallion.has(r.id) ? 1 : 0, sportCard.has(r.id) ? 1 : 0,
      now, now
    );
  }
  db.exec("COMMIT");

  console.log("[persist] inserting people + role links ...");
  db.exec("BEGIN");
  const insPerson = db.prepare("INSERT INTO people(id,name_native,name_latin,created_at,updated_at) VALUES(?,?,?,?,?)");
  for (const p of people.values()) insPerson.run(p.id, p.native, p.latin, now, now);
  const insLink = db.prepare("INSERT INTO horse_people(horse_id,person_id,role,is_current,created_at) VALUES(?,?,?,1,?)");
  for (const l of horsePeople) insLink.run(l.horseId, l.personId, l.role, now);
  db.exec("COMMIT");

  console.log("[persist] rebuilding horse_search_source ...");
  db.exec("BEGIN");
  db.exec("DELETE FROM horse_search_source");
  const insSearch = db.prepare(`INSERT INTO horse_search_source(
      horse_id,name_latin,name_native,identifiers,owners,breeders,father_name,mother_name,places,breed,all_text)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
  const fatherName = new Map(rows.map((r) => [r.id, `${r.father_name ?? ""} ${r.father_name_native ?? ""}`.trim()]));
  const motherName = new Map(rows.map((r) => [r.id, `${r.mother_name ?? ""} ${r.mother_name_native ?? ""}`.trim()]));
  for (const r of rows) {
    const nameLatin = normalizeText(r.name_latin);
    const nameNative = normalizeText(r.name_native);
    const identifiers = normalizeText(r.register_no);
    const bag = roleTexts.get(r.id);
    const owners = normalizeText(bag?.owner.join(" "));
    const breeders = normalizeText(bag?.breeder.join(" "));
    const father = normalizeText(fatherName.get(r.id));
    const mother = normalizeText(motherName.get(r.id));
    const places = normalizeText(`${r.birth_place_desc ?? ""} ${importedFrom.get(r.id) ?? ""}`);
    const breed = normalizeText(`${r.breed_desc ?? ""} ${r.main_strain_desc ?? ""} ${r.sub_strain_desc ?? ""}`);
    const allText = normalizeText([
      r.id, nameLatin, nameNative, identifiers, owners, breeders,
      bag?.importer.join(" "), bag?.passport_receiver.join(" "),
      father, mother, places, breed, r.birth_year, r.sex_desc, r.color_desc,
    ].filter((x) => x != null && String(x) !== "").join(" "));
    insSearch.run(r.id, nameLatin, nameNative, identifiers, owners, breeders, father, mother, places, breed, allText);
  }
  db.exec("COMMIT");

  console.log("[persist] recording orphan-parent quality issues ...");
  db.exec("BEGIN");
  const insIssue = db.prepare(
    `INSERT INTO data_quality_issues(horse_id,issue_code,severity,field_name,message,details_json)
     VALUES(?, 'PARENT_OUTSIDE_PUBLIC_DATASET', 'info', ?, 'Parent is not visible through the public API restore (soft-deleted upstream); link nulled locally.', ?)`);
  for (const [horseId, field, parentId] of orphanParents) {
    insIssue.run(horseId, field, JSON.stringify({ field, parent_id: parentId }));
  }
  db.exec("COMMIT");

  const fk = db.prepare("PRAGMA foreign_key_check").all();
  if (fk.length > 0) throw new Error(`foreign_key_check violations: ${fk.length}`);
  db.close();
  console.log("[persist] DONE — next: node tools/post-sync-indexes.mjs && python3 tools/build_analytics_snapshot.py " + DB_PATH);
}

// ---------------------------------------------------------------------------
// VERIFY
// ---------------------------------------------------------------------------

async function runVerify() {
  const facets = await fetchFacets();
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  const q = (sql) => db.prepare(sql).get();
  const problems = [];

  const total = q("SELECT COUNT(*) AS n FROM horses").n;
  const expectedTotal = facets.breeds.reduce((a, b) => a + b.count, 0);
  console.log(`horses: ${total}`);
  if (total !== expectedTotal) problems.push(`horse count ${total} != facet sum ${expectedTotal}`);

  for (const [key, column, facet] of [
    ["breed", "breed_desc", "breeds"],
    ["sex", "sex_desc", "sexes"],
    ["color", "color_desc", "colors"],
    ["mainStrain", "main_strain_desc", "mainStrains"],
  ]) {
    const local = new Map(db.prepare(`SELECT ${column} AS v, COUNT(*) AS n FROM horses WHERE deleted_at IS NULL AND ${column} IS NOT NULL AND TRIM(${column})<>'' GROUP BY ${column}`).all().map((r) => [r.v, r.n]));
    let mismatch = 0;
    for (const f of facets[facet]) {
      if (local.get(f.value) !== f.count) { mismatch++; if (mismatch <= 3) problems.push(`${key} facet ${f.value}: local ${local.get(f.value) ?? 0} != ${f.count}`); }
    }
    console.log(`facet ${key}: ${local.size} distinct (upstream shows ${facets[facet].length}${mismatch ? `, MISMATCHES: ${mismatch}` : ", counts match"})`);
  }

  // importedFrom: compare against LIVE browse totals, not the cached analytics
  // snapshot — production's snapshot facet for at least one value (BELGIUM)
  // lags its own live data by one horse, so the snapshot is not authoritative.
  {
    const local = new Map(db.prepare(`SELECT imported_from_desc AS v, COUNT(*) AS n FROM horses WHERE deleted_at IS NULL AND imported_from_desc IS NOT NULL AND TRIM(imported_from_desc)<>'' GROUP BY imported_from_desc`).all().map((r) => [r.v, r.n]));
    let checked = 0;
    for (const f of facets.importedFrom) {
      const live = await fetchJson(`${BASE}/api/horses?importedFrom=${encodeURIComponent(f.value)}&limit=1`);
      checked++;
      if (local.get(f.value) !== live.total) problems.push(`importedFrom ${f.value}: local ${local.get(f.value) ?? 0} != live ${live.total}`);
    }
    console.log(`facet importedFrom: ${local.size} distinct, ${checked} live totals checked`);
  }

  const lifecycle = Object.fromEntries(db.prepare("SELECT CASE WHEN is_active=1 AND is_dead=0 THEN 'active' WHEN is_dead=1 THEN 'deceased' ELSE 'inactive' END AS k, COUNT(*) AS n FROM horses WHERE deleted_at IS NULL GROUP BY k").all().map((r) => [r.k, r.n]));
  for (const f of facets.lifecycle) {
    if (lifecycle[f.value] !== f.count) problems.push(`lifecycle ${f.value}: ${lifecycle[f.value] ?? 0} != ${f.count}`);
  }
  console.log("lifecycle:", JSON.stringify(lifecycle));

  const flags = {
    imported: q("SELECT COUNT(*) AS n FROM horses WHERE deleted_at IS NULL AND is_imported=1").n,
    stallion: q("SELECT COUNT(*) AS n FROM horses WHERE deleted_at IS NULL AND is_stallion=1").n,
    sport: q("SELECT COUNT(*) AS n FROM horses WHERE deleted_at IS NULL AND is_sport=1").n,
    sport_card: q("SELECT COUNT(*) AS n FROM horses WHERE deleted_at IS NULL AND has_sport_card=1").n,
  };
  for (const f of facets.flags) {
    if (flags[f.value] !== f.count) problems.push(`flag ${f.value}: ${flags[f.value]} != ${f.count}`);
  }
  console.log("flags:", JSON.stringify(flags));

  console.log("search_source:", q("SELECT COUNT(*) AS n FROM horse_search_source").n,
    "people:", q("SELECT COUNT(*) AS n FROM people").n,
    "role_links:", q("SELECT COUNT(*) AS n FROM horse_people").n,
    "import:", JSON.stringify(q("SELECT source_filename, status, source_rows FROM source_imports ORDER BY id DESC LIMIT 1")));
  db.close();

  if (problems.length) {
    console.error("VERIFY FAILED:");
    for (const p of problems) console.error("  -", p);
    process.exit(1);
  }
  console.log("VERIFY PASSED");
}

// ---------------------------------------------------------------------------

const phases = { fetch: runFetch, persist: runPersist, verify: runVerify };
if (!phases[PHASE]) {
  console.error(`unknown phase: ${PHASE} (fetch|persist|verify|all)`);
  process.exit(2);
}
if (PHASE === "all") {
  await runFetch();
  await runPersist();
  await runVerify();
} else {
  await phases[PHASE]();
}

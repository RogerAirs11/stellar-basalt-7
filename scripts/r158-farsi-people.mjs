// R158 Stage A: generate proper Farsi owner/people names and propagate them
// through the registry's three derived layers (all on the Supabase primary):
//   1. people.name_native            — transliterate Latin-only natives
//   2. horse_registry_people_summary — recompute *_native columns from people
//   3. horse_search_source           — recompute owners/breeders/all_text
// Safety: never overwrites an existing genuine Persian native name.
// Dry-run by default: pass --apply to write.
import postgres from "postgres";
import { toFarsi } from "./r158-transliterator.mjs";

const APPLY = process.argv.includes("--apply");
const STEP3_ONLY = process.argv.includes("--step3");
const sql = postgres(
  `postgresql://postgres.gqzglbknkodyasqfrqfv:${process.env.SUPA_PW || "G1RSQJRHMH6qKxSKqF5gQlnCiMaC"}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require`,
  { max: 4, prepare: false },
);

const needsFarsi = (latin, native) =>
  !!latin && latin.trim() !== "" &&
  (native == null || native.trim() === "" || native === latin || !/[\u0600-\u06FF]/.test(native));

/* ---------------- step 1: people.name_native ---------------- */
if (STEP3_ONLY) console.log("[skip 1-2: --step3]");
console.log("[1/3] people.name_native ..." + (STEP3_ONLY ? " (skipped)" : ""));
const people = STEP3_ONLY ? [] : await sql`
  SELECT id, name_latin, name_native FROM people
  WHERE deleted_at IS NULL AND name_latin IS NOT NULL AND name_latin <> ''
    AND (name_native IS NULL OR name_native = '' OR name_native = name_latin OR name_native !~ '[\u0600-\u06FF]')`;
console.log(`  candidates: ${people.length}`);
const updates = [];
for (const p of people) {
  const fa = toFarsi(p.name_latin).trim();
  if (!fa || !/[\u0600-\u06FF]/.test(fa)) continue;
  if (p.name_native === fa) continue;
  updates.push({ id: Number(p.id), native: fa });
}
console.log(`  to update: ${updates.length}`);
if (APPLY) {
  const BATCH = 800;
  for (let i = 0; i < updates.length; i += BATCH) {
    const chunk = updates.slice(i, i + BATCH);
    await sql`
      UPDATE people SET name_native = v.native, updated_at = now()
      FROM jsonb_to_recordset(${JSON.stringify(chunk)}::text::jsonb) AS v(id bigint, native text)
      WHERE people.id = v.id`;
  }
  console.log(`  people updated: ${updates.length}`);
} else {
  for (const u of updates.slice(0, 8)) console.log(`  sample: #${u.id} -> ${u.native}`);
}

/* ---------------- step 2: summary native columns ---------------- */
// Mirrors registryPersonDisplayFallbackSql: current-role person, first by
// name_latin NOCASE then id — recomputed only for *_native columns so the
// materialized summary keeps its revision invariants.
const summaryRoles = ["owner", "breeder", "importer", "passport_receiver"];
console.log("[2/3] horse_registry_people_summary *_native ...");
if (APPLY && !STEP3_ONLY) {
  for (const role of summaryRoles) {
    const col = `${role}_name_native`;
    const r = await sql`
      WITH ranked AS (
        SELECT hp.horse_id, p.name_native AS val,
               row_number() OVER (
                 PARTITION BY hp.horse_id
                 ORDER BY lower(p.name_latin) ASC NULLS LAST, p.id ASC
               ) AS rn
        FROM horse_people hp
        JOIN people p ON p.id = hp.person_id AND p.deleted_at IS NULL
        WHERE hp.role = ${role} AND hp.is_current = 1
      )
      UPDATE horse_registry_people_summary ps
      SET ${sql(col)} = ranked.val
      FROM ranked
      WHERE ranked.horse_id = ps.horse_id AND ranked.rn = 1 AND ps.${sql(col)} IS DISTINCT FROM ranked.val`;
    console.log(`  ${col}: updated rows = ${r.count}`);
  }
} else {
  console.log("  (skipped in dry-run)");
}

/* ---------------- step 3: search source refresh ---------------- */
// Same construction as scripts/turn35-search-rebuild.js (which the live
// index was built with): owners/breeders from the summary, all_text joined.
console.log("[3/3] horse_search_source owners/breeders/all_text ...");
if (APPLY) {
  const CHUNK = 2000;
  const totalRows = Number((await sql`SELECT COUNT(*) c FROM horse_search_source`)[0].c);
  console.log(`  source rows: ${totalRows}`);
  let done = 0;
  for (let offset = 0; offset < totalRows; offset += CHUNK) {
    const ids = (await sql`SELECT horse_id FROM horse_search_source ORDER BY horse_id OFFSET ${offset} LIMIT ${CHUNK}`).map((r) => Number(r.horse_id));
    if (!ids.length) break;
    const start = ids[0], end = ids[ids.length - 1];
    const r = await sql`
      UPDATE horse_search_source s SET
        owners = j.owners, breeders = j.breeders, all_text = j.all_text, updated_at = now()
      FROM (
        SELECT s2.horse_id,
          trim(COALESCE(ps.owner_name,'') || ' ' || COALESCE(ps.owner_name_native,'')) AS owners,
          trim(COALESCE(ps.breeder_name,'') || ' ' || COALESCE(ps.breeder_name_native,'')) AS breeders,
          trim(COALESCE(s2.horse_id::text,'')) || ' ' || COALESCE(s2.name_latin,'') || ' ' || COALESCE(s2.name_native,'') || ' ' || COALESCE(s2.identifiers,'') || ' '
            || trim(COALESCE(ps.owner_name,'') || ' ' || COALESCE(ps.owner_name_native,'')) || ' '
            || trim(COALESCE(ps.breeder_name,'') || ' ' || COALESCE(ps.breeder_name_native,'')) || ' '
            || COALESCE(ps.importer_name,'') || ' ' || COALESCE(ps.passport_receiver_name,'') || ' '
            || COALESCE((SELECT string_agg(a.alias, ' ') FROM horse_aliases a WHERE a.horse_id = s2.horse_id),'') || ' '
            || COALESCE(s2.father_name,'') || ' ' || COALESCE(s2.mother_name,'') || ' '
            || COALESCE(s2.places,'') || ' ' || COALESCE(s2.breed,'') || ' '
            || COALESCE(h.birth_year::text,'') || ' ' || COALESCE(h.sex_desc,'') || ' ' || COALESCE(h.color_desc,'')
          AS all_text
        FROM horse_search_source s2
        LEFT JOIN horse_registry_people_summary ps ON ps.horse_id = s2.horse_id
        LEFT JOIN horses h ON h.id = s2.horse_id
        WHERE s2.horse_id BETWEEN ${start} AND ${end}
      ) j
      WHERE s.horse_id = j.horse_id AND (s.owners IS DISTINCT FROM j.owners OR s.breeders IS DISTINCT FROM j.breeders)`;
    done += r.count;
    console.log(`  chunk ${start}-${end}: updated ${r.count} (total ${done})`);
  }
  console.log(`  search source refreshed: ${done}`);
} else {
  console.log("  (skipped in dry-run)");
}

await sql.end();
console.log(APPLY ? "APPLIED." : "DRY-RUN ONLY (pass --apply to write).");

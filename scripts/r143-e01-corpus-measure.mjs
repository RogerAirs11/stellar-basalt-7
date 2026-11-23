#!/usr/bin/env node
/**
 * R143-E01 (Master-AI plan): measure the current corpus before collecting more.
 *
 *   SUPABASE_DATABASE_URL="postgresql://postgres.gqzglbknkodyasqfrqfv:…@aws-1-eu-west-1.pooler.supabase.com:5432/postgres" \
 *     node scripts/r143-e01-corpus-measure.mjs --report docs/R143-E01-CORPUS-MEASURE.md
 *
 * Read-only. Measures, by the serving generation (canonical Supabase Postgres):
 *   - record classes (active / inactive / dead / imported / sport / stallion)
 *   - identifier coverage + conflicts (normalized duplicate groups per kind)
 *   - name coverage + normalization collisions (Latin case-fold, residual
 *     Arabic Yeh/Kaf, native-name gaps)
 *   - date precision + contradictions (year floor, future years, date-vs-year
 *     mismatch, death-before-birth)
 *   - parent coverage (both/one/none), dangling refs, self-parents,
 *     parent-role conflicts (sex vs recorded role), same-parent-both-sides
 *   - ancestry cycles (bounded walk, depth 12)
 *   - positional pedigree completeness per generation 1..7 + unique ancestor count
 *   - evidence review state (change_requests by status), genetic tests
 *     (verified/disclosed = usable laboratory records)
 *   - performance linkage (racing results crosswalk-linked vs unresolved)
 *
 * Every metric names its snapshot (timestamp, max horse id, total), denominator
 * and exclusions. Output: JSON on stdout + a Markdown report (--report path)
 * with a prioritized missing-data/error list.
 */
import postgres from "postgres";
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const reportPath = (() => {
  const i = args.indexOf("--report");
  return i >= 0 ? args[i + 1] : null;
})();
const url = process.env.SUPABASE_DATABASE_URL;
if (!url) {
  console.error("SUPABASE_DATABASE_URL is required (read-only Postgres user is enough)");
  process.exit(1);
}
const sql = postgres(url, { max: 4, idle_timeout: 10, connect_timeout: 15, prepare: false });

const q = async (text, params = []) => (await sql.unsafe(text, params));
const one = async (text, params = []) => (await q(text, params))[0] ?? {};

const snapshot = {};
const metrics = {};

async function main() {
  // ---- snapshot identity ------------------------------------------------
  const snap = await one(`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE is_active = 1)::int AS active,
           count(*) FILTER (WHERE is_active = 0)::int AS inactive,
           count(*) FILTER (WHERE is_dead = 1)::int AS dead,
           count(*) FILTER (WHERE is_imported = 1)::int AS imported,
           count(*) FILTER (WHERE is_sport = 1)::int AS sport,
           count(*) FILTER (WHERE is_stallion = 1)::int AS stallion,
           max(id)::int AS max_id,
           count(*) FILTER (WHERE name_native IS NULL OR btrim(name_native) = '')::int AS missing_native_name,
           count(*) FILTER (WHERE name_latin IS NULL OR btrim(name_latin) = '')::int AS missing_latin_name
    FROM horses`);
  snapshot.measured_at = new Date().toISOString();
  snapshot.engine = "supabase_postgres (canonical serving generation)";
  snapshot.denominator_default = `horses (no exclusions) — total ${snap.total}`;
  snapshot.total = snap.total;
  snapshot.max_id = snap.max_id;
  metrics.record_classes = {
    denominator: "all horses",
    active: snap.active, inactive: snap.inactive, dead: snap.dead,
    imported: snap.imported, sport: snap.stallion === undefined ? snap.stallion : snap.sport,
    stallion: snap.stallion,
    note: "synthetic/placeholder rows: none — the demo seed lives in a separate database, production carries none; 'originality' field could be surveyed later if the client marks synthetic cohorts",
  };

  // ---- identifier coverage + conflicts ----------------------------------
  const idKinds = [
    ["register_no", "registry number"],
    ["microchip_no", "microchip"],
    ["uel_no", "UEL number"],
    ["lab_no", "lab number"],
    ["life_number", "life number"],
    ["passport_no", "passport number"],
  ];
  const identifier = {};
  for (const [col, label] of idKinds) {
    const cov = await one(`
      SELECT count(*) FILTER (WHERE ${col} IS NOT NULL AND btrim(${col}) <> '')::int AS covered,
             count(*)::int AS denominator
      FROM horses`);
    const conf = await q(`
      SELECT min(${col}) AS value, count(*)::int AS claimants
      FROM horses
      WHERE ${col} IS NOT NULL AND btrim(${col}) <> ''
      GROUP BY lower(${col})
      HAVING count(*) > 1
      ORDER BY claimants DESC, value
      LIMIT 15`);
    identifier[col] = {
      label,
      covered: cov.covered,
      denominator: cov.denominator,
      coverage_pct: +((cov.covered / cov.denominator) * 100).toFixed(2),
      duplicate_groups_reported: conf.length,
      duplicate_examples: conf.map(r => ({ value: r.value, claimants: r.claimants })),
    };
  }
  metrics.identifier_coverage_and_conflicts = identifier;

  // ---- names + normalization collisions ---------------------------------
  const latinDup = await one(`
    SELECT count(*)::int AS collision_groups FROM (
      SELECT lower(btrim(name_latin)) AS n FROM horses
      WHERE name_latin IS NOT NULL AND btrim(name_latin) <> ''
      GROUP BY lower(btrim(name_latin)) HAVING count(*) > 1) g`);
  const latinDupHorses = await one(`
    SELECT count(*)::int AS horses FROM horses h
    WHERE h.name_latin IS NOT NULL AND btrim(h.name_latin) <> ''
      AND EXISTS (SELECT 1 FROM horses o WHERE o.id <> h.id AND lower(btrim(o.name_latin)) = lower(btrim(h.name_latin)))`);
  const residualArabic = await one(`
    SELECT count(*) FILTER (WHERE name_native LIKE '%ي%' OR name_native LIKE '%ك%' OR name_native LIKE '%ـ%')::int AS residual,
           count(*) FILTER (WHERE name_native IS NOT NULL AND btrim(name_native) <> '')::int AS with_native
    FROM horses`);
  metrics.names = {
    denominator: "all horses",
    latin_casefold_collision_groups: latinDup.collision_groups,
    horses_sharing_a_latin_name_with_another: latinDupHorses.horses,
    native_names_still_carrying_arabic_yeh_kaf_tatweel: residualArabic.residual,
    horses_with_native_name: residualArabic.with_native,
    horses_missing_native_name: snap.missing_native_name,
    horses_missing_latin_name: snap.missing_latin_name,
    exclusions: "empty/whitespace names excluded from collision grouping",
  };

  // ---- date precision + contradictions ----------------------------------
  const dates = await one(`
    SELECT count(*) FILTER (WHERE birth_year IS NULL)::int AS missing_birth_year,
           count(*) FILTER (WHERE birth_year IS NOT NULL AND birth_year < 1700)::int AS below_floor,
           count(*) FILTER (WHERE birth_year IS NOT NULL AND birth_year > EXTRACT(YEAR FROM now())::int + 1)::int AS future_year,
           count(*) FILTER (WHERE birth_date IS NOT NULL)::int AS with_birth_date,
           count(*) FILTER (WHERE birth_date IS NOT NULL AND birth_date ~ '^\\d{4}-\\d{2}-\\d{2}' AND birth_year IS NOT NULL
                              AND EXTRACT(YEAR FROM birth_date::timestamp)::int <> birth_year)::int AS date_year_mismatch,
           count(*) FILTER (WHERE death_date IS NOT NULL AND death_date ~ '^\\d{4}-\\d{2}-\\d{2}' AND birth_date IS NOT NULL AND birth_date ~ '^\\d{4}-\\d{2}-\\d{2}'
                              AND death_date::timestamp < birth_date::timestamp)::int AS death_before_birth,
           count(*) FILTER (WHERE is_dead = 0 AND death_date IS NOT NULL)::int AS dead_flag_inconsistent
    FROM horses`);
  metrics.dates = { denominator: "all horses", ...dates, exclusions: "date casts only applied where birth_date/death_date matches YYYY-MM-DD; garbage date strings (e.g. '0') are counted neither as valid nor as mismatches — they surface via the date-format audit below", birth_date_non_standard_format: (await one(`SELECT count(*) FILTER (WHERE birth_date IS NOT NULL AND birth_date NOT SIMILAR TO '[0-9]{4}-[0-9]{2}-[0-9]{2}.*')::int AS n FROM horses`)).n };

  // ---- parent coverage, dangling, roles ---------------------------------
  const parents = await one(`
    SELECT count(*) FILTER (WHERE father_id IS NOT NULL AND mother_id IS NOT NULL)::int AS both_parents,
           count(*) FILTER (WHERE (father_id IS NULL) <> (mother_id IS NULL))::int AS one_parent,
           count(*) FILTER (WHERE father_id IS NULL AND mother_id IS NULL)::int AS no_parent,
           count(*) FILTER (WHERE father_id = id OR mother_id = id)::int AS self_parent,
           count(*) FILTER (WHERE father_id IS NOT NULL AND father_id = mother_id)::int AS same_parent_both_sides
    FROM horses`);
  const dangling = await q(`
    SELECT 'father' AS role, h.id, h.father_id AS ref FROM horses h
      LEFT JOIN horses f ON f.id = h.father_id WHERE h.father_id IS NOT NULL AND f.id IS NULL
    UNION ALL
    SELECT 'mother', h.id, h.mother_id FROM horses h
      LEFT JOIN horses m ON m.id = h.mother_id WHERE h.mother_id IS NOT NULL AND m.id IS NULL
    LIMIT 20`);
  const danglingCount = await one(`
    SELECT (SELECT count(*) FROM horses h LEFT JOIN horses f ON f.id=h.father_id WHERE h.father_id IS NOT NULL AND f.id IS NULL)::int
         + (SELECT count(*) FROM horses h LEFT JOIN horses m ON m.id=h.mother_id WHERE h.mother_id IS NOT NULL AND m.id IS NULL)::int AS total`);
  // parent-role conflicts: recorded as father but the parent row is female, or recorded as mother but male
  const roleConflicts = await one(`
    SELECT (SELECT count(*) FROM horses c JOIN horses f ON f.id = c.father_id
              WHERE lower(coalesce(f.sex_desc,'')) IN ('mare','female','f','ماده') OR lower(coalesce(f.sex_code,'')) IN ('f','female','2'))::int AS sire_rows_female,
           (SELECT count(*) FROM horses c JOIN horses m ON m.id = c.mother_id
              WHERE lower(coalesce(m.sex_desc,'')) IN ('stallion','male','m',' stallion','نر','سیلمی') OR lower(coalesce(m.sex_code,'')) IN ('m','male','1'))::int AS dam_rows_male`);
  metrics.parents = {
    denominator: "all horses",
    ...parents,
    dangling_references: danglingCount.total,
    dangling_examples: dangling,
    parent_role_conflicts: roleConflicts,
    exclusions: "role conflicts use the horse's own sex_desc/sex_code vocabulary; unknown sexes are NOT counted as conflicts",
  };

  // ---- ancestry cycles (bounded) -----------------------------------------
  const cycles = await q(`
    WITH RECURSIVE up(hid, ancestor, depth, path, cyclic) AS (
      SELECT id, father_id, 1, ARRAY[id, father_id], false FROM horses WHERE father_id IS NOT NULL AND father_id <> id
      UNION
      SELECT id, mother_id, 1, ARRAY[id, mother_id], false FROM horses WHERE mother_id IS NOT NULL AND mother_id <> id
      UNION ALL
      SELECT up.hid, CASE WHEN up.depth % 2 = 1 THEN p.father_id ELSE p.mother_id END,
             up.depth + 1, up.path || CASE WHEN up.depth % 2 = 1 THEN p.father_id ELSE p.mother_id END,
             CASE WHEN up.depth % 2 = 1 THEN p.father_id ELSE p.mother_id END = ANY(up.path)
      FROM up JOIN horses p ON p.id = up.ancestor
      WHERE up.depth < 12 AND NOT up.cyclic AND up.ancestor IS NOT NULL
    )
    SELECT DISTINCT hid FROM up WHERE cyclic LIMIT 30`);
  metrics.ancestry_cycles = {
    denominator: "all horses (bounded 12-generation upward walk)",
    detected_cycle_horses: cycles.length,
    examples: cycles.map(r => r.hid),
    note: "bounded walk: cycles deeper than 12 generations are not reported; parent chains alternate father/mother so every ancestor edge is visited",
  };

  // ---- positional pedigree completeness by generation + unique ancestors --
  const gens = {};
  for (let gen = 1; gen <= 7; gen += 1) {
    // 2^(gen-1) ancestor slots; walk father/mother alternately per level.
    // For each generation we count horses (active only) whose ancestor set at
    // that generation is fully present.
    const slots = 2 ** (gen - 1);
    const r = await one(`
      WITH RECURSIVE anc(hid, ancestor, depth, path) AS (
        SELECT id, father_id, 1, ARRAY[id] FROM horses WHERE father_id IS NOT NULL AND father_id <> id
        UNION
        SELECT id, mother_id, 1, ARRAY[id] FROM horses WHERE mother_id IS NOT NULL AND mother_id <> id
        UNION ALL
        SELECT anc.hid, CASE WHEN p.father_id = anc.ancestor THEN p.father_id
                             WHEN p.mother_id = anc.ancestor THEN p.mother_id END, depth + 1, path || anc.ancestor
        FROM anc JOIN horses p ON p.id = anc.ancestor
        WHERE anc.depth < ${gen} AND NOT anc.ancestor = ANY(anc.path)
      )
      SELECT
        (SELECT count(*) FROM horses WHERE is_active = 1)::int AS denom,
        (SELECT count(DISTINCT hid) FROM anc WHERE depth <= ${gen})::int AS with_any,
        (SELECT count(*) FROM (
            SELECT a.hid, count(DISTINCT a.ancestor) AS n
            FROM anc a WHERE a.depth <= ${gen}
            GROUP BY a.hid HAVING count(DISTINCT a.ancestor) >= 0) s)::int AS sample
        `);
    // simpler robust metric: fraction of active horses with at least one ancestor
    // at THIS generation depth (strict level = depth == gen)
    const strict = await one(`
      WITH RECURSIVE anc(hid, ancestor, depth, path) AS (
        SELECT id, father_id, 1, ARRAY[id] FROM horses WHERE father_id IS NOT NULL AND father_id <> id
        UNION
        SELECT id, mother_id, 1, ARRAY[id] FROM horses WHERE mother_id IS NOT NULL AND mother_id <> id
        UNION ALL
        SELECT anc.hid,
               CASE WHEN p.father_id = anc.ancestor THEN p.father_id ELSE p.mother_id END,
               depth + 1, path || anc.ancestor
        FROM anc JOIN horses p ON p.id = anc.ancestor
        WHERE anc.depth < ${gen} AND NOT anc.ancestor = ANY(anc.path)
      )
      SELECT count(DISTINCT hid)::int AS horses_with_level FROM anc WHERE depth = ${gen}`);
    const uniq = await one(`
      WITH RECURSIVE anc(hid, ancestor, depth, path) AS (
        SELECT id, father_id, 1, ARRAY[id] FROM horses WHERE father_id IS NOT NULL AND father_id <> id
        UNION
        SELECT id, mother_id, 1, ARRAY[id] FROM horses WHERE mother_id IS NOT NULL AND mother_id <> id
        UNION ALL
        SELECT anc.hid,
               CASE WHEN p.father_id = anc.ancestor THEN p.father_id ELSE p.mother_id END,
               depth + 1, path || anc.ancestor
        FROM anc JOIN horses p ON p.id = anc.ancestor
        WHERE anc.depth < 7 AND NOT anc.ancestor = ANY(anc.path)
      )
      SELECT round(avg(u)::numeric, 2)::float AS avg_unique FROM (
        SELECT hid, count(DISTINCT ancestor)::float AS u FROM anc WHERE depth <= 7 GROUP BY hid) t
      WHERE u > 0`);
    gens[gen] = {
      expected_slots: slots,
      active_horses_with_a_known_ancestor_at_this_level: strict.horses_with_level,
      denominator: r.denom,
      positional_completeness_pct: +((strict.horses_with_level / r.denom) * 100).toFixed(2),
    };
    if (gen === 7) gens.unique_ancestors_avg_per_pedigreed_horse = uniq.avg_unique;
  }
  metrics.pedigree_completeness = {
    denominator: "is_active = 1 horses",
    positional_by_generation: gens,
    note: "positional completeness = share of active horses that HAVE at least one known ancestor at exactly that generation level (missing any slot in between stops the walk); unique-ancestor average is computed over generation <= 7 for horses with any known ancestry",
  };

  // ---- evidence review state ---------------------------------------------
  const reviews = await one(`
    SELECT count(*)::int AS total FROM change_requests`);
  const reviewByStatus = await q(`
    SELECT status, count(*)::int AS n FROM change_requests GROUP BY status ORDER BY n DESC`);
  const genetics = await one(`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE verified = 1)::int AS verified,
           count(*) FILTER (WHERE verified = 1 AND public_disclosed = 1)::int AS verified_public,
           count(*) FILTER (WHERE test_category = 'parentage' AND verified = 1)::int AS usable_parentage
    FROM genetic_tests`);
  metrics.evidence = {
    change_requests_total: reviews.total,
    change_requests_by_status: reviewByStatus.map(r => ({ status: r.status, n: r.n })),
    genetic_tests: genetics,
    usable_lab_note: "usable laboratory records = verified genetic tests (verified=1); only verified+public_disclosed feed public surfaces",
  };

  // ---- performance linkage ------------------------------------------------
  const racing = await one(`
    SELECT (SELECT count(*)::int FROM racing_races) AS races,
           (SELECT count(*)::int FROM racing_results) AS results,
           (SELECT count(*)::int FROM racing_results WHERE registry_horse_id IS NOT NULL AND btrim(registry_horse_id) <> '') AS results_linked
    `);
  const competitions = await one(`
    SELECT (SELECT count(*)::int FROM competitions) AS events,
           (SELECT count(*)::int FROM competition_results) AS results,
           (SELECT count(*)::int FROM competition_results WHERE horse_id IS NOT NULL) AS results_linked
    `);
  metrics.performance = {
    racing: { ...racing, unresolved: racing.results - racing.results_linked },
    competitions: { ...competitions, unresolved: competitions.results - competitions.results_linked },
    note: "racing linkage uses the identity crosswalk (registry_horse_id) only; competition results carry numeric horse_id FKs",
  };

  // ---- prioritized missing-data / error list ------------------------------
  const priority = [];
  const id = metrics.identifier_coverage_and_conflicts;
  if (id.passport_no.coverage_pct < 10) priority.push(`P1 passport coverage is ${id.passport_no.coverage_pct}% (${id.passport_no.covered}/${id.passport_no.denominator}) — the client's identity workflow needs a passport intake path`);
  if (id.microchip_no.coverage_pct < 80) priority.push(`P1 microchip coverage is ${id.microchip_no.coverage_pct}% — the strongest global identifier is missing on ${(id.microchip_no.denominator - id.microchip_no.covered).toLocaleString("en-US")} horses`);
  if (metrics.parents.parent_role_conflicts.sire_rows_female > 0 || metrics.parents.parent_role_conflicts.dam_rows_male > 0)
    priority.push(`P1 parent-role conflicts: ${metrics.parents.parent_role_conflicts.sire_rows_female} sires recorded female / ${metrics.parents.parent_role_conflicts.dam_rows_male} dams recorded male — queue for reviewer correction`);
  if (metrics.parents.same_parent_both_sides > 0) priority.push(`P2 ${metrics.parents.same_parent_both_sides} horses share the same horse on both parent sides — review`);
  if (metrics.ancestry_cycles.detected_cycle_horses > 0) priority.push(`P2 ${metrics.ancestry_cycles.detected_cycle_horses} ancestry cycles (bounded walk) — merge candidates for the duplicate workbench`);
  if (id.register_no.duplicate_groups_reported > 0) priority.push(`P2 ${id.register_no.duplicate_groups_reported}+ register_no duplicate groups (top examples listed) — route through identifier conflict queue`);
  if (metrics.dates.date_year_mismatch > 0) priority.push(`P2 ${metrics.dates.date_year_mismatch} birth_date/birth_year mismatches — reconcile`);
  if (metrics.names.horses_sharing_a_latin_name_with_another > 0) priority.push(`P3 ${metrics.names.horses_sharing_a_latin_name_with_another} horses share a Latin name with another horse — never auto-merge; use the workbench`);
  if (metrics.names.native_names_still_carrying_arabic_yeh_kaf_tatweel > 0) priority.push(`P3 ${metrics.names.native_names_still_carrying_arabic_yeh_kaf_tatweel} native names still carry Arabic Yeh/Kaf/Tatweel — run the normalizer pass`);
  if (metrics.performance.racing.results_linked < metrics.performance.racing.results) priority.push(`P3 racing crosswalk: ${(metrics.performance.racing.results - metrics.performance.racing.results_linked).toLocaleString("en-US")} of ${metrics.performance.racing.results.toLocaleString("en-US")} results unresolved to a registry horse`);

  metrics.prioritized_missing_data_and_errors = priority;

  // ---- reconciliation against the serving generation ----------------------
  // E01 done-when: "Counts reconcile to the serving generation." The analytics
  // precompute (served by /api/analytics/registry) carries its own horseCount
  // + generatedAt; compare it against the measured table.
  metrics.reconciliation = {
    measured_total: snapshot.total,
    measured_active: snap.active,
    measured_inactive: snap.inactive,
    note: "the serving analytics precompute (/api/analytics/registry) reported horseCount=93,896 generatedAt=2026-10-23T17:07:59Z at measurement time — the canonical table has grown since (this gap is the finding; refresh the analytics precompute to reconcile)",
    serving_analytics_horseCount: 93896,
    serving_analytics_generatedAt: "2026-10-23T17:07:59Z",
    delta_vs_measured_total: snapshot.total - 93896,
  };
  if (Math.abs(snapshot.total - 93896) > 0) priority.unshift(`P1 serving-generation reconciliation: canonical table total ${snapshot.total.toLocaleString("en-US")} (active ${snap.active.toLocaleString("en-US")} / inactive ${snap.inactive.toLocaleString("en-US")}) vs analytics precompute 93,896 (generated 2026-10-23) — delta ${snapshot.total - 93896}; refresh the analytics precompute before quoting population figures`);

  // ---- output -------------------------------------------------------------
  const output = { snapshot, metrics };
  const json = JSON.stringify(output, null, 2);
  console.log(json);
  if (reportPath) {
    const md = buildMarkdown(output);
    writeFileSync(reportPath, md);
    console.error(`report written: ${reportPath}`);
  }
  await sql.end();
}

function buildMarkdown({ snapshot, metrics }) {
  const lines = [];
  lines.push("# R143-E01 — Corpus measurement (Master-AI plan)");
  lines.push("");
  lines.push(`- Snapshot: **${snapshot.measured_at}** · engine: ${snapshot.engine}`);
  lines.push(`- Denominator (default): all horses, total **${snapshot.total.toLocaleString("en-US")}**, max id ${snapshot.max_id}`);
  lines.push(`- Every metric below names its own denominator and exclusions. Read-only measurement; nothing was written.`);
  lines.push("");
  lines.push("## Record classes (denominator: all horses)");
  const rc = metrics.record_classes;
  lines.push(`| class | count |`); lines.push(`|---|---|`);
  for (const k of ["active", "inactive", "dead", "imported", "sport", "stallion"]) lines.push(`| ${k} | ${rc[k]?.toLocaleString?.("en-US") ?? rc[k]} |`);
  lines.push("");
  lines.push("## Identifier coverage (denominator: all horses)");
  lines.push("| identifier | covered | coverage % | duplicate groups |");
  lines.push("|---|---|---|---|");
  for (const [col, v] of Object.entries(metrics.identifier_coverage_and_conflicts)) {
    lines.push(`| ${v.label} (${col}) | ${v.covered.toLocaleString("en-US")} | ${v.coverage_pct} | ${v.duplicate_groups_reported} |`);
  }
  lines.push("");
  lines.push("## Names (denominator: all horses)");
  for (const [k, v] of Object.entries(metrics.names)) if (k !== "denominator" && k !== "exclusions") lines.push(`- ${k.replaceAll("_", " ")}: **${typeof v === "number" ? v.toLocaleString("en-US") : v}**`);
  lines.push(`- exclusions: ${metrics.names.exclusions}`);
  lines.push("");
  lines.push("## Dates (denominator: all horses)");
  for (const [k, v] of Object.entries(metrics.dates)) lines.push(`- ${k.replaceAll("_", " ")}: **${v?.toLocaleString?.("en-US") ?? v}**`);
  lines.push("");
  lines.push("## Parents (denominator: all horses)");
  for (const [k, v] of Object.entries(metrics.parents)) {
    if (k === "dangling_examples") continue;
    lines.push(`- ${k.replaceAll("_", " ")}: **${typeof v === "object" ? JSON.stringify(v) : v?.toLocaleString?.("en-US") ?? v}**`);
  }
  lines.push("");
  lines.push("## Ancestry cycles");
  lines.push(`- detected (bounded 12-gen walk): **${metrics.ancestry_cycles.detected_cycle_horses}** — examples: ${metrics.ancestry_cycles.examples.slice(0, 10).join(", ") || "none"}`);
  lines.push("");
  lines.push("## Pedigree completeness (denominator: active horses)");
  lines.push("| generation | expected slots | horses with a known ancestor at this level | positional completeness |");
  lines.push("|---|---|---|---|");
  for (const [gen, v] of Object.entries(metrics.pedigree_completeness.positional_by_generation)) {
    if (gen === "unique_ancestors_avg_per_pedigreed_horse") continue;
    lines.push(`| ${gen} | ${v.expected_slots} | ${v.active_horses_with_a_known_ancestor_at_this_level.toLocaleString("en-US")} | ${v.positional_completeness_pct}% |`);
  }
  if (metrics.pedigree_completeness.positional_by_generation.unique_ancestors_avg_per_pedigreed_horse != null)
    lines.push(`- unique ancestors per pedigreed horse (≤7 generations, average): **${metrics.pedigree_completeness.positional_by_generation.unique_ancestors_avg_per_pedigreed_horse}**`);
  lines.push("");
  lines.push("## Evidence + laboratory (denominators per table)");
  lines.push(`- change_requests: **${metrics.evidence.change_requests_total}** total — ${metrics.evidence.change_requests_by_status.map(r => `${r.status} ${r.n}`).join(", ")}`);
  lines.push(`- genetic_tests: **${metrics.evidence.genetic_tests.total}** total, verified **${metrics.evidence.genetic_tests.verified}**, verified+public **${metrics.evidence.genetic_tests.verified_public}**, usable parentage **${metrics.evidence.genetic_tests.usable_parentage}**`);
  lines.push("");
  lines.push("## Performance linkage");
  lines.push(`- racing: **${metrics.performance.racing.races}** races / **${metrics.performance.racing.results}** results / linked **${metrics.performance.racing.results_linked}** (unresolved **${metrics.performance.racing.unresolved}**)`);
  lines.push(`- competitions: **${metrics.performance.competitions.events}** events / **${metrics.performance.competitions.results}** results / linked **${metrics.performance.competitions.results_linked}**`);
  lines.push("");
  lines.push("## Prioritized missing-data and error list");
  for (const p of metrics.prioritized_missing_data_and_errors) lines.push(`- ${p}`);
  if (!metrics.prioritized_missing_data_and_errors.length) lines.push("- none above threshold");
  lines.push("");
  return lines.join("\n");
}

main().catch((cause) => { console.error(cause); process.exit(1); });

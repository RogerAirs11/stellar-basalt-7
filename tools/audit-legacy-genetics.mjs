#!/usr/bin/env node
/**
 * audit-legacy-genetics — R88 agent plan P06: READ-ONLY report of legacy and
 * ambiguous genetics rows.
 *
 * What it reports:
 *   1. Legacy mislabeled locus rows (AGOUTI_ASLIP, DUN_TMEM38, CREAM_SLC36A1
 *      and case variants) — quarantined by src/genetics/assayCatalog.ts, never
 *      auto-remapped.
 *   2. The ambiguous cream/champagne contrast: CREAM_SLC36A1 rows (ambiguous
 *      legacy label — SLC36A1 is the champagne gene) vs champagne_SLC36A1
 *      rows (valid catalogued usage of the same gene symbol).
 *   3. Quarantined disease rows whose test_type is NOT in the catalog (kept as
 *      recorded_uninterpreted) — for reviewer prioritization.
 *
 * The tool is read-only BY CONSTRUCTION: it executes only SELECT statements
 * and has no apply mode. "Do not globally rename SLC36A1 because valid
 * champagne records use it" is enforced by never writing at all. Quarantine
 * review (inspecting original reports) is a human workflow; this report is
 * its input.
 *
 * Usage:
 *   SUPABASE_DATABASE_URL=... node tools/audit-legacy-genetics.mjs [--json]
 *
 * Exit codes: 0 = report produced; 2 = configuration error; 3 = query failure.
 */
import postgres from "postgres";

const json = process.argv.includes("--json");
const url = process.env.SUPABASE_DATABASE_URL;
if (!url) {
  console.error("Need SUPABASE_DATABASE_URL (canonical registry source). This tool is read-only.");
  process.exit(2);
}
const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 15 });

const LEGACY_PATTERNS = [
  { needle: "AGOUTI_ASLIP", suggested: "agouti_ASIP", note: "Agouti locus gene symbol is ASIP; legacy ASLIP rows await reviewed mapping." },
  { needle: "DUN_TMEM38", suggested: "dun_TBX3", note: "Dun pigmentation is associated with TBX3 regulation; legacy TMEM38 rows await reviewed mapping." },
  { needle: "CREAM_SLC36A1", suggested: "cream_SLC45A2 OR champagne_SLC36A1", note: "Ambiguous legacy label: SLC36A1 is the champagne gene, not cream. Inspect the original report; never automatically remap." },
];

const CATALOGUED_DISEASE_ASSAYS = ["SCID", "CA", "LFS", "OLWS", "HYPP", "GBED", "JEB1", "JEB2", "MH", "PSSM1"];
const CATALOGUED_COAT_LOCI = [
  "extension_MC1R", "agouti_ASIP", "gray_STX17", "dun_TBX3", "cream_SLC45A2",
  "champagne_SLC36A1", "silver_PMEL17", "tobiano_KIT", "sabino1_KIT", "splash_PAX3",
];

async function count(needle) {
  const rows = await sql`SELECT COUNT(*)::int AS n FROM genetic_tests WHERE UPPER(test_type) = ${needle.toUpperCase()}`;
  return rows[0]?.n ?? 0;
}

async function samples(needle, limit = 5) {
  return sql`
    SELECT id, horse_id, test_type, test_category, result, verified, provenance
    FROM genetic_tests WHERE UPPER(test_type) = ${needle.toUpperCase()}
    ORDER BY id LIMIT ${limit}
  `;
}

try {
  const report = {
    tool: "audit-legacy-genetics",
    mode: "read-only",
    generated_at: new Date().toISOString(),
    assay_catalog_notes: {
      legacy_rows: "NEVER rewritten or auto-remapped; quarantined with a suggested reviewed mapping.",
      cream_champagne: "SLC36A1 is the valid champagne gene symbol — CREAM_SLC36A1 rows are ambiguous and need original-report review.",
      policy: "A laboratory report is preserved exactly as issued; interpretation is versioned separately (P06 provenance columns).",
    },
    legacy: [],
    ambiguous_contrast: {},
    quarantined_disease_rows: { count: 0, samples: [] },
    unhandled_test_types: { count: 0, samples: [] },
    changes_made: 0,
  };

  for (const pattern of LEGACY_PATTERNS) {
    const n = await count(pattern.needle);
    const rows = await samples(pattern.needle);
    report.legacy.push({ needle: pattern.needle, count: n, suggested_mapping: pattern.suggested, note: pattern.note, samples: rows });
  }

  report.ambiguous_contrast = {
    cream_SLC36A1_legacy_rows: await count("CREAM_SLC36A1"),
    champagne_SLC36A1_valid_rows: await count("champagne_SLC36A1"),
    cream_SLC45A2_valid_rows: await count("cream_SLC45A2"),
    explanation: "Valid champagne records legitimately use SLC36A1 — a global rename would corrupt them. Only CREAM_SLC36A1 rows are ambiguous.",
  };

  const uncataloguedDisease = await sql`
    SELECT COUNT(*)::int AS n FROM genetic_tests
    WHERE test_category='disease' AND UPPER(test_type) NOT IN (${sql.unsafe(CATALOGUED_DISEASE_ASSAYS.map((a) => `'${a}'`).join(","))})
  `;
  report.quarantined_disease_rows.count = uncataloguedDisease[0]?.n ?? 0;
  report.quarantined_disease_rows.samples = await sql`
    SELECT test_type, COUNT(*)::int AS n FROM genetic_tests
    WHERE test_category='disease' AND UPPER(test_type) NOT IN (${sql.unsafe(CATALOGUED_DISEASE_ASSAYS.map((a) => `'${a}'`).join(","))})
    GROUP BY test_type ORDER BY n DESC LIMIT 10
  `;

  const known = [...CATALOGUED_DISEASE_ASSAYS.map((a) => a.toUpperCase()), ...CATALOGUED_COAT_LOCI.map((a) => a.toUpperCase()), ...LEGACY_PATTERNS.map((p) => p.needle.toUpperCase())];
  const unhandled = await sql`
    SELECT COUNT(*)::int AS n FROM genetic_tests
    WHERE test_category='coat_color' AND UPPER(test_type) NOT IN (${sql.unsafe(known.map((a) => `'${a}'`).join(","))})
  `;
  report.unhandled_test_types.count = unhandled[0]?.n ?? 0;
  report.unhandled_test_types.samples = await sql`
    SELECT test_type, COUNT(*)::int AS n FROM genetic_tests
    WHERE test_category='coat_color' AND UPPER(test_type) NOT IN (${sql.unsafe(known.map((a) => `'${a}'`).join(","))})
    GROUP BY test_type ORDER BY n DESC LIMIT 10
  `;

  if (json) {
    console.log(JSON.stringify(report, null, 1));
  } else {
    console.log("audit-legacy-genetics (READ-ONLY — this tool cannot modify data)");
    console.log(`  generated: ${report.generated_at}`);
    for (const entry of report.legacy) {
      console.log(`  ${entry.needle}: ${entry.count} row(s) — ${entry.note}`);
      for (const sample of entry.samples) {
        console.log(`    sample id=${sample.id} horse=${sample.horse_id} result="${sample.result}" verified=${sample.verified}`);
      }
    }
    console.log(`  ambiguous contrast: CREAM_SLC36A1=${report.ambiguous_contrast.cream_SLC36A1_legacy_rows} (ambiguous) vs champagne_SLC36A1=${report.ambiguous_contrast.champagne_SLC36A1_valid_rows} (valid) vs cream_SLC45A2=${report.ambiguous_contrast.cream_SLC45A2_valid_rows} (valid)`);
    console.log(`  quarantined disease rows (uncatalogued test_type): ${report.quarantined_disease_rows.count}`);
    for (const row of report.quarantined_disease_rows.samples) console.log(`    ${row.test_type}: ${row.n}`);
    console.log(`  other uncatalogued coat loci: ${report.unhandled_test_types.count}`);
    for (const row of report.unhandled_test_types.samples) console.log(`    ${row.test_type}: ${row.n}`);
    console.log("  changes_made: 0 (dry-run by construction; quarantine review is a human workflow)");
  }
  process.exit(0);
} catch (error) {
  console.error(`audit-legacy-genetics failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(3);
} finally {
  await sql.end({ timeout: 5 }).catch(() => undefined);
}

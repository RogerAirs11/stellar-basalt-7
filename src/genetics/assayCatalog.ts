/**
 * Versioned exact-token assay interpretation catalog (clinical validation is separate).
 *
 * Doctrine (packet + R73 honesty rules):
 *  - No diagnosis from substring matching. "not clear" must never be labeled
 *    clear; "unaffected" prose is not a genotype.
 *  - A result is interpreted ONLY when the assay is catalogued AND the result
 *    string parses into exact allele tokens for that assay. Everything else
 *    keeps its original laboratory text with status `recorded_uninterpreted`.
 *  - Dominant vs recessive semantics matter: HYPP N/H is AFFECTED
 *    (autosomal dominant), not a carrier.
 *  - Missing / not-tested / inconclusive / conflicting retests are distinct
 *    states; a retest never silently overwrites earlier evidence.
 *  - Incorrect legacy locus labels are quarantined for
 *    reviewed mapping; SLC36A1 itself is the valid champagne gene — raw input is preserved.
 */
import { resolveConservativeEvidence } from "./evidenceResolver";

export type AssayResultStatus = "clear" | "carrier" | "affected" | "recorded_uninterpreted";
export type AssayInheritance = "recessive" | "dominant";

export interface AssayInterpretation {
  status: AssayResultStatus;
  /** The catalogued assay symbol that matched, or null when uninterpreted. */
  matchedAssay: string | null;
  /** Inheritance model of the matched assay (null when uninterpreted). */
  inheritance: AssayInheritance | null;
}

interface AssayRule {
  /** Normalized assay symbol (uppercase). */
  symbol: string;
  inheritance: AssayInheritance;
  /** Mutant allele tokens accepted for this assay (uppercase). */
  mutantTokens: string[];
  /** Wild-type allele tokens (uppercase). */
  wildTypeTokens: string[];
}

/**
 * Catalogued disease-marker assays. Inheritance semantics follow published
 * equine genetics (SCID/CA/LFS/OLWS/GBED/JEB recessive; HYPP, MH and
 * PSSM1 dominant). The legacy affected enum means a risk-associated genotype,
 * NOT a clinical diagnosis or a prediction of penetrance. This catalog is a code-level whitelist — adding an
 * assay requires a review, not a config flip.
 */
export const ASSAY_CATALOG_VERSION = "2026-10-21.r119.2";
export const ASSAY_REVIEW_SOURCES = {
  PSSM1: "https://vgl.ucdavis.edu/test/pssm1",
  MH: "https://vgl.ucdavis.edu/test/mh",
  HYPP: "https://vgl.ucdavis.edu/test/hypp",
  champagne: "https://vgl.ucdavis.edu/test/champagne",
  cream: "https://vgl.ucdavis.edu/test/cream",
} as const;

const DISEASE_ASSAY_CATALOG: AssayRule[] = [
  { symbol: "SCID", inheritance: "recessive", mutantTokens: ["SCID"], wildTypeTokens: ["N"] },
  { symbol: "CA", inheritance: "recessive", mutantTokens: ["CA"], wildTypeTokens: ["N"] },
  { symbol: "LFS", inheritance: "recessive", mutantTokens: ["LFS"], wildTypeTokens: ["N"] },
  { symbol: "OLWS", inheritance: "recessive", mutantTokens: ["OLWS"], wildTypeTokens: ["N"] },
  { symbol: "GBED", inheritance: "recessive", mutantTokens: ["GBED"], wildTypeTokens: ["N"] },
  { symbol: "JEB1", inheritance: "recessive", mutantTokens: ["JEB1"], wildTypeTokens: ["N"] },
  { symbol: "JEB2", inheritance: "recessive", mutantTokens: ["JEB2"], wildTypeTokens: ["N"] },
  { symbol: "MH", inheritance: "dominant", mutantTokens: ["MH"], wildTypeTokens: ["N"] },
  { symbol: "PSSM1", inheritance: "dominant", mutantTokens: ["PSSM1"], wildTypeTokens: ["N"] },
  { symbol: "HYPP", inheritance: "dominant", mutantTokens: ["H", "HYPP"], wildTypeTokens: ["N"] },
];

const ASSAY_BY_SYMBOL = new Map(DISEASE_ASSAY_CATALOG.map((rule) => [rule.symbol, rule]));

export function cataloguedDiseaseAssaySymbol(testType: string): string | null {
  const symbol = String(testType ?? "").trim().toUpperCase();
  return ASSAY_BY_SYMBOL.has(symbol) ? symbol : null;
}

/**
 * Legacy gene-symbol identifiers recorded by older data imports. They are
 * NEVER interpreted; callers surface them as quarantined with the suggested
 * reviewed mapping so an operator can correct them deliberately.
 */
const LEGACY_LOCUS_MAP: Record<string, { suggested: string; note: string }> = {
  AGOUTI_ASLIP: { suggested: "agouti_ASIP", note: "Agouti locus gene symbol is ASIP; legacy ASLIP rows await reviewed mapping." },
  DUN_TMEM38: { suggested: "dun_TBX3", note: "Dun pigmentation is associated with TBX3 regulation; legacy TMEM38 rows await reviewed mapping." },
  CREAM_SLC36A1: { suggested: "cream_SLC45A2 OR champagne_SLC36A1", note: "Ambiguous legacy label: SLC36A1 is the champagne gene, not cream. Inspect the original report; never automatically remap this record." },
};

export interface LegacyLocusMapping {
  status: "legacy_identifier_quarantined";
  suggested: string;
  note: string;
}

export function legacyLocusMapping(testType: string): LegacyLocusMapping | null {
  const upper = String(testType ?? "").trim().toUpperCase();
  for (const [needle, mapping] of Object.entries(LEGACY_LOCUS_MAP)) {
    if (upper === needle) return { status: "legacy_identifier_quarantined", ...mapping };
  }
  return null;
}

function normalizeToken(token: string): string {
  return token.trim().toUpperCase().replace(/[\s_-]+/g, "");
}

/**
 * Interpret one assay result. Exact allele-token matching only:
 * the string must split on "/" into exactly two tokens, each of which is
 * either the assay's wild-type or its mutant token. Anything else — prose,
 * negations, partial genotypes, other assays' symbols — is
 * `recorded_uninterpreted` and the original lab text stays authoritative.
 */
export function interpretAssayResult(testType: string, result: string): AssayInterpretation {
  const symbol = String(testType ?? "").trim().toUpperCase();
  const rule = ASSAY_BY_SYMBOL.get(symbol);
  if (!rule) return { status: "recorded_uninterpreted", matchedAssay: null, inheritance: null };

  const raw = String(result ?? "").trim();
  if (!raw) return { status: "recorded_uninterpreted", matchedAssay: null, inheritance: null };
  const parts = raw.split("/");
  if (parts.length !== 2) return { status: "recorded_uninterpreted", matchedAssay: null, inheritance: null };

  const [a, b] = parts.map(normalizeToken);
  const isWild = (t: string) => rule.wildTypeTokens.includes(t);
  const isMutant = (t: string) => rule.mutantTokens.includes(t);
  if (!isWild(a) && !isMutant(a)) return { status: "recorded_uninterpreted", matchedAssay: null, inheritance: null };
  if (!isWild(b) && !isMutant(b)) return { status: "recorded_uninterpreted", matchedAssay: null, inheritance: null };

  const mutantCount = Number(isMutant(a)) + Number(isMutant(b));
  if (mutantCount === 0) return { status: "clear", matchedAssay: rule.symbol, inheritance: rule.inheritance };
  if (mutantCount === 2) return { status: "affected", matchedAssay: rule.symbol, inheritance: rule.inheritance };
  // Exactly one mutant allele.
  if (rule.inheritance === "dominant") {
    // Dominant marker: heterozygotes have a risk-associated genotype, not a recessive carrier state.
    return { status: "affected", matchedAssay: rule.symbol, inheritance: rule.inheritance };
  }
  return { status: "carrier", matchedAssay: rule.symbol, inheritance: rule.inheritance };
}

/** Canonical genotype identity detects conflicting heterozygous/homozygous retests. */
export function assayGenotypeIdentity(testType: string, result: string): string | null {
  const rule = ASSAY_BY_SYMBOL.get(String(testType ?? "").trim().toUpperCase());
  if (!rule || interpretAssayResult(testType, result).status === "recorded_uninterpreted") return null;
  const count = String(result).split("/").map(normalizeToken).filter((t) => rule.mutantTokens.includes(t)).length;
  return `${rule.symbol}:${count}`;
}

export interface GeneticsSummaryInput {
  test_type: string;
  test_category: string;
  result: string;
  verified: number | boolean;
}

export interface GeneticsSummary {
  /** Record counts. */
  tested: number;
  verified: number;
  unverified: number;
  /** Distinct resolved assay counts (not raw record counts). */
  clear: number;
  carriers: number;
  affected: number;
  /** Distinct catalogued assays blocked by a verified ambiguous result. */
  uninterpreted: number;
  /** Distinct catalogued assays whose verified genotypes disagree across retests. */
  conflicts: number;
  /** Explicit units for consumers that need to distinguish rows from assays. */
  resolvedAssays: number;
  unresolvedAssays: number;
  /** Disease rows whose assay key is not in the reviewed catalog. */
  unmappedRecords: number;
}

/**
 * Summary computed from catalog-validated results only. Verified retests of
 * the same assay that disagree are reported as a conflict for that assay and
 * are NOT counted into clear/carrier/affected — the raw rows remain visible
 * with their original laboratory text.
 */
export function summarizeGeneticTests(tests: GeneticsSummaryInput[]): GeneticsSummary {
  const summary: GeneticsSummary = {
    tested: tests.length,
    verified: 0,
    unverified: 0,
    clear: 0,
    carriers: 0,
    affected: 0,
    uninterpreted: 0,
    conflicts: 0,
    resolvedAssays: 0,
    unresolvedAssays: 0,
    unmappedRecords: 0,
  };
  const rowsByAssay = new Map<string, Array<{ id: string; result: string; verified: boolean }>>();
  for (const [index, test] of tests.entries()) {
    const isVerified = Number(test.verified) === 1;
    if (isVerified) summary.verified += 1;
    else summary.unverified += 1;
    if (test.test_category !== "disease") continue;
    const assay = cataloguedDiseaseAssaySymbol(test.test_type);
    if (!assay) {
      summary.unmappedRecords += 1;
      continue;
    }
    const rows = rowsByAssay.get(assay) ?? [];
    rows.push({ id: `${index}`, result: test.result, verified: isVerified });
    rowsByAssay.set(assay, rows);
  }
  for (const [assay, rows] of rowsByAssay) {
    const resolution = resolveConservativeEvidence(rows, (result) => {
      const interpretation = interpretAssayResult(assay, result);
      const identity = assayGenotypeIdentity(assay, result);
      if (interpretation.status === "recorded_uninterpreted" || !identity) return null;
      return { identity, value: interpretation.status };
    });
    if (resolution.status === "conflict") {
      summary.conflicts += 1;
      summary.unresolvedAssays += 1;
      continue;
    }
    if (resolution.status !== "resolved" || !resolution.value) {
      summary.unresolvedAssays += 1;
      if (resolution.status === "uninterpreted") summary.uninterpreted += 1;
      continue;
    }
    summary.resolvedAssays += 1;
    const status = resolution.value;
    if (status === "clear") summary.clear += 1;
    else if (status === "carrier") summary.carriers += 1;
    else if (status === "affected") summary.affected += 1;
  }
  return summary;
}

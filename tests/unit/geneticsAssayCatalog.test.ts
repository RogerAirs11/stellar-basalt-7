import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assayGenotypeIdentity,
  interpretAssayResult,
  legacyLocusMapping,
  summarizeGeneticTests,
} from "../../src/genetics/assayCatalog";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Master-AI plan T04 (finding F02): the old regex summary logic mislabeled
 * results — "not clear" counted as clear, HYPP N/H counted as carrier
 * (HYPP is dominant: heterozygotes are affected), and arbitrary genotype
 * strings received diagnostic labels. These fixtures pin the safe behavior.
 */
describe("assay-catalog interpretation (T04 / F02)", () => {
  it("never labels negated text as clear", () => {
    expect(interpretAssayResult("SCID", "not clear").status).toBe("recorded_uninterpreted");
    expect(interpretAssayResult("SCID", "not negative").status).toBe("recorded_uninterpreted");
    expect(interpretAssayResult("SCID", "not free of the mutation").status).toBe("recorded_uninterpreted");
    expect(interpretAssayResult("CA", "unaffected").status).toBe("recorded_uninterpreted");
  });

  it("interprets only catalogued recessive assays with exact allele tokens", () => {
    expect(interpretAssayResult("SCID", "N/N")).toEqual({ status: "clear", matchedAssay: "SCID", inheritance: "recessive" });
    expect(interpretAssayResult("SCID", "n/scid").status).toBe("carrier");
    expect(interpretAssayResult("SCID", "SCID/SCID").status).toBe("affected");
    expect(interpretAssayResult("CA", "N/CA")).toEqual({ status: "carrier", matchedAssay: "CA", inheritance: "recessive" });
    expect(interpretAssayResult("LFS", "LFS/N").status).toBe("carrier");
  });

  it("treats dominant HYPP heterozygotes as affected, never carriers", () => {
    expect(interpretAssayResult("HYPP", "N/H")).toEqual({ status: "affected", matchedAssay: "HYPP", inheritance: "dominant" });
    expect(interpretAssayResult("HYPP", "H/N").status).toBe("affected");
    expect(interpretAssayResult("HYPP", "N/N").status).toBe("clear");
    expect(interpretAssayResult("HYPP", "H/H").status).toBe("affected");
  });

  it("refuses generic interpretation for unknown assays or free text", () => {
    expect(interpretAssayResult("SOMEPANEL", "N/N").status).toBe("recorded_uninterpreted");
    expect(interpretAssayResult("SOMEPANEL", "clear").status).toBe("recorded_uninterpreted");
    expect(interpretAssayResult("SCID", "negative").status).toBe("recorded_uninterpreted");
    expect(interpretAssayResult("SCID", "pending").status).toBe("recorded_uninterpreted");
    expect(interpretAssayResult("SCID", "carrier by owner statement").status).toBe("recorded_uninterpreted");
  });

  it("does not interpret results for the wrong assay symbol", () => {
    // A CA-labeled test carrying SCID tokens must not be called a CA carrier.
    expect(interpretAssayResult("CA", "N/SCID").status).toBe("recorded_uninterpreted");
  });

  it("quarantines legacy locus identifiers instead of interpreting them", () => {
    const aslip = legacyLocusMapping("agouti_ASLIP");
    expect(aslip).not.toBeNull();
    expect(aslip?.suggested).toContain("ASIP");
    expect(aslip?.status).toBe("legacy_identifier_quarantined");
    expect(legacyLocusMapping("dun_TMEM38")?.suggested).toContain("TBX3");
    expect(legacyLocusMapping("cream_SLC36A1")?.suggested).toContain("SLC45A2");
    expect(legacyLocusMapping("extension_MC1R")).toBeNull();
  });

  it("keeps coat-color tests uninterpreted — they are not disease statuses", () => {
    expect(interpretAssayResult("extension_MC1R", "E/e").status).toBe("recorded_uninterpreted");
    expect(interpretAssayResult("agouti_ASLIP", "a/a").status).toBe("recorded_uninterpreted");
  });
});

describe("assay-catalog summary (distinct states, conflicts)", () => {
  const base = { test_category: "disease" as const, verified: 1 };

  it("counts only assay-validated results into clear/carrier/affected", () => {
    const summary = summarizeGeneticTests([
      { ...base, test_type: "SCID", result: "N/N" },
      { ...base, test_type: "CA", result: "N/CA" },
      { ...base, test_type: "HYPP", result: "N/H" },
      { ...base, test_type: "MH", result: "not clear" },
    ]);
    expect(summary.tested).toBe(4);
    expect(summary.clear).toBe(1);
    expect(summary.carriers).toBe(1);
    expect(summary.affected).toBe(1);
    expect(summary.uninterpreted).toBe(1);
    expect(summary.conflicts).toBe(0);
  });

  it("detects conflicting verified retests instead of double counting", () => {
    const summary = summarizeGeneticTests([
      { ...base, test_type: "SCID", result: "N/N" },
      { ...base, test_type: "SCID", result: "N/SCID" },
    ]);
    expect(summary.conflicts).toBe(1);
    expect(summary.clear).toBe(0);
    expect(summary.carriers).toBe(0);
  });

  it("keeps agreeing retests as one consistent call", () => {
    const summary = summarizeGeneticTests([
      { ...base, test_type: "SCID", result: "N/N" },
      { ...base, test_type: "SCID", result: "n/n" },
    ]);
    expect(summary.conflicts).toBe(0);
    expect(summary.clear).toBe(1);
  });

  it("does not let a verified ambiguous retest leave the same assay looking clear", () => {
    const summary = summarizeGeneticTests([
      { ...base, test_type: "SCID", result: "N/N" },
      { ...base, test_type: "SCID", result: "inconclusive" },
    ]);
    expect(summary.clear).toBe(0);
    expect(summary.uninterpreted).toBe(1);
    expect(summary.resolvedAssays).toBe(0);
    expect(summary.unresolvedAssays).toBe(1);
  });

  it("separates unverified rows from verified counts", () => {
    const summary = summarizeGeneticTests([
      { ...base, test_type: "SCID", result: "N/N" },
      { test_category: "disease", verified: 0, test_type: "SCID", result: "N/SCID" },
    ]);
    expect(summary.verified).toBe(1);
    // The verified clear and the unverified carrier conflict is not silently
    // merged; unverified evidence is reported as its own state.
    expect(summary.unverified).toBe(1);
    expect(summary.clear).toBe(1);
    expect(summary.resolvedAssays).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// R88 agent plan P06 pins: dominant single-copy semantics (UC Davis), the
// not-tested boundary, PSSM2 non-prediction, and conflict scoping.
// ---------------------------------------------------------------------------

describe("P06 genetics catalog review pins", () => {
  it("PSSM1 single-copy is AFFECTED, never an unaffected recessive carrier (UC Davis)", () => {
    const oneCopy = interpretAssayResult("PSSM1", "N/PSSM1");
    expect(oneCopy).toMatchObject({ status: "affected", matchedAssay: "PSSM1", inheritance: "dominant" });
    const twoCopy = interpretAssayResult("PSSM1", "PSSM1/PSSM1");
    expect(twoCopy).toMatchObject({ status: "affected", matchedAssay: "PSSM1" });
  });

  it("MH single-copy is AFFECTED (autosomal dominant, same correction as PSSM1)", () => {
    expect(interpretAssayResult("MH", "N/MH")).toMatchObject({ status: "affected", matchedAssay: "MH", inheritance: "dominant" });
    expect(interpretAssayResult("MH", "MH/MH")).toMatchObject({ status: "affected" });
  });

  it("HYPP one-copy and two-copy stay distinct genotypes with the same risk-associated status", () => {
    expect(assayGenotypeIdentity("HYPP", "N/H")).toBe("HYPP:1");
    expect(assayGenotypeIdentity("HYPP", "H/H")).toBe("HYPP:2");
    expect(interpretAssayResult("HYPP", "N/H").status).toBe("affected");
    expect(interpretAssayResult("HYPP", "H/H").status).toBe("affected");
  });

  it("not-tested, empty and pending prose are never interpreted as clear", () => {
    for (const notTested of ["not tested", "NT", "", "pending", "-", "results pending"]) {
      expect(interpretAssayResult("SCID", notTested).status, `SCID "${notTested}"`).toBe("recorded_uninterpreted");
    }
  });

  it("offers NO commercial PSSM2 prediction — the catalog does not contain it", () => {
    expect(interpretAssayResult("PSSM2", "N/P2").status).toBe("recorded_uninterpreted");
    expect(interpretAssayResult("PSSM2", "P2/P2").status).toBe("recorded_uninterpreted");
    // Source-level pin: adding PSSM2 (or any commercial-prediction assay)
    // requires a scientific review, not a quiet catalog edit.
    const catalogSource = readFileSync(join(root, "src/genetics/assayCatalog.ts"), "utf8");
    expect(catalogSource).not.toMatch(/symbol:\s*"PSSM2"/);
  });

  it("an unresolved retest conflict disables that assay only, not the whole profile", () => {
    const summary = summarizeGeneticTests([
      { test_type: "SCID", test_category: "disease", result: "N/N", verified: 1 },
      { test_type: "SCID", test_category: "disease", result: "N/SCID", verified: 1 },
      { test_type: "CA", test_category: "disease", result: "N/CA", verified: 1 },
      { test_type: "LFS", test_category: "disease", result: "N/N", verified: 1 },
    ]);
    expect(summary.conflicts).toBe(1);
    expect(summary.clear).toBe(1); // LFS still counted
    expect(summary.carriers).toBe(1); // CA still counted
    expect(summary.affected).toBe(0);
  });

  it("quarantine guidance never rewrites the legacy row — the report tool is read-only by construction", () => {
    const legacy = legacyLocusMapping("CREAM_SLC36A1");
    expect(legacy?.status).toBe("legacy_identifier_quarantined");
    expect(legacy?.suggested).toContain("cream_SLC45A2 OR champagne_SLC36A1");
    const toolSource = readFileSync(join(root, "tools/audit-legacy-genetics.mjs"), "utf8");
    expect(toolSource).toContain("read-only");
    expect(toolSource).not.toMatch(/\b(UPDATE|INSERT|DELETE|ALTER)\s+(genetic_tests|INTO genetic_tests|FROM genetic_tests)/i);
    expect(toolSource).toContain("changes_made: 0");
  });
});

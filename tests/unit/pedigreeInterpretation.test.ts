import { describe, expect, it } from "vitest";
import type { RelationshipResponse } from "../../src/contracts/platform";
import type { RelationshipCoefficientMetrics } from "../../src/pedigree/coefficients";
import {
  ANCESTRY_QUALITY_POLICY_VERSION,
  buildAncestryQuality,
  buildBreedingMatingVerdict,
  classifyMatingBand,
} from "../../src/pedigree/interpretation";
import type { PedigreeHorseRow } from "../../src/db/types";
import type { LoadedAncestorGraph } from "../../src/pedigree/engine";

/**
 * Master-AI plan T26 (finding F20): two horses with ZERO recorded ancestors
 * produced a positive "outcross" label because COI=0 was read as
 * unrelatedness. Sparse evidence must yield insufficient_ancestry, never a
 * positive comparative label.
 */
function ph(id: number, father_id: number | null = null, mother_id: number | null = null): PedigreeHorseRow {
  return { id, name_latin: `Horse ${id}`, name_native: null, father_id, mother_id, birth_year: null, breed_desc: null, sex_desc: null, color_desc: null, main_strain_desc: null };
}
function lg(root: number, rows: PedigreeHorseRow[], depth: number): LoadedAncestorGraph {
  return { rootId: root, depth, horses: new Map(rows.map((r) => [r.id, r])), missingParentIds: new Set(), unloadedParentIds: new Set(), cycleNodeIds: new Set(), truncated: false };
}

// 3-generation complete pedigree rooted at `root`.
function deepGraph(root: number): LoadedAncestorGraph {
  const rows: PedigreeHorseRow[] = [ph(root, root + 100, root + 101)];
  for (let gen = 0; gen < 3; gen++) {
    const parents = [...rows.map((r) => r.father_id), ...rows.map((r) => r.mother_id)].filter((v): v is number => v != null);
    for (const p of parents) if (!rows.some((r) => r.id === p)) rows.push(ph(p, p + 1000, p + 1001));
  }
  return lg(root, rows, 3);
}

const zeroCoefficients: RelationshipCoefficientMetrics = {
  from: 1, to: 2, depth: 3, status: "ok",
  relationshipCoefficient: 0, relationshipPercent: 0,
  kinshipCoefficient: 0, kinshipPercent: 0,
  fromInbreedingCoefficient: 0, fromInbreedingPercent: 0,
  toInbreedingCoefficient: 0, toInbreedingPercent: 0,
  fromPedigreeCompletenessPercent: 0, toPedigreeCompletenessPercent: 0,
  analyzedHorses: 2, assumedFounderNodes: 2, boundaryParentReferences: 0,
  integrity: { cycleDetected: false, truncated: false },
  provenance: {
    method: "finite-pedigree-tabular-relationship", algorithmVersion: "1.1.0",
    founderAssumption: "unobserved-or-out-of-depth parents are treated as unrelated non-inbred founders",
    interpretation: "fixture",
  },
} satisfies RelationshipCoefficientMetrics;

const noCommonAncestors: RelationshipResponse = { from: 1, to: 2, commonAncestors: [] };

describe("ancestry-quality gating (T26 / F20)", () => {
  it("two founder-only horses never receive a positive outcross label", () => {
    const sire = lg(1, [ph(1)], 3);
    const dam = lg(2, [ph(2)], 3);
    const quality = buildAncestryQuality(sire, dam, 3);
    expect(quality.sufficientForComparativeLabels).toBe(false);
    const verdict = buildBreedingMatingVerdict(zeroCoefficients, noCommonAncestors, quality);
    expect(verdict.classification).toBe("insufficient_ancestry");
    expect(verdict.classification.toLowerCase()).not.toContain("outcross");
  });

  it("a complete 3-generation pedigree keeps the normal COI bands", () => {
    const quality = buildAncestryQuality(deepGraph(1), deepGraph(2), 3);
    expect(quality.sufficientForComparativeLabels).toBe(true);
    const verdict = buildBreedingMatingVerdict(zeroCoefficients, noCommonAncestors, quality);
    expect(verdict.classification).toBe("outcross");
  });

  it("half-known ancestry (one parent recorded per side) is still insufficient", () => {
    const sire = lg(1, [ph(1, 11, null)], 3); // only sire-of-sire known
    const dam = lg(2, [ph(2, null, 22)], 3); // only dam-of-dam known
    const quality = buildAncestryQuality(sire, dam, 3);
    expect(quality.sufficientForComparativeLabels).toBe(false);
  });

  it("null COI stays unknown regardless of ancestry quality", () => {
    const quality = buildAncestryQuality(deepGraph(1), deepGraph(2), 3);
    const verdict = buildBreedingMatingVerdict(
      { ...zeroCoefficients, kinshipPercent: null, status: "cycle_detected" },
      noCommonAncestors,
      quality,
    );
    expect(verdict.classification).toBe("unknown");
  });

  it("exposes evidence fields and a policy version, without claiming scientific consensus", () => {
    const quality = buildAncestryQuality(lg(1, [ph(1)], 3), lg(2, [ph(2)], 3), 3);
    expect(quality.policyVersion).toBe(ANCESTRY_QUALITY_POLICY_VERSION);
    expect(quality.sireKnownAncestorPositions).toBe(0);
    expect(quality.damKnownAncestorPositions).toBe(0);
    expect(quality.observedAncestorPositions).toBe(0);
  });

  it("classification bands remain unchanged for measured pedigrees", () => {
    expect(classifyMatingBand(0.4, true)).toBe("outcross");
    expect(classifyMatingBand(3, true)).toBe("mild_linebreeding");
    expect(classifyMatingBand(8, true)).toBe("linebreeding");
    expect(classifyMatingBand(15, true)).toBe("close_inbreeding");
    expect(classifyMatingBand(0.4, false)).toBe("insufficient_ancestry");
  });
});

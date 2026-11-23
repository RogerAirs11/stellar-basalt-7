import { describe, expect, it } from "vitest";
import type { PedigreeHorseRow } from "../../src/db/types";
import { calculatePedigreeCoverage, calculatePedigreeDiversity, collectAncestorPathSets, sliceAncestorGraph, type LoadedAncestorGraph } from "../../src/pedigree/engine";
import { MAX_RELATIONSHIP_MATRIX_NODES, buildRelationshipMatrix, calculatePedigreeCoefficientFromGraph, calculateRelationshipCoefficientFromGraphs } from "../../src/pedigree/coefficients";

function horse(id: number, father_id: number | null = null, mother_id: number | null = null): PedigreeHorseRow {
  return {
    id,
    name_latin: `Horse ${id}`,
    name_native: null,
    father_id,
    mother_id,
    birth_year: null,
    breed_desc: null,
    sex_desc: null,
    color_desc: null,
    main_strain_desc: null,
  };
}

function graph(rows: PedigreeHorseRow[], depth: number, cycles: number[] = []): LoadedAncestorGraph {
  return {
    rootId: rows[0]!.id,
    depth,
    horses: new Map(rows.map((row) => [row.id, row])),
    missingParentIds: new Set(),
    unloadedParentIds: new Set(),
    cycleNodeIds: new Set(cycles),
    truncated: false,
  };
}

describe("pedigree analytics engine", () => {
  it("counts repeated ancestors by pedigree position rather than collapsing the graph", () => {
    const loaded = graph([
      horse(1, 2, 3),
      horse(2, 4, null),
      horse(3, 4, null),
      horse(4),
    ], 2);
    const result = calculatePedigreeCoverage(loaded, 2);

    expect(result.expectedAncestorPositions).toBe(6);
    expect(result.knownAncestorPositions).toBe(4);
    expect(result.uniqueAncestors).toBe(3);
    expect(result.repeatedAncestorPositions).toBe(1);
    expect(result.completenessPercent).toBeCloseTo(66.67, 2);
    expect(result.branches.sire).toMatchObject({ relation: "sire", rootHorseId: 2, knownPositions: 2, expectedPositions: 3 });
    expect(result.branches.dam).toMatchObject({ relation: "dam", rootHorseId: 3, knownPositions: 2, expectedPositions: 3 });
    expect(result.topRepeatedAncestors[0]).toMatchObject({ horse: { id: 4 }, occurrences: 2, repeatedPositions: 1, nearestGeneration: 2 });
    expect(result.generations[1]).toMatchObject({ generation: 2, expectedPositions: 4, knownPositions: 2 });
    expect(result.status).toBe("ok");
  });

  it("marks cycle-contaminated metrics instead of silently recursing", () => {
    const loaded = graph([
      horse(1, 2, null),
      horse(2, 1, null),
    ], 4, [1, 2]);
    const result = calculatePedigreeCoverage(loaded, 4);

    expect(result.status).toBe("cycle_detected");
    expect(result.integrity.cycleDetected).toBe(true);
    expect(result.integrity.cycleOccurrences).toBeGreaterThan(0);
    expect(result.knownAncestorPositions).toBe(2);
  });


  it("slices a loaded ancestor graph without leaking deeper generations", () => {
    const loaded = graph([
      horse(1, 2, 3),
      horse(2, 4, 5),
      horse(3, 6, 7),
      horse(4, 8, null), horse(5), horse(6), horse(7), horse(8),
    ], 3);
    const shallow = sliceAncestorGraph(loaded, 2);
    expect(shallow.depth).toBe(2);
    expect([...shallow.horses.keys()].sort((a,b)=>a-b)).toEqual([1,2,3,4,5,6,7]);
    expect(shallow.horses.has(8)).toBe(false);
    const coverage = calculatePedigreeCoverage(shallow, 2);
    expect(coverage.knownAncestorPositions).toBe(6);
    expect(coverage.maxKnownGeneration).toBe(2);
  });

  it("preserves multiple recorded paths to the same repeated ancestor", () => {
    const loaded = graph([
      horse(1, 2, 3),
      horse(2, 4, null),
      horse(3, 4, null),
      horse(4),
    ], 2);
    const paths = collectAncestorPathSets(loaded, 8, 64).pathsByAncestor.get(4);
    expect(paths).toEqual([[1,2,4],[1,3,4]]);
  });

  it("calculates classical finite-pedigree inbreeding with explicit founder assumptions", () => {
    // 2 and 3 are unrelated founders; 4 and 5 are their full siblings; 6 is offspring of 4 x 5.
    const loaded = graph([
      horse(6,4,5), horse(4,2,3), horse(5,2,3), horse(2), horse(3),
    ], 3);
    const result = calculatePedigreeCoefficientFromGraph(loaded);
    expect(result.status).toBe("ok");
    expect(result.inbreedingCoefficient).toBeCloseTo(0.25, 8);
    expect(result.inbreedingPercent).toBeCloseTo(25, 6);

    const matrix = buildRelationshipMatrix(loaded.horses);
    const i4 = matrix.indexById.get(4)!;
    const i5 = matrix.indexById.get(5)!;
    expect(matrix.values[i4 * matrix.ids.length + i5]).toBeCloseTo(0.5, 8);
  });

  it("refuses to present a coefficient as valid when pedigree cycles are present", () => {
    const loaded = graph([horse(1,2,null),horse(2,1,null)],4,[1,2]);
    const result = calculatePedigreeCoefficientFromGraph(loaded);
    expect(result.status).toBe("cycle_detected");
    expect(result.inbreedingCoefficient).toBeNull();
  });

  it("detects a cycle that appears only after two bounded pedigree graphs are merged", () => {
    const left = graph([horse(1, 2, null)], 1);
    const right = graph([horse(2, 1, null)], 1);
    const result = calculateRelationshipCoefficientFromGraphs(left, right, 1);
    expect(result.status).toBe("cycle_detected");
    expect(result.integrity.cycleDetected).toBe(true);
    expect(result.relationshipCoefficient).toBeNull();
    expect(result.kinshipCoefficient).toBeNull();
  });

  it("refuses oversized dense relationship matrices before allocation", () => {
    const rows = Array.from({ length: MAX_RELATIONSHIP_MATRIX_NODES + 1 }, (_, index) => horse(index + 1));
    const loaded = graph(rows, 1);
    const result = calculatePedigreeCoefficientFromGraph(loaded);
    expect(result.status).toBe("truncated");
    expect(result.inbreedingCoefficient).toBeNull();
    expect(result.integrity.truncated).toBe(true);
    expect(() => buildRelationshipMatrix(loaded.horses)).toThrow(/safety limit/);
  });

  it("derives explainable recorded-path contribution and diversity without genomic claims", () => {
    const loaded = graph([
      horse(1, 2, 3),
      horse(2, 4, 5),
      horse(3, 4, 6),
      horse(4), horse(5), horse(6),
    ], 2);
    const result = calculatePedigreeDiversity(loaded, 2);
    expect(result.knownAncestorPositions).toBe(6);
    expect(result.uniqueAncestors).toBe(5);
    expect(result.repeatedAncestorPositions).toBe(1);
    expect(result.equivalentCompleteGenerations).toBeCloseTo(2, 6);
    expect(result.ancestorDiversityPercent).toBeCloseTo(83.33, 2);
    expect(result.ancestorLossPercent).toBeCloseTo(16.67, 2);
    expect(result.weightedRepeatedBurdenPercent).toBeGreaterThan(0);
    expect(result.topAncestorContributions[0]).toMatchObject({ horse: { id: 2 }, nearestGeneration: 1 });
    const repeated = result.topAncestorContributions.find(x => x.horse.id === 4)!;
    expect(repeated.occurrences).toBe(2);
    expect(repeated.crossesBranches).toBe(true);
    expect(result.provenance.interpretation).toContain("not genomic ancestry");
  });

});

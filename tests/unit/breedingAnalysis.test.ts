import { buildAncestryQuality } from "../../src/pedigree/interpretation";
import { describe, expect, it } from "vitest";
import type { RelationshipResponse } from "../../src/contracts/platform";
import type { RelationshipCoefficientMetrics } from "../../src/pedigree/coefficients";
import { buildAncestorLoss, buildBreedingMatingVerdict, buildBreedingPairingAnalysis, buildCoiByDepth, buildProspectiveDiversityProjection, buildBreedingOptimizerScore, classifyBreedingSex } from "../../src/pedigree/breeding";
import type { PedigreeHorseRow } from "../../src/db/types";
import type { LoadedAncestorGraph } from "../../src/pedigree/engine";

const coefficients: RelationshipCoefficientMetrics = {
  from: 4, to: 5, depth: 8, status: "ok",
  relationshipCoefficient: 0.5, relationshipPercent: 50,
  kinshipCoefficient: 0.25, kinshipPercent: 25,
  fromInbreedingCoefficient: 0, fromInbreedingPercent: 0,
  toInbreedingCoefficient: 0, toInbreedingPercent: 0,
  fromPedigreeCompletenessPercent: 100, toPedigreeCompletenessPercent: 100,
  analyzedHorses: 5, assumedFounderNodes: 2, boundaryParentReferences: 0,
  integrity: { cycleDetected: false, truncated: false },
  provenance: {
    method: "finite-pedigree-tabular-relationship", algorithmVersion: "1.1.0",
    founderAssumption: "unobserved-or-out-of-depth parents are treated as unrelated non-inbred founders",
    interpretation: "fixture",
  },
};


function ph(id:number,father_id:number|null=null,mother_id:number|null=null):PedigreeHorseRow{return{id,name_latin:`Horse ${id}`,name_native:null,father_id,mother_id,birth_year:null,breed_desc:null,sex_desc:null,color_desc:null,main_strain_desc:null}}
function lg(root:number,rows:PedigreeHorseRow[],depth:number):LoadedAncestorGraph{return{rootId:root,depth,horses:new Map(rows.map(r=>[r.id,r])),missingParentIds:new Set(),unloadedParentIds:new Set(),cycleNodeIds:new Set(),truncated:false}}

const relationship: RelationshipResponse = {
  from: 4, to: 5,
  commonAncestors: [{ horse: { id: 2, name_latin: "Founder 2", name_native: null, birth_year: null }, fromDepth: 1, toDepth: 1, totalDepth: 2, fromPath: [4,2], toPath: [5,2] }],
};

describe("breeding pairing analysis", () => {
  it("uses parental kinship as prospective offspring pedigree COI", () => {
    const result = buildBreedingPairingAnalysis(4, 5, coefficients, relationship);
    expect(result.projectedOffspringInbreedingCoefficient).toBe(0.25);
    expect(result.projectedOffspringInbreedingPercent).toBe(25);
    expect(result.parentalRelationshipPercent).toBe(50);
    expect(result.commonAncestors).toHaveLength(1);
    expect(result.provenance.interpretation).toContain("not genomic COI");
  });

  it("preserves integrity suppression from the underlying coefficient engine", () => {
    const result = buildBreedingPairingAnalysis(4, 5, {
      ...coefficients,
      status: "cycle_detected",
      kinshipCoefficient: null,
      kinshipPercent: null,
      relationshipCoefficient: null,
      relationshipPercent: null,
      integrity: { cycleDetected: true, truncated: false },
    }, relationship);
    expect(result.status).toBe("cycle_detected");
    expect(result.projectedOffspringInbreedingPercent).toBeNull();
    expect(result.integrity.cycleDetected).toBe(true);
  });
  it("projects offspring structural pedigree diversity from both parent graphs", () => {
    const sire=lg(4,[ph(4,2,3),ph(2),ph(3)],1);
    const dam=lg(5,[ph(5,2,6),ph(2),ph(6)],1);
    const p=buildProspectiveDiversityProjection(sire,dam,2);
    expect(p.projectedKnownAncestorPositions).toBe(6);
    expect(p.projectedUniqueRecordedAncestors).toBe(5);
    expect(p.projectedRepeatedAncestorPositions).toBe(1);
    expect(p.sharedRecordedAncestorsBetweenParents).toBe(1);
    expect(p.topProjectedAncestorContributions.some(x=>x.horse.id===2&&x.fromSire&&x.fromDam)).toBe(true);
    expect(p.provenance.interpretation).toContain("not genomic ancestry");
  });

  it("averages COI evidence completeness across both parent pedigrees instead of exceeding 100%", () => {
    const fullRows = (root: number, base: number): PedigreeHorseRow[] => [
      ph(root, base, base + 1),
      ph(base, base + 2, base + 3), ph(base + 1, base + 4, base + 5),
      ph(base + 2, base + 6, base + 7), ph(base + 3, base + 8, base + 9),
      ph(base + 4, base + 10, base + 11), ph(base + 5, base + 12, base + 13),
      ...Array.from({ length: 8 }, (_, i) => ph(base + 6 + i)),
    ];
    const sire = lg(100, fullRows(100, 110), 3);
    const dam = lg(200, fullRows(200, 210), 3);
    const complete = buildCoiByDepth(sire, dam, 3)[0]!;
    expect(complete.pedigreeCompletenessPercent).toBe(100);
    expect(complete.sirePedigreeCompletenessPercent).toBe(100);
    expect(complete.damPedigreeCompletenessPercent).toBe(100);

    const founderOnlyDam = lg(300, [ph(300)], 3);
    const half = buildCoiByDepth(sire, founderOnlyDam, 3)[0]!;
    expect(half.pedigreeCompletenessPercent).toBe(50);
    expect(half.sirePedigreeCompletenessPercent).toBe(100);
    expect(half.damPedigreeCompletenessPercent).toBe(0);
  });

  it("keeps prospective foal AVK within the exact offspring generation boundary", () => {
    const sire = lg(4, [ph(4, 10, 11), ph(10), ph(11)], 1);
    const dam = lg(5, [ph(5, 12, 13), ph(12), ph(13)], 1);
    expect(buildAncestorLoss(sire, dam, 1).projectedFoalAvkPercent).toBe(100);
    expect(buildAncestorLoss(sire, dam, 2).projectedFoalAvkPercent).toBe(100);

    const sharedDam = lg(6, [ph(6, 11, 13), ph(11), ph(13)], 1);
    expect(buildAncestorLoss(sire, sharedDam, 2).projectedFoalAvkPercent).toBeCloseTo(83.33, 2);
  });

  it("renormalizes optimizer weights when reference-population DPI is unavailable", () => {
    const result=buildBreedingOptimizerScore({
      projectedOffspringInbreedingPercent:2.5,
      projectedAncestorDiversityPercent:82,
      projectedTop5RecordedPathWeightSharePercent:28,
      candidateDiversityPreservationIndex:null,
      objectives:{lowProjectedCoiWeight:.45,ancestorDiversityWeight:.25,lowConcentrationWeight:.15,candidateDiversityPreservationWeight:.15,coiCeilingPercent:12.5},
    });
    const dpi=result.components.find(x=>x.code==="candidate_diversity_preservation")!;
    expect(dpi.normalizedScore).toBeNull();
    expect(dpi.appliedWeight).toBe(0);
    const applied=result.components.reduce((sum,x)=>sum+x.appliedWeight,0);
    expect(applied).toBeCloseTo(1,3);
    expect(result.score).toBeGreaterThan(70);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("classifies only explicit recorded sire/dam sex evidence and preserves unknown historical values", () => {
    expect(classifyBreedingSex("Stallion")).toBe("male");
    expect(classifyBreedingSex("colt")).toBe("male");
    expect(classifyBreedingSex("نریان")).toBe("male");
    expect(classifyBreedingSex("Mare")).toBe("female");
    expect(classifyBreedingSex("filly")).toBe("female");
    expect(classifyBreedingSex("مادیان")).toBe("female");
    expect(classifyBreedingSex("unknown legacy code")).toBe("unknown");
    expect(classifyBreedingSex(null)).toBe("unknown");
  });

  it("classifies mating verdicts by projected offspring COI bands", () => {
    const quality=buildAncestryQuality(lg(4,[ph(4,2,3),ph(2),ph(3)],1),lg(5,[ph(5,2,6),ph(2),ph(6)],1),1);
    const at = (percent: number | null) => buildBreedingMatingVerdict({ ...coefficients, kinshipPercent: percent }, relationship,quality);
    expect(at(0.3).classification).toBe("outcross");
    expect(at(0.3).classificationLabel).toContain("Outcross");
    expect(at(3).classification).toBe("mild_linebreeding");
    expect(at(8).classification).toBe("linebreeding");
    expect(at(13).classification).toBe("close_inbreeding");
    expect(at(null).classification).toBe("unknown");
    // half-sibling pairing is flagged as a close mating
    const halfSib = buildBreedingMatingVerdict(coefficients, { ...relationship, summary: { ...{ kind: "related", commonAncestorCount: 1, closestTotalDepth: 2, fromDepth: 1, toDepth: 1, directGeneration: null, directPath: null, paternalConnectionCount: 0, maternalConnectionCount: 0, crossBranchConnectionCount: 0, integrity: { cycleDetected: false, truncated: false } }, kind: "half_sibling" } });
    expect(halfSib.closeMatingWarning).toBe(true);
    expect(halfSib.closeMatingWarningText).toContain("not a mating recommendation");
    expect(halfSib.closestCommonAncestorGeneration).toBe(2);
    // unrelated parents carry no warning
    const unrelated = buildBreedingMatingVerdict({ ...coefficients, kinshipPercent: 0 }, { ...relationship, summary: { ...{ kind: "related", commonAncestorCount: 1, closestTotalDepth: 2, fromDepth: 1, toDepth: 1, directGeneration: null, directPath: null, paternalConnectionCount: 0, maternalConnectionCount: 0, crossBranchConnectionCount: 0, integrity: { cycleDetected: false, truncated: false } }, kind: "no_common_ancestor", commonAncestorCount: 0 }, commonAncestors: [] });
    expect(unrelated.closeMatingWarning).toBe(false);
    expect(unrelated.closestCommonAncestorGeneration).toBeNull();
  });
  it("classifies geldings and Arabic sex terms", () => {
    expect(classifyBreedingSex("Gelding")).toBe("gelding");
    expect(classifyBreedingSex("اخته")).toBe("gelding");
    expect(classifyBreedingSex("Castrated male")).toBe("gelding");
    expect(classifyBreedingSex("حصان")).toBe("male");
    expect(classifyBreedingSex("Stallion")).toBe("male");
  });

});

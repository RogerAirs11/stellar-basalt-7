import type { HorseInsight, HorseInsightsResponse, HorseReferencePopulationIntelligence } from "../contracts/platform";
import { calculatePedigreeCoefficientFromGraph } from "./coefficients";
import { calculateDescendantReach, calculatePedigreeCoverage, calculatePedigreeDiversity, loadAncestorGraph, sliceAncestorGraph } from "./engine";
import { classifyReferenceSamplingPrecision } from "./referenceSampling";

/**
 * Produce localization-neutral, evidence-bearing facts. Frontends decide how to
 * phrase/visualize them; the backend owns the factual derivation and provenance.
 */
export async function buildHorseInsights(
  db: D1Database,
  horseId: number,
  ancestorDepth = 6,
  descendantDepth = 4,
  metricsDepth = ancestorDepth,
  coefficientDepth = 8,
): Promise<HorseInsightsResponse | null> {
  const safeAncestorDepth = Number.isFinite(ancestorDepth) ? Math.max(1, Math.min(Math.trunc(ancestorDepth), 8)) : 6;
  const safeDescendantDepth = Number.isFinite(descendantDepth) ? Math.max(1, Math.min(Math.trunc(descendantDepth), 6)) : 4;
  const safeMetricsDepth = Number.isFinite(metricsDepth) ? Math.max(1, Math.min(Math.trunc(metricsDepth), 8)) : safeAncestorDepth;
  const safeCoefficientDepth = Number.isFinite(coefficientDepth) ? Math.max(1, Math.min(Math.trunc(coefficientDepth), 8)) : 8;
  const maxAncestorDepth = Math.max(safeAncestorDepth, safeMetricsDepth, safeCoefficientDepth);
  const loadedGraph = await loadAncestorGraph(db, horseId, maxAncestorDepth, 1024);
  if (!loadedGraph) return null;

  // One maximum-depth database load serves all shallower calculations exactly.
  const graph = sliceAncestorGraph(loadedGraph, safeAncestorDepth);
  const metricsGraph = safeMetricsDepth === safeAncestorDepth ? graph : sliceAncestorGraph(loadedGraph, safeMetricsDepth);
  const coefficientGraph = safeCoefficientDepth === safeAncestorDepth ? graph : sliceAncestorGraph(loadedGraph, safeCoefficientDepth);
  const coverage = calculatePedigreeCoverage(graph, safeAncestorDepth);
  const embeddedMetrics = safeMetricsDepth === safeAncestorDepth ? coverage : calculatePedigreeCoverage(metricsGraph, safeMetricsDepth);
  const premiumPedigree = calculatePedigreeDiversity(graph, safeAncestorDepth);
  const coefficient = calculatePedigreeCoefficientFromGraph(graph);
  const embeddedCoefficient = safeCoefficientDepth === safeAncestorDepth ? coefficient : calculatePedigreeCoefficientFromGraph(coefficientGraph);
  const descendant = await calculateDescendantReach(db, horseId, safeDescendantDepth, 1000);
  const insights: HorseInsight[] = [];

  insights.push({
    code: "pedigree_coverage",
    importance: coverage.completenessPercent >= 75 ? "headline" : "context",
    values: {
      completenessPercent: coverage.completenessPercent,
      knownPositions: coverage.knownAncestorPositions,
      expectedPositions: coverage.expectedAncestorPositions,
      uniqueAncestors: coverage.uniqueAncestors,
      uniqueAncestorRatioPercent: coverage.uniqueAncestorRatioPercent,
      depth: coverage.depth,
    },
    provenance: { source: "pedigree_metrics", algorithmVersion: coverage.provenance.algorithmVersion },
  });

  const branchGap = Math.abs(coverage.branches.sire.completenessPercent - coverage.branches.dam.completenessPercent);
  if (branchGap >= 10) {
    insights.push({
      code: "branch_imbalance",
      importance: branchGap >= 25 ? "notable" : "context",
      values: {
        sirePercent: coverage.branches.sire.completenessPercent,
        damPercent: coverage.branches.dam.completenessPercent,
        gapPercent: round(branchGap, 2),
        strongerBranch: coverage.branches.sire.completenessPercent >= coverage.branches.dam.completenessPercent ? "sire" : "dam",
      },
      provenance: { source: "pedigree_metrics", algorithmVersion: coverage.provenance.algorithmVersion },
    });
  }

  const repeated = coverage.topRepeatedAncestors[0];
  if (repeated) {
    insights.push({
      code: "repeated_ancestor",
      importance: repeated.occurrences >= 4 ? "headline" : "notable",
      values: {
        occurrences: repeated.occurrences,
        repeatedPositions: repeated.repeatedPositions,
        nearestGeneration: repeated.nearestGeneration,
        positionSharePercent: repeated.positionSharePercent,
        sireBranchOccurrences: repeated.sireBranchOccurrences,
        damBranchOccurrences: repeated.damBranchOccurrences,
        crossesBranches: repeated.crossesBranches,
        depth: coverage.depth,
      },
      relatedHorses: [repeated.horse],
      provenance: { source: "pedigree_metrics", algorithmVersion: coverage.provenance.algorithmVersion },
    });
  }

  for (const [code, lineage] of [
    ["tail_male_line", coverage.lineages.tailMale],
    ["tail_female_line", coverage.lineages.tailFemale],
  ] as const) {
    if (lineage.horses.length > 1) {
      insights.push({
        code,
        importance: lineage.horses.length >= Math.min(coverage.depth + 1, 6) ? "notable" : "context",
        values: {
          knownGenerations: lineage.horses.length - 1,
          completeToDepth: lineage.completeToDepth,
          stoppedByCycle: lineage.stoppedByCycle,
        },
        relatedHorses: lineage.horses.slice(1),
        provenance: { source: "pedigree_metrics", algorithmVersion: coverage.provenance.algorithmVersion },
      });
    }
  }

  if (coefficient.inbreedingPercent !== null) {
    insights.push({
      code: "pedigree_inbreeding",
      importance: coefficient.inbreedingPercent >= 6.25 ? "headline" : coefficient.inbreedingPercent > 0 ? "notable" : "context",
      values: {
        inbreedingPercent: coefficient.inbreedingPercent,
        depth: coefficient.depth,
        pedigreeCompletenessPercent: coefficient.pedigreeCompletenessPercent,
        founderAssumption: coefficient.provenance.founderAssumption,
      },
      provenance: { source: "pedigree_coefficients", algorithmVersion: coefficient.provenance.algorithmVersion },
    });
  }

  if (descendant && descendant.knownDescendants > 0) {
    insights.push({
      code: "descendant_reach",
      importance: descendant.directChildren >= 20 || descendant.knownDescendants >= 100 ? "headline" : "notable",
      values: {
        directChildren: descendant.directChildren,
        knownDescendants: descendant.knownDescendants,
        maxKnownGeneration: descendant.maxKnownGeneration,
        depth: descendant.depth,
        truncated: descendant.truncated,
      },
      provenance: { source: "descendant_metrics", algorithmVersion: descendant.provenance.algorithmVersion },
    });
  }

  if (coverage.integrity.cycleDetected || coverage.integrity.truncated || coverage.integrity.unresolvedParentReferences > 0) {
    insights.push({
      code: "pedigree_integrity_warning",
      importance: "warning",
      values: {
        cycleDetected: coverage.integrity.cycleDetected,
        truncated: coverage.integrity.truncated,
        unresolvedParentReferences: coverage.integrity.unresolvedParentReferences,
      },
      provenance: { source: "pedigree_metrics", algorithmVersion: coverage.provenance.algorithmVersion },
    });
  }

  insights.sort((a, b) => importanceRank(a.importance) - importanceRank(b.importance));
  const referencePopulation = await loadReferencePopulationIntelligence(db, horseId);
  return {
    horseId, ancestorDepth: safeAncestorDepth, descendantDepth: safeDescendantDepth, insights,
    pedigreeMetrics: embeddedMetrics, pedigreeCoefficient: embeddedCoefficient, descendantMetrics: descendant ?? undefined,
    premiumPedigree, referencePopulation: referencePopulation ?? undefined,
  };
}

type ReferenceProfileRow = {
  horse_id:number;source_revision:string;algorithm_version:string;cohort_key:string;cohort_label:string;reference_start_year:number;reference_end_year:number;
  reference_population_size:number;sample_size:number;member_of_reference_cohort:number;pedigree_completeness_percent:number;
  mean_kinship_percent:number|null;mean_kinship_standard_error_percent:number|null;mean_kinship_percentile:number|null;kinship_rarity_percentile:number|null;
  ancestor_rarity_index:number;ancestor_rarity_percentile:number;tail_male_root_id:number|null;tail_male_root_share_percent:number|null;
  tail_female_root_id:number|null;tail_female_root_share_percent:number|null;diversity_preservation_index:number;confidence_grade:"high"|"medium"|"low";
};

async function loadReferencePopulationIntelligence(db:D1Database, horseId:number):Promise<HorseReferencePopulationIntelligence|null>{
  let row:ReferenceProfileRow|null=null;
  try{row=await db.prepare(`SELECT hri.horse_id,hri.source_revision,hri.algorithm_version,hri.cohort_key,hri.cohort_label,hri.reference_start_year,hri.reference_end_year,hri.reference_population_size,hri.sample_size,hri.member_of_reference_cohort,hri.pedigree_completeness_percent,hri.mean_kinship_percent,hri.mean_kinship_standard_error_percent,hri.mean_kinship_percentile,hri.kinship_rarity_percentile,hri.ancestor_rarity_index,hri.ancestor_rarity_percentile,hri.tail_male_root_id,hri.tail_male_root_share_percent,hri.tail_female_root_id,hri.tail_female_root_share_percent,hri.diversity_preservation_index,hri.confidence_grade FROM horse_reference_intelligence hri JOIN registry_state rs ON rs.id=1 AND rs.analytics_stale=0 WHERE hri.horse_id=? LIMIT 1`).bind(horseId).first<ReferenceProfileRow>();}catch{return null;}
  if(!row)return null;
  const interval: [number,number]|null = row.mean_kinship_percent!=null&&row.mean_kinship_standard_error_percent!=null
    ? [round(Math.max(0,row.mean_kinship_percent-1.96*row.mean_kinship_standard_error_percent),4),round(row.mean_kinship_percent+1.96*row.mean_kinship_standard_error_percent,4)]
    : null;
  const samplingPrecision=classifyReferenceSamplingPrecision(row.mean_kinship_standard_error_percent);
  const components:HorseReferencePopulationIntelligence["diversityPreservationIndex"]["components"]=[];
  if(row.kinship_rarity_percentile!=null)components.push({code:"lowMeanKinship",score:row.kinship_rarity_percentile,nominalWeight:.50});
  components.push({code:"rareRecordedAncestors",score:row.ancestor_rarity_percentile,nominalWeight:.30});
  if(row.tail_male_root_share_percent!=null)components.push({code:"rareTailMaleLine",score:round(Math.max(0,100-row.tail_male_root_share_percent),2),nominalWeight:.10});
  if(row.tail_female_root_share_percent!=null)components.push({code:"rareTailFemaleLine",score:round(Math.max(0,100-row.tail_female_root_share_percent),2),nominalWeight:.10});
  const reasons=[`${round(row.pedigree_completeness_percent,2)}% recorded pedigree completeness through generation 6`,`${row.cohort_label} recent reference population n=${row.reference_population_size}`];
  if(row.mean_kinship_percent!=null)reasons.push(`sampled exact pedigree mean kinship using deterministic reference sample n=${row.sample_size}`);
  else reasons.push("mean kinship not precomputed because this horse is outside the current recent reference cohort; rarity/direct-line context remains available");
  return {
    horseId:row.horse_id,
    cohort:{key:row.cohort_key,label:row.cohort_label,breed:row.cohort_label,startYear:row.reference_start_year,endYear:row.reference_end_year,populationSize:row.reference_population_size,sampleSize:row.sample_size,memberOfReferenceCohort:Boolean(row.member_of_reference_cohort)},
    meanKinship:{estimatePercent:row.mean_kinship_percent,standardErrorPercent:row.mean_kinship_standard_error_percent,approximate95PercentSamplingInterval:interval,samplingPrecision,percentile:row.mean_kinship_percentile,rarityPercentile:row.kinship_rarity_percentile,method:"sampled-exact-pedigree-kinship",founderAssumption:"unobserved parents are unrelated non-inbred founders"},
    recordedAncestorRarity:{index:row.ancestor_rarity_index,percentile:row.ancestor_rarity_percentile,depth:6,interpretation:"Path-weighted rarity of recorded ancestors relative to their presence across the recent same-breed reference population."},
    directLines:{tailMaleRootId:row.tail_male_root_id,tailMaleRootSharePercent:row.tail_male_root_share_percent,tailFemaleRootId:row.tail_female_root_id,tailFemaleRootSharePercent:row.tail_female_root_share_percent},
    diversityPreservationIndex:{score:row.diversity_preservation_index,components,interpretation:"Horse DB decision-support index combining low sampled mean kinship, rare recorded ancestors and rare direct lines. It is not a breeding value, genomic score, health prediction or measure of horse quality."},
    confidence:{grade:row.confidence_grade,pedigreeCompletenessPercent:row.pedigree_completeness_percent,reasons},
    provenance:{algorithmVersion:row.algorithm_version,sourceRevision:row.source_revision,interpretation:"Population-relative pedigree intelligence using cycle-clean canonical parentage and a deterministic same-breed recent reference sample. No genomic similarity is inferred."},
  };
}

function importanceRank(value: HorseInsight["importance"]): number {
  return value === "headline" ? 0 : value === "notable" ? 1 : value === "context" ? 2 : 3;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

import type { BreedingDepthPoint, BreedingDiversityProjection, BreedingMatingVerdict, BreedingPairingAnalysisResponse, RelationshipResponse } from "../contracts/platform";
import { MAX_RELATIONSHIP_GRAPH_NODES_PER_HORSE, calculateRelationshipCoefficientFromGraphs, type RelationshipCoefficientMetrics } from "./coefficients";
import { buildAncestryQuality, buildBreedingMatingVerdict } from "./interpretation";
import { analyzeRelationshipFromGraphs } from "./relationship";
import { calculatePedigreeCoverage, calculatePedigreeDiversity, loadAncestorGraph, sliceAncestorGraph, type LoadedAncestorGraph } from "./engine";
import { HttpError } from "../api/http";

export const BREEDING_ANALYSIS_METHOD = "prospective-offspring-pedigree-coi-from-parental-kinship" as const;
export const BREEDING_ANALYSIS_ALGORITHM_VERSION = "1.3.0" as const;
export const BREEDING_DIVERSITY_METHOD = "prospective-offspring-recorded-pedigree-diversity" as const;
export const BREEDING_DIVERSITY_ALGORITHM_VERSION = "1.0.0" as const;

export type BreedingSexClass = "male" | "female" | "gelding" | "unknown" | "ambiguous";

/** Conservative recorded-sex classifier used only for sire/dam role eligibility. Unknown historical values remain analyzable. */
export function classifyBreedingSex(value: string | null | undefined): BreedingSexClass {
  const text = String(value ?? "").normalize('NFKC').replace(/[يى]/g,'ی').replace(/ك/g,'ک').replace(/\u200c/g,' ').trim().toLocaleLowerCase();
  if (!text) return "unknown";
  // Detect castration before generic male terms. Prospective natural breeding
  // policy is separate from historical paternity or documented stored semen.
  if (/(?:\bgeld(?:ing)?\b|\bcastrated\b|اخته|الصقل)/iu.test(text)) return "gelding";
  const female = /(?:^f$|\bmare\b|\bfemale\b|\bfilly\b|مادیان|ماده|فرس ماده|الفرس)/iu.test(text);
  const male = /(?:^m$|\bstallion\b|\bmale\b|\bcolt\b|نریان|(?:^|\s)نر(?:$|\s)|حصان|\bentire\b)/iu.test(text);
  if (female && male) return "ambiguous";
  if (female) return "female";
  if (male) return "male";
  return "unknown";
}

function expectedSexForRole(role: "sire" | "dam"): "male" | "female" { return role === "sire" ? "male" : "female"; }
function oppositeRole(role: "sire" | "dam"): "sire" | "dam" { return role === "sire" ? "dam" : "sire"; }

/**
 * Prospective pedigree analysis for a planned sire x dam pairing.
 *
 * For a prospective offspring, pedigree inbreeding F equals the kinship/coancestry
 * coefficient between its parents under the same finite-pedigree founder assumptions.
 * This is pedigree-derived only; it is not genomic compatibility, disease risk,
 * fertility prediction, performance prediction, or a breeding recommendation.
 */
export async function analyzeBreedingPairing(
  db: D1Database,
  sireId: number,
  damId: number,
  depth = 8,
): Promise<BreedingPairingAnalysisResponse | null> {
  const safeDepth = Number.isFinite(depth) ? Math.max(1, Math.min(Math.trunc(depth), 16)) : 8;
  const [sireGraph, damGraph] = await Promise.all([
    loadAncestorGraph(db,sireId,safeDepth,MAX_RELATIONSHIP_GRAPH_NODES_PER_HORSE),
    loadAncestorGraph(db,damId,safeDepth,MAX_RELATIONSHIP_GRAPH_NODES_PER_HORSE),
  ]);
  if (!sireGraph || !damGraph) return null;
  return analyzeBreedingPairingFromGraphs(sireGraph, damGraph, safeDepth);
}

/** Build all pairing metrics from two graphs hydrated once for the current request. */
export function analyzeBreedingPairingFromGraphs(
  sireGraph: LoadedAncestorGraph,
  damGraph: LoadedAncestorGraph,
  depth = Math.max(sireGraph.depth, damGraph.depth),
): BreedingPairingAnalysisResponse {
  const safeDepth = Number.isFinite(depth) ? Math.max(1, Math.min(Math.trunc(depth), 16)) : 8;
  const coefficients = calculateRelationshipCoefficientFromGraphs(sireGraph, damGraph, safeDepth);
  const relationship = analyzeRelationshipFromGraphs(sireGraph, damGraph, safeDepth);
  const diversityProjection = buildProspectiveDiversityProjection(sireGraph, damGraph, safeDepth);
  // Master-Ai plan T26 (F20): comparative verdict labels are gated by
  // ancestry quality — sparse-ancestry pairings never get a positive outcross
  // label. Raw coefficient math is unchanged.
  const ancestryQuality = buildAncestryQuality(sireGraph, damGraph, safeDepth);
  const verdict = buildBreedingMatingVerdict(coefficients, relationship, ancestryQuality);
  const coiByDepth = buildCoiByDepth(sireGraph, damGraph, safeDepth);
  const ancestorLoss = buildAncestorLoss(sireGraph, damGraph, safeDepth);
  return buildBreedingPairingAnalysis(sireGraph.rootId, damGraph.rootId, coefficients, relationship, diversityProjection, { verdict, coiByDepth, ancestorLoss });
}

/** Pure response builder kept testable independently of D1 transport. */
export function buildBreedingPairingAnalysis(
  sireId: number,
  damId: number,
  coefficients: RelationshipCoefficientMetrics,
  relationship: RelationshipResponse,
  diversityProjection?: BreedingDiversityProjection,
  extras?: { verdict?: BreedingMatingVerdict; coiByDepth?: BreedingDepthPoint[]; ancestorLoss?: BreedingPairingAnalysisResponse["ancestorLoss"] },
): BreedingPairingAnalysisResponse {
  return {
    sireId,
    damId,
    depth: coefficients.depth,
    status: coefficients.status,
    projectedOffspringInbreedingCoefficient: coefficients.kinshipCoefficient,
    projectedOffspringInbreedingPercent: coefficients.kinshipPercent,
    parentalRelationshipCoefficient: coefficients.relationshipCoefficient,
    parentalRelationshipPercent: coefficients.relationshipPercent,
    parentalKinshipCoefficient: coefficients.kinshipCoefficient,
    parentalKinshipPercent: coefficients.kinshipPercent,
    sireInbreedingPercent: coefficients.fromInbreedingPercent,
    damInbreedingPercent: coefficients.toInbreedingPercent,
    sirePedigreeCompletenessPercent: coefficients.fromPedigreeCompletenessPercent,
    damPedigreeCompletenessPercent: coefficients.toPedigreeCompletenessPercent,
    commonAncestors: relationship.commonAncestors,
    diversityProjection,
    ...(extras?.verdict ? { verdict: extras.verdict } : {}),
    ...(extras?.coiByDepth?.length ? { coiByDepth: extras.coiByDepth } : {}),
    ...(extras?.ancestorLoss ? { ancestorLoss: extras.ancestorLoss } : {}),
    integrity: coefficients.integrity,
    provenance: {
      method: BREEDING_ANALYSIS_METHOD,
      algorithmVersion: BREEDING_ANALYSIS_ALGORITHM_VERSION,
      founderAssumption: coefficients.provenance.founderAssumption,
      interpretation:
        "Prospective offspring pedigree COI equals parental kinship for the selected finite pedigree depth. This is a structural pedigree estimate, not genomic COI, genetic-disease risk, fertility, performance, market value, or a breeding recommendation.",
    },
  };
}

/**
 * Verdict building lives in interpretation.ts (Master-Ai plan T26):
 * band classification is gated by ancestry quality so a founder-only
 * pairing is reported as insufficient_ancestry, never a positive outcross.
 * Re-exported here for existing import sites.
 */
export { buildBreedingMatingVerdict } from "./interpretation";

/** COI convergence trend: kinship recomputed at standard depths (3/5/8/10) so
 *  editors can see whether the estimate is still growing with depth (a shallow
 *  pedigree can fake a low COI) — each point pairs COI with the completeness
 *  of the evidence behind it (ANCCE publishes COI next to a completeness index
 *  for exactly this reason). */
export function buildCoiByDepth(sireGraph: LoadedAncestorGraph, damGraph: LoadedAncestorGraph, maxDepth: number): BreedingDepthPoint[] {
  const targets = [3, 5, 8, 10].filter(d => d <= maxDepth);
  const points: BreedingDepthPoint[] = [];
  for (const depth of targets) {
    const slicedSire = sliceAncestorGraph(sireGraph, depth);
    const slicedDam = sliceAncestorGraph(damGraph, depth);
    const coefficients = calculateRelationshipCoefficientFromGraphs(slicedSire, slicedDam, depth);
    const sireCoverage = calculatePedigreeCoverage(slicedSire, depth);
    const damCoverage = calculatePedigreeCoverage(slicedDam, depth);
    // This is the average completeness of two parent pedigrees. The previous
    // implementation summed two numerators but divided by one parent's
    // denominator, which could report 200%.
    const combinedCompleteness = (sireCoverage.completenessPercent + damCoverage.completenessPercent) / 2;
    points.push({
      depth,
      inbreedingPercent: coefficients.kinshipPercent,
      pedigreeCompletenessPercent: roundBreeding(combinedCompleteness, 2),
      sirePedigreeCompletenessPercent: sireCoverage.completenessPercent,
      damPedigreeCompletenessPercent: damCoverage.completenessPercent,
    });
  }
  return points;
}

/** Classic ancestor-loss coefficient (AVK): distinct recorded ancestors divided
 *  by ALL possible ancestor positions at the reference depth (5 generations),
 *  so missing ancestors count as lost, not just repeated ones (ZooEasy and
 *  German club convention; the ≥85% at 5 generations norm). */
export function buildAncestorLoss(sireGraph: LoadedAncestorGraph, damGraph: LoadedAncestorGraph, maxDepth: number): NonNullable<BreedingPairingAnalysisResponse["ancestorLoss"]> {
  const depth = Math.max(1, Math.min(5, maxDepth));
  // Offspring generation 1 contains only the two parents, so a depth-1 foal
  // projection must inspect parent graphs at depth 0. Forcing depth >=1 pulled
  // grandparents into a two-position denominator and could produce 300% AVK.
  const parentDepth = Math.max(0, depth - 1);
  const expected = 2 ** (depth + 1) - 2;
  const distinctAncestors = (graph: LoadedAncestorGraph): number => {
    const sliced = sliceAncestorGraph(graph, depth);
    let count = 0;
    for (const id of sliced.horses.keys()) if (id !== sliced.rootId) count += 1;
    return count;
  };
  const sireAvkPercent = expected ? roundBreeding(distinctAncestors(sireGraph) / expected * 100, 2) : null;
  const damAvkPercent = expected ? roundBreeding(distinctAncestors(damGraph) / expected * 100, 2) : null;
  // Projected foal: both parents themselves plus the union of their ancestor sets.
  const sireSlice = sliceAncestorGraph(sireGraph, parentDepth);
  const damSlice = sliceAncestorGraph(damGraph, parentDepth);
  const foalAncestors = new Set<number>([sireGraph.rootId, damGraph.rootId]);
  for (const id of sireSlice.horses.keys()) if (id !== sireSlice.rootId) foalAncestors.add(id);
  for (const id of damSlice.horses.keys()) if (id !== damSlice.rootId) foalAncestors.add(id);
  const projectedFoalAvkPercent = expected ? roundBreeding(foalAncestors.size / expected * 100, 2) : null;
  return { sireAvkPercent, damAvkPercent, projectedFoalAvkPercent };
}


/** Pure structural projection for a prospective offspring from two loaded parent pedigrees. */
export function buildProspectiveDiversityProjection(sireGraph:LoadedAncestorGraph,damGraph:LoadedAncestorGraph,offspringDepth:number):BreedingDiversityProjection{
  const depth=Math.max(2,Math.min(Math.trunc(offspringDepth),16));
  const parentDepth=Math.max(1,depth-1);
  const boundedSireGraph=graphThroughDepth(sireGraph,parentDepth);
  const boundedDamGraph=graphThroughDepth(damGraph,parentDepth);
  const sireCoverage=calculatePedigreeCoverage(boundedSireGraph,parentDepth);
  const damCoverage=calculatePedigreeCoverage(boundedDamGraph,parentDepth);
  const sireDiversity=calculatePedigreeDiversity(boundedSireGraph,parentDepth);
  const damDiversity=calculatePedigreeDiversity(boundedDamGraph,parentDepth);
  const sireSet=new Set(boundedSireGraph.horses.keys()); const damSet=new Set(boundedDamGraph.horses.keys());
  const union=new Set<number>([...sireSet,...damSet]);
  const shared=[...sireSet].filter(id=>damSet.has(id));
  const known=2+sireCoverage.knownAncestorPositions+damCoverage.knownAncestorPositions;
  const expected=(2**(depth+1))-2; const unique=union.size; const repeated=Math.max(0,known-unique);
  type Agg={horse:BreedingDiversityProjection["topProjectedAncestorContributions"][number]["horse"];weight:number;fromSire:boolean;fromDam:boolean};
  const weights=new Map<number,Agg>();
  const add=(id:number,horse:Agg["horse"],weight:number,side:"sire"|"dam")=>{const old=weights.get(id)??{horse,weight:0,fromSire:false,fromDam:false};old.weight+=weight;if(side==="sire")old.fromSire=true;else old.fromDam=true;weights.set(id,old)};
  const sire=boundedSireGraph.horses.get(boundedSireGraph.rootId)!; const dam=boundedDamGraph.horses.get(boundedDamGraph.rootId)!;
  add(sire.id,{id:sire.id,name_latin:sire.name_latin,name_native:sire.name_native,birth_year:sire.birth_year},.5,"sire");
  add(dam.id,{id:dam.id,name_latin:dam.name_latin,name_native:dam.name_native,birth_year:dam.birth_year},.5,"dam");
  for(const x of sireDiversity.topAncestorContributions){add(x.horse.id,x.horse,x.pathWeight*.5,"sire")}
  for(const x of damDiversity.topAncestorContributions){add(x.horse.id,x.horse,x.pathWeight*.5,"dam")}
  const knownWeight=1+.5*sireDiversity.knownPathWeight+.5*damDiversity.knownPathWeight;
  const ranked=[...weights.values()].sort((a,b)=>b.weight-a.weight||a.horse.id-b.horse.id);
  const share=(x:number)=>knownWeight>0?Math.round((x/knownWeight)*10000)/100:0;
  const top=ranked.slice(0,20).map(x=>({horse:x.horse,pathWeight:roundBreeding(x.weight,6),shareOfRecordedPathWeightPercent:share(x.weight),fromSire:x.fromSire,fromDam:x.fromDam}));
  const reasons:string[]=[]; if(sireCoverage.integrity.cycleDetected||damCoverage.integrity.cycleDetected)reasons.push("recorded pedigree cycle detected"); if(sireCoverage.integrity.truncated||damCoverage.integrity.truncated)reasons.push("analysis boundary reached"); const completeness=expected?known/expected*100:0; if(completeness<75)reasons.push(`projected pedigree completeness ${roundBreeding(completeness,2)}%`);
  const grade:BreedingDiversityProjection["confidence"]["grade"]=(sireCoverage.integrity.cycleDetected||damCoverage.integrity.cycleDetected||completeness<50)?"low":(sireCoverage.integrity.truncated||damCoverage.integrity.truncated||completeness<75)?"medium":"high"; if(!reasons.length)reasons.push("cycle-clean parent pedigrees with at least 75% projected positional coverage");
  return {depth,projectedKnownAncestorPositions:known,projectedExpectedAncestorPositions:expected,projectedPedigreeCompletenessPercent:roundBreeding(completeness,2),projectedUniqueRecordedAncestors:unique,projectedRepeatedAncestorPositions:repeated,projectedAncestorDiversityPercent:known?roundBreeding(unique/known*100,2):100,sharedRecordedAncestorsBetweenParents:shared.length,sireUniqueRecordedAncestors:[...sireSet].filter(id=>!damSet.has(id)).length,damUniqueRecordedAncestors:[...damSet].filter(id=>!sireSet.has(id)).length,projectedTop5RecordedPathWeightSharePercent:roundBreeding(top.slice(0,5).reduce((sum,x)=>sum+x.shareOfRecordedPathWeightPercent,0),2),projectedTop10RecordedPathWeightSharePercent:roundBreeding(top.slice(0,10).reduce((sum,x)=>sum+x.shareOfRecordedPathWeightPercent,0),2),topProjectedAncestorContributions:top,confidence:{grade,reasons},provenance:{method:BREEDING_DIVERSITY_METHOD,algorithmVersion:BREEDING_DIVERSITY_ALGORITHM_VERSION,interpretation:"Prospective offspring recorded-pedigree diversity projection from sire and dam ancestry. Path weights use 1/2^generation and are not genomic ancestry, disease risk, performance prediction, or breeding merit."}};
}

function graphThroughDepth(graph:LoadedAncestorGraph,depth:number):LoadedAncestorGraph{
  const keep=new Set<number>([graph.rootId]);
  let frontier=[graph.rootId];
  for(let generation=0;generation<depth&&frontier.length;generation+=1){
    const next:number[]=[];
    for(const id of frontier){
      const horse=graph.horses.get(id); if(!horse)continue;
      for(const parent of [horse.father_id,horse.mother_id]){
        if(typeof parent!=="number"||!graph.horses.has(parent)||keep.has(parent))continue;
        keep.add(parent); next.push(parent);
      }
    }
    frontier=next;
  }
  const horses=new Map([...graph.horses].filter(([id])=>keep.has(id)));
  const cycleNodeIds=new Set([...graph.cycleNodeIds].filter(id=>keep.has(id)));
  return {...graph,depth,horses,cycleNodeIds};
}

function roundBreeding(value:number,digits:number):number{const factor=10**digits;return Math.round((value+Number.EPSILON)*factor)/factor;}

export const BREEDING_OPTIMIZER_METHOD = "explainable-pedigree-mating-candidate-ranking" as const;export const BREEDING_OPTIMIZER_ALGORITHM_VERSION = "1.3.0" as const;

/**
 * R140-D (second Master-AI audit): the evidence floor. Below this share of
 * recorded ancestry the projected COI is manufactured from missing data — the
 * old behavior only warned and renormalized weights, which made thin pedigrees
 * LOOK favorable. Candidates under the floor are excluded with
 * code "insufficient_ancestry", never ranked.
 */
export const INSUFFICIENT_ANCESTRY_COVERAGE_PERCENT = 20;

/** Pure exclusion decision for the evidence floor (unit-testable). */
export function insufficientAncestryMessage(coveragePercent: number | null | undefined): string | null {
  if (coveragePercent == null || !Number.isFinite(coveragePercent)) return null;
  if (coveragePercent >= INSUFFICIENT_ANCESTRY_COVERAGE_PERCENT) return null;
  return `Excluded: projected pedigree completeness ${roundBreeding(coveragePercent, 1)}% is below the ${INSUFFICIENT_ANCESTRY_COVERAGE_PERCENT}% evidence floor; a ranking would be manufactured from missing data.`;
}

/**
 * Rank a bounded user-supplied candidate set using explainable pedigree-only
 * objectives. This deliberately does not search for or claim biological merit.
 */
export async function optimizeBreedingCandidates(
  db:D1Database,
  input:import("../contracts/platform").BreedingOptimizerInput,
):Promise<import("../contracts/platform").BreedingOptimizerResponse>{
  const fixedHorseId=Math.trunc(input.fixedHorseId);
  const fixedRole=input.fixedRole;
  const depth=Math.max(2,Math.min(12,Math.trunc(input.depth??8)));
  const candidateIds=[...new Set(input.candidateIds.map(Number).filter(id=>Number.isSafeInteger(id)&&id>0&&id!==fixedHorseId))].slice(0,12);
  const o=input.objectives??{};
  const objectives={
    lowProjectedCoiWeight:finiteWeight(o.lowProjectedCoiWeight,.45),
    ancestorDiversityWeight:finiteWeight(o.ancestorDiversityWeight,.25),
    lowConcentrationWeight:finiteWeight(o.lowConcentrationWeight,.15),
    candidateDiversityPreservationWeight:finiteWeight(o.candidateDiversityPreservationWeight,.15),
    coiCeilingPercent:Math.max(.1,Math.min(50,Number.isFinite(o.coiCeilingPercent)?Number(o.coiCeilingPercent):12.5)),
    avoidAncestorIds:[...new Set((o.avoidAncestorIds??[]).map(Number).filter(id=>Number.isSafeInteger(id)&&id>0))].slice(0,20),
    excludeAvoidedAncestors:Boolean(o.excludeAvoidedAncestors),
  };
  const fixedGraph=await loadAncestorGraph(db,fixedHorseId,depth,MAX_RELATIONSHIP_GRAPH_NODES_PER_HORSE);
  const results:import("../contracts/platform").BreedingOptimizerCandidate[]=[];
  const excludedCandidates:import("../contracts/platform").BreedingOptimizerExclusion[]=[];
  const eligibilityWarnings:string[]=[];
  if(!fixedGraph){
    throw new HttpError(404,"not_found","Fixed horse not found");
  }
  const fixedSex=classifyBreedingSex(fixedGraph.horses.get(fixedHorseId)?.sex_desc);
  const expectedFixedSex=expectedSexForRole(fixedRole);
  if(fixedSex!=="unknown"&&fixedSex!=="ambiguous"&&fixedSex!==expectedFixedSex){
    eligibilityWarnings.push(`fixed horse recorded sex (${fixedSex}) conflicts with requested ${fixedRole} role; no candidates ranked`);
    return {fixedHorseId,fixedRole,depth,evaluatedCandidates:0,ranked:[],excludedCandidates,eligibilityWarnings,objectives,provenance:{method:BREEDING_OPTIMIZER_METHOD,algorithmVersion:BREEDING_OPTIMIZER_ALGORITHM_VERSION,interpretation:"Explainable ranking over a user-supplied candidate set using recorded-pedigree COI, projected ancestor diversity/concentration and optional reference-population diversity context. Recorded sire/dam sex-role contradictions are not ranked; unknown historical sex remains analyzable with an explicit warning.",caveat:"Decision support only. This is not genetic merit, genomic compatibility, health, fertility, conformation, temperament, performance or market-value prediction."}};
  }
  if(fixedSex==="unknown"||fixedSex==="ambiguous") eligibilityWarnings.push(`fixed horse recorded sex is ${fixedSex}; ${fixedRole} role is user-supplied and confidence is reduced`);
  for(let start=0;start<candidateIds.length;start+=4){
    const chunk=candidateIds.slice(start,start+4);
    const evaluated=await Promise.all(chunk.map(async candidateId=>{
      const [candidateGraph,horse,dpi]=await Promise.all([
        loadAncestorGraph(db,candidateId,depth,MAX_RELATIONSHIP_GRAPH_NODES_PER_HORSE),
        loadOptimizerHorse(db,candidateId),
        loadCandidateDpi(db,candidateId),
      ]);
      if(!candidateGraph||!horse){
        excludedCandidates.push({candidateId,code:"missing_candidate",message:"Candidate is missing, deleted, or its pedigree graph could not be loaded."});
        return null;
      }
      const candidateRole=oppositeRole(fixedRole);
      const expectedCandidateSex=expectedSexForRole(candidateRole);
      const candidateSex=classifyBreedingSex(horse.sex_desc);
      if(candidateSex!=="unknown"&&candidateSex!=="ambiguous"&&candidateSex!==expectedCandidateSex){
        excludedCandidates.push({candidateId,code:"sex_role_conflict",message:`Candidate recorded sex (${candidateSex}) conflicts with required ${candidateRole} role.`});
        return null;
      }
      const sireId=fixedRole==="sire"?fixedHorseId:candidateId;
      const damId=fixedRole==="dam"?fixedHorseId:candidateId;
      const sireGraph=fixedRole==="sire"?fixedGraph:candidateGraph;
      const damGraph=fixedRole==="dam"?fixedGraph:candidateGraph;
      const pair=analyzeBreedingPairingFromGraphs(sireGraph,damGraph,depth);
      // Integrity gate (R35): candidates with cycle-detected or truncated pedigree
      // graphs are excluded outright instead of ranked with a confidence penalty —
      // their COI numbers are structurally unreliable and can top the ranking.
      if(pair.status!=="ok"){
        excludedCandidates.push({
          candidateId,
          code: "pedigree_integrity",
          message: pair.status === "cycle_detected"
            ? "Excluded: the recorded pedigree contains a cycle; coefficients would be unreliable."
            : "Excluded: the pedigree analysis boundary was truncated before the requested depth; coefficients would be unreliable.",
        });
        return null;
      }
      const diversity=pair.diversityProjection;
      const avoided=new Set<number>();
      if(objectives.avoidAncestorIds.length){
        for(const targetId of objectives.avoidAncestorIds){
          const inFixed=targetId!==fixedGraph.rootId&&fixedGraph.horses.has(targetId);
          const inCandidate=targetId!==candidateGraph.rootId&&candidateGraph.horses.has(targetId);
          if(inFixed||inCandidate)avoided.add(targetId);
        }
      }
      if(objectives.excludeAvoidedAncestors&&avoided.size){
        excludedCandidates.push({candidateId,code:"avoid_ancestor_exclusion",message:`Excluded because ${avoided.size} requested avoid-ancestor(s) are present in the bounded recorded pedigree.`});
        return null;
      }
      const coi=pair.projectedOffspringInbreedingPercent;
      if(coi!=null&&coi>objectives.coiCeilingPercent){
        excludedCandidates.push({candidateId,code:"coi_ceiling_exceeded",message:`Projected pedigree COI ${roundBreeding(coi,2)}% exceeds configured ceiling ${roundBreeding(objectives.coiCeilingPercent,2)}%.`});
        return null;
      }
      // R140-D + R142-B05 (Master-AI): evidence floor with PER-PARENT
      // sufficiency — the combined projected completeness let a fully
      // documented parent conceal the other parent's missing ancestry (the
      // reproduced 88.53-point top rank for a candidate with NO recorded
      // parents on one side). Each parent must now independently meet the
      // floor before comparative ranking; the weaker side is named in the
      // exclusion reason and coverage stays visible on ranked candidates.
      const sireCoverage = pair.sirePedigreeCompletenessPercent;
      const damCoverage = pair.damPedigreeCompletenessPercent;
      const weakestParentSide = (sireCoverage ?? 0) <= (damCoverage ?? 0) ? "sire" : "dam";
      const weakestParentCoverage = Math.min(sireCoverage ?? 0, damCoverage ?? 0);
      const insufficient = insufficientAncestryMessage(weakestParentCoverage);
      if (insufficient) {
        excludedCandidates.push({ candidateId, code: "insufficient_ancestry", message: `Excluded: the ${weakestParentSide}'s projected pedigree completeness ${roundBreeding(weakestParentCoverage, 1)}% is below the ${INSUFFICIENT_ANCESTRY_COVERAGE_PERCENT}% per-parent evidence floor (sire ${roundBreeding(sireCoverage ?? 0, 1)}% / dam ${roundBreeding(damCoverage ?? 0, 1)}%); a ranking would be manufactured from missing data.` });
        return null;
      }
      const coverage=diversity?.projectedPedigreeCompletenessPercent??Math.min(pair.sirePedigreeCompletenessPercent,pair.damPedigreeCompletenessPercent);
      const scoreBuild=buildBreedingOptimizerScore({projectedOffspringInbreedingPercent:coi,projectedAncestorDiversityPercent:diversity?.projectedAncestorDiversityPercent??null,projectedTop5RecordedPathWeightSharePercent:diversity?.projectedTop5RecordedPathWeightSharePercent??null,candidateDiversityPreservationIndex:dpi,objectives});
      const components=scoreBuild.components;
      let score=scoreBuild.score;
      if(avoided.size)score=Math.max(0,score-Math.min(35,avoided.size*12.5));
      // Master-Ai plan T26: this grade measures recorded-DATA quality, not
      // statistical certainty — renamed dataQualityGrade (confidenceGrade is
      // kept as a deprecated alias for frontend compatibility).
      let dataQuality:import("../contracts/platform").BreedingOptimizerCandidate["dataQualityGrade"]=pair.status!=="ok"||coverage<50?"low":coverage<75?"medium":"high";
      const sexUncertain=fixedSex==="unknown"||fixedSex==="ambiguous"||candidateSex==="unknown"||candidateSex==="ambiguous";
      if(sexUncertain) dataQuality=dataQuality==="high"?"medium":"low";
      const confidenceMultiplier=dataQuality==="high"?1:dataQuality==="medium"?.88:.72;
      const warnings:string[]=[];
      if(coverage<75)warnings.push(`projected pedigree completeness ${roundBreeding(coverage,1)}%`);
      if(dpi==null)warnings.push("candidate reference-population DPI unavailable; weights renormalized");
      if(candidateSex==="unknown"||candidateSex==="ambiguous")warnings.push(`candidate recorded sex is ${candidateSex}; ${candidateRole} role is user-supplied`);
      if(fixedSex==="unknown"||fixedSex==="ambiguous")warnings.push(`fixed horse recorded sex is ${fixedSex}; ${fixedRole} role is user-supplied`);
      if(avoided.size)warnings.push(`${avoided.size} requested avoid-ancestor(s) present; score penalized`);
      return {rank:0,candidate:horse,sireId,damId,score:roundBreeding(score,2),confidenceAdjustedScore:roundBreeding(score*confidenceMultiplier,2),projectedOffspringInbreedingPercent:coi,projectedAncestorDiversityPercent:diversity?.projectedAncestorDiversityPercent??null,projectedTop5RecordedPathWeightSharePercent:diversity?.projectedTop5RecordedPathWeightSharePercent??null,projectedPedigreeCompletenessPercent:diversity?.projectedPedigreeCompletenessPercent??null,sharedRecordedAncestorsBetweenParents:diversity?.sharedRecordedAncestorsBetweenParents??null,candidateDiversityPreservationIndex:dpi,dataQualityGrade:dataQuality,confidenceGrade:dataQuality,scoreComponents:components,avoidedAncestorsPresent:[...avoided].sort((a,b)=>a-b),warnings} satisfies import("../contracts/platform").BreedingOptimizerCandidate;
    }));
    for(const item of evaluated)if(item)results.push(item);
  }
  results.sort((a,b)=>b.confidenceAdjustedScore-a.confidenceAdjustedScore||b.score-a.score||a.candidate.id-b.candidate.id).forEach((x,i)=>x.rank=i+1);
  return {fixedHorseId,fixedRole,depth,evaluatedCandidates:results.length,ranked:results,excludedCandidates,eligibilityWarnings,objectives,provenance:{method:BREEDING_OPTIMIZER_METHOD,algorithmVersion:BREEDING_OPTIMIZER_ALGORITHM_VERSION,interpretation:"Explainable ranking over a user-supplied candidate set using recorded-pedigree COI, projected ancestor diversity/concentration and optional reference-population diversity context. Recorded sire/dam sex-role contradictions are excluded; candidates where EITHER parent's projected ancestry completeness is below the 20% per-parent evidence floor are excluded as insufficient_ancestry instead of ranked (R142-B05: combined coverage can no longer conceal one parent's missing ancestry); unknown historical sex remains analyzable with reduced confidence. Missing score components renormalize the remaining weights.",caveat:"Decision support only. This is not genetic merit, genomic compatibility, health, fertility, conformation, temperament, performance or market-value prediction."}};
}

export function buildBreedingOptimizerScore(input:{projectedOffspringInbreedingPercent:number|null;projectedAncestorDiversityPercent:number|null;projectedTop5RecordedPathWeightSharePercent:number|null;candidateDiversityPreservationIndex:number|null;objectives:{lowProjectedCoiWeight:number;ancestorDiversityWeight:number;lowConcentrationWeight:number;candidateDiversityPreservationWeight:number;coiCeilingPercent:number}}):{score:number;components:import("../contracts/platform").BreedingOptimizerScoreComponent[]}{
  const components:Array<import("../contracts/platform").BreedingOptimizerScoreComponent>=[
    optimizerComponent("low_projected_coi",input.projectedOffspringInbreedingPercent,input.projectedOffspringInbreedingPercent==null?null:clamp100(100*(1-input.projectedOffspringInbreedingPercent/input.objectives.coiCeilingPercent)),input.objectives.lowProjectedCoiWeight),
    optimizerComponent("ancestor_diversity",input.projectedAncestorDiversityPercent,input.projectedAncestorDiversityPercent,input.objectives.ancestorDiversityWeight),
    optimizerComponent("low_ancestor_concentration",input.projectedTop5RecordedPathWeightSharePercent,input.projectedTop5RecordedPathWeightSharePercent==null?null:clamp100(100-input.projectedTop5RecordedPathWeightSharePercent),input.objectives.lowConcentrationWeight),
    optimizerComponent("candidate_diversity_preservation",input.candidateDiversityPreservationIndex,input.candidateDiversityPreservationIndex,input.objectives.candidateDiversityPreservationWeight),
  ];
  const available=components.filter(x=>x.normalizedScore!=null&&x.nominalWeight>0);
  const weightTotal=available.reduce((sum,x)=>sum+x.nominalWeight,0)||1;
  for(const component of components)component.appliedWeight=component.normalizedScore==null?0:roundBreeding(component.nominalWeight/weightTotal,4);
  const score=available.reduce((sum,x)=>sum+(x.normalizedScore??0)*x.appliedWeight,0);
  return{score:roundBreeding(score,4),components};
}

function finiteWeight(value:number|undefined,fallback:number):number{return Math.max(0,Math.min(1,Number.isFinite(value)?Number(value):fallback))}
function clamp100(value:number):number{return Math.max(0,Math.min(100,value))}
function optimizerComponent(code:import("../contracts/platform").BreedingOptimizerScoreComponent["code"],rawValue:number|null,normalizedScore:number|null,nominalWeight:number):import("../contracts/platform").BreedingOptimizerScoreComponent{return{code,rawValue,normalizedScore:normalizedScore==null?null:roundBreeding(clamp100(normalizedScore),2),nominalWeight,appliedWeight:0}}
async function loadCandidateDpi(db:D1Database,horseId:number):Promise<number|null>{try{const row=await db.prepare("SELECT hri.diversity_preservation_index FROM horse_reference_intelligence hri JOIN registry_state rs ON rs.id=1 AND rs.analytics_stale=0 WHERE hri.horse_id = ?").bind(horseId).first<{diversity_preservation_index:number|null}>();return row?.diversity_preservation_index==null?null:Number(row.diversity_preservation_index)}catch{return null}}
async function loadOptimizerHorse(db:D1Database,id:number):Promise<import("../contracts/platform").BreedingOptimizerCandidate["candidate"]|null>{const row=await db.prepare("SELECT id,name_latin,name_native,birth_year,breed_desc,sex_desc FROM horses WHERE id = ? AND deleted_at IS NULL AND is_active=1").bind(id).first<any>();return row?{id:Number(row.id),name_latin:String(row.name_latin),name_native:row.name_native==null?null:String(row.name_native),birth_year:row.birth_year==null?null:Number(row.birth_year),breed_desc:row.breed_desc==null?null:String(row.breed_desc),sex_desc:row.sex_desc==null?null:String(row.sex_desc)}:null}

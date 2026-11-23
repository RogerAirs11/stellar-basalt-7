import type { PedigreeHorseRow } from "../db/types";
import { PUBLIC_PEDIGREE_COLUMNS_H as PEDIGREE_HORSE_COLUMNS_H } from "./publicRows";

export const PEDIGREE_COVERAGE_METHOD = "pedigree-position-coverage" as const;
export const PEDIGREE_COVERAGE_ALGORITHM_VERSION = "1.3.0" as const;
export const PEDIGREE_DIVERSITY_METHOD = "recorded-pedigree-path-weight-diversity" as const;
export const PEDIGREE_DIVERSITY_ALGORITHM_VERSION = "1.0.0" as const;
export const DESCENDANT_REACH_METHOD = "bounded-descendant-reach" as const;
export const DESCENDANT_REACH_ALGORITHM_VERSION = "1.0.0" as const;

export interface LoadedAncestorGraph {
  rootId: number;
  depth: number;
  horses: ReadonlyMap<number, PedigreeHorseRow>;
  missingParentIds: ReadonlySet<number>;
  unloadedParentIds: ReadonlySet<number>;
  cycleNodeIds: ReadonlySet<number>;
  truncated: boolean;
}

export interface AncestorPathEntry {
  depth: number;
  path: number[];
}

export type PedigreeBranch = "sire" | "dam" | null;

export interface AncestorPathCollection {
  pathsByAncestor: Map<number, number[][]>;
  totalPaths: number;
  truncated: boolean;
}

export interface PedigreeLineageSummary {
  relation: "tail_male" | "tail_female";
  horses: Array<Pick<PedigreeHorseRow, "id" | "name_latin" | "name_native" | "birth_year">>;
  completeToDepth: boolean;
  stoppedByCycle: boolean;
}

export interface PedigreeGenerationCoverage {
  generation: number;
  expectedPositions: number;
  knownPositions: number;
  completenessPercent: number;
}

export interface PedigreeBranchCoverage {
  relation: "sire" | "dam";
  rootHorseId: number | null;
  expectedPositions: number;
  knownPositions: number;
  completenessPercent: number;
}

export interface RepeatedAncestorSummary {
  horse: Pick<PedigreeHorseRow, "id" | "name_latin" | "name_native" | "birth_year">;
  occurrences: number;
  repeatedPositions: number;
  nearestGeneration: number;
  positionSharePercent: number;
  generationOccurrences: Array<{ generation: number; count: number }>;
  sireBranchOccurrences: number;
  damBranchOccurrences: number;
  crossesBranches: boolean;
}


export interface AncestorPathContribution {
  horse: Pick<PedigreeHorseRow, "id" | "name_latin" | "name_native" | "birth_year">;
  occurrences: number;
  nearestGeneration: number;
  pathWeight: number;
  shareOfRecordedPathWeightPercent: number;
  sireBranchPathWeight: number;
  damBranchPathWeight: number;
  crossesBranches: boolean;
}

export interface PedigreeDiversityMetrics {
  horseId: number;
  depth: number;
  status: "ok" | "partial" | "cycle_detected";
  equivalentCompleteGenerations: number;
  knownAncestorPositions: number;
  uniqueAncestors: number;
  repeatedAncestorPositions: number;
  repeatedPositionPercent: number;
  ancestorDiversityPercent: number;
  ancestorLossPercent: number;
  knownPathWeight: number;
  expectedPathWeight: number;
  weightedCoveragePercent: number;
  weightedRepeatedBurdenPercent: number;
  crossBranchRepeatedAncestorCount: number;
  top5RecordedPathWeightSharePercent: number;
  top10RecordedPathWeightSharePercent: number;
  topAncestorContributions: AncestorPathContribution[];
  confidence: { grade: "high" | "medium" | "low"; coveragePercent: number; reasons: string[] };
  integrity: PedigreeCoverageMetrics["integrity"];
  provenance: {
    method: typeof PEDIGREE_DIVERSITY_METHOD;
    algorithmVersion: typeof PEDIGREE_DIVERSITY_ALGORITHM_VERSION;
    interpretation: string;
  };
}

export interface DescendantReachMetrics {
  horseId: number;
  depth: number;
  directChildren: number;
  knownDescendants: number;
  maxKnownGeneration: number;
  generations: Array<{ generation: number; count: number }>;
  truncated: boolean;
  provenance: {
    method: typeof DESCENDANT_REACH_METHOD;
    algorithmVersion: typeof DESCENDANT_REACH_ALGORITHM_VERSION;
    interpretation: string;
  };
}

export interface PedigreeCoverageMetrics {
  horseId: number;
  depth: number;
  status: "ok" | "partial" | "cycle_detected";
  expectedAncestorPositions: number;
  knownAncestorPositions: number;
  completenessPercent: number;
  uniqueAncestors: number;
  repeatedAncestorPositions: number;
  /** Structural identity diversity among recorded positions; not a genetic-diversity metric. */
  uniqueAncestorRatioPercent: number;
  maxKnownGeneration: number;
  generations: PedigreeGenerationCoverage[];
  branches: { sire: PedigreeBranchCoverage; dam: PedigreeBranchCoverage };
  topRepeatedAncestors: RepeatedAncestorSummary[];
  lineages: { tailMale: PedigreeLineageSummary; tailFemale: PedigreeLineageSummary };
  integrity: {
    cycleDetected: boolean;
    cycleOccurrences: number;
    cycleNodeIds: number[];
    unresolvedParentReferences: number;
    truncated: boolean;
  };
  provenance: {
    method: typeof PEDIGREE_COVERAGE_METHOD;
    algorithmVersion: typeof PEDIGREE_COVERAGE_ALGORITHM_VERSION;
    interpretation: string;
  };
}

/**
 * Load the unique ancestor graph breadth-first. Repeated pedigree positions share one
 * fetched horse row, while later analytics can still count every occupied position.
 *
 * R132 PERFORMANCE: the graph used to be loaded one generation at a time —
 * root query, then a query per generation (and getPedigreeHorses re-chunked
 * at 80 ids) — which on the Hyperdrive→Supabase chain meant 2-6 SEQUENTIAL
 * network round trips per pedigree view (measured ~2.3s for /pedigree). The
 * whole closure now loads in ONE recursive-CTE query using the R120-proven
 * portable single-branch CASE form (valid on SQLite/D1 and PostgreSQL: the
 * recursive reference appears exactly once, in a JOIN condition). UNION (not
 * UNION ALL) deduplicates (id, depth) rows so cycles terminate by the depth
 * bound exactly like the old `expanded` set; deleted parents never enter the
 * walk (same as getPedigreeHorses' deleted_at filter); the root seed filters
 * deleted_at so a missing/deleted root still yields no rows → null. The
 * returned rows carry MIN(depth) AS the first-discovery generation, matching
 * the old BFS discovery order for every consumer (display tree, slice,
 * coverage, coefficients).
 */
/** R132: exported for the PG-portability regression test — the SQL shape
 * (join order, single recursive reference) is load-bearing on PostgreSQL:
 * a JOIN ON clause may only reference aliases joined to its LEFT, and the
 * recursive reference may appear exactly once. */
export const ANCESTOR_GRAPH_SQL = `
    WITH RECURSIVE walk(id, depth) AS (
      SELECT h.id, 0 FROM horses h WHERE h.id = ? AND h.deleted_at IS NULL AND h.is_active=1
      UNION
      SELECT par.id, a.depth + 1
      FROM walk a
      JOIN horses h ON h.id = a.id
      CROSS JOIN (SELECT 0 AS k UNION ALL SELECT 1) side
      JOIN horses par ON par.id = CASE WHEN side.k = 0 THEN h.father_id ELSE h.mother_id END
      WHERE a.depth < ?
        AND CASE WHEN side.k = 0 THEN h.father_id ELSE h.mother_id END IS NOT NULL
        AND par.deleted_at IS NULL AND par.is_active=1
    )
    SELECT ${PEDIGREE_HORSE_COLUMNS_H}, MIN(walk.depth) AS discovered_depth
    FROM walk JOIN horses h ON h.id = walk.id
    GROUP BY h.id, h.father_id, h.mother_id
    ORDER BY discovered_depth, h.id
  `;

export async function loadAncestorGraph(
  db: D1Database,
  horseId: number,
  depth: number,
  maxNodes = 5000,
): Promise<LoadedAncestorGraph | null> {
  const safeDepth = boundedInt(depth, 4, 0, 16);
  const safeMaxNodes = boundedInt(maxNodes, 5000, 64, 10_000);

  const rows = await db.prepare(ANCESTOR_GRAPH_SQL).bind(horseId, safeDepth).all<PedigreeHorseRow & { discovered_depth: number }>();

  const fetched = rows.results ?? [];
  if (!fetched.length) return null;
  const root = fetched[0]!;
  if (root.id !== horseId) return null;

  // The maxNodes cap: ancestors can never exceed 2^depth distinct ids, but
  // deeper analytics calls (relationship/breeding cap at 512) still pass an
  // explicit budget. Trim in the old BFS order (discovery depth, then id) and
  // surface the same truncated/unloadedParentIds contract the incremental
  // loader produced: kept horses' parents that fall beyond the cap are
  // "unloaded" (cap-trimmed, never missing), while parents that were never
  // found by the walk (nonexistent or deleted) are "missing".
  const ordered = fetched.slice(0, Math.max(1, safeMaxNodes));
  const dropped = new Set(fetched.slice(ordered.length).map((row) => row.id));
  const truncated = dropped.size > 0;

  const horses = new Map<number, PedigreeHorseRow>();
  for (const row of ordered) {
    const { discovered_depth: _depth, ...horse } = row;
    horses.set(horse.id, horse as PedigreeHorseRow);
  }

  const missingParentIds = new Set<number>();
  const unloadedParentIds = new Set<number>();
  for (const row of ordered) {
    if (row.discovered_depth >= safeDepth) continue;
    for (const parent of [row.father_id, row.mother_id]) {
      if (typeof parent !== "number" || horses.has(parent)) continue;
      if (dropped.has(parent)) unloadedParentIds.add(parent);
      else missingParentIds.add(parent);
    }
  }

  const cycleNodeIds = detectPedigreeCycleNodes(horses);
  return {
    rootId: root.id,
    depth: safeDepth,
    horses,
    missingParentIds,
    unloadedParentIds,
    cycleNodeIds,
    truncated,
  };
}

/** Shortest known path from the graph root to every loaded ancestor. */
/**
 * Create an exact shallower view of an already-loaded ancestor graph. This lets
 * one maximum-depth database load serve several pedigree calculations that use
 * different depths, without allowing deeper ancestors to leak into a shallower
 * coefficient/coverage result.
 */
export function sliceAncestorGraph(graph: LoadedAncestorGraph, depth: number): LoadedAncestorGraph {
  const safeDepth = boundedInt(depth, graph.depth, 0, graph.depth);
  if (safeDepth === graph.depth) return graph;

  const keep = new Set<number>([graph.rootId]);
  const generationById = new Map<number, number>([[graph.rootId, 0]]);
  let frontier = [graph.rootId];
  let truncated = false;

  for (let generation = 0; generation < safeDepth && frontier.length; generation += 1) {
    const next = new Set<number>();
    for (const id of frontier) {
      const horse = graph.horses.get(id);
      if (!horse) continue;
      for (const parent of [horse.father_id, horse.mother_id]) {
        if (typeof parent !== "number") continue;
        if (graph.unloadedParentIds.has(parent)) truncated = true;
        if (!graph.horses.has(parent)) continue;
        const nextGeneration = generation + 1;
        const previous = generationById.get(parent);
        if (previous === undefined || nextGeneration < previous) generationById.set(parent, nextGeneration);
        if (!keep.has(parent)) { keep.add(parent); next.add(parent); }
      }
    }
    frontier = [...next];
  }

  const horses = new Map<number, PedigreeHorseRow>();
  for (const id of keep) {
    const horse = graph.horses.get(id);
    if (horse) horses.set(id, horse);
  }
  const referencedMissing = new Set<number>();
  const referencedUnloaded = new Set<number>();
  for (const [id, horse] of horses) {
    const generation = generationById.get(id) ?? safeDepth;
    if (generation >= safeDepth) continue;
    for (const parent of [horse.father_id, horse.mother_id]) {
      if (typeof parent !== "number" || horses.has(parent)) continue;
      if (graph.unloadedParentIds.has(parent)) referencedUnloaded.add(parent);
      else if (graph.missingParentIds.has(parent)) referencedMissing.add(parent);
    }
  }

  return {
    rootId: graph.rootId, depth: safeDepth, horses,
    missingParentIds: referencedMissing, unloadedParentIds: referencedUnloaded,
    cycleNodeIds: new Set([...graph.cycleNodeIds].filter((id) => keep.has(id))),
    truncated: truncated || referencedUnloaded.size > 0,
  };
}

export function collectShortestAncestorPaths(graph: LoadedAncestorGraph): Map<number, AncestorPathEntry> {
  const paths = new Map<number, AncestorPathEntry>([[graph.rootId, { depth: 0, path: [graph.rootId] }]]);
  const queue = [graph.rootId];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const id = queue[cursor]!;
    const base = paths.get(id)!;
    if (base.depth >= graph.depth) continue;
    const horse = graph.horses.get(id);
    if (!horse) continue;
    for (const parent of [horse.father_id, horse.mother_id]) {
      if (typeof parent !== "number" || !graph.horses.has(parent) || paths.has(parent)) continue;
      paths.set(parent, { depth: base.depth + 1, path: [...base.path, parent] });
      queue.push(parent);
    }
  }
  return paths;
}

/**
 * Enumerate bounded simple root-to-ancestor paths. Unlike shortest-path helpers,
 * this intentionally preserves repeated pedigree routes so relationship atlases
 * and linebreeding visualizations can trace how the same ancestor enters a pedigree.
 */
export function collectAncestorPathSets(
  graph: LoadedAncestorGraph,
  maxPathsPerAncestor = 8,
  maxTotalPaths = 256,
): AncestorPathCollection {
  const perAncestor = Math.max(1, Math.min(Math.trunc(maxPathsPerAncestor), 32));
  const totalLimit = Math.max(8, Math.min(Math.trunc(maxTotalPaths), 2048));
  const pathsByAncestor = new Map<number, number[][]>();
  let totalPaths = 0;
  let truncated = false;
  const stack: Array<{ id: number; depth: number; path: number[]; visited: Set<number> }> = [
    { id: graph.rootId, depth: 0, path: [graph.rootId], visited: new Set([graph.rootId]) },
  ];

  while (stack.length) {
    const current = stack.pop()!;
    if (current.depth >= graph.depth) continue;
    const horse = graph.horses.get(current.id);
    if (!horse) continue;
    const parents = [horse.mother_id, horse.father_id]; // reversed for stack => sire processed first
    for (const parent of parents) {
      if (typeof parent !== "number" || !graph.horses.has(parent)) continue;
      if (current.visited.has(parent)) { truncated = true; continue; }
      const nextPath = [...current.path, parent];
      const existing = pathsByAncestor.get(parent) ?? [];
      if (existing.length < perAncestor && totalPaths < totalLimit) {
        existing.push(nextPath);
        pathsByAncestor.set(parent, existing);
        totalPaths += 1;
      } else {
        truncated = true;
      }
      if (current.depth + 1 < graph.depth && totalPaths < totalLimit) {
        const visited = new Set(current.visited);
        visited.add(parent);
        stack.push({ id: parent, depth: current.depth + 1, path: nextPath, visited });
      } else if (current.depth + 1 < graph.depth) {
        truncated = true;
      }
    }
  }

  return { pathsByAncestor, totalPaths, truncated };
}

export function pedigreePathBranch(graph: LoadedAncestorGraph, path: readonly number[]): PedigreeBranch {
  if (path.length < 2) return null;
  const root = graph.horses.get(graph.rootId);
  if (!root) return null;
  if (path[1] === root.father_id) return "sire";
  if (path[1] === root.mother_id) return "dam";
  return null;
}

/** Tail-male (sire-of-sire) and tail-female (dam-of-dam) lineage chains. */
export function collectTailLineage(
  graph: LoadedAncestorGraph,
  relation: "tail_male" | "tail_female",
  depth = graph.depth,
): PedigreeLineageSummary {
  const safeDepth = boundedInt(depth, graph.depth, 0, graph.depth);
  const horses: PedigreeLineageSummary["horses"] = [];
  const visited = new Set<number>();
  let currentId = graph.rootId;
  let stoppedByCycle = false;

  for (let generation = 0; generation <= safeDepth; generation += 1) {
    const horse = graph.horses.get(currentId);
    if (!horse) break;
    horses.push({ id: horse.id, name_latin: horse.name_latin, name_native: horse.name_native, birth_year: horse.birth_year });
    visited.add(currentId);
    if (generation === safeDepth) break;
    const next = relation === "tail_male" ? horse.father_id : horse.mother_id;
    if (typeof next !== "number" || !graph.horses.has(next)) break;
    if (visited.has(next)) { stoppedByCycle = true; break; }
    currentId = next;
  }

  return {
    relation,
    horses,
    completeToDepth: horses.length === safeDepth + 1,
    stoppedByCycle,
  };
}

/**
 * Structural pedigree coverage only. This is not COI and makes no genetic claim.
 * Repeated ancestors are counted in every occupied pedigree position, as required
 * for correct completeness/repetition semantics.
 */
export function calculatePedigreeCoverage(graph: LoadedAncestorGraph, depth = graph.depth): PedigreeCoverageMetrics {
  const safeDepth = boundedInt(depth, graph.depth, 0, graph.depth);
  const expectedAncestorPositions = safeDepth > 0 ? (2 ** (safeDepth + 1)) - 2 : 0;
  const knownByGeneration = Array.from({ length: safeDepth + 1 }, () => 0);
  const uniqueAncestors = new Set<number>();
  const occurrences = new Map<number, {
    count: number;
    nearestGeneration: number;
    generationCounts: Map<number, number>;
    sireBranchOccurrences: number;
    damBranchOccurrences: number;
  }>();
  const rootHorse = graph.horses.get(graph.rootId);
  const branchCounts = { sire: 0, dam: 0 };
  let knownAncestorPositions = 0;
  let repeatedAncestorPositions = 0;
  let unresolvedParentReferences = 0;
  let cycleOccurrences = 0;
  let maxKnownGeneration = 0;

  const stack: Array<{ id: number; generation: number; path: Set<number>; branch: "sire" | "dam" | null }> = [
    { id: graph.rootId, generation: 0, path: new Set([graph.rootId]), branch: null },
  ];

  while (stack.length) {
    const current = stack.pop()!;
    if (current.generation >= safeDepth) continue;
    const horse = graph.horses.get(current.id);
    if (!horse) continue;

    for (const [parentIndex, parent] of [horse.father_id, horse.mother_id].entries()) {
      if (typeof parent !== "number") continue;
      const nextGeneration = current.generation + 1;
      const branch = current.branch ?? (parentIndex === 0 ? "sire" : "dam");
      const parentHorse = graph.horses.get(parent);
      if (!parentHorse) {
        unresolvedParentReferences += 1;
        continue;
      }

      knownAncestorPositions += 1;
      branchCounts[branch] += 1;
      knownByGeneration[nextGeneration] = (knownByGeneration[nextGeneration] ?? 0) + 1;
      maxKnownGeneration = Math.max(maxKnownGeneration, nextGeneration);
      const existingOccurrence = occurrences.get(parent);
      if (existingOccurrence) {
        existingOccurrence.count += 1;
        existingOccurrence.nearestGeneration = Math.min(existingOccurrence.nearestGeneration, nextGeneration);
        existingOccurrence.generationCounts.set(nextGeneration, (existingOccurrence.generationCounts.get(nextGeneration) ?? 0) + 1);
        if (branch === "sire") existingOccurrence.sireBranchOccurrences += 1;
        else existingOccurrence.damBranchOccurrences += 1;
        repeatedAncestorPositions += 1;
      } else {
        occurrences.set(parent, {
          count: 1,
          nearestGeneration: nextGeneration,
          generationCounts: new Map([[nextGeneration, 1]]),
          sireBranchOccurrences: branch === "sire" ? 1 : 0,
          damBranchOccurrences: branch === "dam" ? 1 : 0,
        });
        uniqueAncestors.add(parent);
      }

      if (current.path.has(parent)) {
        cycleOccurrences += 1;
        continue;
      }
      if (nextGeneration < safeDepth) {
        const nextPath = new Set(current.path);
        nextPath.add(parent);
        stack.push({ id: parent, generation: nextGeneration, path: nextPath, branch });
      }
    }
  }

  const generations: PedigreeGenerationCoverage[] = [];
  for (let generation = 1; generation <= safeDepth; generation += 1) {
    const expectedPositions = 2 ** generation;
    const knownPositions = knownByGeneration[generation] ?? 0;
    generations.push({
      generation,
      expectedPositions,
      knownPositions,
      completenessPercent: percentage(knownPositions, expectedPositions),
    });
  }

  const branchExpected = safeDepth > 0 ? (2 ** safeDepth) - 1 : 0;
  const branch = (relation: "sire" | "dam", rootHorseId: number | null, knownPositions: number): PedigreeBranchCoverage => ({
    relation, rootHorseId, expectedPositions: branchExpected, knownPositions, completenessPercent: percentage(knownPositions, branchExpected),
  });
  const topRepeatedAncestors = [...occurrences.entries()]
    .filter(([, value]) => value.count > 1)
    .map(([id, value]): RepeatedAncestorSummary | null => {
      const horse = graph.horses.get(id);
      if (!horse) return null;
      return {
        horse: { id: horse.id, name_latin: horse.name_latin, name_native: horse.name_native, birth_year: horse.birth_year },
        occurrences: value.count,
        repeatedPositions: value.count - 1,
        nearestGeneration: value.nearestGeneration,
        positionSharePercent: percentage(value.count, knownAncestorPositions),
        generationOccurrences: [...value.generationCounts.entries()].sort((a, b) => a[0] - b[0]).map(([generation, count]) => ({ generation, count })),
        sireBranchOccurrences: value.sireBranchOccurrences,
        damBranchOccurrences: value.damBranchOccurrences,
        crossesBranches: value.sireBranchOccurrences > 0 && value.damBranchOccurrences > 0,
      };
    })
    .filter((value): value is RepeatedAncestorSummary => value !== null)
    .sort((left, right) => right.occurrences - left.occurrences || left.nearestGeneration - right.nearestGeneration || left.horse.id - right.horse.id)
    .slice(0, 8);

  const cycleDetected = graph.cycleNodeIds.size > 0 || cycleOccurrences > 0;
  const status: PedigreeCoverageMetrics["status"] = cycleDetected
    ? "cycle_detected"
    : graph.truncated || unresolvedParentReferences > 0
      ? "partial"
      : "ok";

  return {
    horseId: graph.rootId,
    depth: safeDepth,
    status,
    expectedAncestorPositions,
    knownAncestorPositions,
    completenessPercent: percentage(knownAncestorPositions, expectedAncestorPositions),
    uniqueAncestors: uniqueAncestors.size,
    repeatedAncestorPositions,
    uniqueAncestorRatioPercent: percentage(uniqueAncestors.size, knownAncestorPositions),
    maxKnownGeneration,
    generations,
    branches: {
      sire: branch("sire", typeof rootHorse?.father_id === "number" ? rootHorse.father_id : null, branchCounts.sire),
      dam: branch("dam", typeof rootHorse?.mother_id === "number" ? rootHorse.mother_id : null, branchCounts.dam),
    },
    topRepeatedAncestors,
    lineages: {
      tailMale: collectTailLineage(graph, "tail_male", safeDepth),
      tailFemale: collectTailLineage(graph, "tail_female", safeDepth),
    },
    integrity: {
      cycleDetected,
      cycleOccurrences,
      cycleNodeIds: [...graph.cycleNodeIds].sort((a, b) => a - b),
      unresolvedParentReferences,
      truncated: graph.truncated,
    },
    provenance: {
      method: PEDIGREE_COVERAGE_METHOD,
      algorithmVersion: PEDIGREE_COVERAGE_ALGORITHM_VERSION,
      interpretation: "Structural pedigree coverage; repeated ancestors count in every occupied pedigree position. This is not a genetic coefficient.",
    },
  };
}


/**
 * Explainable diversity/concentration summary derived only from recorded pedigree
 * paths. Each ancestor occurrence at generation g contributes a path weight 1/2^g.
 * The normalized shares describe representation inside the *recorded path-weight*
 * evidence at the selected depth; they are not genomic ancestry percentages.
 */
export function calculatePedigreeDiversity(graph: LoadedAncestorGraph, depth = graph.depth): PedigreeDiversityMetrics {
  const safeDepth = boundedInt(depth, graph.depth, 1, graph.depth);
  const coverage = calculatePedigreeCoverage(graph, safeDepth);
  type Acc = { occurrences:number; nearestGeneration:number; pathWeight:number; sireWeight:number; damWeight:number; maxSinglePathWeight:number };
  const byAncestor = new Map<number, Acc>();
  let knownPathWeight = 0;
  const stack:Array<{id:number;generation:number;path:Set<number>;branch:"sire"|"dam"|null}>=[{id:graph.rootId,generation:0,path:new Set([graph.rootId]),branch:null}];
  while(stack.length){
    const current=stack.pop()!;
    if(current.generation>=safeDepth)continue;
    const horse=graph.horses.get(current.id);
    if(!horse)continue;
    const parents:[number|null|undefined,"sire"|"dam"][]=[[horse.father_id,"sire"],[horse.mother_id,"dam"]];
    for(const [parent,rootBranch] of parents){
      if(typeof parent!=="number")continue;
      const parentHorse=graph.horses.get(parent);
      if(!parentHorse)continue;
      const generation=current.generation+1;
      const branch=current.branch??rootBranch;
      const weight=1/(2**generation);
      knownPathWeight+=weight;
      const acc=byAncestor.get(parent)??{occurrences:0,nearestGeneration:generation,pathWeight:0,sireWeight:0,damWeight:0,maxSinglePathWeight:0};
      acc.occurrences+=1;acc.nearestGeneration=Math.min(acc.nearestGeneration,generation);acc.pathWeight+=weight;acc.maxSinglePathWeight=Math.max(acc.maxSinglePathWeight,weight);
      if(branch==="sire")acc.sireWeight+=weight;else acc.damWeight+=weight;
      byAncestor.set(parent,acc);
      if(!current.path.has(parent)&&generation<safeDepth){const path=new Set(current.path);path.add(parent);stack.push({id:parent,generation,path,branch});}
    }
  }
  const expectedPathWeight=safeDepth;
  const repeatedWeighted=[...byAncestor.values()].reduce((sum,x)=>sum+Math.max(0,x.pathWeight-x.maxSinglePathWeight),0);
  const contributions=[...byAncestor.entries()].map(([id,x]):AncestorPathContribution|null=>{
    const horse=graph.horses.get(id);if(!horse)return null;
    return {horse:{id:horse.id,name_latin:horse.name_latin,name_native:horse.name_native,birth_year:horse.birth_year},occurrences:x.occurrences,nearestGeneration:x.nearestGeneration,pathWeight:roundMetric(x.pathWeight,6),shareOfRecordedPathWeightPercent:percentage(x.pathWeight,knownPathWeight),sireBranchPathWeight:roundMetric(x.sireWeight,6),damBranchPathWeight:roundMetric(x.damWeight,6),crossesBranches:x.sireWeight>0&&x.damWeight>0};
  }).filter((x):x is AncestorPathContribution=>x!==null).sort((a,b)=>b.pathWeight-a.pathWeight||a.nearestGeneration-b.nearestGeneration||a.horse.id-b.horse.id);
  const equivalentCompleteGenerations=coverage.generations.reduce((sum,g)=>sum+(g.expectedPositions?g.knownPositions/g.expectedPositions:0),0);
  const topShare=(limit:number)=>roundMetric(contributions.slice(0,limit).reduce((sum,x)=>sum+x.shareOfRecordedPathWeightPercent,0),2);
  const reasons:string[]=[];
  if(coverage.integrity.cycleDetected)reasons.push("recorded pedigree cycle detected");
  if(coverage.integrity.truncated)reasons.push("analysis node boundary reached");
  if(coverage.integrity.unresolvedParentReferences)reasons.push(`${coverage.integrity.unresolvedParentReferences} unresolved parent reference(s)`);
  if(coverage.completenessPercent<75)reasons.push(`pedigree completeness ${coverage.completenessPercent}%`);
  const grade:PedigreeDiversityMetrics["confidence"]["grade"]=coverage.integrity.cycleDetected||coverage.completenessPercent<50?"low":coverage.integrity.truncated||coverage.integrity.unresolvedParentReferences>0||coverage.completenessPercent<75?"medium":"high";
  if(!reasons.length)reasons.push("cycle-clean recorded pedigree with at least 75% positional coverage");
  return {horseId:graph.rootId,depth:safeDepth,status:coverage.status,equivalentCompleteGenerations:roundMetric(equivalentCompleteGenerations,3),knownAncestorPositions:coverage.knownAncestorPositions,uniqueAncestors:coverage.uniqueAncestors,repeatedAncestorPositions:coverage.repeatedAncestorPositions,repeatedPositionPercent:percentage(coverage.repeatedAncestorPositions,coverage.knownAncestorPositions),ancestorDiversityPercent:percentage(coverage.uniqueAncestors,coverage.knownAncestorPositions),ancestorLossPercent:roundMetric(100-percentage(coverage.uniqueAncestors,coverage.knownAncestorPositions),2),knownPathWeight:roundMetric(knownPathWeight,6),expectedPathWeight,weightedCoveragePercent:percentage(knownPathWeight,expectedPathWeight),weightedRepeatedBurdenPercent:percentage(repeatedWeighted,knownPathWeight),crossBranchRepeatedAncestorCount:contributions.filter(x=>x.occurrences>1&&x.crossesBranches).length,top5RecordedPathWeightSharePercent:topShare(5),top10RecordedPathWeightSharePercent:topShare(10),topAncestorContributions:contributions.slice(0,20),confidence:{grade,coveragePercent:coverage.completenessPercent,reasons},integrity:coverage.integrity,provenance:{method:PEDIGREE_DIVERSITY_METHOD,algorithmVersion:PEDIGREE_DIVERSITY_ALGORITHM_VERSION,interpretation:"Recorded-pedigree path-weight diversity/concentration. Ancestor path weights use 1/2^generation and normalized shares are shares of recorded pedigree path evidence, not genomic ancestry or genetic merit."}};
}

/**
 * Count unique known descendants by generation without constructing a presentation tree.
 * Traversal is bounded because descendant fan-out can be very large for influential horses.
 */
export async function calculateDescendantReach(
  db: D1Database,
  horseId: number,
  depth = 4,
  maxNodes = 5000,
): Promise<DescendantReachMetrics | null> {
  const safeDepth = boundedInt(depth, 4, 1, 6);
  const safeMaxNodes = boundedInt(maxNodes, 5000, 100, 10_000);
  const root = await getPedigreeHorse(db, horseId);
  if (!root) return null;

  const seen = new Set<number>([horseId]);
  let frontier = [horseId];
  const generations: Array<{ generation: number; count: number }> = [];
  let truncated = false;

  for (let generation = 1; generation <= safeDepth && frontier.length; generation += 1) {
    const next = new Set<number>();
    for (let start = 0; start < frontier.length; start += 12) {
      const chunk = frontier.slice(start, start + 12);
      const placeholders = chunk.map(() => "?").join(",");
      const rows = await db.prepare(`
        SELECT id, father_id, mother_id
        FROM horses
        WHERE deleted_at IS NULL AND is_active=1
          AND (father_id IN (${placeholders}) OR mother_id IN (${placeholders}))
        LIMIT 5000
      `).bind(...chunk, ...chunk).all<{ id: number; father_id: number | null; mother_id: number | null }>();
      if (rows.results.length >= 5000) truncated = true;
      for (const row of rows.results) {
        if (seen.has(row.id)) continue;
        if (seen.size - 1 >= safeMaxNodes) { truncated = true; continue; }
        seen.add(row.id);
        next.add(row.id);
      }
      if (seen.size - 1 >= safeMaxNodes) break;
    }
    generations.push({ generation, count: next.size });
    frontier = [...next];
    if (seen.size - 1 >= safeMaxNodes) break;
  }

  while (generations.length < safeDepth) generations.push({ generation: generations.length + 1, count: 0 });
  const maxKnownGeneration = generations.reduce((max, item) => item.count > 0 ? item.generation : max, 0);
  return {
    horseId,
    depth: safeDepth,
    directChildren: generations[0]?.count ?? 0,
    knownDescendants: seen.size - 1,
    maxKnownGeneration,
    generations,
    truncated,
    provenance: {
      method: DESCENDANT_REACH_METHOD,
      algorithmVersion: DESCENDANT_REACH_ALGORITHM_VERSION,
      interpretation: "Unique registered descendants reached within the selected bounded depth; this is a registry reach count, not a genetic influence score.",
    },
  };
}

export async function getPedigreeHorse(db: D1Database, id: number): Promise<PedigreeHorseRow | null> {
  return await db.prepare(`SELECT ${PEDIGREE_HORSE_COLUMNS_H} FROM horses h WHERE h.id = ? AND h.deleted_at IS NULL AND h.is_active=1`).bind(id).first<PedigreeHorseRow>();
}

export async function getPedigreeHorses(db: D1Database, ids: number[]): Promise<PedigreeHorseRow[]> {
  if (!ids.length) return [];
  const rows: PedigreeHorseRow[] = [];
  for (let start = 0; start < ids.length; start += 80) {
    const chunk = ids.slice(start, start + 80);
    const placeholders = chunk.map(() => "?").join(",");
    const result = await db.prepare(
      `SELECT ${PEDIGREE_HORSE_COLUMNS_H} FROM horses h WHERE h.id IN (${placeholders}) AND h.deleted_at IS NULL AND h.is_active=1`,
    ).bind(...chunk).all<PedigreeHorseRow>();
    rows.push(...result.results);
  }
  return rows;
}

/** Detect cycles in any materialized pedigree graph. Exported because two
 * individually acyclic bounded graphs can form a cycle only after they are
 * merged for relationship/pairing analysis. */
export function detectPedigreeCycleNodes(horses: ReadonlyMap<number, PedigreeHorseRow>): Set<number> {
  const state = new Map<number, 0 | 1 | 2>();
  const cycleNodes = new Set<number>();
  const stack: number[] = [];
  const stackPositions = new Map<number, number>();

  const visit = (id: number): void => {
    const currentState = state.get(id) ?? 0;
    if (currentState === 2) return;
    if (currentState === 1) {
      const start = stackPositions.get(id);
      if (start !== undefined) for (const cycleId of stack.slice(start)) cycleNodes.add(cycleId);
      return;
    }
    state.set(id, 1);
    stackPositions.set(id, stack.length);
    stack.push(id);
    const horse = horses.get(id);
    if (horse) {
      for (const parent of [horse.father_id, horse.mother_id]) {
        if (typeof parent === "number" && horses.has(parent)) visit(parent);
      }
    }
    stack.pop();
    stackPositions.delete(id);
    state.set(id, 2);
  };

  for (const id of horses.keys()) if ((state.get(id) ?? 0) === 0) visit(id);
  return cycleNodes;
}

function boundedInt(value: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(Math.trunc(value), max));
}

function percentage(value: number, total: number): number {
  if (total <= 0) return 100;
  return Math.round((value / total) * 10_000) / 100;
}

function roundMetric(value:number,digits:number):number{const factor=10**digits;return Math.round((value+Number.EPSILON)*factor)/factor;}

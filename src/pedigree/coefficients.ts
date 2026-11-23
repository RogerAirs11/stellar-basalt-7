import type { PedigreeHorseRow } from "../db/types";
import { calculatePedigreeCoverage, detectPedigreeCycleNodes, loadAncestorGraph, type LoadedAncestorGraph } from "./engine";

export const PEDIGREE_COEFFICIENT_METHOD = "finite-pedigree-tabular-relationship" as const;
export const PEDIGREE_COEFFICIENT_ALGORITHM_VERSION = "1.1.0" as const;
export const PEDIGREE_FOUNDER_ASSUMPTION = "unobserved-or-out-of-depth parents are treated as unrelated non-inbred founders" as const;

// Dense A matrices are O(n²). Keep live allocation bounded well below the
// Worker isolate memory ceiling; larger analyses return an explicit truncated
// result and should be served from validated offline/precomputed analytics.
export const MAX_RELATIONSHIP_MATRIX_NODES = 1024 as const;
export const MAX_RELATIONSHIP_GRAPH_NODES_PER_HORSE = 512 as const;

export type PedigreeCoefficientStatus = "ok" | "cycle_detected" | "truncated";

export interface PedigreeCoefficientMetrics {
  horseId: number;
  depth: number;
  status: PedigreeCoefficientStatus;
  inbreedingCoefficient: number | null;
  inbreedingPercent: number | null;
  pedigreeCompletenessPercent: number;
  analyzedHorses: number;
  assumedFounderNodes: number;
  boundaryParentReferences: number;
  integrity: {
    cycleDetected: boolean;
    truncated: boolean;
  };
  /** True when the coefficient is exactly zero while ancestry is incomplete:
   *  zero means no inbreeding detected WITHIN THE AVAILABLE pedigree — never
   *  "unrelated" or "safe" (P07 labeling rule). */
  zeroWithinIncompleteAncestry?: boolean;
  provenance: {
    method: typeof PEDIGREE_COEFFICIENT_METHOD;
    algorithmVersion: typeof PEDIGREE_COEFFICIENT_ALGORITHM_VERSION;
    founderAssumption: typeof PEDIGREE_FOUNDER_ASSUMPTION;
    interpretation: string;
  };
}

export interface RelationshipCoefficientMetrics {
  from: number;
  to: number;
  depth: number;
  status: PedigreeCoefficientStatus;
  relationshipCoefficient: number | null;
  relationshipPercent: number | null;
  kinshipCoefficient: number | null;
  kinshipPercent: number | null;
  fromInbreedingCoefficient: number | null;
  fromInbreedingPercent: number | null;
  toInbreedingCoefficient: number | null;
  toInbreedingPercent: number | null;
  fromPedigreeCompletenessPercent: number;
  toPedigreeCompletenessPercent: number;
  analyzedHorses: number;
  assumedFounderNodes: number;
  boundaryParentReferences: number;
  integrity: {
    cycleDetected: boolean;
    truncated: boolean;
  };
  provenance: {
    method: typeof PEDIGREE_COEFFICIENT_METHOD;
    algorithmVersion: typeof PEDIGREE_COEFFICIENT_ALGORITHM_VERSION;
    founderAssumption: typeof PEDIGREE_FOUNDER_ASSUMPTION;
    interpretation: string;
  };
}

interface RelationshipMatrix {
  ids: number[];
  indexById: Map<number, number>;
  values: Float64Array;
  assumedFounderNodes: number;
  boundaryParentReferences: number;
}

/**
 * Calculate a finite-depth pedigree COI from the loaded canonical pedigree graph.
 * This is a pedigree estimate, not a genomic measurement. Missing/out-of-depth
 * parentage is treated using the documented founder assumption.
 */
export async function calculatePedigreeCoefficient(
  db: D1Database,
  horseId: number,
  depth = 8,
  maxNodes = 5000,
): Promise<PedigreeCoefficientMetrics | null> {
  const safeMaxNodes = Math.min(Math.max(64, Math.trunc(maxNodes)), MAX_RELATIONSHIP_MATRIX_NODES);
  const graph = await loadAncestorGraph(db, horseId, depth, safeMaxNodes);
  if (!graph) return null;
  return calculatePedigreeCoefficientFromGraph(graph);
}

export function calculatePedigreeCoefficientFromGraph(graph: LoadedAncestorGraph): PedigreeCoefficientMetrics {
  const coverage = calculatePedigreeCoverage(graph, graph.depth);
  const cycleDetected = graph.cycleNodeIds.size > 0 || coverage.integrity.cycleDetected;
  const matrixLimitExceeded = graph.horses.size > MAX_RELATIONSHIP_MATRIX_NODES;
  const truncated = graph.truncated || matrixLimitExceeded;
  const status: PedigreeCoefficientStatus = cycleDetected ? "cycle_detected" : truncated ? "truncated" : "ok";
  const matrix = cycleDetected || truncated ? null : buildRelationshipMatrix(graph.horses);
  const rootIndex = matrix?.indexById.get(graph.rootId);
  const diagonal = matrix && rootIndex !== undefined ? matrix.values[rootIndex * matrix.ids.length + rootIndex] : null;
  const coefficient = diagonal === null || diagonal === undefined ? null : clampUnit(diagonal - 1);

  return {
    horseId: graph.rootId,
    depth: graph.depth,
    status,
    inbreedingCoefficient: coefficient,
    inbreedingPercent: coefficient === null ? null : round(coefficient * 100, 4),
    pedigreeCompletenessPercent: coverage.completenessPercent,
    analyzedHorses: graph.horses.size,
    assumedFounderNodes: matrix?.assumedFounderNodes ?? 0,
    boundaryParentReferences: matrix?.boundaryParentReferences ?? countBoundaryParentReferences(graph.horses),
    integrity: { cycleDetected, truncated },
    ...(coefficient === 0 && coverage.completenessPercent < 100 ? { zeroWithinIncompleteAncestry: true } : {}),
    provenance: coefficientProvenance(
      "Wright/tabular pedigree coefficient for the selected finite ancestry depth. It estimates pedigree inbreeding under the stated founder assumption; it is not genomic COI.",
    ),
  };
}

/** Calculate finite-depth additive relationship/kinship coefficients for a horse pair. */
export async function calculateRelationshipCoefficient(
  db: D1Database,
  fromId: number,
  toId: number,
  depth = 10,
  maxNodes = 5000,
): Promise<RelationshipCoefficientMetrics | null> {
  const safeDepth = Number.isFinite(depth) ? Math.max(1, Math.min(Math.trunc(depth), 16)) : 10;
  // Two disjoint graphs can merge to roughly twice the per-horse size, so cap
  // each side at half of the live dense-matrix ceiling. Truncation is surfaced
  // explicitly in the coefficient result rather than hidden.
  const safeMaxNodes = Math.min(Math.max(64, Math.trunc(maxNodes)), MAX_RELATIONSHIP_GRAPH_NODES_PER_HORSE);
  const [fromGraph, toGraph] = await Promise.all([
    loadAncestorGraph(db, fromId, safeDepth, safeMaxNodes),
    loadAncestorGraph(db, toId, safeDepth, safeMaxNodes),
  ]);
  if (!fromGraph || !toGraph) return null;
  return calculateRelationshipCoefficientFromGraphs(fromGraph, toGraph, safeDepth);
}

/** Calculate pair coefficients from graphs already loaded for the current request. */
export function calculateRelationshipCoefficientFromGraphs(
  fromGraph: LoadedAncestorGraph,
  toGraph: LoadedAncestorGraph,
  depth = Math.max(fromGraph.depth, toGraph.depth),
): RelationshipCoefficientMetrics {
  const safeDepth = Number.isFinite(depth) ? Math.max(1, Math.min(Math.trunc(depth), 16)) : Math.max(fromGraph.depth, toGraph.depth);
  const fromId = fromGraph.rootId;
  const toId = toGraph.rootId;
  const merged = mergeGraphs(fromGraph, toGraph, safeDepth);
  const fromCoverage = calculatePedigreeCoverage(fromGraph, safeDepth);
  const toCoverage = calculatePedigreeCoverage(toGraph, safeDepth);
  const cycleDetected = merged.cycleNodeIds.size > 0 || fromCoverage.integrity.cycleDetected || toCoverage.integrity.cycleDetected;
  const matrixLimitExceeded = merged.horses.size > MAX_RELATIONSHIP_MATRIX_NODES;
  const truncated = merged.truncated || matrixLimitExceeded;
  const status: PedigreeCoefficientStatus = cycleDetected ? "cycle_detected" : truncated ? "truncated" : "ok";
  const matrix = cycleDetected || truncated ? null : buildRelationshipMatrix(merged.horses);
  const n = matrix?.ids.length ?? 0;
  const fromIndex = matrix?.indexById.get(fromId);
  const toIndex = matrix?.indexById.get(toId);
  const rawAdditiveRelationship = matrix && fromIndex !== undefined && toIndex !== undefined
    ? matrix.values[fromIndex * n + toIndex]
    : null;
  const fromDiagonal = matrix && fromIndex !== undefined ? matrix.values[fromIndex * n + fromIndex] : null;
  const toDiagonal = matrix && toIndex !== undefined ? matrix.values[toIndex * n + toIndex] : null;
  const relationship = rawAdditiveRelationship === null || fromDiagonal === null || toDiagonal === null || fromDiagonal <= 0 || toDiagonal <= 0
    ? null
    : clampUnit(rawAdditiveRelationship / Math.sqrt(fromDiagonal * toDiagonal));
  const fromInbreeding = fromDiagonal === null || fromDiagonal === undefined ? null : clampUnit(fromDiagonal - 1);
  const toInbreeding = toDiagonal === null || toDiagonal === undefined ? null : clampUnit(toDiagonal - 1);
  const kinship = rawAdditiveRelationship === null ? null : Math.max(0, rawAdditiveRelationship / 2);

  return {
    from: fromId,
    to: toId,
    depth: safeDepth,
    status,
    relationshipCoefficient: relationship,
    relationshipPercent: relationship === null ? null : round(relationship * 100, 4),
    kinshipCoefficient: kinship,
    kinshipPercent: kinship === null ? null : round(kinship * 100, 4),
    fromInbreedingCoefficient: fromInbreeding,
    fromInbreedingPercent: fromInbreeding === null ? null : round(fromInbreeding * 100, 4),
    toInbreedingCoefficient: toInbreeding,
    toInbreedingPercent: toInbreeding === null ? null : round(toInbreeding * 100, 4),
    fromPedigreeCompletenessPercent: fromCoverage.completenessPercent,
    toPedigreeCompletenessPercent: toCoverage.completenessPercent,
    analyzedHorses: merged.horses.size,
    assumedFounderNodes: matrix?.assumedFounderNodes ?? 0,
    boundaryParentReferences: matrix?.boundaryParentReferences ?? countBoundaryParentReferences(merged.horses),
    integrity: { cycleDetected, truncated },
    ...(relationship === 0 && (fromCoverage.completenessPercent < 100 || toCoverage.completenessPercent < 100) ? { zeroWithinIncompleteAncestry: true } : {}),
    provenance: coefficientProvenance(
      "Finite-depth normalized pedigree relationship and kinship estimates from the additive relationship matrix under the stated founder assumption; these are pedigree-derived, not genomic similarity measurements.",
    ),
  };
}

/**
 * Build the classical numerator/additive relationship matrix A for an acyclic
 * finite pedigree. Parent nodes are topologically ordered before descendants.
 */
export function buildRelationshipMatrix(horses: ReadonlyMap<number, PedigreeHorseRow>): RelationshipMatrix {
  const ids = topologicalParentFirstOrder(horses);
  const indexById = new Map(ids.map((id, index) => [id, index]));
  const n = ids.length;
  if (n > MAX_RELATIONSHIP_MATRIX_NODES) {
    throw new RangeError(`Pedigree relationship matrix exceeds live safety limit (${n} > ${MAX_RELATIONSHIP_MATRIX_NODES} nodes)`);
  }
  const values = new Float64Array(n * n);
  let assumedFounderNodes = 0;
  let boundaryParentReferences = 0;

  for (let i = 0; i < n; i += 1) {
    const horse = horses.get(ids[i]!)!;
    const sire = typeof horse.father_id === "number" ? indexById.get(horse.father_id) : undefined;
    const dam = typeof horse.mother_id === "number" ? indexById.get(horse.mother_id) : undefined;
    if (typeof horse.father_id === "number" && sire === undefined) boundaryParentReferences += 1;
    if (typeof horse.mother_id === "number" && dam === undefined) boundaryParentReferences += 1;
    if (sire === undefined && dam === undefined) assumedFounderNodes += 1;

    for (let j = 0; j < i; j += 1) {
      const sireValue = sire === undefined ? 0 : values[sire * n + j]!;
      const damValue = dam === undefined ? 0 : values[dam * n + j]!;
      const value = 0.5 * (sireValue + damValue);
      values[i * n + j] = value;
      values[j * n + i] = value;
    }

    const parentalRelationship = sire !== undefined && dam !== undefined ? values[sire * n + dam]! : 0;
    values[i * n + i] = 1 + 0.5 * parentalRelationship;
  }

  return { ids, indexById, values, assumedFounderNodes, boundaryParentReferences };
}

function topologicalParentFirstOrder(horses: ReadonlyMap<number, PedigreeHorseRow>): number[] {
  const indegree = new Map<number, number>();
  const children = new Map<number, number[]>();
  for (const [id, horse] of horses) {
    let count = 0;
    for (const parent of [horse.father_id, horse.mother_id]) {
      if (typeof parent !== "number" || !horses.has(parent)) continue;
      count += 1;
      const list = children.get(parent) ?? [];
      list.push(id);
      children.set(parent, list);
    }
    indegree.set(id, count);
  }

  const ready = [...indegree.entries()].filter(([, degree]) => degree === 0).map(([id]) => id).sort((a, b) => a - b);
  const order: number[] = [];
  for (let cursor = 0; cursor < ready.length; cursor += 1) {
    const id = ready[cursor]!;
    order.push(id);
    for (const child of children.get(id) ?? []) {
      const next = (indegree.get(child) ?? 0) - 1;
      indegree.set(child, next);
      if (next === 0) {
        ready.push(child);
        // Keep deterministic ordering without repeatedly sorting the whole queue.
        let pos = ready.length - 1;
        while (pos > cursor + 1 && ready[pos - 1]! > ready[pos]!) {
          [ready[pos - 1], ready[pos]] = [ready[pos]!, ready[pos - 1]!];
          pos -= 1;
        }
      }
    }
  }

  if (order.length !== horses.size) throw new Error("Cannot calculate pedigree coefficients on a cyclic pedigree graph");
  return order;
}

function mergeGraphs(from: LoadedAncestorGraph, to: LoadedAncestorGraph, depth: number): LoadedAncestorGraph {
  const horses = new Map<number, PedigreeHorseRow>();
  for (const [id, horse] of from.horses) horses.set(id, horse);
  for (const [id, horse] of to.horses) horses.set(id, horse);
  // Recompute on the union. A cross-boundary cycle can be invisible inside
  // each bounded parent graph but become real once both graph fragments are
  // materialized together.
  const mergedCycleNodeIds = detectPedigreeCycleNodes(horses);
  return {
    rootId: from.rootId,
    depth,
    horses,
    missingParentIds: new Set([...from.missingParentIds, ...to.missingParentIds]),
    unloadedParentIds: new Set([...from.unloadedParentIds, ...to.unloadedParentIds]),
    cycleNodeIds: new Set([...from.cycleNodeIds, ...to.cycleNodeIds, ...mergedCycleNodeIds]),
    truncated: from.truncated || to.truncated,
  };
}

function countBoundaryParentReferences(horses: ReadonlyMap<number, PedigreeHorseRow>): number {
  let count = 0;
  for (const horse of horses.values()) {
    if (typeof horse.father_id === "number" && !horses.has(horse.father_id)) count += 1;
    if (typeof horse.mother_id === "number" && !horses.has(horse.mother_id)) count += 1;
  }
  return count;
}

function coefficientProvenance(interpretation: string) {
  return {
    method: PEDIGREE_COEFFICIENT_METHOD,
    algorithmVersion: PEDIGREE_COEFFICIENT_ALGORITHM_VERSION,
    founderAssumption: PEDIGREE_FOUNDER_ASSUMPTION,
    interpretation,
  } as const;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

import type { PublicHorseRow } from "../db/types";
import { collectAncestorPathSets, collectShortestAncestorPaths, loadAncestorGraph, pedigreePathBranch, type LoadedAncestorGraph, type PedigreeBranch } from "./engine";

export const RELATIONSHIP_ATLAS_METHOD = "bounded-pedigree-path-atlas" as const;
export const RELATIONSHIP_ATLAS_ALGORITHM_VERSION = "1.0.0" as const;

export interface CommonAncestorResult {
  horse: Pick<PublicHorseRow, "id" | "name_latin" | "name_native" | "birth_year">;
  fromDepth: number;
  toDepth: number;
  totalDepth: number;
  fromPath: number[];
  toPath: number[];
}

export interface RelationshipPathConnection {
  via: Pick<PublicHorseRow, "id" | "name_latin" | "name_native" | "birth_year">;
  fromDepth: number;
  toDepth: number;
  totalDepth: number;
  fromBranch: PedigreeBranch;
  toBranch: PedigreeBranch;
  fromPath: number[];
  toPath: number[];
}

export interface RelationshipAtlas {
  connections: RelationshipPathConnection[];
  tracedConnectionCount: number;
  pathEnumerationTruncated: boolean;
  provenance: {
    method: typeof RELATIONSHIP_ATLAS_METHOD;
    algorithmVersion: typeof RELATIONSHIP_ATLAS_ALGORITHM_VERSION;
    interpretation: string;
  };
}

export type RelationshipKind =
  | "same_horse"
  | "direct_ancestor"
  | "direct_descendant"
  | "full_sibling"
  | "half_sibling"
  | "related"
  | "no_common_ancestor";

export interface RelationshipAnalysis {
  from: number;
  to: number;
  commonAncestors: CommonAncestorResult[];
  atlas: RelationshipAtlas;
  summary: {
    kind: RelationshipKind;
    commonAncestorCount: number;
    closestTotalDepth: number | null;
    fromDepth: number | null;
    toDepth: number | null;
    directGeneration: number | null;
    directPath: number[] | null;
    paternalConnectionCount: number;
    maternalConnectionCount: number;
    crossBranchConnectionCount: number;
    integrity: {
      cycleDetected: boolean;
      truncated: boolean;
    };
  };
}

export async function analyzeRelationship(
  db: D1Database,
  fromId: number,
  toId: number,
  maxDepth = 10,
  maxNodes = 5000,
): Promise<RelationshipAnalysis> {
  const depth = Number.isFinite(maxDepth) ? Math.max(1, Math.min(Math.trunc(maxDepth), 16)) : 10;
  const [fromGraph, toGraph] = await Promise.all([
    loadAncestorGraph(db, fromId, depth, maxNodes),
    loadAncestorGraph(db, toId, depth, maxNodes),
  ]);
  if (!fromGraph || !toGraph) return emptyRelationship(fromId, toId);
  return analyzeRelationshipFromGraphs(fromGraph, toGraph, depth);
}

/** Analyze a relationship from ancestry graphs already loaded for this request. */
export function analyzeRelationshipFromGraphs(
  fromGraph: LoadedAncestorGraph,
  toGraph: LoadedAncestorGraph,
  maxDepth = Math.max(fromGraph.depth, toGraph.depth),
): RelationshipAnalysis {
  const depth = Number.isFinite(maxDepth) ? Math.max(1, Math.min(Math.trunc(maxDepth), 16)) : Math.max(fromGraph.depth, toGraph.depth);
  const fromId = fromGraph.rootId;
  const toId = toGraph.rootId;
  const fromPaths = collectShortestAncestorPaths(fromGraph);
  const toPaths = collectShortestAncestorPaths(toGraph);
  const common = [...fromPaths.keys()].filter((id) => id !== fromId && id !== toId && toPaths.has(id));
  common.sort((left, right) => {
    const leftFrom = fromPaths.get(left)!;
    const leftTo = toPaths.get(left)!;
    const rightFrom = fromPaths.get(right)!;
    const rightTo = toPaths.get(right)!;
    const leftTotal = leftFrom.depth + leftTo.depth;
    const rightTotal = rightFrom.depth + rightTo.depth;
    return leftTotal - rightTotal || Math.max(leftFrom.depth, leftTo.depth) - Math.max(rightFrom.depth, rightTo.depth) || left - right;
  });

  const commonAncestors = common.slice(0, 20).flatMap((id) => {
    const horse = fromGraph.horses.get(id) ?? toGraph.horses.get(id);
    if (!horse) return [];
    const from = fromPaths.get(id)!;
    const to = toPaths.get(id)!;
    return [{
      horse: { id: horse.id, name_latin: horse.name_latin, name_native: horse.name_native, birth_year: horse.birth_year },
      fromDepth: from.depth,
      toDepth: to.depth,
      totalDepth: from.depth + to.depth,
      fromPath: from.path,
      toPath: to.path,
    }];
  });

  const fromHorse = fromGraph.horses.get(fromId)!;
  const toHorse = toGraph.horses.get(toId)!;
  const fromInTo = toPaths.get(fromId);
  const toInFrom = fromPaths.get(toId);
  let kind: RelationshipKind;
  let directGeneration: number | null = null;
  let directPath: number[] | null = null;
  if (fromId === toId) kind = "same_horse";
  else if (fromInTo && fromInTo.depth > 0) {
    kind = "direct_ancestor";
    directGeneration = fromInTo.depth;
    directPath = [...fromInTo.path].reverse(); // from -> ... -> to
  }
  else if (toInFrom && toInFrom.depth > 0) {
    kind = "direct_descendant";
    directGeneration = toInFrom.depth;
    directPath = toInFrom.path; // from -> ... -> to
  }
  else if (
    typeof fromHorse.father_id === "number" && fromHorse.father_id === toHorse.father_id &&
    typeof fromHorse.mother_id === "number" && fromHorse.mother_id === toHorse.mother_id
  ) kind = "full_sibling";
  else if (
    (typeof fromHorse.father_id === "number" && fromHorse.father_id === toHorse.father_id) ||
    (typeof fromHorse.mother_id === "number" && fromHorse.mother_id === toHorse.mother_id)
  ) kind = "half_sibling";
  else if (commonAncestors.length) kind = "related";
  else kind = "no_common_ancestor";

  const fromAllPaths = collectAncestorPathSets(fromGraph, 6, 320);
  const toAllPaths = collectAncestorPathSets(toGraph, 6, 320);
  const connections = buildAtlasConnections(fromGraph, toGraph, common, fromAllPaths.pathsByAncestor, toAllPaths.pathsByAncestor, 36);
  const paternalConnectionCount = connections.filter((connection) => connection.fromBranch === "sire" && connection.toBranch === "sire").length;
  const maternalConnectionCount = connections.filter((connection) => connection.fromBranch === "dam" && connection.toBranch === "dam").length;
  const crossBranchConnectionCount = connections.filter((connection) => connection.fromBranch !== connection.toBranch).length;
  const closest = commonAncestors[0] ?? null;
  const integrityTruncated = fromGraph.truncated || toGraph.truncated || fromAllPaths.truncated || toAllPaths.truncated;

  return {
    from: fromId,
    to: toId,
    commonAncestors,
    atlas: {
      connections,
      tracedConnectionCount: connections.length,
      pathEnumerationTruncated: fromAllPaths.truncated || toAllPaths.truncated,
      provenance: {
        method: RELATIONSHIP_ATLAS_METHOD,
        algorithmVersion: RELATIONSHIP_ATLAS_ALGORITHM_VERSION,
        interpretation: "Bounded pedigree path atlas showing recorded ancestry routes through shared ancestors. Multiple paths may overlap; counts are traced routes, not independent genetic contributions.",
      },
    },
    summary: {
      kind,
      commonAncestorCount: common.length,
      closestTotalDepth: closest?.totalDepth ?? null,
      fromDepth: closest?.fromDepth ?? null,
      toDepth: closest?.toDepth ?? null,
      directGeneration,
      directPath,
      paternalConnectionCount,
      maternalConnectionCount,
      crossBranchConnectionCount,
      integrity: {
        cycleDetected: fromGraph.cycleNodeIds.size > 0 || toGraph.cycleNodeIds.size > 0,
        truncated: integrityTruncated,
      },
    },
  };
}

export async function findCommonAncestors(
  db: D1Database,
  fromId: number,
  toId: number,
  maxDepth = 10,
  maxNodes = 5000,
): Promise<CommonAncestorResult[]> {
  return (await analyzeRelationship(db, fromId, toId, maxDepth, maxNodes)).commonAncestors;
}

function buildAtlasConnections(
  fromGraph: Awaited<ReturnType<typeof loadAncestorGraph>> & {},
  toGraph: Awaited<ReturnType<typeof loadAncestorGraph>> & {},
  commonIds: readonly number[],
  fromPaths: ReadonlyMap<number, number[][]>,
  toPaths: ReadonlyMap<number, number[][]>,
  limit: number,
): RelationshipPathConnection[] {
  const candidates: RelationshipPathConnection[] = [];
  for (const id of commonIds.slice(0, 12)) {
    const horse = fromGraph.horses.get(id) ?? toGraph.horses.get(id);
    if (!horse) continue;
    const left = fromPaths.get(id) ?? [];
    const right = toPaths.get(id) ?? [];
    for (const fromPath of left.slice(0, 4)) {
      for (const toPath of right.slice(0, 4)) {
        candidates.push({
          via: { id: horse.id, name_latin: horse.name_latin, name_native: horse.name_native, birth_year: horse.birth_year },
          fromDepth: fromPath.length - 1,
          toDepth: toPath.length - 1,
          totalDepth: fromPath.length + toPath.length - 2,
          fromBranch: pedigreePathBranch(fromGraph, fromPath),
          toBranch: pedigreePathBranch(toGraph, toPath),
          fromPath,
          toPath,
        });
      }
    }
  }
  candidates.sort((a, b) => a.totalDepth - b.totalDepth || a.fromDepth - b.fromDepth || a.toDepth - b.toDepth || a.via.id - b.via.id || pathKey(a.fromPath).localeCompare(pathKey(b.fromPath)) || pathKey(a.toPath).localeCompare(pathKey(b.toPath)));
  const seen = new Set<string>();
  const result: RelationshipPathConnection[] = [];
  for (const candidate of candidates) {
    const key = `${candidate.via.id}:${pathKey(candidate.fromPath)}:${pathKey(candidate.toPath)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
    if (result.length >= limit) break;
  }
  return result;
}

function pathKey(path: readonly number[]): string { return path.join(">"); }

function emptyRelationship(from: number, to: number): RelationshipAnalysis {
  return {
    from,
    to,
    commonAncestors: [],
    atlas: {
      connections: [],
      tracedConnectionCount: 0,
      pathEnumerationTruncated: false,
      provenance: {
        method: RELATIONSHIP_ATLAS_METHOD,
        algorithmVersion: RELATIONSHIP_ATLAS_ALGORITHM_VERSION,
        interpretation: "Bounded pedigree path atlas showing recorded ancestry routes through shared ancestors. Multiple paths may overlap; counts are traced routes, not independent genetic contributions.",
      },
    },
    summary: {
      kind: "no_common_ancestor",
      commonAncestorCount: 0,
      closestTotalDepth: null,
      fromDepth: null,
      toDepth: null,
      directGeneration: null,
      directPath: null,
      paternalConnectionCount: 0,
      maternalConnectionCount: 0,
      crossBranchConnectionCount: 0,
      integrity: { cycleDetected: false, truncated: false },
    },
  };
}

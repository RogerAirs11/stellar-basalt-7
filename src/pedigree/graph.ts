import type { PedigreeHorseRow } from "../db/types";
import { PUBLIC_PEDIGREE_COLUMNS_H as PEDIGREE_HORSE_COLUMNS_H } from "./publicRows";
import { getPedigreeHorse, loadAncestorGraph, type LoadedAncestorGraph } from "./engine";

export interface PedigreeNode {
  horse: PedigreeHorseRow;
  relation: "self" | "father" | "mother" | "offspring";
  generation: number;
  repeated: boolean;
  cycle: boolean;
  parents?: PedigreeNode[];
  children?: PedigreeNode[];
}

export async function loadAncestors(db: D1Database, horseId: number, depth: number): Promise<PedigreeNode | null> {
  const safeDepth = boundedInt(depth, 4, 0, 8);
  const graph = await loadAncestorGraph(db, horseId, safeDepth);
  if (!graph) return null;
  return buildDisplayTree(graph);
}

/**
 * Display-tree projection: repeated ancestors are intentionally cross-references and
 * are not expanded twice. Analytics must use the underlying ancestor graph instead.
 */
function buildDisplayTree(graph: LoadedAncestorGraph): PedigreeNode {
  const seen = new Set<number>();

  function visit(id: number, generation: number, path: Set<number>, relation: PedigreeNode["relation"]): PedigreeNode {
    const horse = graph.horses.get(id)!;
    const repeated = seen.has(id);
    const cycle = path.has(id);
    seen.add(id);
    const node: PedigreeNode = { horse, relation, generation, repeated, cycle };
    if (cycle || repeated || generation >= graph.depth) return node;

    const nextPath = new Set(path);
    nextPath.add(id);
    const parents: PedigreeNode[] = [];
    if (typeof horse.father_id === "number" && graph.horses.has(horse.father_id)) {
      parents.push(visit(horse.father_id, generation + 1, nextPath, "father"));
    }
    if (typeof horse.mother_id === "number" && graph.horses.has(horse.mother_id)) {
      parents.push(visit(horse.mother_id, generation + 1, nextPath, "mother"));
    }
    if (parents.length) node.parents = parents;
    return node;
  }

  return visit(graph.rootId, 0, new Set(), "self");
}

/** R132: exported for the PG-portability regression test — PostgreSQL does
 * not implement LIMIT inside a recursive CTE, so the row budget lives on
 * the OUTER select only. */
export const DESCENDANT_GRAPH_SQL = `
    WITH RECURSIVE walk(id, depth) AS (
      SELECT h.id, 0 FROM horses h WHERE h.id = ? AND h.deleted_at IS NULL AND h.is_active=1
      UNION
      SELECT child.id, a.depth + 1
      FROM walk a
      JOIN horses child ON child.deleted_at IS NULL AND child.is_active=1
        AND (child.father_id = a.id OR child.mother_id = a.id)
      WHERE a.depth < ?
    )
    SELECT ${PEDIGREE_HORSE_COLUMNS_H}, walk.depth AS discovered_depth
    FROM walk JOIN horses h ON h.id = walk.id
    ORDER BY walk.depth, h.id
    LIMIT ?
  `;

export async function loadDescendants(db: D1Database, horseId: number, depth: number, maxNodes = 600): Promise<{ tree: PedigreeNode | null; truncated: boolean }> {
  const safeDepth = boundedInt(depth, 3, 0, 6);
  const safeMaxNodes = Math.max(50, Math.min(maxNodes, 1000));

  // R132 PERFORMANCE: descendants used to be loaded one generation at a time
  // (chunked at 50 ids per query — 3-7 sequential Hyperdrive round trips).
  // One recursive-CTE query now walks the whole bounded closure. (id, depth)
  // UNION dedup keeps cycles bounded by the depth cap exactly like the old
  // frontier loop. PostgreSQL does not implement LIMIT inside a recursive
  // CTE ("LIMIT in a recursive query is not implemented"), so the walk is
  // bounded by the depth cap alone and the OUTER select carries the row
  // budget (measured worst case on the live registry: the largest descendant
  // tree at depth 6 is ~2,100 pairs, ~0.6s including the network round
  // trip). Edge semantics are the old loader's: every loaded horse with
  // discovery depth < safeDepth was expanded exactly once, so a parent-child
  // edge exists iff BOTH ends are loaded and the parent was expanded
  // (discovered before the final level).
  const pairLimit = safeMaxNodes * 3;
  const rows = await db.prepare(DESCENDANT_GRAPH_SQL).bind(horseId, safeDepth, pairLimit).all<PedigreeHorseRow & { discovered_depth: number }>();

  const pairs = rows.results ?? [];
  if (!pairs.length) return { tree: null, truncated: false };

  const depthOf = new Map<number, number>();
  for (const row of pairs) {
    const previous = depthOf.get(row.id);
    if (previous === undefined || row.discovered_depth < previous) depthOf.set(row.id, row.discovered_depth);
  }
  const rootDepth = depthOf.get(horseId);
  if (rootDepth === undefined) return { tree: null, truncated: false };

  // Trim to the node budget in discovery order (depth, then id). The old
  // loader stopped loading once the budget filled and reported truncated.
  const orderedIds = [...depthOf.keys()].sort((a, b) => (depthOf.get(a)! - depthOf.get(b)!) || (a - b));
  const keep = new Set(orderedIds.slice(0, safeMaxNodes));
  const truncated = orderedIds.length > keep.size || pairs.length >= pairLimit;

  const horses = new Map<number, PedigreeHorseRow>();
  for (const row of pairs) {
    if (!keep.has(row.id) || horses.has(row.id)) continue;
    const { discovered_depth: _depth, ...horse } = row;
    horses.set(row.id, horse as PedigreeHorseRow);
  }

  const childrenByParent = new Map<number, number[]>();
  for (const child of horses.values()) {
    for (const parentId of [child.father_id, child.mother_id]) {
      if (typeof parentId !== "number" || !horses.has(parentId)) continue;
      const parentDepth = depthOf.get(parentId)!;
      if (parentDepth >= safeDepth) continue;
      const list = childrenByParent.get(parentId) ?? [];
      if (!list.includes(child.id)) list.push(child.id);
      childrenByParent.set(parentId, list);
    }
  }

  for (const list of childrenByParent.values()) {
    list.sort((a, b) => {
      const left = horses.get(a); const right = horses.get(b);
      const yearA = left?.birth_year ?? 9999; const yearB = right?.birth_year ?? 9999;
      if (yearA !== yearB) return yearA - yearB;
      return (left?.name_latin ?? "").localeCompare(right?.name_latin ?? "");
    });
  }

  const seen = new Set<number>();
  function build(id: number, generation: number, path: Set<number>, relation: PedigreeNode["relation"]): PedigreeNode {
    const horse = horses.get(id)!;
    const repeated = seen.has(id);
    const cycle = path.has(id);
    seen.add(id);
    const node: PedigreeNode = { horse, relation, generation, repeated, cycle };
    if (cycle || repeated || generation >= safeDepth) return node;
    const nextPath = new Set(path); nextPath.add(id);
    const children = (childrenByParent.get(id) ?? []).flatMap((childId) => horses.has(childId) ? [build(childId, generation + 1, nextPath, "offspring")] : []);
    if (children.length) node.children = children;
    return node;
  }
  return { tree: build(horseId, 0, new Set(), "self"), truncated };
}

function boundedInt(value: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(Math.trunc(value), max));
}

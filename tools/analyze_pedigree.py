#!/usr/bin/env python3
"""Read-only pedigree graph audit and analytics benchmark for Horse DB SQLite.

This tool deliberately does not write derived statistics back to the canonical database.
It measures the real graph first so materialization/caching decisions can be evidence-based.
"""
from __future__ import annotations

import argparse
import collections
import json
import sqlite3
import statistics
import time
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Iterable


@dataclass(frozen=True)
class HorseEdge:
    father_id: int | None
    mother_id: int | None


@dataclass
class PedigreeGraph:
    parents: dict[int, HorseEdge]
    children: dict[int, list[int]]


def load_graph(conn: sqlite3.Connection) -> PedigreeGraph:
    rows = conn.execute(
        "SELECT id,father_id,mother_id FROM horses WHERE deleted_at IS NULL"
    ).fetchall()
    parents: dict[int, HorseEdge] = {}
    children: dict[int, list[int]] = collections.defaultdict(list)
    for raw_id, raw_father, raw_mother in rows:
        horse_id = int(raw_id)
        father = int(raw_father) if raw_father is not None else None
        mother = int(raw_mother) if raw_mother is not None else None
        parents[horse_id] = HorseEdge(father, mother)
    for horse_id, edge in parents.items():
        if edge.father_id in parents:
            children[edge.father_id].append(horse_id)
        if edge.mother_id in parents:
            children[edge.mother_id].append(horse_id)
    return PedigreeGraph(parents=parents, children=dict(children))


def find_cycle_nodes(graph: PedigreeGraph) -> set[int]:
    """Return nodes that participate in at least one directed ancestry cycle."""
    state: dict[int, int] = {}
    cycle_nodes: set[int] = set()

    for start in graph.parents:
        if state.get(start, 0) != 0:
            continue
        # Iterative DFS avoids depending on Python recursion depth for malformed data.
        stack: list[tuple[int, int]] = [(start, 0)]
        path: list[int] = []
        path_pos: dict[int, int] = {}
        while stack:
            node, next_parent_index = stack[-1]
            if state.get(node, 0) == 0:
                state[node] = 1
                path_pos[node] = len(path)
                path.append(node)

            edge = graph.parents.get(node)
            parent_ids = () if edge is None else (edge.father_id, edge.mother_id)
            advanced = False
            while next_parent_index < len(parent_ids):
                parent = parent_ids[next_parent_index]
                next_parent_index += 1
                stack[-1] = (node, next_parent_index)
                if parent is None or parent not in graph.parents:
                    continue
                parent_state = state.get(parent, 0)
                if parent_state == 0:
                    stack.append((parent, 0))
                    advanced = True
                    break
                if parent_state == 1:
                    pos = path_pos.get(parent)
                    if pos is not None:
                        cycle_nodes.update(path[pos:])
            if advanced:
                continue

            stack.pop()
            state[node] = 2
            pos = path_pos.pop(node, None)
            if pos is not None:
                # Normal DFS unwinds from the end; this guard keeps path bookkeeping
                # safe even if malformed input produced an unexpected shape.
                del path[pos:]
    return cycle_nodes


def descendants_of(graph: PedigreeGraph, starts: Iterable[int]) -> set[int]:
    affected = set(starts)
    queue = collections.deque(affected)
    while queue:
        node = queue.popleft()
        for child in graph.children.get(node, ()):  # parent -> child direction
            if child not in affected:
                affected.add(child)
                queue.append(child)
    return affected


def quantile(values: list[int], fraction: float) -> int:
    if not values:
        return 0
    ordered = sorted(values)
    index = round((len(ordered) - 1) * fraction)
    return ordered[max(0, min(index, len(ordered) - 1))]


def completeness_stats(graph: PedigreeGraph, eligible: list[int], depth: int) -> dict[str, float | int]:
    expected = (2 ** (depth + 1)) - 2

    @lru_cache(maxsize=None)
    def known_positions(horse_id: int, remaining_depth: int) -> int:
        if remaining_depth <= 0:
            return 0
        edge = graph.parents.get(horse_id)
        if edge is None:
            return 0
        total = 0
        for parent in (edge.father_id, edge.mother_id):
            if parent is None or parent not in graph.parents:
                continue
            total += 1
            total += known_positions(parent, remaining_depth - 1)
        return total

    known = [known_positions(horse_id, depth) for horse_id in eligible]
    ratios = [value / expected for value in known] if expected else [1.0 for _ in known]
    return {
        "depth": depth,
        "expected_positions": expected,
        "eligible_horses": len(eligible),
        "average_completeness_percent": round((sum(ratios) / len(ratios)) * 100, 3) if ratios else 0.0,
        "median_completeness_percent": round(statistics.median(ratios) * 100, 3) if ratios else 0.0,
        "fully_complete_horses": sum(value == expected for value in known),
    }


def repeated_ancestor_stats(graph: PedigreeGraph, eligible: list[int], depth: int) -> dict[str, float | int]:
    total_known = 0
    total_unique = 0
    total_repeated = 0
    horses_with_repetition = 0

    for root in eligible:
        known = 0
        unique: set[int] = set()
        repeated = 0
        stack: list[tuple[int, int]] = [(root, 0)]
        while stack:
            node, generation = stack.pop()
            if generation >= depth:
                continue
            edge = graph.parents.get(node)
            if edge is None:
                continue
            for parent in (edge.father_id, edge.mother_id):
                if parent is None or parent not in graph.parents:
                    continue
                known += 1
                if parent in unique:
                    repeated += 1
                else:
                    unique.add(parent)
                # eligible excludes every horse whose ancestry reaches a cycle,
                # so this traversal cannot loop indefinitely.
                stack.append((parent, generation + 1))
        total_known += known
        total_unique += len(unique)
        total_repeated += repeated
        if repeated:
            horses_with_repetition += 1

    count = len(eligible)
    return {
        "depth": depth,
        "eligible_horses": count,
        "horses_with_repeated_ancestors": horses_with_repetition,
        "average_known_positions": round(total_known / count, 3) if count else 0.0,
        "average_unique_ancestors": round(total_unique / count, 3) if count else 0.0,
        "average_repeated_positions": round(total_repeated / count, 3) if count else 0.0,
    }


def quality_counts(conn: sqlite3.Connection) -> dict[str, int]:
    rows = conn.execute(
        "SELECT issue_code,COUNT(*) FROM data_quality_issues WHERE resolved_at IS NULL GROUP BY issue_code"
    ).fetchall()
    return {str(code): int(count) for code, count in rows}


def analyze(database: Path, depths: list[int], repeat_depth: int) -> dict[str, object]:
    started = time.perf_counter()
    conn = sqlite3.connect(database)
    try:
        integrity = str(conn.execute("PRAGMA integrity_check").fetchone()[0])
        fk_violations = len(conn.execute("PRAGMA foreign_key_check").fetchall())

        graph_started = time.perf_counter()
        graph = load_graph(conn)
        graph_seconds = time.perf_counter() - graph_started

        cycle_nodes = find_cycle_nodes(graph)
        cycle_affected = descendants_of(graph, cycle_nodes)
        eligible = [horse_id for horse_id in graph.parents if horse_id not in cycle_affected]

        edge_count = sum(
            int(edge.father_id is not None) + int(edge.mother_id is not None)
            for edge in graph.parents.values()
        )
        both = sum(edge.father_id is not None and edge.mother_id is not None for edge in graph.parents.values())
        one = sum((edge.father_id is None) != (edge.mother_id is None) for edge in graph.parents.values())
        none = len(graph.parents) - both - one
        missing_refs = sum(
            1
            for edge in graph.parents.values()
            for parent in (edge.father_id, edge.mother_id)
            if parent is not None and parent not in graph.parents
        )
        self_parent_links = sum(
            1
            for horse_id, edge in graph.parents.items()
            for parent in (edge.father_id, edge.mother_id)
            if parent == horse_id
        )
        same_parent_links = sum(
            edge.father_id is not None and edge.father_id == edge.mother_id
            for edge in graph.parents.values()
        )

        child_counts = [len(graph.children.get(horse_id, ())) for horse_id in graph.parents]
        nonzero_child_counts = [count for count in child_counts if count]

        completeness_started = time.perf_counter()
        completeness = [completeness_stats(graph, eligible, depth) for depth in depths]
        completeness_seconds = time.perf_counter() - completeness_started

        repetition_started = time.perf_counter()
        repetition = repeated_ancestor_stats(graph, eligible, repeat_depth)
        repetition_seconds = time.perf_counter() - repetition_started

        report: dict[str, object] = {
            "database": str(database),
            "integrity": integrity,
            "foreign_key_violations": fk_violations,
            "graph": {
                "horses": len(graph.parents),
                "parent_edges": edge_count,
                "horses_with_both_parents": both,
                "horses_with_exactly_one_parent": one,
                "horses_with_no_parents": none,
                "missing_parent_references": missing_refs,
                "self_parent_links": self_parent_links,
                "same_sire_and_dam_records": same_parent_links,
                "cycle_nodes": len(cycle_nodes),
                "horses_whose_ancestry_reaches_cycle": len(cycle_affected),
                "analytics_eligible_without_cycle_contamination": len(eligible),
            },
            "direct_descendants": {
                "horses_with_direct_children": len(nonzero_child_counts),
                "median_children_among_parents": quantile(nonzero_child_counts, 0.50),
                "p90_children_among_parents": quantile(nonzero_child_counts, 0.90),
                "p95_children_among_parents": quantile(nonzero_child_counts, 0.95),
                "p99_children_among_parents": quantile(nonzero_child_counts, 0.99),
                "max_direct_children": max(nonzero_child_counts, default=0),
            },
            "open_quality_issues": quality_counts(conn),
            "pedigree_completeness": completeness,
            "repeated_ancestors": repetition,
            "timings_seconds": {
                "load_graph": round(graph_seconds, 4),
                "completeness": round(completeness_seconds, 4),
                "repetition": round(repetition_seconds, 4),
                "total": round(time.perf_counter() - started, 4),
            },
            "method_notes": {
                "cycle_policy": "Completeness/repetition aggregates exclude horses whose ancestry reaches a detected cycle.",
                "completeness": "Known pedigree positions divided by the full binary pedigree positions through the requested depth; repeated ancestors count in every occupied position.",
                "repetition": "Known ancestor positions minus unique ancestor identities at the requested depth.",
                "derived_data_policy": "Read-only measurement. No analytics values are written into canonical horse records.",
            },
        }
        return report
    finally:
        conn.close()


def parse_depths(raw: str) -> list[int]:
    values: list[int] = []
    for token in raw.split(","):
        depth = int(token.strip())
        if depth < 1 or depth > 12:
            raise ValueError("depths must be between 1 and 12")
        if depth not in values:
            values.append(depth)
    if not values:
        raise ValueError("at least one depth is required")
    return values


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("database", type=Path)
    parser.add_argument("--depths", default="2,4,6,8", help="comma-separated completeness depths (1-12)")
    parser.add_argument("--repeat-depth", type=int, default=6, help="depth for repeated-ancestor aggregate (1-10)")
    parser.add_argument("--json", action="store_true", help="emit compact JSON instead of formatted JSON")
    args = parser.parse_args()
    if not args.database.exists():
        parser.error(f"Database not found: {args.database}")
    try:
        depths = parse_depths(args.depths)
    except ValueError as exc:
        parser.error(str(exc))
    if args.repeat_depth < 1 or args.repeat_depth > 10:
        parser.error("--repeat-depth must be between 1 and 10")

    report = analyze(args.database, depths, args.repeat_depth)
    print(json.dumps(report, ensure_ascii=False, indent=None if args.json else 2, sort_keys=False))
    return 0 if report["integrity"] == "ok" and report["foreign_key_violations"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())

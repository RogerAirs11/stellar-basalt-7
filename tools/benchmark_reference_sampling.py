from __future__ import annotations

import argparse
import importlib.util
import math
import sqlite3
import sys
import time
from collections import defaultdict
from functools import lru_cache
from pathlib import Path
from statistics import median


def load_builder():
    path = Path(__file__).with_name("build_analytics_snapshot.py")
    spec = importlib.util.spec_from_file_location("horse_db_analytics_builder", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot import {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def summary(errors: list[float]) -> dict[str, float]:
    values = sorted(errors)
    if not values:
        return {"mae": 0.0, "median": 0.0, "p90": 0.0, "p95": 0.0, "max": 0.0, "rmse": 0.0}

    def q(p: float) -> float:
        pos = (len(values) - 1) * p
        lo, hi = math.floor(pos), math.ceil(pos)
        if lo == hi:
            return values[lo]
        return values[lo] + (values[hi] - values[lo]) * (pos - lo)

    return {
        "mae": sum(values) / len(values),
        "median": median(values),
        "p90": q(0.90),
        "p95": q(0.95),
        "max": max(values),
        "rmse": math.sqrt(sum(value * value for value in values) / len(values)),
    }


def rankdata(values: list[float]) -> list[float]:
    order = sorted(range(len(values)), key=lambda index: values[index])
    result = [0.0] * len(values)
    cursor = 0
    while cursor < len(order):
        end = cursor + 1
        while end < len(order) and values[order[end]] == values[order[cursor]]:
            end += 1
        rank = (cursor + end - 1) / 2 + 1
        for index in range(cursor, end):
            result[order[index]] = rank
        cursor = end
    return result


def correlation(a: list[float], b: list[float]) -> float:
    if len(a) < 2:
        return 1.0
    mean_a, mean_b = sum(a) / len(a), sum(b) / len(b)
    numerator = sum((x - mean_a) * (y - mean_b) for x, y in zip(a, b))
    denom_a = sum((x - mean_a) ** 2 for x in a)
    denom_b = sum((y - mean_b) ** 2 for y in b)
    return numerator / math.sqrt(denom_a * denom_b) if denom_a and denom_b else 1.0


def main() -> int:
    parser = argparse.ArgumentParser(description="Benchmark deterministic reference-population mean-kinship sampling against a larger reference sample.")
    parser.add_argument("database", type=Path)
    parser.add_argument("--top-breeds", type=int, default=6)
    parser.add_argument("--targets-per-breed", type=int, default=128)
    parser.add_argument("--baseline-sample", type=int, default=512)
    parser.add_argument("--samples", default="16,32,64,128,256")
    parser.add_argument("--max-cache-pairs", type=int, default=250_000,
                        help="Maximum cached kinship pairs; eviction preserves calculations but may require more work")
    parser.add_argument("--max-seconds", type=float, default=60,
                        help="Computation budget; incomplete benchmarks exit 2 instead of exhausting memory/time")
    args = parser.parse_args()

    if not 1_000 <= args.max_cache_pairs <= 2_000_000 or not 1 <= args.max_seconds <= 600:
        parser.error("max-cache-pairs must be 1000..2000000 and max-seconds must be 1..600")
    if not 1 <= args.top_breeds <= 10 or not 1 <= args.targets_per_breed <= 256 or not 2 <= args.baseline_sample <= 1024:
        parser.error("top-breeds must be 1..10, targets-per-breed 1..256, and baseline-sample 2..1024")

    if not args.database.exists():
        raise SystemExit(f"Database not found: {args.database}")

    builder = load_builder()
    conn = sqlite3.connect(args.database)
    conn.row_factory = sqlite3.Row
    parent_rows = conn.execute("SELECT id,father_id,mother_id FROM horses WHERE deleted_at IS NULL").fetchall()
    parent_map = {int(row["id"]): (row["father_id"], row["mother_id"]) for row in parent_rows}
    cycle_nodes = builder.find_cycle_nodes(parent_map)
    eligible = set(parent_map) - builder.cycle_affected_descendants(parent_map, cycle_nodes)
    rank = builder._topological_rank(parent_map, eligible)
    latest_year = int(conn.execute(
        f"SELECT MAX(h.birth_year) FROM horses h WHERE h.deleted_at IS NULL AND {builder._valid_birth_predicate('h')}"
    ).fetchone()[0])
    start_year = latest_year - 14

    recent: dict[str, list[int]] = defaultdict(list)
    for row in conn.execute("SELECT id,breed_desc,birth_year,birth_date FROM horses WHERE deleted_at IS NULL"):
        horse_id = int(row["id"])
        breed = builder._meaningful_breed(row["breed_desc"])
        birth_year = row["birth_year"]
        sentinel = birth_year == 1901 and str(row["birth_date"] or "").strip() == "19010101"
        if horse_id in eligible and breed and birth_year is not None and start_year <= int(birth_year) <= latest_year and not sentinel:
            recent[breed].append(horse_id)

    cohorts = sorted(
        ((breed, sorted(ids)) for breed, ids in recent.items() if len(ids) >= 40),
        key=lambda item: -len(item[1]),
    )[: max(1, args.top_breeds)]
    sample_sizes = sorted({int(value) for value in args.samples.split(",") if int(value) > 1})
    if not sample_sizes or len(sample_sizes) > 10 or max(sample_sizes) > 1024:
        parser.error("Provide 1..10 sample sizes between 2 and 1024")
    deadline = time.monotonic()+args.max_seconds
    cache_misses = 0

    @lru_cache(maxsize=args.max_cache_pairs)
    def kinship(a: int | None, b: int | None) -> float:
        nonlocal cache_misses
        cache_misses += 1
        if cache_misses % 1024 == 0 and time.monotonic() > deadline:
            raise TimeoutError(f"Reference sampling incomplete: {args.max_seconds:g}s computation budget reached; cached pairs are bounded at {args.max_cache_pairs}. No completed accuracy result is claimed.")
        if a is None or b is None or a not in rank or b not in rank:
            return 0.0
        if rank[a] > rank[b]:
            a, b = b, a
        if a == b:
            father, mother = parent_map.get(a, (None, None))
            inbreeding = kinship(father, mother) if father in rank and mother in rank else 0.0
            return 0.5 * (1.0 + inbreeding)
        father, mother = parent_map.get(b, (None, None))
        if father not in rank and mother not in rank:
            return 0.0
        return 0.5 * ((kinship(a, father) if father in rank else 0.0) + (kinship(a, mother) if mother in rank else 0.0))

    aggregate_errors: dict[int, list[float]] = {size: [] for size in sample_sizes}
    aggregate_coverage: dict[int, list[int]] = {size: [0, 0] for size in sample_sizes}

    print(f"reference_window={start_year}-{latest_year},eligible={len(eligible)},baseline_sample={args.baseline_sample},targets_per_breed={args.targets_per_breed},max_cache_pairs={args.max_cache_pairs},max_seconds={args.max_seconds:g}")
    print("breed,cohort_n,sample_n,mae_pp,median_pp,p90_pp,p95_pp,max_pp,rmse_pp,spearman,approx95_interval_coverage")

    for breed, cohort in cohorts:
        seed = f"mean-kinship-v1:{breed}:{start_year}:{latest_year}"
        target_seed = f"reference-sampling-benchmark-targets-v1:{breed}:{start_year}:{latest_year}"
        targets = builder._stable_reference_sample(cohort, min(args.targets_per_breed, len(cohort)), target_seed)
        baseline_refs = builder._stable_reference_sample(cohort, min(args.baseline_sample, len(cohort)), seed)
        baseline_values: list[float] = []
        for horse_id in targets:
            values = [kinship(horse_id, reference_id) for reference_id in baseline_refs if reference_id != horse_id]
            baseline_values.append((sum(values) / len(values) * 100) if values else 0.0)

        for size in sample_sizes:
            refs = builder._stable_reference_sample(cohort, min(size, len(cohort)), seed)
            predictions: list[float] = []
            covered = 0
            for index, horse_id in enumerate(targets):
                pair_values = [kinship(horse_id, reference_id) for reference_id in refs if reference_id != horse_id]
                mean_value = sum(pair_values) / len(pair_values) if pair_values else 0.0
                prediction = mean_value * 100
                predictions.append(prediction)
                if len(pair_values) > 1:
                    variance = sum((value - mean_value) ** 2 for value in pair_values) / (len(pair_values) - 1)
                    standard_error = math.sqrt(variance / len(pair_values)) * 100
                    lower = max(0.0, prediction - 1.96 * standard_error)
                    upper = prediction + 1.96 * standard_error
                    covered += int(lower <= baseline_values[index] <= upper)

            errors = [abs(prediction - baseline) for prediction, baseline in zip(predictions, baseline_values)]
            stats = summary(errors)
            spearman = correlation(rankdata(predictions), rankdata(baseline_values))
            coverage = (covered / len(targets) * 100) if targets else 0.0
            aggregate_errors[size].extend(errors)
            aggregate_coverage[size][0] += covered
            aggregate_coverage[size][1] += len(targets)
            print(
                f"{breed},{len(cohort)},{size},{stats['mae']:.4f},{stats['median']:.4f},{stats['p90']:.4f},{stats['p95']:.4f},"
                f"{stats['max']:.4f},{stats['rmse']:.4f},{spearman:.5f},{coverage:.1f}"
            )

    print("\nOVERALL")
    for size in sample_sizes:
        stats = summary(aggregate_errors[size])
        covered, total = aggregate_coverage[size]
        coverage = (covered / total * 100) if total else 0.0
        print(
            f"sample={size}: MAE={stats['mae']:.4f}pp median={stats['median']:.4f}pp p90={stats['p90']:.4f}pp "
            f"p95={stats['p95']:.4f}pp max={stats['max']:.4f}pp RMSE={stats['rmse']:.4f}pp approx95_coverage={coverage:.1f}%"
        )
    print(f"cache={kinship.cache_info()}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except TimeoutError as exc:
        print(str(exc),file=sys.stderr)
        sys.exit(2)

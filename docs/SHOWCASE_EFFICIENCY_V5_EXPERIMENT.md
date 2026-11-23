# Showcase Efficiency v5 experiment

Status: **candidate experiment only**. The sealed patched v4 source remains untouched and authoritative as the current optimization candidate until independent review.

## Goal

Optimize the Horse Registry as a professional showcase for a small number of heavy users on free infrastructure, without coupling the new optimization to one database engine.

## Experiments rejected

Two initial ideas were benchmarked on the verified 78,089-horse canonical SQLite database and were **not** retained:

1. Pre-baking parent display names into the existing horse people summary produced negligible/inconsistent page-read improvement because indexed parent primary-key joins are already cheap.
2. A portable People trigram table greatly improved rare-name substring searches but made common-name searches materially slower and added about 20 MB. It was therefore rejected rather than shipped with mixed performance.

## Retained optimization: exact single-filter totals

v5 adds `registry_filter_counts`, a tiny revision-tagged derived table containing exact totals for common single-filter registry views:

- breed
- sex
- color
- main strain
- import origin
- lifecycle
- imported/sport/stallion/sport-card flags
- has sire / has dam

The API uses a precomputed total only when exactly one supported exact filter is active and analytics is revision-fresh. All substring, relationship, year-range, free-text, ID, parent-name and multi-filter cases keep the existing exact live `COUNT(*)` path.

If derived state is stale or the row is missing, runtime immediately falls back to exact canonical SQL.

## Real canonical benchmark

Canonical SQLite SHA-256:
`5c458ea268d24a0374ba511b91189b781247cc5d070b7a028b22bd5ac493fb92`

Dataset:
- horses: 78,089
- people: 26,646
- horse_people: 110,469

`registry_filter_counts`:
- 412 rows
- ~57 KB including its primary-key index
- resulting SQLite size: 278,786,048 bytes vs v4 benchmark copy 278,728,704 bytes (+57,344 bytes)

Warm local SQLite medians (exact count vs precomputed lookup):

| Filter | Exact count | Exact ms | Lookup ms | Local speedup |
|---|---:|---:|---:|---:|
| breed=Arabian | 30,499 | 1.5497 | 0.0029 | ~530x |
| sex=Filly | 46,154 | 2.3641 | 0.0028 | ~831x |
| color=Bay | 28,967 | 1.4485 | 0.0029 | ~503x |
| lifecycle=active | 73,089 | 3.6066 | 0.0029 | ~1,264x |
| isImported=1 | 8,738 | 0.2573 | 0.0028 | ~90x |
| hasSire=1 | 54,567 | 53.4573 | 0.0029 | ~18,659x |

These are local SQLite timings, not claims about Cloudflare network latency. The important D1/Turso benefit is that a fresh exact-filter total becomes a primary-key lookup instead of reading/counting thousands to tens of thousands of matching horse rows.

## Correctness verification

- all 412 precomputed rows rechecked against canonical exact SQL: **0 mismatches**
- when `analytics_stale=1`, visible precomputed count rows through the runtime freshness join: **0**
- Python/schema/semantic suite: green
- production TS/TSX syntax validator: green
- platform-contract validator: green
- operational inventory validator: green
- free-tier budget validator: green
- current-doc hygiene: green

Full dependency-backed Node gates should still be rerun in a healthy npm environment before any promotion decision; this sandbox could not complete `npm ci` because package-network access timed out.

## Portability

The v5 migration uses only ordinary relational structures: table, primary key, text/integer columns and checks. It introduces no new FTS5, SQLite pragma, collation, JSON, trigger or vendor extension.

The model therefore maps directly to SQLite/D1/Turso and PostgreSQL/Supabase. Provider-specific indexes may be added later as optional accelerators, but correctness does not depend on them.

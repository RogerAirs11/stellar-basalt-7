# Horse Registry v1.1.8 — Backend Efficiency Review / Candidate

Date: 2026-09-06
Baseline: sealed A1 final source SHA-256 `3f9a13111d59b2c86380ec92139f4e6efca40f76e29d7b31a11dcdf3c96a62e6`
Scope: behavior-preserving backend/read-efficiency improvements only.

## Executive finding

The interrupted senior review correctly identified two expensive paths: the registry facets fallback performs many aggregate scans, and registry browse recalculates an exact total on every page. The code review adds an important qualification: the facet scans are already a fallback. The standard Cloudflare deployment script builds the analytics snapshot before exporting D1 data, so a healthy deployment should normally serve facets from derived snapshot data rather than perform the multi-scan fallback.

The candidate therefore does not redesign facets or weaken exact filtering. It strengthens the intended snapshot lifecycle and fixes independent read amplification in registry browse/sorting.

## Changes

1. **Small hot-path runtime snapshot**
   - `tools/build_analytics_snapshot.py` writes `analytics_snapshots.key='registry-runtime'` alongside the existing heavyweight `registry-overview` payload.
   - It contains only `runtimeSummary` plus version/revision metadata.
   - Existing databases remain compatible: runtime reads prefer `registry-runtime` and can fall back to `registry-overview` where appropriate.
   - The normal deploy script refuses a production data upload if the hot runtime snapshot is absent.
   - Runtime consumers treat the snapshot as fresh only when the stale flag is clear and its source revision matches `registry_state.analytics_source_revision`.

2. **Unfiltered browse exact total from a fresh snapshot**
   - `/api/horses` still returns the exact canonical total.
   - For unfiltered browsing, a fresh revision-matched runtime snapshot supplies that exact total instead of scanning all active horses on every page.
   - If the snapshot is absent, stale, corrupt, or revision-mismatched, the route falls back to the canonical exact COUNT path.
   - Filtered browsing still computes an exact filtered count; no approximate totals were introduced.

3. **Remove irrelevant parent joins from COUNT**
   - The previous exact count always joined father and mother even when the WHERE clause did not reference them.
   - Count queries now join father only for a sire-name filter and mother only for a dam-name filter.

4. **Primary-key path for exact advanced ID filter**
   - Replaced `CAST(h.id AS TEXT)=?` with numeric `h.id=?` for valid numeric IDs.
   - Invalid IDs become `0=1`, preserving no-result semantics without scanning the table.

5. **Indexes for supported registry sorts**
   - Migration `0009_registry_read_efficiency.sql` adds partial active-row indexes for breed, sex and place sorting.
   - Existing semantics/order columns are unchanged.

## Reproducible local measurements

Dataset: 78,089 horses; v1.1.8 working copy of the canonical SQLite.
These are local SQLite wall-time/query-plan measurements. They are **not** D1 billing or Cloudflare latency claims.

| Operation | A1/baseline median | Candidate median | Plan change |
|---|---:|---:|---|
| Unfiltered exact count | ~143.8 ms | ~4.9 ms | removes 2 PK parent lookups per scanned horse |
| Breed sort, first 50 | ~48.4 ms | ~0.78 ms | temp B-tree -> partial sort index |
| Sex sort, first 50 | ~45.5 ms | ~0.75 ms | temp B-tree -> partial sort index |
| Place sort, first 50 | ~45.3 ms | ~0.77 ms | temp B-tree -> partial sort index |
| Runtime snapshot lookup | n/a | ~0.80 ms | PK lookup in registry_state + analytics_snapshots |

Runtime-summary payload: ~6.8 KB.
One-time local runtime-summary computation: ~2.1 s.
Three indexes add ~4.37 MB of SQLite logical pages on the test copy.

The JSON evidence includes the exact EXPLAIN QUERY PLAN output.

## Why the A1 1.79M-row facets number needs context

A1's Turso benchmark measured the live fallback facet SQL and correctly observed roughly 1.79M rows read for that operation. The application, however, already calls `loadRuntimeSnapshot()` before that fallback, and `scripts/deploy-cloudflare.ps1` already builds analytics before D1 shard export. Therefore the 1.79M-row path should be treated as an emergency/fresh-staging fallback, not an unavoidable steady-state facet cost.

The candidate makes that deployment assumption explicit and much cheaper by separating the tiny runtime summary from the heavyweight analytics payload.

## Deliberately deferred

No changes were made to:
- fuzzy-search thresholds/candidate limits;
- Persian/Arabic normalization;
- exact filtered-count semantics;
- arbitrary page-jump/offset behavior;
- public caching/invalidation policy;
- pedigree API contracts;
- D1/Turso/Supabase backend abstractions.

Those require measurement or compatibility design rather than speculative optimization.

## Next measured priorities

1. **Real D1 post-reset A/B measurement** of `/api/horses`, `/api/registry/facets`, `/api/health`, `/api/platform/meta`, and dashboard against a fresh runtime snapshot. Capture D1 `rows_read`, Worker CPU and p50/p95/p99.
2. **Filtered-count corpus**: breed, sex, place, year, owner/breeder, sire/dam, compound filters. Optimize only the expensive cases while preserving exact totals.
3. **Pedigree intelligence fan-out**: profile UI can request multiple endpoints that independently reload the same ancestor graph. Consider a backward-compatible bundled intelligence endpoint that loads the graph once and derives metrics/coefficient/insights.
4. **Supabase/Postgres experiment** if desired: import full schema/data, implement equivalent FTS/`pg_trgm`, measure final physical size including indexes, and compare latency/compute/egress. Do not infer Postgres size from SQLite size.
5. **Multi-backend portability**: support multiple deployment targets through domain/store seams; do not introduce active-active multi-master replication merely for free-tier failover.

## Verification performed in this environment

PASS:
- Python unit suite: 20/20.
- Python compilation for current database tools.
- operational inventory validator: 43 routes / 24 structures / 12 migrations, drift-free.
- Free-tier budget validator.
- production TS/TSX syntax validator: 133 files, 0 parse diagnostics; browser source 0 unresolved-name diagnostics.
- local SQLite integrity/FK checks on benchmark copies.

NOT CLAIMED:
- Full `npm ci` + TypeScript typecheck + Vitest + Vite production build. The package install in this execution environment did not complete and `node_modules` is only an incomplete directory skeleton. A1's sealed baseline had those gates green, but this candidate must rerun them in a healthy Node environment before promotion.
- Real D1/Cloudflare rows-read or CPU improvement. The local plans/timings strongly justify the candidate but real edge measurement is still required.

## Promotion rule

Keep A1 final authoritative until this candidate completes the full A1 Phase-A gate in a healthy environment and passes a real-D1 post-reset A/B run. If either reveals a regression, do not promote.


## Additional offline/read-model optimizations (candidate v3)

6. **Precomputed people role statistics and browse display names**
   - `person_registry_stats` moves repeated 26k-person / 110k-link aggregation out of request time. Migration 0012 preserves the previously different semantics explicitly: directory columns count all canonical links (including links to archived horses), while `profile_*` columns count only links to active/non-archived horses.
   - `horse_registry_people_summary` replaces up to eight correlated person lookups per registry row with one compact derived join while fresh; stale/revision-mismatched state falls back to the legacy exact person-name lookups.
   - Materialized person stats are consumed only when `registry_state.analytics_stale=0` and their source revision matches; stale state falls back to exact canonical aggregation.

7. **Bundled horse intelligence / graph reuse**
   - Profile intelligence paths reuse one loaded ancestor graph for overlapping metrics rather than independently reloading the same graph.
   - Existing API paths remain compatible; frontends can consume the bundled response with fallback.
   - Prism no longer requests both ancestor and descendant trees when only one mode is visible.

8. **Role-name trigram candidate index**
   - Migration `0011_role_name_trigram_prefilter.sql` adds rebuildable `horse_role_search_trigram` for owner/breeder/importer/passport-receiver substring filtering.
   - The original canonical relationship + `LIKE` predicate remains the final authority.
   - The prefilter is automatically bypassed whenever analytics-derived state is stale.
   - Real-data sample: 77/77 parity; median ~79.7 ms -> ~11.9 ms locally; stale fallback parity PASS.
   - The full hot-model rebuild (runtime counters + person stats + browse people summary + role trigram) was ~3.6 s locally on 78,089 horses.

9. **Reuse existing horse trigram index for advanced exact substring filters**
   - Name, registration number, place, sire and dam advanced filters now use the existing `horse_search_trigram` only to narrow candidate horse IDs.
   - The exact original field predicate remains final authority.
   - If any `horse_search_reindex_queue` job exists, the candidate prefilter is bypassed automatically.
   - 93/93 sampled real-data cases matched exactly, including queue-stale fallback. Local median timings: name 57.7 -> 13.3 ms; register 46.1 -> 10.8 ms; place 46.3 -> 21.0 ms; sire 98.6 -> 12.5 ms; dam 117.9 -> 12.4 ms.

10. **Fresh person-profile statistics with archived-horse semantic separation**
   - Individual person profiles reuse `person_registry_stats.profile_*` when revision-fresh and automatically fall back to the original exact active-horse-only counts when stale. The People directory continues to use the original all-link semantics.
   - Synthetic archived-horse fixtures cover no archives, one archive, mixed active+archived relationships, multiple roles, archive/restore, role-link changes and failed rebuilds.
   - The original canonical-data sample (which had zero archived horses) still provides 30/30 parity; local median count lookup remained ~0.98 ms -> ~0.02 ms.

### Optimization explicitly rejected

A separate `people_name_trigram` index was prototyped for the People directory. It improved no-hit/native-name scans (~15 ms -> ~0.2 ms) but made common Latin searches slower (~0.3 ms -> 2.5-4.5 ms) while adding ~4.5 MB and another derived structure. Because the existing materialized People path is already cheap for normal successful searches, this index was **not integrated**. This candidate prefers measurable net wins over adding indexes indiscriminately.

### v4 self-audit correctness additions

- Operational runtime snapshots are now consumed only while revision-fresh. `/api/health`, `/api/platform/meta`, `/api/registry/facets`, `/api/quality/summary`, and the admin dashboard use exact live fallback on stale/missing state instead of returning last-known materialized facts.
- Registry browse/export people display-name materialization is revision-gated; stale/mismatched summary rows fall back to the original exact current-person selection logic.
- Candidate-specific stale behavior has therefore been closed for the runtime snapshot, People stats, registry person-display summary, role trigram prefilter, and existing-horse-trigram advanced-filter prefilter. `registry_runtime_counters` remains the exception by design because supported create/archive writes maintain it transactionally.

### Remaining promotion work

The highest-value remaining work is validation rather than further speculative indexing: full Node/Vitest/build gates in a healthy dependency environment, then real D1 A/B measurement of rows-read and Worker CPU. Additional materialized combinations/caches should be considered only after that measurement identifies a remaining hot path.

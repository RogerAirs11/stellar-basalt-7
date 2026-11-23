# Horse Registry v1.1.8 — Backend Efficiency v4 Self-Audit

Date: 2026-09-07  
Status: **CANDIDATE ONLY — NOT PROMOTED**  
Authoritative rollback/reference source: sealed A1 `AGENT-A-FINAL-SOURCE.zip`  
A1 SHA-256: `3f9a13111d59b2c86380ec92139f4e6efca40f76e29d7b31a11dcdf3c96a62e6`

## 1. Archived-horse People statistics semantic resolution

The legacy API intentionally has two different semantics and v4 preserves both instead of standardizing them:

- **People directory `/api/people`**: role counts and distinct-horse count include every canonical `horse_people` link, even when the linked horse is archived.
- **Person profile `/api/people/:id`**: role counts, distinct-horse count, and listed horses include only horses where `deleted_at IS NULL`.

Migration `0012_people_stats_archived_semantics.sql` extends the disposable `person_registry_stats` read model with separate `profile_*` counters. The original counters retain directory semantics; the profile counters retain active-horse-only semantics. Both are rebuilt together from canonical tables and are admitted only when `registry_state.analytics_stale=0` and their `source_revision` matches `analytics_source_revision`.

Synthetic fixtures now prove:

1. no archived horses;
2. one archived horse;
3. mixed active + archived relationships;
4. multiple roles on the same person/horse set;
5. archive, rebuild, relationship mutation, rebuild, and restore transitions;
6. stale derived rows are rejected in favor of exact SQL;
7. a forced rebuild failure leaves the freshness gate closed.

## 2. Derived-data freshness self-audit

| Derived layer | Canonical authority | Fresh admission rule | Stale/missing behavior | Audit result |
| --- | --- | --- | --- | --- |
| `registry-runtime` snapshot | horses / people / links / quality | runtime source revision current and `analytics_stale=0` | exact live SQL for health/meta/facets/quality/dashboard | PASS after v4 fix |
| `person_registry_stats` directory counters | people + all `horse_people` links | revision match + `analytics_stale=0` | original exact directory aggregate | PASS |
| `person_registry_stats.profile_*` | people + links to non-archived horses | revision match + `analytics_stale=0` | original exact active-horse profile counts | PASS |
| `horse_registry_people_summary` | current `horse_people` + non-deleted people | revision match + `analytics_stale=0` | exact per-row canonical role/name lookup | PASS after v4 fix |
| `horse_role_search_trigram` | canonical role links + people names | only while analytics fresh | bypass candidate index; exact relationship + LIKE remains authority | PASS |
| horse trigram advanced-filter prefilter | canonical horse/search source | only while search reindex queue empty | bypass prefilter; exact field predicate remains authority | PASS |
| `horse_reference_intelligence` | canonical pedigree/reference data | existing registry-state freshness gate | hidden/refused while stale | PASS, unchanged |
| `registry_runtime_counters` | active horse count | transactionally maintained by supported horse create/archive writes | compatibility exact-count fallback if unavailable | PASS, intentional exception to rebuild-only model |

## 3. Mutation / rebuild boundaries

Current live canonical horse writes (`create`, `update`, `archive`) mark `registry_state.analytics_stale=1` in the canonical mutation batch. There is no current live Person/`horse_people` mutation endpoint; any future such endpoint must mark the same derived state stale in its canonical transaction. The synthetic role-link fixture exercises the required stale/fallback/rebuild semantics.

The production import/deploy path applies schema, rebuilds analytics/hot read models, verifies SQLite, exports derived tables, and deliberately exports `registry_state` last. A failed hot-model rebuild does not clear stale state; the synthetic forced-failure test verifies this rollback property.

## 4. Additional correctness fix found during self-audit

v3 allowed several lightweight operational endpoints to return last-known runtime snapshot facts after canonical edits. That conflicted with the stronger project rule that stale derived data must not be presented as current. v4 therefore consumes runtime summary data only while revision-fresh and uses exact live SQL when stale/missing for:

- `/api/health`
- `/api/platform/meta`
- `/api/registry/facets`
- `/api/quality/summary`
- admin dashboard counts

The registry person-display materialization is likewise revision-gated; stale/missing rows fall back to the exact canonical role/name lookup.

## 5. Local validation status

Completed in this environment after the v4 fixes:

- Python regression suite: **25/25 PASS**.
- Migration smoke: all **12 migrations** apply from empty; integrity/FK/FTS/trigram checks pass inside the suite.
- Operational inventory: **43 routes / 24 structures / 12 migrations PASS**.
- Production TS/TSX dependency-light syntax/semantic-name validator: PASS.
- Dependency-free Node policy/presentation/platform validators: PASS.
- Pedigree coefficient reference fixtures: PASS.
- `typecheck:frontend-kit`: PASS using the available global TypeScript compiler.
- `typecheck:pedigree`: PASS using the available global TypeScript compiler.

Environment-blocked, therefore **not counted as passed**:

- `npm ci`: blocked by DNS/network resolution failure to `registry.npmjs.org` (`EAI_AGAIN`).
- `typecheck:backend-core`: cannot resolve missing `@cloudflare/workers-types` and `node` type packages because the dependency tree cannot be installed.
- full `typecheck`: cannot resolve missing `@cloudflare/workers-types`, `node`, and `vite/client` type packages.
- Vitest: package unavailable (`vitest: not found`).
- Vite production build: package unavailable (`vite: not found`).
- real Cloudflare D1 A/B rows-read/CPU/latency measurement: not performed in this environment.

## 6. Promotion decision

**DO NOT PROMOTE.** v4 is a stronger candidate than v3 and resolves the known archived-horse semantic defect plus stale-snapshot correctness findings, but the sealed A1 source remains authoritative until all mandatory healthy-Node gates and the real D1 A/B measurement pass. No blocked gate is waived by this report.

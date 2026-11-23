# V5 D1 Serving Optimization Worklog — 2026-09-08

## Objective

Create a lean full-real-data Cloudflare D1 serving image from the immutable canonical registry without removing user-visible information or public functionality.

## Immutable inputs

- Materialized canonical input SHA-256: `020076cb15f98d2bf48d485113a605fe30c5bb6b88bb7bea0974df0f09c7d6ad`
- Input size: `314,634,240 bytes`
- Horses: `78,089`
- People: `26,646`
- Horse-person relationships: `110,469`
- Search source: `78,089`
- FTS: `78,089`
- Trigram: `78,089`
- Reference intelligence: `71,545`
- Filter counts: `412`

## Rules

- Canonical input is never modified.
- No user-visible registry fields may be removed.
- Search, fuzzy matching, profiles, people, pedigree, analytics, and reference intelligence must remain functional.
- Serving-only changes must be reproducible in source tooling.
- Changes are retained only after parity/integrity/performance checks.

## Completed work

- [x] Baseline size/table/index footprint measured.
- [x] Removed remote duplicate `raw_json` payload only from serving image.
- [x] Sparse people-summary rows implemented and verified.
- [x] Sparse role-search documents implemented and verified.
- [x] Runtime query-plan index audit completed.
- [x] Dropped only five proven-unused serving indexes.
- [x] Main FTS converted to external-content layout.
- [x] Main trigram converted to external-content layout.
- [x] Role trigram changed to `columnsize=0` membership-only layout.
- [x] Tested and rejected `columnsize=0` for ranked main search due 3–4× slowdown.
- [x] Search-refresh external-content deletion ordering corrected.
- [x] Reproducible builder added: `tools/build_d1_serving_db.py`.
- [x] Exporter updated for serving-layout D1 payload.
- [x] Regression tests added: `tests/python/test_d1_serving_db.py`.
- [x] Python suite: 31/31 PASS.
- [x] Final serving DB generated: `196,677,632 bytes`, SHA `8006638e...b544`.
- [x] Final D1 export generated: 151 shards / 567,572 statements / 269,137,098 bytes.
- [x] Exact final shard replay completed from scratch.
- [x] Full 151-shard second replay completed; idempotency/zero-drift parity PASS.
- [x] Exact core/derived table-hash parity PASS.
- [x] Integrity `ok`; FK violations `0`.
- [x] Search parity: 85 FTS + 86 trigram + 100 role-membership queries, 0 mismatches.
- [x] Dependency-free JS/source validators PASS through TypeScript stage.
- [ ] External lockfile Node/TS/Vitest/build gate — required because local npm registry DNS failed with `EAI_AGAIN`.
- [ ] Remote real-data D1 deployment.
- [ ] Worker switch from temporary demo D1 to full real-data D1.
- [ ] Final public black-box smoke on real registry.

## Exact source delta from the prior documentation-updated hardened source

Added:
- `docs/V5_D1_SERVING_OPTIMIZATION_REPORT_2026-09-08.md`
- `docs/V5_D1_SERVING_OPTIMIZATION_WORKLOG_2026-09-08.md`
- `tests/python/test_d1_serving_db.py`
- `tools/build_d1_serving_db.py`

Changed:
- `src/search/refresh.ts`
- `tools/export_sqlite_to_d1.py`
- `tools/import_xlsx.py`

No runtime UI/API route architecture was redesigned.

## Next deployment decision

AI2 retains all deployment decisions. External agents may only:
1. run the external Node gate where network/dependencies are available;
2. execute exact Cloudflare operations supplied by AI2;
3. independently black-box test the final public URL.

## Final Free-tier-safe exporter closure

The initially sealed serving-optimization candidate still contained the earlier 151-shard exporter. Before remote promotion, AI2 folded the final batching work into the actual source so code and deployment payload match.

Final exporter properties:

- manifest format: `4`
- shards: **94**
- SQL statements: **1,932**
- SQL payload bytes: **161,202,731**
- manifest SHA-256: `82638ee28eda709478a63130583022a45980bcbc73d5ccab7743dd1b3b02dedb`
- max shard bytes: <= 2,000,000 safety budget
- per-statement safety budget: <= 90,000 bytes
- no global FTS `rebuild` statement
- ordinary inserts are byte-bounded multi-row `INSERT OR REPLACE`
- horse parent links are byte-bounded batched `CASE` updates
- external-content main FTS + trigram are populated explicitly in resumable batches
- role trigram remains sparse and membership-only

Python regression suite after final exporter changes: **31/31 PASS**.

### Exact final replay

The exact 94-shard payload was applied to a brand-new migrated SQLite database.

PASS:

- horses: 78,089
- people: 26,646
- horse_people: 110,469
- data_quality_issues: 4,677
- horse_search_source: 78,089
- horse_reference_intelligence: 71,545
- person_registry_stats: 26,646
- horse_registry_people_summary: 57,775
- registry_filter_counts: 412
- all checked core/derived table hashes equal to the serving-source database
- `PRAGMA integrity_check`: `ok`
- foreign-key violations: `0`
- ranked FTS sample: 68 queries / 0 mismatches
- fuzzy trigram sample: 68 queries / 0 mismatches
- role-search membership: 76 queries / 0 mismatches

A complete second replay of all 94 shards over the completed database also passed:

- table drift: none
- integrity: `ok`
- FK violations: `0`
- ranked FTS mismatches: 0
- fuzzy trigram mismatches: 0

Evidence:

- `final_batched_replay_validation_first.json`
- `final_batched_replay_validation_second.json`

### Remaining external gate

The only remaining pre-remote source gate is the lockfile Node gate in an environment with working npm registry access:

`npm ci -> npm run check -> production build`

The local sandbox's npm DNS failure (`EAI_AGAIN`) is an environment limitation, not a source failure.

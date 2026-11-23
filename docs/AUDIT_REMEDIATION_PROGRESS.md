# v1.1.8 Audit Remediation Progress

**Started:** 2026-09-05  
**Baseline:** Horse Registry NextGen v0.42.16 / Core Consolidation v1.1.8  
**Baseline archive SHA-256:** `731555c06ad54e8e80d559eadaf532ff1dcc7bd8ade2cbe12a09f94b81f01eb7`  
**Scope:** backend + Heritage/Core frontend; other frontends compatibility-only.

## Status legend

- `DONE-LOCAL` — implemented and passed available local/source validators.
- `TEST-ADDED` — regression coverage added; full Vitest/workerd execution still required.
- `IN-PROGRESS` — implementation underway.
- `DEFER-CLOUDFLARE` — requires isolated Cloudflare staging/account telemetry.
- `DEFER-CLIENT-DATA` — requires the real client SQLite/XLSX.
- `OPEN` — not yet implemented.

## Completed / implemented locally

| ID | Status | Work | Verification so far |
|---|---|---|---|
| B02 / P1-001 | DONE-LOCAL + TEST-ADDED | Breeding optimizer query changed from nonexistent `archived_at` to canonical `deleted_at`. | Source syntax validator passes; real D1 regression remains to rerun once dependency/workerd environment is available. |
| B04 / P1-002 | DONE-LOCAL + TEST-ADDED | Central D1 substring-LIKE helper enforces 48 UTF-8 input bytes + 2 wildcard bytes; people/registry LIKE paths now use it and return structured 400s. | Source syntax validator passes; boundary Vitest cases added. |
| B13 / P1-003/004 | DONE-LOCAL + TEST-ADDED | Integer query parameters are strictly parsed; prototype-inherited sort keys no longer resolve through `in`. | Source syntax validator passes; unit tests added. |
| B01 / P1-005 | DONE-LOCAL | Registry bulk export now requires admin authentication; Core export controls are hidden from non-admin users. | Platform contract and Core semantic validators pass. |
| B03 / P1-008 | DONE-LOCAL | Added explicit EXPENSIVE rate-limit class/binding for breeding POST routes. | Platform/source validators pass; deployed limiter behavior requires Cloudflare staging. |
| B18 / P1-007/010 | DONE-LOCAL + TEST-ADDED | CSV formula-leading cells neutralized; JSON bodies are actually stream-read with route-level byte caps instead of trusting Content-Length. | Source validator passes; unit tests added. |
| B08 / P2-007 | DONE-LOCAL | Pedigree ancestry validation now fails closed when the 64-generation traversal ends with unexplored frontier. | Source syntax validator passes; executable deep-chain regression still required. |
| B11 / P3-022 | DONE-LOCAL | Auth reads no longer require a D1 session write every request; activity write is throttled to at most hourly and failure is non-authoritative. | Source syntax validator passes; D1 write-count probe must be rerun. |
| B05 / P3-009 | DONE-LOCAL (conservative first bound) | Search reindex per invocation reduced from 20/50-capable jobs to max 3. | Source validator passes; exact D1 call budget must be measured. |
| B17 / P1-011/012/013 | DONE-LOCAL | Wrangler default is production; expensive limiter added; deployment preflight rejects development/placeholder config; `public/_headers` adds static document security headers. | Source/platform validators pass; deployed headers/CSP browser compatibility require staging. |
| A01 / P1-014/015 | DONE-LOCAL safety block | Destructive remote replacement no longer relies on unsupported whole-D1 export for an FTS database; deployment refuses replacement until recovery procedure is satisfied. | Source inspection; actual restore rehearsal deferred. |
| F01 / P5-001 | DONE-LOCAL | Decade-derived year bounds are no longer overwritten by undefined advanced-search values. | Core semantic validator passes; browser/Vitest regression to execute later. |
| Phase 0 test gate | DONE-LOCAL | Added isolated `vitest.config.ts`; corrected stale advanced-search fixtures, platform stats fixture, and registry feature version expectation. | Source validator passes; full `npm test` pending dependency availability. |
| Phase 0 Python hygiene | DONE-LOCAL | Added Python cache cleanup to `check:python` to prevent self-generated `__pycache__` from poisoning later doc validation. | Cleanup tool executes locally. |

## Deferred external certification

| Task | Status | Reason |
|---|---|---|
| Full `npm ci` / TypeScript / Vitest / production bundle gate | OPEN-ENV | Retried. Partial `node_modules` is missing Cloudflare/Node/Vite type packages and `npm ci --offline` fails because locked tarballs (for example Zod 4.4.3) are not cached. Do not treat dependency-light syntax validation as a substitute for this gate. |
| Local workerd/D1 reproduced route probes | OPEN-ENV | Requires complete installed JS/Cloudflare dependency set. |
| Real Worker CPU P50/P95/P99 | DEFER-CLOUDFLARE | Requires deployed Free-plan staging telemetry. |
| D1 rows-read/rows-written production measurements | DEFER-CLOUDFLARE | Requires staging/real D1. |
| Final D1 byte size and client-data import budget | DEFER-CLIENT-DATA | Source archive contains no real client SQLite/XLSX. |
| Restore rehearsal on clean remote D1 | DEFER-CLOUDFLARE | Requires Cloudflare account and disposable staging DB. |
| Chromium/Firefox production CSP/header matrix | DEFER-CLOUDFLARE | Requires deployed static asset path/browser environment. |

## Next local implementation queue

1. Run the complete dependency-light validator/Python matrix after the latest workflow/search/runtime-summary patches and archive raw output.
2. Add/retain local SQL migration + workflow-journal evidence and positive-ID demo fixture evidence.
3. Measure/optimize remaining read hotspots only where local query-plan evidence is possible without the client dataset (correlated role projections and deep OFFSET/count paths remain measurement-gated).
4. Continue low-risk Core request deduplication/cache work only if it does not alter visual behavior or contracts.
5. Produce a changed-file manifest against a fresh extraction of the untouched baseline.
6. Package a clean remediated derivative and a deferred-certification checklist for Cloudflare/client-data/browser-only gates.

## 2026-09-05 implementation continuation

| ID | Status | Work | Verification so far |
|---|---|---|---|
| B06 / P3-006 | DONE-LOCAL + TEST-ADDED | Added a hard 1,024-node dense relationship-matrix allocation ceiling and 512-node per-side live relationship graph cap. Oversized live analyses return explicit `truncated`/null coefficients instead of risking quadratic allocation beyond the Worker memory envelope. | Source/platform/Core validators pass; trusted numeric fixtures/full Vitest execution remains pending dependency availability; deployed CPU ceiling still requires staging. |
| B14 / P4-002/003/004 | DONE-LOCAL | Full search rebuild and incremental refresh now preserve both Latin + native party names; horse aliases are included in `all_text`; `horse_aliases` is included in cloud shard export. | Python synthetic search fixture confirmed owner Latin + Persian/native text and alias in search source; source/platform validators pass. |
| B16 / P3-024/025/026/027 | DONE-LOCAL (import foundation) | D1 shards are now byte-bounded, per-statement guarded at a 90 KB safety ceiling, SHA-256 manifested, FTS shards are idempotent, aliases are exported, and shard replay verification checks hashes/bytes plus aliases/optional derived tables. Deployment script now maintains a matching-manifest upload ledger so quota/interruption can resume safely rather than restarting. | Synthetic migrated SQLite exported to 9 shards and replayed cleanly: all table counts matched, FK violations 0, integrity `ok`, parent mismatches 0. Actual Cloudflare resume/quota behavior remains staging-only. |

| ID | Status | Work | Verification so far |
|---|---|---|---|
| B09 / P2-014/015/016 | DONE-LOCAL + MIGRATION | Added `registry_state` generation/freshness state. Horse create/update/archive mark analytics stale in the same D1 batch as canonical mutation; analytics builder clears stale only after content-matching reuse/rebuild; registry analytics returns explicit `analytics_stale`; reference-population intelligence/DPI are hidden while stale. | New migration applied in synthetic DB; analytics snapshot rebuilt, state became current, export/replay preserved registry state last; source/platform/Core validators pass. |
| B05 / B19 / P3-003/004 + optimizer semantics | DONE-LOCAL (major query-shape reduction) | Pairing analysis now hydrates two ancestry graphs once and reuses them for coefficients, relationship paths and projected diversity. Optimizer hydrates fixed pedigree once, candidate pedigree once each; avoid-ancestor checks use the full bounded analyzed ancestry sets; configured COI ceiling now acts as a true exclusion; stale reference DPI is not consumed. | Source/platform/Core validators pass. Exact workerd D1-call reduction and CPU remain to measure once dependencies/staging are available. |

## 2026-09-06 continuation

| ID | Status | Work | Verification so far |
|---|---|---|---|
| B15 / P4-006/007 | DONE-LOCAL | Public search indexing/exact lookup no longer uses staff-only microchip/file/passport/lab identifiers. Public registry/UEL/life identifiers remain intentionally searchable through the public corpus. | Python importer fixture explicitly asserts private identifiers are absent and public identifiers remain indexed; production source syntax/platform validators pass. |
| A02 / P3-019/020/021 | DONE-LOCAL algorithmic hardening | Replaced full-matrix fuzzy Damerau/OSA distance with a banded three-row implementation and early cutoff, reducing per-comparison memory from O(n²) to O(n). | Direct TypeScript-strip smoke confirms insertion/deletion/transposition distances; unit regressions added; full Vitest remains dependency-gated. |
| B10 / P3-011/012/013 | DONE-LOCAL snapshot fast path | Analytics builder now publishes a compact revisioned `runtimeSummary`. Fresh platform meta/facets/quality/health use snapshot reads instead of repeated live aggregate scans; fallback remains available while stale/missing. | Python analytics tests pass with runtime-summary assertions; source validators pass. Real D1 rows-read savings require staging/client data. |
| B03/B13 / graph bounds | DONE-LOCAL | Strict integer validation now covers search, relationship, pedigree, descendant and insight work parameters; live relationship hydration capped at 512 nodes/side; descendant metric live cap reduced to 1,000; expensive limiter expanded across relationship/pedigree/insight APIs. | Source/platform validators pass. Cloudflare limiter/CPU behavior deferred. |
| B10 / registry free-text | DONE-LOCAL | Generic Registry `q/filter` hot path now uses existing FTS MATCH candidate filtering rather than repeated multi-column leading-wildcard scans. Exact search avoids unindexed COALESCE/private-ID OR expressions. | Unit regression added; source syntax passes. Real D1 query-plan/rows-read certification remains staging/client-data gated. |
| B14 structured semantics | DONE-LOCAL + TEST-ADDED | Fielded smart-search terms are enforced as constraints (AND across fields, OR within repeated values) before relevance scoring; importer/passport-receiver hydration preserves Latin + native text. | Unit regressions added; source syntax passes. Full Vitest pending dependency gate. |
| F07 | DONE-LOCAL | Demo seed moved from negative IDs to high reserved positive horse/person IDs so ordinary profile/pedigree route contracts can open demo search/browse records; demo public search also excludes private identifiers. | Synthetic SQLite seed: positive IDs, valid parent links, FTS search returns expected demo horses, FK check empty. |
| F03 / A05 | DONE-LOCAL partial de-risking | Core Browse lazily fetches facets only when Advanced Filters opens and hides structured registry export while smart/relevance search mode is active, avoiding a misleading export of a semantically different query. | Core/source validators pass. Full browser journey/request-count measurement deferred. |
| B12 | DONE-LOCAL semantic/race hardening | Claim/change reviews are conditional on open state; concurrent/duplicate decisions return 409. API explicitly reports approval as `review_only` / `canonicalApplied:false`; no canonical horse/ownership mutation is implied. | Source syntax passes; workflow contract documented in `docs/API.md`. Full concurrent workerd probe pending environment. |
| B07 workflows | DONE-LOCAL architecture + reconciliation | Durable mutation journal now covers claim/change-request create/review as well as horse mutations. Workflow intent and canonical workflow write are batched together; audit is reconcilable if later side effects fail; search is explicitly not applicable. | Source syntax passes; generic reconciler now handles committed/intended non-horse entities with known IDs. Failure-injection workerd certification remains deferred. |
| Auth hardening | DONE-LOCAL | Session lifetime aligned to 12-hour threat-model target; expired-session cleanup bounded; AUTH limiter 10/min and EXPENSIVE limiter 12/min. | Source/config validation; deployed behavior deferred. |
| B08 concurrency guard | DONE-LOCAL + TEST-ADDED | Horse parent updates now re-check proposed parent ancestry inside the actual conditional UPDATE using a recursive CTE, preventing stale pre-validation from allowing simultaneous opposite-edge edits to form a cycle. Failed optimistic/graph preconditions no longer mark analytics stale or enqueue reindex work because follow-up statements are conditioned on the committed mutation ID. | Migrated-SQLite workflow journal regression covers opposite-edge race; source syntax passes. Workerd concurrency certification remains external. |
| B19 eligibility semantics | DONE-LOCAL + TEST-ADDED | Optimizer now treats recorded sire/dam sex-role conflicts as explicit exclusions, preserves unknown/ambiguous historical sex with reduced confidence/warnings, returns structured exclusion reasons, and exposes eligibility warnings to Core. Optimizer algorithm version advanced to 1.1.0. | Source/platform/premium/Core validators pass; full Vitest and deployed CPU remain external. |
| A04 startup fan-out | DONE-LOCAL | `/api/platform/meta` now embeds the public health snapshot; Core normally starts with auth + meta and only falls back to standalone `/api/health` for older/failing backends. | Core/platform/source validators pass. |
| B10 stale operational snapshot | DONE-LOCAL | Meta/facets/quality/health use `runtimeSummary` only while revision-fresh. After a canonical edit they run their exact live fallback until rebuild; health may still expose `snapshotStale:true` to report the derived-state condition, but live fallback counts are current. Heavy scientific analytics continue to return `analytics_stale` until rebuilt. | Local source/platform/Core validation applies; real D1 rows-read/cache behavior remains staging-gated. |
| Dependency-backed release gate | OPEN-ENV | `npm run typecheck` cannot resolve missing `@cloudflare/workers-types`, Node and Vite types from partial installation; offline install cannot obtain all lockfile tarballs. | Raw log retained under `audit-remediation-evidence/dependency-backed/typecheck.log`. |

### Remaining items that are intentionally not claimed complete

- **B07 full certification:** execute the original failure-injection and concurrency probes against migrated workerd/D1. Local architecture now provides durable intent/reconciliation, but provider-runtime proof is still required.
- **B16 remote recovery/import certification:** execute resumable quota-window import and a clean remote D1 restore/rebuild rehearsal.
- **B10/A03 quantitative tuning:** use the real client dataset and D1 `rows_read`/query plans before adding speculative read-projection indexes/tables or changing pagination contracts.
- **Cloudflare Free CPU/query certification:** P50/P95/P99 CPU, D1 calls, rows read/written and database size require isolated Free staging.
- **Browser matrix:** Chromium/Firefox desktop/phone, EN/FA RTL, CSP/static headers, keyboard/reduced motion remain deployment/browser-environment gates.
- **Dependency-backed clean gate:** full TypeScript, Vitest and Vite production build remain mandatory once a complete lockfile install is available.

## 2026-09-06 final local compatibility/checkpoint pass

| ID | Status | Work | Verification |
|---|---|---|---|
| Shared export permission | DONE-LOCAL | Added semantic `registry.export` permission for admin/super-admin and changed Core/Q8/EquiData/Prism export visibility to consume permissions rather than role guessing. | Platform + frontend integration validators pass. |
| Descendant node-limit compatibility | DONE-LOCAL | Core and all three compatibility-only alternate frontend callers now honor the platform-advertised <=1,000 live descendant/descendant-metrics ceilings; mock/default insight path aligned. | Production source syntax + frontend/Core validators pass. |
| Full local regression matrix | DONE-LOCAL | Re-ran all dependency-light validators plus trusted pedigree references and Python suites after the latest patches. | 17/17 node validators PASS; pedigree references PASS; Python compile PASS; 11/11 Python tests PASS. Raw log: `audit-remediation-evidence/2026-09-06-final-local-matrix/final-local-matrix.log`. |
| Status/deferred handoff docs | DONE-LOCAL | Added `docs/REMEDIATION_STATUS_MATRIX.md` and `docs/DEFERRED_CERTIFICATION_CHECKLIST.md` to separate implemented work from environment/staging/client-data/browser certification. | Documentation generated from current remediation ledger and verified code state. |

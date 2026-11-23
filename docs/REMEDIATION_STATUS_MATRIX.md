# Audit Remediation Status Matrix

**Project:** Horse Registry NextGen v0.42.16 / Core Consolidation v1.1.8  
**Updated:** 2026-09-06  
**Baseline archive SHA-256:** `731555c06ad54e8e80d559eadaf532ff1dcc7bd8ade2cbe12a09f94b81f01eb7`

Status meanings:

- **DONE-LOCAL** — implementation completed and passed the available local source/SQLite/Python validation surface.
- **PARTIAL-LOCAL** — meaningful remediation completed, but a remaining sub-requirement depends on measurements or broader refactoring.
- **DEFER-ENV** — implementation/certification needs the complete locked npm/workerd toolchain, which is unavailable in this workspace.
- **DEFER-CLOUDFLARE** — requires isolated Cloudflare Free staging/account telemetry.
- **DEFER-CLIENT-DATA** — requires the real client SQLite/XLSX or a production-shaped derived D1 database.
- **DEFER-BROWSER** — requires the production browser/CSP/accessibility matrix.

## Astra backend findings B01–B19

| ID | Status | Current remediation / remaining proof |
|---|---|---|
| B01 Anonymous bulk export | DONE-LOCAL | Export API requires privileged authentication; shared `registry.export` permission is granted only to admin/super-admin roles; all frontend export controls consume that permission. Synchronous export size/CPU still belongs in staging budget certification. |
| B02 Optimizer nonexistent column | DONE-LOCAL | `archived_at` corrected to canonical `deleted_at`; source/unit coverage added. Workerd route replay remains DEFER-ENV. |
| B03 Expensive optimizer POST bypasses limiter | DONE-LOCAL + DEFER-CLOUDFLARE | Dedicated EXPENSIVE limiter class covers optimizer and other heavy analysis paths. Provider behavior/threshold evidence requires staging. |
| B04 D1 LIKE 50-byte failures | DONE-LOCAL | Central UTF-8 byte-aware LIKE pattern helper; long unsupported strict filters return structured 400 rather than D1 500. |
| B05 Query-count budget exceeded | PARTIAL-LOCAL + DEFER-CLOUDFLARE | Pair analysis/optimizer graph hydration deduplicated; synchronous reindex capped at 3 jobs. Exact D1 binding/statement counts and CPU remain staging gates. |
| B06 Dense coefficient matrix memory | DONE-LOCAL + DEFER-CLOUDFLARE | Pre-allocation combined-node/matrix ceiling added; live relationships capped; oversized analyses return explicit truncated/null coefficient semantics. Provider CPU/memory tail still staging-gated. |
| B07 Partial canonical commit / missing audit/search | DONE-LOCAL architecture + DEFER-ENV | Durable canonical mutation journal covers horse + workflow mutations; audit/search statuses are reconcilable and derived work is conditional on committed mutation IDs. Original failure-injection/workerd certification remains required. |
| B08 Pedigree integrity cutoff/races | DONE-LOCAL | Traversal fails closed at unexplored cutoff; commit-time recursive parent-cycle guard prevents stale opposite-edge edits; archive/update side effects are commit-conditioned. |
| B09 Analytics silently stale | DONE-LOCAL | `registry_state` canonical/analytics revision state added; heavy analytics reject stale data; lightweight operational endpoints consume derived snapshots only when revision-fresh and otherwise use exact live fallback. |
| B10 Counts/facets/search scans | PARTIAL-LOCAL + DEFER-CLIENT-DATA | Runtime summary fast path with exact stale fallback, FTS-backed free text, lightweight health, lazy facets implemented. Deep pagination/exact total count/correlated role projection still require real-data D1 query-plan and rows-read evidence before promotion. |
| B11 Authenticated reads write sessions | DONE-LOCAL | Session activity writes are throttled/best-effort instead of required per read; lifetime aligned to 12-hour threat-model target; cleanup bounded. |
| B12 Workflow not canonical apply | DONE-LOCAL | Claim/change approvals are explicitly review-only (`canonicalApplied:false`), single-winner conditional transitions, journaled/reconcilable. Automatic canonical apply remains intentionally unimplemented pending explicit product policy. |
| B13 Additional validation 500 paths | DONE-LOCAL | Strict bounded integer parsing and prototype-safe enum/sort lookup applied to public work parameters. |
| B14 Search consistency/discoverability | DONE-LOCAL + DEFER-CLIENT-DATA | Full/incremental bilingual party representation aligned; aliases included; fielded terms enforce constraint semantics; private/public identifier policy separated. Real-registry relevance benchmark remains client-data work. |
| B15 Private-field search association leak | DONE-LOCAL | Public search source/exact lookup excludes microchip/file/passport/lab identifiers while intentionally public registry/UEL/life identifiers remain searchable. |
| B16 Import/replacement process | PARTIAL-LOCAL + DEFER-CLOUDFLARE | Byte-bounded/hash-manifested shards, aliases, resumable upload ledger, idempotent FTS replay and local restore verification added. Actual quota-window resume and remote restore rehearsal remain staging tasks. |
| B17 Production config/static security headers | DONE-LOCAL + DEFER-BROWSER | Production preflight, production APP_ENV and static `_headers` added. Actual HTTPS/CSP/header/browser validation remains external. |
| B18 Body limits / CSV handling | DONE-LOCAL | Actual streamed-byte body enforcement with route caps; CSV formula-leading values neutralized. |
| B19 Optimizer semantics | DONE-LOCAL + DEFER-CLOUDFLARE | Full bounded avoid-ancestor membership, hard COI ceiling, explicit eligibility/exclusion reasons and sex-role confidence semantics implemented; scoring CPU remains staging-gated. |

## Astra Core findings F01–F08

| ID | Status | Current remediation / remaining proof |
|---|---|---|
| F01 Decade filter overwritten | DONE-LOCAL | Defined-only merge/precedence corrected; Core semantic validator passes. |
| F02 Horse/person stale response race | DONE-LOCAL + DEFER-BROWSER | Identity-keyed abortable requests and state reset added; browser delayed-response matrix still required. |
| F03 Search/export mismatch | PARTIAL-LOCAL | Smart/relevance mode no longer exposes structured export; structured export remains admin-only. Full canonical URL/query-state unification remains a future UX refactor. |
| F04 Main/CSS maintainability + bundle size | DEFER-ENV | Large refactor intentionally deferred until real TypeScript/Vitest/Vite/bundle gates are available. No risky visual rewrite performed. |
| F05 Core error containment/preferences | DONE-LOCAL + DEFER-BROWSER | Core error boundary, validated locale/storage fallbacks and Appearance Studio recovery behavior added. Browser blocked-storage matrix still required. |
| F06 Accessibility/localization matrix | PARTIAL-LOCAL + DEFER-BROWSER | Additional Persian strings, enum normalization, focus/Escape semantics and semantic checks added. Full keyboard/contrast/assistive/RTL browser matrix remains external. |
| F07 Demo cannot open normal routes | DONE-LOCAL | Demo fixtures moved to reserved positive IDs; parent/search/FK behavior verified on local SQLite. |
| F08 Optional intelligence eager loading | DONE-LOCAL | Heavy intelligence/coefficient/descendant metrics are demand-loaded by the relevant profile workspace; descendant-node requests now honor platform limits. |

## Appendix additions A01–A06

| ID | Status | Current remediation / remaining proof |
|---|---|---|
| A01 D1 FTS backup/export incompatibility | DONE-LOCAL safety design + DEFER-CLOUDFLARE | Destructive replacement no longer treats whole-D1 export as valid FTS backup; recovery runbook uses canonical rebuildable source + derived-index reconstruction. Remote restore rehearsal still required. |
| A02 Fuzzy-ranking CPU/allocation | DONE-LOCAL algorithmic + DEFER-CLOUDFLARE | Full matrix replaced by banded three-row O(n)-memory edit distance with cutoff. Actual Worker CPU benchmark remains staging work. |
| A03 Correlated registry role projection | DEFER-CLIENT-DATA | Intentionally not denormalized without real D1 query-plan/rows-read evidence. |
| A04 Startup API fan-out | DONE-LOCAL | Platform meta embeds health snapshot; Core normally starts with auth + meta, with standalone health only as compatibility fallback. |
| A05 Browse request amplification | PARTIAL-LOCAL + DEFER-BROWSER | Facets are lazy, smart export suppressed, heavy intelligence demand-loaded. Debounce/client cache/dedup tuning awaits real journey measurements. |
| A06 Remaining Core `any` typing | DEFER-ENV | Opportunistic cleanup only; broad typing refactor deferred until the full TypeScript gate is available. |

## Current local release evidence

- 17/17 repository dependency-light validators: **PASS**
- Pedigree trusted reference fixtures: **PASS**
- Python compile: **PASS**
- Python regression suite: **11/11 PASS**
- Production TS/TSX syntax scan: **130 files, 0 parse diagnostics, 0 unresolved browser-source names**
- Full locked dependency-backed TypeScript/Vitest/Vite build: **NOT CERTIFIED — environment lacks complete cached packages/network access**

The raw local matrix is stored under `audit-remediation-evidence/2026-09-06-final-local-matrix/final-local-matrix.log`.

# R147 validation and release boundaries

**Application 0.89.0 · contract 2.32.0 · 116 migrations · locally verified implementation candidate.**

The source freeze is identified by SHA-256 `6187c85827f77929aeaab45c10c69c7a12c1151af33362513253dc099c4cceca` over 1383 explicitly inventoried code/configuration files. `review-r147/evidence/frozen-code-manifest.json` identifies each file. Final packaging verifies those bytes again. This identifies the tested source; it is not a deployment approval.

## Results

| Verification | Observed result | Scope |
| --- | --- | --- |
| Pristine supplied R146 full Vitest | 1,989 passed; 0 failed; 10 skipped | Establishes the supplied source baseline |
| Final frozen R147 Vitest coverage | 2,161 passed; 0 assertion failures; 10 intentionally skipped; 2,171 total | Full run plus the unchanged five-test environment retry described below |
| Native regression files | 801 passed across 24 complete files | Individual TAP footers; no skipped/cancelled tests |
| Python regressions | 268 passed across 29 complete modules | Individual unittest completion summaries |
| TypeScript | Full project typecheck passed | Earlier frontend-kit, pedigree, backend-core and R108 checks also passed |
| Final affected source/UI gates | 13 checks passed before the preview build | Exact commands, exit codes and durations in `frozen-gates/results.json` |
| PostgreSQL | 116 migrations; 12 substantive checks passed | Three SQLite-only FTS declarations skipped by established mapping; actual Worker/production adapter, owned local cluster |
| Real browser | EN/FA and desktop/mobile; registration 5/5; curation 16/16 | Real synthetic local Worker/SQLite, persisted registration and staff create/update; no JavaScript errors in the recorded flows |
| Operator data-coverage supplement | 13 sections on empty and synthetic databases; query-only, no changes | SQLite only; no real database or PostgreSQL execution of this optional SQL audit |
| Source-preview build | Passed | Explicit illustrative asset fallback; source changes are inspectable |
| Normal production asset prerequisite | **Blocked: 16 required original image files absent** | Production build is not qualified |

The full frozen Vitest command returned exit 1 because the sandbox denied Node's child-process setup of a disposable Git repository for `releaseApprovalGate.test.ts`. That run recorded 2,156 passes, no assertion failures, and 15 skips (10 intended plus 5 blocked fixture cases). Moving the temporary directory into the workspace did not resolve the process restriction. The exact five tests then passed unchanged with approved local process permissions, using only a synthetic workspace Git repository. The aggregate above accounts for every test once; it does not rewrite the original full-run result as a successful command. Both original and retry receipts are retained.

Full Vitest JSON, complete native/Python summaries, the PostgreSQL receipt and browser receipts are in `review-r147/evidence/`. `verification-summary.json` is the machine-readable current summary. The same test may appear in a focused diagnostic and a full suite; these are not summed into an invented number of unique tests.

## What the final suite does not establish

Ten tests remain skipped: seven canonical-real-data AI broker cases in `ai-realdata.test.ts`, and three live-adapter cases in `supabaseSqlTranslation.test.ts`. The final JSON lists their exact names. The independent disposable PostgreSQL rehearsal establishes important real SQL/transaction behavior, but does not turn the skipped live-provider or unavailable real-data cases into passes. Run the approved real-data cases on an authorized snapshot and the provider checks against an isolated target using their existing documented gates.

The local runtime was Node v24.22.1 and Python 3.12.14; CI's supported Node runtime must be used for hosted qualification. Dependencies were not added or upgraded in this round; only the application package version changed. No production database, external account, live SMTP/SMS/payment provider or actual institutional data was exercised. The local PostgreSQL runtime was stopped and its generated credential receipt removed.

Browser evidence covers Chromium 153.0.8010.0, English/LTR and Persian/RTL, and widths 1440 and 390. The Professional matrix covers navigation/search/profile/registry and care permission gates. The dedicated registration proof establishes first-input retention and server reload. The dedicated curation proof establishes arrays, numeric values, typed dates and changed-only expected-version updates in both administration consoles. Additional close-ups check the shared editor's light/dark theme integration. This does not certify every enabled care workflow, Safari/Firefox, accessibility conformance, load or poor-network recovery.

## Missing original production assets

Restore these files under `public/` from the authorized original repository/artwork source; do not rename illustrative placeholders as originals. Then rerun `npm run validate:frontend-assets:source` and `npm run build` without `HORSE_REGISTRY_SOURCE_PREVIEW`.

- `public/assets/frontends/equidata-elite/dashboard-mockup.webp`
- `public/assets/frontends/equidata-elite/genome-closeup.webp`
- `public/assets/frontends/equidata-elite/hero-mane.webp`
- `public/assets/frontends/equidata-elite/hologram-horse.webp`
- `public/assets/frontends/equidata-elite/lineage-horse.webp`
- `public/assets/frontends/equidata-elite/market-horse.webp`
- `public/assets/frontends/equidata-elite/performance-horse.webp`
- `public/assets/frontends/fei-classic/donor-logo.webp`
- `public/assets/frontends/fei-classic/donor-ranking.webp`
- `public/assets/frontends/fei-classic/images/top-links.webp`
- `public/assets/frontends/fei-classic/images/top-nav-bg.webp`
- `public/assets/frontends/fei-classic/images/top-nav-closed-noarrow.webp`
- `public/assets/frontends/fei-classic/images/top-nav-closed.webp`
- `public/assets/frontends/fei-classic/images/top-nav-noarrow.webp`
- `public/assets/frontends/fei-classic/images/top-nav-sub-top.webp`
- `public/assets/frontends/fei-classic/images/top-nav.webp`

The source-preview build reports additional illustrative fallbacks (including fonts); those preview warnings are a different count from the 16 errors in the production source gate. Its chunk-size warnings also remain: measure production route loading and split heavy administrative/analysis bundles where actual budgets require it.

## Failures found and corrected during verification

Earlier runs intentionally remain intermediate evidence. They are not presented as final passes. The work corrected registration input loss, stale cache handling, privacy projections, concurrent write/evidence behavior, typed lifecycle chronology, admin field parity, nullable breeding links and shared-editor dark-theme contrast. Earlier native fixtures were updated where they asserted obsolete navigation or weaker disclosure behavior; runtime privacy protections were retained. Python's migration replay failure was resolved with replay-safe DDL for the new evidence/metadata tables.

One earlier complete Vitest run overlapped the final lifecycle source edit and had one failure; fresh focused checks and PostgreSQL passed, and the final frozen coverage above supersedes it. A later in-progress suite was deliberately interrupted when the final breeding-reader and UI corrections were found. The final run began after those corrections. The environment's combined native runner and one long Python output were truncated; complete individual-file/module runs provide the reported evidence instead.

## Release decision

`production_changed=false` and `release_approved=false`. Complete P0-01 through P0-05 in the main handoff, restore the missing assets, qualify the real dataset and intended hosted provider, perform an observed backup restore and obtain exact-revision release approval. New private care stays disabled by default. A clean local suite does not confer official registry/laboratory authority or finish all four client phases.

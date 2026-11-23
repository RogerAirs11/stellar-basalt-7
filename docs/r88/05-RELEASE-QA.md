# R88 release verification and limits

Date: 2026-10-03. This is verification of the supplied source plus the R88 patch, not a production certification. No live customer database, merchant account or SMS provider was accessed.

## Environment

Node v22.16.0; npm 10.9.2; Python 3.13.5; global TypeScript 5.8.3; Chromium 144.0.7559.96; Linux. Dependency-backed installation was unavailable in this environment. The original lockfile, assets, seed and prior documentation were intentionally excluded by the uploader's export, as documented in the unmodified PACKAGE-INFO.txt.

Chromium has a managed URL policy blocking hosted navigation, including localhost. The policy was not changed or bypassed. `tools/test-r88-browser.py` remains available for an unrestricted authorized runner; its attempted navigation failure is preserved in `audit/r88/logs/hosted-browser-blocked.log`.

## Actual passing checks

| Check | Command / evidence | Scope |
|---|---|---|
| 59 Python tests | `npm run test:python`; python-tests.log | Existing 49 plus 10 SQL authorization fixtures; real in-memory SQLite migration/query execution |
| 40 boundary checks | `node tools/test-r88-boundaries.mjs`; runtime-tests.log | Real source policies/runtime plus a small number of source-wiring assertions; not full API integration |
| 26 science/date checks | `node tools/test-r88-science.mjs`; runtime-tests.log | Exact assay interpretation, retest conflicts, calendar/season and defensive inputs |
| 15 economics checks | `node tools/test-r88-economics.mjs`; runtime-tests.log | Fee arithmetic, unit economics, invalid values/precision and break-even; not demand validation |
| 241 TS/TSX source files | `npm run validate:syntax`; source-syntax.log | Zero parse diagnostics and browser unresolved-name diagnostics; not full project TypeScript |
| Pedigree typecheck | `npm run typecheck:pedigree`; pedigree-typecheck.log | Selected dependency-independent pedigree package |
| Pedigree reference fixtures | `npm run verify:pedigree:reference`; verify-pedigree-coefficients.log | Existing numerical reference cases |
| Five-frontend separation | validate-frontends.log, validate-heritage-public-reads.log, validate-equidata-integration.log | Existing source/contract guards; no claim of five-skin visual certification |
| Design/CSS architecture | validate-design-systems.log, validate-css-architecture.log | Existing source architecture guards |
| 18 existing audit regression groups | test-audit-regressions.log | Source wiring checks, not hosted E2E |
| Density generation freshness | `npm run validate:r88:density`; density-freshness.log | Four independent token manifests match generated CSS |
| Demo generation and integrity | `npm run validate:r88:demo`; demo-integrity.log | Deterministic fixtures, references, synthetic flags, unique horse/event results, 196 source-engine pairs |
| Native Classic build | `node tools/build-classic-embedded.mjs --force`; classic-build.log | Rebuilt from supplied native source after inspecting the existing generated mount; no external assets restored |
| 142 offline Chromium DOM assertions | `npm run test:r88:dom`; offline-dom-tests.log + dom-results.json | New static pages only, actual app CSS/JS with injected fixture fetch and URL/history/storage test doubles |
| JavaScript parser checks | `node --check` on R88 tools and static page modules | Syntax only |

The 40 + 26 + 15 checks total **81** focused checks; do not relabel them as 81 full integration tests. The original export reports 434 Vitest cases, but they were not run here. The 142 DOM assertions do not imply 142 hosted browser tests.

## Offline DOM coverage

Registry search and empty results; synthetic provenance badges; saved-state serialization through a test double; linked horse/person/family views; 22 service categories and a distinct DC role; native dialog open/Escape; simulated inbox transitions; stored HTML escaping; full-sibling projected COI 25%; zero coefficient with incomplete-ancestry warning; pilot loss and growth arithmetic; invalid scenario inputs; EN/FA direction and no page overflow at 360/390/768/1280/1440 for six views; corrupt storage handling; no uncaught page errors.

The rendered screenshots in `audit/r88/screenshots/` use actual new page source and CSS in this offline harness. Desktop registry/business pages and the Persian mobile registry were visually inspected. Screenshot files are evidence of those new pages, not screenshots of all five original app skins. They do not validate server headers, actual network routing, persisted browser reload behavior, provider delivery, real authentication or billing.

## Failed or blocked checks - do not hide these

- Full `npm ci`, original production React/Vite/Worker build, full `npm run typecheck`, full Vitest and full `npm run check`: not completed because dependency installation and omitted original inputs were unavailable.
- Hosted browser E2E: blocked by managed URL navigation policy; see preserved failure log. Run the supplied hosted script in unrestricted CI before presenting the new pages as hosted-tested.
- Existing AI validator: fails on **three omitted upstream documents**: `docs/R31_AI_ASSISTANT_ARCHITECTURE.md`, `docs/R31_AI_OPERATIONS.md`, `docs/R31_AI_REALDATA_VALIDATION_2026-09-15.md`. No fake placeholder documents were added to silence the check.
- Existing platform-contract validation: requires the omitted original lockfile; not certified.
- Actual Supabase/Postgres, D1/Worker and Turso concurrency/rollback parity: not executed. SQLite fixtures and source transpilation do not establish production provider equivalence.
- Production payment, SMS/email delivery, service booking, live data feed, backup restore and clinical breeding validation: not performed or implemented by this patch.

## Reproduce the independent demo

From the project root, with Python 3 installed:

```sh
python -m http.server 4174 --bind 127.0.0.1 --directory public
```

Open `http://127.0.0.1:4174/demo-workbench/?lang=en` or `?lang=fa`, and `http://127.0.0.1:4174/business-model/?lang=en` or `?lang=fa`.

Do not double-click the HTML using file://: ES modules and JSON fetch require an HTTP server. No npm installation or original media is needed to serve the checked-in static demo. The static server does not implement `/api`; the original frontends need the restored full application. Native Classic assets are included, but their API-driven workflows are not made live by Python's static server.

Regenerate after source changes using `npm run generate:r88:demo` and `npm run generate:r88:density`; these use local or global TypeScript for source erasure. Verify with `npm run validate:r88:demo` and `npm run validate:r88:density`. Do not edit generated data/economics/normalize/token files directly.

For the full app, restore the exact original lockfile and licensed assets first, then `npm ci`, `npm run check`, `npm run build`. Inspect backend environment requirements and choose an actual launch provider; do not point a demonstration at a live production database. To rebuild Classic when its output already exists, inspect it before explicitly using `node tools/build-classic-embedded.mjs --force`.

## Migration and rollback notes

R88 adds no database migration and does not alter a live database. It changes application authorization, projection, calendar and interpretation behavior. Existing clients still receive compatible assay status enum values; additional provenance fields clarify that they are not clinical diagnoses. A new private inquiry-status route/client method and contract version 2.16.0 were added.

Historical stored genetic labels/seasons were not silently rewritten. Review them using the continuation plan. If a catalog needs to be disabled pending review, turn off interpretation display rather than reintroducing incorrect inheritance semantics. If a public projection regresses, disable the endpoint rather than expose private records.

The final archive includes all original source files, R88 additions, generated standalone demo, tests, documentation and audit evidence. It excludes .git, node_modules, caches, secrets and font binaries. Original assets/lockfile/docs absent from the input remain absent; this is a complete updated **source-export package**, not the original full private repository or a prebuilt deployable full app.

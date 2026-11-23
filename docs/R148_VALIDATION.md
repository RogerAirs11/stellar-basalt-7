# R148 validation and limits

## Accepted source and result

This is a locally implemented, tested integration candidate: application **0.90.0**, contract **2.33.0**, migrations **0001–0120**. The actual selected production database and deployed application were not changed. Institutional authority, live rollout, real record completeness and the complete four-phase proposal are not certified by these tests.

The input was the latest attached `01-horse-registry-code-r147-integrated.zip`, SHA256 `f3139e6430010a3c53831757f8fecee91a07baaec835f121cabf5e58c695c726`. The local baseline commit is `5f1e0ef162c091cfb5468456a49a57da80a2b43d`; it is not a claimed external repository commit. The final code/configuration/test fingerprint and complete file inventory are recorded in `EXPORT_MANIFEST.json`. Run `python3 tools/verify-r148-package.py` after extracting the delivered source.

## Accepted checks

| Check | Accepted result | Evidence under `review-r148/evidence/` |
|---|---|---|
| Final integrated Vitest, after the public frontend-kit repair | **2,274 passed, 0 failed, 10 skipped**; 2,284 cases across 215 files, of which 214 have executed cases and one is entirely skipped | `vitest-frozen.json`, `vitest-frozen.txt` |
| Original native test files, exact pinned Node | **801 named tests passed across 24 files**, no failures/skips | `native-pinned/summary.json` and each original TAP/stderr |
| Python suite | **268 passed**, no failures/skips, 205.310 seconds | `r148-python-pinned.json`, `.stdout`, `.stderr` |
| Policy, migrated SQLite/Worker subset | **119/119 passed** across six files; the new policy file contains 28 cases | `r148-policy-sqlite-final.json`, `r148-policy-accepted-counts.json` |
| Policy, actual Worker/production PostgreSQL adapter | **15/15 checks passed** | `r148-policy-postgres-final.json`, `.log` |
| MFA, actual Worker/authenticator/production PostgreSQL adapter | **8/8 checks passed**, including the read-only hosted schema preflight | `mfa-postgres-final.json`, `.txt` |
| Genetic authority and private media, actual PostgreSQL adapter | **10/10 checks passed** | `r148-genetic-postgres.json` |
| PostgreSQL migration processing | All **120 numbered migration files** processed in each final harness; three documented SQLite-specific FTS skips | The three final PostgreSQL reports |
| TypeScript | Full application, backend core, frontend kit, R108 core and pedigree checks passed | `typecheck-inventories-final.txt`, `frontend-post-boundary-checks.json`, `remaining-release-gates.json` |
| Required remaining source/release gates | **20/20 passed**, plus the recorded earlier required gates and nine affected checks after the frontend repair | `remaining-release-gates.json`, `.log` |
| Final production build | **Passed**, pinned Node 24.19.0, exit 0, 28.16 seconds; HTML minification and dist asset validator passed | `build-final-status.json`, `build-final.txt` |
| Post-boundary frontend subset | **93/93 tests passed across 12 files** | `frontend-post-boundary-checks.json` |
| Real-browser public smoke | **8/8 cases passed** across Core/Professional, FA/EN and desktop/mobile | `browser/public-smoke-report.json` |
| Real-browser authenticated follow-up | **6/6 checks passed**; preceding enrollment/activation evidence qualified below | `browser/auth-followup-report.json`, `browser/auth-smoke-report.json` |
| Operational inventories | **363 API route entries**, **170 migrated structures** (167 ordinary, three virtual), **120 migrations** | `typecheck-inventories-final.txt` |
| Horse-reference inventory | **67 entries** (three virtual, 64 migration-derived), 17 move/archive pairs; version `2026-10-28.3` | Final entry in `remaining-release-gates.log` |
| Supplied image preservation | **24/24 original image/SVG files byte-identical** | `supplied-image-preservation.json` |
| Dependency preservation | Resolved dependency graph unchanged; only root application version updated | `dependency-preservation.json` |
| Static local asset references | Ten relative asset references checked, zero missing | `static-asset-import-audit.json` |

These runs overlap. Do not add Vitest subsets, native suites and Python bridges into a single supposedly independent test total. A passed check establishes its stated behavior under its fixture and runtime conditions, not universal security or production readiness.

### Exactly which tests remain skipped

Seven cases in `tests/ai-realdata.test.ts` require an authorized canonical dataset selected by `AI_REALDATA_DB`. Three live adapter cases in `tests/unit/supabaseSqlTranslation.test.ts` require the explicitly configured `SUPABASE_DATABASE_URL`. Those credentials/data were not supplied for this turn. The final Vitest report retains their skip status. The separately executed disposable PostgreSQL harnesses do not turn these ten assertions into passes.

## Database concurrency and privacy evidence

The PostgreSQL harnesses use actual Worker routing, the production adapter and independent connections to a newly created random schema in an owned loopback PostgreSQL 18.6 instance. Records and accounts are fictional. Tests observe real lock waits rather than inferring concurrency from sequential requests or source text.

Policy checks cover an empty rule set becoming active during direct create/update, review, import and field-claim selection/reversal; changed parents, eligible evidence and source agreement; forced receipt failure; retry; simultaneous import replay; exclusion of private clinical evidence; and a document becoming clinical evidence while admission waits on a lock. The same guarded transaction preserves the graph advisory marker at position zero and checks current state in separate statements after locks are acquired.

MFA checks cover real TOTP enrollment/activation, encrypted state, bearer/CSRF rotation, concurrent same-step verification with exactly one winner, concurrent recovery-code consumption with one winner, replacement-only recovery, graph marker/result-index preservation and assurance revocation while a write waits on the factor row. The schema preflight confirmed all 26 required columns on the disposable fully migrated PostgreSQL schema without target mutation.

Genetic checks cover exact-horse read/review/publication scope, independent authorization of each pairing parent, simultaneous exact-operation intake and review replay, two reviewers racing one version, publication withdrawal, private-history projection, assay mapping portability, grant revocation during an observed row-lock wait and same-session private-media links. Generic issuer-owner/admin status does not authorize private genetic snapshot bytes.

Every final disposable schema was cleaned. The owned PostgreSQL instance was stopped; `r148-local-postgres-shutdown.json` records shutdown. Generated runtime credentials, database files and downloaded runtimes are excluded from the package.

## Browser validation

The public browser smoke passed **eight cases**: Core/Heritage and Professional, English and Persian, desktop width 1440 and mobile width 390. It used an isolated fictional demo database and local app, with no provider keys, real users or production data. The checks recorded correct LTR/RTL, no horizontal page overflow, no broken images, no page/console/HTTP errors and no unexpected external requests. Public screenshots are preserved with the browser evidence. The primary reviewer also inspected the Professional English desktop and Persian mobile screenshots.

The browser initially could not be installed from the Playwright CDN because it returned a small HTML service-unavailable page instead of the archive. The matching official Chrome-for-Testing origin supplied the requested Chromium 151.0.7922.34 archive, which passed ZIP CRC verification and launched successfully. The provenance receipt records its source and SHA256. This did not change project dependencies.

The final authenticated follow-up passed six checks: fictional login, fresh-session MFA step-up with bearer rotation, current professional grant listing, horse-scoped genetic capability/evidence controls, Persian mobile security status and sign-out clearing private controls. Real enrollment and TOTP activation also succeeded in the preceding run; that earlier harness stopped after activation because its conservative screenshot guard misclassified a checkbox value as a secret. The corrected follow-up and its report preserve that distinction. No entered password, authenticator provisioning value, OTP or recovery code appears in the exported screenshots. Do not infer complete frontend parity, all-browser support or client design approval from these limited cases. Original artwork/font/model fidelity still requires restoration. The standalone Classic iframe does not yet duplicate the new MFA/grant/genetic controls, while the backend enforces the current authority boundary for its requests.

## Failed initial attempts and corrections

Initial failures are retained as history rather than silently counted as passes:

- The uploaded source could not build because optional Heritage assets and the particle model were absent. Availability detection and deliberate neutral fallbacks now produce a valid build. Three Retro texture paths were corrected to the original supplied files. All supplied images remain unchanged.
- New staff controls initially violated the external-frontend import boundary. Portable implementations now live under `src/frontend-kit/`, are exported through its public entry, and have compatibility reexports for existing Core callers. The boundary validator remains enforced. The logo-default check now verifies the approved original IDs and actual bundled fallback availability.
- Older scripted unit fixtures did not represent the new MFA query. They now explicitly model optional mode for an unenrolled account; real migrated SQL suites prove enforcement. Legacy genetic tests were changed to supply actual scoped grants and assert denial for role alone. No production authorization bypass was introduced to satisfy fixtures.
- A wrong PostgreSQL parameter type in the genetic pairing receipt was fixed with explicit SQL casts, then retested using the actual adapter.
- New migration replay errors were corrected with the repository's supported idempotent CREATE TABLE/INDEX convention. Numbered ALTER migrations still require the normal ledger and must not be blindly applied twice.
- The first workspace-backed PostgreSQL cluster suffered catalog EOF errors during migration 0042 before completing application checks. It was stopped and replaced with an owned local temporary cluster. Only the final complete harness reports are accepted.
- Default isolated Node reporting in this environment emitted filename-only TAP summaries. A controlled assertion confirmed callbacks ran and failed correctly. The accepted native run uses the exact pinned Node and one external process per original file with `--test-isolation=none --test-reporter=tap`. Python uses its unchanged bridge with `NODE_OPTIONS=--test-isolation=none`. No test assertions or package scripts were weakened for reporting.

The final evidence export allowlist has per-file hashes and classifications. Private runtime state, raw databases, temporary caches and credentials are excluded. Pattern checks supplement content review; they are not a universal guarantee that arbitrary text can never contain sensitive information.

## Reproduce and qualify the integrated candidate

Use a new branch/worktree and the exact current repository. Check the supplied patch before applying, preserve newer unrelated changes and full original asset packages, and check migration-number availability before adopting 0117–0120. Use the project's pinned Node **24.19.0** and committed lockfile.

```sh
python3 tools/verify-r148-package.py
npm ci
npm run typecheck
npm run typecheck:backend-core
npm run typecheck:frontend-kit
npm run typecheck:pedigree
npm run typecheck:r108-core
npm run validate:platform
npm run validate:inventories
npm run validate:merge-inventory
npm run validate:frontends
npm run validate:frontend-assets:source
npm test
npm run test:python
npm run build
```

Run the remaining repository `npm run check` gates as part of the operator's normal release process. If the environment reproduces filename-only native TAP reporting, use the documented per-file external-process approach rather than weakening the Python bridge or counting file names as assertions. The project test commands should normally be used unchanged where reporting works correctly.

The three new PostgreSQL harnesses accept an explicitly selected owned disposable cluster-state receipt through `--cluster-state` and a report path through `--report`. Inspect their safety checks and use fictional data; do not point a destructive fixture harness at a real production schema. Never publish the private receipt. For actual hosted schema inspection, use the separate **read-only** `tools/r148-hosted-schema-preflight.sql` and compare the real migration ledger/checksums.

### Production remains unqualified

The public live probe still identified R147 (0.89.0 / 2.32.0), active/primary Supabase, stale analytics and HTTP 500 from registry metadata. It is not a proof that any particular migration is absent. No private live database was inspected and no production repair was performed.

Before broad use, complete the ordered handoff: exact-primary schema diagnosis and staging rehearsal, MFA key/enrollment/recovery operations, institutional and source approvals, live permission matrix, backup/restore, cache/withdrawal verification, representative load and client workflow/design acceptance. The existing release approval gate is retained. The remaining stale-browser-draft version contract, direct-create idempotency, configurable care policy and later proposal workflows remain explicit engineering work.

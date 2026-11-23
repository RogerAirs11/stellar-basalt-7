# P00 — Complete-repository baseline evidence (R88 plan)

Date: 2026-10-03. Agent: Super Z (the agent that owns the full private repository).
Purpose: the R88 package was produced against the R87 pure-source export, which
intentionally omitted the lockfile, licensed assets, seed data and prior
documentation. This document records the restored-baseline evidence the R88
plan requires — executed in the full repository environment.

## Environment

| Component | Version |
|---|---|
| Node | v24.21.0 |
| npm | 11.19.0 |
| Python | 3.12.14 |
| OS | Linux 5.10.134 (x86_64) |
| Dependency install | `npm install` from `package-lock.json` — 188 packages, 7s, clean |

## Lockfile integrity (P00 acceptance: installs identically twice)

- `sha256sum package-lock.json` after install: `fd86b561f2102ac4795a563bedfcd87a95b83be319686b15b338b6b30204ff6d`
- `npm install --package-lock-only` re-run → checksum **unchanged** (stable resolution).
- Version bump 0.44.0 → 0.45.0 (R88) was synced into the lockfile by npm itself
  (2 lines: root + workspace version) — not hand-edited, not regenerated.
- The R88 merge is the FIRST time the Master AI's changes have been installed
  against the real dependency tree.

## Full gates executed after the R88 merge (commit a0f9036)

All of these were **blocked checks** in the Master AI's environment
(`docs/r88/05-RELEASE-QA.md`); all pass here:

| Check | Command | Result |
|---|---|---|
| Full validator suite | `npm run check` | **PASS** — platform contract 0.45.0/2.16.0, AI validators (the three "omitted" R31 documents exist in the full repo), frontend/design/CSS/language/presentation parity, budgets, inventories, typecheck x4, pedigree fixtures |
| Full TypeScript | `tsc --noEmit` | **PASS** after 1 merge fix (see below) |
| Full Vitest | `npx vitest run` | **434 passed / 10 pre-skips / 0 fail** at merge time |
| Python suite | `npm run test:python` | **59/59** at merge time (R88 + 10 new SQL fixtures) |
| R88 focused suites | `npm run test:r88`, `validate:r88:demo`, `validate:r88:density` | all pass |
| Offline DOM harness | `npm run test:r88:dom` | **142/142** assertions pass |
| Production build | `npm run build` + dist asset validation | **green**; dist includes business-model, demo-workbench, classic-registry |
| Migration scratch chain | `node scripts/verify-migrations-scratch.mjs` | clean (37 migrations after P02) |
| SQLite→Postgres translation | `node scripts/check-migration-translation.mjs` | clean incl. 0037 |

## Merge fixes applied by the repository agent (not regressions)

1. Route inventory 106 → **107** (`POST /api/market/inquiries/:id/status` added
   to `docs/RUNTIME_ROUTE_BUDGET_INVENTORY.md` — machine-checked drift-free).
2. `package-lock.json` version sync to 0.45.0 (npm-generated).
3. One `tsc` error the Master AI's environment could not run:
   `src/api/modules/marketplace.ts` media mapping spread a non-object batch
   row type — fixed with an explicit `Record<string, unknown>` cast. R87
   typechecked clean, so this was an R88-introduced defect, now fixed.

## Hosted checks that remain open (honest limits)

- Hosted browser E2E (`tools/test-r88-browser.py`) still needs an unrestricted
  authorized runner; the offline DOM harness is not hosted E2E.
- The new static pages are deployed with the Worker; live URL verification of
  `/demo-workbench/` and `/business-model/` happens in this round's deploy
  smoke (see CHANGELOG).
- Postgres/Supabase execution-level parity suite (P01's test half) is future
  work; SQLite replay + translation checks do not certify it.

## Vulnerability review (recorded, not acted on)

- **Production dependencies: 0 vulnerabilities** (`npm audit --omit=dev`).
- Dev-tooling audit: 7 advisories (2 moderate, 5 high) — `sharp` (libheif),
  `miniflare`, `undici` via wrangler tooling. All are build-time tooling, not
  Worker runtime exposure (the Worker executes on Cloudflare's runtime).
  `npm audit fix` would move the lockfile; per plan rule 7 that is a separate
  reviewed change, NOT part of the baseline restore.

## Restored inputs (never lost in this repository)

`package-lock.json`, `public/` licensed assets, `src/web/assets/` art library,
`docs/` (75+ engineering docs incl. the three R31 AI documents), `seed/`,
`sandbox/`, Windows launchers, and the full git history. The R87 export's
PACKAGE-INFO exclusions were export-time only; the private repository remains
the source of truth, and GitHub is the durable copy.

# Core Consolidation v1.1.2 — Runtime Load Integrity Report

## Trigger

An installed Vite development run failed before the UI rendered with `ReferenceError: AMBIENT_PATTERNS is not defined` in `AppearanceStudio.tsx`.

## Root cause

The first consolidation extracted Appearance Studio out of H42 `main.tsx` but failed to carry two module-scope option lists with it. A wider TypeScript semantic-name scan then identified three additional unresolved names.

### Consolidation regressions fixed

- `AMBIENT_PATTERNS` — extracted component dependency missing.
- `AMBIENT_SCOPES` — extracted component dependency missing.
- `createPortal` — H42 import removed while HorsePage still used it for Docked profile navigation.
- `TabHierarchyMode` — H42 local type removed while HorsePage signature still referenced it.

### Pre-existing H42 defect fixed while auditing

- SearchPage used `year(h.birth_year)` in quick suggestions but destructured only `{t,n,locale}` from `useI18n()`. v1.1.2 now destructures `year` as well.

## Hardening

`tools/validate-source-syntax.mjs` now performs two layers:

1. parse validation for all production TS/TSX;
2. a semantic browser-source pass that rejects unresolved-name diagnostics TS2304 and TS2552 even when dependency packages are unavailable.

This directly prevents the class of refactor failure that caused the v1.1.1 blank application.

## Verification

- 17/17 repository validators PASS.
- Production TS/TSX: 127 files, zero parse diagnostics, zero unresolved browser-source names.
- frontend-kit TypeScript PASS.
- pedigree TypeScript PASS.
- pedigree coefficient fixtures 5/5 PASS.
- Python compile PASS.
- Python unit tests 7/7 PASS.

Full dependency-backed `npm run typecheck`, Vitest, Vite production build and Firefox/Chromium visual certification remain the installed-environment promotion gate.

# R31.12 — Registry printed studbook preview

Date: 2026-09-17

## Scope

This is an additive frontend-only Registry change. It does not alter canonical registry data, backend write semantics, database schemas, AI behavior, or deployment state.

## UX

The canonical Registry explorer now exposes a `Table / Studbook` surface toggle.

The Studbook surface:

- uses the same current Registry filters and sort order;
- requests 22 rows per page in normal registry mode;
- renders an A4 portrait, Persian-first printed page using the approved V8 visual direction;
- keeps Latin horse names as a secondary co-primary identity line when available;
- shows birth place, color, year, breed, sire, dam, breeder, life identity, registration number, HorseNo and sex;
- uses restrained print-safe male/female color encoding;
- opens the canonical horse profile when a printed record is clicked;
- supports browser `Print / Save PDF` without adding a PDF backend.

The existing table view remains the default and its density, columns, mobile-view and visual-encoding controls are unchanged.

## Files

- `src/web/heritage/StudbookPreview.tsx` — A4 printed-page rendering and print action.
- `src/web/styles/heritage.studbook.css` — V8-derived print/screen styling and scoped print rules.
- `src/web/main.tsx` — Registry surface toggle, 22-row studbook paging and integration.

## Validation executed

Passed in the clean source tree:

- `node tools/validate-source-syntax.mjs`
- `node tools/validate-css-architecture.mjs`
- `node tools/validate-frontends.mjs`
- `node tools/validate-mobile-ux-system.mjs`
- `node tools/validate-presentation-parity.mjs`
- `node tools/validate-production-frontend-assets.mjs --source`

A dependency-backed full TypeScript/Vite build was not claimed because this no-DB source package does not ship `node_modules`, and dependency restore did not complete in the current sandbox. The project-native syntax validator reports zero TS/TSX parse diagnostics and zero unresolved browser-source names.

## R31.12.1 viewport / print-surface correction — 2026-09-18

A narrow follow-up fixes two integration defects in the Studbook Registry surface:

- the A4 preview is now the dedicated scroll owner inside the Registry's intentionally viewport-locked workspace, so mouse-wheel, trackpad and touch scrolling work vertically and horizontally without clipping the printed page;
- Studbook mode is explicitly flattened for print fidelity: inherited glass, blur, shadow, motion, pseudo-surface and filter effects are disabled on the preview and in the actual browser print output.

The table Registry surface remains unchanged.

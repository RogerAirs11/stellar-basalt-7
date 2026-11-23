# Horse-DB-3 R31.1 — FEI Header / Top Bar Professional Refinement

Date: 2026-09-16

## Scope

Narrow Federation Classic visual/layout refinement on top of the complete R31 merged no-DB candidate.
No AI, backend, database, provider, registry-data, or routing behavior was redesigned.

## Problem addressed

The FEI desktop navigation still inherited historical donor layers that absolutely positioned the navigation inside a fixed-height header. Multiple later overrides made the visual result fragile and could make the header/navigation appear to cover page-title/action controls beneath it.

## Implementation

Added `src/web/frontends/fei-classic/fei-classic-header-pro.css` as the last FEI visual layer and imported it last from `entry.tsx`.

The new layer:

- keeps the legacy FEI purple/grey visual language;
- changes desktop and medium-width navigation to normal document flow;
- gives the header explicit bottom clearance and a bottom boundary/shadow;
- retains floating dropdowns only while a menu is open;
- refines utility-bar typography, spacing, locale control, FEI mark sizing, menu separators, hover states and dropdown elevation;
- protects the page-title/action strip with explicit flow/z-index separation;
- keeps the mobile top strip and mobile bar in normal flow as well;
- does not change the FEI navigation model or route mapping.

## Changed source paths

1. `src/web/frontends/fei-classic/entry.tsx`
2. `src/web/frontends/fei-classic/fei-classic-header-pro.css` (new)

## Validation executed

Passed:

- `node tools/validate-frontends.mjs`
- `node tools/validate-production-frontend-assets.mjs --source`
- `node tools/validate-css-architecture.mjs`
- `node tools/validate-source-syntax.mjs`
- `node tools/validate-mobile-ux-system.mjs`
- `node tools/validate-presentation-parity.mjs`

AI preservation check:

- `src/ai`: 22 files compared with the incoming complete R31 merged source, 0 changed.
- `src/frontend-kit/ai`: 3 files compared, 0 changed.

A headless Chromium binary exists in the environment, but it did not successfully produce a screenshot in this sandbox. Therefore this report does not claim browser-rendered visual certification. The overlap defect was addressed structurally by removing absolute desktop navigation from the closed-header layout and keeping the content shell after a real-height header.

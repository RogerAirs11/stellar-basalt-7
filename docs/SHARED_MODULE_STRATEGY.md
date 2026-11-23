# Horse DB — Shared Module Strategy

> **Share stable semantics; keep experience engines independent.**

## Reuse layers

1. **Canonical backend/domain capability** — search, pedigree science, relationships, analytics, permissions, claims, exports.
2. **Headless frontend behavior/geometry** — stable renderer-independent client algorithms.
3. **Low-level accessibility/semantic helpers** — only when truly generic.
4. **Experience-family visuals** — optional and only for frontends intentionally related by design.

Do not build a universal mega-component library just to eliminate duplicate JSX/CSS across independent experiences.

## Current headless example

`src/frontend-kit/pedigreeLayout.ts` centralizes graph layout/radial sector geometry. Heritage, Q8, EquiData and Prism remain free to render pedigree in their own visual languages.

## Extraction rule

Duplicate while the interaction is still being discovered. Extract only after semantics and failure cases are stable. The test for sharing is behavioral sameness, not superficial visual similarity.

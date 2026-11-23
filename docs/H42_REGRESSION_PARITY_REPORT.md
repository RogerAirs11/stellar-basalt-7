# H42 → Core Consolidation v1.1.2 Regression Parity Report

> **v1.1.2 correction:** A subsequent real Vite browser run exposed unresolved identifiers that the earlier parse/parity methodology did not detect. Consolidation had dropped the module-scope Ambient pattern/scope lists and the `createPortal` import; it also lost the tab-hierarchy type alias. In addition, the stronger semantic scan found a pre-existing H42 SearchPage `year` formatter omission. All are fixed in v1.1.2, and browser source now has zero TS2304/TS2552 unresolved-name diagnostics. The layout/geometry/data-contract parity findings below remain valid.

**Application:** 0.42.16  
**Platform contract:** 2.11.1  
**Audit date:** 2026-09-04  
**Scope:** Heritage/Core consolidation versus the exact pre-consolidation H42 release

## Baseline provenance

The comparison baseline was downloaded directly from the project's Google Drive archive:

`horse-registry-nextgen-v0.42.16-hotfix42-adaptive-frost-deep-shade-full-package.zip`

Drive file size: **22,532,151 bytes**. The comparison was performed against the extracted source package, not against a handoff summary.

## Structural parity

Before the v1.1.2 regression fix, the H42 and consolidation trees contained:

- **424 files byte-for-byte identical**;
- **30 changed files**, concentrated in Core/Heritage runtime/CSS and validation/tooling;
- **67 added files**, primarily consolidation modules/current documentation/history organization;
- **38 H42 root/history artifacts moved out of active authority** rather than deleted from project history.

There are no removed runtime code/config files required by H42.

The following H42 areas are byte-identical in the consolidation:

- `src/api`
- `src/auth`
- `src/search`
- `src/security`
- `src/registry`
- `src/types`
- `src/frontend-kit`
- `migrations`
- `seed`
- all **95** files under `src/web/frontends` (Q8/Aspnamā, EquiData Elite, Prism Ultra)
- `package-lock.json`
- `tsconfig.json`
- `vite.config.ts`
- `wrangler.jsonc`

## Core feature/source parity

After removing only the newly added explicit semantic `data-h-surface-role` annotations, the corresponding Core implementations remain source-identical to H42 for:

- Search
- Registry/Browse
- Horse Profile
- canonical record workspace
- relationship comparison
- Radial pedigree
- Map/Lineage pedigree
- Admin dashboard/canonical ledger
- Registry Desk
- Statistics
- capability panels

The Header is likewise unchanged apart from replacing the old inline ThemeControls implementation with the extracted `AppearanceStudio` component.

Static source inventory comparison found identical route/data/translation call coverage:

- `horseDbRoutes` call occurrences: **122 H42 / 122 consolidation**; same six route methods
- translation key occurrences: **547 / 547**; **430 / 430 unique**
- platform method-chain occurrences: **196 / 196**; **40 / 40 unique**

## Appearance/theme parity

The H42 Appearance Studio tuning surface is preserved:

- same Material Depth controls and limits;
- same Foundation/Ambient/Shine/Color/Navigation control families;
- same default Material blur values **24 / 14 / 8 / 4**;
- same default tuning values after v20→v22 migration;
- same CSS import order as H42.

`heritage.material.css`, `heritage.appearance-studio.css`, and `heritage.analytics.css` remain byte-identical to H42.

Chromatic Ambient palette derivation moved from Lighting authority to Color authority, but the moved declarations are identical. Graphite and dead historical/GAS branches were intentionally retired.

## Layout/geometry parity

A parsed CSS comparison normalized only:

1. the intentional Heritage document-root scoping wrapper, and
2. H42's frozen `data-tint-motion="still"` compatibility name to the renamed `data-h-legacy-motion="still"` bridge.

It then excluded visual-effect pseudo layers and H42's unreachable `data-tint-motion="animated"` branches.

Result:

- **2,799 / 2,799 H42-reachable non-effect layout rule signatures match exactly**.
- **614 / 614 pedigree/lineage non-effect layout signatures match exactly**.

This covers display/position/grid/flex/size/padding/margin/overflow/overscroll/transform/radius/font sizing and responsive geometry. In particular, the H42/v0.42.15 pedigree layout contract is unchanged: Map/Lineage/Radial geometry and exclusivity, fitted Radial non-scroll behavior, and zoomed-in scroll behavior remain intact.

The only removed navigation-layout branch was H42's `data-tint-motion="animated"` branch. H42 always pinned that legacy state to `still`, so that branch was not reachable in the baseline runtime.

## CSS/runtime integrity checks

- No CSS custom-property definition present in H42 was removed while still being consumed by active consolidation CSS.
- Every literal named animation used by active Core CSS still has a matching `@keyframes` definition.
- All active H42 frozen legacy-motion rules have equivalent v1.1.2 rules under the renamed compatibility channel, except an inactive `.heritage-ambient-stage` rule whose class is not emitted by current TS/TSX.
- Generic `.primary`, `.ghost`, `.danger`, and `.panel` rules are now Heritage-scoped. The independent frontend source is unchanged and owns its own button/panel styling; this removes Core bleed rather than changing those engines intentionally.

## Regression found and corrected

The direct H42 comparison found one real functional regression in v1.1:

- H42 mapped Appearance Studio Shine `Movement cycle` (`shineSeconds`) to `--h-user-shine-motion-speed`.
- The v1 compiler retained/persisted `shineSeconds` and the UI control, but omitted that CSS token.
- `heritage.lighting.css` therefore fell back to the default `18s`, so changing the slider did not change local specular speed.

v1.1.2 restores:

`shineSeconds` → `--h-user-shine-motion-speed`

and both Core UI and CSS architecture validators now require that mapping. The compiler therefore returns to **81 active theme outputs with zero unused outputs**.

The default H42 visual state was not affected by this defect because H42's default Shine cycle is also 18 seconds; only non-default user tuning was broken.

## Intentional visual-system changes

The consolidation is not a byte-for-byte visual-effects implementation clone. The following changes are intentional architecture/performance work approved by the consolidation plan:

- local Ambient composition uses ordinary alpha instead of per-surface `mix-blend-mode: screen`;
- local continuous effect compositors are limited primarily to Major/Panel surfaces;
- Cards/Controls inherit atmosphere through recursive glass instead of running independent continuous Ambient;
- weighted/hysteretic effects budgeting and offscreen suspension replace crude raw-surface counting;
- dead historical Ambient/GAS/Graphite/tint-motion branches are retired;
- Chromatic Ambient palette authority moved from Lighting to Color without changing its values.

These are intentional consolidation differences, not accidental layout/feature regressions. Their final visual acceptability still requires live browser comparison against H42.

## Remaining certification boundary

This source-level parity audit is substantially stronger than the earlier package-only validation, but it cannot replace an installed browser run. This environment still cannot retrieve the project's npm dependency tree, so the remaining promotion gate is:

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run check
```

followed by Firefox + Chromium visual QA across Light/Dark, all four palettes, EN/FA/RTL, desktop/phone, Browse, Profile, Pedigree Map/Lineage/Radial, Statistics, Appearance Studio, Frosted/Solid, and Ambient modes.

## Conclusion

No source/layout/data/feature regression was found beyond the disconnected Shine movement-cycle mapping described above. That defect is corrected and regression-locked in v1.1.2. H42 remains the visual certification reference until the dependency-backed browser matrix passes.

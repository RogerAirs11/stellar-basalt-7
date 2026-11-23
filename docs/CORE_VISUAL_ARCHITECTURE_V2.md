# Core Visual Architecture v2 — H40 Material Depth + Efficient Lighting

**Applies only to Heritage/Core (`data-frontend="heritage"`).** Q8/Aspnamā, EquiData Elite and Prism Ultra remain independent.

## Composition contract

Back → front:

1. Canvas / Scene
2. Material
3. Ambient Lighting
4. Specular Lighting
5. Content / Interaction
6. Chrome / Popovers / Modals

Material and Lighting are independent. Ambient/Specular may visually illuminate a material surface but may never own its background, transparency or backdrop-filter.

## Semantic Material Depth

Core does **not** infer appearance from raw DOM nesting or z-index. One runtime registry (`src/web/heritageSurfaceRegistry.ts`) assigns every semantic material surface exactly one optical role:

- **Depth 1 · Major** — outer workspaces/windows and Appearance Studio
- **Depth 2 · Panel** — nested sections/groups
- **Depth 3 · Card** — repeated information/analysis cards
- **Depth 4 · Control** — tabs, toolbars, segmented/compact controls

Both Material and Lighting consume this same registry. Do not create a second hand-maintained surface list in Lighting.

Each depth owns four independent user controls:

- Transparency
- Material brightness
- Material saturation
- Backdrop blur

Brightness and saturation grade only the material color token. They do not apply `filter` to content and do not enter the backdrop-filter chain.

### Recursive frost

Frosted Glass remains recursive: every semantic depth samples what is immediately behind it, even if that backdrop is already frosted. H40 changes only the **radius policy** for performance. Defaults are:

- Major: 30px
- Panel: 20px
- Card: 14px
- Control: 8px

All remain nonzero and independently adjustable. Solid makes every semantic role `backdrop-filter:none` without changing Lighting.

## Material authority

`heritage.material.css` is the terminal owner of:

- background/material fill
- transparency
- per-depth material tone grading
- `backdrop-filter` / `-webkit-backdrop-filter`
- Frosted/Solid behavior
- Major halo

Material must not read Ambient state/tuning and must not contain animation keyframes.

## Efficient Lighting authority

`heritage.lighting.css` is post-material only.

H40 uses **one local effects DOM node per illuminated semantic surface**:

- `::before` — one coherent Ambient field containing all three gradients plus optional dither
- `::after` — local Specular sweep on Major/Panel only

This replaces the older per-surface structure that created multiple wrapper/orb/dither/shine elements and several compositor-promoted moving layers per surface.

### Ambient states

- Animated — visible + moving
- Still — same field, frozen
- Off — Ambient removed only

Organic Drift remains tonal. Chromatic Depth uses exactly three scheme-derived split-complementary colors.

### Dithering

Dithering defaults **Off**. When enabled, ordered dither is composed **inside the moving Ambient field itself**. Therefore it:

- moves with Animated Ambient
- freezes with Still
- disappears with Off
- never becomes a static global texture over the interface

### Blend modes

The user-facing Ambient/Shine blend selectors are retired in H40. Their real-world compositor behavior was not sufficiently reliable to justify the added complexity. Both systems use the calibrated `screen` composition. Reintroducing experimental blend selection must not compromise Material/Lighting isolation.

### Visibility-aware performance

`HeritageSurfaceLightingBinder` uses `IntersectionObserver` with a near-viewport margin. Offscreen local effects are paused and release `will-change`. Still mode likewise drops the Ambient compositor hint.

The binder processes only newly added DOM branches through MutationObserver; it must not rescan the entire document after every child mutation.

## Appearance Studio

Appearance Studio remains body-portaled but is assigned **Major** through the same semantic registry. H40 groups Material controls by the four Material Depth roles instead of exposing transparency separately from the other properties of the same depth.

## State / presets

Theme preset schema is **v18**.

Legacy single `blur` presets migrate to tiered defaults by preserving the old value as Major blur and deriving progressively smaller Panel/Card/Control radii. Existing transparency/color/ambient settings remain migrated and clamped.

## Validation invariants

`tools/validate-css-architecture.mjs` must fail if:

- Material reads Ambient state/tuning
- Lighting declares material fill/transparency/backdrop-filter
- Material and Lighting stop consuming one semantic surface registry
- old multi-orb/static-dither local renderer returns
- user-facing blend-mode state returns without a deliberate architecture revision
- dither becomes a separate static plane
- offscreen effect suspension disappears
- Material Depth controls or tier-specific blur tokens disappear
- deprecated ambient CSS modules return to the import stack

## Do-not-break rules

1. Core remains isolated from the other frontends.
2. Every semantic glass role keeps real recursive blur in Frosted mode.
3. Role-specific blur may vary; role membership never disables frost.
4. Ambient can be deleted and Material must render identically.
5. Material can switch Frosted/Solid and Lighting must remain independent.
6. Still differs from Animated only by time/motion.
7. Shine does not depend on Ambient.
8. Dither belongs to the moving Ambient field only.
9. Semantic Material Depth is Major/Panel/Card/Control—not raw DOM nesting or z-index.
10. New visual behavior must extend its owning v2 subsystem, not add another late override stack.

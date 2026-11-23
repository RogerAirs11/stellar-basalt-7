# Core Consolidation v1.1.3 — Appearance Studio Accordion

## Goal

Reduce settings-sidebar navigation and scrolling overhead without removing or rearranging the underlying appearance controls.

## Behavior

- The six top-level sections start collapsed.
- One `activeStudioSection: string | null` state is the only expansion authority.
- Opening a section automatically collapses any previously open section.
- Clicking the currently open section collapses it.
- Closing Appearance Studio clears the active section, so reopening starts compact.
- Existing top shortcut buttons remain available and open/toggle the requested section.
- Section headers are native buttons with `aria-expanded`.
- Collapsed sections hide only their body controls; their numbered title row remains visible.

## Preserved behavior

No appearance control, theme preset field, material role, Ambient/Shine setting, navigation mode, persistence behavior, or independent frontend engine was removed or changed by this UI-navigation patch.

## Validation

`validate-core-ui-42.mjs` now requires the all-collapsed initial state, single-section toggle function, expansion state for all six sections, accessible `aria-expanded` state, collapsed-body CSS, expanded affordance CSS, and absence of the previous IntersectionObserver scroll-tracking implementation.

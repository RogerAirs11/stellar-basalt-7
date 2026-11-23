# Core Consolidation v1.1.4 — Persistent Chrome Stacking Report

**Application:** 0.42.16  
**Platform contract:** 2.11.1  
**Scope:** Heritage/Core only

## Problem

H42 deliberately set every direct `.app-shell` child to `z-index:1` to keep the Ambient canvas below UI flex items. Because the rule is later and more specific than the original header rule, it also flattened `.topbar` from its intended stacking level into the same stacking layer as page content. Separately, Docked navigation is rendered through a body portal at a historical `z-index:10050`, while later viewport portals use near-maximum stacking values.

## v1.1.4 correction

`src/web/styles/heritage.chrome.css` is imported last and owns persistent navigation Chrome only.

- `.app-shell>.topbar` receives explicit persistent Chrome stacking and remains sticky at the viewport top.
- `.app-shell>.frontend-switcher` is protected from the broad direct-child flattening rule.
- body-level `.heritage-app-dock` receives a near-maximum persistent Dock layer.
- Appearance Studio starts below the current topbar height.
- in Docked phone mode, Appearance Studio also yields a bottom band large enough for the Dock and Statistics tertiary rail.
- `.app-shell` isolation is unchanged; Material depth and Lighting ownership are unchanged.

## Regression contract

`tools/validate-core-ui-42.mjs` now requires the Chrome CSS import and explicit topbar/Dock/Appearance stacking rules. The complete dependency-light matrix remains green after this change.

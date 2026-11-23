# Classic Registry Frontend 1.4

Classic Registry is a compact bilingual English/Persian frontend for the Equine Registry platform contract. It keeps the calm, information-dense character of a well-built late-1990s/early-2000s professional registry application while using modern responsive layout, semantic HTML, logical RTL/LTR CSS, dependency-free ES modules and an explicit typed frontend compatibility manifest.

## Visual system and customization

Version 1.4 retains the customization layer without turning the interface into a theme playground. Large pure-white surfaces remain intentionally absent: light appearance uses warm paper, stone and lightly tinted working surfaces; dark appearance uses warm charcoal rather than pure black and off-white text rather than pure white.

Color scheme and brightness are separate axes. The side drawer provides six restrained professional palettes — Registry Blue & Sage, Cobalt & Copper, Forest & Claret, Slate & Amber, Indigo & Teal, and Plum & Moss — plus independent Light, Dark and System appearance modes. Density and typography live in the same drawer and preferences persist locally. A pre-CSS boot script applies saved appearance tokens before the main stylesheet, reducing theme flash.

Visual encoding is semantic rather than decorative. Registry, People, Pedigree, Breeding, Analytics, Library, Account and Administration have stable route identities. Sire, dam, offspring, subject, success, warning, error, workflow state and live/reserved capability state each use consistent visual signals. The same signals remain readable in dark mode and both document directions.

## Typography and RTL

The production shell requests Source Sans 3, Vazirmatn, Noto Kufi Arabic, Noto Nastaliq Urdu and Amiri from Google Fonts, with system/local fallbacks including Vazir and Sahel. No font files are bundled. Available packs are:

- Readable — Source Sans 3 / Vazirmatn
- Soft — Sahel-first when installed locally, with Vazirmatn fallback
- Formal — Noto Kufi Arabic
- Handwritten — Vazirmatn body with Nastaliq display accents
- Editorial — Amiri/Georgia-oriented classic reading

Nastaliq is deliberately an accent/display face, not body text. Persian changes the document language and direction, while layout uses logical properties instead of separate mirrored CSS. Navigation, borders, drawer placement, tables, tree emphasis and controls therefore remain coherent in RTL and LTR.

## Optional retro interaction sound

Version 1.4 retains the opt-in sound layer built with the Web Audio API. It does **not** include, copy or redistribute Microsoft/Windows audio files. Two original cue packs provide short desktop-inspired feedback for meaningful events only: route navigation, open/close, success, warning and error. Typing and hovering remain silent. Sound is off by default, volume is conservative and the user can preview, change or disable it independently of visual preferences.

## Precision vertical pedigree tree

Ancestor and descendant trees are top-down. A child group owns one vertical parent trunk and one horizontal sibling bus; zero-gap equal-width grid tracks establish exact child centres, and every child owns one vertical stem. Version 1.4 renders the connectors as overlapping 2px solid rectangles instead of independent borders so junctions share physical pixels and do not develop one-pixel gaps from anti-aliasing. The browser geometry test measured a maximum connector-centre deviation of approximately 0.008 px in RTL. Phone layouts switch to a continuous vertical rail instead of squeezing a desktop-wide tree.

## Platform/API coverage

The frontend manifest accounts for the complete platform feature catalog. All 23 capabilities enabled by `BASE_PLATFORM_CAPABILITIES` are surfaced: authentication, fuzzy and structured search, registry/facets/export, horse and people records, ancestor/descendant pedigree views, descendant reach, pedigree metrics/paths/coefficients, relationship analysis, horse insights, registry analytics, quality summaries, ownership claims, change requests, audit/admin/curation and breeding analysis.

The current audit finds direct frontend coverage for all 32 literal API routes and all 14 dynamic route families in `src/api/routes.ts`. Backend capabilities explicitly disabled by the supplied platform contract remain represented as reserved/dormant instead of being presented as live functionality.

Version 1.4 closes the remaining current-contract data-surface gaps: every public `HorseRecord` field is represented on the horse record/complete ledger, the full structured registry-filter contract is available (including imported origin, person IDs, parent-presence and explicit true/false flags), content cover/source/provenance fields are editable and preserved, canonical source/health/limit metadata is visible, and staff-only horse metadata is exposed read-only without sending non-editable fields back through the curation API.

## Preview fidelity

`preview/classic-ui-demo.html` is a standalone mock-data showcase. It embeds the production 1.4 visual layer and closely mirrors the production shell, navigation, Search, Registry, Account/workflows, horse capability tabs, Administration, capability map, customization drawer, typography, appearance/palette system, optional retro audio and precision pedigree geometry. It intentionally simulates API mutations and authentication rather than calling a backend.

For standalone/file-mode robustness, the demo uses a safe in-memory storage fallback if a browser denies `localStorage` access. Production uses normal same-origin `localStorage` under the deployed application origin.

## Accessibility and resilience

The customization drawer is a native modal dialog with labelled controls, Escape/backdrop closing, focus restoration and `aria-expanded` state. Reduced-motion preferences disable drawer and switch animation. Saved appearance can be applied before CSS, system appearance tracks `prefers-color-scheme`, and the app remains usable if external webfonts fail because every pack has local/system fallbacks.

## Source layout

- `public/index.html` — CSP-compatible shell and webfont declarations
- `public/ui/boot-theme.js` — early persisted-theme application
- `public/ui/classic.css` — tokenized bilingual visual system and responsive rules
- `public/ui/core.js` — state, API client, localization, formatters and UI primitives
- `public/ui/preferences.js` — customization drawer and preference wiring
- `public/ui/sound.js` — original Web Audio semantic cue engine
- `public/ui/app.js` — router, chrome and delegated event handling
- `public/ui/views/*.js` — feature surfaces
- `src/frontend/manifest.ts` — typed platform-feature declaration
- `preview/classic-ui-demo.html` — standalone mock-data design/interaction preview

## Core-frontend parity note

The supplied archive is explicitly `CORE-BACKEND-PURE-SOURCE` and contains no separate pre-existing/current Core frontend assets. Exact screen-by-screen parity with an unseen Core frontend therefore cannot be mechanically proven. Version 1.3 is verified for full supplied-backend route coverage and full enabled platform-contract coverage, which is the strongest parity target available from the provided source. If the separate Core frontend source is supplied later, its workflows, fields and screens can be mechanically diffed against this implementation.

# R147 — current local implementation candidate (0.89.0 / contract 2.32.0)

Read [R147_START_HERE.md](R147_START_HERE.md) and [the implementation/remaining-work handoff](docs/R147_IMPLEMENTATION_AND_REMAINING_WORK.md). This package includes migrations0110–0116 and the actual implementation described there. It has not been deployed or qualified for unrestricted production. Current verification is in [R147_VALIDATION.md](docs/R147_VALIDATION.md).

The earlier release/deployment statements below are preserved input history; they do not qualify this candidate or prove the state of a live service.

---

> **Current R117 local review candidate:** based on R116 a66d3cf; app 0.67.0, contract 2.25.0, 88 migrations. Actual new source changes, not a deployment. Start at [R117_START_HERE.md](R117_START_HERE.md), then the [current validation](review-r117/VALIDATION.md) and [execution TODO](review-r117/TODO.md). The older "current" versions and test counts below are preserved historical records, NOT R117 qualification.

## Preserved input history

> **Current R113 implementation candidate (2026-10-17):** app **0.58.0**, contract **2.24.0**, migrations through **0085**. Start at [R113_START_HERE.md](R113_START_HERE.md). This package includes R112/R111 plus the backend, privacy, native workflow and accessibility improvements recorded in [review-r113/README.md](review-r113/README.md). Exact verification is in [VALIDATION.md](review-r113/VALIDATION.md); [TODO.md](TODO.md) retains all 44 original tasks. No production deployment was performed. Earlier release, count, access and completion statements below are historical and do not certify this candidate.

## Historical project record

> **Latest independent review: R109 remediation candidate, not a release approval.** Start at [R109_START_HERE.md](R109_START_HERE.md). Historical export/release/handoff manifests retained below do not certify this candidate.

> **R108 independent review (2026-10-15):** Start with [review-r108/README.md](review-r108/README.md). New source fixes, merge verification, same-candidate evidence and 31 explicit remaining tickets are recorded there. This is **not production approved and not complete five-frontend parity**. Earlier release/certification/deployment statements below are historical. Current metadata: [REVIEW_CURRENT.json](REVIEW_CURRENT.json).

> **R106 follow-up review (2026-10-14):** See [review-r106/README.md](review-r106/README.md) for the R105 merge audit, new fixes, isolated demo setup, remaining parity gaps and release gates. This tree is an unapproved review candidate; the R105 deployment record below is historical and does not certify R106.

> **R104 source review (2026-10-14):** Start with [review-r104/README.md](review-r104/README.md). Current executable inventory: app 0.57.0, contract 2.23.0, five maintained frontend kits. This is a locally tested remediation candidate, not deployment approval or complete parity. Older versions, frontend lists, test counts and certification language below are historical; see the current audit, backlog and validation ledger.

# Horse Registry NextGen — v0.43.0

> **▶ START HERE:** [`PROJECT_CONTINUITY.md`](./PROJECT_CONTINUITY.md) — current state, pending backlog, environment/credential policy, architecture contracts (CSS layering, surface materials), session protocol, and known gotchas. Last updated at R40 closeout.

## R31 canonical AI Research Assistant

R31 promotes the previously reserved `ai_assistant` capability to canonical experimental platform capability `1.0.0` under platform contract **2.14.0**. Gemini 3.5 Flash-Lite is the default quota-aware agent model; DeepSeek V4.1 Flash (`deepseek-flash`) is the paid alternate/fallback. All model access is server-side and all public registry research is read-only.

Key properties:

- provider-neutral AI runtime with isolated Gemini/DeepSeek adapters;
- stateful Gemini Interactions support with exact tool-call/result continuation;
- dynamic token/quota context management with no fixed turn-count memory cutoff;
- DeepSeek zero-cache worst-case cost guard;
- four bounded research tools over canonical registry/pedigree/analytics/content services;
- durable conversations, request/usage ledger, per-conversation turn lease, and lightweight vision references;
- full AI Research surfaces in FEI and EquiData plus a shared host assistant launcher;
- real 78,089-horse canonical service validation available through `npm run test:ai-realdata` when a verified SQLite copy is supplied.

See `docs/R31_AI_ASSISTANT_ARCHITECTURE.md`, `docs/R31_AI_OPERATIONS.md`, and `docs/R31_AI_REALDATA_VALIDATION_2026-09-15.md`.

# Horse Registry NextGen — v0.42.16

**R27 seeded newsroom + demo-admin extension:** additive platform contract 2.13.0 extends the bilingual Newsroom with sourced starter posts, cover-image provenance, and a local/demo one-click admin shortcut while retaining the Gemini editorial agent; no canonical horse-data semantics change.

### Current line: audit-remediated v1.1.8 certification (post-package delta applied)

The **audit-remediated v1.1.8 certification line** is the current authoritative state of this tree; older v1.1.4/v1.1.6 visual-promotion sections below are historical release notes, not the current baseline. The v1.1.8 line adds: bounded privileged registry export (500 rows/request, semantic `registry.export` authorization), 24-item change-request ceiling, a dedicated 30/min write limiter plus per-account login limiter (5/min) and `Retry-After: 60` on all 429s, iterative JSON evidence-complexity guarding, Free-tier budget and operational-inventory drift validators wired into `npm run check`, a focused backend-core TypeScript sub-gate, an all-migrations Python smoke suite, complete Browse URL query-state round-tripping, and snapshot-backed admin dashboard counts.

**Cloudflare tooling behavior (important for future agents):** `wrangler dev` and `wrangler deploy` use the **redirected configuration** and serve the prebuilt `dist/horse_registry_nextgen/` output — source changes are invisible to workerd until `npm run build` runs first. Always build before dev/deploy verification.

### v1.1.7 auto-discovered AVIF wallpaper library

Appearance Studio now treats Dark/Light as true tone polarities when **Mirror Dark ↔ Light tone controls** is enabled: all ten signed darker/brighter channels—including Major/Panel/Card/Control Material shade—reverse together in Light mode. The new **Auto · Scene** palette samples the active background image, derives a restrained foundation/accent family plus warm-metal and split-complementary Ambient harmonies, and recalculates independently for Dark and Light scenes while leaving sire/dam/status semantic colors untouched.

### v1.1.4 persistent Chrome stacking

The Core header/topbar and Docked phone navigation now have explicit persistent-Chrome stacking authority. H42's broad `.app-shell>* { z-index:1 }` ambient recovery can no longer flatten the header into the page stack, Dock portals sit above viewport overlays, and Appearance Studio yields the persistent top and bottom Chrome bands instead of covering navigation.

**Current development authority:** Core Consolidation **v1.1.8 audit-remediated certification line**  
**Platform contract:** **2.13.0**  
**Scope of this consolidation:** **Heritage/Core only**

Horse DB is one canonical horse-registry platform with four independent frontend engines:

1. **Heritage Registry / Core** — canonical glass/registry experience.
2. **Q8 / Aspnamā Ledger** — independent editorial ledger/workspace experience with EN/FA/RTL.
3. **EquiData Elite** — independent intelligence-console visual engine.
4. **Prism Ultra** — independent compact semantic/HUD visual engine.

## Core Consolidation v1.1.8

The uploaded Auto/Dark preset remains the clean-install/reset default. The auto-discovered AVIF wallpaper library now includes **4 additional dark Persian miniature night wallpapers**, bringing the built-in shipped wallpaper count to **48 total** (**24 dark / 24 light**), while keeping each shipped wallpaper at **≤100 KB**. The original curated scene set, Adaptive Day/Night behavior, logo/splash customization, custom background upload/focus controls, and scene-aware Auto palette remain intact.


### v1.1.3 compact settings navigation

Appearance Studio uses a single-open accordion: all six sections start collapsed, one section opens at a time, and reopening the Studio starts clean.

The Consolidation line preserves the H42 visual result while replacing historical runtime coupling with a cleaner semantic architecture:

- synchronous Appearance bootstrap before React's first paint;
- external `useSyncExternalStore` Appearance runtime;
- portable theme preset schema **v22**;
- Material Depth semantics: **Major → Panel → Card → Control**;
- Theme schema/migration separated from Theme→CSS compilation;
- diffed CSS token writes and debounced persistence;
- stable `PlatformClient` identity across CSRF changes;
- extracted Appearance Studio, Lighting overlay and transitional surface-effects binder;
- explicit `data-h-surface-role` on high-value Core surfaces with a shrinking compatibility registry;
- recursive nonzero Frost at every semantic Material depth;
- Major/Panel local Ambient only, with weighted/hysteretic performance budgeting;
- ordinary-alpha Ambient composition rather than per-surface `mix-blend-mode: screen`;
- retired active `data-tint-motion`, Graphite palette residue and obsolete GAS/v6/v11 token families.


### v1.1.2 runtime load integrity

v1.1.2 fixes unresolved identifiers discovered by a real Vite browser run after v1.1.1: the extracted Appearance Studio now imports canonical Ambient pattern/scope lists, `main.tsx` restores `createPortal` and the tab-hierarchy type alias, and SearchPage now receives the `year` formatter it already used in H42. The source validator now rejects unresolved browser identifiers instead of checking syntax alone.

### v1.1.1 H42 regression verification

v1.1.1 was audited directly against the exact H42 full package from Google Drive. The audit confirmed unchanged Core feature/page logic, unchanged independent frontend source, unchanged H42-reachable layout geometry, and identified one disconnected Shine movement-cycle token. That token mapping is restored and regression-locked. See `docs/H42_REGRESSION_PARITY_REPORT.md`.

### v1.1 corrective hardening

v1.1 fixes the audit findings discovered after the first packaged Consolidation v1:

- repaired impossible Heritage selectors introduced by the first Core-scoping pass;
- added a validator that rejects descendant/nested document-root Heritage scopes;
- phone mode now resolves **Docked navigation before first paint**, even with a persisted desktop preset;
- empty transitional Material-role selectors are guarded before `Element.matches()`;
- normal local development is now the fast runtime; `npm run dev:qa` enables React StrictMode explicitly for QA;
- historical H42 hotfix reports and smoke fixtures are omitted from this clean working tree.

## Visual invariants

Do not redesign Core during consolidation. Preserve:

- H42's overall look and Material/Lighting composition;
- real recursive Frost on Major, Panel, Card and Control in Frosted mode;
- Material shade from true translucent black at `-100` through neutral to white-direction at `+100`;
- Ambient/Lighting isolation from material fill/transparency/backdrop blur;
- sire/male blue and dam/female pink semantics;
- v0.42.15 pedigree geometry;
- Map / Lineage / Radial exclusivity;
- Radial 100% non-scroll behavior;
- phone Docked navigation;
- Q8/Aspnamā, EquiData Elite and Prism Ultra as independent visual engines.

## Development modes

```bash
npm run dev       # fast local runtime; React StrictMode disabled
npm run dev:qa    # QA runtime; React StrictMode enabled
```

Use Strict QA to detect unsafe effects/lifecycle assumptions. Use normal `npm run dev` when judging interaction smoothness.

## Verification

Source/dependency-light validators are authoritative only for code architecture. Canonical promotion still requires an installed dependency tree and browser QA:

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run check
```

Then run Firefox + Chromium across Light/Dark, all four palettes, EN/FA/RTL, desktop/phone, Browse, Profile, Pedigree Map/Lineage/Radial, Statistics and Appearance Studio. Compare key screens to H42; consolidation is a refactor, not a redesign.

See `docs/ARCHITECTURE.md`, `docs/API.md`, and `docs/CORE_VISUAL_ARCHITECTURE_V2.md` for current authority.

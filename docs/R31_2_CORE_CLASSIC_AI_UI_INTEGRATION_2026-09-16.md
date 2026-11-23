# Horse-DB-3 R31.2 — Core + Classic Registry AI UI integration

Date: 2026-09-16
Base: `HORSE-DB-3-R31.1-FEI-HEADER-PRO-LATEST-COMPLETE-NO-DB-2026-09-16.zip`

## Goal
Make the R31 AI Research Assistant visibly and natively accessible in **Core / Heritage** and **Classic Registry**, while preserving the existing R31 agent/backend architecture.

## Implemented

### Global floating assistant
- `AssistantLauncher` no longer returns `null` when `/api/ai/status` says the assistant is unavailable.
- The floating **AI** button is always rendered.
- Readiness indicator states: checking / ready / unavailable.
- Clicking an unavailable assistant opens the actual panel and explains the reason instead of silently hiding the feature.
- Core keeps the floating launcher visible on all Core routes, including wallpaper presentation mode.

### Configuration/error visibility
`AssistantPanel` now displays explicit operational state for:
- `assistant_disabled` — `AI_ASSISTANT_ENABLED=1` is required.
- `storage_not_ready` — AI conversation/storage migrations must be applied.
- `no_provider_configured` — configure `GEMINI_API_KEY` or the DeepSeek provider.
- unreachable/unknown status.

Composer/model controls are disabled until an operational conversation is available, avoiding the previous misleading active-input state.

### Core / Heritage native AI page
- New first-class route: `/assistant`.
- New **AI Research** item in the Core desktop navigation.
- New **AI Research** item in the Core mobile dock.
- Full-page `AssistantPanel` uses the canonical shared `PlatformClient` and R31 AI backend.
- Heritage manifest now advertises `assistant` and surfaces `ai_assistant`; the operational AI feature remains optional so a locally disabled provider does not break the frontend.

### Classic Registry native AI page
- New first-class frontend-local route: `/f/classic-registry/assistant`.
- Classic Registry iframe navigation includes **AI Research / پژوهش AI** and opens the host-owned native React assistant page in the top window.
- The native page uses Classic Registry visual styling around the shared full-page `AssistantPanel`.
- Back-to-Registry action returns to `/f/classic-registry`.
- Classic Registry manifest version advanced to `1.4.3`, adds `assistant`, marks `ai_assistant` as `surface`, and treats operational AI availability as optional so `AI_ASSISTANT_ENABLED=0` never makes the entire frontend incompatible.

## R31 backend preservation
All 22 files under `src/ai/` are byte-for-byte unchanged from the R31.1 base.

## Modified paths
- `public/classic-registry/ui/app.js`
- `public/classic-registry/ui/classic.css`
- `public/classic-registry/ui/core.js`
- `src/frontend-kit/ai/AssistantLauncher.tsx`
- `src/frontend-kit/ai/AssistantPanel.tsx`
- `src/frontend-kit/ai/assistant.css`
- `src/web/frontendRegistry.ts`
- `src/web/frontends/classic-registry/classic-registry.css`
- `src/web/frontends/classic-registry/entry.tsx`
- `src/web/frontends/classic-registry/manifest.ts`
- `src/web/heritage/MobileDock.tsx`
- `src/web/i18n.tsx`
- `src/web/main.tsx`

## Validation completed
PASS:
- `node tools/validate-ai-assistant.mjs`
- `node tools/validate-frontends.mjs`
- `node tools/validate-production-frontend-assets.mjs --source`
- `node tools/validate-css-architecture.mjs`
- `node tools/validate-source-syntax.mjs`
- `node tools/validate-mobile-ux-system.mjs`
- `node tools/validate-platform-contract.mjs`
- `node tools/test-ai-provider-protocols.mjs`
- `node tools/test-ai-runtime-policies.mjs`
- `node tools/test-ai-storage.mjs`
- `node tools/validate-visible-surface-parity.mjs`
- `node tools/validate-presentation-parity.mjs`
- explicit source assertions for always-visible launcher, Core desktop/mobile routes, Classic native route/nav, non-blocking Classic AI capability and Core surface accounting.

## Build-level limitation
A clean `npm ci` could not complete in the managed sandbox. It was stopped and the partially-created `node_modules` directory was deleted before packaging. Therefore no claim is made that a fresh Vite build/typecheck was completed in this environment.

# Horse DB — Brief for Future Frontend-Building AI Agents

You are building **one interpretation of Horse DB**, not the Horse DB backend.

## Be different

Your frontend may use a radically different visual language, navigation model, density, interaction style, information hierarchy, and audience focus. Do not imitate Heritage/Q8 unless asked.

## Build against one public surface

When your frontend lives at `src/web/frontends/<id>/`, import Horse DB integration types/helpers only from:

```ts
import {
  createMockPlatformClient,
  defineFrontendManifest,
  horseDbRoutes,
  supportsPlatformFeature,
  type HorseRecord,
  type PlatformClient,
} from "../../../frontend-kit";
```

During independent development, `createMockPlatformClient()` may replace the real backend. During integration, the host supplies `runtime.platform` and `runtime.platformMeta`.

## Hard rules

Do not:

- call `/api/*` directly
- import host `src/web` helpers or backend `api/db/auth/worker` internals
- access SQLite/D1/Workers
- implement auth/CSRF mechanics
- infer authorization from role names; consume `runtime.permissions`
- invent canonical pedigree/ownership/search truth
- copy canonical DTOs when the kit already defines them
- assume optional capabilities exist without declaring/checking them
- use global `html`, `body`, `:root`, or bare `*` plugin CSS

## Recommended frontend folder

```text
frontend-id/
  manifest.ts
  entry.tsx
  adapter.ts
  components/
  styles.css
  assets/
```

`adapter.ts` is the deliberate translation seam between canonical Horse DB DTOs and your UI's own component model.

## Manifest

Declare:

- ID/name/version
- supported Horse DB contract range
- required capabilities
- optional capabilities
- individual feature-version ranges when semantics matter
- one CSS root scope

## Unique features are welcome

- presentation-only -> implement locally
- new composition of existing data -> local/shared-feature candidate
- reusable missing computation -> request a canonical platform capability
- genuinely new canonical data -> describe the data/source/behavior; integration may extend schema/domain/SDK

Never invent a frontend-specific backend route.

## Required resilience

Have deliberate states for loading, empty results, errors, auth-required behavior, optional-feature unavailable, phone, and desktop. Use request cancellation where appropriate.

Before handoff, run the frontend validator (or provide code structured so the integrator can run it). Machine-readable validation is available through `npm run validate:frontends:json`.

# Horse DB — Frontend Integration Playbook

Use this for a frontend created independently by a human or AI.

## 1. Preserve first

Inventory routes, mock data, actions, assumptions, unique features, dependencies/assets, loading/error/empty states, responsive behavior and visual identity before adapting anything.

Do not reshape a donor into Heritage/Q8 styling.

## 2. Classify every donor feature

- **PLATFORM-EXISTING** — bind to a current capability.
- **PRESENTATION-LOCAL** — preserve as local UI behavior.
- **PLATFORM-CANDIDATE** — reusable feature supportable from existing/new truthful data; evaluate for backend expansion.
- **DORMANT** — keep concept/code, clearly disable because data/workflow does not exist.

Never fake canonical horse/genomic/performance/market data to make a donor screen look populated.

## 3. Normalize only the integration seam

Frontend code imports only its own local modules and `src/frontend-kit/index.ts`. Route all data/actions through `PlatformClient`.

Use a frontend-local adapter/view-model when donor component shapes differ from canonical DTOs.

## 4. Capability accounting

Every canonical feature must be classified in the frontend manifest. `surface` means a real visible experience; `host` is restricted to deliberately shared host-owned workflows; unavailable reserved features stay `dormant`.

## 5. Visible presentation audit

For every live feature, trace:

```text
capability → PlatformClient method → route/action → actual UI → loading/error/empty → responsive state
```

Do not stop after proving the API call exists.

For graphical capabilities such as pedigree, compare the **interaction class**, not just data presence. A list of ancestors is not a substitute for an actual family-tree visualizer.

## 6. Shared code decision

Refactor only stable semantics:

- domain/SDK → share aggressively
- headless geometry/state algorithm → share when repeated and mature
- visual component/design token → keep local unless frontends intentionally belong to the same experience family

Example: pedigree layout math is shared; Heritage/Q8/EquiData/Prism render it independently.

## 7. Release gates

Run at minimum:

- `validate:platform`
- `validate:frontends`
- relevant frontend-specific validator
- `validate:design-systems`
- `validate:presentation`
- `validate:visible-surfaces`
- strict Frontend Kit/pedigree TypeScript
- scientific pedigree fixtures
- Python/data verification
- full dependency-backed check/build and browser QA when available

A frontend is not release-parity until both source-level gates and actual browser behavior confirm the visible experience.

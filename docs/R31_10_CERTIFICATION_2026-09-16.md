# Horse-DB-3 R31.10 — AI mobile/provider refinement certification

Date: 2026-09-16  
Baseline: R31.9 AI Architecture Repair Certified full source, no database.  
Scope: mobile AI scrolling plus the five focused Senior Review provider refinements. No remote deployment/database mutation.

## Accepted Senior Review findings

The remaining R31.9 recommendations were checked against the current source and provider behavior before implementation. The following were accepted and implemented:

1. DeepSeek's cache-critical root system instruction must remain immutable across tool rounds.
2. Gemini's provider-native `countTokens` should be used selectively when local estimates approach material context/TPM boundaries or large replay/evidence is present.
3. DeepSeek zero-cache paid preflight should include a configurable conservative input-estimation multiplier.
4. Gemini opaque replay retention should be governed by token/headroom policy rather than a fixed 160,000-character cutoff.
5. A retryable Gemini 429 should get at most one bounded delayed retry before eligible paid fallback when local daily headroom remains; known daily exhaustion should not waste that retry.

## Mobile AI scrolling repair

The shared AI thread previously invoked `scrollIntoView()` whenever the streamed draft changed. On phones this could repeatedly move the nested/page scroll position while a user tried to read earlier messages.

R31.10 changes the contract to:

- `.hdb-ai-thread` owns vertical touch scrolling;
- streaming follows the bottom only while the user remains within a small near-bottom threshold;
- manually scrolling upward disables auto-follow;
- opening/sending a turn explicitly restores auto-follow;
- Core and Classic mobile wrappers keep `min-height:0`/bounded dynamic viewport heights so the inner thread can actually shrink and scroll;
- the mobile validator rejects the old streaming sentinel pattern and requires the touch-owned thread contract.

## Provider refinements

### DeepSeek cache-prefix stability

The orchestrator sends the immutable domain policy as DeepSeek's root system instruction on every agent round. Numerical remaining-round/call hints no longer rewrite the beginning of the request; call/round limits remain programmatically enforced and final synthesis still uses `tool_choice=none`.

The DeepSeek provider persists the system instruction alongside provider-native message state and reuses cached history only when that root policy is unchanged. Protocol regression tests assert the first system message is byte-stable across continuation.

### DeepSeek paid-input safety margin

`AI_DEEPSEEK_INPUT_ESTIMATE_MULTIPLIER` defaults to `1.35`. Estimated input tokens are multiplied before zero-cache worst-case cost reservation, reducing tokenizer-estimation risk while preserving the existing fail-closed per-request/daily ceilings.

### Selective Gemini authoritative counting

Normal turns keep the cheap local estimator. Gemini `countTokens` is invoked only for self-contained/rebuild requests when one of these is true:

- the local estimate reaches the configured fraction of the safe input budget (`AI_GEMINI_COUNT_TOKENS_THRESHOLD_FRACTION`, default `0.72`);
- pending tool evidence is unusually large;
- exact stateless replay is unusually large.

The effective preflight estimate is the larger of local and provider-authoritative counts. A token-counter transport failure does not make an otherwise safe conversation unusable; the conservative local estimate remains the fallback.

### Token-aware Gemini replay retention

The fixed character cutoff is removed. Exact opaque Interactions steps/signatures are retained according to the minimum safe headroom derived from model context, configured context safety fraction, output allowance and model TPM profile. `AI_GEMINI_REPLAY_MAX_TOKENS` may impose a lower operator ceiling. If exact replay is unavailable or too large, the durable semantic reconstruction remains the fallback.

### Gemini transient 429 handling

Gemini 429 responses preserve `Retry-After` where provided and distinguish clear daily/RPD exhaustion from transient rate pressure. Auto mode performs at most one bounded Gemini retry when the local ledger still has daily headroom, then proceeds through the existing fallback policy. `AI_GEMINI_TRANSIENT_429_RETRY_MAX_MS` defaults to 3000 ms. Explicit provider selection remains respected.

## Validation

PASS:

- `validate:syntax`
- `validate:ai`
- `test:ai-protocol` (including immutable DeepSeek root prefix, token-budgeted Gemini replay, Retry-After/daily-429 classification)
- `test:ai-runtime`
- `test:ai-storage`
- `test:ai-boundaries`
- `test:ai-result-budget`
- `validate:platform`
- `validate:frontends`
- `validate:css`
- `validate:mobile-ux`
- `validate:content`
- `validate:frontend-assets:source`
- `validate:heritage-boundary`
- `validate:equidata`
- `validate:presentation`
- `validate:visible-surfaces`
- `validate:admin-records`
- `validate:stage2`
- `validate:premium`
- `validate:premium-presentation`
- `validate:docs`
- `validate:prism-ultra`
- `validate:budgets`
- `validate:inventories`
- `validate:launcher`
- `validate:ui-42`
- Python unit tests: 31/31 PASS

INHERITED BASELINE FAILURE:

- `validate:design-systems` reports `Heritage analytics contains raw font shorthand pixels instead of typography tokens`. The identical failure is reproduced on the untouched R31.9 baseline, so it is not an R31.10 regression.

EXTERNAL/UNAVAILABLE GATES:

- Locked npm dependency restore cannot be completed offline because the npm cache is missing `motion-utils-13.0.0`; no `node_modules` was left behind.
- Therefore no claim is made for full dependency-backed TypeScript/Vitest/Vite production build.
- Chromium is installed, but the actual app cannot be launched from this source without the missing Vite/runtime dependencies; rendered phone/browser QA remains an external promotion gate.
- Live Gemini / DeepSeek / vision provider certification remains an external deployment-credential gate.

## Release authority

`R31_10_SOURCE_SHA256_MANIFEST.txt` is generated from the final frozen tree and is the current R31.10 whole-tree source authority. `docs/R31_SOURCE_DELTA_MANIFEST.txt` records the exact R31.9 -> R31.10 path delta. Databases, `node_modules`, Git metadata and generated Python caches are excluded from release archives.

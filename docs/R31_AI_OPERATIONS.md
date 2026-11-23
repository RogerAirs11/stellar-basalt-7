# R31 AI Operations / Quota / Cost Policy

## Required secrets

- `GEMINI_API_KEY`
- `DEEPSEEK_API_KEY` only when DeepSeek is enabled

Never place provider keys in source, frontend configuration, screenshots or validation reports.

## Feature/config gates

- `AI_ASSISTANT_ENABLED=1`
- `AI_GEMINI_ENABLED` (enabled unless explicitly `0`; provider key still required)
- `AI_DEEPSEEK_ENABLED=1`
- `AI_DEEPSEEK_VISION_ENABLED=1` only after live vision smoke succeeds
- `AI_GEMINI_WEB_GROUNDING_ENABLED=1` only after the deployment deliberately confirms grounding availability/billing

`AI_DB` is an optional dedicated D1 override for AI state. If omitted, the Worker uses its existing writable `DB` D1 binding even when registry reads are routed through Turso/Supabase. Capability still fails closed if required AI migrations/columns through `0022` are absent.

## Gemini quota configuration

Google's current Gemini API documentation does not promise one permanent public free-tier table: active limits are project/model specific, are shown in Google AI Studio, and specified limits are not guaranteed. Horse-DB therefore ships conservative free-tier safety defaults so a new local setup works without hand-entering quota values, while every value remains overrideable.

Researched defaults used by this release (2026-09-16):

| Model | RPM | Input TPM | RPD |
| --- | ---: | ---: | ---: |
| Gemini 3.5 Flash-Lite | 15 | 250,000 | 500 |
| Gemini 3.5 Flash | 5 | 1,000,000 | 20 |

These are operational safety defaults, **not a guarantee from Google**. They combine recent no-billing observations with a deliberately conservative Flash RPM where independent measurements differ. Before production use, compare the project's live limits in AI Studio and override Horse-DB when they differ. The additional `AI_GEMINI_RESERVE_FRACTION` defaults to `0.12`, so Horse-DB stops below the configured ceiling.

Preferred per-model overrides:

- `AI_GEMINI_FLASH_LITE_RPM_LIMIT` / `AI_GEMINI_FLASH_LITE_INPUT_TPM_LIMIT` / `AI_GEMINI_FLASH_LITE_RPD_LIMIT`
- `AI_GEMINI_FLASH_RPM_LIMIT` / `AI_GEMINI_FLASH_INPUT_TPM_LIMIT` / `AI_GEMINI_FLASH_RPD_LIMIT`

Legacy global overrides (`AI_GEMINI_RPM_LIMIT`, `AI_GEMINI_INPUT_TPM_LIMIT`, `AI_GEMINI_RPD_LIMIT`) remain supported and apply to either model when a model-specific override is absent.

The local ledger atomically reserves attempts **per model** before provider I/O. RPD uses the Gemini daily reset boundary at midnight America/Los_Angeles, not UTC midnight. The governor considers RPM, input TPM and RPD independently. Failed/retry attempts cannot disappear from the ledger and make quota state optimistic.

## Gemini context policy

Accuracy/coherence outrank token shaving while remaining under configured limits.

The runtime does **not** summarize after N turns. It retains useful history until context/TPM pressure requires a smaller working context. Provider execution bulk/recoverable evidence is rebased before meaningful conversational memory.

Routine chat uses the cheap conservative estimator, continuously corrected by actual provider usage metadata. Near a configured context/TPM boundary, during large stateless Gemini replay, or after unusually large tool evidence, the production orchestrator selectively calls Gemini `countTokens` before submission. This keeps normal turns cheap while using provider-authoritative counting where estimator error could matter.

Exact opaque Gemini Interactions replay is retained according to a **token/headroom budget**, not a fixed character cutoff. `AI_GEMINI_REPLAY_MAX_TOKENS` can impose a lower operator ceiling; otherwise the runtime derives retention from the model context window, configured safety fraction, output allowance and current model TPM profile. When exact replay is unavailable or too large, the durable semantic transcript remains the safe fallback.

On a retryable Gemini HTTP 429, Auto mode performs at most **one bounded delayed Gemini retry** before considering paid fallback when the local model ledger still has daily headroom. `Retry-After` is honored up to `AI_GEMINI_TRANSIENT_429_RETRY_MAX_MS` (default 3000 ms). Known daily/RPD exhaustion skips the retry and may fall back immediately if DeepSeek is explicitly enabled.

## DeepSeek paid safety

Defaults use conservative peak pricing and are operator-overridable:

- `AI_DEEPSEEK_CACHE_HIT_PER_MILLION_USD`
- `AI_DEEPSEEK_CACHE_MISS_PER_MILLION_USD`
- `AI_DEEPSEEK_OUTPUT_PER_MILLION_USD`
- `AI_DEEPSEEK_MAX_REQUEST_USD`
- `AI_DEEPSEEK_MAX_DAILY_USD`

Before every DeepSeek network call:

1. calculate the entire request as if **zero** historical tokens hit cache;
2. reject/rebase if per-request worst-case cost exceeds policy;
3. create a migration-backed daily cost reservation for that worst-case cost;
4. only then call DeepSeek;
5. reconcile successful calls to a measured cache-aware **estimated billed cost** using the configured tariff;
6. retain the conservative reservation for failed/unknown calls that may have been billable.

This prevents concurrent fallback sessions from collectively outrunning the global paid ceiling.

`completion_tokens` already includes DeepSeek reasoning tokens; reasoning-token detail is telemetry and is **not** billed a second time by `estimateDeepSeekBilledCost`. The value is explicitly an estimate because provider tariff windows can change.

## Routing

Default: Gemini 3.5 Flash-Lite.

Auto mode may fall back from Gemini to DeepSeek for real quota/rate/context/unavailability failures. Explicit provider selection is respected and is not silently switched.

A provider switch transfers only durable visible conversation + evidence/entity references. Gemini signatures are never translated into DeepSeek reasoning state and DeepSeek reasoning state is never injected into Gemini.

## Thinking policy

Gemini policies are model-specific:

- Flash-Lite: Fast=minimal, Auto=low, Research=medium.
- Flash: Fast=low, Auto=medium, Research=high.

DeepSeek ordinary chat disables thinking. Research mode may enable it. Do not rely on generic OpenAI sampling knobs to mean the same thing across providers.

## Output/tool budgets

Defaults are configurable and bounded:

- output: Fast 4096 / Auto 8192 / Research 16384 (never above Gemini 65536 limit)
- tool calls and rounds have mode-specific ceilings
- tool result character budgets adapt to active context headroom

Do not globally impose a tiny context ceiling merely for aesthetics.

## Abuse protection

The message endpoint is classified into the dedicated AI/expensive rate bucket. In addition, provider quota/cost governors enforce shared project-level ceilings.

## Operational diagnostics

Admin AI diagnostics expose aggregate operational data only:

- request counts;
- tokens;
- cached/hit/miss tokens;
- estimated billed and worst-case reserved DeepSeek cost;
- conversation/busy counts;
- recent provider error classes.

They must not expose chat bodies, API keys or hidden reasoning.

## Mandatory deployment certification

Before enabling a production provider:

1. clean `npm ci`;
2. full typechecks/tests/build;
3. `npm run validate:ai`;
4. `npm run test:ai-protocol`;
5. `npm run test:ai-runtime`;
6. `npm run test:ai-storage`;
7. real-data gate on a disposable canonical SQLite copy;
8. live Gemini tool-call continuation smoke;
9. live DeepSeek tool-call continuation smoke if DeepSeek is enabled;
10. live DeepSeek image smoke before setting `AI_DEEPSEEK_VISION_ENABLED=1`.

## User execution/model preferences

The assistant supports Fast / Auto / Research modes and explicit model selection. Auto is the default and uses Gemini 3.5 Flash-Lite while safe; selecting Auto also clears a previously stored explicit provider/model preference. An explicitly selected provider is never silently switched to another provider. A single bounded retry is allowed only for genuine transient transport/service-unavailability failures; quota/rate/cost/schema failures do not trigger a wasteful retry.

## Deterministic zero-call optimization

Only strict, unambiguous horse-ID navigation commands may be resolved without an LLM call. The result is still stored in the same durable conversation with canonical evidence/entity references, and provider continuation is cleared so the next real model turn is rebuilt from durable visible history. Ambiguous or interpretive requests always use the agent.

## Quota-source note (2026-09-16)

Google Gemini API rate-limit documentation (last updated 2026-09-02) directs operators to AI Studio for active project/model limits and notes that specified limits are not guaranteed. The bundled defaults above are intentionally overrideable and should be treated as safe bootstrap values rather than contractual provider limits.

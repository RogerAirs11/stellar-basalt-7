# Horse-DB-3 R31.9 — AI repair and certification report

Date: 2026-09-16
Baseline: R31.8 Core AI polish/diagnostics full source, no database.

## Release blockers repaired

1. **Physical AI-state / registry separation.** The agent loop receives `stateDb` and an injected domain adapter bound to `registryDb`. Conversation, lease, quota and cost state never follows canonical registry failover; routing pins the original D1 state authority before substituting a registry read provider.
2. **Semantic request routing.** `/api/ai/conversations/:id/messages` is classified as AI-state write + canonical registry read, not a canonical mutation. Automatic canonical failover remains read-only; hybrid AI turns are proactively failover-eligible but never same-request replayed.
3. **Streaming resource lifetime.** Request-scoped Supabase/Postgres registry resources are released at body EOF/error/cancel rather than immediately after an SSE `Response` is constructed.

## Architecture / reliability repairs

- Generic orchestration now consumes `AiDomainAdapter`; Horse-specific policy, tools, evidence links and deterministic local resolution live below `src/ai/domain/horseRegistry/`.
- Oversized tool payloads compact per operation while durable evidence remains available for final citations.
- Gemini stateful Interactions remain preferred. A bounded opaque replay history preserves exact provider steps/signatures for stateless recovery after interaction expiry; if unavailable/too large, durable semantic transcript reconstruction remains the safe fallback.
- External Markdown images are opt-in click-to-load with `referrerPolicy=no-referrer`.
- DeepSeek reservation accounting remains zero-cache/peak-conservative; successful-call telemetry is explicitly `estimated_billed_cost_usd`.
- AI content generation returns drafts only; publication requires a separate editor action.
- The no-op stop endpoint was removed; cancellation is the active stream AbortSignal/disconnect contract.

## New executable regressions

- `tools/test-ai-boundaries.mjs`: separate physical SQLite state/registry databases; local canonical resolution must read registry data while persisting transcript only in AI state. It also asserts hybrid routing/non-replay/stream-lifetime source contracts.
- `tools/test-ai-result-budget.mjs`: six oversized successful operations remain represented under a bounded provider payload.
- Provider protocol harness now verifies Gemini native function-call signatures survive stateless replay.
- Storage harness applies migrations through `0022`.

## Validation result

PASS: AI architecture validator; provider protocols; runtime policy; AI storage; AI boundary; result-budget; Newsroom governance; platform contract; production TS/TSX syntax; six frontend integration; CSS architecture; mobile UX; presentation parity; visible-surface parity; source production assets; free-tier budgets; operational inventories; launcher freshness; current docs; Core UI semantic gate; Python tests 31/31.

INHERITED FAILURE: `validate-design-systems` reports `Heritage analytics contains raw font shorthand pixels instead of typography tokens`. The identical failure is reproduced on the untouched R31.8 baseline and is outside the R31.9 AI delta.

NOT CERTIFIED IN THIS SANDBOX: clean dependency-backed TypeScript/Vitest/Vite production build (`node_modules` is intentionally absent), live provider calls, and rendered-browser visual QA. No claim is made that those gates passed.

## Frozen source authority

- Baseline: R31.8 full no-DB source SHA-256 `274b7668df0ad59f159f70d6dde5008cccd459a2bd8d3bef1efe6caf5416ebdd`.
- R31.9 source-tree delta: 11 added, 40 changed, 0 removed relative to that baseline.
- `R31_9_SOURCE_SHA256_MANIFEST.txt` is the only authoritative current source manifest and covers every packaged source file except itself.
- `MERGED_SOURCE_SHA256_MANIFEST.txt` and `R31_2_SOURCE_SHA256_MANIFEST.txt` are retained only as explicit historical notices.
- The full release package excludes databases, dependency directories, Git metadata and generated Python caches.

Final artifact SHA-256 values are emitted alongside the ZIPs after archive creation; they are intentionally not embedded here because embedding an archive's own checksum inside itself is circular.

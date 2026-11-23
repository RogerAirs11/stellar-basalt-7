# Horse-DB-3 R31.8 — Core AI polish and diagnostics

## Scope
R31.8 is a focused Core/Heritage assistant UX and orchestration reliability pass. It does not replace the canonical R31 AI backend architecture.

## UX
- Core page header uses `premium-page-head`.
- Core AI workspace uses `welcome-workspace`.
- Shared `frontend-kit/ai` owns chat structure, Markdown, composer, diagnostics, and optimistic-send behavior.
- `heritage.ai.css` only maps the shared assistant onto existing Heritage tokens and surface variables.
- The bottom-right launcher remains a compact support-style chat anchored to its launcher.

## Reliability
The old runtime could throw `tool_round_budget_exceeded` when the provider requested another tool round at the configured boundary. R31.8 treats the boundary as a synthesis step: the provider receives `toolChoice: none` and an explicit runtime instruction to answer from already collected evidence.

## Diagnostics
The chat exposes a compact diagnostics viewer and one-click log copy. The trace records route/model, mode, round/call budgets, provider step summaries, tool names, evidence counts, usage, timing and errors. API-key-like values are redacted and raw user prompt text is intentionally not logged.

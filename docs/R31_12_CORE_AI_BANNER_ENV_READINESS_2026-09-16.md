# Horse-DB-3 R31.12 — Core AI banner removal and local readiness hardening

## Scope

This is a narrow overlay on R31.11. It preserves the R31.11 EN/FA localization authority and R31.10/R31.9 AI architecture.

## Changes

- Removes the outer Core AI research hero/banner. The `/assistant` route starts directly at the existing `welcome-workspace` chat surface.
- Expands the full-page chat viewport to use the reclaimed vertical space, including the mobile dock-aware layout.
- Keeps production AI configuration fail-closed.
- In local SQLite development only, a configured Gemini/DeepSeek provider key implies `AI_ASSISTANT_ENABLED=1` when the flag is absent; an explicit `AI_ASSISTANT_ENABLED=0` remains authoritative.
- `.env.example` now uses `AI_ASSISTANT_ENABLED=1` with blank provider keys, so the normal local setup is: copy to `.env`, add a key, restart.
- Startup logs whether a private `.env` file and provider key were detected, without printing any secret.

## Security

No provider API key is embedded in the source package. Secret-pattern scan finds no Gemini `AIza...` or DeepSeek `sk-...` credential tokens.

## Validation

Passed dependency-light gates: source syntax, R31 AI architecture, frontend integration, CSS architecture, mobile UX, language/localization, Core UI semantics, launcher freshness, AI runtime policy, AI storage and physically separated AI/registry DB boundaries.

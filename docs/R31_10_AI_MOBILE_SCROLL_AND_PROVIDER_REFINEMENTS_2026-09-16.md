# Horse-DB-3 R31.10 — AI Mobile Scroll + Provider Refinements

Date: 2026-09-16
Base authority: R31.9 AI Architecture Repair Certified

## Scope

Focused follow-up to the Senior Review. No AI architecture redesign and no canonical registry mutation changes.

## Mobile chat scrolling

- Removed streaming-time `scrollIntoView()` ownership from the shared assistant.
- The message thread owns vertical scrolling on touch devices (`overflow-y:auto`, `touch-action:pan-y`, iOS momentum scrolling, contained overscroll).
- Auto-follow is now proximity-aware: new tokens follow only while the reader is near the bottom. Scrolling upward disables auto-follow until the user returns near the bottom or sends/opens a conversation.
- Core and Classic mobile viewport/flex chains explicitly allow the shared thread to shrink and scroll instead of growing/locking the outer page.

## Senior Review refinements

1. **DeepSeek cache-prefix stability** — root system policy is immutable across tool rounds. Tool/call budgets remain programmatically enforced; final synthesis still uses no tools.
2. **Selective Gemini authoritative token count** — `countTokens` is used only near safe-input boundaries, during large stateless replay, or with unusually large evidence.
3. **DeepSeek preflight margin** — estimated paid input is multiplied by 1.35× by default before zero-cache cost reservation; override with `AI_DEEPSEEK_INPUT_ESTIMATE_MULTIPLIER`.
4. **Token-aware Gemini replay retention** — replaced the fixed 160,000-character cutoff with a runtime token/headroom budget, optionally capped by `AI_GEMINI_REPLAY_MAX_TOKENS`.
5. **Transient Gemini 429 handling** — one bounded delayed retry is attempted when the local ledger still has daily headroom. Known daily exhaustion skips the retry before Auto fallback.

## New/advanced environment controls

- `AI_GEMINI_REPLAY_MAX_TOKENS` — optional operator ceiling; blank lets runtime derive a safe ceiling.
- `AI_GEMINI_COUNT_TOKENS_THRESHOLD_FRACTION=0.72`
- `AI_GEMINI_TRANSIENT_429_RETRY_MAX_MS=3000`
- `AI_DEEPSEEK_INPUT_ESTIMATE_MULTIPLIER=1.35`

## Regression locks

Provider protocol tests now verify DeepSeek's first system message remains stable across continuation and Gemini opaque replay is dropped only when its token retention budget is exceeded. Mobile UX validation rejects the old forced-scroll sentinel pattern and requires the shared touch-owned thread contract.

## Certification limits

Dependency-backed TypeScript/Vitest/Vite build, live-provider smokes and rendered-browser QA remain external gates if the environment cannot restore the locked npm dependency tree or launch the required browsers.

# R31 Implementation Validation Report — 2026-09-16

## Candidate identity

- Application: `0.43.0`
- Platform contract: `2.14.0`
- Capability: `ai_assistant 1.0.0 experimental`
- Baseline: `HORSE-DB-3-R29_30-FULL-PACKAGE-NO-DB-FEI-HEADER-ALIGNMENT-FIX-2026-09-15.zip`
- Baseline SHA-256: `9116d1d296533a3aaf881d49cb5a0e846712377e722647b15a4bbf854558ef7d`
- Scope: additive AI platform/runtime only; no canonical horse-data, pedigree-math, registry-authority, or deployment mutation.

## Final implementation state

R31 now contains the intended provider-neutral agentic research layer:

- Gemini 3.5 Flash-Lite default and Gemini 3.5 Flash optional through the stateful Interactions API.
- DeepSeek V4.1 Flash (`deepseek-flash`) paid alternate/fallback with explicit thinking behavior, cache telemetry, gated vision, zero-cache per-request protection, and migration-backed daily cost reservations.
- Dynamic token/context management with no fixed turn-count truncation.
- Durable logical conversations independent of provider retention.
- Idempotent browser retries, per-conversation leases, atomic terminal reply/provider-state commit, and safe deletion.
- Exact, conservative zero-model-call shortcut only for unambiguous horse-ID navigation.
- Explicit Auto / Gemini Flash-Lite / Gemini Flash / DeepSeek model selection with persistent/resettable conversation preference.
- Four bounded read-only research tools: `registry_research`, `pedigree_research`, `registry_analysis`, `content_research`.
- Structured registry browse, horse/person research, deterministic pedigree calculations, batched filtered statistics/rankings, fresh canonical analytics sections, and published-content retrieval.
- Server-side evidence/entity references and canonical links; no arbitrary SQL and no public mutation tools.
- Provider-neutral Newsroom generation, no embedded provider keys, explicit Gemini web-grounding capability gate.
- Shared frontend-kit assistant UI, host launcher, FEI/EquiData full Research surfaces, streaming/cancellation, safe retry, conversation history/delete, model selection, and optional HTTPS image references.

## Important recovered-source correctness fixes

During reconstruction/recovery, executable AI harnesses found and fixed real defects rather than simply recreating the old edits:

- fixed malformed atomic assistant INSERT (`12 values for 11 columns`);
- fixed fresh Gemini Interactions input to use the documented step-array representation;
- stopped fabricating unsigned historical `model_output` steps during expired-interaction recovery;
- migrated tool schema generation to Zod 4 public `toJSONSchema()` instead of brittle Zod 3 internals;
- kept DeepSeek dynamic page context out of the stable cache prefix;
- fixed DeepSeek output-cost accounting so reasoning-token detail is not billed twice;
- aligned Gemini RPD ledger with the provider's Pacific-day reset boundary;
- normalized provider transport/stream failures for safe retry/fallback while preserving abort semantics;
- made partially migrated AI storage fail closed by probing column-only migrations;
- fixed explicit Auto selection so it can clear a stored provider/model preference;
- made `AI_DB` an optional dedicated D1 override; otherwise the canonical writable `DB` binding stores isolated AI tables even if registry reads are routed elsewhere.

## Dependency-light implementation gates — PASS

The following commands pass on the current reconstructed source:

```text
node tools/validate-ai-assistant.mjs
node tools/test-ai-provider-protocols.mjs
node tools/test-ai-runtime-policies.mjs
node tools/test-ai-storage.mjs
npm run validate:platform
npm run validate:syntax
npm run validate:frontends
npm run validate:presentation
npm run validate:visible-surfaces
npm run validate:equidata
npm run validate:prism-ultra
npm run validate:content
npm run validate:inventories
```

Most recent observed key results:

- AI architecture/security gate: PASS.
- Gemini/DeepSeek protocol harness: PASS.
- dynamic-memory/runtime-policy harness: PASS.
- storage/idempotency/preference/cost harness: PASS.
- platform contract: PASS (`0.43.0` / `2.14.0`).
- TS/TSX source syntax: PASS (`248` source files, zero parse/browser unresolved-name diagnostics).
- six external frontend integrations: PASS.
- presentation + visible-surface parity: PASS.
- EquiData + Prism AI integration: PASS.
- provider-neutral Newsroom: PASS.
- operational inventory: PASS (`59` API route entries, `31` migrated structures, `21` migrations).

## Real-data authority

A separate immutable optimized serving SQLite was previously recovered and verified:

- 78,089 horses;
- 26,646 people;
- 110,469 horse-person relationships;
- SHA-256 `20d5fc704b097852fd07a4161ccf21cf9090924e1db80343d7bce2b34eee5603`;
- `PRAGMA integrity_check = ok`;
- zero FK violations.

Earlier service-level R31 validation passed against a disposable migrated copy. The final `tests/ai-realdata.test.ts` additionally covers structured browse/people lookup, exact local navigation, and the expanded batched analytics schema. Because this environment cannot restore the full dependency tree reliably, LunaZ must run that final Vitest against a disposable copy migrated through `0021` before certification.

## Known environment limitation / certification boundary

This implementation environment does **not** claim:

- clean `npm ci`;
- complete TypeScript project certification with installed third-party typings;
- full Vitest suite;
- production Vite/Cloudflare build;
- live Gemini API certification;
- live DeepSeek API/vision certification;
- rendered-browser final QA.

Those are the explicit LunaZ certification tasks. No deployment was performed and no production database was mutated.

## Known inherited non-R31 baseline issue

`validate:design-systems` reports a Heritage analytics typography-token complaint. The exact untouched R29/30 authority was independently shown to produce the same complaint. It is inherited baseline debt and is outside R31 AI scope; LunaZ must not repair unrelated Heritage styling merely to make the AI release green.

## Promotion rule

This source is an **R31 merge/certification candidate**, not a production-certified deployment. Promote only after LunaZ completes clean dependency-backed typecheck/test/build, final real-data Vitest, live Gemini/DeepSeek protocol smokes for enabled providers, and rendered-browser AI QA.

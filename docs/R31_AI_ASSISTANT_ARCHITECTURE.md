# R31 Canonical AI Research Assistant — Architecture

## Scope

R31 adds one canonical, read-only AI research capability to Horse-DB. Gemini 3.5 Flash-Lite is the default free-first provider; Gemini 3.5 Flash and DeepSeek V4.1 Flash are optional routes. The LLM plans research and explains results. Existing Horse-DB services remain the factual authority.

## Dependency boundaries

```text
Frontend surfaces
  -> PlatformClient.ai
  -> /api/ai/*
  -> AssistantService / Turn Orchestrator
      -> Provider adapters (Gemini / DeepSeek)
      -> Context / quota / cost governors
      -> Read-only AI Tool Registry
          -> Horse-DB Research Broker
              -> canonical search / registry / pedigree / analytics / content services
```

The generic `src/ai/core`, provider, context, quota and cost layers contain no horse-domain rules. Horse-specific behavior is isolated under `src/ai/domain/horseRegistry`.

## Canonical tool surface

The public agent exposes only four read-only tools:

- `registry_research`
  - ranked multilingual horse identity search;
  - structured registry browse using the canonical registry query compiler;
  - compact public horse profiles;
  - bounded people search;
  - public person profile + paged linked horses.
- `pedigree_research`
  - ancestors / descendants;
  - relationships;
  - pedigree and relationship coefficients;
  - Horse Intelligence;
  - prospective pairing analysis.
- `registry_analysis`
  - batched allow-listed filtered counts, distributions and rankings;
  - birth decade/year, lifecycle, breed/sex/place/strain/import source, sire/dam groupings;
  - bounded fresh sections from the canonical analytics snapshot;
  - raw populations are never dumped into the model.
- `content_research`
  - published content search and retrieval only.

All LLM arguments are validated by Zod 4. Provider tool schemas are generated from the same execution-authoritative Zod schemas using Zod's public `toJSONSchema` API. No model-generated SQL is accepted.

## Evidence semantics

Tool results include:

- stable evidence IDs;
- canonical horse/person/content entity references;
- total/returned counts where exact counts are practical;
- `truncated`, `hasMore`, and continuation cursor metadata;
- notes when a search candidate window is intentionally bounded.

If a tool result exceeds the active result budget, the model receives `result_too_large`; unseen evidence is not retained as hidden grounding.

## Execution modes and model selection

The shared assistant exposes Fast / Auto / Research execution modes and Auto / Gemini 3.5 Flash-Lite / Gemini 3.5 Flash / DeepSeek V4.1 Flash selection. Preferences are persisted per conversation and selecting Auto explicitly clears a previously stored provider/model preference. A deliberately narrow zero-model resolver handles only unambiguous horse-ID navigation; interpretive questions always enter the provider/tool loop.

## Conversation state

Horse-DB owns the durable logical conversation in `ai_conversations`, `ai_messages`, and `ai_message_attachments`.

Provider continuation state is stored separately:

- Gemini: interaction ID / opaque continuation state.
- DeepSeek: provider-native message state, including required `reasoning_content` when thinking + tools is active.

Hidden provider reasoning is never exposed as user-visible reasoning.

### Dynamic memory

There is no fixed turn-count truncation.

`contextGovernor.ts` classifies/reduces only the provider working context when actual context/TPM/cost pressure requires it:

1. retain full durable history;
2. keep recent turns verbatim;
3. convert older turns into deterministic extractive memory containing text excerpts + canonical entity/evidence refs;
4. prefer dropping recoverable execution payloads over meaningful dialogue;
5. rebase provider continuation state only when the compact visible transcript safely fits.

## Gemini 3.5 protocol

Primary API: Interactions.

Key invariants:

- stateful continuation uses `previous_interaction_id`;
- system instruction, tools and generation config are supplied on each interaction;
- function results preserve exact `call_id` and function name;
- fragmented streaming `arguments_delta` is accumulated before execution;
- returned provider state is treated as opaque;
- expired interaction recovery creates a fresh interaction from application-restored transcript data; old assistant messages are **not** fabricated as unsigned provider `model_output` steps;
- `countTokens` is available for exceptional near-boundary calibration, not invoked on every ordinary chat turn.

## DeepSeek V4.1 Flash protocol

Canonical model ID: `deepseek-flash`.

Key invariants:

- ordinary chat explicitly disables thinking;
- research mode may enable thinking with provider-specific effort mapping;
- when tools + thinking are used, prior `reasoning_content` is preserved in provider state as required;
- stable system/tool prefixes are preserved for cache reuse;
- dynamic page context is appended to the current user turn instead of mutating the cache-critical system prefix;
- cache hits are treated as an optimization only, never as a financial assumption;
- vision is deployment-gated and uses HTTPS image references.

## Tool-loop safety

The orchestrator enforces configurable model-call/tool-call/tool-round ceilings. Parallel function calls are atomic from the provider's perspective: Horse-DB never executes only a subset and then returns an incomplete function-result set.

Tool execution errors are converted into compact tool-error results so the model can explain/recover without corrupting provider request accounting.

## Idempotency / concurrency

- Every browser send has a stable `clientMessageId`.
- Duplicate browser/network retries converge on one durable user message.
- A completed reply can be replayed without another provider call.
- A per-conversation turn lease prevents concurrent provider-state forks.
- Assistant reply + provider continuation/token counters commit atomically in one D1 batch.
- Conversation deletion first acquires an exclusive lease; a busy delete is non-destructive.

## Security invariants

- Public AI tools are read-only.
- No unrestricted SQL tool exists.
- API keys are server-only secrets.
- AI storage fails closed when migrations/writable `AI_DB` are unavailable.
- Retrieved database/article text is evidence/data, never new system instructions.
- Canonical entity links are built server-side.

## Deployment storage

AI state uses a stable writable D1 authority: `AI_DB` when configured, otherwise the Worker's original D1 binding. Canonical registry reads are a separate capability and may independently route through D1/Turso/Supabase. When request routing replaces `DB` with a canonical read provider, the runtime pins `AI_DB` to the original writable D1 authority first, so assistant writes can never follow a read failover; an explicit `AI_DB` remains an optional stricter override. Authentication preserves the original D1 authority through `AUTH_DB`. AI capability fails closed until migrations `0016`–`0022`, including lease/idempotency and explicit estimated-cost semantics, are present on the AI state database.


## R31.9 domain boundary

The provider/runtime layer receives an injected `AiDomainAdapter`. Horse-specific policy, deterministic local resolution, entity-link construction, and registry tools live under `src/ai/domain/horseRegistry/`. The orchestrator owns provider/context/quota/cost/agent-loop mechanics only.

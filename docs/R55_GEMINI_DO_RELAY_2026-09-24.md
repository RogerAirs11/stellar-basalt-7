# R55 — AI chat on the owner's AI Studio keys: Durable-Object Gemini relay (2026-09-24)

## The owner's constraint

> "I clicked on the link you gave me and it says I should request access or something!
> I'm not gonna bother requesting anything from anyone! Is no other workaround to use my
> Google AI Studio API key for the AI chat?"

The remaining R54 blocker assumed the owner would enable the Vertex AI (Agent Platform)
API for the `AQ.` Express keys' GCP projects. The owner declined. This batch removes
that dependency entirely: the assistant now runs on plain AI Studio (`AIza…`) keys with
zero Google-side setup.

## Root cause chain (verified live)

1. `generativelanguage.googleapis.com` rejects requests **by caller region**
   ("User location is not supported for the API use") — HTTP 400, fired only for
   valid keys (invalid keys return 400 `API_KEY_INVALID` first, which is why key-less
   curl tests cannot detect the block).
2. The Worker runs on the PoP nearest each visitor. For visitors (and this sandbox) in
   blocked regions, the worker's own egress is blocked → the classic endpoint died.
3. The R44 Cloudflare AI Gateway (`GEMINI_BASE_URL`) worked on 2026-09-22, but its
   egress region is **not guaranteed**: on 2026-09-24 live probes showed
   `gateway = 400 geo_blocked` from the same colo where it had previously worked.
   The gateway proxies near the caller; it is a latency service, not a region pin.
4. With the classic path dead, the assistant fell back to Vertex AI Express
   (`AQ.` keys) → 403 `SERVICE_DISABLED` → the owner-facing "enable the API" wall.

## The fix: `GeminiRelay` Durable Object (deterministic US egress)

`src/ai/providers/gemini/relay.ts` — a Durable Object with a
`locationHint: "enam"` singleton (`primary`). The DO is materialized in Eastern North
America and stays there, so every outbound fetch to Google egresses from a
supported region regardless of the visitor's PoP. The provider talks to the synthetic
origin `https://gemini-relay.internal/v1beta/…` (never leaves the Cloudflare network);
`makeGeminiRelayFetch()` intercepts those URLs and routes them through the DO stub;
all other URLs (Vertex/DeepSeek) pass through to the global fetch unchanged.

Wiring (wrangler.jsonc): `durable_objects.binding GEMINI_RELAY → class GeminiRelay`,
migration `v55_gemini_relay` (`new_sqlite_classes` — free-plan compatible, no storage
used), exported from `src/worker.ts`. `loadAiConfig` swaps `config.gemini.baseUrl` to
the relay base and attaches `config.gemini.relay.fetchImpl` whenever the binding
exists; `GEMINI_RELAY_ENABLED="0"` is the kill switch; without the binding
(local dev) the GEMINI_BASE_URL gateway fallback keeps today's behavior.

Live proof (GET `/api/ai/diagnostics`, 2026-09-24 ~13:10 UTC):

| transport | egress | env-1 | env-2 | env-3 |
|---|---|---|---|---|
| direct | worker colo HKG | 400 geo_blocked | 400 geo_blocked | 400 geo_blocked |
| AI Gateway | near caller | 400 geo_blocked | 400 geo_blocked | 400 geo_blocked |
| **DO relay** | **EWR (US-East)** | **200 ok** | **200 ok** | **200 ok** |

End-to-end verified live from a geo-blocked region (HKG): EN answer, FA answer
("این وب‌سایت یک سامانه جامع ثبت و تحلیل اسب‌ها…"), a tool-driven answer
("There are **78,089** horses in the registry database" via `registry_analysis` with
evidence), and the stronger `gemini-3.5-flash` model explicitly.

## Vertex Express gating (`AI_VERTEX_EXPRESS_ENABLED`)

`AQ.` keys are held back from `geminiEnvKeys()`, the key ring (env + admin rows), and
`vertexExpressKey()` unless the operator sets `AI_VERTEX_EXPRESS_ENABLED="1"`.
While the Agent Platform API stays disabled on those GCP projects, an `AQ.` key can
only poison rotation with the enable-wall error, so it must not participate. If the
owner ever enables the API, setting the var brings the Vertex fallback back verbatim.

## Rotation and model-tier resilience

- **Multi-key rotation** (orchestrator): one turn now rotates through up to four
  distinct keys (`pickSkipping(attemptedIds)` — never re-picks a key that already
  failed this turn) instead of stopping after one alternate.
- **Model-tier fallback**: when the auto-selected `gemini-3.5-flash-lite` fails with a
  retryable capacity/quota error (Google serves "high demand … usually temporary" 503s
  on lite under free-tier spikes) and the turn was not an explicit model choice, the
  orchestrator retries once with `gemini-3.5-flash` — a **separate quota pool** — before
  any paid fallback. The quota governor still enforces flash's own (smaller) cap.
- **Friendly quota error**: the all-keys-daily-quota failure now explains itself
  ("resets around midnight Pacific time; chat history is unaffected") instead of a
  bare "Gemini request failed (429)".
- `geoBlockedError()` no longer tells operators to add `AQ.` keys; it points at the
  relay and the diagnostics endpoint.

## Operator diagnostics: `GET /api/ai/diagnostics`

Bearer- or `?token=`-guarded by the `AI_DIAG_TOKEN` worker secret (404 when unset —
the route is invisible without it). Read-only: reports the worker's egress colo, the
relay's own egress (via the DO's `/__location` trace probe), and per-key ×
per-transport (`direct` / `gateway` / `relay`) `GET /models` probes with a
classification (`ok` / `key_invalid` / `geo_blocked` / `api_disabled` /
`rate_limited` / …). `?generate=1` additionally runs one minimal
`POST /interactions` on the active transport per key (negligible quota cost) to reveal
the real generation-path status. Raw keys never leave the server — only masked
descriptions (`describeEntries()`), with `keyOf()` used strictly server-side.

This is the tool that isolated the root cause in one request and will answer any
future "why is the AI not answering" question authoritatively.

## Files

- `src/ai/providers/gemini/relay.ts` (new) — DO class, relay fetch builder, trace parsing.
- `wrangler.jsonc` — DO binding + `v55_gemini_relay` migration.
- `src/worker.ts` — export the DO class.
- `src/types/cloudflare-env.d.ts` — `GEMINI_RELAY`, `GEMINI_RELAY_ENABLED`, `AI_VERTEX_EXPRESS_ENABLED`, `AI_DIAG_TOKEN`.
- `src/ai/runtime/config.ts` — relay activation/baseUrl override, AQ gating in `geminiEnvKeys`, `vertexExpressEnabled` flag.
- `src/ai/core/keyRing.ts` — AQ gating at construction, `pickSkipping`, `describeEntries`, `keyOf`.
- `src/ai/runtime/orchestrator.ts` — relay `fetchImpl` into both provider constructions, multi-key rotation loop, model-tier fallback.
- `src/ai/providers/gemini/client.ts` — friendly daily-quota message.
- `src/ai/providers/gemini/vertexExpress.ts` — rewritten `geoBlockedError()` guidance.
- `src/content/gemini.ts` — relay transport for editorial generation + AQ gating.
- `src/ai/application/diagnostics.ts` (new) + route in `src/ai/application/api.ts`.
- `tools/ts-runtime-loader.mjs` — DO stub types for the standalone harness compilers.
- `tools/test-ai-content-generation.mjs` — ring primitives updated for the AQ gate (+opted-in variant).
- `tests/unit/geminiRelay.test.ts` (new, 12 tests) — interception, DO forwarding, `/__location`, AQ gating, relay config activation, rotation skipping.
- `docs/RUNTIME_ROUTE_BUDGET_INVENTORY.md` — the diagnostics route row (81 entries).

## Verification

- FULL `npm run check` GREEN (144 vitest tests incl. 12 new; all AI harnesses,
  validators, typechecks, python).
- Live from geo-blocked HKG: default-model EN turn, FA turn, tool turn, explicit
  flash turn — all complete with real usage accounting.
- Deployed version `daa2b41f-c927-4e86-9d49-1560e5ad89c5` (relay + fallback) after
  `c4f5fb83-…` (first relay rollout).

## Residual notes

- D1 free-tier daily row writes are exhausted until 00:00 UTC (2026-09-25) — the R54
  ephemeral/history-paused mode keeps the chat fully answering meanwhile; history
  saving resumes automatically.
- flash-lite free-tier capacity is bursty; the new model-tier fallback covers the
  spikes, and the daily-quota error is now self-explanatory.
- If the owner ever wants the Vertex Express path back: enable the Agent Platform API
  on the two GCP projects, then set `AI_VERTEX_EXPRESS_ENABLED=1`.

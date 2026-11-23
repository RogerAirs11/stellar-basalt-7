/**
 * Operator AI diagnostics: GET /api/ai/diagnostics?token=… (or Authorization:
 * Bearer …). Guarded by the AI_DIAG_TOKEN worker secret — the route 404s when
 * the token is unset. Read-only: probes the key ring against every configured
 * transport and returns per-key status without ever exposing raw keys.
 *
 * Probes per key:
 *   - GET {base}/models on direct / AI-Gateway / Durable-Object relay bases
 *     (free, not generation-metered) → distinguishes key-invalid vs
 *     region-blocked vs healthy per transport.
 *   - optionally (&generate=1) one minimal POST {base}/interactions round on
 *     the ACTIVE transport → reveals real generation-path status (e.g. daily
 *     quota 429) at negligible cost.
 */
import { error, json } from "../../api/http";
import { geminiQuotaForModel, loadAiConfig, resolveAiStateDatabase } from "../runtime/config";
import { reserveGeminiAttempt } from "../runtime/quotaGovernor";
import { completeRequestLedger } from "../conversation/repository";
import { loadGeminiKeyRing } from "../core/keyRing";
import { GEMINI_FLASH, GEMINI_FLASH_LITE } from "../core/modelCatalog";
import { GEMINI_RELAY_BASE, GEMINI_RELAY_ORIGIN, parseCloudflareTrace } from "../providers/gemini/relay";
import { isGeminiGeoBlockedMessage } from "../providers/gemini/vertexExpress";

const DIRECT_BASE = "https://generativelanguage.googleapis.com/v1beta";
const PROBE_TIMEOUT_MS = 20_000;

export async function aiDiagnostics(request: Request, env: Env): Promise<Response> {
  const expected = env.AI_DIAG_TOKEN?.trim();
  if (!expected) return error(404, "not_found", "Route not found");
  const url = new URL(request.url);
  const header = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  const query = url.searchParams.get("token")?.trim() ?? "";
  if ((header || query) !== expected) return error(401, "unauthorized", "Invalid diagnostics token");

  const config = loadAiConfig(env);
  const stateDb = resolveAiStateDatabase(env);
  const ring = await loadGeminiKeyRing(env, stateDb).catch(() => null);
  const generate = url.searchParams.get("generate") === "1";
  const latency = url.searchParams.get("latency") === "1";

  // Where does THIS worker egress from? (colo/region/IP via Cloudflare trace)
  const workerEgress = await fetch("https://www.cloudflare.com/cdn-cgi/trace", { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
    .then(r => r.text()).then(parseCloudflareTrace)
    .catch(() => ({ colo: null, loc: null, ip: null }));

  // Relay liveness + the relay's OWN egress (should be a US colo).
  let relay: Record<string, unknown> = { active: false, binding: Boolean(env.GEMINI_RELAY) };
  if (config.gemini.relay.active && config.gemini.relay.fetchImpl) {
    relay = {
      active: true,
      egress: await config.gemini.relay.fetchImpl(`${GEMINI_RELAY_ORIGIN}/__location`, { method: "GET", signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
        .then(r => r.json())
        .catch(cause => ({ error: cause instanceof Error ? cause.message : String(cause) })),
    };
  }

  // Transport matrix: always probe direct; gateway when configured; relay when active.
  // NOTE: the global fetch must be invoked with the global `this` — the Workers
  // runtime rejects detached calls ("Illegal invocation"), so wrap it.
  const globalFetch: typeof fetch = (input, init) => fetch(input as RequestInfo, init);
  // The ACTIVE transport is exactly what editorial generation uses: the relay
  // when its binding exists, else GEMINI_BASE_URL (AI Gateway), else direct.
  // (config.gemini.baseUrl alone is null when unset — comparing it directly
  // silently skipped the &generate=1 probe on default deployments.)
  const activeBase = config.gemini.relay.active ? GEMINI_RELAY_BASE : (env.GEMINI_BASE_URL?.trim() || DIRECT_BASE);
  const paths: Array<{ id: string; label: string; base: string; fetch: typeof fetch }> = [
    { id: "direct", label: "direct (worker egress)", base: DIRECT_BASE, fetch: globalFetch },
  ];
  const gatewayBase = env.GEMINI_BASE_URL?.trim();
  if (gatewayBase && gatewayBase !== GEMINI_RELAY_BASE) paths.push({ id: "gateway", label: "AI Gateway (GEMINI_BASE_URL)", base: gatewayBase, fetch: globalFetch });
  if (config.gemini.relay.fetchImpl) paths.push({ id: "relay", label: "Durable-Object relay (US-East pin)", base: GEMINI_RELAY_BASE, fetch: config.gemini.relay.fetchImpl });

  const described = ring?.describeEntries() ?? [];
  const keys = [];
  for (const described_ of described) {
    const raw = ring?.keyOf(described_.id);
    if (!raw) continue;
    const probes: Record<string, unknown> = {};
    for (const path of paths) {
      const models = await probeModels(path, raw);
      probes[path.id] = models;
      if (generate && path.base === activeBase) {
        probes[`${path.id}:generate`] = await probeInteractions(path, raw, stateDb, async (ledgerId) => {
          await reserveGeminiAttempt(stateDb, {
            id: ledgerId,
            conversationId: null,
            model: GEMINI_FLASH_LITE,
            requestKind: "diagnostic",
            estimatedInputTokens: 64,
            quota: geminiQuotaForModel(config.gemini, GEMINI_FLASH_LITE),
          });
        });
      }
    }
    keys.push({ ...described_, probes });
  }

  // Latency matrix (&latency=1): measures real generation latency per transport
  // path × endpoint flavor × model through the ACTIVE transport. This is the
  // operator tool for answering "why is chat slow" — it separates model
  // queueing from endpoint-flavor overhead (interactions vs generateContent).
  let latencyMatrix: Record<string, unknown> | null = null;
  if (latency && config.gemini.relay.fetchImpl && config.gemini.apiKey) {
    latencyMatrix = await probeLatencyMatrix(config.gemini.apiKey, config.gemini.relay.fetchImpl, url.searchParams.get("probe"));
  }

  // Full model catalog for the primary key (&models=1): which models these AI
  // Studio keys can actually use — informs default-model choices.
  let modelCatalog: unknown = null;
  if (url.searchParams.get("models") === "1" && config.gemini.relay.fetchImpl && config.gemini.apiKey) {
    modelCatalog = await config.gemini.relay.fetchImpl(`${GEMINI_RELAY_BASE}/models?pageSize=200`, {
      headers: { "x-goog-api-key": config.gemini.apiKey },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
      .then(r => r.json())
      .then((data: any) => (Array.isArray(data?.models) ? data.models.map((m: any) => m.name?.replace(/^models\//, "")).filter(Boolean) : data))
      .catch(cause => ({ error: cause instanceof Error ? cause.message : String(cause) }));
  }

  // Continuation repro (&continuation=1): reproduces the exact chat pipeline
  // shape — streaming interactions round 0, then a streaming continuation with
  // previous_interaction_id — to separate model-queue latency from
  // continuation-specific failures (e.g. 429s on round 1 only).
  let continuationProbe: Record<string, unknown> | null = null;
  if (url.searchParams.get("continuation") === "1" && config.gemini.relay.fetchImpl && config.gemini.apiKey) {
    continuationProbe = await probeInteractionsContinuation(config.gemini.apiKey, config.gemini.relay.fetchImpl, url.searchParams.get("probe") ?? "gemini-2.5-flash");
  }

  return json({
    generatedAt: new Date().toISOString(),
    config: {
      geminiEnabled: config.gemini.enabled,
      baseUrl: config.gemini.baseUrl,
      relayActive: config.gemini.relay.active,
      gatewayConfigured: Boolean(gatewayBase),
      vertexExpressEnabled: config.gemini.vertexExpressEnabled,
      defaultModel: config.gemini.defaultModel,
    },
    workerEgress,
    relay,
    latencyMatrix,
    modelCatalog,
    continuationProbe,
    keyCount: keys.length,
    keys,
    hint: "probe keys: status 200 = healthy; key_invalid = key rejected; geo_blocked = Google region-blocks that transport's egress; rate_limited/quota = valid key, quota spent. &latency=1 adds a per-endpoint latency matrix on the active transport.",
  });
}

async function probeModels(path: { base: string; fetch: typeof fetch }, apiKey: string): Promise<Record<string, unknown>> {
  try {
    const response = await path.fetch(`${path.base}/models`, { headers: { "x-goog-api-key": apiKey }, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    const body = await response.text();
    return { status: response.status, classification: classify(body, response.status), snippet: body.slice(0, 240) };
  } catch (cause) {
    return { status: 0, classification: "network_error", snippet: (cause instanceof Error ? cause.message : String(cause)).slice(0, 240) };
  }
}

async function probeInteractions(path: { base: string; fetch: typeof fetch }, apiKey: string, stateDb: D1Database | null, admission?: (ledgerId: string) => Promise<void>): Promise<Record<string, unknown>> {
  const body = JSON.stringify({
    model: GEMINI_FLASH_LITE,
    input: [{ type: "user_input", content: [{ type: "text", text: "Reply with the single word: ok" }] }],
    generation_config: { max_output_tokens: 16 },
    stream: false,
    store: false,
  });
  // R109-33: this probe IS a real generation network attempt, so it goes
  // through the same canonical admission as every other Gemini generation
  // (request_kind "diagnostic"). A refused admission means NO network call —
  // the refusal itself is the honest diagnostic.
  let ledgerId: string | null = null;
  if (admission) {
    ledgerId = crypto.randomUUID();
    try {
      await admission(ledgerId);
    } catch (cause) {
      const code = (cause as { code?: string })?.code ?? "admission_refused";
      return { status: 0, classification: "quota_refused", snippet: `generation probe not sent: ${code}` };
    }
  }
  const started = Date.now();
  try {
    const response = await path.fetch(`${path.base}/interactions`, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": apiKey }, body, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    const text = await response.text();
    if (ledgerId && stateDb) await completeRequestLedger(stateDb, { id: ledgerId, status: response.ok ? "success" : "failed", errorCode: response.ok ? null : `provider_http_${response.status}`, latencyMs: Date.now() - started }).catch(() => undefined);
    return { status: response.status, classification: classify(text, response.status), snippet: text.slice(0, 240) };
  } catch (cause) {
    if (ledgerId && stateDb) await completeRequestLedger(stateDb, { id: ledgerId, status: "failed", errorCode: "diagnostic_transport", latencyMs: Date.now() - started }).catch(() => undefined);
    return { status: 0, classification: "network_error", snippet: (cause instanceof Error ? cause.message : String(cause)).slice(0, 240) };
  }
}
function classify(body: string, status: number): string {
  if (status >= 200 && status < 300) return "ok";
  if (isGeminiGeoBlockedMessage(body)) return "geo_blocked";
  if (/api key not valid|api_key_invalid/i.test(body)) return "key_invalid";
  if (/has not been used in project .* before or it is disabled/i.test(body)) return "api_disabled";
  if (status === 429) return "rate_limited";
  if (status === 401 || status === 403) return "unauthorized";
  if (status >= 500) return "server_error";
  return `http_${status}`;
}

/** Latency matrix on the ACTIVE transport: per model × endpoint flavor.
 *  Each cell: total ms (and TTFB ms for streaming variants) for a minimal
 *  "reply with ok" generation — isolates endpoint overhead from model queueing.
 *  Models are selectable via &probe=model1,model2 (defaults: the two catalog models). */
async function probeLatencyMatrix(apiKey: string, fetchImpl: typeof fetch, requestedModels?: string | null): Promise<Record<string, unknown>> {  const base = GEMINI_RELAY_BASE;
  const extra = (requestedModels ?? "").split(",").map(m => m.trim()).filter(m => /^[a-z0-9.-]+$/i.test(m)).slice(0, 6);
  const models = extra.length ? extra : [GEMINI_FLASH_LITE, GEMINI_FLASH];
  const out: Record<string, unknown> = { base, probedAt: new Date().toISOString(), cells: {} as Record<string, unknown> };
  const cells = out.cells as Record<string, Record<string, unknown>>;
  const prompt = "Reply with the single word: ok";
  for (const model of models) {
    // 1) classic generateContent (non-streaming)
    {
      const started = Date.now();
      try {
        const response = await fetchImpl(`${base}/models/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 16 } }),
          signal: AbortSignal.timeout(90_000),
        });
        const text = await response.text();
        cells[`${model}:generateContent`] = { totalMs: Date.now() - started, status: response.status, classification: classify(text, response.status), snippet: text.slice(0, 160) };
      } catch (cause) {
        cells[`${model}:generateContent`] = { totalMs: Date.now() - started, status: 0, classification: "network_error", snippet: (cause instanceof Error ? cause.message : String(cause)).slice(0, 160) };
      }
    }
    // 2) classic streamGenerateContent (SSE; measures TTFB vs total)
    {
      const started = Date.now();
      try {
        const response = await fetchImpl(`${base}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 16 } }),
          signal: AbortSignal.timeout(90_000),
        });
        let ttfb: number | null = null;
        const reader = response.body?.getReader();
        if (reader) {
          while (true) {
            const next = await reader.read();
            if (next.done) break;
            if (ttfb === null) ttfb = Date.now() - started;
          }
        }
        const body = ttfb === null ? await response.text() : "";
        cells[`${model}:streamGenerateContent`] = { totalMs: Date.now() - started, ttfbMs: ttfb, status: response.status, classification: classify(body || (ttfb !== null ? "ok" : ""), response.status) };
      } catch (cause) {
        cells[`${model}:streamGenerateContent`] = { totalMs: Date.now() - started, status: 0, classification: "network_error", snippet: (cause instanceof Error ? cause.message : String(cause)).slice(0, 160) };
      }
    }
    // 3) interactions (the transport the assistant uses in production)
    {
      const started = Date.now();
      try {
        const response = await fetchImpl(`${base}/interactions`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({ model, input: [{ type: "user_input", content: [{ type: "text", text: prompt }] }], generation_config: { max_output_tokens: 16 }, stream: false, store: false }),
          signal: AbortSignal.timeout(90_000),
        });
        const text = await response.text();
        cells[`${model}:interactions`] = { totalMs: Date.now() - started, status: response.status, classification: classify(text, response.status), snippet: text.slice(0, 160) };
      } catch (cause) {
        cells[`${model}:interactions`] = { totalMs: Date.now() - started, status: 0, classification: "network_error", snippet: (cause instanceof Error ? cause.message : String(cause)).slice(0, 160) };
      }
    }
  }
  return out;
}

/** Chat-pipeline continuation repro (&continuation=1): streaming interactions
 *  round 0, then a streaming round 1 that references the round-0 interaction —
 *  the exact shape production turns use. Reports per-round status, latency and
 *  error bodies so continuation-specific failures (429-on-round-1) become
 *  diagnosable without a full chat turn. */
async function probeInteractionsContinuation(apiKey: string, fetchImpl: typeof fetch, model: string): Promise<Record<string, unknown>> {
  const base = GEMINI_RELAY_BASE;
  const headers = { "content-type": "application/json", "x-goog-api-key": apiKey };
  const out: Record<string, unknown> = { model, probedAt: new Date().toISOString() };
  const round = async (label: string, body: Record<string, unknown>) => {
    const started = Date.now();
    try {
      const response = await fetchImpl(`${base}/interactions`, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
      let text = "";
      const reader = response.body?.getReader();
      if (reader) { while (true) { const next = await reader.read(); if (next.done) break; text += new TextDecoder().decode(next.value); } }
      else text = await response.text();
      const interactionId = /"interaction"\s*:\s*{[^}]*"id"\s*:\s*"([^"]+)"/.exec(text)?.[1] ?? /"interactionId"\s*:\s*"([^"]+)"/.exec(text)?.[1] ?? null;
      return { totalMs: Date.now() - started, status: response.status, classification: classify(text.slice(0, 400), response.status), interactionId, body: text.slice(0, 300) };
    } catch (cause) {
      return { totalMs: Date.now() - started, status: 0, classification: "network_error", body: (cause instanceof Error ? cause.message : String(cause)).slice(0, 300) };
    }
  };
  const round0 = await round("round0", {
    model,
    input: [{ type: "user_input", content: [{ type: "text", text: "Reply with the single word: ok" }] }],
    generation_config: { max_output_tokens: 32 },
    stream: true,
    store: true,
  });
  (out as Record<string, unknown>).round0 = round0;
  if (round0.interactionId) {
    const round1 = await round("round1", {
      model,
      previous_interaction_id: round0.interactionId,
      input: [{ type: "user_input", content: [{ type: "text", text: "Now reply with the single word: done" }] }],
      generation_config: { max_output_tokens: 32 },
      stream: true,
      store: true,
    });
    (out as Record<string, unknown>).round1 = round1;
  }
  return out;
}

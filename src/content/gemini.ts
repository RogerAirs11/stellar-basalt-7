import { accountedGeminiEditorialFetch } from "./providerAccounting";
import { HttpError } from "../api/http";
import { loadGeminiKeyRing, type GeminiKeyRing } from "../ai/core/keyRing";
import { resolveAiStateDatabase } from "../ai/runtime/config";
import { GEMINI_RELAY_BASE, geminiRelayActive, makeGeminiRelayFetch } from "../ai/providers/gemini/relay";
import { isGeminiGeoBlockedMessage, isVertexExpressKey, vertexModelUrl } from "../ai/providers/gemini/vertexExpress";
import type { AiContentGenerateInput, ContentPostInput, ContentSource, GeminiContentModel } from "../contracts/platform";
import { buildEditorialPrompt, editorialJsonSchema, GeneratedContentSchema, toContentDraft, type GeneratedContent } from "./aiShared";

export const GEMINI_CONTENT_MODELS = ["gemini-2.5-flash", "gemini-3.8-flash", "gemini-3.5-flash-lite"] as const satisfies readonly GeminiContentModel[];
const FALLBACK_MODEL = "gemini-2.5-flash" as const;
const BASE = "https://generativelanguage.googleapis.com/v1beta";
const REQUEST_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_TOKENS = 32_768;

type Transport = "interactions" | "generate-content" | "vertex-express";

interface GeminiGenerationResult {
  text: string;
  sources: ContentSource[];
}

interface AttemptContext {
  input: AiContentGenerateInput;
  model: string;
  ring: GeminiKeyRing | null;
  envKey: string | null;
  warnings: string[];
  attempts: string[];
  transport: Transport;
  useSchema: boolean;
  grounding: boolean;
}

export async function generateGeminiBilingualContent(input: AiContentGenerateInput, env: Env): Promise<{ draft: ContentPostInput; sources: ContentSource[]; warnings: string[]; attempts: string[] }> {
  if (!(GEMINI_CONTENT_MODELS as readonly string[]).includes(input.model)) throw new HttpError(400, "unsupported_gemini_model", "Unsupported Gemini model");

  const stateDb = resolveAiStateDatabase(env);
  const ring = await loadGeminiKeyRing(env, stateDb).catch(() => null);
  const envKey = env.GEMINI_API_KEY?.trim() || null;
  if (!ring?.size && !envKey) throw new HttpError(503, "gemini_not_configured", "No Gemini API key is configured");
  // Vertex AI Express only participates when the operator opted in; its Agent
  // Platform API is disabled on this account's GCP projects, so an AQ key can
  // otherwise only poison generation with the enable-wall error.
  const vertexKey = env.AI_VERTEX_EXPRESS_ENABLED === "1"
    ? (ring?.vertexExpressKey()?.key ?? (isVertexExpressKey(envKey ?? "") ? envKey : null))
    : null;

  const warnings: string[] = [];
  const attempts: string[] = [];

  // Operator grounding policy: instead of failing the whole request, degrade
  // gracefully and tell the editor why.
  let grounding = input.grounding;
  if (grounding && env.AI_GEMINI_WEB_GROUNDING_ENABLED !== "1") {
    grounding = false;
    warnings.push("Web grounding was skipped because this deployment has AI_GEMINI_WEB_GROUNDING_ENABLED disabled.");
  }

  // Transport: the Durable-Object relay (deterministic US-East egress) wins
  // whenever its binding exists; GEMINI_BASE_URL (Cloudflare AI Gateway) is the
  // binding-less fallback. Either way the owner's plain AI Studio keys work
  // even when the worker runs near a geo-blocked visitor.
  const relayActive = geminiRelayActive(env);
  const relayFetch = relayActive && env.GEMINI_RELAY ? makeGeminiRelayFetch(env.GEMINI_RELAY) : null;
  const base = relayFetch ? GEMINI_RELAY_BASE : (env.GEMINI_BASE_URL?.trim() || BASE);
  const fetchImpl = accountedGeminiEditorialFetch(env, relayFetch ?? fetch);

  // Model fallback chain: the requested model first, then the lighter model
  // with its own independent free-tier quota.
  const models = input.model === FALLBACK_MODEL ? [input.model] : [input.model, FALLBACK_MODEL];
  let lastError: unknown = null;

  for (const model of models) {
    try {
      const generated = await generateWithModel(input, model, { ring, envKey, vertexKey, grounding, warnings, attempts, base, fetchImpl });
      if (model !== input.model) attempts.push(`Fell back to ${model} after ${input.model} could not complete.`);
      return { draft: toContentDraft(input, generated.content, generated.sources), sources: generated.sources, warnings, attempts };
    } catch (error) {
      lastError = error;
      if (error instanceof HttpError && (error.code.includes("reservation") || error.code.includes("reserve_reached") || error.code === "editorial_accounting_unavailable" || error.code === "gemini_quota_unconfigured")) throw error;
      // Only model-capacity/availability failures justify trying the next model.
      if (!(error instanceof HttpError) || !(error.status === 429 || error.status === 404 || error.status >= 500)) throw error;
      if (models.indexOf(model) === models.length - 1) break;
    }
  }
  throw lastError instanceof Error ? lastError : new HttpError(502, "gemini_error", "Gemini content generation failed");
}

async function generateWithModel(input: AiContentGenerateInput, model: string, ctx: { ring: GeminiKeyRing | null; envKey: string | null; vertexKey?: string | null; grounding: boolean; warnings: string[]; attempts: string[]; base?: string; fetchImpl?: typeof fetch }): Promise<{ content: GeneratedContent; sources: ContentSource[] }> {
  const { ring, envKey, warnings, attempts } = ctx;
  const base = ctx.base ?? BASE;
  const fetchImpl = ctx.fetchImpl;
  let grounding = ctx.grounding;
  const vertexKey = ctx.vertexKey ?? null;

  // Key rotation budget: one attempt per distinct key (env + admin ring), plus
  // a single classic-endpoint fallback when the Interactions API is rejected
  // for this deployment region/key type, plus one Vertex AI Express attempt when
  // the classic Gemini API is region-blocked and an "AQ." key is configured.
  const maxAttempts = Math.max(1, (ring?.size ?? 0) || (envKey ? 1 : 0)) + 1 + (vertexKey ? 1 : 0);
  let lastError: unknown = null;
  let transport: Transport = "interactions";

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const useVertex = transport === "vertex-express";
    const keyEntry = ring?.size && !useVertex ? ring.pickForModel(model) : null;
    if (ring?.size && !useVertex && !keyEntry) {
      throw new HttpError(429, "gemini_keys_unavailable", "No eligible Gemini credential is available; wait for its cooldown or choose a supported model");
    }
    const apiKey = useVertex ? vertexKey : keyEntry?.key ?? envKey;
    if (!apiKey) throw new HttpError(503, "gemini_not_configured", "No Gemini API key is configured");

    try {
      const result = await requestGemini({ input, model, apiKey, transport, grounding, warnings, base, fetchImpl });
      if (keyEntry && !useVertex) ring?.markUsed(keyEntry.id);
      const content = await parseAndValidate(result.text, { input, model, apiKey, warnings, attempts, transport, base, fetchImpl });
      return { content, sources: result.sources };
    } catch (error) {
      lastError = error;
      if (error instanceof HttpError && (error.code.includes("reservation") || error.code.includes("reserve_reached") || error.code === "editorial_accounting_unavailable" || error.code === "gemini_quota_unconfigured")) throw error;

      // Regional block on the classic Gemini API: the whole generativelanguage
      // host is unreachable from this deployment's region — retry via Vertex AI
      // Express (aiplatform.googleapis.com) when an "AQ." key is configured.
      if (isGeoBlocked(error) && transport !== "vertex-express") {
        if (vertexKey) {
          transport = "vertex-express";
          attempts.push("Classic Gemini API is region-blocked on this server; retried via Vertex AI Express.");
          continue;
        }
        // No Vertex Express key configured: still give the classic
        // generateContent endpoint one attempt before giving up (R37 restores
        // the pre-R35 transport degradation — some deployments only reject the
        // Interactions API while the classic endpoint remains usable).
        if (transport === "interactions") {
          transport = "generate-content";
          attempts.push("Interactions API is unavailable in this region; trying the classic Gemini endpoint.");
          continue;
        }
        break;
      }
      // Vertex fallback exhausted.
      if (useVertex) break;

      // Transport degradation: some regions/keys reject the Interactions API
      // outright; the classic endpoint is the durable fallback.
      if (isInteractionsUnavailable(error) && transport === "interactions") {
        transport = "generate-content";
        attempts.push("Switched to the classic Gemini endpoint (Interactions API unavailable for this key/region).");
        continue;
      }
      // Grounding + schema incompatibility: drop the schema and retry prompt-based JSON.
      if (isSchemaGroundingConflict(error) && grounding) {
        grounding = false;
        warnings.push("Structured-output schema is not compatible with web grounding; generated with prompt-enforced JSON instead.");
        continue;
      }
      // Rate limits: cool this key for THIS MODEL (Gemini quotas are per
      // project AND per model — exhausting 3.8's bucket does not exhaust the
      // same credential's independent 2.5 quota), rotate to the next key, and
      // retry immediately. Retry-After timing is respected when provided.
      if (isRateLimit(error) && keyEntry) {
        ring?.markRateLimited(keyEntry.id, retryAfterMs(error), model);
        const alternate = ring?.pickExcept(keyEntry.id);
        if (alternate) {
          attempts.push("Rotated to the next configured API key after a rate limit.");
          continue;
        }
        throw error;
      }
      if (isAuthFailure(error) && keyEntry) {
        ring?.markInvalid(keyEntry.id);
        const alternate = ring?.pickExcept(keyEntry.id);
        if (alternate) { attempts.push("Skipped a rejected API key."); continue; }
      }
      if (!isRetryable(error)) throw error;
      continue;
    }
  }
  throw lastError instanceof Error ? lastError : new HttpError(502, "gemini_error", "Gemini content generation failed");
}

async function requestGemini(options: { input: AiContentGenerateInput; model: string; apiKey: string; transport: Transport; grounding: boolean; warnings: string[]; base?: string; fetchImpl?: typeof fetch }): Promise<GeminiGenerationResult> {
  const { input, model, apiKey, transport, grounding, warnings } = options;
  const base = options.base ?? BASE;
  const fetchImpl = options.fetchImpl;
  const prompt = buildEditorialPrompt(input);

  if (transport === "vertex-express") {
    // Vertex AI Express (aiplatform.googleapis.com) — not subject to the classic
    // Gemini API's regional block. Same generateContent surface, slightly
    // different body/field naming, and grounding works via the same tool.
    const body: Record<string, unknown> = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        ...(grounding ? {} : { responseMimeType: "application/json", responseSchema: stripUnsupportedKeys(editorialJsonSchema()) }),
      },
      ...(grounding ? { tools: [{ googleSearch: {} }] } : {}),
    };
    const payload = await postGemini(vertexModelUrl(model, "generateContent"), body, apiKey, fetchImpl);
    const candidate = payload.candidates?.[0];
    const text = candidate?.content?.parts?.map((part: { text?: string }) => part.text ?? "").join("").trim() ?? "";
    const sources = (candidate?.groundingMetadata?.groundingChunks ?? []).map((chunk: any) => ({ url: chunk?.web?.uri, title: chunk?.web?.title }));
    return { text, sources: dedupeSources(sources) };
  }

  if (transport === "interactions") {
    // Interactions API (2026 shape). response_format is incompatible with
    // google_search, so grounding runs prompt-enforced.
    const body: Record<string, unknown> = {
      model,
      input: [{ type: "user_input", content: [{ type: "text", text: prompt }] }],
      ...(grounding
        ? { tools: [{ type: "google_search" }] }
        : { response_format: { type: "text", mime_type: "application/json", schema: editorialJsonSchema() } }),
      generation_config: { max_output_tokens: MAX_OUTPUT_TOKENS, thinking_level: "low", thinking_summaries: "none" },
      store: false,
    };
    const payload = await postGemini(`${base}/interactions`, body, apiKey, fetchImpl);
    const interaction = payload.interaction ?? payload;
    const steps: any[] = interaction.steps ?? payload.steps ?? [];
    const text = steps.filter(s => s?.type === "model_output").map(s => extractText(s.content)).filter(Boolean).join("");
    const sources = steps.flatMap(s => Array.isArray(s?.content) ? s.content.flatMap((part: any) => (part?.annotations ?? []).map((a: any) => ({ url: a?.url, title: a?.title }))) : []);
    return { text, sources: dedupeSources(sources) };
  }

  // Classic generateContent. The generationConfig schema form does not accept
  // `additionalProperties`, and grounding does not accept responseSchema.
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      ...(grounding ? {} : { responseMimeType: "application/json", responseSchema: stripUnsupportedKeys(editorialJsonSchema()) }),
    },
    ...(grounding ? { tools: [{ googleSearch: {} }] } : {}),
  };
  const payload = await postGemini(`${base}/models/${encodeURIComponent(model)}:generateContent`, body, apiKey, fetchImpl);
  const candidate = payload.candidates?.[0];
  const text = candidate?.content?.parts?.map((part: { text?: string }) => part.text ?? "").join("").trim() ?? "";
  const sources = (candidate?.groundingMetadata?.groundingChunks ?? []).map((chunk: any) => ({ url: chunk?.web?.uri, title: chunk?.web?.title }));
  return { text, sources: dedupeSources(sources) };
}

/**
 * Self-correcting JSON pipeline: extract JSON from a possibly fenced/prose
 * response, validate against the editorial contract, and when invalid run one
 * bounded repair round that asks the model to return corrected JSON only.
 */
async function parseAndValidate(text: string, ctx: { input: AiContentGenerateInput; model: string; apiKey: string; warnings: string[]; attempts: string[]; transport?: Transport; base?: string; fetchImpl?: typeof fetch }): Promise<GeneratedContent> {
  const transport = ctx.transport ?? "generate-content";
  const direct = extractJsonObject(text);
  if (direct !== null) {
    const parsed = GeneratedContentSchema.safeParse(direct);
    if (parsed.success) return parsed.data;
  }
  // Repair round: no grounding, hard schema, focused correction request.
  ctx.attempts.push("The model returned imperfect JSON; ran a self-correction pass.");
  const repairPrompt = [
    "The following was supposed to be a JSON object matching this exact contract:",
    JSON.stringify(editorialJsonSchema()),
    "but it was invalid or incomplete. Return ONLY the corrected, complete JSON object.",
    "Keep all original content and language. Do not wrap it in markdown fences or commentary.",
    "Original response:",
    "<<<",
    text.slice(0, 40_000),
    ">>>",
  ].join("\n");
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: repairPrompt }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: stripUnsupportedKeys(editorialJsonSchema()), maxOutputTokens: MAX_OUTPUT_TOKENS },
  };
  const url = transport === "vertex-express"
    ? vertexModelUrl(ctx.model, "generateContent")
    : `${ctx.base ?? BASE}/models/${encodeURIComponent(ctx.model)}:generateContent`;
  const payload = await postGemini(url, body, ctx.apiKey, ctx.fetchImpl);
  const repaired = payload.candidates?.[0]?.content?.parts?.map((part: any) => part.text ?? "").join("").trim() ?? "";
  const repairedJson = extractJsonObject(repaired);
  if (repairedJson !== null) {
    const parsed = GeneratedContentSchema.safeParse(repairedJson);
    if (parsed.success) return parsed.data;
  }
  throw new HttpError(502, "gemini_invalid_content", "Gemini could not produce a valid bilingual post payload even after a self-correction pass", { fragment: text.slice(0, 400) });
}

async function postGemini(url: string, body: Record<string, unknown>, apiKey: string, fetchImpl?: typeof fetch): Promise<any> {
  const doFetch = fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    if (cause instanceof HttpError) throw cause;
    if (cause instanceof Error && cause.name === "TimeoutError") throw new HttpError(504, "gemini_timeout", "Gemini request timed out");
    throw new HttpError(502, "gemini_unreachable", "Could not reach Gemini");
  }
  const payload = await response.json().catch(() => ({})) as any;
  if (!response.ok) throw classifyGeminiHttpError(response.status, payload);
  return payload;
}

function classifyGeminiHttpError(status: number, payload: any): HttpError {
  const message = String(payload?.error?.message ?? "");
  const lower = message.toLowerCase();
  if (status === 429) return new HttpError(429, "gemini_rate_limited", message || "Gemini quota exceeded", { retryAfter: parseRetryAfter(payload) });
  if (status === 401 || status === 403) {
    // Vertex AI Express key is valid but the Vertex AI API is not enabled on its
    // project yet — surface the one-click enable URL so the operator can fix it.
    if (/has not been used in project .* before or it is disabled/i.test(message)) {
      const project = message.match(/project ([0-9]+)/i)?.[1];
      const enableUrl = `https://console.developers.google.com/apis/api/aiplatform.googleapis.com/overview?project=${project ?? ""}`;
      return new HttpError(403, "gemini_vertex_api_disabled", `The Vertex AI Express key works, but the Vertex AI (Agent Platform) API must be enabled for its Google Cloud project first. Open ${enableUrl} , enable the API, then retry.`, { enableUrl });
    }
    return new HttpError(status, "gemini_key_unauthorized", message || "Gemini rejected the API key");
  }
  if (isGeminiGeoBlockedMessage(lower)) {
    return new HttpError(503, "gemini_region_blocked", "Google's Gemini API does not serve this server's region. Add a Vertex AI Express API key (starts with \"AQ.\") to GEMINI_API_KEYS to route requests through Vertex AI, which is not region-blocked.");
  }
  if (status === 404) return new HttpError(404, "gemini_model_not_found", message || "Unknown Gemini model");
  if (status >= 500) return new HttpError(502, "gemini_unavailable", message || `Gemini request failed (${status})`);
  return new HttpError(502, "gemini_error", message || `Gemini request failed (${status})`, { status: payload?.error?.status });
}

function extractText(content: any): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter(p => p?.type === "text" || typeof p?.text === "string").map(p => String(p.text ?? "")).join("");
}

/**
 * Robust JSON extraction: handles fenced ```json blocks, leading/trailing
 * prose, and single-quoted/multi-object garbage by isolating the outermost
 * balanced object that contains the contract's first key.
 */
function extractJsonObject(text: string): unknown | null {
  if (!text) return null;
  let candidate = text.trim();
  // Strip markdown code fences.
  const fence = candidate.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) candidate = fence[1].trim();
  // Direct parse first.
  try { return JSON.parse(candidate); } catch { /* continue */ }
  // Outermost balanced braces scan.
  const start = candidate.indexOf("{");
  if (start === -1) return null;
  let depth = 0; let inString = false; let escaped = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { if (inString) escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const slice = candidate.slice(start, i + 1);
        try { return JSON.parse(slice); } catch { return null; }
      }
    }
  }
  return null;
}

function stripUnsupportedKeys(schema: Record<string, unknown>): Record<string, unknown> {
  // The classic generationConfig.responseSchema subset rejects JSON-Schema
  // keywords such as additionalProperties; drop them recursively.
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "additionalProperties" || key === "$schema" || key === "default") continue;
    if (Array.isArray(value)) out[key] = value.map(v => v && typeof v === "object" ? stripUnsupportedKeys(v) : v);
    else if (value && typeof value === "object") out[key] = stripUnsupportedKeys(value as Record<string, unknown>);
    else out[key] = value;
  }
  return out;
}

function dedupeSources(sources: Array<{ url?: unknown; title?: unknown }>): ContentSource[] {
  const seen = new Set<string>();
  const out: ContentSource[] = [];
  for (const source of sources) {
    const url = String(source?.url ?? "").trim();
    if (!url || !/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    out.push({ url, title: String(source?.title ?? "").trim() || url });
  }
  return out.slice(0, 12);
}

function isRateLimit(error: unknown): boolean {
  return error instanceof HttpError && (error.status === 429 || error.code === "gemini_rate_limited");
}
function isGeoBlocked(error: unknown): boolean {
  return error instanceof HttpError && (error.code === "gemini_region_blocked" || isGeminiGeoBlockedMessage(error.message));
}
function isAuthFailure(error: unknown): boolean {
  return error instanceof HttpError && (error.status === 401 || error.status === 403 || error.code === "gemini_key_unauthorized");
}
function isInteractionsUnavailable(error: unknown): boolean {
  if (!(error instanceof HttpError)) return false;
  return /not available in your current location|api is not available|interactions/i.test(error.message);
}
function isSchemaGroundingConflict(error: unknown): boolean {
  if (!(error instanceof HttpError)) return false;
  return /response_format|response_schema|tools.*schema|schema.*tools|grounded|cannot be used together|not supported/i.test(error.message);
}
function isRetryable(error: unknown): boolean {
  if (!(error instanceof HttpError)) return false;
  return error.status === 429 || error.status >= 500 || error.status === 504;
}
function retryAfterMs(error: unknown): number | null {
  if (!(error instanceof HttpError)) return null;
  const value = (error.details as any)?.retryAfter;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  return null;
}
function parseRetryAfter(payload: any): number | undefined {
  const value = payload?.error?.details?.find?.((d: any) =>d?.["retryDelay"] || d?.retryDelay)?.retryDelay;
  if (typeof value === "string") {
    const seconds = Number(value.replace(/[^0-9.]/g, ""));
    if (Number.isFinite(seconds)) return seconds;
  }
  return undefined;
}

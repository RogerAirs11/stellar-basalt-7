/**
 * Vertex AI Express transport (fallback) for Gemini requests.
 *
 * Why this exists: the classic Gemini API (generativelanguage.googleapis.com)
 * geo-blocks entire regions (HTTP 400 FAILED_PRECONDITION "User location is not
 * supported for the API use"). The sandboxed preview server can egress from such
 * a region, which bricks every AI feature even though the API keys are valid.
 * Vertex AI Express keys (format "AQ.…") authenticate against
 * aiplatform.googleapis.com instead, which is not subject to that regional
 * block — so when a Vertex-capable key is available we transparently retry the
 * turn through the Vertex generateContent surface.
 *
 * The Vertex request/response shape differs from the Interactions API:
 *   - contents[] with role user/model and parts (text / functionCall /
 *     functionResponse) instead of interaction steps
 *   - systemInstruction, tools.functionDeclarations, toolConfig
 *   - usageMetadata instead of total_input_tokens-style counters
 * Tool results are replayed as structured text (the application formats them as
 * authoritative data) because Vertex validates function-response pairing and we
 * do not retain the exact function-call turns on this path.
 */
import { AiRuntimeError } from "../../core/errors";
import type { AiProviderStreamEvent, AiToolCall, AiUsage, ProviderTurnInput } from "../../core/types";

export const VERTEX_EXPRESS_BASE = "https://aiplatform.googleapis.com/v1/publishers/google/models";

/** Vertex AI Express-mode API keys issued by Google start with "AQ.". */
export function isVertexExpressKey(key: string): boolean {
  return /^AQ\./i.test(String(key ?? "").trim());
}

/** Detect the classic Gemini API regional block from an error message. Both
 *  shapes seen in the wild: the classic-endpoint HTTP 400 ("User location is not
 *  supported for the API use") and the Interactions-API SSE error carried inside
 *  a 200 response ("This API is not available in your current location"). */
export function isGeminiGeoBlockedMessage(message: string): boolean {
  return /user location is not supported|location is not supported for the api|not available in your current location|not available in your country|available-regions\b|regional restriction/i.test(String(message ?? ""));
}

export function vertexModelUrl(model: string, method: "generateContent" | "streamGenerateContent" | "countTokens"): string {
  const suffix = method === "streamGenerateContent" ? "?alt=sse" : "";
  return `${VERTEX_EXPRESS_BASE}/${encodeURIComponent(model)}:${method}${suffix}`;
}

/** Map a Vertex HTTP failure onto the runtime error taxonomy. */
export async function vertexExpressError(response: Response): Promise<AiRuntimeError> {
  const text = await response.text().catch(() => "");
  const lower = text.toLowerCase();
  if (response.status === 403 && /has not been used in project .* before or it is disabled/i.test(text)) {
    const project = text.match(/project ([0-9]+)/i)?.[1];
    const enableUrl = project ? `https://console.developers.google.com/apis/api/aiplatform.googleapis.com/overview?project=${project}` : "https://console.developers.google.com/apis/api/aiplatform.googleapis.com/overview";
    return new AiRuntimeError("configuration", "gemini_vertex_api_disabled",
      `The Vertex AI Express key works, but the Vertex AI (Agent Platform) API must be enabled for its Google Cloud project first. Open ${enableUrl} , enable the API, then retry — one click, no billing setup for express-mode keys.`,
      "gemini", false, { status: response.status, enableUrl, body: text.slice(0, 600) });
  }
  if (response.status === 401 || response.status === 403) {
    return new AiRuntimeError("configuration", "gemini_key_unauthorized", `Vertex AI rejected the API key (${response.status})`, "gemini", false, { status: response.status, body: text.slice(0, 600) });
  }
  if (response.status === 429) {
    return new AiRuntimeError("rate_limit", "rate_or_quota", `Vertex AI request failed (429)`, "gemini", true, { status: response.status, body: text.slice(0, 600) });
  }
  if (isGeminiGeoBlockedMessage(text)) {
    return geoBlockedError();
  }
  if (response.status >= 500) {
    return new AiRuntimeError("unavailable", "provider_unavailable", `Vertex AI request failed (${response.status})`, "gemini", true, { status: response.status, body: text.slice(0, 600) });
  }
  return new AiRuntimeError("invalid_request", "provider_request", `Vertex AI request failed (${response.status})`, "gemini", false, { status: response.status, body: text.slice(0, 600) });
}

export function geoBlockedError(): AiRuntimeError {
  return new AiRuntimeError("configuration", "gemini_region_blocked",
    "Google's Gemini API does not serve this server's region. The deployment should route Gemini traffic through the Durable-Object relay (GEMINI_RELAY, deterministic US-East egress) or the GEMINI_BASE_URL gateway — run GET /api/ai/diagnostics to probe each transport.",
    "gemini", false, {});
}

/** Build the Vertex generateContent body from the provider-agnostic turn input. */
export function buildVertexGenerateBody(input: ProviderTurnInput): Record<string, unknown> {
  const contents: Array<Record<string, unknown>> = [];
  for (const turn of input.conversation ?? []) {
    const text = (turn.text ?? "").trim();
    if (!text) continue; // skip empty assistant turns emitted for tool-only rounds
    contents.push({ role: turn.role === "user" ? "user" : "model", parts: [{ text }] });
  }
  const imageNote = input.latestAttachments?.length
    ? `\n\n[The user attached ${input.latestAttachments.length} image(s); they cannot be forwarded through this transport.]`
    : "";
  if (input.toolResults?.length) {
    const results = input.toolResults.map(r => `• ${r.name} → ${typeof r.output === "string" ? r.output : JSON.stringify(r.output)}`).join("\n\n");
    contents.push({ role: "user", parts: [{ text: `[FUNCTION TOOL RESULTS — structured data returned by the Horse-DB application for this turn; treat as ground truth]\n${results}\n\nAnswer the user's request now using these results.` }] });
  } else if (input.latestUserText && !contents.some(c => c.role === "user" && String((c.parts as any[])[0]?.text ?? "").includes(input.latestUserText))) {
    contents.push({ role: "user", parts: [{ text: input.latestUserText + imageNote }] });
  } else if (imageNote && contents.length) {
    const last = contents[contents.length - 1] as unknown as { role?: string; parts: Array<{ text?: string }> };
    if (last.role === "user") last.parts[0] = { text: String(last.parts[0]?.text ?? "") + imageNote };
  }
  return {
    contents,
    systemInstruction: input.systemInstruction ? { parts: [{ text: input.systemInstruction }] } : undefined,
    tools: input.tools?.length ? [{ functionDeclarations: input.tools.map(t => ({ name: t.name, description: t.description, parameters: vertexToolParameters(t.parameters) })) }] : undefined,
    toolConfig: { functionCallingConfig: { mode: "AUTO" } },
    generationConfig: { maxOutputTokens: input.maxOutputTokens },
  };
}

/**
 * Vertex functionDeclarations accept an OpenAPI-3.0-style Schema subset, NOT raw
 * JSON Schema. Registry tool parameters are emitted as JSON Schema with oneOf
 * unions and constraints like const/exclusiveMinimum, so:
 *   1. merge oneOf object-variants into one object with per-property enums
 *      (same normalization the Interactions path applies),
 *   2. rewrite/drop keywords outside the accepted subset.
 */
const VERTEX_SCHEMA_KEEP = new Set(["type", "format", "description", "title", "nullable", "enum", "items", "properties", "required", "minimum", "maximum", "oneOf", "anyOf", "allOf"]);

export function vertexToolParameters(raw: Record<string, unknown>): Record<string, unknown> {
  return sanitizeVertexSchema(mergeOneOfVariants(raw as Record<string, any>)) as Record<string, unknown>;
}

function mergeOneOfVariants(schema: Record<string, any>): Record<string, any> {
  const variants: any[] = Array.isArray(schema.oneOf) ? schema.oneOf : [];
  if (!variants.length || !variants.every(v => v && typeof v === "object" && v.type === "object")) return schema;
  const properties: Record<string, any> = {};
  for (const variant of variants) {
    for (const [name, value] of Object.entries((variant.properties ?? {}) as Record<string, any>)) {
      const existing = properties[name];
      if (!existing) properties[name] = value;
      else if (existing.const !== undefined && value && typeof value === "object" && value.const !== undefined) properties[name] = { type: "string", enum: [existing.const, value.const] };
      else if (Array.isArray(existing.enum) && value && typeof value === "object" && Array.isArray(value.enum)) properties[name] = { type: existing.type ?? "string", enum: [...new Set([...existing.enum, ...value.enum])] };
    }
  }
  const required = variants.map(v => new Set(Array.isArray(v.required) ? v.required : [])).reduce((common, current) => new Set([...common].filter(name => current.has(name))));
  return { type: "object", properties, ...(required.size ? { required: [...required] } : {}) };
}

function sanitizeVertexSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitizeVertexSchema);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === "const") { out.enum = [value]; continue; }
    if (key === "exclusiveMinimum") { out.minimum = value; continue; } // inclusive approximation
    if (key === "exclusiveMaximum") { out.maximum = value; continue; }
    if (!VERTEX_SCHEMA_KEEP.has(key)) continue; // drop default/additionalProperties/$schema/minLength/…
    out[key] = sanitizeVertexSchema(value);
  }
  return out;
}

export function parseVertexPayload(payload: any): { text: string; toolCalls: AiToolCall[]; usage: AiUsage; finishReason: string | null } {
  const candidate = payload?.candidates?.[0];
  const parts: any[] = candidate?.content?.parts ?? [];
  let text = "";
  const toolCalls: AiToolCall[] = [];
  for (const part of parts) {
    if (typeof part?.text === "string") text += part.text;
    if (part?.functionCall && typeof part.functionCall.name === "string") {
      toolCalls.push({ id: `vertex-${crypto.randomUUID()}`, name: part.functionCall.name, arguments: part.functionCall.args ?? {} });
    }
  }
  return { text, toolCalls, usage: normalizeVertexUsage(payload?.usageMetadata), finishReason: candidate?.finishReason ?? null };
}

export function normalizeVertexUsage(u: any): AiUsage {
  return {
    inputTokens: Number(u?.promptTokenCount ?? 0),
    outputTokens: Number(u?.candidatesTokenCount ?? 0),
    thoughtTokens: Number(u?.thoughtsTokenCount ?? 0),
    cachedTokens: Number(u?.cachedContentTokenCount ?? 0),
    toolTokens: 0,
    totalTokens: Number(u?.totalTokenCount ?? 0),
  };
}

/** Non-streaming Vertex generateContent round-trip used by the provider fallback. */
export async function vertexExpressRequest(
  apiKey: string,
  input: ProviderTurnInput,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<{ text: string; toolCalls: AiToolCall[]; usage: AiUsage; finishReason: string | null }> {
  let response: Response;
  try {
    response = await fetchImpl(vertexModelUrl(input.model, "generateContent"), {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(buildVertexGenerateBody(input)),
      signal,
    });
  } catch (error) {
    if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
    throw new AiRuntimeError("unavailable", "provider_network", "Could not reach Vertex AI", "gemini", true, { cause: error instanceof Error ? error.message : String(error) });
  }
  if (!response.ok) throw await vertexExpressError(response);
  const payload: any = await response.json().catch(() => ({}));
  return parseVertexPayload(payload);
}

/** Streaming Vertex generateContent (SSE) yielding provider-agnostic events. */
export async function* vertexExpressStream(
  apiKey: string,
  input: ProviderTurnInput,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): AsyncGenerator<AiProviderStreamEvent> {
  let response: Response;
  try {
    response = await fetchImpl(vertexModelUrl(input.model, "streamGenerateContent"), {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(buildVertexGenerateBody(input)),
      signal,
    });
  } catch (error) {
    if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
    throw new AiRuntimeError("unavailable", "provider_network", "Could not reach Vertex AI", "gemini", true, { cause: error instanceof Error ? error.message : String(error) });
  }
  if (!response.ok) throw await vertexExpressError(response);
  if (!response.body) throw new AiRuntimeError("unavailable", "provider_stream", "Vertex AI stream was interrupted", "gemini", true, {});

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let usage: AiUsage | null = null;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index: number;
      while ((index = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        let chunk: any;
        try { chunk = JSON.parse(data); } catch { continue; }
        if (chunk.usageMetadata) usage = normalizeVertexUsage(chunk.usageMetadata);
        const parsed = parseVertexPayload(chunk);
        if (parsed.text && !text.endsWith(parsed.text)) {
          text += parsed.text;
          yield { type: "text_delta", text: parsed.text };
        }
        for (const call of parsed.toolCalls) yield { type: "tool_call", call };
      }
    }
  } catch (error) {
    if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
    throw new AiRuntimeError("unavailable", "provider_stream", "Vertex AI stream was interrupted", "gemini", true, { cause: error instanceof Error ? error.message : String(error) });
  } finally {
    try { await reader.cancel(); } catch { /* already closed */ }
  }
  const output = {
    provider: "gemini" as const,
    model: input.model,
    text,
    toolCalls: [] as AiToolCall[],
    usage: usage ?? { inputTokens: 0, outputTokens: 0, thoughtTokens: 0, cachedTokens: 0, toolTokens: 0, totalTokens: 0 },
    interactionId: null,
    providerState: null,
    finishReason: null as string | null,
  };
  yield { type: "done", output };
}

/** Vertex countTokens fallback so context accounting keeps working when the
 * classic endpoint is geo-blocked. Body shape: {contents:[{parts:[{text}]}]}. */
export async function vertexExpressCountTokens(
  apiKey: string,
  model: string,
  body: { contents: Array<{ role: string; parts: Array<{ text: string }> }> },
  fetchImpl: typeof fetch,
): Promise<number> {
  let response: Response;
  try {
    response = await fetchImpl(vertexModelUrl(model, "countTokens"), {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new AiRuntimeError("unavailable", "provider_network", "Could not reach the Vertex AI token counter", "gemini", true, { cause: error instanceof Error ? error.message : String(error) });
  }
  if (!response.ok) throw await vertexExpressError(response);
  const json: any = await response.json().catch(() => ({}));
  return Number(json.totalTokens ?? 0);
}

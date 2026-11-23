import { AiRuntimeError } from "../../core/errors";
import { modelCapabilities } from "../../core/modelCatalog";
import type { AiProvider } from "../../core/provider";
import type { AiImageReference, AiProviderStreamEvent, AiToolCall, AiUsage, ProviderConversationTurn, ProviderTurnInput, ProviderTurnOutput } from "../../core/types";
import { parseSse } from "../sse";

const ENDPOINT = "https://api.deepseek.com/chat/completions";
interface DsAssistantState { role: "assistant"; content: string | null; reasoning_content?: string | null; tool_calls?: any[] }
interface DsState { messages: any[]; systemInstruction?: string }

export class DeepSeekProvider implements AiProvider {
  readonly id = "deepseek" as const;
  constructor(private readonly apiKey: string, private readonly visionEnabled: boolean, private readonly fetchImpl: typeof fetch = fetch) {}
  capabilities(model: string) { const c = modelCapabilities("deepseek", model); return { ...c, supportsVision: c.supportsVision && this.visionEnabled }; }
  async createTurn(input: ProviderTurnInput) { return this.request(input); }
  async continueTurn(input: ProviderTurnInput) { return this.request(input); }

  async *streamTurn(input: ProviderTurnInput): AsyncIterable<AiProviderStreamEvent> {
    const { body, baseMessages } = buildBody(input, true, this.visionEnabled);
    let r: Response;
    try { r = await this.fetchImpl(ENDPOINT, { method: "POST", headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" }, body: JSON.stringify(body), signal: input.abortSignal }); }
    catch (error) {
      if (input.abortSignal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
      throw new AiRuntimeError("unavailable", "provider_network", "Could not reach DeepSeek", "deepseek", true, { cause: error instanceof Error ? error.message : String(error) });
    }
    if (!r.ok) throw await deepseekError(r);
    let content = "";
    let reasoning = "";
    let finishReason: string | null = null;
    let usage: AiUsage | null = null;
    let terminalReceived = false;
    const toolParts = new Map<number, { id: string; name: string; args: string }>();
    try {
      for await (const evt of parseSse(r)) {
        if (evt.data === "[DONE]") { terminalReceived = true; break; }
        let obj: Record<string, any>;
        try { obj = checkedObject(JSON.parse(evt.data)); }
        catch { throw protocolError("provider_stream_json", "DeepSeek returned an invalid stream event"); }
        if (obj.error) throw protocolError("provider_stream_error", "DeepSeek reported an error during its response");
        if (!Array.isArray(obj.choices)) throw protocolError("provider_stream_shape", "DeepSeek returned an unexpected stream event");
        const choice = obj.choices[0];
        const delta = choice?.delta ?? {};
        if (typeof delta.reasoning_content === "string") reasoning += delta.reasoning_content;
        if (typeof delta.content === "string" && delta.content) {
          if (finishReason !== null) throw protocolError("provider_stream_order", "DeepSeek sent content after completion");
          content += delta.content;
          yield { type: "text_delta", text: delta.content };
        }
        if (delta.tool_calls !== undefined && !Array.isArray(delta.tool_calls)) throw protocolError("provider_tool_shape", "DeepSeek returned invalid tool calls");
        for (const part of delta.tool_calls ?? []) {
          const idx = part.index;
          if (!Number.isSafeInteger(idx) || idx < 0 || idx >= 128) throw protocolError("provider_tool_index", "DeepSeek returned an invalid tool index");
          const cur = toolParts.get(idx) ?? { id: String(part.id ?? `call_${idx}`), name: "", args: "" };
          if (part.id) cur.id = String(part.id);
          if (part.function?.name) cur.name = String(part.function.name);
          if (part.function?.arguments) cur.args += String(part.function.arguments);
          toolParts.set(idx, cur);
          yield { type: "tool_call_delta", callId: cur.id, name: cur.name || undefined, argumentsDelta: String(part.function?.arguments ?? "") };
        }
        if (choice?.finish_reason !== null && choice?.finish_reason !== undefined) finishReason = String(choice.finish_reason);
        if (obj.usage !== null && obj.usage !== undefined) {
          usage = normalizeUsage(obj.usage);
          yield { type: "usage", usage };
        }
      }
    } catch (error) {
      if (input.abortSignal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
      if (error instanceof AiRuntimeError) throw error;
      throw new AiRuntimeError("unavailable", "provider_stream", "DeepSeek stream was interrupted", "deepseek", true);
    }
    if (!terminalReceived || !usage) throw protocolError("provider_stream_incomplete", "DeepSeek did not complete its response and usage accounting");
    assertFinishReason(finishReason);
    const calls = [...toolParts.values()].map(p => ({ id: p.id, name: p.name, arguments: safeJson(p.args) }));
    for (const call of calls) yield { type: "tool_call", call };
    const assistant: DsAssistantState = { role: "assistant", content: content || null, ...(reasoning ? { reasoning_content: reasoning } : {}), ...(calls.length ? { tool_calls: calls.map(c => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.arguments) } })) } : {}) };
    const state: DsState = { messages: [...baseMessages, assistant], systemInstruction: input.systemInstruction };
    const output: ProviderTurnOutput = { provider: "deepseek", model: input.model, text: content, toolCalls: calls, usage, providerState: state, finishReason };
    yield { type: "provider_state", providerState: state };
    yield { type: "done", output };
  }

  private async request(input: ProviderTurnInput): Promise<ProviderTurnOutput> {
    const { body, baseMessages } = buildBody(input, false, this.visionEnabled);
    let r: Response;
    try { r = await this.fetchImpl(ENDPOINT, { method: "POST", headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" }, body: JSON.stringify(body), signal: input.abortSignal }); }
    catch (error) {
      if (input.abortSignal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
      throw new AiRuntimeError("unavailable", "provider_network", "Could not reach DeepSeek", "deepseek", true, { cause: error instanceof Error ? error.message : String(error) });
    }
    if (!r.ok) throw await deepseekError(r);
    let json: Record<string, any>;
    try { json = checkedObject(await r.json()); }
    catch { throw protocolError("provider_response_json", "DeepSeek returned invalid response data"); }
    if (json.error || !Array.isArray(json.choices) || !json.choices[0]?.message) {
      throw protocolError("provider_response_shape", "DeepSeek returned an incomplete response");
    }
    const choice = json.choices[0];
    assertFinishReason(choice.finish_reason);
    const m = checkedObject(choice.message);
    if (m.content !== null && m.content !== undefined && typeof m.content !== "string") throw protocolError("provider_response_shape", "DeepSeek returned invalid answer text");
    if (m.tool_calls !== undefined && !Array.isArray(m.tool_calls)) throw protocolError("provider_tool_shape", "DeepSeek returned invalid tool calls");
    const calls: AiToolCall[] = (m.tool_calls ?? []).map((c: any) => ({ id: String(c.id), name: String(c.function?.name ?? ""), arguments: safeJson(String(c.function?.arguments ?? "{}")) }));
    const usage = normalizeUsage(json.usage);
    const assistant: DsAssistantState = { role: "assistant", content: m.content ?? null, ...(m.reasoning_content ? { reasoning_content: m.reasoning_content } : {}), ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}) };
    return { provider: "deepseek", model: input.model, text: String(m.content ?? ""), toolCalls: calls, usage, providerState: { messages: [...baseMessages, assistant], systemInstruction: input.systemInstruction }, finishReason: choice.finish_reason };

  }
}

function buildBody(input: ProviderTurnInput, stream: boolean, visionEnabled: boolean): { body: any; baseMessages: any[] } {
  const state = (input.providerState && typeof input.providerState === "object" ? input.providerState : null) as DsState | null;
  let messages: any[];
  // DeepSeek cache hits are prefix-sensitive. Reuse the preserved provider history
  // only when its immutable root system instruction is identical. If policy changes
  // across a deployment, rebuild once rather than silently keeping stale policy.
  if (state?.messages?.length && (!state.systemInstruction || state.systemInstruction === input.systemInstruction)) messages = state.messages.map(m => ({ ...m }));
  else messages = rebuildMessages(input.conversation, input.systemInstruction, visionEnabled);
  if (!messages.length || messages[0]?.role !== "system") messages.unshift({ role: "system", content: input.systemInstruction });
  else if (messages[0].content !== input.systemInstruction) messages = rebuildMessages(input.conversation, input.systemInstruction, visionEnabled);

  if (input.toolResults?.length) for (const result of input.toolResults) messages.push({ role: "tool", tool_call_id: result.callId, content: typeof result.output === "string" ? result.output : JSON.stringify(result.output) });
  else {
    const last = messages.at(-1); if (last?.role !== "user" || textOf(last.content) !== input.latestUserText) messages.push(userMessage(input.latestUserText, input.latestAttachments, visionEnabled));
  }
  const thinking = input.thinkingLevel !== "off";
  const body: any = {
    model: input.model, messages, stream,
    ...(input.responseFormat ? { response_format: { type: input.responseFormat } } : {}),
    ...(stream ? { stream_options: { include_usage: true } } : {}),
    tools: input.tools.map(t => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })),
    tool_choice: input.toolChoice === "none" ? "none" : "auto",
    max_tokens: input.maxOutputTokens,
    thinking: { type: thinking ? "enabled" : "disabled" },
    ...(thinking ? { reasoning_effort: mapEffort(input.thinkingLevel) } : {}),
    ...(input.userId ? { user_id: input.userId } : {}),
  };
  return { body, baseMessages: messages };
}
function rebuildMessages(turns: ProviderConversationTurn[], system: string, visionEnabled: boolean): any[] { return [{ role: "system", content: system }, ...turns.map(t => t.role === "user" ? userMessage(t.text, t.attachments, visionEnabled) : ({ role: "assistant", content: t.text }))]; }
function userMessage(text: string, attachments: AiImageReference[] | undefined, visionEnabled: boolean): any { if (!attachments?.length || !visionEnabled) return { role: "user", content: text }; return { role: "user", content: [{ type: "text", text }, ...attachments.map(a => ({ type: "image_url", image_url: { url: a.url, detail: "auto" } }))] }; }
function textOf(content: any): string { if (typeof content === "string") return content; if (Array.isArray(content)) return content.filter(p => p?.type === "text").map(p => p.text ?? "").join(""); return ""; }
function mapEffort(level: string): "low"|"high"|"max" { return level === "minimal" || level === "low" ? "low" : level === "max" ? "max" : "high"; }
function protocolError(code: string, message: string): AiRuntimeError {
  // Usage uncertainty retains the worst-case cost reservation. Automatic paid
  // retry would risk charging twice for a response that was already generated.
  return new AiRuntimeError("protocol", code, message, "deepseek", false);
}

function checkedObject(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw protocolError("provider_response_shape", "DeepSeek returned invalid response data");
  return value as Record<string, any>;
}

function assertFinishReason(reason: unknown): asserts reason is string {
  if (reason === "stop" || reason === "tool_calls") return;
  if (reason === "length") throw protocolError("provider_output_truncated", "DeepSeek reached its output limit before completing the answer");
  throw protocolError("provider_response_incomplete", "DeepSeek did not finish the requested response");
}

function tokenCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw protocolError("provider_usage_invalid", "DeepSeek returned incomplete or invalid usage accounting");
  return value;
}

function normalizeUsage(value: unknown): AiUsage {
  const u = checkedObject(value);
  const p = u.prompt_tokens_details ?? {};
  const c = u.completion_tokens_details ?? {};
  const inputTokens = tokenCount(u.prompt_tokens);
  const outputTokens = tokenCount(u.completion_tokens);
  const thoughtTokens = tokenCount(c.reasoning_tokens ?? 0);
  const cacheHitTokens = tokenCount(p.cached_tokens ?? p.prompt_cache_hit_tokens ?? u.prompt_cache_hit_tokens ?? 0);
  const cacheMissTokens = tokenCount(p.prompt_cache_miss_tokens ?? u.prompt_cache_miss_tokens ?? (inputTokens - cacheHitTokens));
  const totalTokens = tokenCount(u.total_tokens ?? (inputTokens + outputTokens));
  if (cacheHitTokens + cacheMissTokens !== inputTokens || thoughtTokens > outputTokens || totalTokens !== inputTokens + outputTokens) {
    throw protocolError("provider_usage_inconsistent", "DeepSeek returned inconsistent usage accounting");
  }
  return { inputTokens, outputTokens, thoughtTokens, cachedTokens: cacheHitTokens, toolTokens: 0, totalTokens, cacheHitTokens, cacheMissTokens };
}
function safeJson(s: string): unknown { try { return JSON.parse(s || "{}"); } catch { return { __invalid_json: s }; } }
async function deepseekError(r: Response): Promise<AiRuntimeError> { const text = await r.text(); const kind = r.status === 429 ? "quota" : r.status >= 500 ? "unavailable" : "invalid_request"; return new AiRuntimeError(kind, r.status === 429 ? "rate_or_quota" : "provider_request", `DeepSeek request failed (${r.status})`, "deepseek", r.status >= 500 || r.status === 429, { status:r.status, body:text.slice(0,1000) }); }

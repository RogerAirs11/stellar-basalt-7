import { HttpError } from "../api/http";
import { AiRuntimeError, isAbortError } from "../ai/core/errors";
import type { ProviderTurnInput, ProviderTurnOutput } from "../ai/core/types";
import { DeepSeekProvider } from "../ai/providers/deepseek/client";
import { loadAiConfig, geminiQuotaForModel, resolveAiStateDatabase } from "../ai/runtime/config";
import { reserveGeminiAttempt } from "../ai/runtime/quotaGovernor";
import { estimateDeepSeekWorstCase, estimateDeepSeekBilledCost } from "../ai/runtime/costGovernor";
import { recordRequestAttempt, completeRequestLedger, reserveProviderCost, reconcileProviderEstimatedCost } from "../ai/conversation/repository";

/** No upstream response body, key, prompt, or driver cause crosses this boundary. */
export function contentAccountingError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  if (error instanceof AiRuntimeError) {
    const status = error.category === "quota" || error.category === "rate_limit" || error.category === "cost_limit" ? 429
      : error.category === "configuration" || error.category === "storage" ? 503 : 502;
    return new HttpError(status, error.code, error.message);
  }
  return new HttpError(503, "editorial_accounting_unavailable", "Editorial AI usage cannot be verified safely; try again after storage recovers");
}

/**
 * Every Gemini editorial network attempt (including repair, model and transport
 * retries) uses the same authority ledger as chat. Conservative UTF-8 byte counts
 * deliberately avoid assuming English token ratios for Persian/schema payloads.
 * Accounting completion describes HTTP delivery, not editorial validation or publication.
 */
export function accountedGeminiEditorialFetch(env: Env, underlying: typeof fetch = fetch): typeof fetch {
  const database = resolveAiStateDatabase(env);
  const config = loadAiConfig(env);
  return async (request, init) => {
    if (typeof init?.body !== "string" || init.body.length > 262_144) {
      throw new HttpError(400, "editorial_request_unaccountable", "Editorial request cannot be measured safely");
    }
    let model: string;
    try {
      const body: unknown = JSON.parse(init.body);
      const named = body && typeof body === "object" ? (body as Record<string, unknown>).model : null;
      const url = request instanceof Request ? request.url : String(request);
      model = typeof named === "string" ? named : decodeURIComponent(new URL(url).pathname.match(/\/models\/([^/:]+):generateContent$/)?.[1] ?? "");
    } catch { throw new HttpError(400, "editorial_request_unaccountable", "Editorial request cannot be measured safely"); }
    if (!(Object.hasOwn(config.gemini.quotasByModel, model))) throw new HttpError(400, "unsupported_gemini_model", "Editorial model has no configured quota authority");
    const id = crypto.randomUUID();
    const started = Date.now();
    try {
      await reserveGeminiAttempt(database, {
        id, conversationId: null, model, requestKind: "editorial",
        estimatedInputTokens: Math.max(512, new TextEncoder().encode(init.body).byteLength),
        quota: geminiQuotaForModel(config.gemini, model),
      });
    } catch (error) { throw contentAccountingError(error); }
    let response: Response;
    try { response = await underlying(request, init); }
    catch (error) {
      await completeRequestLedger(database, { id, status: isAbortError(error) ? "cancelled" : "failed", errorCode: "editorial_transport", latencyMs: Date.now() - started }).catch(() => undefined);
      throw error;
    }
    // The reservation remains counted even if completion storage is unavailable.
    // No usage fields are invented; the conservative input estimate remains in force.
    await completeRequestLedger(database, { id, status: response.ok ? "success" : "failed", errorCode: response.ok ? null : `provider_http_${response.status}`, latencyMs: Date.now() - started }).catch(() => undefined);
    return response;
  };
}

/** Reuse the canonical paid protocol and conservative reservation, never a second raw HTTP implementation. */
export async function runPaidEditorialTurn(env: Env, input: ProviderTurnInput): Promise<ProviderTurnOutput> {
  const config = loadAiConfig(env);
  if (!config.deepseek.apiKey) throw new HttpError(503, "deepseek_not_configured", "DeepSeek API key is not configured");
  const database = resolveAiStateDatabase(env);
  const id = crypto.randomUUID();
  const started = Date.now();
  // The payload contains bounded editorial text only. UTF-8 bytes plus the existing
  // safety multiplier reserve more conservatively than a language-dependent ratio.
  const estimate = Math.ceil(Math.max(512, new TextEncoder().encode(JSON.stringify({ system: input.systemInstruction, conversation: input.conversation })).byteLength) * config.deepseek.inputEstimateSafetyMultiplier);
  const cost = estimateDeepSeekWorstCase(estimate, input.maxOutputTokens, config.deepseek.price);
  if (!cost.allowed) throw new HttpError(429, "deepseek_request_cost", "Editorial generation exceeds the configured zero-cache request budget");
  let reservationId: string;
  try {
    await recordRequestAttempt(database, { id, conversationId: null, provider: "deepseek", model: input.model, requestKind: "editorial", estimatedInputTokens: estimate, estimatedCostUsd: cost.worstCaseTotalCostUsd });
    reservationId = (await reserveProviderCost(database, id, "deepseek", cost.worstCaseTotalCostUsd, config.deepseek.price.dailyWorstCaseUsd)).reservationId;
  } catch (error) { throw contentAccountingError(error); }
  try {
    const output = await new DeepSeekProvider(config.deepseek.apiKey, false).createTurn(input);
    const billed = estimateDeepSeekBilledCost(output.usage, config.deepseek.price);
    await completeRequestLedger(database, { id, status: "success", usage: output.usage, estimatedBilledCostUsd: billed, latencyMs: Date.now() - started });
    await reconcileProviderEstimatedCost(database, reservationId, billed);
    return output;
  } catch (error) {
    await completeRequestLedger(database, { id, status: isAbortError(error) ? "cancelled" : "failed", errorCode: error instanceof AiRuntimeError ? error.code : "editorial_provider", latencyMs: Date.now() - started }).catch(() => undefined);
    // Unknown/aborted/malformed paid output may already have incurred a charge.
    // Keep the worst-case reservation; do not automatically retry or refund it.
    throw contentAccountingError(error);
  }
}

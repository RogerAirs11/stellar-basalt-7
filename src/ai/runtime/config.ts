import { DEEPSEEK_FLASH, GEMINI_25_FLASH, GEMINI_25_FLASH_LITE, GEMINI_FLASH, GEMINI_FLASH_LITE, GEMINI_EDITORIAL_FLASH } from "../core/modelCatalog";
import { GEMINI_RELAY_BASE, geminiRelayActive, makeGeminiRelayFetch } from "../providers/gemini/relay";
import { isVertexExpressKey } from "../providers/gemini/vertexExpress";
import type { AiExecutionMode, AiProviderId } from "../core/types";

export interface GeminiQuotaConfig {
  rpmLimit: number | null;
  inputTpmLimit: number | null;
  rpdLimit: number | null;
  reserveFraction: number;
}
export type GeminiModelId = typeof GEMINI_25_FLASH | typeof GEMINI_25_FLASH_LITE | typeof GEMINI_FLASH_LITE | typeof GEMINI_FLASH | typeof GEMINI_EDITORIAL_FLASH;

export interface DeepSeekPriceConfig {
  cacheHitInputPerMillionUsd: number;
  cacheMissInputPerMillionUsd: number;
  outputPerMillionUsd: number;
  perRequestWorstCaseUsd: number;
  dailyWorstCaseUsd: number;
}

export interface AiRuntimeConfig {
  enabled: boolean;
  /** Deterministic local provider for sandbox testing (AI_OFFLINE_SANDBOX=1). */
  offline: {
    enabled: boolean;
    /** Bounded canonical tools, only for the explicitly isolated synthetic demo. */
    registryResearch?: boolean;
  };
  gemini: {
    enabled: boolean;
    apiKey: string | null;
    /** All environment-provided keys (GEMINI_API_KEY + GEMINI_API_KEYS); ring rotation order. */
    apiKeys: string[];
    /** Base-URL override for the classic Gemini API (GEMINI_BASE_URL) — e.g. a
     *  Cloudflare AI Gateway whose egress region is not geo-blocked by Google.
     *  Overridden by the Durable-Object relay whenever that binding is active. */
    baseUrl: string | null;
    /** Durable-Object relay (deterministic US-East egress for Google's
     *  IP-region block). `fetchImpl` routes relay-origin URLs through the DO. */
    relay: {
      active: boolean;
      fetchImpl: ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) | null;
    };
    /** Vertex AI Express ("AQ.") keys participate only when explicitly enabled
     *  by the operator (AI_VERTEX_EXPRESS_ENABLED=1). Off by default because the
     *  owner declines to enable the Agent Platform API those keys depend on. */
    vertexExpressEnabled: boolean;
    defaultModel: typeof GEMINI_25_FLASH;
    strongerModel: typeof GEMINI_FLASH;
    /** Default-model quota retained for diagnostics/backward compatibility. */
    quota: GeminiQuotaConfig;
    quotasByModel: Record<GeminiModelId, GeminiQuotaConfig>;
    webGroundingEnabled: boolean;
    /** Optional operator ceiling for exact opaque Gemini replay; runtime headroom can lower it further. */
    replayMaxTokens: number | null;
    /** Use authoritative countTokens only when local estimates approach this fraction of the safe input budget. */
    authoritativeCountThresholdFraction: number;
    /** Maximum bounded delay before one transient Gemini 429 retry. */
    transient429RetryMaxMs: number;
  };
  deepseek: {
    enabled: boolean;
    apiKey: string | null;
    model: typeof DEEPSEEK_FLASH;
    visionEnabled: boolean;
    price: DeepSeekPriceConfig;
    /** Conservative multiplier applied to estimated input tokens before paid-cost preflight. */
    inputEstimateSafetyMultiplier: number;
  };
  contextSafetyFraction: number;
  outputTokens: Record<AiExecutionMode, number>;
  maxToolCalls: Record<AiExecutionMode, number>;
  maxToolRounds: Record<AiExecutionMode, number>;
}

/**
 * Free-tier safety defaults researched 2026-09-16.
 * Google now directs operators to AI Studio for the active project/model limits and
 * explicitly says specified limits are not guaranteed. These defaults therefore use
 * conservative recent no-billing observations and remain fully overrideable.
 * The reserve fraction is applied again by quotaGovernor before a provider attempt.
 */
export const GEMINI_RESEARCHED_FREE_QUOTA_DEFAULTS: Readonly<Record<GeminiModelId, Omit<GeminiQuotaConfig,"reserveFraction">>> = {
  // R109: no provider quota is inferred for the independently advertised editorial model.
  [GEMINI_EDITORIAL_FLASH]: { rpmLimit: null, inputTpmLimit: null, rpdLimit: null },
  // R56: 2.5-generation quotas (mature, widely documented free-tier limits).
  [GEMINI_25_FLASH]: { rpmLimit: 10, inputTpmLimit: 250_000, rpdLimit: 250 },
  [GEMINI_25_FLASH_LITE]: { rpmLimit: 15, inputTpmLimit: 250_000, rpdLimit: 1_000 },
  // 3.5-generation quotas (2026-09-16 research — tight RPD pools, congested queue).
  [GEMINI_FLASH_LITE]: { rpmLimit: 15, inputTpmLimit: 250_000, rpdLimit: 500 },
  [GEMINI_FLASH]: { rpmLimit: 5, inputTpmLimit: 1_000_000, rpdLimit: 20 },
};

export function loadAiConfig(env: Env): AiRuntimeConfig {
  const enabled = env.AI_ASSISTANT_ENABLED === "1";
  const geminiKeys = geminiEnvKeys(env);
  const geminiKey = geminiKeys[0] ?? null;
  const reserveFraction = fraction(env.AI_GEMINI_RESERVE_FRACTION, 0.12);
  const vertexExpressEnabled = env.AI_VERTEX_EXPRESS_ENABLED === "1";
  const relayActive = geminiRelayActive(env);
  const legacy = {
    rpmLimit: positiveInteger(env.AI_GEMINI_RPM_LIMIT),
    inputTpmLimit: positiveInteger(env.AI_GEMINI_INPUT_TPM_LIMIT),
    rpdLimit: positiveInteger(env.AI_GEMINI_RPD_LIMIT),
  };
  const quotasByModel: Record<GeminiModelId, GeminiQuotaConfig> = {
    // Explicit account-approved editorial quota. Empty values keep this path
    // disabled rather than borrowing another model's advertised/free limits.
    [GEMINI_EDITORIAL_FLASH]: {
      rpmLimit: positiveInteger(env.AI_GEMINI_38_FLASH_RPM_LIMIT),
      inputTpmLimit: positiveInteger(env.AI_GEMINI_38_FLASH_INPUT_TPM_LIMIT),
      rpdLimit: positiveInteger(env.AI_GEMINI_38_FLASH_RPD_LIMIT), reserveFraction,
    },
    [GEMINI_25_FLASH]: quotaProfile({
      rpm: env.AI_GEMINI_25_FLASH_RPM_LIMIT,
      tpm: env.AI_GEMINI_25_FLASH_INPUT_TPM_LIMIT,
      rpd: env.AI_GEMINI_25_FLASH_RPD_LIMIT,
    }, legacy, GEMINI_RESEARCHED_FREE_QUOTA_DEFAULTS[GEMINI_25_FLASH], reserveFraction),
    [GEMINI_25_FLASH_LITE]: quotaProfile({
      rpm: env.AI_GEMINI_25_FLASH_LITE_RPM_LIMIT,
      tpm: env.AI_GEMINI_25_FLASH_LITE_INPUT_TPM_LIMIT,
      rpd: env.AI_GEMINI_25_FLASH_LITE_RPD_LIMIT,
    }, legacy, GEMINI_RESEARCHED_FREE_QUOTA_DEFAULTS[GEMINI_25_FLASH_LITE], reserveFraction),
    [GEMINI_FLASH_LITE]: quotaProfile({
      rpm: env.AI_GEMINI_FLASH_LITE_RPM_LIMIT,
      tpm: env.AI_GEMINI_FLASH_LITE_INPUT_TPM_LIMIT,
      rpd: env.AI_GEMINI_FLASH_LITE_RPD_LIMIT,
    }, legacy, GEMINI_RESEARCHED_FREE_QUOTA_DEFAULTS[GEMINI_FLASH_LITE], reserveFraction),
    [GEMINI_FLASH]: quotaProfile({
      rpm: env.AI_GEMINI_FLASH_RPM_LIMIT,
      tpm: env.AI_GEMINI_FLASH_INPUT_TPM_LIMIT,
      rpd: env.AI_GEMINI_FLASH_RPD_LIMIT,
    }, legacy, GEMINI_RESEARCHED_FREE_QUOTA_DEFAULTS[GEMINI_FLASH], reserveFraction),
  };
  const geminiQuota = quotasByModel[GEMINI_25_FLASH];
  const geminiEnabled = enabled && env.AI_GEMINI_ENABLED !== "0" && geminiKeys.length > 0;
  const deepseekKey = clean(env.DEEPSEEK_API_KEY);
  const deepseekEnabled = enabled && env.AI_DEEPSEEK_ENABLED === "1" && Boolean(deepseekKey);

  return {
    enabled,
    offline: {
      // Sandbox-only escape hatch: when the runtime region cannot reach Gemini
      // (geo-block) and Vertex Express is not enabled, this local deterministic
      // provider keeps the assistant fully testable. Never set in production.
      enabled: enabled && env.AI_OFFLINE_SANDBOX === "1",
      registryResearch: enabled && env.AI_OFFLINE_SANDBOX === "1" && env.AI_DEMO_REGISTRY_RESEARCH === "1"
        && env.APP_ENV === "local" && env.ISOLATED_DEMO_MODE === "1" && env.REGISTRY_DATASET_KIND === "synthetic",
    },
    gemini: {
      enabled: geminiEnabled,
      apiKey: geminiKey,
      apiKeys: geminiKeys,
      baseUrl: relayActive ? GEMINI_RELAY_BASE : clean(env.GEMINI_BASE_URL),
      relay: {
        active: relayActive,
        fetchImpl: relayActive && env.GEMINI_RELAY ? makeGeminiRelayFetch(env.GEMINI_RELAY) : null,
      },
      vertexExpressEnabled,
      defaultModel: GEMINI_25_FLASH,
      strongerModel: GEMINI_FLASH,
      quota: geminiQuota,
      quotasByModel,
      webGroundingEnabled: env.AI_GEMINI_WEB_GROUNDING_ENABLED === "1",
      replayMaxTokens: positiveInteger(env.AI_GEMINI_REPLAY_MAX_TOKENS),
      authoritativeCountThresholdFraction: fractionRange(env.AI_GEMINI_COUNT_TOKENS_THRESHOLD_FRACTION, 0.72, 0.5, 0.95),
      transient429RetryMaxMs: boundedInteger(env.AI_GEMINI_TRANSIENT_429_RETRY_MAX_MS, 3000, 250, 10_000),
    },
    deepseek: {
      enabled: deepseekEnabled,
      apiKey: deepseekKey,
      model: DEEPSEEK_FLASH,
      visionEnabled: deepseekEnabled && env.AI_DEEPSEEK_VISION_ENABLED === "1",
      price: {
        cacheHitInputPerMillionUsd: nonNegativeNumber(env.AI_DEEPSEEK_CACHE_HIT_PER_MILLION_USD, 0.006),
        cacheMissInputPerMillionUsd: nonNegativeNumber(env.AI_DEEPSEEK_CACHE_MISS_PER_MILLION_USD, 0.30),
        outputPerMillionUsd: nonNegativeNumber(env.AI_DEEPSEEK_OUTPUT_PER_MILLION_USD, 1.20),
        perRequestWorstCaseUsd: positiveNumber(env.AI_DEEPSEEK_MAX_REQUEST_USD, 0.05),
        dailyWorstCaseUsd: positiveNumber(env.AI_DEEPSEEK_MAX_DAILY_USD, 1.00),
      },
      inputEstimateSafetyMultiplier: boundedNumber(env.AI_DEEPSEEK_INPUT_ESTIMATE_MULTIPLIER, 1.35, 1, 2),
    },
    contextSafetyFraction: fraction(env.AI_CONTEXT_SAFETY_FRACTION, 0.90),
    outputTokens: {
      fast: boundedInteger(env.AI_OUTPUT_TOKENS_FAST, 4096, 512, 65_536),
      auto: boundedInteger(env.AI_OUTPUT_TOKENS_AUTO, 8192, 512, 65_536),
      research: boundedInteger(env.AI_OUTPUT_TOKENS_RESEARCH, 16_384, 1024, 65_536),
    },
    maxToolCalls: {
      fast: boundedInteger(env.AI_MAX_TOOL_CALLS_FAST, 4, 1, 12),
      auto: boundedInteger(env.AI_MAX_TOOL_CALLS_AUTO, 8, 1, 16),
      research: boundedInteger(env.AI_MAX_TOOL_CALLS_RESEARCH, 12, 1, 24),
    },
    maxToolRounds: {
      fast: boundedInteger(env.AI_MAX_TOOL_ROUNDS_FAST, 2, 1, 4),
      auto: boundedInteger(env.AI_MAX_TOOL_ROUNDS_AUTO, 4, 1, 6),
      research: boundedInteger(env.AI_MAX_TOOL_ROUNDS_RESEARCH, 6, 1, 8),
    },
  };
}

export function geminiQuotaForModel(config: AiRuntimeConfig["gemini"], model: string): GeminiQuotaConfig {
  return config.quotasByModel[model as GeminiModelId] ?? config.quota;
}

/** Ordered environment-provided Gemini keys: GEMINI_API_KEY first, then GEMINI_API_KEYS entries.
 *  Vertex Express ("AQ.") keys are dropped unless AI_VERTEX_EXPRESS_ENABLED="1" — while that
 *  API stays disabled on its GCP project they only poison rotation with the enable-wall error. */
export function geminiEnvKeys(env: Env): string[] {
  const vertexEnabled = env.AI_VERTEX_EXPRESS_ENABLED === "1";
  const out: string[] = [];
  const push = (value: string | undefined) => {
    const key = value?.trim();
    if (key && !out.includes(key) && (vertexEnabled || !isVertexExpressKey(key))) out.push(key);
  };
  push(env.GEMINI_API_KEY);
  for (const part of (env.GEMINI_API_KEYS ?? "").split(/[\n,]+/)) push(part);
  return out.slice(0, 12);
}

export function resolveAiStateDatabase(env: Env): D1Database {
  return env.AI_DB ?? env.DB;
}

function quotaProfile(
  modelSpecific:{rpm:string|undefined;tpm:string|undefined;rpd:string|undefined},
  legacy:{rpmLimit:number|null;inputTpmLimit:number|null;rpdLimit:number|null},
  fallback:Omit<GeminiQuotaConfig,"reserveFraction">,
  reserveFraction:number,
):GeminiQuotaConfig{
  return {
    rpmLimit: positiveInteger(modelSpecific.rpm) ?? legacy.rpmLimit ?? fallback.rpmLimit,
    inputTpmLimit: positiveInteger(modelSpecific.tpm) ?? legacy.inputTpmLimit ?? fallback.inputTpmLimit,
    rpdLimit: positiveInteger(modelSpecific.rpd) ?? legacy.rpdLimit ?? fallback.rpdLimit,
    reserveFraction,
  };
}
function configuredNumber(value: string | undefined): number { return value?.trim() ? Number(value) : NaN; }
function clean(value: string | undefined): string | null { const out = value?.trim(); return out ? out : null; }
function positiveInteger(value: string | undefined): number | null { const n = configuredNumber(value); return Number.isSafeInteger(n) && n > 0 ? n : null; }
function fraction(value: string | undefined, fallback: number): number { const n = configuredNumber(value); return Number.isFinite(n) && n >= 0 && n < 1 ? n : fallback; }
function fractionRange(value: string | undefined, fallback: number, min: number, max: number): number { const n = configuredNumber(value); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback; }
function positiveNumber(value: string | undefined, fallback: number): number { const n = configuredNumber(value); return Number.isFinite(n) && n > 0 ? n : fallback; }
function nonNegativeNumber(value: string | undefined, fallback: number): number { const n = configuredNumber(value); return Number.isFinite(n) && n >= 0 ? n : fallback; }
function boundedNumber(value: string | undefined, fallback: number, min: number, max: number): number { const n = configuredNumber(value); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback; }
function boundedInteger(value: string | undefined, fallback: number, min: number, max: number): number { const n = configuredNumber(value); return Number.isSafeInteger(n) ? Math.max(min, Math.min(max, n)) : fallback; }

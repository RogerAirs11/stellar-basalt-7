import type { AiCostEstimate, AiUsage } from "../core/types";
import type { DeepSeekPriceConfig } from "./config";

export function estimateDeepSeekWorstCase(inputTokens: number, outputReserveTokens: number, price: DeepSeekPriceConfig): AiCostEstimate {
  const worstCaseInputCostUsd = Math.max(0, inputTokens) / 1_000_000 * price.cacheMissInputPerMillionUsd;
  const worstCaseOutputCostUsd = Math.max(0, outputReserveTokens) / 1_000_000 * price.outputPerMillionUsd;
  const worstCaseTotalCostUsd = worstCaseInputCostUsd + worstCaseOutputCostUsd;
  return {
    worstCaseInputCostUsd,
    worstCaseOutputCostUsd,
    worstCaseTotalCostUsd,
    allowed: worstCaseTotalCostUsd <= price.perRequestWorstCaseUsd,
    reason: worstCaseTotalCostUsd <= price.perRequestWorstCaseUsd
      ? "within_zero_cache_worst_case_limit"
      : "zero_cache_worst_case_limit_exceeded",
  };
}

export function estimateDeepSeekBilledCost(usage: AiUsage, price: DeepSeekPriceConfig): number {
  const hit = Math.max(0, usage.cacheHitTokens ?? 0);
  const miss = Math.max(0, usage.cacheMissTokens ?? Math.max(0, usage.inputTokens - hit));
  return hit / 1_000_000 * price.cacheHitInputPerMillionUsd
    + miss / 1_000_000 * price.cacheMissInputPerMillionUsd
    + Math.max(0, usage.outputTokens) / 1_000_000 * price.outputPerMillionUsd;
}
export function maxDeepSeekInputTokensForRequest(outputReserveTokens: number, price: DeepSeekPriceConfig): number {
  const outputCost = Math.max(0, outputReserveTokens) / 1_000_000 * price.outputPerMillionUsd;
  const remainingUsd = Math.max(0, price.perRequestWorstCaseUsd - outputCost);
  if (price.cacheMissInputPerMillionUsd <= 0) return Number.MAX_SAFE_INTEGER;
  return Math.max(0, Math.floor(remainingUsd / price.cacheMissInputPerMillionUsd * 1_000_000));
}


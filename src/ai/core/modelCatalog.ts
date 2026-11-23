import type { AiAssistantModelDescriptor, AiProviderCapabilities } from "./types";

export const GEMINI_25_FLASH = "gemini-2.5-flash" as const;
export const GEMINI_25_FLASH_LITE = "gemini-2.5-flash-lite" as const;
export const GEMINI_FLASH_LITE = "gemini-3.5-flash-lite" as const;
export const GEMINI_FLASH = "gemini-3.5-flash" as const;
/** Editorial contract model; do not silently replace the operator's chat model. */
export const GEMINI_EDITORIAL_FLASH = "gemini-3.8-flash" as const;
export const DEEPSEEK_FLASH = "deepseek-flash" as const;
/** Deterministic local model for sandbox testing (no external API calls). */
export const OFFLINE_SANDBOX = "offline-sandbox" as const;
/** All chat-capable Gemini model ids this deployment understands. */
export const GEMINI_CHAT_MODELS = [GEMINI_25_FLASH, GEMINI_25_FLASH_LITE, GEMINI_FLASH_LITE, GEMINI_FLASH] as const;

const GEMINI_CAPABILITIES: AiProviderCapabilities = {
  contextWindow: 1_048_576,
  maxOutputTokens: 65_536,
  supportsThinking: true,
  supportedThinkingLevels: ["minimal", "low", "medium", "high"],
  supportsTools: true,
  supportsParallelTools: true,
  supportsStructuredOutput: true,
  supportsVision: true,
  supportsStreaming: true,
  supportsStatefulConversation: true,
  supportsImplicitCaching: "unknown",
  providerManagedStateRetentionSeconds: 86_400,
};

const GEMINI_25_CAPABILITIES: AiProviderCapabilities = {
  ...GEMINI_CAPABILITIES,
  // The 2.5 generation predates the Interactions-API `thinking_level` config;
  // sending it risks 400s, so the runtime omits the field ("off") and the
  // model's own dynamic thinking applies.
  supportedThinkingLevels: ["off", "low", "high"],
};

const DEEPSEEK_CAPABILITIES: AiProviderCapabilities = {
  contextWindow: 1_000_000,
  maxOutputTokens: 393_216,
  supportsThinking: true,
  supportedThinkingLevels: ["off", "low", "high", "max"],
  supportsTools: true,
  supportsParallelTools: true,
  supportsStructuredOutput: true,
  supportsVision: true,
  supportsStreaming: true,
  supportsStatefulConversation: false,
  supportsImplicitCaching: true,
};

const OFFLINE_CAPABILITIES: AiProviderCapabilities = {
  contextWindow: 128_000,
  maxOutputTokens: 16_384,
  supportsThinking: false,
  supportedThinkingLevels: ["off"],
  supportsTools: false,
  supportsParallelTools: false,
  supportsStructuredOutput: false,
  supportsVision: false,
  supportsStreaming: true,
  supportsStatefulConversation: false,
  supportsImplicitCaching: false,
};

export function modelCapabilities(provider: "gemini" | "deepseek" | "offline", model: string): AiProviderCapabilities {
  if (provider === "gemini") {
    if (model === GEMINI_25_FLASH || model === GEMINI_25_FLASH_LITE) return GEMINI_25_CAPABILITIES;
    if (model === GEMINI_FLASH_LITE || model === GEMINI_FLASH) return GEMINI_CAPABILITIES;
  }
  if (provider === "deepseek" && model === DEEPSEEK_FLASH) return DEEPSEEK_CAPABILITIES;
  if (provider === "offline" && model === OFFLINE_SANDBOX) return OFFLINE_CAPABILITIES;
  throw new Error(`Unsupported AI model: ${provider}/${model}`);
}

export function defaultThinkingLevel(model: string, mode: "fast" | "auto" | "research") {
  // 2.5 generation: omit thinking_level entirely (the model's dynamic thinking
  // is fast and the Interactions API may not accept the 3.x thinking config).
  if (model === GEMINI_25_FLASH || model === GEMINI_25_FLASH_LITE) return mode === "research" ? "high" : "off";
  if (model === GEMINI_FLASH) return mode === "research" ? "high" : mode === "fast" ? "low" : "medium";
  if (model === GEMINI_FLASH_LITE) return mode === "research" ? "medium" : mode === "fast" ? "minimal" : "low";
  if (model === DEEPSEEK_FLASH) return mode === "research" ? "high" : "off";
  if (model === OFFLINE_SANDBOX) return "off" as const;
  return "low" as const;
}

export function publicModelCatalog(config: {
  geminiEnabled: boolean;
  deepseekEnabled: boolean;
  deepseekVisionEnabled: boolean;
  offlineEnabled?: boolean;
  offlineRegistryResearch?: boolean;
}): AiAssistantModelDescriptor[] {
  const offline = config.offlineEnabled === true;
  return [
    { provider: "offline", id: OFFLINE_SANDBOX, label: config.offlineRegistryResearch ? "Offline registry research (fictional data)" : "Sandbox offline assistant (local)", available: offline, vision: false, paid: false, defaultForChat: offline },
    // R56: the mature 2.5 generation is the DEFAULT — live probes on 2026-09-24
    // showed the 3.5 family free-tier queue at 40–55s per request (and frequent
    // 503 "high demand" admissions) while 2.5-flash answered in ~0.5–0.9s with
    // a separate, far larger free-tier RPD pool.
    { provider: "gemini", id: GEMINI_25_FLASH, label: "Gemini 2.5 Flash", available: config.geminiEnabled, vision: config.geminiEnabled, paid: false, defaultForChat: !offline },
    { provider: "gemini", id: GEMINI_25_FLASH_LITE, label: "Gemini 2.5 Flash-Lite", available: config.geminiEnabled, vision: config.geminiEnabled, paid: false },
    { provider: "gemini", id: GEMINI_FLASH_LITE, label: "Gemini 3.5 Flash-Lite", available: config.geminiEnabled, vision: config.geminiEnabled, paid: false },
    { provider: "gemini", id: GEMINI_FLASH, label: "Gemini 3.5 Flash", available: config.geminiEnabled, vision: config.geminiEnabled, paid: false },
    { provider: "deepseek", id: DEEPSEEK_FLASH, label: "DeepSeek V4.1 Flash", available: config.deepseekEnabled, vision: config.deepseekEnabled && config.deepseekVisionEnabled, paid: true },
  ];
}

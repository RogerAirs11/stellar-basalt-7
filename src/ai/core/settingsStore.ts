import { DEEPSEEK_FLASH, GEMINI_25_FLASH, GEMINI_25_FLASH_LITE, GEMINI_FLASH, GEMINI_FLASH_LITE, OFFLINE_SANDBOX } from "./modelCatalog";
import type { AiExecutionMode, AiProviderId } from "./types";

/**
 * Admin-managed AI runtime settings (R33): the default chat model and the
 * default execution mode are chosen by administrators in the admin panel and
 * stored in `ai_runtime_settings`; user-facing chat UIs no longer expose
 * provider/model customization. Reads are cached briefly (TTL) because every
 * assistant turn consults the default; writes invalidate the cache.
 */

export interface AdminAiSettings {
  /** Selected default chat model id, or null for the system default. */
  defaultChatModel: string | null;
  /** Selected default execution mode, or null for "auto". */
  defaultExecutionMode: AiExecutionMode | null;
}

const CHAT_MODEL_IDS = [GEMINI_25_FLASH, GEMINI_25_FLASH_LITE, GEMINI_FLASH_LITE, GEMINI_FLASH, DEEPSEEK_FLASH, OFFLINE_SANDBOX] as const;
const EXECUTION_MODES: AiExecutionMode[] = ["fast", "auto", "research"];
const TTL_MS = 15_000;

let cache: { value: AdminAiSettings; at: number } | null = null;

export function isKnownChatModel(model: string): boolean {
  return (CHAT_MODEL_IDS as readonly string[]).includes(model);
}

export function providerForChatModel(model: string): AiProviderId | null {
  if (model === GEMINI_25_FLASH || model === GEMINI_25_FLASH_LITE || model === GEMINI_FLASH_LITE || model === GEMINI_FLASH) return "gemini";
  if (model === DEEPSEEK_FLASH) return "deepseek";
  if (model === OFFLINE_SANDBOX) return "offline";
  return null;
}

export function isKnownExecutionMode(mode: string): mode is AiExecutionMode {
  return (EXECUTION_MODES as string[]).includes(mode);
}

/** Effective default: admin override when valid+enabled, else the config default. */
export function effectiveDefaultChatModel(override: string | null, config: { geminiEnabled: boolean; deepseekEnabled: boolean; offlineEnabled?: boolean }): string {
  if (override && isKnownChatModel(override)) {
    const provider = providerForChatModel(override);
    if (provider === "gemini" && config.geminiEnabled) return override;
    if (provider === "deepseek" && config.deepseekEnabled) return override;
    if (provider === "offline" && config.offlineEnabled === true) return override;
  }
  // When the offline sandbox model is enabled it becomes the system default so the
  // assistant works out of the box in geo-blocked sandboxes without live provider keys.
  // R56: otherwise the mature 2.5-flash is the system default — the 3.5 family's
  // free-tier queue is chronically congested (40–55s turns), 2.5-flash is sub-second.
  if (config.offlineEnabled === true) return OFFLINE_SANDBOX;
  return GEMINI_25_FLASH;
}

export async function readAdminAiSettings(db: D1Database): Promise<AdminAiSettings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const out: AdminAiSettings = { defaultChatModel: null, defaultExecutionMode: null };
  try {
    const rows = await db.prepare("SELECT key, value FROM ai_runtime_settings WHERE key IN ('default_chat_model','default_execution_mode')").all<{ key: string; value: string }>();
    for (const row of rows.results ?? []) {
      const value = row.value?.trim() ?? "";
      if (row.key === "default_chat_model" && value && isKnownChatModel(value)) out.defaultChatModel = value;
      if (row.key === "default_execution_mode" && value && isKnownExecutionMode(value)) out.defaultExecutionMode = value;
    }
  } catch {
    // Table not migrated yet or transient failure — fall back to system defaults.
  }
  cache = { value: out, at: Date.now() };
  return out;
}

export async function writeAdminAiSettings(db: D1Database, input: { defaultChatModel?: string | null; defaultExecutionMode?: string | null }): Promise<AdminAiSettings> {
  const writes: Array<[string, string]> = [];
  if (input.defaultChatModel !== undefined) {
    const model = input.defaultChatModel?.trim() ?? "";
    if (model && !isKnownChatModel(model)) throw new Error(`Unsupported AI model: ${model}`);
    writes.push(["default_chat_model", model]);
  }
  if (input.defaultExecutionMode !== undefined) {
    const mode = input.defaultExecutionMode?.trim() ?? "";
    if (mode && !isKnownExecutionMode(mode)) throw new Error(`Unsupported execution mode: ${mode}`);
    writes.push(["default_execution_mode", mode]);
  }
  for (const [key, value] of writes) {
    await db.prepare("INSERT INTO ai_runtime_settings(key, value, updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP").bind(key, value).run();
  }
  cache = null; // invalidate; next read re-loads
  return readAdminAiSettings(db);
}

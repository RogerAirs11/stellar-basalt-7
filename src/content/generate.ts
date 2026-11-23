import { HttpError } from "../api/http";
import type { AiContentGenerateInput, ContentPostInput, ContentSource } from "../contracts/platform";
import { generateDeepSeekBilingualContent } from "./deepseek";
import { generateGeminiBilingualContent } from "./gemini";
import { generateOfflineBilingualContent } from "./offline";

export interface BilingualContentResult {
  draft: ContentPostInput;
  sources: ContentSource[];
  warnings?: string[];
  attempts?: string[];
}

export async function generateBilingualContent(input: AiContentGenerateInput, env: Env): Promise<BilingualContentResult> {
  if (input.model === "offline-test") return generateOfflineBilingualContent(input);
  if (input.model === "deepseek-flash") return generateDeepSeekBilingualContent(input, env);
  if (input.model === "gemini-2.5-flash" || input.model === "gemini-3.8-flash" || input.model === "gemini-3.5-flash-lite") {
    try {
      return await generateGeminiBilingualContent(input, env);
    } catch (error) {
      // R37 hands-free rule (sandbox deployments only): when every real Gemini
      // transport is unreachable from this server (regional block, Vertex API
      // not yet enabled, exhausted key ring), the one-click generate button
      // still has to produce a reviewable draft instead of dead-ending. The
      // deterministic offline generator takes over and the warning explains
      // exactly why, including the enable link when Vertex is the blocker.
      if (env.AI_OFFLINE_SANDBOX === "1") {
        const offline = await generateOfflineBilingualContent(input);
        const reason = error instanceof HttpError ? `${error.status} ${error.code}: ${error.message}` : error instanceof Error ? error.message : String(error);
        const enableUrl = error instanceof HttpError && (error.details as { enableUrl?: string } | undefined)?.enableUrl;
        return {
          ...offline,
          draft: { ...offline.draft, ai_model: `${input.model} (offline fallback)` },
          warnings: [
            ...offline.warnings,
            `${input.model} was unreachable from this server (${reason}).${enableUrl ? ` Enable the Vertex AI API to unlock real generation: ${enableUrl}` : " In production (Cloudflare) the real Gemini provider runs automatically."}`,
          ],
          attempts: [`Real provider chain failed: ${reason}`, "Fell back to the deterministic sandbox draft generator."],
        };
      }
      throw error;
    }
  }
  throw new HttpError(400, "unsupported_ai_content_model", "Unsupported AI content model");
}

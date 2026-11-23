import { runPaidEditorialTurn } from "./providerAccounting";
import { HttpError } from "../api/http";
import type { AiContentGenerateInput, ContentPostInput, ContentSource } from "../contracts/platform";
import { buildEditorialPrompt, GeneratedContentSchema, toContentDraft } from "./aiShared";

export async function generateDeepSeekBilingualContent(input: AiContentGenerateInput, env: Env): Promise<{ draft: ContentPostInput; sources: ContentSource[]; warnings: string[]; attempts: string[] }> {
  const apiKey = env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) throw new HttpError(503, "deepseek_not_configured", "DeepSeek API key is not configured");
  if (input.model !== "deepseek-flash") throw new HttpError(400, "unsupported_deepseek_model", "Unsupported DeepSeek model");
  const warnings: string[] = [];
  if (input.grounding) warnings.push("Web grounding is not available with DeepSeek; the draft was generated without live web sources.");
  const effectiveInput: AiContentGenerateInput = { ...input, grounding: false };

  const prompt = buildEditorialPrompt(effectiveInput);
  const output = await runPaidEditorialTurn(env, {
    model: "deepseek-flash",
    systemInstruction: "Produce bilingual Horse DB editorial content for human review. Return valid JSON only; do not fabricate current facts, evidence, or citations.",
    conversation: [{ role: "user", text: prompt }], latestUserText: prompt,
    tools: [], toolChoice: "none", thinkingLevel: "off", responseFormat: "json_object",
    maxOutputTokens: 16384, abortSignal: AbortSignal.timeout(120_000),
  });
  const text = output.text.trim();
  if (!text || output.toolCalls.length) throw new HttpError(502, "deepseek_empty_response", "DeepSeek returned no complete structured editorial content");
  let json: unknown;
  try { json = JSON.parse(text); } catch { throw new HttpError(502, "deepseek_invalid_json", "DeepSeek returned invalid JSON"); }
  const parsed = GeneratedContentSchema.safeParse(json);
  if (!parsed.success) throw new HttpError(502, "deepseek_invalid_content", "DeepSeek output did not match the bilingual post contract", parsed.error.flatten());
  const sources: ContentSource[] = [];
  return { draft: toContentDraft(effectiveInput, parsed.data, sources), sources, warnings, attempts: [] };
}

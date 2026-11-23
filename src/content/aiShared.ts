import { z } from "zod";
import type { AiContentGenerateInput, ContentPostInput, ContentSource } from "../contracts/platform";

export const AI_CONTENT_MODELS = ["gemini-2.5-flash", "gemini-3.8-flash", "gemini-3.5-flash-lite", "deepseek-flash", "offline-test"] as const;

export const GeneratedContentSchema = z.object({
  kind: z.enum(["article", "news", "update"]),
  title_en: z.string().min(4).max(220),
  title_fa: z.string().min(4).max(220),
  summary_en: z.string().min(10).max(700),
  summary_fa: z.string().min(10).max(700),
  body_en: z.string().min(80).max(24000),
  body_fa: z.string().min(80).max(24000),
  tags: z.array(z.string().min(1).max(60)).max(12),
});

export type GeneratedContent = z.infer<typeof GeneratedContentSchema>;

/** The editorial contract expressed as a JSON Schema (used for structured output). */
export function editorialJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["article", "news", "update"] },
      title_en: { type: "string" }, title_fa: { type: "string" },
      summary_en: { type: "string" }, summary_fa: { type: "string" },
      body_en: { type: "string" }, body_fa: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
    },
    required: ["kind", "title_en", "title_fa", "summary_en", "summary_fa", "body_en", "body_fa", "tags"],
    additionalProperties: false,
  };
}

export function buildEditorialPrompt(input: AiContentGenerateInput): string {
  const focus = input.topic?.trim() || (input.grounding
    ? "Choose one timely, factual and genuinely useful topic related to Arabian horses, studbooks, pedigree registries, breeding records, equine identity, or registry administration."
    : "Choose one useful evergreen topic related to Arabian horses, studbooks, pedigree registries, breeding records, equine identity, or registry administration.");
  return [
    "You are the editorial agent for Horse DB, a professional Arabian-horse registry and pedigree reference application.",
    `Create exactly one ${input.kind} in English and Persian in the SAME structured response.`,
    focus,
    "The Persian must be natural contemporary Iranian Persian, not literal machine translation.",
    "English and Persian must communicate the same facts and emphasis.",
    "Do not invent horse records, registry statistics, quotes, organizations, dates, regulations, or events.",
    input.grounding
      ? "Use the configured web grounding/research capability for current factual claims. Prefer primary/official sources and recent sources where recency matters."
      : "Without web grounding, avoid claims that require current verification; prefer durable educational content.",
    "body_en and body_fa may use simple Markdown headings and bullet lists, but NEVER raw HTML.",
    "Keep the title concise, summary useful, and body publication-ready.",
    "Write body_en and body_fa as substantive professional content: an introduction, 3-6 themed sections with short Markdown headings, and a closing summary.",
    'Return only one JSON object with exactly these keys: kind, title_en, title_fa, summary_en, summary_fa, body_en, body_fa, tags.',
  ].join("\n");
}

export function toContentDraft(input: AiContentGenerateInput, generated: GeneratedContent, sources: ContentSource[]): ContentPostInput {
  return {
    kind: generated.kind,
    status: "draft",
    title_en: generated.title_en,
    title_fa: generated.title_fa,
    summary_en: generated.summary_en,
    summary_fa: generated.summary_fa,
    body_en: generated.body_en,
    body_fa: generated.body_fa,
    tags: generated.tags,
    sources,
    cover_image_url: null,
    cover_image_alt_en: null,
    cover_image_alt_fa: null,
    cover_image_credit: null,
    cover_image_source_url: null,
    ai_model: input.model,
    ai_grounding: input.grounding,
    ai_prompt: input.topic?.trim() || null,
  };
}

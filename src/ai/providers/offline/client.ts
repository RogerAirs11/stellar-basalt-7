import type {
  AiProviderId,
  AiProviderStreamEvent,
  AiUsage,
  ProviderConversationTurn,
  ProviderTurnInput,
  ProviderTurnOutput,
} from "../../core/types";
import type { AiProvider, TokenEstimateInput } from "../../core/provider";
import { modelCapabilities, OFFLINE_SANDBOX } from "../../core/modelCatalog";
import { demoRegistryTurn } from "./registryResearch";

/**
 * Offline sandbox assistant — a deterministic local provider (no network calls).
 *
 * Purpose: keep the AI chat pipeline fully testable in sandbox regions that
 * Google geo-blocks (generativelanguage + Vertex Express) so the UI, streaming,
 * persistence, markdown rendering and entity linking can be exercised end-to-end.
 * Enabled ONLY by the operator flag AI_OFFLINE_SANDBOX=1; never on by default.
 *
 * It never fabricates registry facts: instead it answers from a small static
 * knowledge base about the domain (COI / AVK / verdict bands, how to use the
 * app) and clearly labels itself as the offline test assistant for everything
 * else. Persian and English are both supported based on message script.
 */

const SANDBOX_NOTE_EN = "**Sandbox offline assistant** - static demonstration only, not a live registry lookup. External AI requires configured providers, permitted data use and available quota.";
const SANDBOX_NOTE_FA = "دستیار آفلاین آزمایشی؛ این پاسخ جست‌وجوی زنده نیست. هوش مصنوعی بیرونی به تنظیمات، مجوز استفاده از داده و سهمیه نیاز دارد.";

interface FaqEntry {
  keywords: RegExp;
  en: string;
  fa: string;
}

const FAQ: FaqEntry[] = [
  {
    keywords: /(?<![\p{L}\p{N}])(coi|inbreed|inbreeding|coefficient|نرخ هم‌خونی|هم‌خونی|تلاقی خویشاوندی)(?![\p{L}\p{N}])/iu,
    en: "**Pedigree coefficient of inbreeding (COI)** estimates the probability that two alleles at a locus are identical by descent, relative to the recorded pedigree and its founder assumptions. A projected foal COI describes this pedigree model, not measured DNA diversity or a diagnosis.\n\nA low value does not establish unrelatedness when ancestors are missing. Compare the same generation depth and inspect completeness, common ancestors, cycles and truncation. Descriptive color bands are not universal safe/unsafe breeding thresholds. Decisions also need verified variant tests, welfare considerations and qualified veterinary or genetics advice.",
    fa: "ضریب هم‌خونی (COI) برآوردی بر پایه تبارنامه ثبت‌شده و فرض‌های نیاکان بنیان‌گذار است؛ آزمایش DNA یا تشخیص بیماری نیست.\n\nعدد کم در تبارنامه ناقص، بی‌ارتباط بودن والدین را ثابت نمی‌کند. عمق نسل‌ها، کامل بودن سوابق، اجداد مشترک و خطاهای تبارنامه را بررسی کنید. رنگ‌ها مرز علمی جهانی برای تلاقی بی‌خطر نیستند. تصمیم به آزمایش معتبر، رفاه اسب و مشاوره تخصصی هم نیاز دارد.",
  },
  {
    keywords: /(?<![\p{L}\p{N}])(avk|ancestor loss|ancestry|تعداد اجداد|از دست رفتن اجداد)(?![\p{L}\p{N}])/iu,
    en: "**AVK** here is the number of distinct recorded ancestors divided by the theoretical ancestor positions at a stated depth. Five generations have 62 positions (2 + 4 + 8 + 16 + 32). Missing ancestors and repeated ancestors can both lower this ratio.\n\nReport completeness separately: known positions divided by theoretical positions. AVK is not a measured DNA-diversity percentage, and neither metric by itself establishes health or an optimal mate. Compare pedigrees at equal depth and retain explicit unknowns.",
    fa: "شاخص AVK در اینجا نسبت اجداد یکتای ثبت‌شده به جایگاه‌های نظری در عمق مشخص است. پنج نسل ۶۲ جایگاه دارد. هم اجداد ناشناخته و هم اجداد تکراری می‌توانند این نسبت را کاهش دهند.\n\nکامل بودن سوابق باید جداگانه گزارش شود. AVK درصد تنوع DNA اندازه‌گیری‌شده نیست و سلامت یا بهترین جفت را ثابت نمی‌کند.",
  },
  {
    keywords: /(?<![\p{L}\p{N}])(match|matching|breed|breeding|pair|stallion|mare|تلاقی|جفت|تولیدمثل|پرورش|قطران)(?![\p{L}\p{N}])/iu,
    en: "**Breeding comparisons** should show the projected foal COI, parental relationship, pedigree depth and completeness, repeated/common ancestors, and reasons a candidate was excluded. Rankings depend on the chosen dataset and constraints; they are not a promise of a healthier or more successful foal.\n\nVerified, assay-specific Arabian health evidence can support separate Mendelian variant projections. Missing, conflicting or unverified tests must remain unknown, never become a zero-risk result. This offline assistant does not query the live registry or calculate an actual horse pairing.",
    fa: "مقایسه تلاقی باید COI کره، خویشاوندی والدین، عمق و کامل بودن تبارنامه و دلیل حذف نامزدها را نشان دهد. رتبه‌بندی به داده و قیدها وابسته است؛ سلامت یا موفقیت کره را تضمین نمی‌کند.\n\nتحلیل مندلی به شواهد معتبر همان واریانت نیاز دارد. آزمایش ناموجود، متناقض یا تأییدنشده باید نامشخص بماند، نه بی‌خطر. این دستیار آفلاین تلاقی واقعی یا داده زنده را محاسبه نمی‌کند.",
  },
  {
    keywords: /(?<![\p{L}\p{N}])(hello|hi\b|hey|salam|سلام|درود)(?![\p{L}\p{N}])/iu,
    en: "Hello! I'm the **offline sandbox assistant** for Horse DB.\n\n" +
      "Things you can test with me right now:\n" +
      "- Streaming replies, markdown (like this), and bilingual behavior\n" +
      "- Conversation history and titles in the sidebar\n" +
      "- How the panel behaves on slow networks (I reply instantly)\n\n" +
      "Ask me about **COI**, **AVK**, or **breeding match** for a domain answer from my static knowledge base.",
    fa: "درود! من **دستیار آفلاین محیط آزمایشی** اسب‌بان هستم.\n\n" +
      "چیزهایی که همین حالا می‌توانید با من آزمایش کنید:\n" +
      "- پاسخ‌های جریانی، مارک‌داون (مثل همین متن) و رفتار دوزبانه\n" +
      "- تاریخچه گفت‌وگوها و عنوان‌شان در نوار کناری\n" +
      "- رفتار پنل روی شبکه کند (من فوری پاسخ می‌دهم)\n\n" +
      "برای پاسخ تخصصی از دانش ثابت من درباره **COI**، **AVK** یا **تطبیق تلاقی** بپرسید.",
  },
  {
    keywords: /(?<![\p{L}\p{N}])(search|find|lookup|pedigree|horse named|بگرد|پیدا|تبارنامه|سابقه)(?![\p{L}\p{N}])/iu,
    en: "I can't search the live registry in offline mode — that needs the production assistant with its tools.\n\n" +
      "In this sandbox you can still exercise search yourself from the **Database** and **Analytics** tabs: full-text name search (Latin and native), sire/dam lineage, strains, owners and breeders are all there.",
    fa: "در حالت آفلاین نمی‌توانم بانک اطلاعاتی زنده را جست‌وجو کنم — این کار به دستیار عملیاتی با ابزارهایش نیاز دارد.\n\n" +
      "در همین محیط آزمایشی می‌توانید جست‌وجو را خودتان از بخش‌های **بانک اطلاعاتی** و **تحلیل‌ها** انجام دهید: جست‌وجوی نام (لاتین و فارسی)، تبار پدری/مادری، تیره‌ها، مالکان و پرورش‌دهندگان همه در دسترس‌اند.",
  },
];

function isPersian(text: string): boolean {
  return /[\u0600-\u06FF]/.test(text);
}

function estimateTokens(text: string): number {
  // Rough: ~1 token per 4 latin chars; Persian ~1 per 3 chars.
  return Math.ceil(text.length / (isPersian(text) ? 3 : 4));
}

function buildOfflineAnswer(input: ProviderTurnInput): string {
  const question = input.latestUserText.trim();
  const fa = isPersian(question);
  const priorTurns = countMeaningfulTurns(input.conversation);
  const faq = FAQ.find(entry => entry.keywords.test(question));
  const note = fa ? SANDBOX_NOTE_FA : SANDBOX_NOTE_EN;

  if (faq) {
    return `${faq.fa && fa ? faq.fa : faq.en}\n\n---\n${note}`;
  }

  const generic = fa
    ? `پیام شما را دریافت کردم: «${truncate(question, 160)}»\n\nدر حالت آفلاین پاسخ تحلیلی زنده تولید نمی‌کنم، اما کل خط لوله گفت‌وگو (ارسال، جریان پاسخ، تاریخچه و رندر) همین‌جا قابل آزمایش است.\n\nبرای پاسخ واقعی و پرس‌وجو از بانک اطلاعاتی، دستیار Gemini عملیاتی را در محیط اصلی امتحان کنید.`
    : `Got your message: “${truncate(question, 160)}”\n\nIn offline mode I don't generate live analytical answers, but the whole chat pipeline (sending, streaming, history, rendering) is testable right here.\n\nFor real answers with registry lookups, use the production Gemini assistant.`;
  const turnNote = priorTurns > 1
    ? fa ? `این گفت‌وگو تاکنون ${priorTurns} پیام معنادار داشته است.` : `This conversation has ${priorTurns} meaningful messages so far.`
    : "";
  return [generic, turnNote].filter(Boolean).join("\n\n") + `\n\n---\n${note}`;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function countMeaningfulTurns(turns: ProviderConversationTurn[]): number {
  return turns.filter(turn => (turn.role === "user" || turn.role === "assistant") && turn.text?.trim()).length;
}

function usageFor(system: string, turns: ProviderConversationTurn[], output: string): AiUsage {
  const inputTokens = estimateTokens(system) + turns.reduce((sum, turn) => sum + estimateTokens(turn.text ?? ""), 0);
  const outputTokens = estimateTokens(output);
  return {
    inputTokens,
    outputTokens,
    thoughtTokens: 0,
    cachedTokens: 0,
    toolTokens: 0,
    totalTokens: inputTokens + outputTokens,
  };
}

function runTurn(input: ProviderTurnInput, registryResearch = false): ProviderTurnOutput {
  const result = registryResearch ? demoRegistryTurn(input) : { text: buildOfflineAnswer(input), toolCalls: [] };
  const { text, toolCalls } = result;
  return {
    provider: "offline",
    model: OFFLINE_SANDBOX,
    text,
    toolCalls,
    usage: usageFor(input.systemInstruction, input.conversation, text),
    providerState: null,
    interactionId: null,
    finishReason: toolCalls.length ? "tool_calls" : "stop",
  };
}

export class OfflineProvider implements AiProvider {
  readonly id: AiProviderId = "offline";
  constructor(private readonly options: { registryResearch?: boolean } = {}) {}

  capabilities(model: string) {
    return { ...modelCapabilities("offline", model), supportsTools: this.options.registryResearch === true };
  }

  async createTurn(input: ProviderTurnInput): Promise<ProviderTurnOutput> {
    return runTurn(input, this.options.registryResearch);
  }

  async continueTurn(input: ProviderTurnInput): Promise<ProviderTurnOutput> {
    return runTurn(input, this.options.registryResearch);
  }

  async *streamTurn(input: ProviderTurnInput): AsyncIterable<AiProviderStreamEvent> {
    const output = runTurn(input, this.options.registryResearch);
    // Stream in small chunks so the UI exercises its incremental rendering path.
    const chunks = chunkText(output.text, 64);
    for (const chunk of chunks) {
      yield { type: "text_delta", text: chunk };
      await sleep(12);
    }
    yield { type: "usage", usage: output.usage };
    yield { type: "done", output };
  }

  async countTokens(input: TokenEstimateInput): Promise<number> {
    return estimateTokens(`${input.systemInstruction}\n${input.conversationText}`);
  }
}

function chunkText(text: string, size: number): string[] {
  const out: string[] = [];
  for (let index = 0; index < text.length; index += size) out.push(text.slice(index, index + size));
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

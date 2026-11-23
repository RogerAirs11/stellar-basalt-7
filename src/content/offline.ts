import type { AiContentGenerateInput, ContentPostInput, ContentSource } from "../contracts/platform";
import { toContentDraft } from "./aiShared";

/**
 * Offline test draft generator for the Editorial Studio.
 *
 * Deterministic, dependency-free bilingual draft scaffolding so the full
 * editorial workflow (generate → review → edit → publish) can be exercised in
 * sandbox regions where Google geo-blocks Gemini and Vertex Express is not yet
 * enabled. The output is clearly labeled as a sandbox test draft — it never
 * pretends to be real AI research and carries no fabricated citations.
 */

interface OfflineTopic {
  key: string;
  titleEn: string;
  titleFa: string;
  sectionsEn: Array<[string, string]>;
  sectionsFa: Array<[string, string]>;
  tags: string[];
}

const TOPICS: OfflineTopic[] = [
  {
    key: "coi",
    titleEn: "Reading Inbreeding Coefficients Before Your Next Mating",
    titleFa: "خواندن ضریب هم‌خونی پیش از تلاقی بعدی",
    sectionsEn: [
      ["Why the number matters", "The coefficient of inbreeding (COI) estimates the chance that a foal inherits two copies of the same ancestral allele. Breeders who watch this number make fewer unpleasant surprises in the foaling barn."],
      ["The three verdict bands", "Horse DB groups matings into outcross (below 2.5%), linebreeding (2.5% to 10%) and close inbreeding (above 10%). Each band has a place in a breeding program; what matters is choosing one deliberately rather than by accident."],
      ["Depth changes the answer", "A pedigree with missing grandparents produces an artificially low COI. Comparing the G3, G5, G8 and G10 values — as the breeding panel does — shows whether the low number is real knowledge or missing records."],
    ],
    sectionsFa: [
      ["چرا این عدد مهم است", "ضریب هم‌خونی (COI) احتمال این را برآورد می‌کند که کره دو نسخه از یک آلل جد مشترک به ارث ببرد. پرورش‌دهنده‌ای که این عدد را می‌بیند، شگفتی‌های ناخوشایند کمتری در اصطبل تجربه می‌کند."],
      ["سه سطح حکم", "اسب‌بان تلاقی‌ها را به اوت‌کراس (زیر ۲٫۵٪)، لاین‌بریدینگ (۲٫۵ تا ۱۰٪) و هم‌خونی نزدیک (بالای ۱۰٪) تقسیم می‌کند. هر سطح جایی در برنامه پرورش دارد؛ مهم این است که آگاهانه انتخاب شود، نه اتفاقی."],
      ["عمق، پاسخ را عوض می‌کند", "تبارنامه با پدربزرگ‌های گم‌شده COI کاذباً پایینی می‌دهد. مقایسه مقادیر G3، G5، G8 و G10 — همان‌طور که پنل تلاقی انجام می‌دهد — نشان می‌دهد عدد پایین واقعی است یا محصول سوابق ناقص."],
    ],
    tags: ["breeding", "genetics", "guide", "sandbox-test"],
  },
  {
    key: "avk",
    titleEn: "Ancestor Loss: The Honest Mirror of a Pedigree",
    titleFa: "از دست رفتن اجداد: آینه صادق تبارنامه",
    sectionsEn: [
      ["What AVK tells you", "Of the 62 ancestors theoretically present in a five-generation pedigree, how many are distinct real horses? The ancestor loss coefficient answers exactly that, and it is remarkably good at exposing paper-thin pedigrees."],
      ["Duplicates are the signal", "When the same stallion appears as grandsire twice, the projected foal is more inbred than its nominal COI suggests. AVK makes that repetition visible before the mating happens."],
      ["Using it in the panel", "Horse DB shows AVK for the sire, the dam and the projected foal side by side, so a breeder can see whether an outcross is genuine or only cosmetic in shallow records."],
    ],
    sectionsFa: [
      ["AVK چه می‌گوید", "از ۶۲ جد نظری در تبارنامه پنج‌نسلی، چند مورد از آن‌ها اسب واقعی و متمایزند؟ ضریب از دست رفتن اجداد دقیقاً همین را می‌گوید و در افشای تبارنامه‌های کاغذی فوق‌العاده است."],
      ["تکرارها خودِ سیگنال‌اند", "وقتی یک نریان دو بار به‌عنوان پدربزرگ ظاهر می‌شود، کره فرضی واقعاً هم‌خون‌تر از COI اسمی‌اش است. AVK این تکرار را پیش از تلاقی مرئی می‌کند."],
      ["استفاده در پنل", "اسب‌بان AVK پدر، مادر و کره فرضی را کنار هم نشان می‌دهد تا پرورش‌دهنده ببیند اوت‌کراس واقعی است یا صرفاً نمایشی در سوابق کم‌عمق."],
    ],
    tags: ["pedigree", "genetics", "guide", "sandbox-test"],
  },
  {
    key: "registry",
    titleEn: "Inside a Modern Studbook: Records, Strains and Trust",
    titleFa: "در دل دفتر ثبت نژاد مدرن: سوابق، تیره‌ها و اعتماد",
    sectionsEn: [
      ["More than names", "A professional registry is a chain of evidence: identifiers, parentage, strains, people and lifecycle events that together make a horse verifiable decades later."],
      ["The Arabian tradition", "Strain tracking descends from Bedouin practice — maternal lines with names and reputations. Keeping them attached to modern records honors both science and heritage."],
      ["Why data quality is a feature", "Duplicate identities, missing parents and inconsistent dates quietly corrupt every downstream analysis. Treating quality checks as first-class tools protects the whole community."],
    ],
    sectionsFa: [
      ["فراتر از نام", "ثبت حرفه‌ای یک زنجیره شواهد است: شناسه‌ها، تبار، تیره‌ها، اشخاص و رویدادهای چرخه عمر که با هم اسب را دهه‌ها بعد قابل راستی‌آزمایی می‌کنند."],
      ["سنت اسب عرب", "پیگیری تیره از عمل بادیه‌نشینان آمده است — خطوط مادری با نام و اعتبار. حفظ اتصال آن‌ها به سوابق مدرن، هم علم و هم میراث را پاس می‌دارد."],
      ["چرا کیفیت داده یک ویژگی است", "هویت‌های تکراری، پدر و مادرهای گم‌شده و تاریخ‌های ناسازگار هر تحلیل بعدی را بی‌سروصدا فاسد می‌کنند. برخورد با بررسی‌های کیفیت به‌عنوان ابزار درجه‌یک، از کل جامعه محافظت می‌کند."],
    ],
    tags: ["registry", "studbook", "guide", "sandbox-test"],
  },
];

function pickTopic(input: AiContentGenerateInput): OfflineTopic {
  const requested = (input.topic ?? "").toLowerCase();
  const direct = TOPICS.find(topic => requested.includes(topic.key));
  if (direct) return direct;
  if (/avk|ancestor|اجداد/i.test(requested)) return TOPICS[1];
  if (/studbook|registry|ثبت نژاد|دفتر ثبت/i.test(requested)) return TOPICS[2];
  if (/coi|inbreed|هم‌خونی|تلاقی/i.test(requested)) return TOPICS[0];
  const day = Math.floor(Date.now() / 86_400_000);
  return TOPICS[day % TOPICS.length];
}

const KIND_INTRO_EN: Record<string, string> = {
  article: "A practical editorial piece for the Arabian horse community",
  news: "A newsroom-style report for the Arabian horse community",
  update: "A product and data update from the Horse DB team",
};
const KIND_INTRO_FA: Record<string, string> = {
  article: "نوشته‌ای کاربردی برای جامعه اسب عرب",
  news: "گزارشی خبری برای جامعه اسب عرب",
  update: "به‌روزرسانی محصول و داده از تیم اسب‌بان",
};

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "draft";
}

export function generateOfflineBilingualContent(input: AiContentGenerateInput): { draft: ContentPostInput; sources: ContentSource[]; warnings: string[] } {
  const topic = pickTopic(input);
  const warnings = [
    "Sandbox offline draft: generated locally without any AI provider. Review and rewrite before publishing.",
  ];
  const generated = {
    kind: input.kind,
    title_en: input.topic?.trim()
      ? `${input.topic.trim().slice(0, 140)} — ${topic.titleEn}`
      : topic.titleEn,
    title_fa: input.topic?.trim()
      ? `${topic.titleFa} — ${input.topic.trim().slice(0, 140)}`
      : topic.titleFa,
    summary_en: `${KIND_INTRO_EN[input.kind]}. ${topic.sectionsEn[0][1].slice(0, 220)}`,
    summary_fa: `${KIND_INTRO_FA[input.kind]}. ${topic.sectionsFa[0][1].slice(0, 220)}`,
    body_en: [
      `*${KIND_INTRO_EN[input.kind]} — generated in sandbox offline test mode.*`,
      "",
      ...topic.sectionsEn.map(([heading, text], index) => `## ${index + 1}. ${heading}\n\n${text}`),
      "",
      "## Closing note",
      "",
      "This draft was produced by the offline sandbox generator so the editorial workflow (draft, review, publish) can be tested end-to-end without external AI access. In production, the Gemini editorial agent writes the body from live research with cited sources.",
    ].join("\n"),
    body_fa: [
      `*${KIND_INTRO_FA[input.kind]} — تولیدشده در حالت آزمایش آفلاین محیط.*`,
      "",
      ...topic.sectionsFa.map(([heading, text], index) => `## ${index + 1}. ${heading}\n\n${text}`),
      "",
      "## یادداشت پایانی",
      "",
      "این پیش‌نویس توسط مولد آفلاین محیط آزمایشی ساخته شده تا گردش کار تحریریه (پیش‌نویس، بازبینی، انتشار) بدون دسترسی به هوش مصنوعی بیرونی کامل آزمایش شود. در محیط عملیاتی، عامل تحریریه Gemini متن را با پژوهش زنده و منابع ارجاع‌دار می‌نویسد.",
    ].join("\n"),
    tags: topic.tags,
  };
  return { draft: toContentDraft(input, generated, []), sources: [], warnings };
}

export { slugify as offlineSlugify };

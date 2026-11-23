import { kitEngineArabic, matchArabicTemplate, kitNumberTag, kitDigits, type ArabicTemplate } from "../../../frontend-kit";
import arabicCopy from "./arabicCopy.json";

/**
 * R123: the Federation Classic locale contract is three-locale (EN/FA/AR).
 * EN and FA are authored inline at each call site; Arabic resolves through
 * this engine's authored dictionary first (keyed by the English string),
 * then the shared kit dictionary, then Core's uiCopy.ar.json — so platform
 * vocabulary stays consistent across frontends. Unknown copy remains
 * truthful English.
 */
export type ClassicLocale = "en" | "fa" | "ar";

const ARABIC_COPY: Readonly<Record<string, string>> = arabicCopy as Readonly<Record<string, string>>;

/** English strings that carry runtime interpolation, with ${n} placeholders. */
const ARABIC_TEMPLATES: ReadonlyArray<ArabicTemplate> = [
  ["${0} horse records are available to search and explore.", "يتوفر ${0} سجل حصان للبحث والاستكشاف."],
  ["Published. Persian edition: ${0}.", "نُشر. الطبعة الفارسية: ${0}."],
  ["Created canonical horse #${0}.", "أُنشئ سجل الحصان رقم ${0}."],
  ["Archive horse #${0}?", "أرشفة الحصان رقم ${0}؟"],
  ["Horse #${0} archived; no hard delete was requested.", "أُرشف الحصان رقم ${0}؛ لم يُطلب حذف نهائي."],
  ["Reindex processed ${0}; failed ${1}; remaining ${2}.", "عالجت إعادة الفهرسة ${0}؛ فشل ${1}؛ بقي ${2}."],
  ["Mutation audit reconciliation processed ${0}; remaining ${1}; quarantined ${2}.", "عالجت مطابقة تدقيق التغييرات ${0}؛ بقي ${1}؛ أُودف عزلًا ${2}."],
  ["This listing is ${0}.", "هذا الإعلان ${0}."],
  ["Mark ${0}", "وسم ${0}"],
  ["Showing the newest ${0} of ${1} sent inquiries.", "عرض أحدث ${0} من أصل ${1} استفسارًا مرسلًا."],
];

export const t = (locale: ClassicLocale, en: string, fa: string) => {
  if (locale === "ar") {
    return kitEngineArabic(ARABIC_COPY, en) ?? matchArabicTemplate(ARABIC_TEMPLATES, en) ?? en;
  }
  return locale === "fa" ? fa : en;
};

export const num = (value: number | string | null | undefined, locale: ClassicLocale) => {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") return new Intl.NumberFormat(kitNumberTag(locale)).format(value);
  return kitDigits(String(value), locale);
};
export const pct = (value: number | null | undefined, locale: ClassicLocale, digits = 0) =>
  value === null || value === undefined ? "—" : `${new Intl.NumberFormat(kitNumberTag(locale), { maximumFractionDigits: digits }).format(value)}٪`;

/** R65: years are 4-digit identifiers — localized digits, NEVER group-separated
 *  ("2,022" / "٢٬٠٢٢" reads as a quantity, not a year). */
export const year = (value: number | string | null | undefined, locale: ClassicLocale) => {
  if (value === null || value === undefined || value === "") return "—";
  return kitDigits(String(value), locale);
};

/** Localize stable platform enum/status codes while leaving unknown canonical values untouched. */
export const code = (value: string | null | undefined, locale: ClassicLocale) => {
  if (!value) return "—";
  if (locale === "en") return value.replaceAll("_", " ");
  const fa: Record<string, string> = {
    approved: "تأییدشده", rejected: "ردشده", pending: "در انتظار", draft: "پیش‌نویس",
    active: "فعال", inactive: "غیرفعال", deceased: "تلف‌شده", imported: "وارداتی",
    high: "بالا", medium: "متوسط", low: "پایین", unavailable: "ناموجود",
    complete: "کامل", partial: "ناقص", clean: "سالم", truncated: "کوتاه‌شده",
    error: "خطا", warning: "هشدار", info: "اطلاع",
    sire: "پدر", dam: "مادر",
    create_horse: "ایجاد اسب", update_horse: "به‌روزرسانی اسب", ownership: "مالکیت", other: "سایر",
  };
  const ar: Record<string, string> = {
    approved: "معتمد", rejected: "مرفوض", pending: "قيد الانتظار", draft: "مسودة",
    active: "نشط", inactive: "غير نشط", deceased: "نافق", imported: "مستورد",
    high: "مرتفع", medium: "متوسط", low: "منخفض", unavailable: "غير متاح",
    complete: "مكتمل", partial: "جزئي", clean: "سليم", truncated: "مبتور",
    error: "خطأ", warning: "تحذير", info: "معلومة",
    sire: "الأب", dam: "الأم",
    create_horse: "إنشاء حصان", update_horse: "تحديث حصان", ownership: "الملكية", other: "أخرى",
  };
  if (locale === "ar") return ar[value] ?? value;
  return fa[value] ?? value;
};

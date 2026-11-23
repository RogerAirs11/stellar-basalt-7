import { horseSexLabel, kitEngineArabic, matchArabicTemplate, type ArabicTemplate } from "../../../frontend-kit";
import arabicCopy from "./arabicCopy.json";

export type EquiDataLocale = "en" | "fa" | "ar";

const ARABIC_COPY: Readonly<Record<string, string>> = arabicCopy as Readonly<Record<string, string>>;
const ARABIC_TEMPLATES: ReadonlyArray<ArabicTemplate> = [
  ["Watchlist, ${0} saved", "قائمة المتابعة، ${0} محفوظًا"],
  ["Explore ${0} horse records, follow family lines, and compare pedigrees and reviewed breeding evidence in one workspace.", "استكشف ${0} سجل حصان، وتتبّع الخطوط العائلية، وقارن الأنساب وأدلة التربية المراجَعة في مساحة عمل واحدة."],
  ["${0} pedigrees currently reach detected cycles; coefficient outputs are suppressed when integrity is unsafe.", "يبلغ ${0} من الأنساب دورات مكتشفة حاليًا؛ وتُكتم مخرجات المعاملات عندما تكون السلامة غير مؤمونة."],
  ["This listing is ${0}; the history stays available.", "هذا الإعلان ${0}؛ ويبقى السجل متاحًا."],
];

export function edxText(locale: EquiDataLocale, en: string, fa: string): string {
  if (locale === "ar") {
    return kitEngineArabic(ARABIC_COPY, en) ?? matchArabicTemplate(ARABIC_TEMPLATES, en) ?? en;
  }
  return locale === "fa" ? fa : en;
}

export function edxStatus(locale: EquiDataLocale, live: boolean): string {
  return live ? edxText(locale, "LIVE", "فعال") : edxText(locale, "DORMANT", "غیرفعال");
}

export function edxUnknown(locale: EquiDataLocale): string {
  return edxText(locale, "Unknown", "نامشخص");
}

export function currentEquiDataLocale(): EquiDataLocale {
  if (typeof document === "undefined") return "en";
  return document.documentElement.dataset.locale === "fa" || document.documentElement.lang === "fa" ? "fa" : "en";
}
export function edxSexLabel(locale: EquiDataLocale, value: string | null | undefined): string {
  return horseSexLabel(value, locale);
}

export function edxLifecycleLabel(locale: EquiDataLocale, value: string | null | undefined): string {
  if (!value) return edxUnknown(locale);
  if (locale !== "fa") return value;
  const map: Record<string,string> = { active:"فعال", deceased:"تلف‌شده", inactive:"غیرفعال", imported:"وارداتی", unknown:"نامشخص" };
  return map[value.trim().toLowerCase()] ?? value;
}

export function edxStabilityLabel(locale: EquiDataLocale, value: string): string {
  if (locale !== "fa") return value;
  return ({ core:"هسته", stable:"پایدار", experimental:"آزمایشی", reserved:"رزرو شده" } as Record<string,string>)[value] ?? value;
}

export function edxAccessLabel(locale: EquiDataLocale, value: string): string {
  if (locale !== "fa") return value;
  return ({ public:"عمومی", authenticated:"نیازمند ورود", privileged:"سطح ویژه" } as Record<string,string>)[value] ?? value;
}

export function edxClaimStatusLabel(locale: EquiDataLocale, value: string): string {
  if (locale !== "fa") return value;
  return ({ pending:"در انتظار", approved:"تأییدشده", rejected:"ردشده", withdrawn:"پس‌گرفته‌شده" } as Record<string,string>)[value.trim().toLowerCase()] ?? value;
}

export function edxRegistryFlagLabel(locale: EquiDataLocale, value: string): string {
  if (locale !== "fa") return value.replaceAll("_"," ");
  return ({ imported:"وارداتی", sport:"ورزشی", stallion:"سیلمی", sport_card:"دارای کارت ورزشی" } as Record<string,string>)[value.trim().toLowerCase()] ?? value.replaceAll("_"," ");
}

export function edxQualitySeverityLabel(locale: EquiDataLocale, value: string): string {
  if (locale !== "fa") return value;
  return ({ critical:"بحرانی", high:"زیاد", medium:"متوسط", low:"کم", warning:"هشدار", info:"اطلاع" } as Record<string,string>)[value.trim().toLowerCase()] ?? value;
}

/** R117-21: localized labels for the five separate completeness measures. */
export function edxCompletenessLabel(locale: EquiDataLocale, key: string, fallback: string): string {
  if (locale !== "fa") return fallback;
  return ({ identity:"پوشش فیلدهای هویتی", ancestry:"پوشش تبار ثبت‌شده", evidence:"پوشش شواهد مرتبط", media:"پوشش رسانه", activity:"پوشش فعالیت ثبت‌شده" } as Record<string,string>)[key] ?? fallback;
}

export function edxInsightImportanceLabel(locale: EquiDataLocale, value: string): string {
  if (locale !== "fa") return value;
  return ({ headline:"برجسته", warning:"هشدار", supporting:"تکمیلی", info:"اطلاعات" } as Record<string,string>)[value.trim().toLowerCase()] ?? value;
}

export function edxQualityIssueLabel(locale: EquiDataLocale, value: string): string {
  if (locale !== "fa") return value.replaceAll("_", " ");
  const key=value.trim().toUpperCase();
  return ({
    PARENT_YEAR_CONFLICT:"ناسازگاری سال تولد والد",
    PEDIGREE_CYCLE:"چرخه در تبارنامه",
    BIRTH_YEAR_OUTLIER:"سال تولد غیرعادی",
    SELF_PARENT:"والدِ خودارجاع",
  } as Record<string,string>)[key] ?? value.replaceAll("_", " ");
}

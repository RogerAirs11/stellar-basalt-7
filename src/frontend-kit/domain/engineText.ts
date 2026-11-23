/**
 * R123: shared engine-localization seam.
 *
 * Engines and shared kit surfaces are authored bilingually (EN literal + FA
 * literal at each call site). Arabic is resolved through authored dictionaries
 * keyed by the English string: the kit dictionary (shared panels) first, then
 * the Core uiCopy.ar.json dictionary so platform vocabulary stays consistent
 * across every frontend. Unknown copy remains truthful English — never a fake
 * machine translation.
 *
 * RTL: Farsi and Arabic both render right-to-left; the engine locale contract
 * treats every non-English locale as RTL.
 */
import kitArabic from "./arabicKitCopy.json";
export type { EngineLocale } from "../runtime";
import coreArabic from "../../shared/uiCopy.ar.json";
import type { EngineLocale } from "../runtime";

/** Kit-authored Arabic copy for shared panels and domain helpers. */
export const KIT_ARABIC: Readonly<Record<string, string>> = kitArabic as Readonly<Record<string, string>>;
/** Core-authored Arabic copy (the same dictionary Core's uiText consults). */
export const CORE_ARABIC: Readonly<Record<string, string>> = coreArabic as Readonly<Record<string, string>>;

/** Resolve interface copy for the three-locale engine contract. */
export function kitText(locale: EngineLocale, english: string, persian: string): string {
  if (locale === "en") return english;
  if (locale === "fa") return persian;
  if (Object.hasOwn(KIT_ARABIC, english)) return KIT_ARABIC[english];
  if (Object.hasOwn(CORE_ARABIC, english)) return CORE_ARABIC[english];
  return english;
}

/**
 * Engine dictionary resolver: an engine's authored Arabic copy wins, then the
 * shared kit dictionary, then Core. Engines call this from their own t().
 */
export function kitEngineArabic(engineCopy: Readonly<Record<string, string>>, english: string): string | null {
  if (Object.hasOwn(engineCopy, english)) return engineCopy[english];
  if (Object.hasOwn(KIT_ARABIC, english)) return KIT_ARABIC[english];
  if (Object.hasOwn(CORE_ARABIC, english)) return CORE_ARABIC[english];
  return null;
}

/** Authored template patterns use ${0}, ${1} placeholders for interpolation. */
export type ArabicTemplate = readonly [pattern: string, arabic: string];

/** Match an English string carrying runtime interpolation against ${n}
 *  patterns; returns the Arabic rendering with placeholders substituted. */
export function matchArabicTemplate(patterns: ReadonlyArray<ArabicTemplate>, english: string): string | null {
  for (const [pattern, arabic] of patterns) {
    const values = matchTemplate(pattern, english);
    if (values) return arabic.replace(/\$\{(\d+)\}/g, (_, n) => values[Number(n)] ?? "");
  }
  return null;
}
function matchTemplate(pattern: string, text: string): string[] | null {
  const order: string[] = [];
  let regex = "^";
  let i = 0;
  while (i < pattern.length) {
    const ph = pattern.slice(i).match(/^\$\{(\d+)\}/);
    if (ph) {
      order.push(ph[1]);
      regex += "(.*?)";
      i += ph[0].length;
    } else {
      const next = pattern.indexOf("${", i);
      const chunk = next === -1 ? pattern.slice(i) : pattern.slice(i, next);
      regex += chunk.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      i += chunk.length;
    }
  }
  regex += "$";
  const m = new RegExp(regex).exec(text);
  if (!m) return null;
  const byIndex = new Map<string, string>();
  order.forEach((placeholder, position) => byIndex.set(placeholder, m[position + 1] ?? ""));
  return order.map(placeholder => byIndex.get(placeholder) ?? "");
}

/** RTL for the engine contract: every non-English engine locale is RTL. */
export function kitIsRtl(locale: EngineLocale): boolean {
  return locale === "fa" || locale === "ar";
}

/** Number-format locale tag. Arabic uses Arab-script digits, matching Core. */
export function kitNumberTag(locale: EngineLocale): string {
  return locale === "fa" ? "fa-IR" : locale === "ar" ? "ar-u-nu-arab" : "en-US";
}

/** Localize ASCII digits to the locale's digit system (for identifiers/years). */
export function kitDigits(value: string, locale: EngineLocale): string {
  if (locale === "fa") return value.replace(/\d/g, d => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
  if (locale === "ar") return value.replace(/\d/g, d => "٠١٢٣٤٥٦٧٨٩"[Number(d)]);
  return value;
}

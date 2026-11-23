/**
 * UI language is not a database locale, a calendar, or a content translation.
 * Names, identifiers and user-authored content must never be passed to uiText.
 */
import french from "./uiCopy.fr.json";
import arabic from "./uiCopy.ar.json";

export const UI_LOCALES = ["fa", "en", "ar", "fr"] as const;
export type UiLocale = typeof UI_LOCALES[number];
export const UI_LOCALE_INFO: Readonly<Record<UiLocale, {
  name: string; tag: string; direction: "rtl" | "ltr"; flag: string;
}>> = Object.freeze({
  fa: { name: "فارسی", tag: "fa-IR", direction: "rtl", flag: "🇮🇷" },
  en: { name: "English", tag: "en-US", direction: "ltr", flag: "🇬🇧" },
  ar: { name: "العربية", tag: "ar-u-nu-arab", direction: "rtl", flag: "🇸🇦" },
  fr: { name: "Français", tag: "fr-FR", direction: "ltr", flag: "🇫🇷" },
});
export function isUiLocale(value: unknown): value is UiLocale {
  return typeof value === "string" && (UI_LOCALES as readonly string[]).includes(value);
}
export function parseUiLocale(value: unknown, fallback: UiLocale = "fa"): UiLocale {
  return isUiLocale(value) ? value : fallback;
}
export function isUiRtl(locale: UiLocale): boolean {
  return UI_LOCALE_INFO[locale].direction === "rtl";
}
/** Explicit compatibility boundary for APIs/engines whose contract is still EN/FA. */
export function legacyUiLocale(locale: UiLocale): "en" | "fa" {
  return locale === "fa" ? "fa" : "en";
}
/** R123: engine locale contract — engines speak EN/FA natively and AR through
 *  their dictionaries. FR (and anything else) stays on the disclosed English
 *  fallback until an engine authors a French dictionary. */
export function engineUiLocale(locale: UiLocale): "en" | "fa" | "ar" {
  return locale === "fa" ? "fa" : locale === "ar" ? "ar" : "en";
}
const UI_COPY: Readonly<Record<"fr" | "ar", Readonly<Record<string, string>>>> = { fr: french, ar: arabic };
export function hasUiTranslation(locale: UiLocale, english: string): boolean {
  return locale === "en" || locale === "fa" || Object.hasOwn(UI_COPY[locale], english);
}
/** Only trusted, static interface copy. Unknown copy remains truthful English. */
export function uiText(locale: UiLocale, english: string, persian: string = english): string {
  if (locale === "fa") return persian;
  if (locale === "en") return english;
  return Object.hasOwn(UI_COPY[locale], english) ? UI_COPY[locale][english] : english;
}
export function uiNumberTag(locale: UiLocale): string { return UI_LOCALE_INFO[locale].tag; }

import { kitDigits, kitIsRtl, kitNumberTag, type EngineLocale } from "../../../frontend-kit";

type EquiLocale = EngineLocale;

export function horseName(horse: { id:number; name_latin?:string|null; name_native?:string|null }, locale: EquiLocale): string {
  // Farsi and Arabic both read the native (Persian) name first; English reads the Latin name.
  const nativeFirst = kitIsRtl(locale);
  const id = `#${kitDigits(String(horse.id), locale)}`;
  return (nativeFirst ? horse.name_native || horse.name_latin : horse.name_latin || horse.name_native) || id;
}
export function alternateHorseName(horse: Pick<HorseRecord_alias, "name_latin" | "name_native">, locale: EquiLocale): string | null {
  return (kitIsRtl(locale) ? horse.name_latin : horse.name_native) || null;
}
type HorseRecord_alias = { name_latin?: string | null; name_native?: string | null };
export function pct(value: number | null | undefined, digits = 1, locale?: EquiLocale): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const resolved = locale ?? (typeof document !== "undefined" && document.documentElement.dataset.locale === "fa" ? "fa" : "en");
  const formatted = new Intl.NumberFormat(kitNumberTag(resolved), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
  return `${formatted}${kitIsRtl(resolved) ? "٪" : "%"}`;
}
export function num(value: number | null | undefined, locale: EquiLocale = "en"): string {
  return value == null ? "—" : new Intl.NumberFormat(kitNumberTag(locale)).format(value);
}
export function year(value: number | null | undefined, locale?: EquiLocale): string {
  if (!value) return locale === "fa" ? "نامشخص" : locale === "ar" ? "غير معروف" : "Unknown";
  const resolved = locale ?? (typeof document !== "undefined" && document.documentElement.dataset.locale === "fa" ? "fa" : "en");
  return kitDigits(String(value), resolved);
}
export function text(value: unknown, fallback = "Unknown"): string { return typeof value === "string" && value.trim() ? value : fallback; }

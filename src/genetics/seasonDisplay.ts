import { toGregorian, toSolarHijri, type RegistryDate } from "../registry/dates";

/**
 * R88 agent plan P08 — PURE season display helpers (no server imports).
 *
 * Shared by the client record panels and the API module so the SAME stored
 * Solar Hijri season renders identically everywhere:
 *   EN: "Season 1405 SH (21 Mar 2026 – 20 Mar 2027)"  — Gregorian span
 *   FA: "فصل ۱۴۰۵ (۱ فروردین – ۲۹ اسفند ۱۴۰۵)"        — native span
 * A season is a YEAR, so it is always displayed as an interval; a partial
 * (year/month) covering date maps to a season RANGE, never an invented day.
 */

/** The supported Solar Hijri season range (1970s CE through ~2120s CE). */
export const SOLAR_HIJRI_SEASON_MIN = 1380;
export const SOLAR_HIJRI_SEASON_MAX = 1500;

export interface SeasonInterval {
  /** Inclusive first Gregorian day of the season (ISO YYYY-MM-DD). */
  start: string;
  /** Exclusive day AFTER the last Gregorian day of the season (ISO YYYY-MM-DD). */
  endExclusive: string;
  /** True when the season contains a 30th of Esfand (366 days). */
  leap: boolean;
}

const isoDay = (value: { gy: number; gm: number; gd: number }): string =>
  `${value.gy}-${String(value.gm).padStart(2, "0")}-${String(value.gd).padStart(2, "0")}`;

/** Days in a Solar Hijri season (365 common, 366 in leap years with Esfand 30). */
export function breedingDaysInSeason(season: number): 365 | 366 {
  if (!Number.isInteger(season) || season < SOLAR_HIJRI_SEASON_MIN || season > SOLAR_HIJRI_SEASON_MAX) {
    throw new Error(`Season out of supported Solar Hijri range (${SOLAR_HIJRI_SEASON_MIN}-${SOLAR_HIJRI_SEASON_MAX})`);
  }
  // Count the days between this Nowruz and the next — comparing the Gregorian
  // year of Esfand 29/30 is wrong across the March Nowruz boundary.
  const first = toGregorian(season, 1, 1);
  const next = toGregorian(season + 1, 1, 1);
  const days = Math.round((Date.parse(isoDay(next)) - Date.parse(isoDay(first))) / 86_400_000);
  return days === 366 ? 366 : 365;
}

/** The honest Gregorian interval of a Solar Hijri season: [Nowruz, next Nowruz). */
export function breedingSeasonInterval(season: number): SeasonInterval {
  const days = breedingDaysInSeason(season);
  const first = toGregorian(season, 1, 1);
  const nextNowruz = toGregorian(season + 1, 1, 1);
  return { start: isoDay(first), endExclusive: isoDay(nextNowruz), leap: days === 366 };
}

const GREGORIAN_MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const SH_MONTHS_FA = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"] as const;

function toPersianDigits(text: string): string {
  return text.replace(/[0-9]/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]!);
}

/**
 * Interval-aware, bilingual rendering of a stored Solar Hijri season.
 * Both texts describe the SAME stored season — the Gregorian span in English,
 * the native Solar Hijri span in Persian — never a false single day.
 */
export function formatBreedingSeason(season: number, locale: "en" | "fa"): string {
  const interval = breedingSeasonInterval(season);
  if (locale === "fa") {
    const lastDay = interval.leap ? 30 : 29;
    return `فصل ${toPersianDigits(String(season))} (${toPersianDigits("1")} ${SH_MONTHS_FA[0]} – ${toPersianDigits(String(lastDay))} ${SH_MONTHS_FA[11]} ${toPersianDigits(String(season))})`;
  }
  const [sy, sm, sd] = interval.start.split("-").map(Number);
  const [ey, em, ed] = interval.endExclusive.split("-").map(Number);
  const end = new Date(Date.UTC(ey!, em! - 1, ed!));
  end.setUTCDate(end.getUTCDate() - 1);
  return `Season ${season} SH (${sd} ${GREGORIAN_MONTH_SHORT[sm! - 1]} ${sy} – ${end.getUTCDate()} ${GREGORIAN_MONTH_SHORT[end.getUTCMonth()]} ${end.getUTCFullYear()})`;
}

/** Display helper used by the frontend record panels (season may be NULL). */
export function displaySeasonOrPartial(season: number | null | undefined, locale: "en" | "fa"): string {
  if (season == null) return locale === "fa" ? "فصل نامشخص" : "Season unknown";
  if (!Number.isInteger(season) || season < SOLAR_HIJRI_SEASON_MIN || season > SOLAR_HIJRI_SEASON_MAX) {
    // LIVE FINDING (P08, 2026-10-03): all 48,603 legacy breeding rows carry
    // pre-rule seasons that look Gregorian (2004-2017). They are pending
    // HUMAN review through the correction endpoint — display the raw stored
    // value with an honest label instead of throwing or silently converting.
    return locale === "fa"
      ? `فصل ${toPersianDigits(String(season))} (مقدار قدیمی، نیازمند بازبینی)`
      : `Season ${season} (legacy value, pending review)`;
  }
  return formatBreedingSeason(season, locale);
}

/**
 * A partial covering date (year-only or month-only, either calendar) maps to
 * the Solar Hijri seasons it may belong to — an interval, never an invented
 * day. Returns the honest [min, max] season range.
 */
export function seasonRangeForPartialDate(input: RegistryDate): { min: number; max: number } {
  const asGregorian = (y: number, m: number, d: number) =>
    input.calendar === "solar_hijri" ? toGregorian(y, m, d) : { gy: y, gm: m, gd: d };
  const parts = input.value.split("-").map(Number);
  const year = parts[0]!;
  if (input.precision === "day") {
    const g = asGregorian(year, parts[1]!, parts[2]!);
    const jy = toSolarHijri(g.gy, g.gm, g.gd).jy;
    return { min: jy, max: jy };
  }
  if (input.precision === "month") {
    const month = parts[1]!;
    const lastDay = input.calendar === "solar_hijri"
      ? (month <= 6 ? 31 : month <= 11 ? 30 : (breedingDaysInSeason(year) === 366 ? 30 : 29))
      : new Date(Date.UTC(year, month, 0)).getUTCDate();
    const first = asGregorian(year, month, 1);
    const last = asGregorian(year, month, lastDay);
    return { min: toSolarHijri(first.gy, first.gm, first.gd).jy, max: toSolarHijri(last.gy, last.gm, last.gd).jy };
  }
  // Year precision: the honest span is Farvardin 1 -> Esfand 29/30 (Solar
  // Hijri) or Jan 1 -> Dec 31 (Gregorian). "Esfand 31" does not exist — using
  // it would silently spill into the NEXT season.
  const lastDayOfYear = input.calendar === "solar_hijri" ? (breedingDaysInSeason(year) === 366 ? 30 : 29) : 31;
  const first = asGregorian(year, 1, 1);
  const last = asGregorian(year, 12, lastDayOfYear);
  return { min: toSolarHijri(first.gy, first.gm, first.gd).jy, max: toSolarHijri(last.gy, last.gm, last.gd).jy };
}

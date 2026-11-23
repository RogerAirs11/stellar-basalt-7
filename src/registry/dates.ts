/**
 * Master-Ai plan T12: typed registry dates — value + precision + calendar.
 *
 * The registry must never lie about time. A year-only DOB stays a year
 * (never an invented January 1); a month-only DOB stays a month; the
 * canonical calendar of a stored value is recorded explicitly; and the
 * Persian UI renders Solar Hijri while the English UI renders Gregorian —
 * both from the SAME stored fact; partial dates use ranges when a
 *     source year/month overlaps more than one target calendar year/month.
 *
 * The Solar Hijri (Jalali) conversion below is the standard break-table
 * algorithm (Kazimierz M. Borkowski / Behrooz Kamali's jalaali-js, MIT):
 * the same mathematics used by moment-jalaali and the Persian calendar
 * libraries JavaScript relies on. It is anchored on the 33-year leap cycle
 * and the break years table published in Borkowski's "A Persian Calendar"
 * (1996). Roundtrips are pinned by tests across 1900-2100.
 */

export type DatePrecision = "day" | "month" | "year";
export type CalendarSystem = "gregorian" | "solar_hijri";

/** A registry date: ISO-shaped value truncated to its precision + explicit calendar. */
export interface RegistryDate {
  /** "YYYY" (year), "YYYY-MM" (month) or "YYYY-MM-DD" (day) — never padded beyond its precision. */
  value: string;
  precision: DatePrecision;
  calendar: CalendarSystem;
}

export const REGISTRY_DATE_PRECISIONS: readonly DatePrecision[] = ["day", "month", "year"];
export const REGISTRY_CALENDARS: readonly CalendarSystem[] = ["gregorian", "solar_hijri"];

// ---------------------------------------------------------------------------
// Solar Hijri <-> Gregorian conversion (jalaali algorithm).
// ---------------------------------------------------------------------------

const div = (a: number, b: number): number => ~~(a / b);
const mod = (a: number, b: number): number => a - ~~(a / b) * b;

const BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];

function jalCal(jy: number): { leap: number; gy: number; march: number } {
  let leapJ = -14;
  let jp = BREAKS[0]!;
  let jump = 0;
  for (let i = 1; i < BREAKS.length; i += 1) {
    const jm = BREAKS[i]!;
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const gy = jy + 621;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}

/** Gregorian to Julian Day Number. */
function g2d(gy: number, gm: number, gd: number): number {
  let d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

/** Julian Day Number to Gregorian. */
function d2g(jdn: number): { gy: number; gm: number; gd: number } {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

export interface SolarHijriDate { jy: number; jm: number; jd: number; }

/** Gregorian (proleptic, CE) to Solar Hijri. */
export function toSolarHijri(gy: number, gm: number, gd: number): SolarHijriDate {
  const jdn = g2d(gy, gm, gd);
  let jy = d2g(jdn).gy - 621;
  const r = jalCal(jy);
  const jdn1f = g2d(r.gy, 3, r.march);
  let k = jdn - jdn1f;
  if (k >= 0) {
    if (k <= 185) return { jy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 };
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  return { jy, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 };
}

/** Solar Hijri to Gregorian. */
export function toGregorian(jy: number, jm: number, jd: number): { gy: number; gm: number; gd: number } {
  const r = jalCal(jy);
  return d2g(g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1);
}

/** Is the given Solar Hijri year a leap year (Esfand 30)? */
export function isSolarHijriLeapYear(jy: number): boolean {
  return jalCal(jy).leap === 0;
}

/** Gregorian leap year (for validating Feb 29). */
export function isGregorianLeapYear(gy: number): boolean {
  return (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0;
}

// ---------------------------------------------------------------------------
// Precision-typed parsing + validation.
// ---------------------------------------------------------------------------

export type DateParseIssue =
  | "invalid_format"
  | "invalid_calendar"
  | "invalid_precision"
  | "invalid_date"
  | "date_out_of_range";

export type ParsedRegistryDate =
  | { ok: true; date: RegistryDate; gregorianYear: number }
  | { ok: false; issue: DateParseIssue; message: string };

export interface RegistryDateInput {
  value: unknown;
  precision: unknown;
  calendar: unknown;
}

const GREGORIAN_DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function gregorianDaysInMonth(gy: number, gm: number): number {
  if (gm === 2 && isGregorianLeapYear(gy)) return 29;
  return GREGORIAN_DAYS_IN_MONTH[gm - 1]!;
}

function solarHijriDaysInMonth(jy: number, jm: number): number {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return isSolarHijriLeapYear(jy) ? 30 : 29;
}

/**
 * Parse + validate a registry date at its declared precision. The returned
 * canonical value is TRUNCATED to the precision — a year-only input can never
 * produce a month or day, so no "January 1" is ever invented by storage.
 */
export function parseRegistryDate(input: RegistryDateInput, maxGregorianYear: number): ParsedRegistryDate {
  const calendar = String(input.calendar ?? "gregorian");
  if (!REGISTRY_CALENDARS.includes(calendar as CalendarSystem)) {
    return { ok: false, issue: "invalid_calendar", message: "Calendar must be 'gregorian' or 'solar_hijri'" };
  }
  const precision = String(input.precision ?? "day");
  if (!REGISTRY_DATE_PRECISIONS.includes(precision as DatePrecision)) {
    return { ok: false, issue: "invalid_precision", message: "Precision must be 'day', 'month' or 'year'" };
  }
  const text = String(input.value ?? "").trim();
  const yearOnly = /^(\d{4})$/.exec(text);
  const yearMonth = /^(\d{4})-(\d{2})$/.exec(text);
  const full = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (precision === "year" && !yearOnly) {
    return { ok: false, issue: "invalid_format", message: "Year precision expects exactly 'YYYY'" };
  }
  if (precision === "month" && !yearMonth) {
    return { ok: false, issue: "invalid_format", message: "Month precision expects exactly 'YYYY-MM'" };
  }
  if (precision === "day" && !full) {
    return { ok: false, issue: "invalid_format", message: "Day precision expects exactly 'YYYY-MM-DD'" };
  }

  let gy: number;
  if (precision === "year") {
    if (calendar === "solar_hijri") {
      gy = toGregorian(Number(yearOnly![1]), 1, 1).gy;
    } else {
      gy = Number(yearOnly![1]);
    }
  } else if (precision === "month") {
    const y = Number(yearMonth![1]);
    const m = Number(yearMonth![2]);
    if (m < 1 || m > 12) return { ok: false, issue: "invalid_date", message: "Month is out of range" };
    if (calendar === "solar_hijri") {
      const g = toGregorian(y, m, 1);
      gy = g.gy;
    } else {
      gy = y;
    }
  } else {
    const y = Number(full![1]);
    const m = Number(full![2]);
    const d = Number(full![3]);
    if (m < 1 || m > 12) return { ok: false, issue: "invalid_date", message: "Month is out of range" };
    const daysInMonth = calendar === "solar_hijri" ? solarHijriDaysInMonth(y, m) : gregorianDaysInMonth(y, m);
    if (d < 1 || d > daysInMonth) {
      return { ok: false, issue: "invalid_date", message: `Day is out of range for this month (${daysInMonth} days)` };
    }
    if (calendar === "solar_hijri") {
      const g = toGregorian(y, m, d);
      gy = g.gy;
    } else {
      gy = y;
    }
  }

  if (gy < 1500 || gy > maxGregorianYear) {
    return { ok: false, issue: "date_out_of_range", message: `Year is out of range (1500-${maxGregorianYear})` };
  }
  return { ok: true, date: { value: text, precision: precision as DatePrecision, calendar: calendar as CalendarSystem }, gregorianYear: gy };
}

// ---------------------------------------------------------------------------
// Display: same stored fact, rendered per locale calendar.
// ---------------------------------------------------------------------------

export const SOLAR_HIJRI_MONTH_NAMES_FA = [
  "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
] as const;

export const GREGORIAN_MONTHS_EN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

export interface FormattedRegistryDate {
  /** Localized digits + month name, e.g. "۱۴۰۵" or "March 2019" or "۱۴۰۵/۰۷/۱۱". */
  text: string;
  /** Honesty label for the precision, e.g. "year only" / "فقط سال". */
  precisionLabel: string;
  /** Which calendar the text is expressed in. */
  calendar: CalendarSystem;
}

function toPersianDigits(text: string): string {
  return text.replace(/[0-9]/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]!);
}

/** Partial calendar periods cannot be converted to a single target period.
 * Example: Gregorian 2019 spans Solar Hijri 1397 and 1398. Never invent a DOB
 * by anchoring an unknown date on the first day of the source period.
 */
export function formatRegistryDate(
  date: RegistryDate,
  outputCalendar: CalendarSystem,
  locale: "en" | "fa",
): FormattedRegistryDate {
  const labels: Record<DatePrecision, { en: string; fa: string }> = {
    day: { en: "exact date", fa: "\u062a\u0627\u0631\u06cc\u062e \u062f\u0642\u06cc\u0642" },
    month: { en: "month only", fa: "\u0641\u0642\u0637 \u0645\u0627\u0647" },
    year: { en: "year only", fa: "\u0641\u0642\u0637 \u0633\u0627\u0644" },
  };
  const precisionLabel = labels[date.precision][locale];
  const digits = (value: string) => locale === "fa" ? toPersianDigits(value) : value;
  const shMonthsEn = ["Farvardin", "Ordibehesht", "Khordad", "Tir", "Mordad", "Shahrivar", "Mehr", "Aban", "Azar", "Dey", "Bahman", "Esfand"];
  const monthLabel = (y: number, m: number) => {
    const name = outputCalendar === "solar_hijri"
      ? (locale === "fa" ? SOLAR_HIJRI_MONTH_NAMES_FA[m - 1] : shMonthsEn[m - 1])
      : GREGORIAN_MONTHS_EN[m - 1];
    return `${name} ${digits(String(y))}`;
  };
  const convert = (y: number, m: number, d: number): [number, number, number] => {
    if (date.calendar === outputCalendar) return [y, m, d];
    if (date.calendar === "solar_hijri") {
      const g = toGregorian(y, m, d); return [g.gy, g.gm, g.gd];
    }
    const j = toSolarHijri(y, m, d); return [j.jy, j.jm, j.jd];
  };
  const [year, month = 1, day = 1] = date.value.split("-").map(Number);
  if (date.precision === "day") {
    const [y, m, d] = convert(year!, month, day);
    const text = date.calendar === outputCalendar
      ? digits(date.value)
      : outputCalendar === "solar_hijri" && locale === "fa"
        ? `${digits(String(d))} ${monthLabel(y, m)}`
        : digits(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    return { text, precisionLabel, calendar: outputCalendar };
  }
  const lastMonth = date.precision === "year" ? 12 : month;
  const lastDay = date.calendar === "solar_hijri" ? solarHijriDaysInMonth(year!, lastMonth) : gregorianDaysInMonth(year!, lastMonth);
  const start = convert(year!, date.precision === "year" ? 1 : month, 1);
  const end = convert(year!, lastMonth, lastDay);
  const format = (value: [number, number, number]) => date.precision === "year" ? digits(String(value[0])) : monthLabel(value[0], value[1]);
  const firstText = format(start), lastText = format(end);
  return { text: firstText === lastText ? firstText : `${firstText} \u2013 ${lastText}`, precisionLabel, calendar: outputCalendar };
}

/**
 * Age (in whole Gregorian years) from a registry date, honest to precision:
 * day-precision computes an exact age; month/year precision return the
 * possible age RANGE as [min, max] so a year-only DOB never claims a false
 * exact age.
 */
export function registryAgeRange(date: RegistryDate, today: { gy: number; gm: number; gd: number }): { min: number; max: number } {
  const asGregorian = (y: number, m: number, d: number): { gy: number; gm: number; gd: number } =>
    date.calendar === "solar_hijri" ? toGregorian(y, m, d) : { gy: y, gm: m, gd: d };
  if (date.precision === "day") {
    const [y, m, d] = date.value.split("-").map(Number);
    const g = asGregorian(y, m, d);
    const age = ageFromGregorian(g, today);
    return { min: age, max: age };
  }
  if (date.precision === "month") {
    const [y, m] = date.value.split("-").map(Number);
    const lastDay = date.calendar === "solar_hijri" ? solarHijriDaysInMonth(y, m) : gregorianDaysInMonth(y, m);
    // Oldest possible person was born on the 1st (max age); youngest on the
    // last day (min age).
    const max = ageFromGregorian(asGregorian(y, m, 1), today);
    const min = ageFromGregorian(asGregorian(y, m, lastDay), today);
    return { min, max };
  }
  const y = Number(date.value);
  // Year-only: oldest possible born on Jan 1 (or Farvardin 1), youngest born
  // on Dec 31 (or Esfand 29/30). A year-only DOB never claims a false exact age.
  const lastMonthDay = date.calendar === "solar_hijri" ? solarHijriDaysInMonth(y, 12) : 31;
  const max = ageFromGregorian(asGregorian(y, 1, 1), today);
  const min = ageFromGregorian(asGregorian(y, 12, lastMonthDay), today);
  return { min, max };
}

function ageFromGregorian(birth: { gy: number; gm: number; gd: number }, today: { gy: number; gm: number; gd: number }): number {
  let age = today.gy - birth.gy;
  if (today.gm < birth.gm || (today.gm === birth.gm && today.gd < birth.gd)) age -= 1;
  return Math.max(0, age);
}

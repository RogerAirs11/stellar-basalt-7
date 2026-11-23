import { describe, expect, it } from "vitest";
import {
  formatRegistryDate,
  isSolarHijriLeapYear,
  parseRegistryDate,
  registryAgeRange,
  toGregorian,
  toSolarHijri,
  type ParsedRegistryDate,
  type RegistryDate,
} from "../../src/registry/dates";

/**
 * Master-Ai plan T12: typed registry dates. These fixtures pin:
 *   - the Solar Hijri <-> Gregorian conversion (roundtrips 1900-2100 +
 *     known historical anchors);
 *   - precision preservation: a year-only DOB NEVER becomes an invented
 *     January 1 (or Farvardin 1);
 *   - invalid dates (Feb 30, month 13, day 32) rejected at parse;
 *   - future/out-of-range dates rejected;
 *   - Persian UI rendering in Solar Hijri and English in Gregorian from the
 *     SAME stored fact;
 *   - honest age ranges for imprecise dates.
 */

const MAX_YEAR = new Date().getUTCFullYear() + 1;
const issueOf = (result: ParsedRegistryDate): string | null => (result.ok ? null : result.issue);

describe("Solar Hijri <-> Gregorian conversion (T12 step 1)", () => {
  it("matches known historical anchors", () => {
    // 22 Bahman 1357 — the Iranian Revolution.
    expect(toSolarHijri(1979, 2, 11)).toEqual({ jy: 1357, jm: 11, jd: 22 });
    expect(toGregorian(1357, 11, 22)).toEqual({ gy: 1979, gm: 2, gd: 11 });
    // Nowruz 1400.
    expect(toSolarHijri(2021, 3, 21)).toEqual({ jy: 1400, jm: 1, jd: 1 });
    expect(toGregorian(1400, 1, 1)).toEqual({ gy: 2021, gm: 3, gd: 21 });
    // Nowruz 1399 (2020 was a leap-start year: Farvardin 1 on March 20).
    expect(toSolarHijri(2020, 3, 20)).toEqual({ jy: 1399, jm: 1, jd: 1 });
    // Nowruz 1404.
    expect(toSolarHijri(2025, 3, 21)).toEqual({ jy: 1404, jm: 1, jd: 1 });
    // The day this batch was authored (2026-10-03 = 11 Mehr 1405).
    expect(toSolarHijri(2026, 10, 3)).toEqual({ jy: 1405, jm: 7, jd: 11 });
    expect(toGregorian(1405, 7, 11)).toEqual({ gy: 2026, gm: 10, gd: 3 });
  });

  it("roundtrips every single day across 1900-2100 without drift", () => {
    // Convert via day-number stepping: iterate the whole range once.
    const { gy: startY, gm: startM, gd: startD } = { gy: 1900, gm: 1, gd: 1 };
    let gy = startY, gm = startM, gd = startD;
    const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
    let checked = 0;
    while (gy <= 2100) {
      const j = toSolarHijri(gy, gm, gd);
      const back = toGregorian(j.jy, j.jm, j.jd);
      expect(back).toEqual({ gy, gm, gd });
      checked += 1;
      gd += 1;
      if (gd > daysInMonth(gy, gm)) { gd = 1; gm += 1; }
      if (gm > 12) { gm = 1; gy += 1; }
    }
    expect(checked).toBeGreaterThan(73000); // sanity: the full range was walked
  });

  it("identifies Solar Hijri leap years (Esfand 30) correctly", () => {
    // Known leap years in the current cycle: 1399, 1403, 1408.
    expect(isSolarHijriLeapYear(1399)).toBe(true);
    expect(isSolarHijriLeapYear(1403)).toBe(true);
    expect(isSolarHijriLeapYear(1408)).toBe(true);
    expect(isSolarHijriLeapYear(1404)).toBe(false);
    expect(isSolarHijriLeapYear(1405)).toBe(false);
    // A leap year's Esfand has 30 days and converts back cleanly.
    expect(toGregorian(1403, 12, 30)).toEqual({ gy: 2025, gm: 3, gd: 20 });
  });
});

describe("precision-preserving parsing (T12 acceptance: no invented January 1)", () => {
  it("stores a year-only DOB as exactly the year", () => {
    const parsed = parseRegistryDate({ value: "2019", precision: "year", calendar: "gregorian" }, MAX_YEAR);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.date.value).toBe("2019");
    expect(parsed.date.precision).toBe("year");
    // A year can never smuggle a month/day into storage.
    expect(parsed.date.value).not.toContain("-");
  });

  it("stores a month-only DOB as exactly year-month", () => {
    const parsed = parseRegistryDate({ value: "2019-06", precision: "month", calendar: "gregorian" }, MAX_YEAR);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.date.value).toBe("2019-06");
  });

  it("accepts a full day and records the calendar explicitly", () => {
    const parsed = parseRegistryDate({ value: "2019-06-15", precision: "day", calendar: "gregorian" }, MAX_YEAR);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.date.value).toBe("2019-06-15");
      expect(parsed.date.calendar).toBe("gregorian");
    }
    const sh = parseRegistryDate({ value: "1398-03-25", precision: "day", calendar: "solar_hijri" }, MAX_YEAR);
    expect(sh.ok).toBe(true);
    if (sh.ok) expect(sh.date.calendar).toBe("solar_hijri");
  });

  it("rejects mismatched precision/format pairs", () => {
    expect(parseRegistryDate({ value: "2019-06-15", precision: "year", calendar: "gregorian" }, MAX_YEAR).ok).toBe(false);
    expect(parseRegistryDate({ value: "2019", precision: "month", calendar: "gregorian" }, MAX_YEAR).ok).toBe(false);
    expect(parseRegistryDate({ value: "2019-06", precision: "day", calendar: "gregorian" }, MAX_YEAR).ok).toBe(false);
  });

  it("rejects invalid dates (T12 required evidence: invalid dates)", () => {
    expect(issueOf(parseRegistryDate({ value: "2019-02-30", precision: "day", calendar: "gregorian" }, MAX_YEAR))).toBe("invalid_date");
    expect(issueOf(parseRegistryDate({ value: "2019-13-01", precision: "day", calendar: "gregorian" }, MAX_YEAR))).toBe("invalid_date");
    expect(issueOf(parseRegistryDate({ value: "2019-01-32", precision: "day", calendar: "gregorian" }, MAX_YEAR))).toBe("invalid_date");
    // Leap-day honesty: 2019 is not a Gregorian leap year.
    expect(issueOf(parseRegistryDate({ value: "2019-02-29", precision: "day", calendar: "gregorian" }, MAX_YEAR))).toBe("invalid_date");
    // But 2024 is.
    expect(parseRegistryDate({ value: "2024-02-29", precision: "day", calendar: "gregorian" }, MAX_YEAR).ok).toBe(true);
    // Solar Hijri: Esfand 30 only in leap years (1403 is leap, 1404 is not).
    expect(parseRegistryDate({ value: "1403-12-30", precision: "day", calendar: "solar_hijri" }, MAX_YEAR).ok).toBe(true);
    expect(issueOf(parseRegistryDate({ value: "1404-12-30", precision: "day", calendar: "solar_hijri" }, MAX_YEAR))).toBe("invalid_date");
  });

  it("rejects future and out-of-range dates (T12 required evidence: future DOB)", () => {
    const far = parseRegistryDate({ value: String(MAX_YEAR + 5), precision: "year", calendar: "gregorian" }, MAX_YEAR);
    expect(issueOf(far)).toBe("date_out_of_range");
    const ancient = parseRegistryDate({ value: "1200", precision: "year", calendar: "gregorian" }, MAX_YEAR);
    expect(issueOf(ancient)).toBe("date_out_of_range");
    // Boundary: exactly the allowed maximum year passes.
    expect(parseRegistryDate({ value: String(MAX_YEAR), precision: "year", calendar: "gregorian" }, MAX_YEAR).ok).toBe(true);
  });

  it("rejects unknown calendars and precisions", () => {
    expect(issueOf(parseRegistryDate({ value: "2019", precision: "year", calendar: "lunar_hijri" }, MAX_YEAR))).toBe("invalid_calendar");
    expect(issueOf(parseRegistryDate({ value: "2019", precision: "decade", calendar: "gregorian" }, MAX_YEAR))).toBe("invalid_precision");
  });
});

describe("display projection (T12: Solar Hijri in Persian UI)", () => {
  it("renders the SAME stored fact per locale calendar without losing precision", () => {
    const stored: RegistryDate = { value: "2026-10-03", precision: "day", calendar: "gregorian" };
    const fa = formatRegistryDate(stored, "solar_hijri", "fa");
    expect(fa.text).toContain("۱۱");
    expect(fa.text).toContain("مهر");
    expect(fa.text).toContain("۱۴۰۵");
    expect(fa.calendar).toBe("solar_hijri");
    const en = formatRegistryDate(stored, "gregorian", "en");
    expect(en.text).toBe("2026-10-03");
  });

  it("keeps the original year and shows a range when calendars overlap", () => {
    const stored: RegistryDate = { value: "2019", precision: "year", calendar: "gregorian" };
    const fa = formatRegistryDate(stored, "solar_hijri", "fa");
    // 2019 Gregorian spans both years. Choosing only one invents precision.
    expect(fa.text).toBe("۱۳۹۷ – ۱۳۹۸");
    expect(fa.precisionLabel).toBe("فقط سال");
    const en = formatRegistryDate(stored, "gregorian", "en");
    expect(en.text).toBe("2019");
    expect(en.precisionLabel).toBe("year only");
  });

  it("renders a Solar-Hijri month-only value in Gregorian months for English", () => {
    const stored: RegistryDate = { value: "1405-07", precision: "month", calendar: "solar_hijri" };
    const en = formatRegistryDate(stored, "gregorian", "en");
    expect(en.text).toContain("September");
    expect(en.text).toContain("2026");
    const fa = formatRegistryDate(stored, "solar_hijri", "fa");
    expect(fa.text).toContain("مهر");
    expect(fa.text).toContain("۱۴۰۵");
  });
});

describe("honest age ranges (T12: no false exact age from imprecise dates)", () => {
  const TODAY = { gy: 2026, gm: 10, gd: 3 };

  it("computes an exact age only for day precision", () => {
    const stored: RegistryDate = { value: "2019-06-15", precision: "day", calendar: "gregorian" };
    const age = registryAgeRange(stored, TODAY);
    expect(age.min).toBe(age.max);
    expect(age.min).toBe(7);
  });

  it("returns a RANGE for a year-only DOB (T12 acceptance)", () => {
    const stored: RegistryDate = { value: "2019", precision: "year", calendar: "gregorian" };
    const age = registryAgeRange(stored, TODAY);
    expect(age.min).toBe(6);
    expect(age.max).toBe(7);
    expect(age.min).toBeLessThan(age.max);
  });

  it("narrows the range for month precision", () => {
    const stored: RegistryDate = { value: "2019-06", precision: "month", calendar: "gregorian" };
    const age = registryAgeRange(stored, TODAY);
    expect(age.min).toBe(7);
    expect(age.max).toBe(7);
    const january = registryAgeRange({ value: "2019-01", precision: "month", calendar: "gregorian" }, TODAY);
    expect(january.min).toBe(7);
    expect(january.max).toBe(7);
  });

  it("computes honest ages from Solar Hijri stored dates too", () => {
    const stored: RegistryDate = { value: "1398-03-25", precision: "day", calendar: "solar_hijri" };
    // 25 Khordad 1398 = 15 June 2019.
    const age = registryAgeRange(stored, TODAY);
    expect(age.min).toBe(7);
    expect(age.max).toBe(7);
  });

  it("never returns a negative age for future-ish boundary dates", () => {
    const stored: RegistryDate = { value: String(TODAY.gy), precision: "year", calendar: "gregorian" };
    const age = registryAgeRange(stored, TODAY);
    expect(age.min).toBe(0);
    expect(age.max).toBeGreaterThanOrEqual(0);
  });
});

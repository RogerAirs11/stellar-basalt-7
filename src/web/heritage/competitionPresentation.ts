/** Calendar labels are derived with the Persian calendar, not a March-21 guess. */
export function persianYearAt(now: Date = new Date()): number | null {
  if (!Number.isFinite(now.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-u-ca-persian-nu-latn", { year: "numeric", timeZone: "Asia/Tehran" }).formatToParts(now);
    const value = Number(parts.find(part => part.type === "year")?.value);
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch { return null; } // Unsupported calendar: omit suggestions, never invent a date.
}
export const COMPETITION_PAGE_SIZE = 8;
export const MAX_COMPETITION_OFFSET = 100_000;
export function competitionId(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" && /^[1-9]\d*$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

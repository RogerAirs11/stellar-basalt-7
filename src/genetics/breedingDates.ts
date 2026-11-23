import { HttpError } from "../api/http";
import { parseRegistryDate, toSolarHijri } from "../registry/dates";
import { SOLAR_HIJRI_SEASON_MAX, SOLAR_HIJRI_SEASON_MIN } from "./seasonDisplay";

/**
 * R88 agent plan P08 — reproduction/calendar semantics.
 *
 * CANONICAL STORAGE RULES (docs/r88/P08-BREEDING-DATE-SEMANTICS.md):
 *  - breeding_records.covering_date is an ISO Gregorian DAY-precision date,
 *    validated on every write path. A partial (year/month) covering date is
 *    stored by leaving covering_date NULL and recording the Solar Hijri
 *    season instead — no invented January 1.
 *  - breeding_records.season is a SOLAR HIJRI year (1380-1500). It is never a
 *    Gregorian year and never inferred from the UI locale: an English form
 *    submits the same Gregorian covering date a Persian form does.
 *  - Historical rows that predate these rules are NEVER mass-converted.
 *    Anomalies are surfaced read-only (tools/audit-breeding-dates.mjs) and
 *    corrected one by one through POST /api/admin/breeding/:id/correct,
 *    which writes an audit_events row carrying the old values.
 *
 * Pure interval/display helpers live in ./seasonDisplay (no server imports)
 * so client bundles share the exact same rendering.
 */

/** API date-only input is explicitly Gregorian, never guessed from the UI language. */
export function validateGregorianDay(value: string): void {
  const parsed = parseRegistryDate({ value, precision: "day", calendar: "gregorian" }, 2200);
  if (!parsed.ok) throw new HttpError(400, "invalid_date", parsed.message);
}

/** Existing season column is Solar Hijri. Do not store a Gregorian year in it. */
export function resolveBreedingSeason(coveringDate?: string | null, explicitSeason?: number | null): number {
  if (explicitSeason != null && (!Number.isInteger(explicitSeason) || explicitSeason < SOLAR_HIJRI_SEASON_MIN || explicitSeason > SOLAR_HIJRI_SEASON_MAX)) {
    throw new HttpError(400, "invalid_breeding", `Season must be a Solar Hijri year between ${SOLAR_HIJRI_SEASON_MIN} and ${SOLAR_HIJRI_SEASON_MAX}`);
  }
  let derived: number | null = null;
  if (coveringDate) {
    validateGregorianDay(coveringDate);
    const [year, month, day] = coveringDate.split("-").map(Number);
    derived = toSolarHijri(year!, month!, day!).jy;
    if (derived < SOLAR_HIJRI_SEASON_MIN || derived > SOLAR_HIJRI_SEASON_MAX) throw new HttpError(400, "invalid_breeding", "Covering date falls outside the supported Solar Hijri seasons");
  }
  if (derived != null && explicitSeason != null && derived !== explicitSeason) {
    throw new HttpError(400, "season_date_mismatch", "Season must match the Solar Hijri year of the Gregorian covering date");
  }
  const season = explicitSeason ?? derived;
  if (season == null) throw new HttpError(400, "invalid_breeding", "Provide a Solar Hijri season or a Gregorian covering_date");
  return season;
}

export { breedingDaysInSeason, breedingSeasonInterval, displaySeasonOrPartial, formatBreedingSeason, seasonRangeForPartialDate, SOLAR_HIJRI_SEASON_MAX, SOLAR_HIJRI_SEASON_MIN } from "./seasonDisplay";

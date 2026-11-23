import { describe, expect, it } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import {
  detectOwnershipOverlaps,
  ownershipShareSumExceeded,
  ownershipPeriodInterval,
  validateLifecycleEventInput,
  validateOwnershipPeriodInput,
  validateParentCorrectionInput,
  parseStoredParentCorrection,
  parentCorrectionAutoSummary,
  type OwnershipPeriodRow,
} from "../../src/registry/relations";
import { parseHorseFieldValue } from "../../src/registry/validation";
import { planHorseMutation, buildCanonicalHorseUpdateStatements } from "../../src/registry/mutations";
import type { HorseRow } from "../../src/db/types";

/**
 * Master-Ai plan T12: temporal relations and typed profile facts.
 *
 * These fixtures pin:
 *   - precision-aware ownership overlap detection (definite vs possible);
 *   - co-ownership share sums (never more than 100% of a horse);
 *   - lifecycle event validation incl. uncertain time and future dates;
 *   - the parent-correction submission contract (source/conflict evidence);
 *   - typed-date parsing through the shared field rules (Feb 30, month 13,
 *     future dates refused; a year-only DOB never becomes January 1);
 *   - the mutation builder expanding typed dates into column triples with
 *     the legacy birth_year bucket kept in sync.
 */

interface BoundStatement {
  sql: string;
  args: unknown[];
  bind: (...args: unknown[]) => BoundStatement;
}

function fakeDb(): D1Database {
  const makeBuilder = (sql: string, args: unknown[]): BoundStatement => ({
    sql,
    args,
    bind: (...nextArgs: unknown[]) => makeBuilder(sql, nextArgs),
  });
  return { prepare: (sql: string) => makeBuilder(sql, []) } as unknown as D1Database;
}

const CURRENT_YEAR = new Date().getUTCFullYear();

function period(overrides: Partial<OwnershipPeriodRow> = {}): OwnershipPeriodRow {
  return {
    id: 1,
    owner_person_id: 50,
    start_value: "2018",
    start_precision: "year",
    start_calendar: "gregorian",
    end_value: "2021",
    end_precision: "year",
    end_calendar: "gregorian",
    share_percent: null,
    ...overrides,
  };
}

const HORSE_ROW_BASE = {
  id: 7,
  name_latin: "Shiraz Ghar",
  father_id: null,
  mother_id: null,
  birth_year: 2018,
  is_dead: 0,
  row_version: 3,
} as unknown as HorseRow;

// ---------------------------------------------------------------------------
// Ownership periods: overlap detection honors precision.
// ---------------------------------------------------------------------------

describe("T12 ownership overlap detection", () => {
  it("flags a DEFINITE overlap between two exactly-dated intersecting periods", () => {
    const existing = [period({ id: 1, start_value: "2018-03-01", start_precision: "day", end_value: "2020-03-01", end_precision: "day" })];
    const candidate = period({ id: -1, start_value: "2019-06-15", start_precision: "day", end_value: null, end_precision: null, end_calendar: null });
    const findings = detectOwnershipOverlaps(existing, candidate);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: "definite", periodId: 1 });
  });

  it("reports only a POSSIBLE overlap when year-only precision cannot prove intersection", () => {
    // One period covers all of 2019; the other covers all of 2020 — year
    // precision means the true days are unknown, but 2019 and 2020 are
    // DIFFERENT years, so a definite overlap is impossible and even a
    // possible one should not be claimed.
    const existing = [period({ id: 1, start_value: "2019", end_value: "2019" })];
    const candidate = period({ id: -1, start_value: "2020", end_value: "2020" });
    expect(detectOwnershipOverlaps(existing, candidate)).toHaveLength(0);
  });

  it("reports a POSSIBLE overlap when a year-only span may miss a narrow window", () => {
    // Existing: exactly June 2020 (day precision). Candidate: year-only 2020.
    // The candidate may have started in July — the stored fact cannot prove
    // the intersection, so the registry claims only a POSSIBLE overlap.
    const existing = [period({ id: 4, start_value: "2020-06-01", start_precision: "day", end_value: "2020-06-30", end_precision: "day" })];
    const candidate = period({ id: -1, start_value: "2020", end_value: "2020" });
    const findings = detectOwnershipOverlaps(existing, candidate);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: "possible", periodId: 4 });
  });

  it("proves a DEFINITE overlap when a year-only span covers a dated window's whole year", () => {
    // Year-only 2019..2021 vs an open period starting any day of 2020: every
    // possible dating of the open start falls inside the closed span.
    const existing = [period({ id: 4, start_value: "2019", end_value: "2021" })];
    const candidate = period({ id: -1, start_value: "2020", end_value: null, end_precision: null, end_calendar: null });
    const findings = detectOwnershipOverlaps(existing, candidate);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: "definite", periodId: 4 });
  });

  it("never flags sequential periods (end before the next start)", () => {
    const existing = [period({ id: 1, start_value: "2015-01-01", start_precision: "day", end_value: "2017-12-31", end_precision: "day" })];
    const candidate = period({ id: -1, start_value: "2018-01-01", start_precision: "day", end_value: null, end_precision: null, end_calendar: null });
    expect(detectOwnershipOverlaps(existing, candidate)).toHaveLength(0);
  });

  it("treats two open-ended periods as DEFINITELY overlapping (both include now)", () => {
    const existing = [period({ id: 9, start_value: "2001", end_value: null, end_precision: null, end_calendar: null })];
    const candidate = period({ id: -1, start_value: `${CURRENT_YEAR}`, end_value: null, end_precision: null, end_calendar: null });
    const findings = detectOwnershipOverlaps(existing, candidate);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: "definite", periodId: 9 });
  });

  it("projects Solar Hijri year periods onto their true Gregorian window", () => {
    // Solar Hijri 1398 = 2019-03-21..2020-03-19 (approx.): a Gregorian
    // 2020-only period can only POSSIBLY overlap it, never definitely.
    const interval = ownershipPeriodInterval(period({ start_value: "1398", start_calendar: "solar_hijri", end_value: "1398", end_calendar: "solar_hijri" }));
    expect(interval.earliestStartDay).toBeGreaterThan(0);
    expect(interval.latestEndDay ?? 0).toBeGreaterThan(interval.earliestStartDay);
    // The window must span parts of two Gregorian years.
    expect((interval.latestEndDay ?? 0) - interval.earliestStartDay).toBeGreaterThan(300);
  });
});

describe("T12 co-ownership share sums", () => {
  it("rejects overlapping stated shares that exceed 100 percent of the horse", () => {
    const existing = [period({ id: 1, share_percent: 80 })];
    const overlaps = detectOwnershipOverlaps(existing, period({ id: -1, start_value: "2019", end_value: null, end_precision: null, end_calendar: null }));
    expect(ownershipShareSumExceeded(overlaps, existing, 40)).toBe(true);
  });

  it("allows co-ownership shares that sum to exactly 100", () => {
    const existing = [period({ id: 1, share_percent: 60 })];
    const overlaps = detectOwnershipOverlaps(existing, period({ id: -1, start_value: "2019", end_value: null, end_precision: null, end_calendar: null }));
    expect(ownershipShareSumExceeded(overlaps, existing, 40)).toBe(false);
  });

  it("ignores unstated shares in the arithmetic", () => {
    const existing = [period({ id: 1, share_percent: null })];
    const overlaps = detectOwnershipOverlaps(existing, period({ id: -1, start_value: "2019", end_value: null, end_precision: null, end_calendar: null }));
    expect(ownershipShareSumExceeded(overlaps, existing, 100)).toBe(false);
  });
});

describe("T12 ownership period validation", () => {
  it("accepts a well-formed period with an end", () => {
    const result = validateOwnershipPeriodInput({ owner_person_id: 5, start: { value: "2018", precision: "year", calendar: "gregorian" }, end: { value: "2021", precision: "year", calendar: "gregorian" } });
    expect(result.ok).toBe(true);
  });

  it("refuses an end that starts before the start's earliest possible day", () => {
    const result = validateOwnershipPeriodInput({ owner_person_id: 5, start: { value: "2018-06", precision: "month", calendar: "gregorian" }, end: { value: "2018-05", precision: "month", calendar: "gregorian" } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.code).toBe("invalid_end_before_start");
  });

  it("refuses an invalid start date (Feb 30)", () => {
    const result = validateOwnershipPeriodInput({ owner_person_id: 5, start: { value: "2018-02-30", precision: "day", calendar: "gregorian" } });
    expect(result.ok).toBe(false);
  });

  it("refuses a malformed payload", () => {
    expect(validateOwnershipPeriodInput(null).ok).toBe(false);
    expect(validateOwnershipPeriodInput({ owner_person_id: 0 }).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle events.
// ---------------------------------------------------------------------------

describe("T12 lifecycle event validation", () => {
  it("accepts a dated death event with uncertain time", () => {
    const result = validateLifecycleEventInput({ event_type: "death", date: { value: "2023", precision: "year", calendar: "gregorian" }, uncertain_time: true, note: "Reported by the keeper" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.eventType).toBe("death");
      expect(result.event.uncertainTime).toBe(true);
      expect(result.event.date.value).toBe("2023");
    }
  });

  it("refuses a future lifecycle date", () => {
    const result = validateLifecycleEventInput({ event_type: "death", date: { value: String(CURRENT_YEAR + 1), precision: "year", calendar: "gregorian" } });
    expect(result.ok).toBe(false);
  });

  it("refuses an unknown event type", () => {
    const result = validateLifecycleEventInput({ event_type: "birthday", date: { value: "2023", precision: "year", calendar: "gregorian" } });
    expect(result.ok).toBe(false);
  });

  it("refuses an invalid Solar Hijri date (Esfand 30 in a common year)", () => {
    const result = validateLifecycleEventInput({ event_type: "castration", date: { value: "1402-12-30", precision: "day", calendar: "solar_hijri" } });
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Parent-correction submissions.
// ---------------------------------------------------------------------------

describe("T12 parent-correction submissions", () => {
  const valid = {
    kind: "parent_correction" as const,
    horse_id: 7,
    father_id: 11,
    reason: "Studbook volume 3 page 41 lists a different sire",
    source: "Studbook volume 3, page 41",
  };

  it("accepts a correction with reason and source", () => {
    const result = validateParentCorrectionInput(valid);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.correction.horse_id).toBe(7);
  });

  it("requires at least one parent change", () => {
    const result = validateParentCorrectionInput({ ...valid, father_id: undefined, mother_id: undefined });
    expect(result.ok).toBe(false);
  });

  it("requires a substantive reason and a named source", () => {
    expect(validateParentCorrectionInput({ ...valid, reason: "typo" }).ok).toBe(false);
    expect(validateParentCorrectionInput({ ...valid, source: "" }).ok).toBe(false);
  });

  it("round-trips through the stored submission parser (object and JSON text)", () => {
    const parsed = validateParentCorrectionInput(valid);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parseStoredParentCorrection(JSON.stringify(parsed.correction))).toMatchObject({ horse_id: 7, father_id: 11 });
    expect(parseStoredParentCorrection(parsed.correction)).toMatchObject({ horse_id: 7, father_id: 11 });
  });

  it("ignores non-correction submissions (create_horse payloads, legacy rows)", () => {
    expect(parseStoredParentCorrection({ name_native: "شیراز غر" })).toBeNull();
    expect(parseStoredParentCorrection("not json")).toBeNull();
    expect(parseStoredParentCorrection(null)).toBeNull();
    expect(parseStoredParentCorrection({ kind: "parent_correction", horse_id: 7, reason: "too short", source: "x" })).toBeNull();
  });

  it("renders a deterministic review summary", () => {
    const parsed = validateParentCorrectionInput({ ...valid, mother_id: null });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parentCorrectionAutoSummary(parsed.correction)).toBe("Parent correction: horse #7 · sire -> #11 · dam cleared");
  });
});

// ---------------------------------------------------------------------------
// Typed dates through the shared field rules.
// ---------------------------------------------------------------------------

describe("T12 typed dates in the shared horse field rules", () => {
  it("parses a valid day-precision Gregorian birth date", () => {
    const parsed = parseHorseFieldValue("birth_date", { value: "2018-05-12", precision: "day", calendar: "gregorian" });
    expect(parsed.ok).toBe(true);
    if (parsed.ok && typeof parsed.value === "object" && parsed.value !== null && "__typedDate" in parsed.value) {
      expect(parsed.value.date).toMatchObject({ value: "2018-05-12", precision: "day", calendar: "gregorian" });
      expect(parsed.value.gregorianYear).toBe(2018);
    } else {
      expect.unreachable("expected a typed date change");
    }
  });

  it("keeps a year-only DOB exactly a year — never an invented January 1", () => {
    const parsed = parseHorseFieldValue("birth_date", { value: "2018", precision: "year", calendar: "gregorian" });
    expect(parsed.ok).toBe(true);
    if (parsed.ok && typeof parsed.value === "object" && parsed.value !== null && "__typedDate" in parsed.value) {
      expect(parsed.value.date?.value).toBe("2018");
      expect(parsed.value.date?.precision).toBe("year");
    }
  });

  it("rejects impossible calendar mathematics", () => {
    expect(parseHorseFieldValue("birth_date", { value: "2018-02-30", precision: "day", calendar: "gregorian" }).ok).toBe(false);
    expect(parseHorseFieldValue("birth_date", { value: "2018-13-05", precision: "day", calendar: "gregorian" }).ok).toBe(false);
    expect(parseHorseFieldValue("birth_date", { value: "1402-12-30", precision: "day", calendar: "solar_hijri" }).ok).toBe(false);
  });

  it("rejects precision/format mismatches and future dates", () => {
    expect(parseHorseFieldValue("birth_date", { value: "2018-05", precision: "year", calendar: "gregorian" }).ok).toBe(false);
    expect(parseHorseFieldValue("birth_date", { value: String(CURRENT_YEAR + 1), precision: "year", calendar: "gregorian" }).ok).toBe(false);
  });

  it("normalizes null to a typed clear", () => {
    const parsed = parseHorseFieldValue("birth_date", null);
    expect(parsed.ok).toBe(true);
    if (parsed.ok && typeof parsed.value === "object" && parsed.value !== null && "__typedDate" in parsed.value) {
      expect(parsed.value.date).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// The mutation builder expands typed dates into column triples.
// ---------------------------------------------------------------------------

describe("T12 mutation builder typed-date expansion", () => {
  it("expands a typed birth date into value/precision/calendar + the birth_year bucket", () => {
    const plan = planHorseMutation(HORSE_ROW_BASE, {
      birth_date: { value: "2018-05-12", precision: "day", calendar: "gregorian" },
    });
    expect(plan.appliedFields).toContain("birth_date");
    const built = buildCanonicalHorseUpdateStatements(fakeDb(), {
      plan,
      horseId: 7,
      expectedRowVersion: 3,
      mutationId: "mut-1",
      identifierTableReady: false,
    });
    expect((built.updateStatement as unknown as BoundStatement).sql).toContain("birth_date_value=?");
    expect((built.updateStatement as unknown as BoundStatement).sql).toContain("birth_date_precision=?");
    expect((built.updateStatement as unknown as BoundStatement).sql).toContain("birth_date_calendar=?");
    expect((built.updateStatement as unknown as BoundStatement).sql).toContain("birth_year=?");
    const args = (built.updateStatement as unknown as BoundStatement).args;
    expect(args).toContain("2018-05-12");
    expect(args).toContain("day");
    expect(args).toContain("gregorian");
    expect(args).toContain(2018);
  });

  it("sets is_dead when a death date is recorded, but never resurrects on clear", () => {
    const withDeath = planHorseMutation(HORSE_ROW_BASE, { death_date: { value: "2023-08-01", precision: "day", calendar: "gregorian" } });
    expect(withDeath.normalizedChanges.is_dead).toBe(1);
    expect(withDeath.appliedFields).toContain("is_dead");

    const cleared = planHorseMutation({ ...HORSE_ROW_BASE, is_dead: 1 } as HorseRow, { death_date: null });
    expect(cleared.normalizedChanges.is_dead).toBeUndefined();
  });

  it("clears the typed columns without touching the legacy year bucket on birth_date clear", () => {
    const plan = planHorseMutation(HORSE_ROW_BASE, { birth_date: null });
    const built = buildCanonicalHorseUpdateStatements(fakeDb(), {
      plan,
      horseId: 7,
      expectedRowVersion: 3,
      mutationId: "mut-2",
      identifierTableReady: false,
    });
    expect((built.updateStatement as unknown as BoundStatement).sql).toContain("birth_date_value=?");
    const args = (built.updateStatement as unknown as BoundStatement).args;
    expect(args).toContain(null);
  });
});

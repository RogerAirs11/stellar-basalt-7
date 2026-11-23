import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { adminCorrectBreedingRecord } from "../../src/api/modules/genetics";
import { resolveBreedingSeason } from "../../src/genetics/breedingDates";
import {
  breedingDaysInSeason,
  breedingSeasonInterval,
  displaySeasonOrPartial,
  formatBreedingSeason,
  seasonRangeForPartialDate,
} from "../../src/genetics/seasonDisplay";
import { formatRegistryDate, parseRegistryDate, toSolarHijri } from "../../src/registry/dates";
import { HttpError } from "../../src/api/http";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * R88 agent plan P08 — reproduction/calendar semantics.
 *
 * Pins the reviewed fixture set around Nowruz boundaries and leap years,
 * interval-aware bilingual display for partial dates (2019 Gregorian and
 * 1405 Solar Hijri), consistent rejection of invalid leap/day/month values,
 * the reviewed correction endpoint (audit + old value) and the read-only
 * guarantee of the anomaly audit tool.
 */

// ---------------------------------------------------------------------------
// 1. Nowruz boundary + leap-year fixture set.
// ---------------------------------------------------------------------------

describe("P08 Nowruz boundary fixtures", () => {
  it("the day before Nowruz 1405 still belongs to season 1404", () => {
    expect(toSolarHijri(2026, 3, 20).jy).toBe(1404);
    expect(toSolarHijri(2026, 3, 21).jy).toBe(1405);
  });

  it("historical Nowruz anchors hold", () => {
    // 22 Bahman 1357 = 1979-02-11 (the revolution anchor pinned in T12).
    expect(toSolarHijri(1979, 2, 11)).toEqual({ jy: 1357, jm: 11, jd: 22 });
    // Nowruz edge: 1405-01-01 = 2026-03-21.
    expect(toSolarHijri(2026, 10, 3)).toEqual({ jy: 1405, jm: 7, jd: 11 });
  });

  it("leap seasons carry a 30th of Esfand (366 days), common seasons do not", () => {
    // Leap years pinned by T12: 1399, 1403, 1408.
    expect(breedingDaysInSeason(1399)).toBe(366);
    expect(breedingDaysInSeason(1403)).toBe(366);
    expect(breedingDaysInSeason(1408)).toBe(366);
    expect(breedingDaysInSeason(1404)).toBe(365);
    expect(breedingDaysInSeason(1405)).toBe(365);
  });

  it("Esfand 30 only validates in leap seasons; Esfand 30 in a common season fails", () => {
    expect(parseRegistryDate({ value: "1403-12-30", precision: "day", calendar: "solar_hijri" }, 2200).ok).toBe(true);
    const common = parseRegistryDate({ value: "1405-12-30", precision: "day", calendar: "solar_hijri" }, 2200);
    expect(common.ok).toBe(false);
    if (!common.ok) expect(common.issue).toBe("invalid_date");
  });

  it("season intervals are honest Gregorian half-open spans around Nowruz", () => {
    const season1405 = breedingSeasonInterval(1405);
    expect(season1405.start).toBe("2026-03-21");
    expect(season1405.endExclusive).toBe("2027-03-21");
    expect(season1405.leap).toBe(false);
    const leap1403 = breedingSeasonInterval(1403);
    expect(leap1403.leap).toBe(true);
    expect(leap1403.endExclusive).toBe(breedingSeasonInterval(1404).start);
  });
});

// ---------------------------------------------------------------------------
// 2. Interval-aware displays in both languages (2019 and 1405 acceptance).
// ---------------------------------------------------------------------------

describe("P08 interval-aware bilingual display", () => {
  it("a Gregorian year-only date (2019) renders as an interval in Persian, a plain year in English", () => {
    const en = formatRegistryDate({ value: "2019", precision: "year", calendar: "gregorian" }, "gregorian", "en");
    expect(en.text).toBe("2019");
    expect(en.precisionLabel).toBe("year only");
    // 2019 spans Solar Hijri 1397 and 1398 — the Persian text must show BOTH.
    const fa = formatRegistryDate({ value: "2019", precision: "year", calendar: "gregorian" }, "solar_hijri", "fa");
    expect(fa.text).toContain("۱۳۹۷");
    expect(fa.text).toContain("۱۳۹۸");
    expect(fa.text).toContain("–");
  });

  it("a Solar Hijri year-only date (1405) renders as an interval in English, a plain year in Persian", () => {
    const fa = formatRegistryDate({ value: "1405", precision: "year", calendar: "solar_hijri" }, "solar_hijri", "fa");
    expect(fa.text).toBe("۱۴۰۵");
    const en = formatRegistryDate({ value: "1405", precision: "year", calendar: "solar_hijri" }, "gregorian", "en");
    expect(en.text).toContain("2026");
    expect(en.text).toContain("2027");
  });

  it("a stored season 1405 renders as an honest interval in BOTH languages from the same fact", () => {
    expect(formatBreedingSeason(1405, "en")).toBe("Season 1405 SH (21 Mar 2026 – 20 Mar 2027)");
    expect(formatBreedingSeason(1405, "fa")).toBe("فصل ۱۴۰۵ (۱ فروردین – ۲۹ اسفند ۱۴۰۵)");
    // Leap season shows Esfand 30 honestly.
    expect(formatBreedingSeason(1403, "fa")).toContain("۳۰ اسفند");
    expect(displaySeasonOrPartial(null, "en")).toBe("Season unknown");
    expect(displaySeasonOrPartial(null, "fa")).toBe("فصل نامشخص");
  });

  it("a legacy Gregorian-looking season renders verbatim with a pending-review label, never throws", () => {
    // LIVE FINDING: 48,603 legacy rows carry seasons like 2016 — the panel
    // must stay honest (raw value + label) instead of crashing or converting.
    expect(displaySeasonOrPartial(2016, "en")).toBe("Season 2016 (legacy value, pending review)");
    expect(displaySeasonOrPartial(2016, "fa")).toContain("۲۰۱۶");
    expect(displaySeasonOrPartial(2016, "fa")).toContain("نیازمند بازبینی");
  });

  it("a partial covering date maps to a season RANGE, never an invented day", () => {
    // Gregorian 2019 spans SH seasons 1397 and 1398.
    expect(seasonRangeForPartialDate({ value: "2019", precision: "year", calendar: "gregorian" })).toEqual({ min: 1397, max: 1398 });
    // SH year-only 1405 is exactly season 1405.
    expect(seasonRangeForPartialDate({ value: "1405", precision: "year", calendar: "solar_hijri" })).toEqual({ min: 1405, max: 1405 });
    // A Gregorian month overlapping Nowruz spans two seasons.
    expect(seasonRangeForPartialDate({ value: "2026-03", precision: "month", calendar: "gregorian" })).toEqual({ min: 1404, max: 1405 });
  });
});

// ---------------------------------------------------------------------------
// 3. Invalid leap/day/month values fail consistently on every write path.
// ---------------------------------------------------------------------------

describe("P08 consistent validation failures", () => {
  it("rejects a Gregorian-looking season (2019) on create and on correction", () => {
    expect(() => resolveBreedingSeason(null, 2019)).toThrowError(HttpError);
    try {
      resolveBreedingSeason(null, 2019);
    } catch (error) {
      expect((error as HttpError).status).toBe(400);
      expect((error as HttpError).code).toBe("invalid_breeding");
    }
  });

  it("rejects calendar-invalid covering days (Feb 30, non-leap Feb 29, month 13, day 00)", () => {
    for (const bad of ["2019-02-30", "2019-02-29", "2019-13-01", "2019-01-00", "1405-12-30"]) {
      expect(() => resolveBreedingSeason(bad, null)).toThrowError(HttpError);
    }
  });

  it("accepts a real leap day and derives the matching season", () => {
    expect(resolveBreedingSeason("2024-02-29", null)).toBe(1402);
    // Explicit season must MATCH the derived one.
    expect(() => resolveBreedingSeason("2026-04-01", 1404)).toThrowError(HttpError);
    expect(resolveBreedingSeason("2026-04-01", 1405)).toBe(1405);
  });

  it("rejects an invented-day partial (month precision claiming a day)", () => {
    const parsed = parseRegistryDate({ value: "2019-06", precision: "day", calendar: "gregorian" }, 2200);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.issue).toBe("invalid_format");
  });
});

// ---------------------------------------------------------------------------
// 4. Reviewed correction endpoint: audit + old value, guarded.
// ---------------------------------------------------------------------------

const ORIGIN = "https://registry.example";

interface Recorded { sql: string; args: unknown[] }

function makeDb(script: { session?: Record<string, unknown> | null; record?: Record<string, unknown> | null } = {}) {
  const writes: Recorded[] = [];
  const answerFirst = (sql: string): unknown => {
    // This calendar-correction fixture models optional MFA for an unenrolled
    // account. Real factor/session/replay SQL is covered by r148-mfa.test.ts.
    if (sql.includes("auth_mfa_session_assurance")) return { allowed: 1 };
    if (sql.includes("FROM sessions s JOIN users u")) return script.session ?? null;
    if (sql.includes("FROM breeding_records WHERE id=?")) return script.record ?? null;
    return null;
  };
  interface Builder {
    sql: string; args: unknown[];
    bind: (...nextArgs: unknown[]) => Builder;
    first: () => Promise<unknown>;
    all: () => Promise<{ results: unknown[] }>;
    run: () => Promise<{ meta: { changes: number } }>;
  }
  const makeBuilder = (sql: string, args: unknown[]): Builder => ({
    sql, args,
    bind: (...nextArgs: unknown[]) => makeBuilder(sql, nextArgs),
    first: async () => answerFirst(sql),
    all: async () => ({ results: [] }),
    run: async () => { writes.push({ sql, args }); return { meta: { changes: 1 } }; },
  });
  const db = {
    prepare: (sql: string) => makeBuilder(sql, []),
    batch: async (statements: Array<{ sql: string; args: unknown[] }>) => {
      for (const statement of statements) writes.push({ sql: statement.sql, args: statement.args });
      return statements.map(() => ({ results: [], success: true, meta: { changes: 1 } }));
    },
  };
  return Object.assign(db as unknown as D1Database, { __writes: writes });
}

const staffSession = {
  session_id: "s-1", csrf_token: "csrf-1",
  expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
  last_seen_at: new Date().toISOString(),
  id: "editor-1", email: "editor@example.com", display_name: "Editor",
  role: "editor", is_active: 1,
};

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}/api/admin/breeding/501/correct`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: "hr_session=t", "x-csrf-token": "csrf-1", origin: ORIGIN, ...headers },
    body: JSON.stringify({ expected_version: 1, ...(body as Record<string, unknown>) }),
  });
}

const env = { SESSION_COOKIE_NAME: "hr_session" } as { SESSION_COOKIE_NAME: string };

describe("P08 reviewed correction endpoint", () => {
  const legacyRow = { id: 501, sire_id: 10, dam_id: 20, covering_date: "2019-04-15", season: 2019, row_version: 1 };

  it("corrects a Gregorian-looking season to Solar Hijri with an audit row carrying the old value", async () => {
    const db = makeDb({ session: staffSession, record: legacyRow });
    const response = await adminCorrectBreedingRecord(request({ season: 1398, reason: "Anomaly 12: season stored as Gregorian year, corrected to Solar Hijri" }), { ...env, DB: db }, 501);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { correction: { old: { season: number }; new: { season: number }; reason: string } };
    expect(body.correction.old.season).toBe(2019);
    expect(body.correction.new.season).toBe(1398);

    const update = db.__writes.find((w) => w.sql.includes("UPDATE breeding_records"));
    expect(update).toBeTruthy();
    // Only calendar values and concurrency markers change; biological facts stay untouched.
    expect(update?.sql).toMatch(/SET covering_date=\?, season=\?, row_version=row_version\+1/);
    expect(update?.sql).toMatch(/WHERE id=\? AND row_version=\?/);
    expect(update?.sql).not.toMatch(/sire_id\s*=/);
    expect(update?.sql).not.toMatch(/outcome\s*=/);

    const audit = db.__writes.find((w) => w.sql.includes("INSERT INTO audit_events"));
    expect(audit).toBeTruthy();
    expect(audit?.args[1]).toBe("breeding.record.corrected");
    // args[4]/args[5] are the before/after JSON strings — the OLD season value
    // must survive verbatim in the audit trail.
    expect(String(audit?.args[4])).toContain('"season":2019');
    expect(String(audit?.args[5])).toContain('"season":1398');
    expect(String(audit?.args[5])).toContain("Anomaly 12");
  });

  it("derives the season from a corrected covering date (date and season stay consistent)", async () => {
    const db = makeDb({ session: staffSession, record: { ...legacyRow, season: 1398 } });
    const response = await adminCorrectBreedingRecord(request({ covering_date: "2019-04-15", reason: "Restore the covering date lost in a legacy import" }), { ...env, DB: db }, 501);
    expect(response.status).toBe(200);
    const update = db.__writes.find((w) => w.sql.includes("UPDATE breeding_records"));
    expect(update?.args[0]).toBe("2019-04-15");
    expect(update?.args[1]).toBe(1398); // SH season of 2019-04-15
  });

  it("refuses a correction that would re-introduce a date/season mismatch", async () => {
    const db = makeDb({ session: staffSession, record: legacyRow });
    await expect(adminCorrectBreedingRecord(request({ season: 1400, reason: "Wrong season on purpose for the test" }), { ...env, DB: db }, 501))
      .rejects.toMatchObject({ status: 400, code: "invalid_breeding_correction" });
  });

  it("requires a human-review reason and at least one changed field", async () => {
    const db = makeDb({ session: staffSession, record: legacyRow });
    await expect(adminCorrectBreedingRecord(request({ season: 1398, reason: "short" }), { ...env, DB: db }, 501)).rejects.toMatchObject({ status: 400 });
    await expect(adminCorrectBreedingRecord(request({ reason: "No field changed at all here" }), { ...env, DB: db }, 501)).rejects.toMatchObject({ status: 400, code: "invalid_breeding_correction" });
  });

  it("404s for a missing record; refuses unprivileged sessions and missing CSRF", async () => {
    await expect(adminCorrectBreedingRecord(request({ season: 1398, reason: "Record is missing on purpose" }), { ...env, DB: makeDb({ session: staffSession, record: null }) }, 999))
      .rejects.toMatchObject({ status: 404 });
    await expect(adminCorrectBreedingRecord(request({ season: 1398, reason: "Unprivileged session attempt" }), { ...env, DB: makeDb({ session: { ...staffSession, role: "user" }, record: legacyRow }) }, 501))
      .rejects.toMatchObject({ status: 403 });
    await expect(adminCorrectBreedingRecord(request({ season: 1398, reason: "Missing CSRF token attempt" }, { "x-csrf-token": "" }), { ...env, DB: makeDb({ session: staffSession, record: legacyRow }) }, 501))
      .rejects.toBeInstanceOf(HttpError);
  });
});

// ---------------------------------------------------------------------------
// 5. The anomaly audit tool is read-only by construction.
// ---------------------------------------------------------------------------

describe("P08 audit tool read-only guarantee", () => {
  const toolPath = join(process.cwd(), "tools", "audit-breeding-dates.mjs");

  it("contains no write statements and no apply mode", () => {
    const source = readFileSync(toolPath, "utf8");
    expect(source).toContain("READ-ONLY");
    // No data-modifying SQL anywhere in the tool, and no apply flag.
    expect(source).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(source).not.toMatch(/\bUPDATE\s+\w+\s+SET\b/i);
    expect(source).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(source).not.toMatch(/\bDROP\s+(TABLE|INDEX|COLUMN)\b/i);
    expect(source).not.toMatch(/\bALTER\s+TABLE\b/i);
    expect(source).not.toContain("--apply");
    expect(source).not.toContain("applyMode");
    // It points humans at the reviewed correction path instead.
    expect(source).toContain("/api/admin/breeding/:id/correct");
  });

  it("reports every anomaly class the plan demands", () => {
    const source = readFileSync(toolPath, "utf8");
    for (const code of [
      "season_not_solar_hijri",
      "season_missing",
      "no_temporal_anchor",
      "covering_date_invalid",
      "season_date_mismatch",
      "covering_before_parent_birth",
      "foal_birth_before_covering",
      "implausible_gestation",
    ]) {
      expect(source).toContain(`"${code}"`);
    }
  });
});

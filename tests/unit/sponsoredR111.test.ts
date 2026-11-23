import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { utcTimestampMillisSql } from "../../src/shared/utcTimestampSql";
import { parseUtcTimestamp } from "../../src/shared/utcTimestamp";
import { isActiveSponsoredPlacement, listListings } from "../../src/api/modules/marketplace";
import { openRealDatabase, seedUser } from "../helpers/realDatabase";

const cases = JSON.parse(readFileSync(join(__dirname, "../fixtures/r111-timestamps.json"), "utf8")) as Array<{ label: string; value: string | null }>;
const now = Date.parse("2026-10-17T12:00:00Z");

describe("R111 sponsorship strict timestamp ordering", () => {
  // turn-33: openRealDatabase() applies every migration on a real SQLite file
  // and measured 7.4s on a cold sandbox disk — over vitest's 5s default, so
  // this test flaked on slower machines with zero regression. 40s keeps the
  // honest failure signal (a real hang still fails) while tolerating cold IO.
  it("matches the canonical parser for real SQLite grammar, calendar, offset and millisecond cases", { timeout: 40000 }, async () => {
    const db = await openRealDatabase();
    for (const item of cases) {
      const result = await db.prepare(`SELECT ${utcTimestampMillisSql("candidate.stamp")} AS value FROM (SELECT ? AS stamp) candidate`).bind(item.value).first<{ value: number | null }>();
      expect(result?.value, item.label).toBe(parseUtcTimestamp(item.value));
    }
    expect(parseUtcTimestamp("0000-01-01T00:00:00Z")).toBe(-62167219200000);
    expect(parseUtcTimestamp("1969-12-31T23:59:59.999Z")).toBe(-1);
    expect(parseUtcTimestamp("2027-02-30T13:00:00Z")).toBeNull();
  });

  it("uses the exact same bound instant and eligibility for paid order, label and pagination", async () => {
    const db = await openRealDatabase();
    await seedUser(db, "sponsor-owner", "owner");
    for (const [index, item] of cases.entries()) {
      await db.prepare("INSERT INTO horses(id,name_latin) VALUES(?,?)").bind(8000 + index, `Fictional ${item.label}`).run();
      await db.prepare("INSERT INTO sales_listings(id,horse_id,seller_user_id,seller_contact_name,status,sponsored_until,listed_at) VALUES(?,?,'sponsor-owner','Fictional seller','active',?,'2026-10-01 00:00:00')")
        .bind(`sponsor-${String(index).padStart(3, "0")}`, 8000 + index, item.value).run();
    }
    const read = async (parameters: string, at = now) => (await (await listListings(db, new URL(`https://registry.example/api/marketplace?${parameters}`), at)).json()) as {
      rows: Array<{ id: string; sponsored: boolean; sponsored_label: unknown; sponsored_active?: unknown; sponsored_until: string | null }>; total: number;
    };
    const expected = cases.map((item, index) => ({ id: `sponsor-${String(index).padStart(3, "0")}`, active: isActiveSponsoredPlacement(item.value, now) }))
      .sort((a, b) => Number(b.active) - Number(a.active) || a.id.localeCompare(b.id));
    const all = await read("limit=60");
    expect(all.total).toBe(cases.length);
    expect(all.rows.map(row => row.id)).toEqual(expected.map(row => row.id));
    for (const row of all.rows) {
      expect(row.sponsored).toBe(isActiveSponsoredPlacement(row.sponsored_until, now));
      expect(row.sponsored_label).toEqual(row.sponsored ? { en: "Sponsored", fa: "تبلیغ" } : null);
      expect(row.sponsored_active).toBeUndefined();
    }
    expect((await read("limit=7&offset=5")).rows.map(row => row.id)).toEqual(expected.slice(5, 12).map(row => row.id));
    const nextMillisecond = await read("limit=60", now + 1);
    for (const row of nextMillisecond.rows) expect(row.sponsored).toBe(isActiveSponsoredPlacement(row.sponsored_until, now + 1));
    expect((await read("limit=60", Number.NaN)).rows.every(row => !row.sponsored)).toBe(true);
  });

  it("accepts only trusted timestamp column identifiers in the SQL builder", () => {
    for (const expression of ["stamp; DROP TABLE horses", "(SELECT 1)", "stamp--", "stamp?", "a.b.c"])
      expect(() => utcTimestampMillisSql(expression)).toThrow(/column/);
  });
});

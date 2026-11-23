import { beforeAll, describe, expect, it } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import { openRealDatabase } from "../helpers/realDatabase";
import { refreshHorseSearch } from "../../src/search/refresh";
import { searchHorses } from "../../src/search/service";
import { seedSearchR113Fixture } from "../helpers/searchR113Fixture";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("R113 repeated structured search fields on real SQLite FTS", () => {
  let db: D1Database;
  beforeAll(async () => {
    db = await openRealDatabase();
    await seedSearchR113Fixture(db);
    for (const id of [1, 2, 3, 4, 5, 6]) await refreshHorseSearch(db, id);
  });
  async function ids(query: string) { return (await searchHorses(db, query)).map(row => row.id).sort(); }
  it("retrieves either value of the same name field", async () => {
    expect(await ids("name:aurora")).toEqual([1, 3]);
    expect(await ids("name:borealis")).toEqual([2]);
    expect(await ids("name:aurora name:borealis")).toEqual([1, 2, 3]);
  });
  it("keeps words within each quoted value together while allowing either value", async () => {
    expect(await ids('name:"aurora moon" name:"borealis sun"')).toEqual([1, 2]);
  });
  it("ANDs different fields while ORing repeated values of one field", async () => {
    expect(await ids("owner:alpha owner:beta breeder:gamma")).toEqual([1, 2]);
    expect(await ids("owner:alpha breeder:gamma")).toEqual([1]);
    expect(await ids("owner:beta breeder:delta")).toEqual([]);
  });
  it("preserves native-name alternatives and digit normalization", async () => {
    expect(await ids('name:"ماه روشن" name:"خورشید"')).toEqual([1, 2]);
    expect(await ids("id:۱ id:۲")).toEqual([1, 2]);
  });
  it("preserves every public result, rank and score in the pre-optimization recall corpus", async () => {
    const baseline = JSON.parse(readFileSync(join(__dirname, "../fixtures/r113-search-recall.json"), "utf8")) as { cases: Array<{ query: string; results: unknown[] }> };
    // R158: search rows additionally carry owner/breeder display names (latin +
    // native). They are additive display fields — strip them so the corpus keeps
    // guarding exactly what it was recorded for: results, ranks and scores.
    const ADDITIVE = ["owner_name", "owner_name_native", "breeder_name", "breeder_name_native"] as const;
    const stripAdditive = (rows: Array<Record<string, unknown>>) => rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => !ADDITIVE.includes(key as typeof ADDITIVE[number]))));
    for (const sample of baseline.cases) expect(stripAdditive(await searchHorses(db, sample.query) as unknown as Array<Record<string, unknown>>), sample.query).toEqual(sample.results);
  });
  it("does no full-text or name discovery for explicit IDs, while still enforcing other fields", async () => {
    const statements: string[] = [];
    const measured = { ...db, prepare(sql: string) { statements.push(sql); return db.prepare(sql); } } as D1Database;
    expect((await searchHorses(measured, "id:1 id:2 owner:alpha year:2020")).map(row => row.id)).toEqual([1]);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain("WHERE h.id IN");
    statements.length = 0;
    expect(await searchHorses(measured, "id:123")).toEqual([]); // horse 5 has the NAME 123, not this ID.
    expect(statements).toHaveLength(1);
  });
  it("deduplicates an exact name/register match and retains case-insensitive identifier lookup", async () => {
    const exact = await searchHorses(db, "Aurora Star");
    expect(exact.filter(row => row.id === 3)).toHaveLength(1);
    expect(await ids("r1")).toContain(1);
    expect(await ids("AuRoRa MoOn")).toContain(2); // registration belongs to a different horse.
  });
});

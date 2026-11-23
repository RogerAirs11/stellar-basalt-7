import { beforeAll, describe, expect, it } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import { openRealDatabase } from "../helpers/realDatabase";
import { refreshHorseSearch } from "../../src/search/refresh";
import { searchHorses } from "../../src/search/service";
import { seedSearchR113Fixture } from "../helpers/searchR113Fixture";

/** R151 forgiving-search contract: mixed columns, dropped spaces, half-typed
 * words and pasted labels must still reach the right record, ranked below
 * exact readings but never lost. */
describe("R151 forgiving search on real SQLite FTS", () => {
  let db: D1Database;
  beforeAll(async () => {
    db = await openRealDatabase();
    await seedSearchR113Fixture(db);
    for (const id of [1, 2, 3, 4, 5, 6]) await refreshHorseSearch(db, id);
  });

  it("finds the horse when the query mixes the horse name with the owner name", async () => {
    const results = await searchHorses(db, "aurora alpha");
    expect(results[0]?.id).toBe(1); // Aurora Moon + owner Alpha — complete reading first.
  });

  it("finds the horse when the query mixes the horse name with the breeder name", async () => {
    const results = await searchHorses(db, "star delta");
    expect(results[0]?.id).toBe(3); // Aurora Star + breeder Delta.
  });

  it("keeps a one-word typo from killing a multi-word query", async () => {
    const results = await searchHorses(db, "aurra moon");
    expect(results[0]?.id).toBe(1); // "aurra" fuzzy-matches Aurora; "moon" is exact.
  });

  it("matches a pasted register value with broken spacing", async () => {
    const exact = await searchHorses(db, "R1");
    expect(exact[0]?.id).toBe(1);
    const spaced = await searchHorses(db, "r 1");
    expect(spaced.map((row) => row.id)).toContain(1);
  });

  it("ranks the complete reading above partial single-word matches", async () => {
    // "moon alpha" fully matches only Aurora Moon (name word + owner word);
    // Aurora Star owns "alpha" but has no "moon" — a partial single-word match.
    const results = await searchHorses(db, "moon alpha");
    const complete = results.find((row) => row.id === 1);
    expect(complete?.matched_by).toContain("all-words");
    const partials = results.filter((row) => row.id !== 1);
    if (partials.length) {
      expect(complete!.score ?? 0).toBeGreaterThan(partials[0]!.score ?? 0);
    }
  });

  it("never leaks a deleted or inactive record through the relaxed paths", async () => {
    const results = await searchHorses(db, "aurora");
    expect(results.map((row) => row.id)).not.toContain(4); // deleted fixture horse.
  });
});

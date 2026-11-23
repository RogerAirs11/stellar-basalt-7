import { describe, expect, it } from "vitest";
import { damerauLevenshtein, fuzzySimilarity } from "../../src/search/fuzzy";

describe("fuzzy matching", () => {
  it("handles adjacent transpositions", () => {
    expect(damerauLevenshtein("novastar", "novsatar", 2)).toBe(1);
  });
  it("gives close horse-name spellings a useful score", () => {
    expect(fuzzySimilarity("novastar", "novastarr")).toBeGreaterThan(0.7);
  });
  it("rejects unrelated short terms", () => {
    expect(fuzzySimilarity("king", "mare")).toBe(0);
  });
  it("honors the bounded-distance cutoff on long strings", () => {
    expect(damerauLevenshtein("abcdefghijk", "xyzabcdefgh", 2)).toBe(3);
  });
  it("handles insertion and deletion near the band edge", () => {
    expect(damerauLevenshtein("novastar", "novaastar", 2)).toBe(1);
    expect(damerauLevenshtein("novaastar", "novastar", 2)).toBe(1);
  });
});

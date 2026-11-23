import { describe, expect, it } from "vitest";
import { buildFuzzyTrigramExpression } from "../../src/search/fuzzy";

describe("buildFuzzyTrigramExpression (C4-1 bounded fuzzy candidate generation)", () => {
  it("returns null for tokens shorter than 5 or longer than 24 chars", () => {
    expect(buildFuzzyTrigramExpression("abc")).toBeNull();
    expect(buildFuzzyTrigramExpression("abcd")).toBeNull();
    expect(buildFuzzyTrigramExpression("a".repeat(25))).toBeNull();
    expect(buildFuzzyTrigramExpression("a".repeat(24))).not.toBeNull();
    expect(buildFuzzyTrigramExpression("a".repeat(5))).not.toBeNull();
  });

  it("emits the token's own trigrams plus deletion-variant trigrams", () => {
    const expr = buildFuzzyTrigramExpression("chabock");
    // own trigrams first, then deduplicated deletion-variant trigrams
    expect(expr).toBe(
      '"cha" OR "hab" OR "abo" OR "boc" OR "ock" OR "cab" OR "chb" OR "hbo" OR "hao" OR "aoc" OR "abc" OR "bck" OR "bok"'
    );
  });

  it("includes trigrams of single-character deletion variants (transposition bridge)", () => {
    // CHBAOCK: the deletion variant "chaok" contributes "cha", which CHABOCK shares.
    const expr = buildFuzzyTrigramExpression("chbaok");
    for (const term of ['"chb"', '"bao"', '"aok"', '"cha"', '"hao"']) {
      expect(expr).toContain(term);
    }
  });

  it("is deterministic and deduplicates repeated trigrams", () => {
    const a = buildFuzzyTrigramExpression("aaaaaa");
    const b = buildFuzzyTrigramExpression("aaaaaa");
    expect(a).toBe(b);
    // aaaaaa -> trigrams "aaa" only; variants all yield "aaa" as well
    expect(a).toBe('"aaa"');
  });

  it("caps the expression at 64 OR terms", () => {
    // 24 chars (max allowed) generates far more than 64 candidate trigrams
    const expr = buildFuzzyTrigramExpression("abcdefghijklmnopqrstuvwx");
    expect(expr).not.toBeNull();
    const terms = (expr as string).split(" OR ");
    expect(terms.length).toBeLessThanOrEqual(64);
    expect(terms.length).toBe(64);
  });

  it("does not interpret double quotes inside tokens as FTS syntax", () => {
    const expr = buildFuzzyTrigramExpression('a"bc"de');
    // every emitted term must be a quoted 3-char trigram; embedded quotes are doubled
    expect(expr).not.toBeNull();
    for (const term of (expr as string).split(" OR ")) {
      expect(term).toMatch(/^"([^"]|"")+"$/);
    }
  });
});

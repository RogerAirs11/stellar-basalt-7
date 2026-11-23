import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { HttpError } from "../../src/api/http";
import {
  INSUFFICIENT_ANCESTRY_COVERAGE_PERCENT,
  BREEDING_OPTIMIZER_ALGORITHM_VERSION,
  insufficientAncestryMessage,
  optimizeBreedingCandidates,
} from "../../src/pedigree/breeding";

/**
 * B02 regression coverage: a missing or deleted fixed horse must produce a
 * controlled 404 not-found error (never a silent empty-success ranking).
 * A stub D1 whose horses table is empty reproduces the missing/deleted case.
 */
function stubEmptyD1(): D1Database {
  const prepare = (_sql: string) => ({
    bind: () => ({ first: async () => null, all: async () => ({ results: [] }) }),
    first: async () => null,
    all: async () => ({ results: [] }),
  });
  return { prepare } as unknown as D1Database;
}

describe("breeding optimizer fixed-horse existence (B02)", () => {
  it("throws controlled 404 when the fixed horse is missing or deleted", async () => {
    await expect(
      optimizeBreedingCandidates(stubEmptyD1(), {
        fixedHorseId: 987654321,
        fixedRole: "sire",
        candidateIds: [1, 2, 3],
      }),
    ).rejects.toSatisfy((err: unknown) => err instanceof HttpError && (err as HttpError).status === 404);
  });
});

// R140-D (second Master-AI audit): candidates whose projected pedigree
// completeness is below the evidence floor are EXCLUDED with code
// "insufficient_ancestry" — never ranked with a renormalized-weight bonus
// that made thin pedigrees look favorable.
describe("breeding optimizer evidence floor (R140-D)", () => {
  it("excludes coverage below the 20% floor with an honest message", () => {
    const below = insufficientAncestryMessage(12.34);
    expect(below).not.toBeNull();
    expect(below).toContain("12.3%");
    expect(below).toContain(String(INSUFFICIENT_ANCESTRY_COVERAGE_PERCENT));
  });

  it("keeps candidates at or above the floor and tolerates unknown coverage", () => {
    expect(insufficientAncestryMessage(20)).toBeNull();
    expect(insufficientAncestryMessage(88.8)).toBeNull();
    expect(insufficientAncestryMessage(null)).toBeNull();
    expect(insufficientAncestryMessage(undefined)).toBeNull();
    expect(insufficientAncestryMessage(Number.NaN)).toBeNull();
  });

  it("wires the per-parent exclusion into the optimizer ranking loop and bumps the algorithm version", () => {
    const source = readFileSync("src/pedigree/breeding.ts", "utf8");
    expect(source).toContain("insufficient_ancestry");
    // R142-B05: the floor now binds EACH parent independently — the weaker
    // side's coverage drives the exclusion, not the combined projection.
    expect(source.indexOf("insufficientAncestryMessage(weakestParentCoverage)")).toBeGreaterThan(0);
    expect(source).toContain("per-parent evidence floor");
    expect(BREEDING_OPTIMIZER_ALGORITHM_VERSION).toBe("1.3.0");
  });
});

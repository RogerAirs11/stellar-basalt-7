import { describe, expect, it } from "vitest";
import { horseMutationImpact } from "../../src/registry/impact";
import { validateParentAssignment } from "../../src/pedigree/integrity";

/**
 * Master-Ai plan T09: one place computes the search/impact fan-out of a horse
 * mutation (self + direct children on parent-name change), and T07 step 5:
 * sex-role policy runs on every parent assignment.
 */

describe("horseMutationImpact (T09)", () => {
  it("queues self plus direct children when a parent's name changes", () => {
    const impact = horseMutationImpact({ name_latin: "Renamed", name_native: null });
    expect(impact.queueSelf).toBe(true);
    expect(impact.queueDirectChildren).toBe(true);
    expect(impact.childReason).toBe("parent_name_changed");
  });

  it("queues only self for non-name, non-identity edits", () => {
    const impact = horseMutationImpact({ description: "longer text", birth_year: 2016, breed_desc: "Arabian" });
    expect(impact.queueSelf).toBe(true);
    expect(impact.queueDirectChildren).toBe(false);
  });

  it("flags identifier edits and parentage relinks for the self reindex", () => {
    expect(horseMutationImpact({ register_no: "102" }).touchesIdentifiers).toBe(true);
    expect(horseMutationImpact({ father_id: 9 }).touchesParentage).toBe(true);
    expect(horseMutationImpact({ father_id: 9 }).queueDirectChildren).toBe(false);
  });

  it("treats empty change sets as self-only no-ops", () => {
    const impact = horseMutationImpact({});
    expect(impact.queueSelf).toBe(true);
    expect(impact.queueDirectChildren).toBe(false);
    expect(impact.touchesIdentifiers).toBe(false);
  });
});

const parentRows: Record<number, { id: number; sex_desc: string | null; deleted_at: string | null; father_id: number | null; mother_id: number | null }> = {
  3: { id: 3, sex_desc: "Stallion", deleted_at: null, father_id: null, mother_id: null },
  4: { id: 4, sex_desc: "Mare", deleted_at: null, father_id: null, mother_id: null },
  8: { id: 8, sex_desc: "مادیان", deleted_at: null, father_id: null, mother_id: null },
  9: { id: 9, sex_desc: "نریان", deleted_at: null, father_id: null, mother_id: null },
  10: { id: 10, sex_desc: "Gelding", deleted_at: null, father_id: null, mother_id: null },
  11: { id: 11, sex_desc: null, deleted_at: null, father_id: null, mother_id: null },
  13: { id: 13, sex_desc: "three-year-old unknown line", deleted_at: null, father_id: null, mother_id: null },
};

function dbFor(rows: typeof parentRows) {
  return {
    prepare(sql: string) {
      const builder = {
        bind(...args: unknown[]) {
          return {
            async all<T>(): Promise<{ results: T[] }> {
              if (sql.includes("SELECT id,sex_desc FROM horses")) {
                const wanted = args as number[];
                return { results: wanted.map((id) => rows[id]).filter(Boolean) as unknown as T[] };
              }
              if (sql.includes("SELECT father_id,mother_id FROM horses")) {
                const wanted = args as number[];
                return { results: wanted.map((id) => rows[id] ?? { father_id: null, mother_id: null }) as unknown as T[] };
              }
              return { results: [] };
            },
            async first<T>(): Promise<T | null> {
              return null;
            },
          };
        },
      };
      return builder;
    },
  } as never;
}

describe("sex-role policy on parent assignment (T07 step 5)", () => {
  it("accepts a stallion sire and a mare dam", async () => {
    const result = await validateParentAssignment(dbFor(parentRows), 12, 3, 4);
    expect(result.valid).toBe(true);
  });

  it("accepts Persian-language sex descriptions", async () => {
    const result = await validateParentAssignment(dbFor(parentRows), 12, 9, 8);
    expect(result.valid).toBe(true);
  });

  it("rejects a female-role horse as sire with a specific issue code", async () => {
    const result = await validateParentAssignment(dbFor(parentRows), 12, 8, 4);
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.code).toBe("parent_sex_role");
    expect(result.issues[0]?.details).toMatchObject({ parent: "father", sex_desc: "مادیان" });
  });

  it("rejects a male-role horse as dam", async () => {
    const result = await validateParentAssignment(dbFor(parentRows), 12, 3, 9);
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.code).toBe("parent_sex_role");
    expect(result.issues[0]?.details).toMatchObject({ parent: "mother", sex_desc: "نریان" });
  });

  it("accepts historical paternity when the sire is currently a gelding", async () => {
    const result = await validateParentAssignment(dbFor(parentRows), 12, 10, 4);
    expect(result.valid).toBe(true);
  });

  it("passes unknown, missing or free-text sex descriptions (legacy data cannot be guessed)", async () => {
    const unknown = await validateParentAssignment(dbFor(parentRows), 12, 11, 13);
    expect(unknown.valid).toBe(true);
    const freeText = await validateParentAssignment(dbFor(parentRows), 14, 13, 11);
    expect(freeText.valid).toBe(true);
  });
});

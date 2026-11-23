import { describe, expect, it } from "vitest";
import { planHorseMutation, staleBaseFieldDifferences } from "../../src/registry/mutations";
import type { HorseRow } from "../../src/db/types";

/**
 * Master-Ai plan T07: one typed mutation service plans every canonical horse
 * write. Normalized values only (never raw), stale-base detection with safe
 * field differences, and consistent parentage/identifier flags.
 */

function horseRow(overrides: Partial<HorseRow> = {}): HorseRow {
  return {
    id: 12,
    company_code: null,
    register_no: "100",
    microchip_no: "985001",
    file_number: null,
    name_latin: "Qater Al Nasief",
    name_native: "قاطر النسیف",
    father_id: 3,
    mother_id: 4,
    book_version: null,
    is_active: 1,
    originality: null,
    birth_date: null,
    birth_year: 2015,
    birth_place_code: null,
    birth_place_desc: null,
    breed_type: null,
    breed_desc: "Arabian",
    sex_code: null,
    sex_desc: "Stallion",
    color_code: null,
    color_desc: "Grey",
    main_strain_no: null,
    main_strain_desc: "Koheilan",
    sub_strain_no: null,
    sub_strain_desc: null,
    uel_no: null,
    lab_no: null,
    dna_status: null,
    dna_desc: null,
    life_number: null,
    passport_no: null,
    passport_date: null,
    passport_deliver_date: null,
    is_stallion: 1,
    is_sport: 0,
    is_imported: 0,
    imported_date: null,
    imported_from_code: null,
    imported_from_desc: null,
    import_register_no: null,
    export_certificate: null,
    horse_sr_no: null,
    is_dead: 0,
    death_date: null,
    is_register_sport: 0,
    has_sport_card: 0,
    allow_stallion: 0,
    description: null,
    ...overrides,
  } as HorseRow;
}

describe("planHorseMutation (T07)", () => {
  it("normalizes values through the shared schemas — raw whitespace never survives", () => {
    const plan = planHorseMutation(horseRow(), { name_latin: "  New Name  ", birth_year: 2016 });
    expect(plan.normalizedChanges.name_latin).toBe("New Name");
    expect(plan.normalizedChanges.birth_year).toBe(2016);
    expect(plan.appliedFields).toEqual(["name_latin", "birth_year"]);
  });

  it("detects parentage changes and resolves the next parents", () => {
    const plan = planHorseMutation(horseRow(), { father_id: 9 });
    expect(plan.parentageChanged).toBe(true);
    expect(plan.nextFather).toBe(9);
    expect(plan.nextMother).toBe(4);
    expect(plan.touchesName).toBe(false);
  });

  it("flags name changes for child-search invalidation and identifier changes for T08 work", () => {
    const namePlan = planHorseMutation(horseRow(), { name_native: "شاه‌گذین" });
    expect(namePlan.touchesName).toBe(true);
    expect(namePlan.touchesIdentifiers).toBe(false);

    const idPlan = planHorseMutation(horseRow(), { register_no: "101", microchip_no: null });
    expect(idPlan.touchesIdentifiers).toBe(true);
    expect(idPlan.touchesName).toBe(false);
  });

  it("skips no-op identifier values so re-setting the same number is not churn", () => {
    const plan = planHorseMutation(horseRow(), { register_no: " 100 " });
    expect(plan.normalizedChanges.register_no).toBe("100");
    expect(plan.effectiveIdentifierChanges).toEqual({});
    expect(plan.touchesIdentifiers).toBe(false);
  });

  it("keeps effective identifier changes only for genuinely new or cleared values", () => {
    const plan = planHorseMutation(horseRow(), { register_no: "102", microchip_no: "985001", name_latin: "X" });
    expect(plan.effectiveIdentifierChanges).toEqual({ register_no: "102" });
    expect(plan.touchesIdentifiers).toBe(true);
  });

  it("preserves omitted-vs-null semantics: omitted = untouched, null = clear", () => {
    const plan = planHorseMutation(horseRow(), { color_desc: null });
    expect(plan.normalizedChanges.color_desc).toBeNull();
    expect(plan.appliedFields).toEqual(["color_desc"]);
    expect(plan.normalizedChanges.breed_desc).toBeUndefined();
  });

  it("rejects invalid values instead of silently dropping them", () => {
    expect(() => planHorseMutation(horseRow(), { birth_year: "not a year" as never })).toThrow();
    expect(() => planHorseMutation(horseRow(), { name_latin: "   " })).toThrow();
    expect(() => planHorseMutation(horseRow(), { admin_flag: true } as never)).toThrow(/unsupported/i);
  });
});

describe("staleBaseFieldDifferences (T07)", () => {
  it("reports safe per-field differences between submitted base and current row", () => {
    const diffs = staleBaseFieldDifferences(
      [
        { field_name: "name_latin", old_value: "Old Name", proposed_value: "New Name" },
        { field_name: "color_desc", old_value: "Grey", proposed_value: "White" },
      ],
      { name_latin: "Staff Edited Name", color_desc: "Grey" },
    );
    expect(diffs).toEqual([
      { field: "name_latin", submitted_old_value: "Old Name", current_value: "Staff Edited Name" },
    ]);
  });

  it("treats null and empty-string bases as equal and never leaks proposed values", () => {
    const diffs = staleBaseFieldDifferences(
      [
        { field_name: "breed_desc", old_value: null, proposed_value: "secret" },
        { field_name: "birth_year", old_value: 2015, proposed_value: 2014 },
      ],
      { breed_desc: "", birth_year: 2015 },
    );
    expect(diffs).toEqual([]);
  });
});

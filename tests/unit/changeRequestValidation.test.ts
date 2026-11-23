import { describe, expect, it } from "vitest";
import {
  CHANGE_REQUEST_APPLICABLE_FIELDS,
  validateProposedChangeItems,
} from "../../src/api/changeRequestValidation";

describe("validateProposedChangeItems — REV-02 reviewed-change field validation", () => {
  it("accepts valid field values with the same rules as direct edits", () => {
    const issues = validateProposedChangeItems([
      { field_name: "name_latin", proposed_value: "  Qater Al Nasief  " },
      { field_name: "birth_year", proposed_value: 2019 },
      { field_name: "color_desc", proposed_value: null },
    ]);
    expect(issues).toEqual([]);
  });

  it("rejects the classic audit counterexample: birth_year 'not a year'", () => {
    const issues = validateProposedChangeItems([{ field_name: "birth_year", proposed_value: "not a year" }]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ field: "birth_year", code: "invalid_value" });
  });

  it("rejects impossible years, non-integer years and empty names", () => {
    expect(validateProposedChangeItems([{ field_name: "birth_year", proposed_value: 1200 }])[0].code).toBe("invalid_value");
    expect(validateProposedChangeItems([{ field_name: "birth_year", proposed_value: 2019.5 }])[0].code).toBe("invalid_value");
    expect(validateProposedChangeItems([{ field_name: "name_latin", proposed_value: "   " }])[0].code).toBe("invalid_value");
    expect(validateProposedChangeItems([{ field_name: "name_latin", proposed_value: null }])[0].code).toBe("invalid_value");
  });

  it("rejects oversized values", () => {
    expect(validateProposedChangeItems([{ field_name: "breed_desc", proposed_value: "x".repeat(121) }])[0].code).toBe("invalid_value");
    expect(validateProposedChangeItems([{ field_name: "description", proposed_value: "y".repeat(4001) }])[0].code).toBe("invalid_value");
  });

  it("flags duplicate field names deterministically", () => {
    const issues = validateProposedChangeItems([
      { field_name: "name_latin", proposed_value: "A" },
      { field_name: "name_latin", proposed_value: "B" },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ field: "name_latin", code: "duplicate_field" });
  });

  it("flags fields that a review can never apply canonically", () => {
    const issues = validateProposedChangeItems([
      { field_name: "father_id", proposed_value: 42 },
      { field_name: "delete_horse", proposed_value: true },
    ]);
    expect(issues.map((i) => i.code)).toEqual(["unsupported_field", "unsupported_field"]);
  });

  it("treats a missing proposed_value as setting NULL (rejected for required name_latin)", () => {
    expect(validateProposedChangeItems([{ field_name: "name_latin" }])[0].code).toBe("invalid_value");
    expect(validateProposedChangeItems([{ field_name: "color_desc" }])).toEqual([]);
  });

  it("keeps the applicable whitelist in sync with the validated schemas", () => {
    expect(CHANGE_REQUEST_APPLICABLE_FIELDS.has("name_latin")).toBe(true);
    expect(CHANGE_REQUEST_APPLICABLE_FIELDS.has("father_id")).toBe(false);
    // Explicitly reviewed identity/lifecycle additions; passport/foreign
    // documents and private address still require their guarded workflows.
    expect([...CHANGE_REQUEST_APPLICABLE_FIELDS].sort()).toEqual([
      "name_latin", "name_native", "register_no", "microchip_no", "uel_no", "life_number",
      "birth_name", "previous_names", "markings", "height_cm", "life_status",
      "birth_year", "birth_place_desc", "breed_desc", "sex_desc", "color_desc", "description",
      "main_strain_desc", "sub_strain_desc", "birth_city", "birth_province", "keeping_city",
      "keeping_province", "birth_date", "death_date", "castration_date",
    ].sort());
  });
});

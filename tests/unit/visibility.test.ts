import { describe, expect, it } from "vitest";
import { PUBLIC_HORSE_FIELDS, SEARCH_HORSE_FIELDS, ADMIN_EDIT_HORSE_FIELDS } from "../../src/db/types";

describe("data visibility invariants", () => {
  it("never exposes raw source or sensitive identifiers through public/search DTOs", () => {
    // R151 owner directive: microchip_no was promoted to the public projection
    // (an opt-in browse column, hidden by default). Every other private field
    // class below stays forbidden.
    const forbidden = ["raw_json", "file_number", "lab_no", "passport_no", "description", "row_version"];
    for (const field of forbidden) {
      expect(PUBLIC_HORSE_FIELDS).not.toContain(field);
      expect(SEARCH_HORSE_FIELDS).not.toContain(field);
    }
  });

  it("carries the owner-approved microchip column in the public allowlists", () => {
    expect(PUBLIC_HORSE_FIELDS).toContain("microchip_no");
    expect(SEARCH_HORSE_FIELDS).toContain("microchip_no");
  });

  it("keeps edit-only fields behind the admin allowlist", () => {
    expect(ADMIN_EDIT_HORSE_FIELDS).toContain("microchip_no");
    expect(ADMIN_EDIT_HORSE_FIELDS).toContain("row_version");
    expect(ADMIN_EDIT_HORSE_FIELDS).toContain("description");
  });
});

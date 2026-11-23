import { describe, expect, it } from "vitest";
import {
  buildHorseCreateSchema,
  buildHorseUpdateSchema,
  CHANGE_REQUEST_APPLICABLE_FIELDS,
  HORSE_FIELD_SCHEMAS,
  parseHorseFieldValue,
} from "../../src/registry/validation";

/**
 * Master-Ai plan T07: direct edits, reviewed updates and creations must all
 * accept/reject the SAME values and store the SAME normalized representation.
 * These fixtures pin the single shared schema source + Zod transform retention.
 */

describe("shared horse field schemas (T07)", () => {
  it("keeps Zod transforms: parsed values are trimmed, raw values are never stored", () => {
    const parsed = buildHorseUpdateSchema().safeParse({
      expected_row_version: 3,
      changes: { name_latin: "  Qater Al Nasief  ", color_desc: null, register_no: "  007-قاطر  " },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.changes.name_latin).toBe("Qater Al Nasief");
      expect(parsed.data.changes.color_desc).toBeNull();
      expect(parsed.data.changes.register_no).toBe("007-قاطر");
    }
  });

  it("rejects the same invalid values on create, direct update and per-field parse", () => {
    const badYear = "not a year";
    expect(buildHorseCreateSchema().safeParse({ name_latin: "A", birth_year: badYear }).success).toBe(false);
    expect(
      buildHorseUpdateSchema().safeParse({ expected_row_version: 1, changes: { birth_year: badYear } }).success,
    ).toBe(false);
    expect(parseHorseFieldValue("birth_year", badYear).ok).toBe(false);
    expect(parseHorseFieldValue("name_latin", "   ").ok).toBe(false);
  });

  it("normalizes every value through parseHorseFieldValue, never discarding transforms", () => {
    const parsed = parseHorseFieldValue("name_native", "  شاه‌گذین  ");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value).toBe("شاه‌گذین");

    const cleared = parseHorseFieldValue("breed_desc", null);
    expect(cleared).toEqual({ ok: true, value: null });

    // omitted vs null semantics: undefined means "no change" and is rejected by
    // the per-field parser (callers must decide), null means "clear the field"
    expect(parseHorseFieldValue("name_latin", undefined).ok).toBe(false);
  });

  it("covers the strain fields on the direct paths exactly like the reviewed path", () => {
    expect(HORSE_FIELD_SCHEMAS.main_strain_desc).toBeDefined();
    expect(HORSE_FIELD_SCHEMAS.sub_strain_desc).toBeDefined();
    const direct = buildHorseUpdateSchema().safeParse({
      expected_row_version: 1,
      changes: { main_strain_desc: "  Koheilan  ", sub_strain_desc: null },
    });
    expect(direct.success).toBe(true);
    if (direct.success) {
      expect(direct.data.changes.main_strain_desc).toBe("Koheilan");
      expect(direct.data.changes.sub_strain_desc).toBeNull();
    }
    // the reviewed whitelist keeps the exact same rule for these fields
    expect(parseHorseFieldValue("main_strain_desc", " x ").ok).toBe(true);
    expect(CHANGE_REQUEST_APPLICABLE_FIELDS.has("main_strain_desc")).toBe(true);
  });

  it("keeps the reviewed whitelist strictly smaller than the full field set (no parent edits via review)", () => {
    expect(CHANGE_REQUEST_APPLICABLE_FIELDS.has("father_id")).toBe(false);
    expect(CHANGE_REQUEST_APPLICABLE_FIELDS.has("mother_id")).toBe(false);
    expect(CHANGE_REQUEST_APPLICABLE_FIELDS.has("id")).toBe(false);
    // T12: parent changes go through the structured parent-correction
    // submission; the private precise address never enters the review queue.
    expect(CHANGE_REQUEST_APPLICABLE_FIELDS.has("precise_address")).toBe(false);
    // T12: typed dates and public places ARE reviewable profile facts.
    expect(CHANGE_REQUEST_APPLICABLE_FIELDS.has("birth_date")).toBe(true);
    expect(CHANGE_REQUEST_APPLICABLE_FIELDS.has("birth_city")).toBe(true);
    expect(CHANGE_REQUEST_APPLICABLE_FIELDS.has("keeping_city")).toBe(true);
    // Approved registration details extend the reviewable facts; privileged
    // state/parent fields above must remain outside the generic item path.
    expect(CHANGE_REQUEST_APPLICABLE_FIELDS.has("birth_name")).toBe(true);
    expect(CHANGE_REQUEST_APPLICABLE_FIELDS.has("previous_names")).toBe(true);
    expect(CHANGE_REQUEST_APPLICABLE_FIELDS.has("is_dead")).toBe(false);
    expect(CHANGE_REQUEST_APPLICABLE_FIELDS.has("is_active")).toBe(false);
  });

  it("create schema keeps id optional, name_latin required, everything else optional-or-null", () => {
    expect(buildHorseCreateSchema().safeParse({ name_latin: "Minima" }).success).toBe(true);
    expect(buildHorseCreateSchema().safeParse({}).success).toBe(false);
    expect(buildHorseCreateSchema().safeParse({ id: 41, name_latin: "Explicit" }).success).toBe(true);
    expect(buildHorseCreateSchema().safeParse({ name_latin: "N", name_native: null, sex_desc: "Stallion" }).success).toBe(true);
  });
});

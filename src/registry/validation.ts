import { z } from "zod";
import { parseRegistryDate } from "./dates";
import { isTypedDateChange, TYPED_DATE_FIELDS, typedDateChange, type TypedDateChange, type TypedDateField } from "./relations";

/**
 * Master-Ai plan T07: the ONE shared source of horse field validation.
 *
 * Direct edits (create + update), reviewed change requests and every other
 * canonical horse write path must accept/reject the same values and store the
 * same normalized representation. Before T07 the direct path validated through
 * a Zod object in routes.ts while the reviewed path kept a second field map in
 * changeRequestValidation.ts — two definitions that had to be kept in sync by
 * hand. This module is now that single source:
 *
 *   - HORSE_FIELD_SCHEMAS        every mutable horse column + its Zod rule
 *   - buildHorseCreateSchema()   the create payload (id optional, name required)
 *   - buildHorseUpdateSchema()   the direct-edit payload (expected_row_version)
 *   - CHANGE_REQUEST_FIELD_SCHEMAS  the reviewed-update whitelist (no pedigree
 *                                  fields — parent changes need full parent
 *                                  validation and go through direct edits)
 *   - parseHorseFieldValue()     per-field parse returning the NORMALIZED value
 *                                  (Zod transforms applied — "  X  " -> "X")
 */

const CURRENT_YEAR = new Date().getUTCFullYear();

/** R146-D04: permitted policy-override receipts. A blocker can NEVER be
 *  overridden (enforced again server-side); these carry rule_id + reason. */
export const RULE_OVERRIDES_SCHEMA = z
  .array(z.object({ rule_id: z.string().trim().min(1).max(200), reason: z.string().trim().min(3).max(2000) }))
  .max(50);

/** T12: shape-only schema for typed date fields — calendar mathematics is
 * validated by parseRegistryDate (single source of truth), never by zod. */
const RegistryDateInputSchema = z.object({
  value: z.string().max(10),
  precision: z.enum(["day", "month", "year"]),
  calendar: z.enum(["gregorian", "solar_hijri"]),
});

export const HORSE_FIELD_SCHEMAS = {
  name_latin: z.string().trim().min(1).max(200),
  name_native: z.string().trim().max(200).nullable(),
  register_no: z.string().trim().max(120).nullable(),
  microchip_no: z.string().trim().max(120).nullable(),
  passport_no: z.string().trim().max(120).nullable(),
  passport_issuer: z.string().trim().min(2).max(200).nullable(),
  uel_no: z.string().trim().max(120).nullable(),
  life_number: z.string().trim().max(120).nullable(),
  foreign_registration_no: z.string().trim().max(120).nullable(),
  foreign_registration_issuer: z.string().trim().min(2).max(200).nullable(),
  birth_name: z.string().trim().max(200).nullable(),
  previous_names: z.array(z.string().trim().min(1).max(200)).max(30).nullable(),
  markings: z.string().trim().max(2000).nullable(),
  height_cm: z.number().finite().min(30).max(250).nullable(),
  life_status: z.enum(["unknown", "alive", "dead", "missing"]),
  father_id: z.number().int().positive().nullable(),
  mother_id: z.number().int().positive().nullable(),
  birth_year: z.number().int().min(1500).max(CURRENT_YEAR + 1).nullable(),
  birth_place_desc: z.string().trim().max(200).nullable(),
  breed_desc: z.string().trim().max(120).nullable(),
  sex_desc: z.string().trim().max(80).nullable(),
  color_desc: z.string().trim().max(80).nullable(),
  description: z.string().trim().max(4000).nullable(),
  main_strain_desc: z.string().trim().max(200).nullable(),
  sub_strain_desc: z.string().trim().max(200).nullable(),
  // T12: public birth/keeping places, separate from the private address.
  birth_city: z.string().trim().max(200).nullable(),
  birth_province: z.string().trim().max(200).nullable(),
  keeping_city: z.string().trim().max(200).nullable(),
  keeping_province: z.string().trim().max(200).nullable(),
  // T12: typed registry dates — value + precision + explicit calendar.
  birth_date: RegistryDateInputSchema.nullable(),
  death_date: RegistryDateInputSchema.nullable(),
  castration_date: RegistryDateInputSchema.nullable(),
  passport_issue_date: RegistryDateInputSchema.nullable(),
  passport_expiry: RegistryDateInputSchema.nullable(),
  // T12: PRIVATE precise address — direct editorial writes only, excluded
  // from the reviewed-change whitelist (PII never enters the review queue).
  precise_address: z.string().trim().max(2000).nullable(),
} as const;

export type HorseFieldName = keyof typeof HORSE_FIELD_SCHEMAS;
export type HorseFieldValue = string | number | null | TypedDateChange;

export function isTypedDateField(field: string): field is TypedDateField {
  return (TYPED_DATE_FIELDS as readonly string[]).includes(field);
}

export type { TypedDateChange, TypedDateField };

/**
 * Fields a reviewed update_horse change request may canonically set. Pedigree
 * (father_id/mother_id) and the synthetic id are deliberately excluded: parent
 * changes go through the T12 parent-correction submission (structured, with
 * source/conflict evidence) or the direct editorial path. The private precise
 * address is excluded too: PII never enters the public review queue.
 */
const CHANGE_REQUEST_EXCLUDED_FIELDS = new Set(["father_id", "mother_id", "precise_address", "passport_no", "passport_issuer", "passport_issue_date", "passport_expiry", "foreign_registration_no", "foreign_registration_issuer"]);
export const CHANGE_REQUEST_FIELD_SCHEMAS: Readonly<Record<string, z.ZodTypeAny>> = Object.fromEntries(
  (Object.keys(HORSE_FIELD_SCHEMAS) as HorseFieldName[])
    .filter((field) => !CHANGE_REQUEST_EXCLUDED_FIELDS.has(field))
    .map((field) => [field, HORSE_FIELD_SCHEMAS[field] as z.ZodTypeAny]),
);

export const CHANGE_REQUEST_APPLICABLE_FIELDS: ReadonlySet<string> = new Set(Object.keys(CHANGE_REQUEST_FIELD_SCHEMAS));

export function buildHorseCreateSchema() {
  // Explicit field list (not spread) so the parsed output keeps precise types.
  return z.object({
    id: z.number().int().positive().optional(),
    name_latin: HORSE_FIELD_SCHEMAS.name_latin,
    name_native: HORSE_FIELD_SCHEMAS.name_native.optional(),
    register_no: HORSE_FIELD_SCHEMAS.register_no.optional(),
    microchip_no: HORSE_FIELD_SCHEMAS.microchip_no.optional(),
    passport_no: HORSE_FIELD_SCHEMAS.passport_no.optional(),
    passport_issuer: HORSE_FIELD_SCHEMAS.passport_issuer.optional(),
    passport_issue_date: HORSE_FIELD_SCHEMAS.passport_issue_date.optional(),
    passport_expiry: HORSE_FIELD_SCHEMAS.passport_expiry.optional(),
    uel_no: HORSE_FIELD_SCHEMAS.uel_no.optional(),
    life_number: HORSE_FIELD_SCHEMAS.life_number.optional(),
    foreign_registration_no: HORSE_FIELD_SCHEMAS.foreign_registration_no.optional(),
    foreign_registration_issuer: HORSE_FIELD_SCHEMAS.foreign_registration_issuer.optional(),
    birth_name: HORSE_FIELD_SCHEMAS.birth_name.optional(),
    previous_names: HORSE_FIELD_SCHEMAS.previous_names.optional(),
    markings: HORSE_FIELD_SCHEMAS.markings.optional(),
    height_cm: HORSE_FIELD_SCHEMAS.height_cm.optional(),
    life_status: HORSE_FIELD_SCHEMAS.life_status.optional(),
    father_id: HORSE_FIELD_SCHEMAS.father_id.optional(),
    mother_id: HORSE_FIELD_SCHEMAS.mother_id.optional(),
    birth_year: HORSE_FIELD_SCHEMAS.birth_year.optional(),
    birth_place_desc: HORSE_FIELD_SCHEMAS.birth_place_desc.optional(),
    breed_desc: HORSE_FIELD_SCHEMAS.breed_desc.optional(),
    sex_desc: HORSE_FIELD_SCHEMAS.sex_desc.optional(),
    color_desc: HORSE_FIELD_SCHEMAS.color_desc.optional(),
    description: HORSE_FIELD_SCHEMAS.description.optional(),
    main_strain_desc: HORSE_FIELD_SCHEMAS.main_strain_desc.optional(),
    sub_strain_desc: HORSE_FIELD_SCHEMAS.sub_strain_desc.optional(),
    // T12: typed dates + places on the direct create path as well.
    birth_city: HORSE_FIELD_SCHEMAS.birth_city.optional(),
    birth_province: HORSE_FIELD_SCHEMAS.birth_province.optional(),
    keeping_city: HORSE_FIELD_SCHEMAS.keeping_city.optional(),
    keeping_province: HORSE_FIELD_SCHEMAS.keeping_province.optional(),
    birth_date: HORSE_FIELD_SCHEMAS.birth_date.optional(),
    death_date: HORSE_FIELD_SCHEMAS.death_date.optional(),
    castration_date: HORSE_FIELD_SCHEMAS.castration_date.optional(),
    precise_address: HORSE_FIELD_SCHEMAS.precise_address.optional(),
    // R146-D04: permitted policy overrides (rule_id + reason), recorded in the
    // rule outcome trail; blockers are refused server-side regardless.
    rule_overrides: RULE_OVERRIDES_SCHEMA.optional(),
    // R148 Task 6: stable client command identity for direct-create retry
    // idempotency. The receipt commits with the creation; an exact retry
    // replays, reuse with different content is refused.
    command_key: z.string().trim().min(8).max(64).regex(/^[A-Za-z0-9._:-]+$/, "command_key must be a stable opaque token").optional(),
  });
}

export function buildHorseUpdateSchema() {
  return z.object({
    expected_row_version: z.number().int().positive(),
    changes: z.object(HORSE_FIELD_SCHEMAS).partial(),
    // R146-D04: permitted policy overrides (rule_id + reason).
    rule_overrides: RULE_OVERRIDES_SCHEMA.optional(),
  });
}

export type ParsedFieldValue = { ok: true; value: HorseFieldValue } | { ok: false };

/**
 * Parse one field value through the shared rule and return the NORMALIZED
 * value (Zod transforms applied). Undefined ("no change") is rejected here —
 * callers decide whether an absent key means "leave untouched".
 *
 * T12 typed-date fields are parsed through parseRegistryDate (calendar
 * mathematics, precision/format pairs, future-date bounds) and returned as a
 * TypedDateChange marker the mutation builder expands into the value /
 * precision / calendar column triple.
 */
export function parseHorseFieldValue(field: string, value: unknown): ParsedFieldValue {
  const schema = (HORSE_FIELD_SCHEMAS as Record<string, z.ZodTypeAny | undefined>)[field];
  if (!schema) return { ok: false };
  if (isTypedDateField(field)) {
    if (value === null) return { ok: true, value: typedDateChange(null, null) };
    const shape = schema.safeParse(value);
    if (!shape.success) return { ok: false };
    const typedInput = shape.data as { value: string; precision: "day" | "month" | "year"; calendar: "gregorian" | "solar_hijri" };
    const parsed = parseRegistryDate(typedInput, new Date().getUTCFullYear() + (field === "passport_expiry" ? 100 : 0));
    if (!parsed.ok) return { ok: false };
    return { ok: true, value: typedDateChange(parsed.date, parsed.gregorianYear) };
  }
  const check = schema.safeParse(value);
  if (!check.success) return { ok: false };
  if (field === "previous_names") return { ok: true, value: JSON.stringify([...new Set((check.data as string[] | null) ?? [])]) };
  return { ok: true, value: check.data as HorseFieldValue };
}

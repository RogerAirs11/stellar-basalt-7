/**
 * Presentation-boundary cleanup for source-system sentinels.
 * Canonical storage remains untouched for provenance; public DTOs normalize
 * placeholder text to null so UIs never present source artifacts as facts.
 */
const PUBLIC_OPTIONAL_TEXT_FIELDS = [
  "register_no", "microchip_no", "name_native", "birth_place_desc", "breed_desc", "sex_desc", "color_desc",
  "main_strain_desc", "sub_strain_desc", "company_code", "book_version", "originality", "birth_date",
  "birth_place_code", "breed_type", "sex_code", "color_code", "main_strain_no", "sub_strain_no", "uel_no",
  "dna_status", "dna_desc", "life_number", "passport_date", "passport_deliver_date", "imported_date",
  "imported_from_code", "imported_from_desc", "import_register_no", "export_certificate", "horse_sr_no",
  "death_date", "source_created_at", "father_name", "father_name_native", "mother_name", "mother_name_native",
  "owner_name", "owner_name_native", "breeder_name", "breeder_name_native",
  "importer_name", "importer_name_native", "passport_receiver_name", "passport_receiver_name_native",
  // T12: typed-date raw columns + public places. Precise address is NEVER
  // projected publicly and is absent from every public SELECT list.
  "birth_date_value", "death_date_value", "castration_date_value",
  "birth_city", "birth_province", "keeping_city", "keeping_province",
] as const;

export function normalizePublicText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  const normalized = text.toUpperCase();
  if (["NULL", "N/A", "NA", "UNKNOWN", "NONE", "0"].includes(normalized)) return null;
  if (/^-+$/.test(text)) return null;
  return text;
}

export function normalizePublicHorseRecord<T extends Record<string, unknown>>(row: T): T {
  const copy = { ...row } as Record<string, unknown>;
  for (const field of PUBLIC_OPTIONAL_TEXT_FIELDS) {
    if (field in copy) copy[field] = normalizePublicText(copy[field]);
  }
  return copy as T;
}

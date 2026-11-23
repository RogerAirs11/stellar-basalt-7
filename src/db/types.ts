export type UserRole = "user" | "owner" | "editor" | "admin" | "super_admin";

export interface PublicUser {
  id: string;
  email: string;
  display_name: string;
  role: UserRole;
}

export interface UserRow extends PublicUser {
  password_hash: string;
  is_active: number;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
}

export interface HorseRow {
  birth_name?: string | null;
  previous_names_json?: string;
  passport_issuer?: string | null;
  passport_issue_date_value?: string | null;
  passport_issue_date_precision?: string | null;
  passport_issue_date_calendar?: string | null;
  passport_expiry_value?: string | null;
  passport_expiry_precision?: string | null;
  passport_expiry_calendar?: string | null;
  foreign_registration_no?: string | null;
  foreign_registration_issuer?: string | null;
  life_status?: "unknown" | "alive" | "dead" | "missing";
  markings?: string | null;
  height_cm?: number | null;
  id: number;
  company_code: string | null;
  register_no: string | null;
  microchip_no: string | null;
  file_number: string | null;
  name_latin: string;
  name_native: string | null;
  father_id: number | null;
  mother_id: number | null;
  book_version: string | null;
  is_active: number;
  originality: string | null;
  birth_date: string | null;
  birth_year: number | null;
  birth_place_code: string | null;
  birth_place_desc: string | null;
  breed_type: string | null;
  breed_desc: string | null;
  sex_code: string | null;
  sex_desc: string | null;
  color_code: string | null;
  color_desc: string | null;
  main_strain_no: string | null;
  main_strain_desc: string | null;
  sub_strain_no: string | null;
  sub_strain_desc: string | null;
  uel_no: string | null;
  lab_no: string | null;
  dna_status: string | null;
  dna_desc: string | null;
  life_number: string | null;
  passport_no: string | null;
  passport_date: string | null;
  passport_deliver_date: string | null;
  is_stallion: number;
  is_sport: number;
  is_imported: number;
  imported_date: string | null;
  imported_from_code: string | null;
  imported_from_desc: string | null;
  import_register_no: string | null;
  export_certificate: string | null;
  horse_sr_no: string | null;
  is_dead: number;
  death_date: string | null;
  // T12: typed registry dates (value + precision + explicit calendar) and
  // the raw source note for the birth date. birth_year stays the Gregorian
  // bucket year used by search/filters (synced on typed writes).
  birth_date_value: string | null;
  birth_date_precision: string | null;
  birth_date_calendar: string | null;
  birth_date_source: string | null;
  death_date_value: string | null;
  death_date_precision: string | null;
  death_date_calendar: string | null;
  castration_date_value: string | null;
  castration_date_precision: string | null;
  castration_date_calendar: string | null;
  // T12: public birth/keeping places, separate from the private address.
  birth_city: string | null;
  birth_province: string | null;
  keeping_city: string | null;
  keeping_province: string | null;
  /** PRIVATE — never in any public projection; owner/staff reads only. */
  precise_address: string | null;
  /** Turn 12: per-row data lineage (original xlsx import vs scrape source).
   *  Staff-only — see DATA_VISIBILITY.md; never on public projections. */
  data_origin: string | null;
  is_register_sport: number;
  has_sport_card: number;
  allow_stallion: number;
  description: string | null;
  // turn 32: representative profile photo (prominent records only; the credit
  // column always names the photo's origin class — never a passport photo).
  profile_image_url: string | null;
  profile_image_credit: string | null;
  source_created_at: string | null;
  raw_json: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  row_version: number;
  last_mutation_id?: string | null;
}

export type PublicHorseRow = Pick<HorseRow,
  "id" | "register_no" | "microchip_no" | "name_latin" | "name_native" | "father_id" | "mother_id" |
  "birth_year" | "birth_place_desc" | "breed_desc" | "sex_desc" | "color_desc" |
  "main_strain_desc" | "sub_strain_desc" | "is_active" | "is_dead"
>;

// R151 (owner directive): microchip_no joins the public projection as an
// opt-in column. The heritage browse table keeps it hidden by default and
// never renders it inside the combined name/owner cell.
export const PUBLIC_HORSE_FIELDS = [
  "id", "register_no", "microchip_no", "name_latin", "name_native", "father_id", "mother_id", "birth_year", "birth_place_desc",
  "breed_desc", "sex_desc", "color_desc", "main_strain_desc", "sub_strain_desc", "is_active", "is_dead",
] as const;

export const PUBLIC_HORSE_COLUMNS = PUBLIC_HORSE_FIELDS.join(",");
export const PUBLIC_HORSE_COLUMNS_H = PUBLIC_HORSE_FIELDS.map((field) => `h.${field}`).join(",");

/**
 * Rich registry-profile fields deliberately approved for public registry detail.
 * Sensitive/source-internal fields remain excluded by DATA_VISIBILITY.md.
 * Keep browse/search DTOs compact; these fields are loaded only for a horse profile.
 */
export const PUBLIC_HORSE_PROFILE_FIELDS = [
  ...PUBLIC_HORSE_FIELDS,
  "birth_name", "previous_names_json", "life_status", "markings", "height_cm",
  "company_code", "book_version", "originality", "birth_date", "birth_place_code",
  "breed_type", "sex_code", "color_code", "main_strain_no", "sub_strain_no",
  "uel_no", "dna_status", "dna_desc", "life_number", "passport_date", "passport_deliver_date",
  "is_stallion", "is_sport", "is_imported", "imported_date", "imported_from_code", "imported_from_desc",
  "import_register_no", "export_certificate", "horse_sr_no", "death_date", "is_register_sport",
  "has_sport_card", "allow_stallion", "source_created_at",
  // T12: typed dates + public places. birth_date_source (raw provenance note)
  // and precise_address stay staff-only.
  "birth_date_value", "birth_date_precision", "birth_date_calendar",
  "death_date_value", "death_date_precision", "death_date_calendar",
  "castration_date_value", "castration_date_precision", "castration_date_calendar",
  "birth_city", "birth_province", "keeping_city", "keeping_province",
  // turn 32: representative profile photo.
  "profile_image_url", "profile_image_credit",
] as const;
export type PublicHorseProfileRow = Pick<HorseRow, (typeof PUBLIC_HORSE_PROFILE_FIELDS)[number]>;
export const PUBLIC_HORSE_PROFILE_COLUMNS_H = PUBLIC_HORSE_PROFILE_FIELDS.map((field) => `h.${field}`).join(",");

export const ADMIN_EDIT_HORSE_FIELDS = [
  "id", "register_no", "microchip_no", "name_latin", "name_native", "father_id", "mother_id", "birth_year", "birth_place_desc",
  "breed_desc", "sex_desc", "color_desc", "main_strain_desc", "sub_strain_desc", "description", "is_active", "is_dead", "row_version", "updated_at",
  "birth_city", "birth_province", "keeping_city", "keeping_province", "precise_address",
  "birth_date_value", "birth_date_precision", "birth_date_calendar",
  "death_date_value", "death_date_precision", "death_date_calendar",
  "castration_date_value", "castration_date_precision", "castration_date_calendar",
] as const;
export const ADMIN_EDIT_HORSE_COLUMNS = ADMIN_EDIT_HORSE_FIELDS.join(",");

/**
 * Privileged read DTO for curation. This intentionally excludes raw_json and
 * deletion internals while exposing every canonical registry field needed for
 * staff review. Editing remains separately constrained by HorseUpdateSchema.
 */
export const ADMIN_HORSE_DETAIL_FIELDS = [
  "birth_name", "previous_names_json", "life_status", "markings", "height_cm",
  "passport_issuer", "passport_issue_date_value", "passport_issue_date_precision", "passport_issue_date_calendar",
  "passport_expiry_value", "passport_expiry_precision", "passport_expiry_calendar", "foreign_registration_no", "foreign_registration_issuer",
  "id", "company_code", "register_no", "microchip_no", "file_number", "name_latin", "name_native",
  "father_id", "mother_id", "book_version", "is_active", "originality", "birth_date", "birth_year",
  "birth_place_code", "birth_place_desc", "breed_type", "breed_desc", "sex_code", "sex_desc",
  "color_code", "color_desc", "main_strain_no", "main_strain_desc", "sub_strain_no", "sub_strain_desc",
  "uel_no", "lab_no", "dna_status", "dna_desc", "life_number", "passport_no", "passport_date",
  "passport_deliver_date", "is_stallion", "is_sport", "is_imported", "imported_date", "imported_from_code",
  "imported_from_desc", "import_register_no", "export_certificate", "horse_sr_no", "is_dead", "death_date",
  "is_register_sport", "has_sport_card", "allow_stallion", "description", "source_created_at", "created_at",
  "updated_at", "row_version",
  // T12: full typed-date + place facts including the private precise address
  // and the raw birth-date source note (staff-only by DATA_VISIBILITY.md).
  "birth_date_value", "birth_date_precision", "birth_date_calendar", "birth_date_source",
  "death_date_value", "death_date_precision", "death_date_calendar",
  "castration_date_value", "castration_date_precision", "castration_date_calendar",
  "birth_city", "birth_province", "keeping_city", "keeping_province", "precise_address",
  // Turn 12: per-row data lineage (original xlsx import vs scrape source) —
  // staff-only admin debugging fact; never on public projections.
  "data_origin",
] as const;
export type AdminHorseDetailRow = Pick<HorseRow, (typeof ADMIN_HORSE_DETAIL_FIELDS)[number]>;
export const ADMIN_HORSE_DETAIL_COLUMNS = ADMIN_HORSE_DETAIL_FIELDS.join(",");

export type SearchHorseRow = PublicHorseRow & {
  // R158: owner display names ride along on search rows so both frontends can
  // show the owner in result tables (browse already materializes them).
  owner_name?: string | null;
  owner_name_native?: string | null;
  breeder_name?: string | null;
  breeder_name_native?: string | null;
};
export const SEARCH_HORSE_FIELDS = PUBLIC_HORSE_FIELDS;
export const SEARCH_HORSE_COLUMNS_H = SEARCH_HORSE_FIELDS.map((field) => `h.${field}`).join(",");

export type PedigreeHorseRow = Pick<HorseRow, "id" | "name_latin" | "name_native" | "father_id" | "mother_id" | "birth_year" | "breed_desc" | "sex_desc" | "color_desc" | "main_strain_desc">;
export const PEDIGREE_HORSE_FIELDS = ["id", "name_latin", "name_native", "father_id", "mother_id", "birth_year", "breed_desc", "sex_desc", "color_desc", "main_strain_desc"] as const;
export const PEDIGREE_HORSE_COLUMNS = PEDIGREE_HORSE_FIELDS.join(",");
export const PEDIGREE_HORSE_COLUMNS_H = PEDIGREE_HORSE_FIELDS.map((field) => `h.${field}`).join(",");

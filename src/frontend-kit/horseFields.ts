import type { AdminHorseRecord, HorseRecord } from "../contracts/platform";

export type HorseFieldGroup = "identity" | "registry" | "origin" | "lineage" | "status";
export type HorseFieldKind = "text" | "number" | "date" | "boolean" | "json_names" | "life_status";

export interface HorseFieldDescriptor {
  key: keyof HorseRecord;
  group: HorseFieldGroup;
  label: { en: string; fa: string };
  kind: HorseFieldKind;
  value: string | number | null;
}

type FieldSpec = Omit<HorseFieldDescriptor, "value">;

/**
 * Canonical safe/public horse-detail presentation map.
 * Frontends own rendering and visual language; this list owns semantic coverage.
 * Staff-only identifiers and free text are deliberately absent and are available
 * only through PlatformClient.admin.horses for authorized curation surfaces.
 */
export const PUBLIC_HORSE_DETAIL_FIELD_SPECS = Object.freeze([
  spec("birth_name", "identity", "Birth name", "نام بدو تولد"),
  spec("previous_names_json", "identity", "Previous names", "نام‌های قبلی", "json_names"),
  spec("height_cm", "identity", "Height at withers (cm)", "قد تا جدوگاه (سانتی‌متر)", "number"),
  spec("markings", "identity", "Markings", "علائم ظاهری"),
  spec("life_status", "status", "Life status", "وضعیت حیات", "life_status"),
  spec("register_no", "identity", "Registry number", "شماره ثبت"),
  spec("company_code", "registry", "Registry company code", "کد شرکت ثبت‌کننده"),
  spec("book_version", "registry", "Studbook version", "نسخهٔ کتاب تبارنامه"),
  spec("originality", "registry", "Originality", "اصالت"),
  spec("birth_year", "identity", "Birth year", "سال تولد", "number"),
  spec("birth_date", "identity", "Birth date", "تاریخ تولد", "date"),
  spec("birth_place_desc", "origin", "Birth place", "محل تولد"),
  spec("birth_place_code", "origin", "Birth place code", "کد محل تولد"),
  spec("birth_city", "origin", "Birth city", "شهر تولد"),
  spec("birth_province", "origin", "Birth province", "استان تولد"),
  spec("keeping_city", "origin", "Current keeping city", "شهر نگهداری فعلی"),
  spec("keeping_province", "origin", "Current keeping province", "استان نگهداری فعلی"),
  spec("breed_desc", "identity", "Breed", "نژاد"),
  spec("breed_type", "registry", "Breed type", "نوع نژاد"),
  spec("sex_desc", "identity", "Sex", "جنسیت"),
  spec("sex_code", "registry", "Sex code", "کد جنسیت"),
  spec("color_desc", "identity", "Color", "رنگ"),
  spec("color_code", "registry", "Color code", "کد رنگ"),
  spec("main_strain_desc", "lineage", "Main strain", "تیره اصلی"),
  spec("main_strain_no", "lineage", "Main strain number", "شماره تیره اصلی"),
  spec("sub_strain_desc", "lineage", "Sub strain", "زیرتیره"),
  spec("sub_strain_no", "lineage", "Sub strain number", "شماره زیرتیره"),
  spec("uel_no", "registry", "UEL number", "شماره UEL"),
  spec("life_number", "registry", "Life number", "شماره شناسایی مادام‌العمر"),
  spec("dna_status", "registry", "DNA status", "وضعیت DNA"),
  spec("dna_desc", "registry", "DNA note", "شرح DNA"),
  spec("passport_date", "registry", "Passport date", "تاریخ گذرنامه", "date"),
  spec("passport_deliver_date", "registry", "Passport delivery date", "تاریخ تحویل گذرنامه", "date"),
  spec("horse_sr_no", "registry", "Registry serial", "شماره سریال ثبت"),
  spec("is_active", "status", "Active", "فعال", "boolean"),
  spec("is_dead", "status", "Deceased", "تلف‌شده", "boolean"),
  spec("death_date", "status", "Death date", "تاریخ تلف", "date"),
  spec("is_imported", "origin", "Imported", "وارداتی", "boolean"),
  spec("imported_date", "origin", "Import date", "تاریخ ورود", "date"),
  spec("imported_from_desc", "origin", "Imported from", "مبدأ واردات"),
  spec("imported_from_code", "origin", "Import origin code", "کد مبدأ واردات"),
  spec("import_register_no", "origin", "Import register number", "شماره ثبت واردات"),
  spec("export_certificate", "origin", "Export certificate", "گواهی صادرات"),
  spec("is_stallion", "status", "Stallion registry flag", "ثبت‌شده به‌عنوان نریان", "boolean"),
  spec("allow_stallion", "status", "Stallion approved", "نریان تأییدشده", "boolean"),
  spec("is_sport", "status", "Sport horse", "اسب ورزشی", "boolean"),
  spec("is_register_sport", "status", "Sport registered", "ثبت‌شده به‌عنوان اسب ورزشی", "boolean"),
  spec("has_sport_card", "status", "Sport card", "کارت ورزشی", "boolean"),
  spec("source_created_at", "registry", "Source record date", "تاریخ ثبت در منبع", "date"),
] as const satisfies readonly FieldSpec[]);

export function publicHorseDetailFields(horse: HorseRecord, options: { includeEmpty?: boolean; locale?: string } = {}): HorseFieldDescriptor[] {
  const includeEmpty = options.includeEmpty ?? false;
  return PUBLIC_HORSE_DETAIL_FIELD_SPECS.flatMap((field) => {
    const raw = horse[field.key];
    const value = normalizeValue(raw, field.kind, options.locale);
    return includeEmpty || value !== null ? [{ ...field, value }] : [];
  });
}

export function horseFieldsByGroup(horse: HorseRecord, options: { includeEmpty?: boolean } = {}): Record<HorseFieldGroup, HorseFieldDescriptor[]> {
  const groups: Record<HorseFieldGroup, HorseFieldDescriptor[]> = { identity: [], registry: [], origin: [], lineage: [], status: [] };
  for (const field of publicHorseDetailFields(horse, options)) groups[field.group].push(field);
  return groups;
}

export interface StaffHorseFieldDescriptor extends Omit<HorseFieldDescriptor, "key"> { key: keyof AdminHorseRecord }
type StaffFieldSpec = Omit<StaffHorseFieldDescriptor, "value">;
function staffSpec(key: keyof AdminHorseRecord, en: string, fa: string): StaffFieldSpec { return { key, group: "registry", label: { en, fa }, kind: "text" }; }
/** These fields are rendered only from an authorized admin read. Never merge
 * this list into the public detail map or use it to widen a server projection. */
export const STAFF_HORSE_DETAIL_FIELD_SPECS = Object.freeze([
  staffSpec("microchip_no", "Microchip number", "شماره ریزتراشه"),
  staffSpec("file_number", "File number", "شماره پرونده"),
  staffSpec("lab_no", "Laboratory number", "شماره آزمایشگاه"),
  staffSpec("passport_no", "Passport number", "شماره گذرنامه"),
  staffSpec("passport_issuer", "Passport issuer", "مرجع صدور گذرنامه"),
  staffSpec("passport_issue_date_value", "Passport issue date — source value", "تاریخ صدور گذرنامه — مقدار منبع"),
  staffSpec("passport_issue_date_precision", "Passport issue date — precision", "تاریخ صدور گذرنامه — دقت"),
  staffSpec("passport_issue_date_calendar", "Passport issue date — calendar", "تاریخ صدور گذرنامه — تقویم"),
  staffSpec("passport_expiry_value", "Passport expiry — source value", "انقضای گذرنامه — مقدار منبع"),
  staffSpec("passport_expiry_precision", "Passport expiry — precision", "انقضای گذرنامه — دقت"),
  staffSpec("passport_expiry_calendar", "Passport expiry — calendar", "انقضای گذرنامه — تقویم"),
  staffSpec("foreign_registration_no", "Foreign registration number", "شماره ثبت خارجی"),
  staffSpec("foreign_registration_issuer", "Foreign registration issuer", "مرجع ثبت خارجی"),
  staffSpec("birth_date_value", "Birth date — source value", "تاریخ تولد — مقدار منبع"),
  staffSpec("birth_date_precision", "Birth date — precision", "تاریخ تولد — دقت"),
  staffSpec("birth_date_calendar", "Birth date — calendar", "تاریخ تولد — تقویم"),
  staffSpec("birth_date_source", "Birth date — source", "تاریخ تولد — منبع"),
  staffSpec("death_date_value", "Death date — source value", "تاریخ تلف — مقدار منبع"),
  staffSpec("death_date_precision", "Death date — precision", "تاریخ تلف — دقت"),
  staffSpec("death_date_calendar", "Death date — calendar", "تاریخ تلف — تقویم"),
  staffSpec("castration_date_value", "Castration date — source value", "تاریخ اخته‌کردن — مقدار منبع"),
  staffSpec("castration_date_precision", "Castration date — precision", "تاریخ اخته‌کردن — دقت"),
  staffSpec("castration_date_calendar", "Castration date — calendar", "تاریخ اخته‌کردن — تقویم"),
  staffSpec("precise_address", "Precise keeping address", "نشانی دقیق نگهداری"),
  staffSpec("description", "Source description", "توضیحات منبع"),
  staffSpec("data_origin", "Data origin", "منبع داده"),
  staffSpec("created_at", "Created at", "زمان ایجاد"),
  staffSpec("updated_at", "Updated at", "زمان ویرایش"),
] as const satisfies readonly StaffFieldSpec[]);
export function staffHorseDetailFields(horse: AdminHorseRecord, options: { includeEmpty?: boolean } = {}): StaffHorseFieldDescriptor[] {
  return STAFF_HORSE_DETAIL_FIELD_SPECS.flatMap(field => {
    const value = normalizeValue(horse[field.key], field.kind);
    return options.includeEmpty || value !== null ? [{ ...field, value }] : [];
  });
}

function spec<K extends keyof HorseRecord>(key: K, group: HorseFieldGroup, en: string, fa: string, kind: HorseFieldKind = "text"): FieldSpec {
  return { key, group, label: { en, fa }, kind };
}

function normalizeValue(value: unknown, kind: HorseFieldKind, locale = "en"): string | number | null {
  if (value === null || value === undefined || value === "") return null;
  if (kind === "json_names") { try { const names: unknown = typeof value === "string" ? JSON.parse(value) : value; return Array.isArray(names) ? names.filter(name => typeof name === "string" && name.trim()).join("; ") || null : null; } catch { return null; } }
  if (kind === "life_status") { const labels: Record<string, [string, string]> = { unknown: ["Unknown", "نامعلوم"], alive: ["Alive", "زنده"], dead: ["Deceased", "تلف‌شده"], missing: ["Missing", "مفقود"] }; return labels[String(value)]?.[locale === "fa" ? 1 : 0] ?? String(value); }
  if (typeof value === "string") {
    const text = value.trim();
    const normalized = text.toUpperCase();
    if (!text || ["NULL", "N/A", "NA", "UNKNOWN", "NONE", "0"].includes(normalized) || /^-+$/.test(text)) return null;
  }
  if (kind === "boolean") return Number(value) === 1 ? 1 : 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  return String(value);
}

import type { AdminHorseRecord, HorseCurationInput, RegistryDateInput } from "../contracts/platform";
import { parseRegistryDate } from "../registry/dates";
import { toAsciiDigits } from "../shared/numerals";

type FieldGroup = "identity" | "identifiers" | "parents" | "places" | "notes";
type InputKind = "text" | "multiline" | "number" | "names" | "life_status";
export interface CurationFieldSpec { key: Exclude<keyof HorseCurationInput, "id">; group: FieldGroup; en: string; fa: string; kind: InputKind; maxLength: number }
function field(key: CurationFieldSpec["key"], group: FieldGroup, en: string, fa: string, kind: InputKind = "text", maxLength = 200): CurationFieldSpec { return { key, group, en, fa, kind, maxLength }; }
/** Actual controls consumed by both authorized curation forms. */
export const HORSE_CURATION_FIELD_SPECS = [
  field("name_latin", "identity", "Latin name", "نام لاتین"),
  field("name_native", "identity", "Native name", "نام بومی"),
  field("birth_name", "identity", "Birth name", "نام بدو تولد"),
  field("previous_names", "identity", "Previous names — one per line", "نام‌های قبلی — هر نام در یک خط", "names", 6030),
  field("birth_year", "identity", "Birth year (Gregorian search bucket)", "سال تولد (میلادی برای جست‌وجو)", "number", 4),
  field("breed_desc", "identity", "Breed", "نژاد", "text", 120),
  field("sex_desc", "identity", "Recorded sex", "جنسیت ثبت‌شده", "text", 80),
  field("color_desc", "identity", "Color", "رنگ", "text", 80),
  field("height_cm", "identity", "Height at withers (cm)", "قد تا جدوگاه (سانتی‌متر)", "number", 8),
  field("markings", "identity", "Markings", "علائم ظاهری", "multiline", 2000),
  field("life_status", "identity", "Life status", "وضعیت حیات", "life_status"),
  field("register_no", "identifiers", "Registry number", "شماره ثبت", "text", 120),
  field("microchip_no", "identifiers", "Microchip number (private)", "شماره ریزتراشه (خصوصی)", "text", 120),
  field("passport_no", "identifiers", "Passport number (private)", "شماره گذرنامه (خصوصی)", "text", 120),
  field("passport_issuer", "identifiers", "Passport issuer (private)", "مرجع صدور گذرنامه (خصوصی)"),
  field("uel_no", "identifiers", "UEL number", "شماره UEL", "text", 120),
  field("life_number", "identifiers", "Life number", "شماره شناسایی مادام‌العمر", "text", 120),
  field("foreign_registration_no", "identifiers", "Foreign registration number (private)", "شماره ثبت خارجی (خصوصی)", "text", 120),
  field("foreign_registration_issuer", "identifiers", "Foreign registration issuer (private)", "مرجع ثبت خارجی (خصوصی)"),
  field("father_id", "parents", "Registered sire ID", "شناسه پدر ثبت‌شده", "number", 16),
  field("mother_id", "parents", "Registered dam ID", "شناسه مادر ثبت‌شده", "number", 16),
  field("main_strain_desc", "parents", "Main strain", "تیره اصلی"),
  field("sub_strain_desc", "parents", "Sub strain", "زیرتیره"),
  field("birth_place_desc", "places", "Birth place", "محل تولد"),
  field("birth_city", "places", "Birth city", "شهر تولد"),
  field("birth_province", "places", "Birth province", "استان تولد"),
  field("keeping_city", "places", "Keeping city", "شهر نگهداری"),
  field("keeping_province", "places", "Keeping province", "استان نگهداری"),
  field("precise_address", "places", "Precise keeping address (private)", "نشانی دقیق نگهداری (خصوصی)", "multiline", 2000),
  field("description", "notes", "Source description (staff)", "توضیحات منبع (کارکنان)", "multiline", 4000),
] as const;

/** Explicit API-to-storage mappings, used for real hydration and parity checks. */
export const HORSE_CURATION_DATE_FIELDS = {
  birth_date: { columns: ["birth_date_value", "birth_date_precision", "birth_date_calendar"], en: "Birth date", fa: "تاریخ تولد" },
  death_date: { columns: ["death_date_value", "death_date_precision", "death_date_calendar"], en: "Death date", fa: "تاریخ تلف" },
  castration_date: { columns: ["castration_date_value", "castration_date_precision", "castration_date_calendar"], en: "Castration date", fa: "تاریخ اخته‌کردن" },
  passport_issue_date: { columns: ["passport_issue_date_value", "passport_issue_date_precision", "passport_issue_date_calendar"], en: "Passport issue date (private)", fa: "تاریخ صدور گذرنامه (خصوصی)" },
  passport_expiry: { columns: ["passport_expiry_value", "passport_expiry_precision", "passport_expiry_calendar"], en: "Passport expiry date (private)", fa: "تاریخ انقضای گذرنامه (خصوصی)" },
} as const;
export const HORSE_CURATION_COLUMN_FIELDS = { previous_names: "previous_names_json" } as const;
export type CurationDateField = keyof typeof HORSE_CURATION_DATE_FIELDS;
export type CurationDateDraft = { value: string; precision: RegistryDateInput["precision"] | ""; calendar: RegistryDateInput["calendar"] | "" };
export interface HorseCurationDraft { fields: Record<string, string>; dates: Record<CurationDateField, CurationDateDraft> }
export const CURATION_DATE_KEYS = Object.keys(HORSE_CURATION_DATE_FIELDS) as CurationDateField[];

export function horseCurationDraft(horse?: AdminHorseRecord): HorseCurationDraft {
  const fields = Object.fromEntries(HORSE_CURATION_FIELD_SPECS.map(spec => {
    if (spec.key === "previous_names") {
      let values: unknown = [];
      try { values = JSON.parse(horse?.[HORSE_CURATION_COLUMN_FIELDS.previous_names] ?? "[]"); } catch { /* Preserve malformed source by not including unchanged fields in an update. */ }
      return [spec.key, Array.isArray(values) ? values.filter(value => typeof value === "string").join("\n") : ""];
    }
    if (spec.key === "life_status") return [spec.key, horse?.is_dead === 1 || horse?.death_date_value ? "dead" : horse?.life_status ?? "unknown"];
    return [spec.key, String(horse?.[spec.key as keyof AdminHorseRecord] ?? "")];
  }));
  const dates = Object.fromEntries(CURATION_DATE_KEYS.map(key => {
    const [valueKey, precisionKey, calendarKey] = HORSE_CURATION_DATE_FIELDS[key].columns;
    const value = String(horse?.[valueKey] ?? ""); const precision = horse?.[precisionKey]; const calendar = horse?.[calendarKey];
    return [key, { value, precision: value ? ["day", "month", "year"].includes(precision ?? "") ? precision : "" : "year", calendar: value ? ["gregorian", "solar_hijri"].includes(calendar ?? "") ? calendar : "" : "gregorian" }];
  })) as HorseCurationDraft["dates"];
  return { fields, dates };
}

type CurationText = (en: string, fa: string) => string;
const identityNumbers = new Set(["register_no", "microchip_no", "passport_no", "uel_no", "life_number", "foreign_registration_no"]);
function numericValue(raw: string, key: string, L: CurationText): number | null {
  const text = toAsciiDigits(raw).replace(/٫/g, ".").trim(); if (!text) return null;
  const value = Number(text); const integer = key !== "height_cm";
  if (!/^\d+(?:\.\d+)?$/.test(text) || !Number.isFinite(value) || (integer && !Number.isSafeInteger(value))) throw new Error(L(`Enter a valid number for ${key}.`, `برای ${key} عدد معتبر وارد کنید.`));
  const valid = key === "height_cm" ? value >= 30 && value <= 250 : key === "birth_year" ? value >= 1500 && value <= new Date().getUTCFullYear() + 1 : value > 0;
  if (!valid) throw new Error(L(`The value for ${key} is outside its allowed range.`, `مقدار ${key} خارج از بازه مجاز است.`));
  return value;
}

/** Updates contain only changed facts. Existing legacy evidence is not guessed,
 * cleared or revalidated merely because a different field was edited. */
export function horseCurationChanges(draft: HorseCurationDraft, before: AdminHorseRecord | undefined, L: CurationText): Partial<Omit<HorseCurationInput, "id">> {
  const baseline = horseCurationDraft(before); const changes: Record<string, unknown> = {};
  for (const spec of HORSE_CURATION_FIELD_SPECS) {
    const raw = draft.fields[spec.key] ?? "";
    if (before && raw === baseline.fields[spec.key]) continue;
    const value = raw.trim();
    if (spec.key === "previous_names") {
      const names = [...new Set(value.split(/\r?\n/).map(name => name.trim()).filter(Boolean))];
      if (names.length > 30 || names.some(name => name.length > 200)) throw new Error(L("Use at most 30 previous names, each at most 200 characters.", "حداکثر ۳۰ نام قبلی، هرکدام تا ۲۰۰ نویسه وارد کنید."));
      changes.previous_names = names;
    } else if (spec.kind === "number") changes[spec.key] = numericValue(value, spec.key, L);
    else if (spec.key === "life_status") {
      if (!["unknown", "alive", "dead", "missing"].includes(value)) throw new Error(L("Choose a valid life status.", "وضعیت حیات معتبر انتخاب کنید."));
      if (before && baseline.fields.life_status === "dead" && value !== "dead") throw new Error(L("A recorded death requires a reviewed lifecycle correction before another life status can be selected.", "پیش از انتخاب وضعیت حیات دیگر، مرگ ثبت‌شده به اصلاح بررسی‌شده رویداد حیات نیاز دارد."));
      changes.life_status = value;
    } else {
      if (spec.key === "name_latin" && !value) throw new Error(L("Latin name is required.", "نام لاتین الزامی است."));
      if (value.length > spec.maxLength) throw new Error(L(`${spec.en} is too long.`, `${spec.fa} بیش از حد طولانی است.`));
      changes[spec.key] = value ? identityNumbers.has(spec.key) ? toAsciiDigits(value) : value : null;
    }
  }
  for (const key of CURATION_DATE_KEYS) {
    const date = draft.dates[key];
    if (before && JSON.stringify(date) === JSON.stringify(baseline.dates[key])) continue;
    if (!date.value.trim()) { changes[key] = null; continue; }
    const parsed = parseRegistryDate({ ...date, value: toAsciiDigits(date.value.trim()).replace(/[\/\u2010-\u2014]/g, "-") }, key.startsWith("passport_") ? 2300 : new Date().getUTCFullYear() + (key === "birth_date" ? 1 : 0));
    if (!parsed.ok) throw new Error(`${L(HORSE_CURATION_DATE_FIELDS[key].en, HORSE_CURATION_DATE_FIELDS[key].fa)}: ${L("Select the source calendar and precision, then enter a valid date at that precision.", "تقویم و دقت منبع را انتخاب و تاریخ معتبر با همان دقت وارد کنید.")}`);
    changes[key] = { value: parsed.date.value, precision: parsed.date.precision, calendar: parsed.date.calendar };
  }
  for (const [number, issuer] of [["passport_no", "passport_issuer"], ["foreign_registration_no", "foreign_registration_issuer"]]) {
    if ((number! in changes || issuer! in changes) && draft.fields[number!]?.trim() && (draft.fields[issuer!]?.trim().length ?? 0) < 2) throw new Error(L("A passport or foreign registration number requires its issuing authority.", "شماره گذرنامه یا ثبت خارجی به مرجع صادرکننده نیاز دارد."));
  }
  if (draft.dates.death_date.value.trim() && draft.fields.life_status !== "dead" && ("death_date" in changes || "life_status" in changes)) throw new Error(L("A death date requires deceased life status.", "تاریخ تلف به وضعیت حیات تلف‌شده نیاز دارد."));
  if (before && (changes.father_id === before.id || changes.mother_id === before.id)) throw new Error(L("A horse cannot be its own parent.", "اسب نمی‌تواند والد خودش باشد."));
  return changes as Partial<Omit<HorseCurationInput, "id">>;
}

export function horseCurationCreate(draft: HorseCurationDraft, L: CurationText): HorseCurationInput {
  return horseCurationChanges(draft, undefined, L) as HorseCurationInput;
}

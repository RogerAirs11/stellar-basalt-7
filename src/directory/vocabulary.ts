import { kitText } from "../frontend-kit/domain/engineText";
import catalog from "./catalog.json";

/**
 * R88 agent plan P11 — the reviewed directory vocabulary.
 *
 * SERVICE_CATEGORIES: the 22 demo workbench categories promoted to the
 * reviewed STARTING vocabulary (plan wording) — "a reviewed starting
 * vocabulary, not evidence that all credentials exist". dc / judge / steward
 * / ringmaster are DISTINCT roles (Equestrian federation officiating roles).
 *
 * IRAN_PROVINCES: the approved coarse service-area dataset — Iran's 31
 * provinces with their ISO 3166-2:IR codes. Directory service areas are
 * validated against these stable codes; city is canonical text within a
 * province (a full national city-code dataset is an owner-gated import and
 * is honestly NOT invented here).
 */

export interface ServiceCategory { id: string; en: string; fa: string; ar?: string }

export const SERVICE_CATEGORIES: readonly ServiceCategory[] = catalog.service_categories;

export const SERVICE_CATEGORY_IDS: readonly string[] = SERVICE_CATEGORIES.map((category) => category.id);

export function isServiceCategoryId(id: string): boolean {
  return SERVICE_CATEGORY_IDS.includes(id);
}

export function serviceCategoryLabel(id: string, locale: "en" | "fa" | "ar"): string {
  const category = SERVICE_CATEGORIES.find((entry) => entry.id === id);
  if (locale === "ar") return category ? (category.ar ?? kitText("ar", category.en, category.fa)) : id;
  return category ? (locale === "fa" ? category.fa : category.en) : id;
}

/** The officiating roles the plan explicitly requires to stay distinct. */
export const OFFICIATING_ROLE_IDS: readonly string[] = ["dc", "judge", "steward", "ringmaster"] as const;

/** Judge, steward, ringmaster and disciplinary committee are DISTINCT
 * officiating roles — never organization staff roles and never interchangeable. */
export function isOfficiatingRoleId(id: string): boolean {
  return OFFICIATING_ROLE_IDS.includes(id);
}

export interface Province { code: string; en: string; fa: string; ar?: string }

/** Approved coarse service-area dataset: Iran's 31 provinces, ISO 3166-2:IR. */
export const PROVINCE_CODE_SCHEME = catalog.province_code_scheme;
export const IRAN_PROVINCES: readonly Province[] = catalog.provinces;

/** Never reinterpret the defective R97 code table as current ISO codes. */
export function publicProvince(code: string | null, scheme: string | null | undefined) {
  const canonical = scheme === PROVINCE_CODE_SCHEME && (code === null || isValidProvinceCode(code));
  return { province_code: canonical ? code : null, province_code_scheme: scheme ?? "legacy_r97_unconfirmed",
    province_code_raw: code, province_needs_review: code !== null && !canonical };
}

export function isValidProvinceCode(code: string): boolean {
  return IRAN_PROVINCES.some((province) => province.code === code);
}

export function provinceLabel(code: string, locale: "en" | "fa" | "ar"): string {
  const province = IRAN_PROVINCES.find((entry) => entry.code === code);
  if (locale === "ar") return province ? (province.ar ?? kitText("ar", province.en, province.fa)) : code;
  return province ? (locale === "fa" ? province.fa : province.en) : code;
}

/** Parse the stored service_categories JSON defensively. */
export function parseServiceCategories(value: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]")) as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** Public credential authority. Issuer labels require a future evidence-bound workflow. */
export function credentialVerificationLevel(state: string): string {
  // Legacy directory issuer labels have no issuer-bound evidence. Fail closed.
  if (state === "issuer_attested") return "unverified";
  if (state === "platform_reviewed") return "platform_reviewed";
  return "unverified";
}

import type { RegistryDate } from "./dates";

/** Pure typed-date value objects shared by validation and SQL commands. */
export const TYPED_DATE_FIELDS = ["birth_date", "death_date", "castration_date", "passport_issue_date", "passport_expiry"] as const;
export type TypedDateField = (typeof TYPED_DATE_FIELDS)[number];

/** Column triple + bucket-year projection for one typed date field. */
export const TYPED_DATE_COLUMNS: Record<TypedDateField, { value: string; precision: string; calendar: string }> = {
  birth_date: { value: "birth_date_value", precision: "birth_date_precision", calendar: "birth_date_calendar" },
  death_date: { value: "death_date_value", precision: "death_date_precision", calendar: "death_date_calendar" },
  castration_date: { value: "castration_date_value", precision: "castration_date_precision", calendar: "castration_date_calendar" },
  passport_issue_date: { value: "passport_issue_date_value", precision: "passport_issue_date_precision", calendar: "passport_issue_date_calendar" },
  passport_expiry: { value: "passport_expiry_value", precision: "passport_expiry_precision", calendar: "passport_expiry_calendar" },
};

export interface TypedDateChange {
  readonly __typedDate: true;
  readonly date: RegistryDate | null;
  /** Gregorian bucket year (set only for birth_date, keeps legacy filters honest). */
  readonly gregorianYear: number | null;
}

export function typedDateChange(date: RegistryDate | null, gregorianYear: number | null): TypedDateChange {
  return { __typedDate: true, date, gregorianYear };
}

export function isTypedDateChange(value: unknown): value is TypedDateChange {
  return typeof value === "object" && value !== null && (value as { __typedDate?: unknown }).__typedDate === true;
}


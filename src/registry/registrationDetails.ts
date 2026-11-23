import { HttpError } from "../api/http";
import { isTypedDateChange, TYPED_DATE_COLUMNS } from "./typedDateValue";
import { parseHorseFieldValue, type HorseFieldValue } from "./validation";
import { normalizeIdentifierValue } from "./identifiers";
import { toGregorian } from "./dates";

/** Extra registration fields are validated once and applied in the winning command. */
export const REGISTRATION_DETAIL_FIELDS = [
  "birth_name", "previous_names", "passport_no", "passport_issuer", "passport_issue_date", "passport_expiry",
  "uel_no", "life_number", "foreign_registration_no", "foreign_registration_issuer", "height_cm", "markings", "life_status", "death_date",
] as const;

export function validateRegistrationDetails(input: Record<string, unknown>, before: Record<string, unknown> = {}, options: { allowLifecycleCorrection?: boolean } = {}): void {
  const next = { ...before, ...input };
  if (input.death_date && input.life_status && input.life_status !== "dead") throw new HttpError(422, "life_status_conflict", "A death date requires a deceased life status");
  for (const [number, issuer] of [["passport_no", "passport_issuer"], ["foreign_registration_no", "foreign_registration_issuer"]]) {
    if ((input[number!] !== undefined || input[issuer!] !== undefined) && next[number!] && !String(next[issuer!] ?? "").trim()) {
      throw new HttpError(422, "identifier_issuer_required", `${number} requires an explicit issuing authority`);
    }
  }
  const recordedDead = Number(before.is_dead) === 1 || before.life_status === "dead" || before.death_date_value != null;
  const clearsDeath = (input.life_status !== undefined && input.life_status !== "dead") || input.is_dead === 0 || input.is_dead === false;
  if (recordedDead && clearsDeath && !options.allowLifecycleCorrection) {
    throw new HttpError(422, "lifecycle_correction_required", "A recorded death requires a reviewed lifecycle correction before another life status can be selected");
  }
  const dates = ["passport_issue_date", "passport_expiry"] as const;
  const bounds = dates.map(key => {
    const raw = input[key];
    if (raw === undefined) {
      const cols = TYPED_DATE_COLUMNS[key];
      if (!before[cols.value]) return null;
      return dateBounds({ value: String(before[cols.value]), precision: String(before[cols.precision]), calendar: String(before[cols.calendar]) });
    }
    const parsed = parseHorseFieldValue(key, raw);
    if (!parsed.ok) throw new HttpError(422, "invalid_registration_date", `Invalid ${key}`);
    return isTypedDateChange(parsed.value) && parsed.value.date ? dateBounds(parsed.value.date) : null;
  });
  if (bounds[0] && bounds[1] && bounds[1]!.max < bounds[0]!.min) {
    throw new HttpError(422, "passport_expiry_before_issue", "Passport expiry cannot precede its issue date");
  }
}

export function dateBounds(date: { value: string; precision: string; calendar: string }): { min: number; max: number } {
  const [y, m = 1, d = 1] = date.value.split("-").map(Number);
  const first = date.calendar === "solar_hijri" ? toGregorian(y!, m, d) : { gy: y!, gm: m, gd: d };
  // Compare the actual interval represented by an imprecise date. A fixed
  // +31/+366 would incorrectly let a February expiry extend into March.
  const min = Date.UTC(first.gy, first.gm - 1, first.gd);
  if (date.precision === "day") return { min, max: min };
  const nextYear = date.precision === "year" || m === 12 ? y! + 1 : y!;
  const nextMonth = date.precision === "year" || m === 12 ? 1 : m + 1;
  const next = date.calendar === "solar_hijri" ? toGregorian(nextYear, nextMonth, 1) : { gy: nextYear, gm: nextMonth, gd: 1 };
  return { min, max: Date.UTC(next.gy, next.gm - 1, next.gd) - 86400000 };
}

export function registrationDetailColumns(input: Record<string, unknown>): Record<string, HorseFieldValue> {
  validateRegistrationDetails(input);
  const columns: Record<string, HorseFieldValue> = {};
  for (const field of REGISTRATION_DETAIL_FIELDS) {
    if (input[field] === undefined) continue;
    const parsed = parseHorseFieldValue(field, input[field]);
    if (!parsed.ok) throw new HttpError(422, "invalid_registration_field", `Invalid ${field}`);
    if (isTypedDateChange(parsed.value)) {
      const keys = TYPED_DATE_COLUMNS[field as "passport_issue_date" | "passport_expiry"];
      columns[keys.value] = parsed.value.date?.value ?? null;
      columns[keys.precision] = parsed.value.date?.precision ?? null;
      columns[keys.calendar] = parsed.value.date?.calendar ?? null;
    } else columns[field === "previous_names" ? "previous_names_json" : field] = parsed.value;
  }
  if (input.life_status === "dead" || input.death_date) { columns.is_dead = 1; columns.life_status = "dead"; }
  return columns;
}

/** Runs immediately after the guarded horse INSERT, in the same transaction. */
export function registrationDetailCreateStatements(db: D1Database, input: Record<string, unknown>, mutationId: string): D1PreparedStatement[] {
  const columns = registrationDetailColumns(input);
  const entries = Object.entries(columns);
  const statements: D1PreparedStatement[] = entries.length ? [db.prepare(
    `UPDATE horses SET ${entries.map(([key]) => `${key}=?`).join(",")} WHERE last_mutation_id=? AND deleted_at IS NULL`,
  ).bind(...entries.map(([, value]) => value), mutationId)] : [];
  statements.push(...registrationAliasStatements(db, registrationAliases(input), mutationId));
  return statements;
}

export function registrationAliases(input: Record<string, unknown>): string[] {
  let previous: unknown = input.previous_names;
  if (previous === undefined && typeof input.previous_names_json === "string") {
    try { previous = JSON.parse(input.previous_names_json); } catch { previous = []; }
  }
  return [...new Set([
    ...(typeof input.birth_name === "string" && input.birth_name.trim() ? [input.birth_name.trim()] : []),
    ...(Array.isArray(previous) ? previous.filter((name): name is string => typeof name === "string").map(name => name.trim()).filter(Boolean) : []),
  ])];
}

/** Maintain only aliases owned by this projection; retain independently sourced aliases. */
export function registrationAliasStatements(db: D1Database, aliases: string[], mutationId: string, replace = false): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = replace ? [db.prepare(`DELETE FROM horse_aliases
    WHERE source='reviewed_registration' AND horse_id IN (SELECT id FROM horses WHERE last_mutation_id=? AND deleted_at IS NULL)`).bind(mutationId)] : [];
  for (const alias of aliases) {
    statements.push(db.prepare(`INSERT INTO horse_aliases(horse_id,alias,alias_normalized,language,alias_type,source)
      SELECT h.id,?,?,NULL,'previous','reviewed_registration' FROM horses h
      WHERE h.last_mutation_id=? AND h.deleted_at IS NULL
        AND NOT EXISTS(SELECT 1 FROM horse_aliases a WHERE a.horse_id=h.id AND a.alias_normalized=?)`)
      .bind(alias, normalizeIdentifierValue(alias).toLowerCase(), mutationId, normalizeIdentifierValue(alias).toLowerCase()));
  }
  return statements;
}

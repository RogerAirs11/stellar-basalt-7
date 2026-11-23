import { z } from "zod";
import {
  isSolarHijriLeapYear,
  parseRegistryDate,
  toGregorian,
  type CalendarSystem,
  type DatePrecision,
  type RegistryDate,
} from "./dates";

/**
 * Master-Ai plan T12: temporal relations — ownership periods, lifecycle
 * events and the parent-correction review path.
 *
 * Ownership periods are HISTORICAL TITLE facts, staff-curated with evidence.
 * They are deliberately separate from horse_access_grants (T10): a grant is a
 * permission to act, an ownership period is a fact about who held the horse.
 * Account signup is never a title transfer.
 *
 * Overlap and share-sum rules are enforced HERE, not in SQL, because they are
 * precision-aware: a year-only period covers a whole year, so two year-only
 * periods can only be flagged as POSSIBLY overlapping — the registry refuses
 * to claim a definite overlap it cannot prove, and refuses to record one it
 * cannot rule out.
 */

// ---------------------------------------------------------------------------
// Typed-date value helpers shared by every T12 write path.
// ---------------------------------------------------------------------------

export const TYPED_DATE_INPUT_SCHEMA = z.object({
  value: z.string().max(10),
  precision: z.enum(["day", "month", "year"]),
  calendar: z.enum(["gregorian", "solar_hijri"]),
}, { message: "A typed date needs value, precision and calendar" });

export { TYPED_DATE_FIELDS, TYPED_DATE_COLUMNS, typedDateChange, isTypedDateChange } from "./typedDateValue";
export type { TypedDateField, TypedDateChange } from "./typedDateValue";
import { TYPED_DATE_FIELDS, TYPED_DATE_COLUMNS, typedDateChange, isTypedDateChange, type TypedDateField, type TypedDateChange } from "./typedDateValue";

export type TypedDateParseIssue =
  | "invalid_shape"
  | "invalid_date";

export type TypedDateParseResult =
  | { ok: true; date: RegistryDate; gregorianYear: number }
  | { ok: false; issue: TypedDateParseIssue; message: string };

/**
 * Parse a typed date field payload ({value, precision, calendar} or null).
 * null means "clear the typed fact" and is always valid. Calendar mathematics
 * (Feb 30, Esfand 30 in common years, future dates) is validated by
 * parseRegistryDate — the single source of truth.
 */
export function parseTypedDatePayload(input: unknown): TypedDateParseResult {
  if (input === null) return { ok: false, issue: "invalid_shape", message: "null payloads are normalized by the caller" };
  const shape = TYPED_DATE_INPUT_SCHEMA.safeParse(input);
  if (!shape.success) return { ok: false, issue: "invalid_shape", message: "A typed date needs value, precision and calendar" };
  const maxYear = new Date().getUTCFullYear();
  const parsed = parseRegistryDate(shape.data, maxYear);
  if (!parsed.ok) return { ok: false, issue: "invalid_date", message: parsed.message };
  return { ok: true, date: parsed.date, gregorianYear: parsed.gregorianYear };
}

// ---------------------------------------------------------------------------
// Ownership periods.
// ---------------------------------------------------------------------------

export const OWNERSHIP_PERIOD_SCHEMA = z.object({
  owner_person_id: z.number().int().positive(),
  start: TYPED_DATE_INPUT_SCHEMA,
  end: TYPED_DATE_INPUT_SCHEMA.nullable().optional(),
  share_percent: z.number().positive().max(100).nullable().optional(),
  evidence_note: z.string().trim().max(2000).nullable().optional(),
  source: z.string().trim().max(500).nullable().optional(),
}, { message: "An ownership period needs an owner, a start date and optional share/evidence" });

export type OwnershipPeriodInput = z.infer<typeof OWNERSHIP_PERIOD_SCHEMA>;

export interface OwnershipPeriodRow {
  id: number;
  owner_person_id: number;
  start_value: string;
  start_precision: DatePrecision;
  start_calendar: CalendarSystem;
  end_value: string | null;
  end_precision: DatePrecision | null;
  end_calendar: CalendarSystem | null;
  share_percent: number | null;
}

export interface OwnershipPeriodIssue {
  code: "invalid_period" | "invalid_end_before_start" | "definite_overlap" | "possible_overlap" | "share_sum_exceeded";
  message: string;
  conflictingPeriodId?: number;
}

/**
 * A period as a CERTAIN Gregorian day-interval (inclusive). Precision widens
 * the interval honestly: a year-only start covers the whole year, an open end
 * extends to "now" (represented as null = unbounded). Intervals are expressed
 * as {gy,gm,gd} tuples compared through a day-serial number.
 */
export interface PeriodInterval {
  earliestStartDay: number;
  latestStartDay: number;
  earliestEndDay: number | null; // null = open-ended
  latestEndDay: number | null;
}

function daySerial(gy: number, gm: number, gd: number): number {
  // Proleptic Gregorian day number (valid for the registry's 1500-2100 range).
  const a = Math.floor((14 - gm) / 12);
  const y = gy + 4800 - a;
  const m = gm + 12 * a - 3;
  return gd + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400);
}

function lastDayOf(value: string, precision: DatePrecision, calendar: CalendarSystem): { gy: number; gm: number; gd: number } {
  const y = Number(value.slice(0, 4));
  if (precision === "year") {
    // Last day of the year in the stored calendar.
    if (calendar === "solar_hijri") {
      const lastMonthDays = isSolarHijriLeapYear(y) ? 30 : 29;
      return toGregorian(y, 12, lastMonthDays);
    }
    return { gy: y, gm: 12, gd: 31 };
  }
  const m = Number(value.slice(5, 7));
  if (calendar === "solar_hijri") {
    const days = m <= 6 ? 31 : m <= 11 ? 30 : (isSolarHijriLeapYear(y) ? 30 : 29);
    return toGregorian(y, m, days);
  }
  const isLeap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const gregorianDays = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return { gy: y, gm: m, gd: gregorianDays[m - 1]! };
}

function firstDayOf(value: string, precision: DatePrecision, calendar: CalendarSystem): { gy: number; gm: number; gd: number } {
  const y = Number(value.slice(0, 4));
  if (precision === "year") {
    if (calendar === "solar_hijri") {
      return toGregorian(y, 1, 1);
    }
    return { gy: y, gm: 1, gd: 1 };
  }
  const m = Number(value.slice(5, 7));
  if (calendar === "solar_hijri") {
    return toGregorian(y, m, 1);
  }
  return { gy: y, gm: m, gd: 1 };
}

function serialOf(date: { gy: number; gm: number; gd: number }): number {
  return daySerial(date.gy, date.gm, date.gd);
}

/** Project a stored period onto its certain Gregorian day-interval. */
export function ownershipPeriodInterval(period: OwnershipPeriodRow): PeriodInterval {
  const first = firstDayOf(period.start_value, period.start_precision, period.start_calendar);
  const last = lastDayOf(period.start_value, period.start_precision, period.start_calendar);
  const interval: PeriodInterval = {
    earliestStartDay: serialOf(first),
    latestStartDay: serialOf(last),
    earliestEndDay: null,
    latestEndDay: null,
  };
  if (period.end_value && period.end_precision && period.end_calendar) {
    const endFirst = firstDayOf(period.end_value, period.end_precision, period.end_calendar);
    const endLast = lastDayOf(period.end_value, period.end_precision, period.end_calendar);
    interval.earliestEndDay = serialOf(endFirst);
    interval.latestEndDay = serialOf(endLast);
  }
  return interval;
}

export interface OwnershipOverlapFinding {
  kind: "definite" | "possible";
  periodId: number;
  ownerPersonId: number;
}

/**
 * Detect overlaps between a candidate period and existing ones, honoring
 * precision. Two periods DEFINITELY overlap only when every possible dating
 * of both periods intersects; if only some datings intersect the overlap is
 * POSSIBLE. The registry never claims more than the stored facts prove.
 */
export function detectOwnershipOverlaps(existing: OwnershipPeriodRow[], candidate: OwnershipPeriodRow): OwnershipOverlapFinding[] {
  const candidateInterval = ownershipPeriodInterval(candidate);
  const findings: OwnershipOverlapFinding[] = [];
  for (const period of existing) {
    if (period.id === candidate.id) continue;
    const interval = ownershipPeriodInterval(period);
    // A period's possible span: [earliestStartDay, latestEndDay ?? infinity].
    const aStart = candidateInterval.earliestStartDay;
    const aEnd = candidateInterval.latestEndDay ?? Number.MAX_SAFE_INTEGER;
    const bStart = interval.earliestStartDay;
    const bEnd = interval.latestEndDay ?? Number.MAX_SAFE_INTEGER;
    const possiblyOverlapping = aStart <= bEnd && bStart <= aEnd;
    if (!possiblyOverlapping) continue;
    // Definite overlap: the latest possible start of each period is inside the
    // other period's certain span. Conservative both-ways test:
    const definite = candidateInterval.latestStartDay <= (interval.latestEndDay ?? Number.MAX_SAFE_INTEGER)
      && interval.latestStartDay <= (candidateInterval.latestEndDay ?? Number.MAX_SAFE_INTEGER)
      && candidateInterval.latestStartDay <= bEnd
      && interval.latestStartDay <= aEnd;
    findings.push({ kind: definite ? "definite" : "possible", periodId: period.id, ownerPersonId: period.owner_person_id });
  }
  return findings;
}

export interface ValidatedOwnershipPeriod {
  start: RegistryDate;
  startGregorianYear: number;
  end: RegistryDate | null;
  endGregorianYear: number | null;
}

/**
 * Validate + normalize one ownership period payload: shape, calendar
 * mathematics, and end-not-before-start (precision-aware: an end can never
 * start before the start's earliest possible day).
 */
export function validateOwnershipPeriodInput(input: unknown): { ok: true; period: ValidatedOwnershipPeriod; issues: OwnershipPeriodIssue[] } | { ok: false; issues: OwnershipPeriodIssue[] } {
  const shape = OWNERSHIP_PERIOD_SCHEMA.safeParse(input);
  if (!shape.success) {
    return { ok: false, issues: [{ code: "invalid_period", message: "An ownership period needs an owner person, a typed start date and optional share/evidence" }] };
  }
  const issues: OwnershipPeriodIssue[] = [];
  const maxYear = new Date().getUTCFullYear() + 1; // a period may have started up to "now"; allow current year
  const startParsed = parseRegistryDate(shape.data.start, maxYear);
  if (!startParsed.ok) {
    return { ok: false, issues: [{ code: "invalid_period", message: `Start date: ${startParsed.message}` }] };
  }
  let end: RegistryDate | null = null;
  let endGregorianYear: number | null = null;
  if (shape.data.end != null) {
    const endParsed = parseRegistryDate(shape.data.end, maxYear);
    if (!endParsed.ok) {
      return { ok: false, issues: [{ code: "invalid_period", message: `End date: ${endParsed.message}` }] };
    }
    end = endParsed.date;
    endGregorianYear = endParsed.gregorianYear;
    // Precision-aware ordering: the end's LATEST possible day can be anywhere,
    // but its EARLIEST possible day must not precede the start's earliest.
    const startFirst = firstDayOf(startParsed.date.value, startParsed.date.precision, startParsed.date.calendar);
    const endFirst = firstDayOf(end.value, end.precision, end.calendar);
    if (serialOf(endFirst) < serialOf(startFirst)) {
      issues.push({ code: "invalid_end_before_start", message: "The ownership period ends before it starts" });
      return { ok: false, issues };
    }
  }
  return {
    ok: true,
    period: { start: startParsed.date, startGregorianYear: startParsed.gregorianYear, end, endGregorianYear },
    issues,
  };
}

/**
 * Sum the stated shares of the overlapping periods plus the candidate. A sum
 * above 100 means co-ownership claims more than the whole horse — rejected.
 * Unstated (null) shares are excluded from the arithmetic but flagged as
 * possible overlaps by detectOwnershipOverlaps.
 */
export function ownershipShareSumExceeded(overlaps: OwnershipOverlapFinding[], existing: OwnershipPeriodRow[], candidateSharePercent: number | null): boolean {
  if (candidateSharePercent == null) return false;
  const byId = new Map(existing.map((period) => [period.id, period]));
  let sum = candidateSharePercent;
  for (const finding of overlaps) {
    const period = byId.get(finding.periodId);
    if (period?.share_percent != null) sum += period.share_percent;
  }
  return sum > 100 + 1e-9;
}

/** SQL for inserting a validated ownership period (staff write path). */
export function ownershipPeriodInsertStatement(
  db: D1Database,
  params: {
    horseId: number;
    ownerPersonId: number;
    period: ValidatedOwnershipPeriod;
    sharePercent: number | null;
    evidenceNote: string | null;
    source: string | null;
    createdByUserId: string;
    mutationId?: string;
  },
): D1PreparedStatement {
  return db.prepare(`INSERT INTO horse_ownership_periods(
      horse_id,owner_person_id,start_value,start_precision,start_calendar,
      end_value,end_precision,end_calendar,share_percent,evidence_note,source,created_by_user_id)
    SELECT ?,?,?,?,?, ?,?,?,?,?, ?,?
    ${params.mutationId ? "WHERE EXISTS(SELECT 1 FROM horses WHERE id=? AND deleted_at IS NULL AND last_mutation_id=?)" : ""}`)
    .bind(
      params.horseId,
      params.ownerPersonId,
      params.period.start.value,
      params.period.start.precision,
      params.period.start.calendar,
      params.period.end ? params.period.end.value : null,
      params.period.end ? params.period.end.precision : null,
      params.period.end ? params.period.end.calendar : null,
      params.sharePercent,
      params.evidenceNote,
      params.source,
      params.createdByUserId,
      ...(params.mutationId ? [params.horseId, params.mutationId] : []),
    );
}

// ---------------------------------------------------------------------------
// Lifecycle events.
// ---------------------------------------------------------------------------

export const LIFECYCLE_EVENT_TYPES = ["death", "castration", "retirement", "export", "import", "other"] as const;
export type LifecycleEventType = (typeof LIFECYCLE_EVENT_TYPES)[number];

export const LIFECYCLE_EVENT_SCHEMA = z.object({
  event_type: z.enum(LIFECYCLE_EVENT_TYPES),
  date: TYPED_DATE_INPUT_SCHEMA,
  uncertain_time: z.boolean().nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
  source_ref: z.string().trim().max(500).nullable().optional(),
}, { message: "A lifecycle event needs a type and a typed date" });

export interface ValidatedLifecycleEvent {
  eventType: LifecycleEventType;
  date: RegistryDate;
  uncertainTime: boolean;
  note: string | null;
  sourceRef: string | null;
}

/**
 * Validate + normalize a lifecycle event. Uncertain time is an explicit flag:
 * the registry stores what is known (the date at its precision) AND that the
 * dating itself is uncertain — never a silently confident date.
 */
export function validateLifecycleEventInput(input: unknown): { ok: true; event: ValidatedLifecycleEvent } | { ok: false; message: string } {
  const shape = LIFECYCLE_EVENT_SCHEMA.safeParse(input);
  if (!shape.success) return { ok: false, message: "A lifecycle event needs a type (death, castration, retirement, export, import, other) and a typed date" };
  const maxYear = new Date().getUTCFullYear(); // lifecycle events are past facts
  const parsed = parseRegistryDate(shape.data.date, maxYear);
  if (!parsed.ok) return { ok: false, message: parsed.message };
  return {
    ok: true,
    event: {
      eventType: shape.data.event_type,
      date: parsed.date,
      uncertainTime: shape.data.uncertain_time === true,
      note: shape.data.note ?? null,
      sourceRef: shape.data.source_ref ?? null,
    },
  };
}

/** SQL for inserting a validated lifecycle event (staff write path).
 * R142-B03 (Master-AI): when `expectedRowVersion` is supplied the insert is
 * guarded by the SAME optimistic-concurrency precondition as the canonical
 * horse update in the same D1 batch — a lost version race now commits NO
 * lifecycle event at all, instead of committing a death event beside a 409.
 * The unguarded form stays available for history-only events. */
export function lifecycleEventInsertStatement(
  db: D1Database,
  params: { horseId: number; event: ValidatedLifecycleEvent; createdByUserId: string; expectedRowVersion?: number; mutationId?: string },
): D1PreparedStatement {
  const values = [
    params.horseId,
    params.event.eventType,
    params.event.date.value,
    params.event.date.precision,
    params.event.date.calendar,
    params.event.uncertainTime ? 1 : 0,
    params.event.note,
    params.event.sourceRef,
    params.createdByUserId,
  ];
  if (params.mutationId) {
    return db.prepare(`INSERT INTO horse_lifecycle_events(
        horse_id,event_type,date_value,date_precision,date_calendar,uncertain_time,note,source_ref,created_by_user_id)
      SELECT ?,?,?,?,?,?,?,?,?
      WHERE EXISTS(SELECT 1 FROM horses WHERE id=? AND deleted_at IS NULL AND last_mutation_id=?)`)
      .bind(...values, params.horseId, params.mutationId);
  }
  if (params.expectedRowVersion === undefined) {
    return db.prepare(`INSERT INTO horse_lifecycle_events(
        horse_id,event_type,date_value,date_precision,date_calendar,uncertain_time,note,source_ref,created_by_user_id)
      VALUES(?,?,?,?,?,?,?,?,?)`).bind(...values);
  }
  return db.prepare(`INSERT INTO horse_lifecycle_events(
      horse_id,event_type,date_value,date_precision,date_calendar,uncertain_time,note,source_ref,created_by_user_id)
    SELECT ?,?,?,?,?,?,?,?,?
    WHERE EXISTS(SELECT 1 FROM horses WHERE id=? AND deleted_at IS NULL AND row_version=?)`)
    .bind(...values, params.horseId, params.expectedRowVersion);
}

// ---------------------------------------------------------------------------
// Parent-correction review path (structured submission on update_horse).
// ---------------------------------------------------------------------------

export const PARENT_CORRECTION_SCHEMA = z.object({
  kind: z.literal("parent_correction"),
  horse_id: z.number().int().positive(),
  father_id: z.number().int().positive().nullable().optional(),
  mother_id: z.number().int().positive().nullable().optional(),
  reason: z.string().trim().min(10, "Explain the correction (at least 10 characters)").max(2000),
  source: z.string().trim().min(3, "Name the evidence source").max(500),
  conflicting_evidence: z.string().trim().max(2000).nullable().optional(),
}, { message: "A parent correction needs the horse, at least one parent change, a reason and a source" });

export interface ParentCorrection {
  kind: "parent_correction";
  horse_id: number;
  father_id?: number | null;
  mother_id?: number | null;
  reason: string;
  source: string;
  conflicting_evidence: string | null;
}

/**
 * Parse a stored parent-correction submission. Accepts the parsed object (as
 * returned by change-request row normalization) or its JSON text. Returns null
 * for anything that is not a valid correction (legacy rows, other kinds).
 */
export function parseStoredParentCorrection(submissionJson: unknown): ParentCorrection | null {
  let parsed: unknown = submissionJson;
  if (typeof submissionJson === "string") {
    if (!submissionJson.trim()) return null;
    try {
      parsed = JSON.parse(submissionJson);
    } catch {
      return null;
    }
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const candidate = parsed as { kind?: unknown };
  if (candidate.kind !== "parent_correction") return null;
  const result = PARENT_CORRECTION_SCHEMA.safeParse(parsed);
  if (!result.success) return null;
  if (result.data.father_id === undefined && result.data.mother_id === undefined) return null;
  return { ...result.data, conflicting_evidence: result.data.conflicting_evidence ?? null };
}

/**
 * Validate a fresh parent-correction payload from the API (422 detail on
 * failure). Distinct from parseStoredParentCorrection so submission-time
 * errors can carry zod details while approval-time re-parses stay strict.
 */
export function validateParentCorrectionInput(input: unknown): { ok: true; correction: ParentCorrection } | { ok: false; message: string; issues?: unknown } {
  const result = PARENT_CORRECTION_SCHEMA.safeParse(input);
  if (!result.success) {
    return { ok: false, message: "A parent correction needs the horse id, at least one parent change (existing registry id or null to clear), a reason and an evidence source", issues: result.error.flatten() };
  }
  if (result.data.father_id === undefined && result.data.mother_id === undefined) {
    return { ok: false, message: "At least one parent change is required (an existing registry id, or null to clear)" };
  }
  return { ok: true, correction: { ...result.data, conflicting_evidence: result.data.conflicting_evidence ?? null } };
}

/** Deterministic review-facing summary for a parent-correction submission. */
export function parentCorrectionAutoSummary(correction: ParentCorrection): string {
  const parts = [`Parent correction: horse #${correction.horse_id}`];
  if (correction.father_id !== undefined) parts.push(correction.father_id == null ? "sire cleared" : `sire -> #${correction.father_id}`);
  if (correction.mother_id !== undefined) parts.push(correction.mother_id == null ? "dam cleared" : `dam -> #${correction.mother_id}`);
  return parts.join(" · ").slice(0, 2000);
}

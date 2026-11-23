/**
 * R98-N16 — the ONE headless workspace calendar model shared by every
 * frontend: an accessible calendar/list ALTERNATIVE view of the same open
 * reminders, with honest overdue states computed in each task's OWN timezone
 * (never a single reference zone).
 *
 * Pure functions only — presentation lives in each frontend. The calendar is
 * a plain month grid (weeks starting Monday) with day cells carrying their
 * due tasks; screen-reader consumers get the same data as a per-day list,
 * and the model never invents a timezone or hides an invalid one (invalid
 * due dates surface as `invalid` exactly like the dashboard buckets).
 */

export interface CalendarTaskInput {
  id: number;
  title: string;
  category: string;
  due_date: string;
  due_timezone?: string;
  status: string;
  /** Passed through untouched so calendar cells can drive the SAME CAS-guarded
   * completion commands as the list view (never a second write path). */
  row_version?: number;
}

export interface CalendarTask extends CalendarTaskInput {
  /** The calendar day this task belongs to (its due date, as-is). */
  day: string;
  overdue: boolean;
  dueToday: boolean;
  invalidDate: boolean;
}

export interface CalendarDay {
  /** ISO day (YYYY-MM-DD) or empty string for padding cells. */
  day: string;
  inMonth: boolean;
  tasks: CalendarTask[];
}

export interface CalendarModel {
  year: number;
  month: number; // 1-12
  monthLabel: string;
  days: CalendarDay[];
  /** The same tasks as a flat list, overdue first (the LIST alternative). */
  list: CalendarTask[];
  counts: { total: number; overdue: number; dueSoon: number; invalid: number };
}

/** Days from Monday (0) .. Sunday (6) for a JS getDay() value. */
function mondayIndex(jsDay: number): number {
  return (jsDay + 6) % 7;
}

/** Is a day valid (real Gregorian day)? Mirrors the domain rule. */
function isValidDay(isoDate: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return false;
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === isoDate;
}

/** The LOCAL calendar date (YYYY-MM-DD) in a timezone at a given instant. */
export function localDateInZoneCalendar(tz: string, nowIso: string): string {
  const parts = new Intl.DateTimeFormat("en", { timeZone: tz, calendar: "gregory", numberingSystem: "latn", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(nowIso));
  const part = (type: string) => parts.find((value) => value.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function validTimeZone(tz: string): boolean {
  try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; }
}

/**
 * Build the calendar model for one month. Tasks outside the month are kept
 * in the flat list (the list alternative shows everything open) but do not
 * occupy day cells.
 */
export function buildWorkspaceCalendar(tasks: readonly CalendarTaskInput[], year: number, month: number, nowIso: string, dueWithinDays = 7): CalendarModel {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) throw new RangeError("A real calendar year is required");
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new RangeError("A real calendar month (1-12) is required");
  if (!Number.isFinite(Date.parse(nowIso)) || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(nowIso)) throw new RangeError("An explicit valid reference instant with timezone is required");
  if (!Number.isInteger(dueWithinDays) || dueWithinDays < 0 || dueWithinDays > 366) throw new RangeError("Due horizon must be an integer from 0 to 366 days");
  const todayByZone = new Map<string, string | null>();
  const todayFor = (tz: string): string | null => {
    const zone = tz;
    if (!todayByZone.has(zone)) todayByZone.set(zone, zone && validTimeZone(zone) ? localDateInZoneCalendar(zone, nowIso) : null);
    return todayByZone.get(zone) ?? null;
  };
  const calendarTasks: CalendarTask[] = [];
  for (const task of tasks) {
    if (task.status !== "open") continue;
    const due = String(task.due_date);
    const valid = isValidDay(due);
    const today = todayFor(task.due_timezone ?? "");
    let overdue = false;
    let dueToday = false;
    if (valid && today) {
      overdue = due < today;
      dueToday = due === today;
    }
    calendarTasks.push({ ...task, day: due, overdue, dueToday, invalidDate: !valid || !today });
  }
  // Month grid: first day of month, padded from Monday.
  const first = new Date(Date.UTC(year, month - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lead = mondayIndex(first.getUTCDay());
  const cells: CalendarDay[] = [];
  for (let i = 0; i < lead; i += 1) cells.push({ day: "", inMonth: false, tasks: [] });
  const byDay = new Map<string, CalendarTask[]>();
  for (const task of calendarTasks) {
    const list = byDay.get(task.day) ?? [];
    list.push(task);
    byDay.set(task.day, list);
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    cells.push({ day: iso, inMonth: true, tasks: byDay.get(iso) ?? [] });
  }
  while (cells.length % 7 !== 0) cells.push({ day: "", inMonth: false, tasks: [] });
  const horizonByZone = new Map<string, number>();
  const dueSoon = calendarTasks.filter((task) => {
    if (task.invalidDate || task.overdue) return false;
    const zone = task.due_timezone || "";
    if (!horizonByZone.has(zone)) {
      const today = todayFor(zone);
      if (!today) return false;
      const t = Date.parse(`${today}T00:00:00Z`) + dueWithinDays * 86_400_000;
      horizonByZone.set(zone, t);
    }
    return Date.parse(`${task.day}T00:00:00Z`) <= (horizonByZone.get(zone) as number);
  });
  const monthLabel = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", calendar: "gregory", timeZone: "UTC" }).format(first);
  return {
    year, month, monthLabel,
    days: cells,
    list: [...calendarTasks].sort((a, b) => (a.invalidDate ? 1 : 0) - (b.invalidDate ? 1 : 0) || (a.overdue ? 0 : 1) - (b.overdue ? 0 : 1) || a.day.localeCompare(b.day) || a.id - b.id),
    counts: {
      total: calendarTasks.length,
      overdue: calendarTasks.filter((t) => t.overdue).length,
      dueSoon: dueSoon.length,
      invalid: calendarTasks.filter((t) => t.invalidDate).length,
    },
  };
}

/**
 * R88 agent plan P14 — the farm workspace domain (pure helpers).
 *
 * Everything here is mechanical and honest:
 *   - CSV export cells are formula-injection protected (a cell that starts
 *     with =, +, -, @ or a tab/CR is prefixed with an apostrophe so
 *     spreadsheet applications render it as text — user text can never
 *     execute as a formula);
 *   - recurrence is date arithmetic ONLY — the machine never generates
 *     medical instructions, and veterinary reminders carry an explicit
 *     qualified-person notice (VETERINARY_NOTICE) everywhere they surface;
 *   - occurrence keys are deterministic, so recurring-task creation is
 *     idempotent across scheduler retries;
 *   - staff actions are an explicit allowlist, and authorization is
 *     re-checked LIVE at every read (a revoked assignment is invisible on
 *     the next request).
 */

/** The explicit staff action vocabulary (no wildcard, no implicit admin). */
export const WORKSPACE_STAFF_ACTIONS: ReadonlySet<string> = new Set(["view", "tasks_manage", "export"]);

export const WORKSPACE_TASK_CATEGORIES: ReadonlySet<string> = new Set([
  "document_renewal",
  "farrier",
  "veterinary_appointment",
  "other",
]);

/**
 * Every veterinary-category reminder carries this notice verbatim — the
 * system stores user-entered reminders and performs date arithmetic; medical
 * schedules must be configured by a qualified person, and no field here
 * carries dosage, treatment or instruction content.
 */
export const VETERINARY_NOTICE =
  "This is a user-entered reminder, not medical advice or an instruction. Veterinary schedules and treatments must be configured by a qualified person; this system never generates them.";

/** Parse and validate a comma-separated staff actions grant. */
export function parseStaffActions(raw: string): { ok: true; actions: string[] } | { ok: false; reason: string } {
  const actions = [...new Set(raw.split(",").map((entry) => entry.trim()).filter(Boolean))];
  if (actions.length === 0) return { ok: false, reason: "at least one action is required" };
  for (const action of actions) {
    if (!WORKSPACE_STAFF_ACTIONS.has(action)) {
      return { ok: false, reason: `unknown action '${action}' (allowed: view, tasks_manage, export)` };
    }
  }
  return { ok: true, actions };
}

/** Does an assignment row (actions csv + status) currently grant an action? */
export function assignmentGrants(assignment: { actions: string; status: string }, action: string): boolean {
  if (assignment.status !== "active") return false;
  const parsed = parseStaffActions(assignment.actions);
  return parsed.ok && parsed.actions.includes(action);
}

/**
 * Formula-injection protection for CSV export (OWASP CSV-injection defense).
 * A cell starting with =, +, -, @, tab or CR would be interpreted as a
 * formula by Excel/LibreOffice/Sheets; prefixing a single apostrophe forces
 * text interpretation. The apostrophe is the standard, documented defense
 * and is what spreadsheet applications strip when rendering.
 */
export function csvSafeCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  // Formula mitigation is not a substitute for quoting the field. Include
  // leading whitespace/control and full-width formula prefixes. CSV viewers
  // differ on re-save behavior; a typed XLSX/text export remains preferable.
  const dangerous = /^[\s\uFEFF]*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20]/u.test(text) || /^[\t\r\n]/.test(text);
  const safe = dangerous ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '\"\"')}"` : safe;
}

export function csvRow(cells: unknown[]): string {
  return cells.map(csvSafeCell).join(",");
}

/**
 * Add calendar days to an ISO date string (YYYY-MM-DD) — pure arithmetic.
 */
export function isValidDay(isoDate: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return false;
  const year=Number(isoDate.slice(0,4));
  if (year<1000 || year>9999) return false;
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10)===isoDate;
}

export function addDays(isoDate: string, days: number): string {
  if (!isValidDay(isoDate) || !Number.isSafeInteger(days)) throw new RangeError("A real Gregorian day and integer day interval are required");
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate()+days);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear()<1000 || date.getUTCFullYear()>9999) throw new RangeError("Result outside supported date range");
  return date.toISOString().slice(0,10);
}

/**
 * The deterministic occurrence key: the same task family + due date can only
 * exist once. A scheduler retry recomputes the SAME key and the INSERT ...
 * ON CONFLICT(occurrence_key) DO NOTHING makes it a no-op.
 */
export function taskOccurrenceKey(taskFamilyId: string | number, dueDate: string, index: number): string {
  return `task:${taskFamilyId}:${dueDate}:i${index}`;
}

/** The next occurrence of a recurring task (mechanical interval arithmetic). */
export function nextOccurrence(task: { recurrence: string; recurrence_interval_days: number | null; due_date: string }): {
  dueDate: string;
  intervalDays: number;
} | null {
  if (task.recurrence !== "custom_days") return null;
  const intervalDays = Number(task.recurrence_interval_days ?? 0);
  if (!Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 3650) return null;
  return { dueDate: addDays(task.due_date, intervalDays), intervalDays };
}

/** Is a task overdue as of a reference date (YYYY-MM-DD comparison)? */
export function isOverdue(dueDate: string, referenceDate: string): boolean {
  return dueDate < referenceDate;
}

/** Split tasks into due-soon / overdue buckets for the dashboard. */
export function bucketTasks<T extends { due_date: string; status: string }>(tasks: T[], today: string, dueWithinDays = 7): {
  overdue: T[];
  dueSoon: T[];
  later: T[];
} {
  const horizon = addDays(today, dueWithinDays);
  const overdue: T[] = [];
  const dueSoon: T[] = [];
  const later: T[] = [];
  for (const task of tasks) {
    if (task.status !== "open") continue;
    if (task.due_date < today) overdue.push(task);
    else if (task.due_date <= horizon) dueSoon.push(task);
    else later.push(task);
  }
  return { overdue, dueSoon, later };
}

// ---------------------------------------------------------------------------
// R96-N09 — timezone-aware reminder semantics.
// ---------------------------------------------------------------------------

/** Validate an IANA timezone name (must be resolvable by Intl). */
export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The LOCAL calendar date (YYYY-MM-DD) in a timezone at a given instant. */
export function localDateInZone(tz: string, nowIso: string): string {
  const parts = new Intl.DateTimeFormat("en", {timeZone:tz,calendar:"gregory",numberingSystem:"latn",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(nowIso));
  const part=(type:string)=>parts.find(value=>value.type===type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Is a reminder overdue? A task is overdue when its due_date (a calendar
 * date, interpreted in ITS OWN timezone) is strictly before the local date
 * in that same timezone. Equal dates are "due today", not overdue. */
export function isOverdueInZone(dueDate: string, tz: string, nowIso: string): boolean {
  const today = localDateInZone(tz, nowIso);
  return dueDate.slice(0, 10) < today;
}

/** A single Tehran reference day is incorrect for mixed-zone collections.
 * Invalid legacy values are returned for repair, never guessed or hidden. */
export function bucketTasksInZones<T extends {due_date:string;due_timezone?:string;status:string}>(tasks:T[],nowIso:string,dueWithinDays=7): {
  overdue:T[];dueSoon:T[];later:T[];invalid:T[];
} {
  if(!Number.isInteger(dueWithinDays)||dueWithinDays<0||dueWithinDays>3650)throw new RangeError("Invalid reminder horizon");
  if(!Number.isFinite(new Date(nowIso).getTime()))throw new RangeError("Invalid reference instant");
  const out:{overdue:T[];dueSoon:T[];later:T[];invalid:T[]}={overdue:[],dueSoon:[],later:[],invalid:[]};
  const zones=new Map<string,{today:string;horizon:string}|null>();
  for(const task of tasks){
    if(task.status!=="open")continue;
    const tz=task.due_timezone || "Asia/Tehran";
    if(!zones.has(tz))zones.set(tz,isValidTimezone(tz)?{today:localDateInZone(tz,nowIso),horizon:addDays(localDateInZone(tz,nowIso),dueWithinDays)}:null);
    const zone=zones.get(tz);
    if(!zone||!isValidDay(task.due_date)){out.invalid.push(task);continue;}
    if(task.due_date<zone.today)out.overdue.push(task);else if(task.due_date<=zone.horizon)out.dueSoon.push(task);else out.later.push(task);
  }
  return out;
}

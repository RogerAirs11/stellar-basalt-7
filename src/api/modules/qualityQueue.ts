import { z } from "zod";
import { HttpError, json, readJson } from "../http";
import { requirePermission, requireCsrf } from "../../auth/guards";
import { classifyBreedingSex } from "../../pedigree/breeding";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * R145-E04 (Master-AI plan) — the data-quality queue, made usable.
 *
 * Until now data_quality_issues could only RECORD a finding (0001) and the
 * admin feed could only LIST unresolved rows. Master AI's workflow-
 * completeness standard requires the full loop: assign a reviewer, resolve
 * with a reason, reopen, keep the resolution/reopening history, reconcile
 * dashboard counts, and allow bulk review ONLY for explicitly defined
 * low-risk cases. Name-only bulk auto-merging stays unavailable by design —
 * duplicate groups are surfaced by the R141 miner and resolved through the
 * versioned merge preview/commands, never by a bulk shortcut.
 *
 * E04 also seeds the queue from the R143-E01 corpus measurements so the
 * queue starts with the REAL, measured conflicts (106 sire-female / 161
 * dam-male role conflicts, register_no duplicate groups, birth-date/year
 * contradictions) instead of only import-time findings. `scan` is
 * idempotent: an (issue_code, horse_id, unresolved) row is never written
 * twice, so re-running the scan creates no duplicates.
 */

/** Issue codes the plan explicitly allows for bulk review (low-risk only). */
export const LOW_RISK_QUALITY_CODES = [
  "NAME_LATIN_CASEFOLD_COLLISION",
  "NAME_NATIVE_UNICODE_RESIDUE",
  "BIRTH_PLACE_MISSING_OPTIONAL",
] as const;

const QUALITY_EVENT_TYPES = ["detected", "assigned", "resolved", "reopened", "note"] as const;
type QualityEventType = (typeof QUALITY_EVENT_TYPES)[number];

const QUALITY_STATUSES = ["open", "assigned", "resolved"] as const;
type QualityStatus = (typeof QUALITY_STATUSES)[number];

const IssueScanRuleVersion = "e04-1.0.0";

const AssignSchema = z.object({
  assignee_user_id: z.string().min(1).max(120),
  note: z.string().trim().max(2000).nullable().optional(),
});

const ResolveSchema = z.object({
  resolution_note: z.string().trim().min(3).max(2000),
});

const ReopenSchema = z.object({
  note: z.string().trim().min(3).max(2000),
});

const NoteSchema = z.object({
  note: z.string().trim().min(1).max(2000),
});

const BulkResolveSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(100),
  resolution_note: z.string().trim().min(3).max(2000),
});

interface QualityAuthEnv {
  DB: D1Database;
  SESSION_COOKIE_NAME: string;
}

const ISSUE_LIST_COLUMNS =
  "q.id,q.horse_id,q.issue_code,q.severity,q.field_name,q.message,q.details_json,q.detected_at,q.resolved_at,q.resolution_note," +
  "q.status,q.assigned_to,q.assigned_at,q.source,q.rule_version,q.resolved_by," +
  "h.name_latin AS horse_name_latin,h.name_native AS horse_name_native,h.register_no AS horse_register_no," +
  "au.display_name AS assignee_name,ru.display_name AS resolver_name";

function isoNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

async function loadIssueOr404(db: D1Database, id: number): Promise<Record<string, unknown>> {
  const row = await db
    .prepare(`SELECT ${ISSUE_LIST_COLUMNS} FROM data_quality_issues q
              LEFT JOIN horses h ON h.id=q.horse_id
              LEFT JOIN users au ON au.id=q.assigned_to
              LEFT JOIN users ru ON ru.id=q.resolved_by
              WHERE q.id=?`)
    .bind(id)
    .first();
  if (!row) throw new HttpError(404, "not_found", "Quality issue not found");
  return row;
}

async function appendQualityEvent(db: D1Database, issueId: number, eventType: QualityEventType, actorUserId: string | null, note: string | null): Promise<void> {
  await db
    .prepare("INSERT INTO data_quality_events(issue_id,event_type,actor_user_id,note,created_at) VALUES(?,?,?,?,CURRENT_TIMESTAMP)")
    .bind(issueId, eventType, actorUserId, note)
    .run();
}

function serializeIssue(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: Number(row.id),
    horse_id: row.horse_id == null ? null : Number(row.horse_id),
    horse_name_latin: row.horse_name_latin ?? null,
    horse_name_native: row.horse_name_native ?? null,
    horse_register_no: row.horse_register_no ?? null,
    issue_code: row.issue_code,
    severity: row.severity,
    field_name: row.field_name ?? null,
    message: row.message,
    details: row.details_json ? safeParse(row.details_json as string) : null,
    detected_at: row.detected_at,
    resolved_at: row.resolved_at ?? null,
    resolution_note: row.resolution_note ?? null,
    status: row.status,
    assigned_to: row.assigned_to ?? null,
    assignee_name: row.assignee_name ?? null,
    assigned_at: row.assigned_at ?? null,
    source: row.source ?? null,
    rule_version: row.rule_version ?? null,
    resolved_by: row.resolved_by ?? null,
    resolver_name: row.resolver_name ?? null,
    age_days: row.detected_at ? Math.max(0, Math.floor((Date.now() - Date.parse(String(row.detected_at))) / 86_400_000)) : null,
  };
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * R145-E04: the queue list. Filters: status (open|assigned|resolved|all),
 * severity, issue_code, assigned=me|unassigned|<user-id>. The response always
 * carries the reconciled counts (open/assigned/resolved, by severity, by
 * code) computed from the SAME table so dashboard numbers and rows can
 * never drift apart.
 */
export async function adminQualityQueue(request: Request, env: QualityAuthEnv): Promise<Response> {
  const auth = await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "horse.edit");
  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status") ?? "open";
  if (!["open", "assigned", "resolved", "all"].includes(statusParam)) {
    throw new HttpError(400, "invalid_status", "status must be one of open, assigned, resolved, all");
  }
  const severityParam = url.searchParams.get("severity");
  if (severityParam != null && !["info", "warning", "error"].includes(severityParam)) {
    throw new HttpError(400, "invalid_severity", "severity must be one of info, warning, error");
  }
  const codeParam = url.searchParams.get("issue_code");
  const assignedParam = url.searchParams.get("assigned");
  const limitRaw = Number(url.searchParams.get("limit") ?? "100");
  const limit = Number.isInteger(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 100;

  const clauses: string[] = [];
  const bindings: unknown[] = [];
  if (statusParam !== "all") {
    clauses.push("q.status=?");
    bindings.push(statusParam);
  }
  if (severityParam) {
    clauses.push("q.severity=?");
    bindings.push(severityParam);
  }
  if (codeParam) {
    clauses.push("q.issue_code=?");
    bindings.push(codeParam);
  }
  if (assignedParam === "unassigned") {
    clauses.push("q.assigned_to IS NULL");
  } else if (assignedParam === "me") {
    clauses.push("q.assigned_to=?");
    bindings.push(auth.user.id);
  }
  const whereSql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  const [rows, statusCounts, severityCounts, codeCounts] = await env.DB.batch([
    env.DB
      .prepare(`SELECT ${ISSUE_LIST_COLUMNS} FROM data_quality_issues q
                LEFT JOIN horses h ON h.id=q.horse_id
                LEFT JOIN users au ON au.id=q.assigned_to
                LEFT JOIN users ru ON ru.id=q.resolved_by
                ${whereSql}
                ORDER BY CASE q.severity WHEN 'error' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, q.id DESC LIMIT ?`)
      .bind(...bindings, limit),
    env.DB.prepare("SELECT status AS value,COUNT(*) AS count FROM data_quality_issues GROUP BY status"),
    env.DB.prepare("SELECT severity AS value,COUNT(*) AS count FROM data_quality_issues WHERE status<>'resolved' GROUP BY severity"),
    env.DB.prepare("SELECT issue_code AS value,COUNT(*) AS count FROM data_quality_issues WHERE status<>'resolved' GROUP BY issue_code ORDER BY count DESC LIMIT 20"),
  ]);

  const statusMap = new Map((statusCounts.results as Array<Record<string, unknown>>).map((row) => [String(row.value), Number(row.count)]));
  return json({
    issues: (rows.results as Array<Record<string, unknown>>).map(serializeIssue),
    counts: {
      open: statusMap.get("open") ?? 0,
      assigned: statusMap.get("assigned") ?? 0,
      resolved: statusMap.get("resolved") ?? 0,
      total: [...statusMap.values()].reduce((sum, value) => sum + value, 0),
      unresolved_by_severity: (severityCounts.results as Array<Record<string, unknown>>).map((row) => ({ value: row.value, count: Number(row.count) })),
      unresolved_by_code: (codeCounts.results as Array<Record<string, unknown>>).map((row) => ({ value: row.value, count: Number(row.count) })),
    },
    low_risk_bulk_codes: [...LOW_RISK_QUALITY_CODES],
    limit,
    note: "Bulk review is restricted to the low-risk codes listed here; duplicate and parent-conflict cases must be resolved individually through the merge preview or a documented correction.",
  });
}

/** R145-E04: one issue + its full lifecycle history. */
export async function adminQualityIssueDetail(request: Request, env: QualityAuthEnv, issueId: number): Promise<Response> {
  await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "horse.edit");
  const row = await loadIssueOr404(env.DB, issueId);
  const events = await env.DB
    .prepare(`SELECT e.id,e.event_type,e.actor_user_id,e.note,e.created_at,u.display_name AS actor_name
              FROM data_quality_events e LEFT JOIN users u ON u.id=e.actor_user_id
              WHERE e.issue_id=? ORDER BY e.id ASC LIMIT 200`)
    .bind(issueId)
    .all();
  return json({
    issue: serializeIssue(row),
    history: (events.results as Array<Record<string, unknown>>).map((event) => ({
      id: Number(event.id),
      event_type: event.event_type,
      actor_user_id: event.actor_user_id ?? null,
      actor_name: event.actor_name ?? null,
      note: event.note ?? null,
      created_at: event.created_at,
    })),
  });
}

/** R145-E04: assign a reviewer (status open|resolved -> assigned). */
export async function adminAssignQualityIssue(request: Request, env: QualityAuthEnv, issueId: number): Promise<Response> {
  const auth = await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "horse.edit");
  requireCsrf(request, auth);
  const parsed = AssignSchema.safeParse(await readJson<unknown>(request, 16 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_assignment", "Assignment failed validation", parsed.error.flatten());
  const issue = await loadIssueOr404(env.DB, issueId);
  const assignee = await env.DB.prepare("SELECT id,is_active FROM users WHERE id=?").bind(parsed.data.assignee_user_id).first<{ id: string; is_active: number }>();
  if (!assignee) throw new HttpError(404, "assignee_not_found", "Assignee user does not exist");
  if (Number(assignee.is_active) !== 1) throw new HttpError(422, "assignee_inactive", "Assignee account is deactivated");
  const now = isoNow();
  await env.DB.batch([
    env.DB.prepare("UPDATE data_quality_issues SET status='assigned', assigned_to=?, assigned_at=? WHERE id=?").bind(assignee.id, now, issueId),
    appendQualityEventBatch(env.DB, issueId, "assigned", auth.user.id, parsed.data.note ?? `Assigned to ${assignee.id}`),
  ]);
  return json({ ok: true, id: issueId, status: "assigned", assigned_to: assignee.id, assigned_at: now });
}

/** R145-E04: resolve with a mandatory reason (status -> resolved). */
export async function adminResolveQualityIssue(request: Request, env: QualityAuthEnv, issueId: number): Promise<Response> {
  const auth = await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "horse.edit");
  requireCsrf(request, auth);
  const parsed = ResolveSchema.safeParse(await readJson<unknown>(request, 16 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_resolution", "A resolution note of at least 3 characters is required", parsed.error.flatten());
  await loadIssueOr404(env.DB, issueId);
  const now = isoNow();
  await env.DB.batch([
    env.DB.prepare("UPDATE data_quality_issues SET status='resolved', resolved_at=?, resolved_by=?, resolution_note=? WHERE id=?").bind(now, auth.user.id, parsed.data.resolution_note, issueId),
    appendQualityEventBatch(env.DB, issueId, "resolved", auth.user.id, parsed.data.resolution_note),
  ]);
  return json({ ok: true, id: issueId, status: "resolved", resolved_at: now });
}

/** R145-E04: reopen a resolved issue — history is preserved, never erased. */
export async function adminReopenQualityIssue(request: Request, env: QualityAuthEnv, issueId: number): Promise<Response> {
  const auth = await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "horse.edit");
  requireCsrf(request, auth);
  const parsed = ReopenSchema.safeParse(await readJson<unknown>(request, 16 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_reopen", "A reopen note of at least 3 characters is required", parsed.error.flatten());
  const issue = await loadIssueOr404(env.DB, issueId);
  const wasResolved = issue.status === "resolved";
  const now = isoNow();
  const nextStatus: QualityStatus = issue.assigned_to ? "assigned" : "open";
  await env.DB.batch([
    env.DB
      .prepare("UPDATE data_quality_issues SET status=?, resolved_at=NULL, resolved_by=NULL, resolution_note=NULL WHERE id=?")
      .bind(nextStatus, issueId),
    appendQualityEventBatch(env.DB, issueId, "reopened", auth.user.id, parsed.data.note),
  ]);
  return json({ ok: true, id: issueId, status: nextStatus, reopened_from: wasResolved ? "resolved" : null });
}

/** R145-E04: append a free-text note to the issue history. */
export async function adminQualityIssueNote(request: Request, env: QualityAuthEnv, issueId: number): Promise<Response> {
  const auth = await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "horse.edit");
  requireCsrf(request, auth);
  const parsed = NoteSchema.safeParse(await readJson<unknown>(request, 16 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_note", "A note is required", parsed.error.flatten());
  await loadIssueOr404(env.DB, issueId);
  await appendQualityEvent(env.DB, issueId, "note", auth.user.id, parsed.data.note);
  return json({ ok: true, id: issueId, noted: true }, { status: 201 });
}

/**
 * R145-E04: bulk resolve — EXPLICIT low-risk codes only. Every id is checked
 * against LOW_RISK_QUALITY_CODES AND severity='info'; a single high-risk row
 * (e.g. a parent-role conflict or a register duplicate) refuses the whole
 * batch. This is the plan's "allow bulk review only for explicitly defined
 * low-risk cases" — and the reason name-only bulk auto-merging stays
 * unavailable: nothing here merges anything.
 */
export async function adminBulkResolveQualityIssues(request: Request, env: QualityAuthEnv): Promise<Response> {
  const auth = await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "horse.edit");
  requireCsrf(request, auth);
  const parsed = BulkResolveSchema.safeParse(await readJson<unknown>(request, 64 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_bulk_resolve", "Bulk resolve failed validation", parsed.error.flatten());
  const ids = [...new Set(parsed.data.ids)];
  const placeholders = ids.map(() => "?").join(",");
  const rows = (await env.DB.prepare(`SELECT id,issue_code,severity,status FROM data_quality_issues WHERE id IN (${placeholders})`).bind(...ids).all()).results as Array<Record<string, unknown>>;
  if (rows.length !== ids.length) throw new HttpError(404, "not_found", "One or more issues do not exist");
  const lowRisk = new Set<string>(LOW_RISK_QUALITY_CODES);
  const refused = rows.filter((row) => !lowRisk.has(String(row.issue_code)) || String(row.severity) !== "info");
  if (refused.length) {
    throw new HttpError(
      422,
      "bulk_resolve_restricted",
      "Bulk review is only available for the explicitly defined low-risk info codes; resolve the refused rows individually",
      { refused_ids: refused.map((row) => Number(row.id)) },
    );
  }
  const now = isoNow();
  await env.DB.batch([
    env.DB.prepare(`UPDATE data_quality_issues SET status='resolved', resolved_at=?, resolved_by=?, resolution_note=? WHERE id IN (${placeholders}) AND status<>'resolved'`).bind(now, auth.user.id, parsed.data.resolution_note, ...ids),
    ...ids.map((id) => appendQualityEventBatch(env.DB, id, "resolved", auth.user.id, `[bulk] ${parsed.data.resolution_note}`)),
  ]);
  return json({ ok: true, resolved: ids.length, ids });
}

function appendQualityEventBatch(db: D1Database, issueId: number, eventType: QualityEventType, actorUserId: string, note: string) {
  return db
    .prepare("INSERT INTO data_quality_events(issue_id,event_type,actor_user_id,note,created_at) VALUES(?,?,?,?,CURRENT_TIMESTAMP)")
    .bind(issueId, eventType, actorUserId, note);
}

/**
 * R145-E04: seed the queue from the R143-E01 corpus measurements. Idempotent
 * detectors over live canonical rows; an unresolved (issue_code, horse_id)
 * row is never duplicated. Detectors (bounded, plan-derived):
 *   - SEX_ROLE_SIRE_FEMALE  (E01: 106)  — a female-classified horse assigned as father
 *   - SEX_ROLE_DAM_MALE     (E01: 161)  — a male-classified horse assigned as mother
 *   - PARENT_BOTH_SIDES     (E01: 2)    — the same horse on both parent sides
 *   - REGISTER_NO_DUPLICATE (E01: 15+)  — register_no shared by >1 live horse
 *   - BIRTH_DATE_YEAR_MISMATCH (E01: 11) — birth_date year contradicts birth_year
 * Scanning never writes canonical data; corrections follow the normal
 * validation/review path (merge commands / horse edit / change requests).
 */
export async function adminQualityScan(request: Request, env: QualityAuthEnv): Promise<Response> {
  const auth = await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "horse.edit");
  requireCsrf(request, auth);
  const url = new URL(request.url);
  const resumeRaw = Number(url.searchParams.get("resume_after") ?? "0");
  const resumeAfter = Number.isInteger(resumeRaw) && resumeRaw > 0 ? resumeRaw : 0;
  // Keyset-paged windows: one call processes at most SCAN_WINDOW horses per
  // detector. Production corpora (95k horses, ~60k parent links) NEVER fit a
  // single request — the caller loops on resume_after until completed=true.
  // R146 production fix: every detector scans a bounded ID RANGE
  // (id > resume_after AND id <= window_end), not "the first N matches over
  // the remaining table". At production scale a rare-match query with only
  // LIMIT bounds re-scans the whole 95k-row tail every pass (PARENT_BOTH_SIDES
  // alone measured 6.5s+), blew the adapter's 8s statement deadline and 500'd
  // every pass. An ID-range window is a PK range scan — O(window) always.
  const SCAN_WINDOW = 3_000; // free-tier Workers CPU budget: ~3k rows per pass keeps every pass under the 1102 limit
  const windowEnd = resumeAfter + SCAN_WINDOW;
  const maxHorseId = Number((await env.DB.prepare("SELECT COALESCE(MAX(id),0) AS m FROM horses").first<{ m: number | null }>())?.m ?? 0);
  // R146 gap skip: production ids are SPARSE (95,639 horses but imports carry
  // ids up to ~10.1M). Walking 3k-id windows through a 9M-id gap would burn
  // thousands of pointless passes. One PK probe — the next EXISTING id —
  // lets a pass whose window contains no horses jump the whole gap at once.
  const nextExistingId = Number((await env.DB.prepare("SELECT COALESCE(MIN(id),0) AS n FROM horses WHERE id>?").bind(resumeAfter).first<{ n: number | null }>())?.n ?? 0);
  const gapAhead = nextExistingId === 0 || nextExistingId > windowEnd;
  let detected: Array<{ horse_id: number | null; issue_code: string; severity: "info" | "warning" | "error"; field_name: string | null; message: string; details: string; dedupe: string }> = [];
  let maxProcessed = resumeAfter;
  let completed = gapAhead ? nextExistingId === 0 || nextExistingId - 1 >= maxHorseId : windowEnd >= maxHorseId;
  if (gapAhead) maxProcessed = nextExistingId === 0 ? maxHorseId : nextExistingId - 1;

  // Sex-role conflicts — the unified B09 classifier decides, never a substring.
  const parentRows = (await env.DB.prepare(
    `SELECT c.id AS child_id,c.name_latin AS child_name,f.id AS parent_id,f.name_latin AS parent_name,f.sex_desc
     FROM horses c JOIN horses f ON f.id=c.father_id
     WHERE c.deleted_at IS NULL AND f.deleted_at IS NULL AND c.id>? AND c.id<=?
     ORDER BY c.id LIMIT ${SCAN_WINDOW}`,
  ).bind(resumeAfter, windowEnd).all()).results as Array<Record<string, unknown>>;
  for (const row of parentRows) {
    maxProcessed = Math.max(maxProcessed, Number(row.child_id));
    if (classifyBreedingSex(row.sex_desc as string | null) === "female") {
      detected.push({
        horse_id: Number(row.parent_id),
        issue_code: "SEX_ROLE_SIRE_FEMALE",
        severity: "error",
        field_name: "father_id",
        message: `Recorded as sire (father) of #${Number(row.child_id)} (${String(row.child_name ?? "")}) but the sex classification is female`,
        details: JSON.stringify({ child_id: Number(row.child_id), parent_id: Number(row.parent_id), side: "father" }),
        dedupe: `SEX_ROLE_SIRE_FEMALE:${Number(row.parent_id)}:${Number(row.child_id)}`,
      });
    }
  }
  maxProcessed = Math.max(maxProcessed, windowEnd);

  const motherRows = (await env.DB.prepare(
    `SELECT c.id AS child_id,c.name_latin AS child_name,m.id AS parent_id,m.name_latin AS parent_name,m.sex_desc
     FROM horses c JOIN horses m ON m.id=c.mother_id
     WHERE c.deleted_at IS NULL AND m.deleted_at IS NULL AND c.id>? AND c.id<=?
     ORDER BY c.id LIMIT ${SCAN_WINDOW}`,
  ).bind(resumeAfter, windowEnd).all()).results as Array<Record<string, unknown>>;
  for (const row of motherRows) {
    maxProcessed = Math.max(maxProcessed, Number(row.child_id));
    if (classifyBreedingSex(row.sex_desc as string | null) === "male") {
      detected.push({
        horse_id: Number(row.parent_id),
        issue_code: "SEX_ROLE_DAM_MALE",
        severity: "error",
        field_name: "mother_id",
        message: `Recorded as dam (mother) of #${Number(row.child_id)} (${String(row.child_name ?? "")}) but the sex classification is male`,
        details: JSON.stringify({ child_id: Number(row.child_id), parent_id: Number(row.parent_id), side: "mother" }),
        dedupe: `SEX_ROLE_DAM_MALE:${Number(row.parent_id)}:${Number(row.child_id)}`,
      });
    }
  }
  maxProcessed = Math.max(maxProcessed, windowEnd);

  // Same horse on both parent sides (E01 P2).
  const bothSides = (await env.DB.prepare(
    `SELECT id,name_latin,father_id,mother_id FROM horses
     WHERE deleted_at IS NULL AND father_id IS NOT NULL AND father_id=mother_id AND id>? AND id<=?
     ORDER BY id LIMIT ${SCAN_WINDOW}`,
  ).bind(resumeAfter, windowEnd).all()).results as Array<Record<string, unknown>>;
  for (const row of bothSides) {
    maxProcessed = Math.max(maxProcessed, Number(row.id));
    detected.push({
      horse_id: Number(row.id),
      issue_code: "PARENT_BOTH_SIDES",
      severity: "warning",
      field_name: "father_id,mother_id",
      message: `Horse #${Number(row.father_id)} is recorded on BOTH parent sides`,
      details: JSON.stringify({ parent_id: Number(row.father_id) }),
      dedupe: `PARENT_BOTH_SIDES:${Number(row.id)}`,
    });
  }
  maxProcessed = Math.max(maxProcessed, windowEnd);

  // register_no duplicate groups (E01 P2) — one issue per EXTRA member row,
  // windowed on horse id. The duplicate-group subquery is globally capped:
  // the queue surfaces the first REGISTER_GROUP_CAP duplicate registers per
  // call; the idempotent dedupe makes repeated calls cheap, never duplicating.
  const REGISTER_GROUP_CAP = 200;
  const duplicateRegisters = (await env.DB.prepare(
    `SELECT id,register_no FROM horses
     WHERE deleted_at IS NULL AND register_no IS NOT NULL AND TRIM(register_no)<>'' AND id>? AND id<=?
       AND register_no IN (SELECT register_no FROM (SELECT register_no FROM horses WHERE deleted_at IS NULL AND register_no IS NOT NULL AND TRIM(register_no)<>'' GROUP BY register_no HAVING COUNT(*)>1 LIMIT ${REGISTER_GROUP_CAP}))
     ORDER BY id LIMIT ${SCAN_WINDOW}`,
  ).bind(resumeAfter, windowEnd).all()).results as Array<Record<string, unknown>>;
  const seenRegister = new Map<string, number>();
  for (const row of duplicateRegisters) {
    maxProcessed = Math.max(maxProcessed, Number(row.id));
    const key = String(row.register_no).trim();
    const firstId = seenRegister.get(key);
    if (firstId == null) {
      seenRegister.set(key, Number(row.id));
      continue;
    }
    detected.push({
      horse_id: Number(row.id),
      issue_code: "REGISTER_NO_DUPLICATE",
      severity: "warning",
      field_name: "register_no",
      message: `register_no '${key}' is shared with horse #${firstId} — route through the duplicate workbench, never bulk-merge`,
      details: JSON.stringify({ register_no: key, other_horse_id: firstId }),
      dedupe: `REGISTER_NO_DUPLICATE:${Number(row.id)}`,
    });
  }
  maxProcessed = Math.max(maxProcessed, windowEnd);

  // birth_date / birth_year contradictions (E01 P2).
  const dateMismatches = (await env.DB.prepare(
    `SELECT id,name_latin,birth_date,birth_year FROM horses
     WHERE deleted_at IS NULL AND birth_date IS NOT NULL AND TRIM(birth_date)<>''
       AND birth_year IS NOT NULL AND CAST(SUBSTR(TRIM(birth_date),1,4) AS INTEGER)<>birth_year AND id>? AND id<=?
     ORDER BY id LIMIT ${SCAN_WINDOW}`,
  ).bind(resumeAfter, windowEnd).all()).results as Array<Record<string, unknown>>;
  for (const row of dateMismatches) {
    maxProcessed = Math.max(maxProcessed, Number(row.id));
    detected.push({
      horse_id: Number(row.id),
      issue_code: "BIRTH_DATE_YEAR_MISMATCH",
      severity: "warning",
      field_name: "birth_date,birth_year",
      message: `birth_date '${String(row.birth_date).trim()}' contradicts birth_year ${Number(row.birth_year)}`,
      details: JSON.stringify({ birth_date: String(row.birth_date).trim(), birth_year: Number(row.birth_year) }),
      dedupe: `BIRTH_DATE_YEAR_MISMATCH:${Number(row.id)}`,
    });
  }
  maxProcessed = Math.max(maxProcessed, windowEnd);

  // Write cap: one call commits at most WRITE_CAP findings — a single pass
  // over a production window can detect far more than one batch should write.
  // Freshness is computed against ALL detections first; the cap then applies
  // to the FRESH rows only. When fresh findings exceed the cap the cursor
  // STAYS on the window (the next pass re-detects; the idempotent dedupe
  // skips everything already queued and writes the next slice — the window
  // drains pass by pass and the scan still terminates). When every detection
  // is already queued (fresh=0, e.g. re-running over a scanned window) the
  // cursor advances normally so the scan can never stall.
  const WRITE_CAP = 150;
  const detectedTotal = detected.length;

  let stayOnWindow = false;
  let created = 0;
  {
    const existing = new Set<string>();
    const codes = [...new Set(detected.map((d) => d.issue_code))];
    for (const code of codes) {
      const rows = (await env.DB.prepare("SELECT id,horse_id,details_json FROM data_quality_issues WHERE issue_code=? AND status<>'resolved'").bind(code).all()).results as Array<Record<string, unknown>>;
      for (const row of rows) {
        const details = typeof row.details_json === "string" ? safeParse(row.details_json) : row.details_json;
        const child = details && typeof details === "object" && (details as Record<string, unknown>).child_id != null ? `:${Number((details as Record<string, unknown>).child_id)}` : "";
        if (row.horse_id != null) existing.add(`${code}:${Number(row.horse_id)}${child}`);
      }
    }
    detected = detected.filter((d) => d.horse_id == null || !existing.has(d.dedupe));
    if (detected.length > WRITE_CAP) {
      detected = detected.slice(0, WRITE_CAP);
      stayOnWindow = true;
    }
  }

  if (detected.length) {
    const fresh = detected;
    if (fresh.length) {
      // Batched write: chunked pipelined INSERT batches (the previous per-row
      // INSERT+SELECT pairs were too slow through Hyperdrive at corpus scale;
      // a single 150-statement batch then blew the adapter's 20s batch
      // deadline in production — measured ~130ms/statement through the
      // Hyperdrive proxy, so chunks stay well under it at 40).
      const maxIdBefore = Number((await env.DB.prepare("SELECT COALESCE(MAX(id),0) AS m FROM data_quality_issues").first<{ m: number | null }>())?.m ?? 0);
      const WRITE_CHUNK = 40;
      for (let i = 0; i < fresh.length; i += WRITE_CHUNK) {
        await env.DB.batch(
          fresh.slice(i, i + WRITE_CHUNK).map((d) =>
            env.DB
              .prepare("INSERT INTO data_quality_issues(horse_id,issue_code,severity,field_name,message,details_json,source,rule_version) VALUES(?,?,?,?,?,?,?,?)")
              .bind(d.horse_id, d.issue_code, d.severity, d.field_name, d.message, d.details, "e04_corpus_scan", IssueScanRuleVersion),
          ),
        );
      }
      // Every fresh row now has id > maxIdBefore and source='e04_corpus_scan'
      // (a partially-failed chunk set is healed by the idempotent dedupe: the
      // next pass re-detects only the rows that never landed). One statement
      // appends the 'detected' event for each — and repairs any events a
      // previously interrupted scan pass left missing.
      const eventResult = await env.DB.prepare(
        `INSERT INTO data_quality_events(issue_id,event_type,actor_user_id,note,created_at)
         SELECT id,'detected',?,'Detected by '||issue_code||' rule ('||?||')',CURRENT_TIMESTAMP
         FROM data_quality_issues q
         WHERE q.source='e04_corpus_scan' AND q.id>?
           AND NOT EXISTS(SELECT 1 FROM data_quality_events e WHERE e.issue_id=q.id AND e.event_type='detected')
         LIMIT 4000`,
      ).bind(auth.user.id, IssueScanRuleVersion, maxIdBefore).run();
      void eventResult;
      const createdRows = await env.DB.prepare(
        `SELECT COUNT(*) AS count FROM data_quality_issues WHERE source='e04_corpus_scan' AND id>?`,
      ).bind(maxIdBefore).first<{ count: number }>();
      created = Number(createdRows?.count ?? 0);
    }
  }

  // Repair pass for rows a previously interrupted scan left without a
  // 'detected' event (bounded; cheap when nothing is missing).
  await env.DB.prepare(
    `INSERT INTO data_quality_events(issue_id,event_type,actor_user_id,note,created_at)
     SELECT q.id,'detected',?,'Detected by '||q.issue_code||' rule ('||?||') (repaired)',CURRENT_TIMESTAMP
     FROM data_quality_issues q
     WHERE q.source='e04_corpus_scan'
       AND NOT EXISTS(SELECT 1 FROM data_quality_events e WHERE e.issue_id=q.id AND e.event_type='detected')
     LIMIT 4000`,
  ).bind(auth.user.id, IssueScanRuleVersion).run();

  const openCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM data_quality_issues WHERE status<>'resolved'").first<{ count: number }>();
  const scanCompleted = completed && !stayOnWindow;
  return json({
    ok: true,
    detected_candidates: detectedTotal,
    created,
    open_issues: Number(openCount?.count ?? 0),
    rule_version: IssueScanRuleVersion,
    completed: scanCompleted,
    resume_after: scanCompleted ? null : (stayOnWindow ? resumeAfter : maxProcessed),
    scanned_from: resumeAfter,
    scanned_to: stayOnWindow ? resumeAfter : maxProcessed,
    note: "Read-only canonical scan; queue rows only; keyset-paged — repeat with resume_after until completed=true. Canonical corrections follow the normal validation/review path (merge commands, horse edit, change requests).",
  });
}

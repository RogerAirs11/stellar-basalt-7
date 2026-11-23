import {
  decideCaseStatements,
  decideAppealStatements,
  reportCaseStatements,
  assignCaseStatements,
  appealCaseStatements,
  setStandingStatements,
} from "../../moderation/commands";
import {
  ABUSE_STANDINGS,
  DEFAULT_ABUSE_STANDING,
  isAbuseStanding,
  standingAffectedAccount,
  standingCasePreconditionSatisfied,
  standingRefusalReason,
  standingTransitionAllowed,
  type AbuseStanding,
} from "../../moderation/standing";
import { isServiceProviderManager } from "../../services/commands";
import { z } from "zod";
import { HttpError, json, readJson } from "../http";
import { requireAuth, requireCsrf } from "../../auth/guards";
import { isModerationReason, isModerationTargetTable, SUPPORT_HOURS_NOTE, MODERATION_DECISIONS } from "../../moderation/vocabulary";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * R88 agent plan P16 + R95-N14 — moderation, reporting, marketplace trust
 * and the abuse-standing lifecycle.
 *
 * Boundary rules (each pinned by tests):
 *  - A case NEVER targets a horse record: only marketplace/directory
 *    surfaces. Hiding a listing suspends the LISTING via the transparent
 *    overlay; the horse profile is untouched.
 *  - The decision trail is append-only: decisions, appeals, reversals and
 *    standing actions are events; an overturned decision never erases the
 *    previous one.
 *  - Deduplication is structural (0061 partial indexes): one ACTIVE case per
 *    reporter per target and one OPEN appeal per case, under concurrency.
 *    Closed history NEVER blocks a later report for a new incident.
 *  - Participants (reporter, reported party) never see internal events, staff
 *    notes, reporter identity or unrelated appeals. Staff see the full trail
 *    plus every ACTIVE suspension reason for the target (the moderator view
 *    that explains all of them).
 *  - Standing (service_abuse_standing) is an EXPLICIT operator action with
 *    case provenance; the account owner can always see their own standing.
 *  - Queue surfaces carry the honest support-hours note; no 24/7 claim.
 */

type Env = { DB: D1Database; SESSION_COOKIE_NAME: string };

const DETAILS_MAX = 2000;
const APPEAL_MAX = 2000;
const QUEUE_LIMIT = 100;

const ReportSchema = z.object({
  target_table: z.enum(["sales_listings", "sales_inquiries", "service_requests", "directory_profiles"]),
  target_id: z.string().trim().min(1).max(64),
  reason: z.string().trim().min(3).max(40),
  details: z.string().trim().max(DETAILS_MAX).nullable().optional(),
});

/** A racing duplicate report/creation failing on the partial indexes. */
function isDuplicateActiveConstraint(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  // SQLite (D1): "UNIQUE constraint failed: ..." — production Supabase
  // (Postgres): "duplicate key value violates unique constraint ...".
  return /UNIQUE constraint/i.test(message) || /duplicate key value/i.test(message);
}

/** Does the reported target actually exist? (Honest 404 instead of a ghost case.) */
async function targetExists(db: D1Database, table: string, id: string, actorUserId: string): Promise<boolean> {
  if (table === "sales_listings") {
    return Boolean(await db.prepare("SELECT id FROM sales_listings WHERE id=?").bind(id).first());
  }
  if (table === "sales_inquiries") {
    return Boolean(await db.prepare("SELECT i.id FROM sales_inquiries i JOIN sales_listings l ON l.id=i.listing_id WHERE i.id=? AND (i.buyer_user_id=? OR l.seller_user_id=?)").bind(id, actorUserId, actorUserId).first());
  }
  if (table === "service_requests") {
    const item = await db.prepare("SELECT requester_user_id, provider_person_id FROM service_requests WHERE id=?").bind(Number(id)).first<{requester_user_id:string;provider_person_id:number}>();
    return Boolean(item && (item.requester_user_id === actorUserId || await isServiceProviderManager(db, actorUserId, item.provider_person_id)));
  }
  return Boolean(await db.prepare("SELECT person_id FROM directory_profiles WHERE person_id=?").bind(Number(id)).first());
}

export async function reportCase(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  const parsed = ReportSchema.safeParse(await readJson<unknown>(request, 8 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_report", "Report failed validation", parsed.error.flatten());
  const d = parsed.data;
  if (!isModerationReason(d.reason)) {
    throw new HttpError(400, "invalid_reason", "Reason must be from the reviewed moderation vocabulary");
  }
  if (!isModerationTargetTable(d.target_table)) {
    throw new HttpError(400, "invalid_target", "Target must be a marketplace or directory surface (never a horse record)");
  }
  if (!(await targetExists(env.DB, d.target_table, d.target_id, auth.user.id))) {
    throw new HttpError(404, "target_not_found", "The reported item does not exist");
  }
  // Fast honest 409 (the partial index is the structural enforcement under
  // concurrency — the route maps its violation to the same answer).
  const open = await env.DB.prepare(`
    SELECT id FROM moderation_cases
    WHERE reporter_user_id=? AND target_table=? AND target_id=? AND status NOT LIKE 'resolved%'
  `).bind(auth.user.id, d.target_table, d.target_id).first();
  if (open) throw new HttpError(409, "case_exists", "You already have an open case for this item");
  try {
    const [insert] = await env.DB.batch(reportCaseStatements(env.DB, {
      targetTable: d.target_table, targetId: d.target_id, reporterUserId: auth.user.id,
      reason: d.reason, details: d.details ?? null, operationId: crypto.randomUUID(),
    }));
    return json({
      created: true,
      case_id: Number(insert?.meta.last_row_id ?? 0),
      note: "The report is recorded and will be triaged in priority order during staffed hours. A closed case never blocks a later report for a new incident. " + SUPPORT_HOURS_NOTE,
    }, { status: 201 });
  } catch (error) {
    if (isDuplicateActiveConstraint(error)) {
      throw new HttpError(409, "case_exists", "You already have an open case for this item");
    }
    throw error;
  }
}

/** The operator queue: severity-ranked, oldest-first, honest counts. */
export async function moderationQueue(request: Request, env: Env): Promise<Response> {
  await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "admin");
  const url = new URL(request.url);
  const statusFilter = url.searchParams.get("status");
  const where = statusFilter && statusFilter !== "all" ? "WHERE c.status=?" : "";
  const args = where ? [statusFilter] : [];
  const rows = await (args.length
    ? env.DB.prepare(`
        SELECT c.id, c.target_table, c.target_id, c.reason, c.status, c.severity, c.assigned_operator_user_id,
               c.created_at, (SELECT COUNT(*) FROM moderation_appeals a WHERE a.case_id=c.id AND a.status='open') AS open_appeals
        FROM moderation_cases c ${where}
        ORDER BY CASE c.severity WHEN 'urgent' THEN 3 WHEN 'high' THEN 2 WHEN 'medium' THEN 1 ELSE 0 END DESC, c.created_at ASC
        LIMIT ${QUEUE_LIMIT}
      `).bind(...args)
    : env.DB.prepare(`
        SELECT c.id, c.target_table, c.target_id, c.reason, c.status, c.severity, c.assigned_operator_user_id,
               c.created_at, (SELECT COUNT(*) FROM moderation_appeals a WHERE a.case_id=c.id AND a.status='open') AS open_appeals
        FROM moderation_cases c
        ORDER BY CASE c.severity WHEN 'urgent' THEN 3 WHEN 'high' THEN 2 WHEN 'medium' THEN 1 ELSE 0 END DESC, c.created_at ASC
        LIMIT ${QUEUE_LIMIT}
      `)
  ).all<Record<string, unknown>>();
  const counts = await env.DB.prepare("SELECT status, COUNT(*) AS n FROM moderation_cases GROUP BY status").all<{ status: string; n: number }>();
  return json({
    queue: rows.results ?? [],
    status_counts: Object.fromEntries((counts.results ?? []).map((row) => [row.status, Number(row.n)])),
    ordering: "severity (urgent first), then oldest first",
    dedupe_note: "One active case per reporter per target is enforced structurally; resolved history never blocks a new report.",
    support_hours_note: SUPPORT_HOURS_NOTE,
  });
}

const AssignSchema = z.object({
  operator_user_id: z.string().min(3).max(64),
  severity: z.enum(["low", "medium", "high", "urgent"]).optional(),
});

export async function assignCase(request: Request, env: Env, id: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "admin");
  requireCsrf(request, auth);
  const parsed = AssignSchema.safeParse(await readJson<unknown>(request, 4 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_assignment", "Assignment failed validation", parsed.error.flatten());
  const row = await env.DB.prepare("SELECT id, status FROM moderation_cases WHERE id=?").bind(id)
    .first<{ id: number; status: string }>();
  if (!row) throw new HttpError(404, "not_found", "Case not found");
  if (row.status.startsWith("resolved")) throw new HttpError(409, "already_resolved", "This case is resolved; further action requires an appeal decision");
  const [update] = await env.DB.batch(assignCaseStatements(env.DB, {
    caseId: id, expectedStatus: row.status, operatorUserId: parsed.data.operator_user_id,
    severity: parsed.data.severity ?? null, actorUserId: auth.user.id, operationId: crypto.randomUUID(),
  }));
  if (Number(update?.meta.changes ?? 0) !== 1) {
    // The case moved, the acting administrator changed, or the assignee lost
    // standing between the read and the write.
    throw new HttpError(409, "case_state_changed", "The case changed state or an involved account changed standing; re-read and retry");
  }
  return json({ assigned: true, case_id: id, operator_user_id: parsed.data.operator_user_id });
}

const DecisionSchema = z.object({
  decision: z.enum(["hide", "dismiss", "reinstate"]),
  note: z.string().trim().min(10).max(2000),
});

/**
 * The operator decision. `hide` suspends the target LISTING through the
 * transparent overlay (never a horse change); `reinstate` reverses a prior
 * hide and both events stay in the trail forever.
 */
export async function decideCase(request: Request, env: Env, id: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "admin");
  requireCsrf(request, auth);
  const parsed = DecisionSchema.safeParse(await readJson<unknown>(request, 8 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_decision", "Decision failed validation (hide | dismiss | reinstate + a note)", parsed.error.flatten());
  if (!MODERATION_DECISIONS.has(parsed.data.decision)) throw new HttpError(400, "invalid_decision", "Unknown decision");
  const row = await env.DB.prepare("SELECT id, target_table, target_id, status FROM moderation_cases WHERE id=?").bind(id)
    .first<{ id: number; target_table: string; target_id: string; status: string }>();
  if (!row) throw new HttpError(404, "not_found", "Case not found");
  if (row.status.startsWith("resolved")) throw new HttpError(409, "already_resolved", "This case is resolved; further action requires an appeal decision");

  if (parsed.data.decision === "reinstate") throw new HttpError(409, "appeal_required", "Reinstatement requires an appeal against the particular hiding decision");
  if (parsed.data.decision === "hide" && row.target_table !== "sales_listings") throw new HttpError(422, "unsupported_suspension", "No suspension overlay is implemented for this target; no action was recorded");
  const nextStatus = parsed.data.decision === "hide" ? "resolved_hidden" : "resolved_dismissed";
  const statements = decideCaseStatements(env.DB, {caseId:id,expectedStatus:row.status,targetId:row.target_id,targetTable:row.target_table,
    actorUserId:auth.user.id,operationId:crypto.randomUUID(),decision:parsed.data.decision,note:parsed.data.note});
  const [update] = await env.DB.batch(statements);
  if (Number(update?.meta.changes ?? 0) !== 1) throw new HttpError(409, "already_resolved", "This case is resolved");
  return json({
    decided: true,
    case_id: id,
    decision: parsed.data.decision,
    status: nextStatus,
    note: parsed.data.decision === "hide"
      ? "The listing is suspended (hidden from public lists, marked on its detail view). The horse profile is untouched."
      : "The case is closed without action. The full trail is preserved.",
  });
}

const AppealSchema = z.object({ statement: z.string().trim().min(20).max(APPEAL_MAX) });

/** The REPORTED party appeals: for listings, the listing's seller. */
export async function appealCase(request: Request, env: Env, id: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  const parsed = AppealSchema.safeParse(await readJson<unknown>(request, 8 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_appeal", "Appeal failed validation (statement 20-2000 chars)");
  const row = await env.DB.prepare("SELECT id, target_table, target_id, status FROM moderation_cases WHERE id=?").bind(id)
    .first<{ id: number; target_table: string; target_id: string; status: string }>();
  if (!row) throw new HttpError(404, "not_found", "Case not found");
  if (row.status !== "resolved_hidden") {
    throw new HttpError(409, "not_appealable", "Only a hidden-outcome case can be appealed at this stage");
  }
  // Standing authority (pre-flight): for a listing target, only its seller
  // may appeal. The command re-checks the mandate INSIDE the write.
  if (row.target_table === "sales_listings") {
    const listing = await env.DB.prepare("SELECT seller_user_id FROM sales_listings WHERE id=?").bind(row.target_id)
      .first<{ seller_user_id: string | null }>();
    if (!listing || listing.seller_user_id !== auth.user.id) {
      throw new HttpError(403, "not_appellant", "Only the seller of the reported listing can appeal this case");
    }
  } else {
    throw new HttpError(403, "not_appellant", "Appeals are currently supported for listing cases");
  }
  const existing = await env.DB.prepare("SELECT id FROM moderation_appeals WHERE case_id=? AND status='open'").bind(id).first();
  if (existing) throw new HttpError(409, "appeal_exists", "This case already has an open appeal");
  try {
    const [insert] = await env.DB.batch(appealCaseStatements(env.DB, {
      caseId: id, appellantUserId: auth.user.id, statement: parsed.data.statement, operationId: crypto.randomUUID(),
    }));
    if (Number(insert?.meta.changes ?? 0) !== 1) {
      // The seller mandate or the case state changed between pre-flight and
      // the write: nothing was recorded.
      throw new HttpError(403, "not_appellant", "Only the seller of the reported listing can appeal this case");
    }
    return json({ appealed: true, appeal_id: Number(insert?.meta.last_row_id ?? 0), note: "The appeal is recorded and will be reviewed in priority order. " + SUPPORT_HOURS_NOTE }, { status: 201 });
  } catch (error) {
    if (isDuplicateActiveConstraint(error)) {
      throw new HttpError(409, "appeal_exists", "This case already has an open appeal");
    }
    throw error;
  }
}

const AppealDecisionSchema = z.object({
  outcome: z.enum(["upheld", "overturned"]),
  note: z.string().trim().min(10).max(2000),
});

/** Operator decides an open appeal: uphold the hide, or overturn (reinstate). */
export async function decideAppeal(request: Request, env: Env, id: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "admin");
  requireCsrf(request, auth);
  const parsed = AppealDecisionSchema.safeParse(await readJson<unknown>(request, 8 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_appeal_decision", "Appeal decision failed validation");
  const appeal = await env.DB.prepare("SELECT id, case_id, status FROM moderation_appeals WHERE id=?").bind(id)
    .first<{ id: number; case_id: number; status: string }>();
  if (!appeal) throw new HttpError(404, "not_found", "Appeal not found");
  if (appeal.status !== "open") throw new HttpError(409, "already_decided", "This appeal is already decided");
  const row = await env.DB.prepare("SELECT target_table, target_id, status FROM moderation_cases WHERE id=?").bind(appeal.case_id)
    .first<{ target_table: string; target_id: string; status: string }>();
  if (!row || row.status !== "resolved_hidden" || row.target_table !== "sales_listings") {
    throw new HttpError(409, "not_appealable", "Only a hidden listing case carries an appeal decision");
  }
  const statements = decideAppealStatements(env.DB, {appealId:id,caseId:appeal.case_id,actorUserId:auth.user.id,
    operationId:crypto.randomUUID(),outcome:parsed.data.outcome,note:parsed.data.note});
  const [update] = await env.DB.batch(statements);
  if (Number(update?.meta.changes ?? 0) !== 1) throw new HttpError(409, "already_decided", "This appeal is already decided");
  return json({
    decided: true,
    outcome: parsed.data.outcome,
    note: parsed.data.outcome === "overturned"
      ? "This case's suspension is reversed. Independent suspensions may still hide the listing; the decision trail is preserved."
      : "The original decision stands. The appeal record and the decision trail are preserved.",
  });
}

const StandingSchema = z.object({
  standing: z.enum(["normal", "restricted", "suspended"]),
  reason: z.string().trim().min(10).max(2000),
});

/**
 * R95-N14: the standing lifecycle. An operator records an abuse-standing
 * change for the case's affected account (the OWNER of the reported
 * artifact). The transition must come from the standing matrix; the action
 * is provenance-linked to a RESOLVED, non-merged case; the case stamp, the
 * upsert and the append-only `standing` event are one marker-gated batch.
 * This is the only writer of service_abuse_standing.
 */
export async function setCaseStanding(request: Request, env: Env, id: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "admin");
  requireCsrf(request, auth);
  const parsed = StandingSchema.safeParse(await readJson<unknown>(request, 4 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_standing", "Standing action failed validation (normal | restricted | suspended + a reason)", parsed.error.flatten());
  const to = parsed.data.standing as AbuseStanding;
  const row = await env.DB.prepare("SELECT id, target_table, target_id, status FROM moderation_cases WHERE id=?").bind(id)
    .first<{ id: number; target_table: string; target_id: string; status: string }>();
  if (!row) throw new HttpError(404, "not_found", "Case not found");
  if (!standingCasePreconditionSatisfied(row.status)) {
    throw new HttpError(409, "standing_case_precondition", "Standing follows a resolved case (a merged case carries no standing; act on the surviving case)");
  }
  const account = await standingAffectedAccount(env.DB, row.target_table, row.target_id);
  if (row.target_table === "directory_profiles") {
    throw new HttpError(422, "standing_owner_unsupported_for_target", "No reviewed profile-owner mandate exists for directory profiles; refusing instead of guessing");
  }
  if (!account) {
    throw new HttpError(422, "owner_unresolved", "The reported artifact has no resolvable owner account; refusing instead of guessing");
  }
  const current = await env.DB.prepare("SELECT standing FROM service_abuse_standing WHERE user_id=?").bind(account)
    .first<{ standing: string }>();
  const from = (current?.standing && isAbuseStanding(current.standing) ? current.standing : DEFAULT_ABUSE_STANDING) as AbuseStanding;
  if (from === to || !standingTransitionAllowed(from, to)) {
    throw new HttpError(409, "standing_transition_refused", standingRefusalReason(from, to));
  }
  const [, stamp] = await env.DB.batch(setStandingStatements(env.DB, {
    caseId: id, accountUserId: account, standing: to, expectedStanding: from, reason: parsed.data.reason,
    actorUserId: auth.user.id, operationId: crypto.randomUUID(),
  }));
  if (Number(stamp?.meta.changes ?? 0) !== 1) {
    throw new HttpError(409, "standing_case_changed", "The case or the acting administrator changed between the read and the write; re-read and retry");
  }
  return json({
    standing_set: true,
    case_id: id,
    account,
    from,
    to,
    note: to === "normal"
      ? "The account's service-request standing is restored. The standing action and its case provenance are preserved in the trail."
      : "The account's service-request standing is recorded. The affected account can see their own standing; the action and its case provenance are preserved in the trail.",
  });
}

/**
 * R95-N14: the account owner's own standing view (participant lifecycle
 * transparency). Nobody else's standing is ever visible here.
 */
export async function myAbuseStanding(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  const row = await env.DB.prepare("SELECT standing, reason, updated_at FROM service_abuse_standing WHERE user_id=?").bind(auth.user.id)
    .first<{ standing: string; reason: string | null; updated_at: string }>();
  const standing = (row?.standing && isAbuseStanding(row.standing) ? row.standing : DEFAULT_ABUSE_STANDING) as AbuseStanding;
  return json({
    standing,
    reason: row?.reason ?? null,
    updated_at: row?.updated_at ?? null,
    effect: standing === "normal"
      ? "You can create service requests. No restriction is recorded against your account."
      : "A restricted or suspended account cannot create new service requests. This is set and reviewed by moderation staff through case review.",
    scope: "service requests only; this never touches your horse records or listings",
  });
}

/**
 * Case detail. STAFF get the full append-only trail, every active suspension
 * reason for the target, and the affected account's current standing (the
 * moderator view that explains all of them). PARTICIPANTS (the reporter, the
 * reported party) get a minimal summary: case status, their OWN appeals, and
 * — for the reported party of a listing — the active suspension reasons for
 * THEIR listing. Never internal events, staff notes, reporter identity or
 * unrelated appeals.
 */
export async function caseDetail(request: Request, env: Env, id: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  const row = await env.DB.prepare("SELECT * FROM moderation_cases WHERE id=?").bind(id).first<Record<string, unknown>>();
  if (!row) throw new HttpError(404, "not_found", "Case not found");
  // R120 correction of the R119 remediation's IMP-013 wiring: the evidence
  // policy (assigned operator / super_admin supervisory read, ACTIVE cases
  // only) governs PRIVATE CONVERSATION EVIDENCE (marketplace.ts), not the
  // moderation WORKFLOW surface. caseDetail shows the case trail, suspension
  // reasons and account standing — the surface an admin needs to WORK the
  // queue before assignment and to AUDIT a resolved case afterwards. It
  // contains no conversation bodies or contact content. Every other
  // moderation endpoint (queue, decide, appeals) is role-based; a stricter
  // gate here only would make the queue unworkable (decide-but-cannot-view)
  // and erase the auditable trail the P16 contract pins.
  const isStaff = ["admin", "super_admin"].includes(auth.user.role);
  const isReporter = row.reporter_user_id === auth.user.id;
  const isReportedParty = row.target_table === "sales_listings" && Boolean(await env.DB.prepare("SELECT id FROM sales_listings WHERE id=? AND seller_user_id=?").bind(row.target_id, auth.user.id).first());
  if (!isStaff && !isReporter && !isReportedParty) {
    // The reported party sees the case through the appeal flow; the reporter
    // sees their own case; everyone else gets an honest 404.
    throw new HttpError(404, "not_found", "Case not found");
  }
  // Active suspension reasons for the target listing — shown to staff (the
  // full picture) and to the reported party (their own listing's state).
  // Never includes reporter identity or staff notes.
  const activeSuspensions = row.target_table === "sales_listings"
    ? (await env.DB.prepare("SELECT case_id, reason, suspended_at FROM listing_suspensions WHERE listing_id=? AND reinstated_at IS NULL ORDER BY id").bind(row.target_id).all<{ case_id: number; reason: string; suspended_at: string }>()).results ?? []
    : [];
  if (isStaff) {
    const events = await env.DB.prepare("SELECT id, actor_user_id, event_type, event_json, created_at FROM moderation_case_events WHERE case_id=? ORDER BY id").bind(id).all<Record<string, unknown>>();
    const appeals = await env.DB.prepare("SELECT id, appellant_user_id, statement, status, decided_at, decision_note, created_at FROM moderation_appeals WHERE case_id=? ORDER BY id").bind(id).all<Record<string, unknown>>();
    const affectedAccount = await standingAffectedAccount(env.DB, String(row.target_table), String(row.target_id));
    const standingRow = affectedAccount
      ? await env.DB.prepare("SELECT standing, reason, updated_at FROM service_abuse_standing WHERE user_id=?").bind(affectedAccount).first<{ standing: string; reason: string | null; updated_at: string }>()
      : null;
    return json({
      case: row,
      events: events.results ?? [],
      appeals: appeals.results ?? [],
      active_suspensions: activeSuspensions,
      affected_account: affectedAccount,
      affected_standing: standingRow
        ? { standing: standingRow.standing, reason: standingRow.reason, updated_at: standingRow.updated_at }
        : affectedAccount
          ? { standing: "normal", reason: null, updated_at: null }
          : null,
      support_hours_note: SUPPORT_HOURS_NOTE,
      trail_note: "Events are append-only: decisions, appeals, reversals and standing actions never erase prior records.",
    });
  }
  // Participant projection: minimal summary, own appeals only, no internal
  // material, no reporter identity.
  const ownAppeals = isReportedParty
    ? (await env.DB.prepare("SELECT id, status, decided_at, decision_note, created_at FROM moderation_appeals WHERE case_id=? AND appellant_user_id=? ORDER BY id").bind(id, auth.user.id).all<Record<string, unknown>>()).results ?? []
    : [];
  return json({
    case: { id: row.id, target_table: row.target_table, target_id: row.target_id, status: row.status, created_at: row.created_at, updated_at: row.updated_at },
    active_suspensions: isReportedParty ? activeSuspensions : [],
    your_appeals: ownAppeals,
    support_hours_note: SUPPORT_HOURS_NOTE,
    note: "This is a summary view. Internal investigation notes and other parties' information are never shared here.",
  });
}

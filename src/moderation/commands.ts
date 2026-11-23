import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { isAbuseStanding, standingTransitionAllowed, type AbuseStanding } from "./standing";

/**
 * R95-N14 — moderation command layer.
 *
 * Every mutating route family goes through one of these pure builders, so
 * the exact SQL can be pinned by tests, replayed by the parity harness
 * (tests/python/p01_parity_lib.py extracts these named templates and
 * substitutes the {{activeAdminActor}} tokens the same way the runtime
 * does) and marker-gated for audit. The N14 discipline, applied uniformly:
 *
 *  - Creation, assignment, appeal creation and standing use the CURRENT
 *    actor standing, re-checked INSIDE the statement (the route-time check
 *    is only a pre-flight — the row may change before the write lands).
 *  - State mutations carry an EXPECTED status (CAS): a case that moved
 *    between read and write fails the write; it never lands on a stale view.
 *  - Every side effect (event, suspension, standing row) is conditioned on
 *    the operation marker of THIS call: only the winning transition writes.
 *  - Deduplication is STRUCTURAL (migration 0061 partial indexes), not
 *    pre-check-based: the database refuses duplicates under concurrency.
 */

/**
 * The active-administrator predicate (parameterized: the actor/assignee id
 * binds as the following `?`). Shared by every moderation command that
 * requires an operator, so the route and the parity sequence agree on one
 * definition of "currently an active administrator".
 */
export const ACTIVE_ADMIN_SQL =
  "EXISTS(SELECT 1 FROM users WHERE id=? AND is_active=1 AND role IN ('admin','super_admin'))";

// ---------------------------------------------------------------------------
// Case creation (report). Duplicate ACTIVE reports for the same reporter +
// target fail on uq_moderation_cases_active (0061); the route maps that to an
// honest 409. The event is marker-gated on the case's own last_operation_id.
// ---------------------------------------------------------------------------
export const REPORT_CASE_INSERT_SQL = `
  INSERT INTO moderation_cases(target_table,target_id,reporter_user_id,reason,details,severity,last_operation_id)
  VALUES(?,?,?,?,?,'medium',?)
`;

export const REPORT_CASE_EVENT_SQL = `
  INSERT INTO moderation_case_events(case_id,actor_user_id,event_type,event_json)
  SELECT id,?,'created',? FROM moderation_cases
  WHERE reporter_user_id=? AND target_table=? AND target_id=? AND last_operation_id=?
`;

export interface ReportCaseCommand {
  targetTable: string;
  targetId: string;
  reporterUserId: string;
  reason: string;
  details: string | null;
  operationId: string;
}

export function reportCaseStatements(db: D1Database, input: ReportCaseCommand): D1PreparedStatement[] {
  return [
    db.prepare(REPORT_CASE_INSERT_SQL).bind(input.targetTable, input.targetId, input.reporterUserId, input.reason, input.details, input.operationId),
    db.prepare(REPORT_CASE_EVENT_SQL)
      .bind(input.reporterUserId, JSON.stringify({ reason: input.reason, target_table: input.targetTable, target_id: input.targetId }), input.reporterUserId, input.targetTable, input.targetId, input.operationId),
  ];
}

// ---------------------------------------------------------------------------
// Assignment. The UPDATE re-checks the ACTING administrator (not just the
// route-time role) AND the assignee's current standing, carries the CAS on
// the expected status, and the event is marker-gated.
// ---------------------------------------------------------------------------
export const ASSIGN_CASE_UPDATE_SQL = `
  UPDATE moderation_cases
  SET assigned_operator_user_id=?, severity=COALESCE(?, severity),
      status=CASE WHEN status='new' THEN 'triaged' ELSE status END,
      updated_at=CURRENT_TIMESTAMP, last_operation_id=?
  WHERE id=? AND status=?
    AND status NOT LIKE 'resolved%'
    AND {{activeAdminActor}}
    AND {{activeAdminAssignee}}
`;

export const ASSIGN_CASE_EVENT_SQL = `
  INSERT INTO moderation_case_events(case_id,actor_user_id,event_type,event_json)
  SELECT id,?,'assigned',? FROM moderation_cases WHERE id=? AND last_operation_id=?
`;

export interface AssignCaseCommand {
  caseId: number;
  expectedStatus: string;
  operatorUserId: string;
  severity: "low" | "medium" | "high" | "urgent" | null;
  actorUserId: string;
  operationId: string;
}

export function assignCaseStatements(db: D1Database, input: AssignCaseCommand): D1PreparedStatement[] {
  const update = ASSIGN_CASE_UPDATE_SQL
    .replace("{{activeAdminActor}}", ACTIVE_ADMIN_SQL)
    .replace("{{activeAdminAssignee}}", ACTIVE_ADMIN_SQL);
  return [
    db.prepare(update).bind(input.operatorUserId, input.severity, input.operationId, input.caseId, input.expectedStatus, input.actorUserId, input.operatorUserId),
    db.prepare(ASSIGN_CASE_EVENT_SQL)
      .bind(input.actorUserId, JSON.stringify({ operator_user_id: input.operatorUserId, severity: input.severity ?? undefined, from_status: input.expectedStatus }), input.caseId, input.operationId),
  ];
}

// ---------------------------------------------------------------------------
// Operator decision on a case (R88 semantics, now a named template): CAS on
// the expected status, ACTIVE admin re-check inside the statement,
// marker-gated event; hide additionally writes the transparent suspension
// overlay row, marker-gated the same way.
// ---------------------------------------------------------------------------
export const DECIDE_CASE_UPDATE_SQL = `
  UPDATE moderation_cases SET status=?,resolution_note=?,resolved_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP,last_operation_id=?
  WHERE id=? AND status=? AND target_table=? AND target_id=? AND {{activeAdminActor}}
`;

export const DECIDE_CASE_EVENT_SQL = `
  INSERT INTO moderation_case_events(case_id,actor_user_id,event_type,event_json)
  SELECT id,?,'decision',? FROM moderation_cases WHERE id=? AND last_operation_id=?
`;

export const DECIDE_CASE_SUSPENSION_SQL = `
  INSERT INTO listing_suspensions(listing_id,case_id,suspended_by_user_id,reason)
  SELECT target_id,id,?,? FROM moderation_cases WHERE id=? AND last_operation_id=?
`;

export interface CaseDecisionCommand {
  caseId: number;
  expectedStatus: string;
  targetId: string;
  targetTable: string;
  actorUserId: string;
  operationId: string;
  decision: "hide" | "dismiss";
  note: string;
}

/** Every side effect belongs to the winning state transition, not merely a
 * case which happens to be resolved when another request arrives. */
export function decideCaseStatements(db: D1Database, input: CaseDecisionCommand): D1PreparedStatement[] {
  if (input.decision === "hide" && input.targetTable !== "sales_listings") throw new RangeError("This target has no implemented suspension overlay");
  if (!["new", "triaged", "action_pending"].includes(input.expectedStatus)) throw new RangeError("Case is already resolved");
  const update = DECIDE_CASE_UPDATE_SQL.replace("{{activeAdminActor}}", ACTIVE_ADMIN_SQL);
  const statements = [
    db.prepare(update)
      .bind(input.decision === "hide" ? "resolved_hidden" : "resolved_dismissed", input.note, input.operationId, input.caseId, input.expectedStatus, input.targetTable, input.targetId, input.actorUserId),
    db.prepare(DECIDE_CASE_EVENT_SQL)
      .bind(input.actorUserId, JSON.stringify({ decision: input.decision, note: input.note, previous_status: input.expectedStatus }), input.caseId, input.operationId),
  ];
  if (input.decision === "hide") {
    statements.push(db.prepare(DECIDE_CASE_SUSPENSION_SQL).bind(input.actorUserId, input.note, input.caseId, input.operationId));
  }
  return statements;
}

// ---------------------------------------------------------------------------
// Appeal creation by the REPORTED party. The mandate (the listing's CURRENT
// seller) is re-checked INSIDE the INSERT..SELECT, so a seller change between
// pre-flight and write yields zero rows and no appeal. The one-open-appeal
// partial index (0061) makes concurrent duplicate creation structurally
// impossible; the route maps the constraint error to an honest 409.
// ---------------------------------------------------------------------------
export const APPEAL_CASE_INSERT_SQL = `
  INSERT INTO moderation_appeals(case_id,appellant_user_id,statement,last_operation_id)
  SELECT c.id,?,?,? FROM moderation_cases c
  WHERE c.id=? AND c.status='resolved_hidden' AND c.target_table='sales_listings'
    AND EXISTS(SELECT 1 FROM sales_listings l WHERE l.id=c.target_id AND l.seller_user_id=?)
`;

export const APPEAL_CASE_EVENT_SQL = `
  INSERT INTO moderation_case_events(case_id,actor_user_id,event_type,event_json)
  SELECT case_id,?,'appeal',? FROM moderation_appeals WHERE case_id=? AND last_operation_id=? AND appellant_user_id=?
`;

export interface AppealCaseCommand {
  caseId: number;
  appellantUserId: string;
  statement: string;
  operationId: string;
}

export function appealCaseStatements(db: D1Database, input: AppealCaseCommand): D1PreparedStatement[] {
  return [
    db.prepare(APPEAL_CASE_INSERT_SQL).bind(input.appellantUserId, input.statement, input.operationId, input.caseId, input.appellantUserId),
    db.prepare(APPEAL_CASE_EVENT_SQL)
      .bind(input.appellantUserId, JSON.stringify({ statement: input.statement }), input.caseId, input.operationId, input.appellantUserId),
  ];
}

// ---------------------------------------------------------------------------
// Appeal decision (R88 semantics, now a named template): overturning lifts
// ONLY the suspensions caused by THIS case (independent suspensions from
// other cases stay); every side effect is marker-gated.
// ---------------------------------------------------------------------------
export const DECIDE_APPEAL_UPDATE_SQL = `
  UPDATE moderation_appeals SET status=?,decided_by_user_id=?,decided_at=CURRENT_TIMESTAMP,decision_note=?,last_operation_id=?
  WHERE id=? AND case_id=? AND status='open' AND {{activeAdminActor}}
    AND EXISTS(SELECT 1 FROM moderation_cases c WHERE c.id=moderation_appeals.case_id AND c.status='resolved_hidden' AND c.target_table='sales_listings')
`;

export const DECIDE_APPEAL_EVENT_SQL = `
  INSERT INTO moderation_case_events(case_id,actor_user_id,event_type,event_json)
  SELECT case_id,?,'reversal',? FROM moderation_appeals WHERE id=? AND last_operation_id=?
`;

export const DECIDE_APPEAL_REINSTATE_CASE_SQL = `
  UPDATE moderation_cases SET status='resolved_reinstated',updated_at=CURRENT_TIMESTAMP,last_operation_id=?
  WHERE id=? AND status='resolved_hidden' AND EXISTS(SELECT 1 FROM moderation_appeals a WHERE a.id=? AND a.case_id=moderation_cases.id AND a.last_operation_id=?)
`;

export const DECIDE_APPEAL_REINSTATE_SUSPENSION_SQL = `
  UPDATE listing_suspensions SET reinstated_at=CURRENT_TIMESTAMP,reinstated_by_user_id=?
  WHERE case_id=? AND reinstated_at IS NULL AND EXISTS(SELECT 1 FROM moderation_appeals a WHERE a.id=? AND a.case_id=listing_suspensions.case_id AND a.last_operation_id=?)
`;

export function decideAppealStatements(db: D1Database, input: {
  appealId: number; caseId: number; actorUserId: string; operationId: string; outcome: "upheld" | "overturned"; note: string;
}): D1PreparedStatement[] {
  const update = DECIDE_APPEAL_UPDATE_SQL.replace("{{activeAdminActor}}", ACTIVE_ADMIN_SQL);
  const statements = [
    db.prepare(update).bind(input.outcome, input.actorUserId, input.note, input.operationId, input.appealId, input.caseId, input.actorUserId),
    db.prepare(DECIDE_APPEAL_EVENT_SQL)
      .bind(input.actorUserId, JSON.stringify({ appeal_id: input.appealId, outcome: input.outcome, note: input.note }), input.appealId, input.operationId),
  ];
  if (input.outcome === "overturned") statements.push(
    db.prepare(DECIDE_APPEAL_REINSTATE_CASE_SQL).bind(input.operationId, input.caseId, input.appealId, input.operationId),
    db.prepare(DECIDE_APPEAL_REINSTATE_SUSPENSION_SQL).bind(input.actorUserId, input.caseId, input.appealId, input.operationId),
  );
  return statements;
}

// ---------------------------------------------------------------------------
// The standing lifecycle (service_abuse_standing, migration 0060's writer).
// The case is the provenance: the stamp re-checks the acting administrator
// AND the case precondition (resolved, not a merged shadow) inside the
// statement; the standing row is an upsert of the CURRENT decision; the
// append-only `standing` event is marker-gated on the stamp.
// ---------------------------------------------------------------------------
export const STANDING_CASE_STAMP_SQL = `
  UPDATE moderation_cases SET last_operation_id=?, updated_at=CURRENT_TIMESTAMP
  WHERE id=? AND status LIKE 'resolved%' AND status<>'resolved_merged'
    AND {{activeAdminActor}}
    AND COALESCE((SELECT standing FROM service_abuse_standing WHERE user_id=?),'normal')=?
    AND (
      (target_table='sales_listings' AND EXISTS(SELECT 1 FROM sales_listings l WHERE l.id=moderation_cases.target_id AND l.seller_user_id=?))
      OR (target_table='sales_inquiries' AND EXISTS(SELECT 1 FROM sales_inquiries i WHERE i.id=moderation_cases.target_id AND i.buyer_user_id=?))
      OR (target_table='service_requests' AND EXISTS(SELECT 1 FROM service_requests r WHERE CAST(r.id AS TEXT)=moderation_cases.target_id AND r.requester_user_id=?))
    )
`;

export const STANDING_UPSERT_SQL = `
  INSERT INTO service_abuse_standing(user_id,standing,reason,updated_at)
  SELECT ?,?,?,CURRENT_TIMESTAMP
  WHERE EXISTS(SELECT 1 FROM moderation_cases WHERE id=? AND last_operation_id=? AND status LIKE 'resolved%' AND status<>'resolved_merged')
  ON CONFLICT(user_id) DO UPDATE SET standing=excluded.standing, reason=excluded.reason, updated_at=CURRENT_TIMESTAMP
`;

export const STANDING_EVENT_SQL = `
  INSERT INTO moderation_case_events(case_id,actor_user_id,event_type,event_json)
  SELECT id,?,'standing',? FROM moderation_cases WHERE id=? AND last_operation_id=?
`;

export interface SetStandingCommand {
  caseId: number;
  accountUserId: string;
  standing: AbuseStanding;
  expectedStanding: AbuseStanding;
  reason: string;
  actorUserId: string;
  operationId: string;
}

export function setStandingStatements(db: D1Database, input: SetStandingCommand): D1PreparedStatement[] {
  if (!isAbuseStanding(input.standing) || !isAbuseStanding(input.expectedStanding) || !standingTransitionAllowed(input.expectedStanding, input.standing)) {
    throw new RangeError("A standing command requires an actual, expected transition");
  }
  const stamp = STANDING_CASE_STAMP_SQL.replace("{{activeAdminActor}}", ACTIVE_ADMIN_SQL);
  return [
    // Serialize decisions about this account even when they use different
    // cases. PostgreSQL locks this existing row; the following statement sees
    // the latest committed standing in the adapter's READ COMMITTED batch.
    db.prepare("UPDATE users SET updated_at=updated_at WHERE id=?").bind(input.accountUserId),
    db.prepare(stamp).bind(input.operationId, input.caseId, input.actorUserId,
      input.accountUserId, input.expectedStanding, input.accountUserId, input.accountUserId, input.accountUserId),
    db.prepare(STANDING_UPSERT_SQL).bind(input.accountUserId, input.standing, input.reason, input.caseId, input.operationId),
    db.prepare(STANDING_EVENT_SQL)
      .bind(input.actorUserId, JSON.stringify({ from_standing: input.expectedStanding, standing: input.standing, reason: input.reason, account_user_id: input.accountUserId }), input.caseId, input.operationId),
  ];
}

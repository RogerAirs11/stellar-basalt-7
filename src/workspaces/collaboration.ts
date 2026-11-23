import { WORKSPACE_DOCUMENT_CATEGORY_KEYS } from "../contracts/platform";
import { HttpError } from "../api/http";
/**
 * R98-N16 — stable collaboration completion: the staff INVITATION lifecycle
 * (consent before delegation), DOCUMENT organization records, audit-visible
 * task REASSIGNMENT, no-overwrite task import, and the staff-departure
 * suppression of QUEUED workspace notifications.
 *
 * Every mutating statement follows the proven workspace pattern:
 *   1. stable row lock (no-op UPDATE on workspace_collections) to serialize
 *      concurrent mutations per collection;
 *   2. mutation-time authority predicates INSIDE the write (a revoke between
 *      preflight and mutation turns the write into zero rows, never a
 *      stale-authority success);
 *   3. capacity checks in the same INSERT..SELECT boundary;
 *   4. marker-gated audit rows (a failed mutation writes no audit; a retry
 *      writes no duplicate).
 *
 * Honesty rules carried here:
 *   - An invitation creates NOTHING until the invitee accepts; acceptance
 *     re-checks the inviter's CURRENT manage authority and the staff
 *     capacity inside the creating statement.
 *   - Document rows are TRACKER records (title/category/note/expiry); no file
 *     bytes and no medical content are stored; expiry drives document_renewal
 *     tasks through date arithmetic only.
 *   - Task import NEVER overwrites: an existing occurrence_key is skipped and
 *     REPORTED, and the caller receives the exact skipped list.
 *   - Revoking staff suppresses their QUEUED workspace-task notifications at
 *     revoke time (in addition to the drain's live re-authorization): the
 *     departure is immediate for private reads and queued notifications.
 */
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { CURRENT_MEMBERSHIP_PREDICATE } from "../organizations/membershipPolicy";
import { workspaceAuthority, type WorkspaceAction, type WorkspacePolicyOptions } from "./policy";
import { isValidDay } from "./domain";

export const WORKSPACE_INVITE_EXPIRY_DAYS = 14;
export const MAX_DOCUMENTS_PER_COLLECTION = 500;
export const MAX_TASK_IMPORT_ROWS = 200;
export const MAX_ACTIVE_STAFF_PER_COLLECTION_N16 = 50;

/** The inviter's CURRENT manage authority, correlated against the invite row
 * (owner of a personal collection, or a CURRENT owner/manager of the owning
 * organization — the same semantics as workspaceAuthority('manage') with the
 * principal read from the invite itself, so acceptance re-checks it INSIDE the
 * creating statement). */
export const INVITER_MANAGE_AUTHORITY_SQL = `EXISTS(
      SELECT 1 FROM workspace_collections wc2 WHERE wc2.id=i.collection_id AND wc2.deleted_at IS NULL
      AND EXISTS(SELECT 1 FROM users inviter WHERE inviter.id=i.invited_by_user_id AND inviter.is_active=1)
      AND (
        (wc2.organization_id IS NULL AND wc2.owner_user_id=i.invited_by_user_id)
        OR (wc2.organization_id IS NOT NULL AND EXISTS(
          SELECT 1 FROM organization_memberships m JOIN organizations o ON o.id=m.organization_id
          WHERE m.organization_id=wc2.organization_id AND m.user_id=i.invited_by_user_id
            AND m.role IN ('owner','manager') AND ${CURRENT_MEMBERSHIP_PREDICATE}))
      ))`;

function lockWorkspaceStatement(db: D1Database, input: { collectionId: number; userId: string; action: WorkspaceAction; policy?: WorkspacePolicyOptions }): D1PreparedStatement[] {
  const auth = workspaceAuthority(input.userId, input.action, input.policy);
  return [db.prepare(`
    UPDATE workspace_collections AS wc SET row_version=wc.row_version, updated_at=wc.updated_at
    WHERE wc.id=? AND wc.deleted_at IS NULL AND ${auth.sql}
  `).bind(input.collectionId, ...auth.binds)];
}

function auditStatement(db: D1Database, input: {
  actorUserId: string; action: string; entityType: string; entityId: string;
  before: unknown; after: unknown; gateSql: string; gateBinds: unknown[]; operationId?: string;
}): D1PreparedStatement {
  return db.prepare(`
    INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,operation_id,created_at)
    SELECT ?,?,?,?,?,?,?,CURRENT_TIMESTAMP WHERE EXISTS(${input.gateSql})
  `).bind(input.actorUserId, input.action, input.entityType, input.entityId,
    input.before === null ? "null" : JSON.stringify(input.before), JSON.stringify(input.after), input.operationId ?? null, ...input.gateBinds);
}

/** Expiry text for a fresh invite (bounded 14-day life). */
export function inviteExpiryText(now: Date): string {
  return new Date(now.getTime() + WORKSPACE_INVITE_EXPIRY_DAYS * 86_400_000).toISOString().slice(0, 19).replace("T", " ");
}

// ---------------------------------------------------------------------------
// 1. Staff invitations
// ---------------------------------------------------------------------------

/** Invite create: inviter needs live manage authority; no self-invite; one
 * OPEN invite per (collection, invitee); audit is marker-gated on the invite row. */
export function inviteStaffStatements(db: D1Database, input: {
  collectionId: number; inviteeUserId: string; proposedActions: string; actorUserId: string; operationId: string; expiresAtText: string; note: string | null;
}): D1PreparedStatement[] {
  const lock = lockWorkspaceStatement(db, { collectionId: input.collectionId, userId: input.actorUserId, action: "manage" });
  const auth = workspaceAuthority(input.actorUserId, "manage");
  return [...lock,
    db.prepare(`
      INSERT INTO workspace_staff_invites(collection_id,invitee_user_id,invited_by_user_id,proposed_actions,status,note,expires_at,last_invite_operation_id)
      SELECT ?,?,?,?,?,?,?,? FROM workspace_collections wc
      WHERE wc.id=? AND wc.deleted_at IS NULL AND ${auth.sql}
        AND ? <> ?
        AND EXISTS(SELECT 1 FROM users invitee WHERE invitee.id=? AND invitee.is_active=1)
        AND NOT EXISTS(SELECT 1 FROM workspace_staff_invites x WHERE x.collection_id=? AND x.invitee_user_id=? AND x.status='pending')
      ON CONFLICT DO NOTHING
    `).bind(input.collectionId, input.inviteeUserId, input.actorUserId, input.proposedActions, "pending", input.note, input.expiresAtText, input.operationId,
      input.collectionId, ...auth.binds, input.actorUserId, input.inviteeUserId, input.inviteeUserId,
      input.collectionId, input.inviteeUserId),
    auditStatement(db, {
      actorUserId: input.actorUserId, action: "workspace.staff_invited", entityType: "workspace_staff_invites",
      entityId: `${input.collectionId}:${input.inviteeUserId}`, before: null,
      after: { invitee_user_id: input.inviteeUserId, proposed_actions: input.proposedActions, expires_at: input.expiresAtText },
      gateSql: "SELECT 1 FROM workspace_staff_invites WHERE collection_id=? AND invitee_user_id=? AND last_invite_operation_id=?",
      gateBinds: [input.collectionId, input.inviteeUserId, input.operationId],
    })];
}

/** Invite accept: the INVITEE creates their own assignment. The creating
 * statement re-checks the INVITER's current manage authority AND the staff
 * capacity inside the INSERT..SELECT — a late revoke or a full collection
 * inserts zero rows. The invite moves to accepted only through THIS operation's
 * marker (races fail closed). */
export function acceptStaffInviteStatements(db: D1Database, input: {
  collectionId: number; inviteeUserId: string; actorUserId: string; operationId: string;
}): D1PreparedStatement[] {
  if (input.actorUserId !== input.inviteeUserId) throw new HttpError(403, "invite_principal_mismatch", "Only the invitee may accept this invitation");
  return [
    db.prepare(`UPDATE workspace_collections AS wc SET row_version=wc.row_version, updated_at=wc.updated_at
      WHERE wc.id=? AND wc.deleted_at IS NULL
        AND EXISTS(SELECT 1 FROM workspace_staff_invites i WHERE i.collection_id=wc.id AND i.invitee_user_id=? AND i.status='pending')
    `).bind(input.collectionId, input.inviteeUserId),
    db.prepare(`
      INSERT INTO workspace_staff_assignments(collection_id,user_id,actions,granted_by_user_id,last_operation_id)
      SELECT i.collection_id, i.invitee_user_id, i.proposed_actions, i.invited_by_user_id, ?
      FROM workspace_staff_invites i
      JOIN workspace_collections wc ON wc.id=i.collection_id AND wc.deleted_at IS NULL
      WHERE i.collection_id=? AND i.invitee_user_id=? AND i.status='pending'
        AND datetime(i.expires_at) > datetime('now')
        AND EXISTS(SELECT 1 FROM users invitee WHERE invitee.id=i.invitee_user_id AND invitee.is_active=1)
        AND (SELECT COUNT(*) FROM workspace_staff_assignments WHERE collection_id=i.collection_id AND status='active') < ?
        AND ${INVITER_MANAGE_AUTHORITY_SQL}
      ON CONFLICT(collection_id,user_id) DO UPDATE SET
        actions=excluded.actions, status='active', revoked_at=NULL, revoked_by_user_id=NULL,
        granted_at=CURRENT_TIMESTAMP, last_operation_id=excluded.last_operation_id
    `).bind(input.operationId, input.collectionId, input.inviteeUserId, MAX_ACTIVE_STAFF_PER_COLLECTION_N16),
    db.prepare(`
      UPDATE workspace_staff_invites SET status='accepted', responded_at=CURRENT_TIMESTAMP, last_invite_operation_id=?
      WHERE collection_id=? AND invitee_user_id=? AND status='pending'
        AND EXISTS(SELECT 1 FROM workspace_staff_assignments WHERE collection_id=? AND user_id=? AND last_operation_id=?)
    `).bind(input.operationId, input.collectionId, input.inviteeUserId, input.collectionId, input.inviteeUserId, input.operationId),
    auditStatement(db, {
      actorUserId: input.inviteeUserId, action: "workspace.staff_invite_accepted", entityType: "workspace_staff_assignments",
      entityId: String(input.collectionId), before: null,
      after: { collection_id: input.collectionId, via: "invite" },
      gateSql: "SELECT 1 FROM workspace_staff_assignments WHERE collection_id=? AND user_id=? AND last_operation_id=?",
      gateBinds: [input.collectionId, input.inviteeUserId, input.operationId],
    })];
}

/** Invite decline: the invitee only mutates their own pending invite. */
export function declineStaffInviteStatements(db: D1Database, input: {
  collectionId: number; inviteeUserId: string; actorUserId: string; operationId: string;
}): D1PreparedStatement[] {
  if (input.actorUserId !== input.inviteeUserId) throw new HttpError(403, "invite_principal_mismatch", "Only the invitee may decline this invitation");
  return [
    db.prepare(`
      UPDATE workspace_staff_invites SET status='declined', responded_at=CURRENT_TIMESTAMP, last_invite_operation_id=?
      WHERE collection_id=? AND invitee_user_id=? AND status='pending'
    `).bind(input.operationId, input.collectionId, input.inviteeUserId),
    auditStatement(db, {
      actorUserId: input.inviteeUserId, action: "workspace.staff_invite_declined", entityType: "workspace_staff_invites",
      entityId: `${input.collectionId}:${input.inviteeUserId}`, before: { status: "pending" }, after: { status: "declined", operation_id: input.operationId },
      operationId: input.operationId,
      gateSql: "SELECT 1 FROM workspace_staff_invites WHERE collection_id=? AND invitee_user_id=? AND status='declined' AND last_invite_operation_id=? AND NOT EXISTS(SELECT 1 FROM audit_events WHERE action='workspace.staff_invite_declined' AND entity_type='workspace_staff_invites' AND entity_id=? AND operation_id=?)",
      gateBinds: [input.collectionId, input.inviteeUserId, input.operationId, `${input.collectionId}:${input.inviteeUserId}`, input.operationId],
    })];
}

/** Revoke an open invite (inviter side, manage authority). */
export function revokeStaffInviteStatements(db: D1Database, input: {
  collectionId: number; inviteeUserId: string; actorUserId: string; operationId: string;
}): D1PreparedStatement[] {
  const lock = lockWorkspaceStatement(db, { collectionId: input.collectionId, userId: input.actorUserId, action: "manage" });
  const auth = workspaceAuthority(input.actorUserId, "manage");
  return [...lock,
    db.prepare(`
      UPDATE workspace_staff_invites SET status='revoked', responded_at=CURRENT_TIMESTAMP, last_invite_operation_id=?
      WHERE collection_id=? AND invitee_user_id=? AND status='pending'
        AND EXISTS(SELECT 1 FROM workspace_collections wc WHERE wc.id=workspace_staff_invites.collection_id AND wc.deleted_at IS NULL AND ${auth.sql})
    `).bind(input.operationId, input.collectionId, input.inviteeUserId, ...auth.binds)];
}

/** Mark expired invites (sweep; idempotent). */
export function expireStaffInvitesStatements(db: D1Database): D1PreparedStatement[] {
  return [db.prepare(
    "UPDATE workspace_staff_invites SET status='expired' WHERE status='pending' AND datetime(expires_at) <= datetime('now')"
  )];
}

// ---------------------------------------------------------------------------
// 2. Document organization records
// ---------------------------------------------------------------------------

export const WORKSPACE_DOCUMENT_CATEGORIES = WORKSPACE_DOCUMENT_CATEGORY_KEYS;
export type WorkspaceDocumentCategory = typeof WORKSPACE_DOCUMENT_CATEGORIES[number];

/** Document create: bounded per collection, authority + capacity in the same
 * boundary; the audit row is marker-gated on the new row. */
export function createDocumentStatements(db: D1Database, input: {
  collectionId: number; horseId: number | null; title: string; category: WorkspaceDocumentCategory;
  note: string | null; expiresAtDay: string | null; actorUserId: string; operationId: string;
}): D1PreparedStatement[] {
  if (input.expiresAtDay != null && !isValidDay(input.expiresAtDay)) throw new RangeError("expires_at must be a real Gregorian day or null");
  const lock = lockWorkspaceStatement(db, { collectionId: input.collectionId, userId: input.actorUserId, action: "tasks_manage" });
  const auth = workspaceAuthority(input.actorUserId, "tasks_manage");
  return [...lock,
    db.prepare(`
      INSERT INTO workspace_documents(collection_id,horse_id,title,category,note,expires_at,created_by_user_id,last_operation_id)
      SELECT ?,?,?,?,?,?,?,? FROM workspace_collections wc
      WHERE wc.id=? AND wc.deleted_at IS NULL AND ${auth.sql}
        AND (SELECT COUNT(*) FROM workspace_documents WHERE collection_id=? AND status='active') < ?
        AND (CAST(? AS INTEGER) IS NULL OR EXISTS(SELECT 1 FROM workspace_collection_members cm JOIN horses h ON h.id=cm.horse_id AND h.deleted_at IS NULL
          WHERE cm.collection_id=wc.id AND cm.horse_id=?))
    `).bind(input.collectionId, input.horseId, input.title, input.category, input.note, input.expiresAtDay, input.actorUserId, input.operationId,
      input.collectionId, ...auth.binds, input.collectionId, MAX_DOCUMENTS_PER_COLLECTION, input.horseId, input.horseId),
    auditStatement(db, {
      actorUserId: input.actorUserId, action: "workspace.document_created", entityType: "workspace_documents",
      entityId: input.operationId, before: null,
      after: { title: input.title, category: input.category, expires_at: input.expiresAtDay },
      gateSql: "SELECT 1 FROM workspace_documents WHERE last_operation_id=?",
      gateBinds: [input.operationId],
    })];
}

/** Document update (versioned): expected_version guarded; audit marker-gated. */
export function updateDocumentStatements(db: D1Database, input: {
  collectionId: number; documentId: number; expectedVersion: number;
  title: string; category: WorkspaceDocumentCategory; note: string | null; expiresAtDay: string | null;
  actorUserId: string; operationId: string;
}): D1PreparedStatement[] {
  if (input.expiresAtDay != null && !isValidDay(input.expiresAtDay)) throw new RangeError("expires_at must be a real Gregorian day or null");
  const lock = lockWorkspaceStatement(db, { collectionId: input.collectionId, userId: input.actorUserId, action: "tasks_manage" });
  const auth = workspaceAuthority(input.actorUserId, "tasks_manage");
  return [...lock,
    db.prepare(`
      UPDATE workspace_documents AS d SET title=?, category=?, note=?, expires_at=?,
        row_version=row_version+1, last_operation_id=?, updated_at=CURRENT_TIMESTAMP
      WHERE d.id=? AND d.collection_id=? AND d.status='active' AND d.row_version=?
        AND EXISTS(SELECT 1 FROM workspace_collections wc WHERE wc.id=d.collection_id AND wc.deleted_at IS NULL AND ${auth.sql})
    `).bind(input.title, input.category, input.note, input.expiresAtDay, input.operationId,
      input.documentId, input.collectionId, input.expectedVersion, ...auth.binds),
    auditStatement(db, {
      actorUserId: input.actorUserId, action: "workspace.document_updated", entityType: "workspace_documents",
      entityId: String(input.documentId), before: { row_version: input.expectedVersion },
      after: { title: input.title, category: input.category, expires_at: input.expiresAtDay },
      gateSql: "SELECT 1 FROM workspace_documents WHERE id=? AND last_operation_id=?",
      gateBinds: [input.documentId, input.operationId],
    })];
}

/** Document archive (soft): history rows are never deleted. */
export function archiveDocumentStatements(db: D1Database, input: {
  collectionId: number; documentId: number; actorUserId: string; operationId: string;
}): D1PreparedStatement[] {
  const lock = lockWorkspaceStatement(db, { collectionId: input.collectionId, userId: input.actorUserId, action: "tasks_manage" });
  const auth = workspaceAuthority(input.actorUserId, "tasks_manage");
  return [...lock,
    db.prepare(`
      UPDATE workspace_documents AS d SET status='archived', row_version=row_version+1, last_operation_id=?, updated_at=CURRENT_TIMESTAMP
      WHERE d.id=? AND d.collection_id=? AND d.status='active'
        AND EXISTS(SELECT 1 FROM workspace_collections wc WHERE wc.id=d.collection_id AND wc.deleted_at IS NULL AND ${auth.sql})
    `).bind(input.operationId, input.documentId, input.collectionId, ...auth.binds),
    auditStatement(db, {
      actorUserId: input.actorUserId, action: "workspace.document_archived", entityType: "workspace_documents",
      entityId: String(input.documentId), before: { status: "active" }, after: { status: "archived" },
      gateSql: "SELECT 1 FROM workspace_documents WHERE id=? AND collection_id=? AND status='archived' AND last_operation_id=?",
      gateBinds: [input.documentId, input.collectionId, input.operationId],
    })];
}

// ---------------------------------------------------------------------------
// 3. Audit-visible task reassignment
// ---------------------------------------------------------------------------

/** Reassign: the actor needs live tasks_manage authority; the NEW assignee
 * must currently hold view access to the collection — both re-checked inside
 * the UPDATE. The audit row is marker-gated on the task row. */
export function reassignTaskStatements(db: D1Database, input: {
  collectionId: number; taskId: number; newAssigneeUserId: string | null; actorUserId: string; operationId: string; expectedVersion: number;
}): D1PreparedStatement[] {
  const lock = lockWorkspaceStatement(db, { collectionId: input.collectionId, userId: input.actorUserId, action: "tasks_manage" });
  const auth = workspaceAuthority(input.actorUserId, "tasks_manage");
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) throw new RangeError("A current task version is required");
  const assigneeAuth = input.newAssigneeUserId === null ? { sql: "1=1", binds: [] } : workspaceAuthority(input.newAssigneeUserId, "view");
  return [...lock,
    db.prepare(`
      UPDATE workspace_tasks AS t SET assigned_to_user_id=?, last_operation_id=?, row_version=row_version+1, updated_at=CURRENT_TIMESTAMP
      WHERE t.id=? AND t.collection_id=? AND t.status='open' AND t.row_version=?
        AND EXISTS(SELECT 1 FROM workspace_collections wc WHERE wc.id=t.collection_id AND wc.deleted_at IS NULL AND ${auth.sql})
        AND EXISTS(SELECT 1 FROM workspace_collections wc2 WHERE wc2.id=t.collection_id AND wc2.deleted_at IS NULL AND ${assigneeAuth.sql.replace(/wc\./g, "wc2.")})
    `).bind(input.newAssigneeUserId, input.operationId, input.taskId, input.collectionId, input.expectedVersion,
      ...auth.binds, ...assigneeAuth.binds),
    auditStatement(db, {
      actorUserId: input.actorUserId, action: "workspace.task_reassigned", entityType: "workspace_tasks",
      entityId: String(input.taskId), before: { row_version: input.expectedVersion }, after: { assigned_to_user_id: input.newAssigneeUserId, row_version: input.expectedVersion + 1 },
      gateSql: "SELECT 1 FROM workspace_tasks WHERE id=? AND last_operation_id=?",
      gateBinds: [input.taskId, input.operationId],
    })];
}

/** R117-14: task REOPEN (one-shot occurrences only). Completing a RECURRING
 * occurrence materializes the next occurrence in the same transaction, so
 * reopening a closed recurring row would leave two live occurrences of the
 * same reminder — that case is refused at the handler layer with an honest
 * explanation instead. Reopen restores a completed recurrence='none' row to
 * 'open', clears the completion markers, advances the version and is
 * audit-recorded. Same discipline as every mutation: stable row lock +
 * mutation-time actor predicate + marker-gated audit (a failed reopen writes
 * no audit row; a retry writes no duplicate). */
export function reopenTaskStatements(db: D1Database, input: {
  collectionId: number; taskId: number; actorUserId: string; operationId: string; expectedVersion: number;
}): D1PreparedStatement[] {
  const lock = lockWorkspaceStatement(db, { collectionId: input.collectionId, userId: input.actorUserId, action: "tasks_manage" });
  const auth = workspaceAuthority(input.actorUserId, "tasks_manage");
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) throw new RangeError("A current task version is required");
  return [...lock,
    db.prepare(`
      UPDATE workspace_tasks AS t SET status='open', completed_at=NULL, completed_by_user_id=NULL,
        last_operation_id=?, row_version=row_version+1, updated_at=CURRENT_TIMESTAMP
      WHERE t.id=? AND t.collection_id=? AND t.status='done' AND t.recurrence='none' AND t.row_version=?
        AND EXISTS(SELECT 1 FROM workspace_collections wc WHERE wc.id=t.collection_id AND wc.deleted_at IS NULL AND ${auth.sql})
    `).bind(input.operationId, input.taskId, input.collectionId, input.expectedVersion, ...auth.binds),
    auditStatement(db, {
      actorUserId: input.actorUserId, action: "workspace.task_reopened", entityType: "workspace_tasks",
      entityId: String(input.taskId), before: { status: "done", row_version: input.expectedVersion },
      after: { status: "open", row_version: input.expectedVersion + 1 },
      gateSql: "SELECT 1 FROM workspace_tasks WHERE id=? AND last_operation_id=?",
      gateBinds: [input.taskId, input.operationId],
    })];
}

// ---------------------------------------------------------------------------
// 4. Staff departure: suppress QUEUED workspace-task notifications
// ---------------------------------------------------------------------------

/** R98-N16: revoking staff suppresses their QUEUED workspace-task
 * notifications at revoke time. The drain's live re-authorization stays the
 * second line of defense; this statement makes the departure immediate. */
export const STAFF_DEPARTURE_SUPPRESSION_SQL = `UPDATE notification_outbox
  SET status='suppressed', last_error='workspace_staff_revoked', updated_at=CURRENT_TIMESTAMP
  WHERE recipient_user_id=? AND status='queued'
    AND EXISTS(SELECT 1 FROM workspace_tasks t WHERE t.collection_id=?
      AND notification_outbox.payload_ref='workspace_tasks:'||CAST(t.id AS TEXT))`;

/** Run in the SAME batch as the revoke. An operation marker prevents an
 * unsuccessful/repeated revoke from suppressing unrelated current work. */
export function suppressQueuedWorkspaceNotificationsStatement(
  db: D1Database, revokedUserId: string, collectionId: number, operationId?: string,
): D1PreparedStatement {
  if (!Number.isSafeInteger(collectionId) || collectionId < 1) throw new RangeError("A workspace id is required");
  const gate = operationId === undefined ? "" : ` AND EXISTS(
    SELECT 1 FROM workspace_staff_assignments s WHERE s.collection_id=? AND s.user_id=?
      AND s.status='revoked' AND s.last_operation_id=?)`;
  return db.prepare(STAFF_DEPARTURE_SUPPRESSION_SQL + gate).bind(
    revokedUserId, collectionId, ...(operationId === undefined ? [] : [collectionId, revokedUserId, operationId]),
  );
}

export { CURRENT_MEMBERSHIP_PREDICATE };

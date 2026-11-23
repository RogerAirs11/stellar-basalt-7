/**
 * R95-N08: atomic workspace mutations and exact capacities.
 *
 * The proven task-completion pattern (completeTaskStatements) extended to
 * EVERY workspace mutation:
 *
 *  1. STABLE ROW LOCK: every mutation batch starts with a no-op UPDATE on the
 *     workspace_collections row (row_version=row_version). On PostgreSQL this
 *     takes the row lock, so all concurrent mutations to one collection
 *     serialize; the capacity count inside a later INSERT..SELECT is then
 *     exact. Two simultaneous adds at limit-1 land as exactly one insert.
 *  2. MUTATION-TIME ACTOR PREDICATE: the same UPDATE re-checks the actor's
 *     authority INSIDE the transaction (owner / current org manager / staff
 *     assignment for the action) — a revoke between preflight and mutation
 *     denies the late mutation with 0 changes, never a forbidden write.
 *  3. CAPACITY IN THE SAME BOUNDARY: the count guard lives inside the
 *     INSERT..SELECT WHERE clause, never in a separate read.
 *  4. MARKER-GATED SIDE EFFECTS: audit rows are inserted only where the
 *     affected row carries THIS command's random operation id — a failed
 *     mutation writes no audit row; a retry writes no duplicate.
 *
 * Structural capacities (engineering bounds on working sets, NOT commercial
 * terms — pricing/product caps remain owner-gated):
 *   MAX_HORSES_PER_COLLECTION      — herd working-set bound per collection
 *   MAX_ACTIVE_STAFF_PER_COLLECTION — delegated-staff bound per collection
 *   MAX_COLLECTIONS_WITH_PLAN      — upper bound with an active farm plan
 *   (the free tier keeps FREE_WORKSPACE_LIMIT collections, catalog.ts)
 *
 * Archive semantics: deleteWorkspace only sets deleted_at (soft). Historical
 * task/financial evidence rows are never deleted; every mutation statement
 * requires deleted_at IS NULL, so an archived workspace accepts no new work.
 * Export policy: export is authorized ONLY while the workspace is active
 * (the authorize path 404s archived collections) and projects registry-safe
 * fields only (formula-neutralized, structurally quoted CSV).
 */
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { CURRENT_MEMBERSHIP_PREDICATE } from "../organizations/membershipPolicy";
import { workspaceAuthority, type WorkspaceAction, type WorkspacePolicyOptions } from "./policy";
import { grantScopeSqlLiteral, type AcceptedGrantScope } from "../commerce/entitlementScope";
import { isValidDay, isValidTimezone, parseStaffActions, WORKSPACE_TASK_CATEGORIES } from "./domain";
export { workspaceAuthority } from "./policy";
export type { WorkspaceAction } from "./policy";

export const MAX_HORSES_PER_COLLECTION = 200;
export const MAX_ACTIVE_STAFF_PER_COLLECTION = 50;
export const MAX_COLLECTIONS_WITH_PLAN = 25;

/** Statement 1 of every mutation batch: row lock + mutation-time authority.
 * 0 changes = denied (late mutation, revoked access, archived workspace).
 * The AS alias makes the shared authority predicate reference the row being
 * locked; UPDATE ... AS is portable SQLite/D1 + PostgreSQL syntax. */
export function lockWorkspaceStatement(db: D1Database, input: { collectionId: number; userId: string; action: WorkspaceAction; policy?: WorkspacePolicyOptions }): D1PreparedStatement[] {
  const auth = workspaceAuthority(input.userId, input.action, input.policy);
  return [db.prepare(`
    UPDATE workspace_collections AS wc SET row_version=wc.row_version, updated_at=wc.updated_at
    WHERE wc.id=? AND wc.deleted_at IS NULL AND ${auth.sql}
  `).bind(input.collectionId, ...auth.binds)];
}

function auditStatement(db: D1Database, input: {
  actorUserId: string; action: string; entityType: string; entityId: string;
  before: unknown; after: unknown; gateSql: string; gateBinds: unknown[];
}): D1PreparedStatement {
  return db.prepare(`
    INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
    SELECT ?,?,?,?,?,?,CURRENT_TIMESTAMP WHERE EXISTS(${input.gateSql})
  `).bind(input.actorUserId, input.action, input.entityType, input.entityId,
    input.before === null ? "null" : JSON.stringify(input.before), JSON.stringify(input.after), ...input.gateBinds);
}

/** Create a collection with the EXACT free/paid capacity in one boundary.
 * The count, the entitlement check and the insert are one statement, so two
 * simultaneous creates cannot both pass a limit check. */
export function createCollectionStatements(db: D1Database, input: {
  name: string; description: string | null; ownerUserId: string;
  organizationId: number | null; operationId: string;
  freeLimit: number; paidLimit: number; entitledHolderKey: string;
  /** R120 (IMP-009 follow-on): the grant scope that counts as the paid plan
   * in this environment. Defaults to 'production' (fail-closed). */
  grantScope?: AcceptedGrantScope;
}): D1PreparedStatement[] {
  const scopeLiteral = grantScopeSqlLiteral(input.grantScope ?? "production");
  const orgGateSql = input.organizationId == null ? "" : `
    AND EXISTS(
      SELECT 1 FROM organization_memberships m JOIN organizations o ON o.id=m.organization_id
      WHERE m.organization_id=? AND m.user_id=? AND m.role IN ('owner','manager')
        AND ${CURRENT_MEMBERSHIP_PREDICATE})`;
  const orgGateBinds = input.organizationId == null ? [] : [input.organizationId, input.ownerUserId];
  return [
    db.prepare("UPDATE users SET is_active=is_active WHERE id=? AND is_active=1").bind(input.ownerUserId),
    db.prepare(`
      INSERT INTO workspace_collections(name,description,owner_user_id,organization_id,creation_operation_id)
      SELECT ?,?,?,?,?
      WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND is_active=1)
        AND (SELECT COUNT(*) FROM workspace_collections WHERE owner_user_id=? AND deleted_at IS NULL) <
        CASE WHEN EXISTS(
          SELECT 1 FROM entitlements WHERE holder_key=? AND sku='farm_workspace_monthly' AND grant_scope=${scopeLiteral} AND active=1
            AND (expires_at IS NULL OR datetime(expires_at)>datetime('now')))
        THEN ? ELSE ? END${orgGateSql}
    `).bind(input.name, input.description, input.ownerUserId, input.organizationId, input.operationId,
      input.ownerUserId, input.ownerUserId, input.entitledHolderKey, input.paidLimit, input.freeLimit, ...orgGateBinds),
    auditStatement(db, {
      actorUserId: input.ownerUserId, action: "workspace.created", entityType: "workspace_collections",
      entityId: "new", before: null, after: { name: input.name, organization_id: input.organizationId },
      gateSql: "SELECT 1 FROM workspace_collections WHERE creation_operation_id=?",
      gateBinds: [input.operationId],
    }),
  ];
}

/** Add ONE horse under the exact per-collection capacity (idempotent). */
export function addHorseStatements(db: D1Database, input: {
  collectionId: number; horseId: number; actorUserId: string; operationId: string;
  action: WorkspaceAction;
}): D1PreparedStatement[] {
  const lock = lockWorkspaceStatement(db, { collectionId: input.collectionId, userId: input.actorUserId, action: input.action });
  const auth = workspaceAuthority(input.actorUserId, input.action);
  return [...lock, db.prepare(`
    INSERT INTO workspace_collection_members(collection_id,horse_id,added_by_user_id,last_operation_id)
    SELECT ?,?,?,? FROM workspace_collections wc
    WHERE wc.id=? AND wc.deleted_at IS NULL AND ${auth.sql}
      AND (SELECT COUNT(*) FROM workspace_collection_members WHERE collection_id=?) < ?
      AND NOT EXISTS(SELECT 1 FROM workspace_collection_members WHERE collection_id=? AND horse_id=?)
    ON CONFLICT(collection_id,horse_id) DO NOTHING
  `).bind(input.collectionId, input.horseId, input.actorUserId, input.operationId,
    input.collectionId, ...auth.binds, input.collectionId, MAX_HORSES_PER_COLLECTION,
    input.collectionId, input.horseId),
  auditStatement(db, {
    actorUserId: input.actorUserId, action: "workspace.horse_added", entityType: "workspace_collection_members",
    entityId: `${input.collectionId}:${input.horseId}`, before: null, after: { horse_id: input.horseId, collection_id: input.collectionId },
    gateSql: "SELECT 1 FROM workspace_collection_members WHERE collection_id=? AND horse_id=? AND last_operation_id=?",
    gateBinds: [input.collectionId, input.horseId, input.operationId],
  })];
}

/** Remove a horse from the working set (mutation-time authority; never
 * touches the canonical horse). */
export function removeHorseStatements(db: D1Database, input: {
  collectionId: number; horseId: number; actorUserId: string;
}): D1PreparedStatement[] {
  const lock = lockWorkspaceStatement(db, { collectionId: input.collectionId, userId: input.actorUserId, action: "manage" });
  const auth = workspaceAuthority(input.actorUserId, "manage");
  return [...lock, db.prepare(`
    DELETE FROM workspace_collection_members
    WHERE collection_id=? AND horse_id=? AND EXISTS(
      SELECT 1 FROM workspace_collections wc WHERE wc.id=? AND wc.deleted_at IS NULL AND ${auth.sql})
  `).bind(input.collectionId, input.horseId, input.collectionId, ...auth.binds)];
}

/** Upsert a staff assignment with the exact active-staff capacity. Updating
 * an EXISTING assignment is always allowed (it adds nobody); a NEW staff
 * member must fit under MAX_ACTIVE_STAFF_PER_COLLECTION. */
export function assignStaffStatements(db: D1Database, input: {
  collectionId: number; userId: string; actions: string; actorUserId: string; operationId: string;
}): D1PreparedStatement[] {
  const parsedActions = parseStaffActions(input.actions);
  if (!parsedActions.ok) throw new RangeError(parsedActions.reason);
  const canonicalActions = parsedActions.actions.join(",");
  const lock = lockWorkspaceStatement(db, { collectionId: input.collectionId, userId: input.actorUserId, action: "manage" });
  const auth = workspaceAuthority(input.actorUserId, "manage");
  return [...lock, db.prepare(`
    INSERT INTO workspace_staff_assignments(collection_id,user_id,actions,granted_by_user_id,last_operation_id)
    SELECT ?,?,?,?,? FROM workspace_collections wc
    WHERE wc.id=? AND wc.deleted_at IS NULL AND ${auth.sql}
      AND (
        EXISTS(SELECT 1 FROM workspace_staff_assignments x WHERE x.collection_id=? AND x.user_id=? AND x.status='active')
        OR (SELECT COUNT(*) FROM workspace_staff_assignments WHERE collection_id=? AND status='active') < ?
      )
      AND EXISTS(SELECT 1 FROM users u WHERE u.id=? AND u.is_active=1)
    ON CONFLICT(collection_id,user_id) DO UPDATE SET
      actions=excluded.actions, status='active', revoked_at=NULL, revoked_by_user_id=NULL,
      granted_at=CURRENT_TIMESTAMP, last_operation_id=excluded.last_operation_id
  `).bind(input.collectionId, input.userId, canonicalActions, input.actorUserId, input.operationId,
    input.collectionId, ...auth.binds, input.collectionId, input.userId,
    input.collectionId, MAX_ACTIVE_STAFF_PER_COLLECTION, input.userId),
  auditStatement(db, {
    actorUserId: input.actorUserId, action: "workspace.staff_assigned", entityType: "workspace_staff_assignments",
    entityId: String(input.collectionId), before: null, after: { user_id: input.userId, actions: input.actions.split(",") },
    gateSql: "SELECT 1 FROM workspace_staff_assignments WHERE collection_id=? AND user_id=? AND last_operation_id=?",
    gateBinds: [input.collectionId, input.userId, input.operationId],
  })];
}

/** Revoke a staff assignment. The audit row is written ONLY for a CURRENT
 * successful change (this operation's marker on a now-revoked row) — a
 * failed revoke (already revoked / unknown user) writes nothing. */
export function revokeStaffStatements(db: D1Database, input: {
  collectionId: number; userId: string; actorUserId: string; operationId: string;
}): D1PreparedStatement[] {
  const lock = lockWorkspaceStatement(db, { collectionId: input.collectionId, userId: input.actorUserId, action: "manage", policy: { allowExpiredProtection: true } });
  const auth = workspaceAuthority(input.actorUserId, "manage", { allowExpiredProtection: true });
  return [...lock,
    db.prepare(`
      UPDATE workspace_staff_assignments
      SET status='revoked', revoked_at=CURRENT_TIMESTAMP, revoked_by_user_id=?, last_operation_id=?
      WHERE collection_id=? AND user_id=? AND status='active'
        AND EXISTS(SELECT 1 FROM workspace_collections wc WHERE wc.id=workspace_staff_assignments.collection_id
          AND wc.deleted_at IS NULL AND ${auth.sql})
    `).bind(input.actorUserId, input.operationId, input.collectionId, input.userId, ...auth.binds),
    auditStatement(db, {
      actorUserId: input.actorUserId, action: "workspace.staff_revoked", entityType: "workspace_staff_assignments",
      entityId: String(input.collectionId), before: { user_id: input.userId, status: "active" }, after: { user_id: input.userId, status: "revoked" },
      gateSql: "SELECT 1 FROM workspace_staff_assignments WHERE collection_id=? AND user_id=? AND status='revoked' AND last_operation_id=?",
      gateBinds: [input.collectionId, input.userId, input.operationId],
    })];
}

/** Create a task with the mutation-time predicate and a marker-gated audit
 * row; the deterministic occurrence_key keeps retries idempotent. */
export function createTaskStatements(db: D1Database, input: {
  collectionId: number; horseId: number | null; title: string; category: string;
  dueDate: string; recurrence: string; recurrenceIntervalDays: number | null;
  actorUserId: string; assignedToUserId: string | null; occurrenceKey: string; operationId: string;
  dueTimezone?: string;
  /** R108-08: durable import receipt — the client import intent that accepted
   * this row. NULL for every manual creation; set only by task import. */
  importIntentKey?: string | null;
}): D1PreparedStatement[] {
  if (!isValidDay(input.dueDate) || !isValidTimezone(input.dueTimezone ?? "Asia/Tehran")) throw new RangeError("Valid day and timezone required");
  if (!WORKSPACE_TASK_CATEGORIES.has(input.category) || !input.title.trim() || input.title.length > 300) throw new RangeError("Valid bounded reminder required");
  if (input.recurrence !== "none" && (input.recurrence !== "custom_days" || !Number.isSafeInteger(input.recurrenceIntervalDays) || Number(input.recurrenceIntervalDays) < 1 || Number(input.recurrenceIntervalDays) > 3650)) throw new RangeError("Valid recurrence interval required");
  const assignee = input.assignedToUserId == null ? null : workspaceAuthority(input.assignedToUserId, "view");
  const assigneeSql = assignee ? `AND ${assignee.sql}` : "";
  const lock = lockWorkspaceStatement(db, { collectionId: input.collectionId, userId: input.actorUserId, action: "tasks_manage" });
  const auth = workspaceAuthority(input.actorUserId, "tasks_manage");
  return [...lock, db.prepare(`
    INSERT INTO workspace_tasks(collection_id,horse_id,title,category,due_date,recurrence,recurrence_interval_days,created_by_user_id,assigned_to_user_id,occurrence_key,occurrence_index,last_operation_id,due_timezone,import_intent_key)
    SELECT ?,?,?,?,?,?,?,?,?,?,0,?,?,? FROM workspace_collections wc
    WHERE wc.id=? AND wc.deleted_at IS NULL AND ${auth.sql} ${assigneeSql}
      AND (CAST(? AS INTEGER) IS NULL OR EXISTS(SELECT 1 FROM workspace_collection_members cm JOIN horses h ON h.id=cm.horse_id AND h.deleted_at IS NULL
        WHERE cm.collection_id=wc.id AND cm.horse_id=?))
    ON CONFLICT(occurrence_key) DO NOTHING
  `).bind(input.collectionId, input.horseId, input.title, input.category, input.dueDate,
    input.recurrence, input.recurrenceIntervalDays, input.actorUserId, input.assignedToUserId,
    input.occurrenceKey, input.operationId, input.dueTimezone ?? "Asia/Tehran", input.importIntentKey ?? null, input.collectionId, ...auth.binds, ...(assignee?.binds ?? []), input.horseId, input.horseId),
  auditStatement(db, {
    actorUserId: input.actorUserId, action: "workspace.task_created", entityType: "workspace_tasks",
    entityId: input.occurrenceKey, before: null, after: { title: input.title, category: input.category, due_date: input.dueDate },
    gateSql: "SELECT 1 FROM workspace_tasks WHERE occurrence_key=? AND last_operation_id=?",
    gateBinds: [input.occurrenceKey, input.operationId],
  })];
}

/** Archive (soft delete): sets deleted_at; historical task/financial rows are
 * retained; the marker-gated audit fires only for THIS successful archive. */
export function archiveWorkspaceStatements(db: D1Database, input: {
  collectionId: number; actorUserId: string; operationId: string;
}): D1PreparedStatement[] {
  const lock = lockWorkspaceStatement(db, { collectionId: input.collectionId, userId: input.actorUserId, action: "manage", policy: { allowExpiredProtection: true } });
  const auth = workspaceAuthority(input.actorUserId, "manage", { allowExpiredProtection: true });
  return [...lock,
    db.prepare(`
      UPDATE workspace_collections AS wc SET deleted_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP, last_operation_id=?
      WHERE wc.id=? AND wc.deleted_at IS NULL AND ${auth.sql}
    `).bind(input.operationId, input.collectionId, ...auth.binds),
    auditStatement(db, {
      actorUserId: input.actorUserId, action: "workspace.deleted", entityType: "workspace_collections",
      entityId: String(input.collectionId), before: { id: input.collectionId }, after: { id: input.collectionId, deleted: true },
      gateSql: "SELECT 1 FROM workspace_collections WHERE id=? AND deleted_at IS NOT NULL AND last_operation_id=?",
      gateBinds: [input.collectionId, input.operationId],
    })];
}

import { parseUtcTimestamp } from "../../shared/utcTimestamp";
import { initialTaskKey, matchesInitialTask } from "../../workspaces/taskIdentity";
import { workspaceWritableSql, workspaceAuthority, type WorkspacePolicyOptions } from "../../workspaces/policy";
import { authorizeWorkspace } from "../../workspaces/access";
import { acceptedGrantScope } from "../../commerce/entitlementScope";

/** R120 (IMP-009 follow-on): every workspace authorization in this module
 * carries the environment-bound grant scope. The isolated demo environment
 * recognizes its own demo-scope plan; production/test/unknown accept
 * production scope only — a demo or legacy grant never unlocks a gate
 * outside the isolated demo. */
const authorize = (
  env: { DB: import("@cloudflare/workers-types").D1Database } & Record<string, unknown>,
  reader: { userId: string; role: string },
  id: number,
  action: "view" | "tasks_manage" | "export" | "manage",
  options: WorkspacePolicyOptions = {},
) => authorizeWorkspace(env.DB, reader, id, action, { ...options, grantScope: acceptedGrantScope(env as never) });
import { z } from "zod";
import { HttpError, json, readJson } from "../http";
import { requireAuth, requireCsrf } from "../../auth/guards";
import {
  VETERINARY_NOTICE,
  parseStaffActions,
  csvRow,
  nextOccurrence,
  taskOccurrenceKey,
  bucketTasksInZones,
  isValidDay,
  isValidTimezone,
  isOverdueInZone,
  localDateInZone,
} from "../../workspaces/domain";
import { requireMembershipCapability, myOrganizationContexts, type CurrentMembership } from "../../organizations/membershipPolicy";
import { completeTaskStatements } from "../../workspaces/commands";
import {
  createCollectionStatements, addHorseStatements, removeHorseStatements,
  assignStaffStatements, revokeStaffStatements, createTaskStatements,
  archiveWorkspaceStatements, MAX_COLLECTIONS_WITH_PLAN,
} from "../../workspaces/mutationCommands";
import { FREE_WORKSPACE_LIMIT } from "../../commerce/catalog";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * R88 agent plan P14 — farm workspace collections and delegated daily work.
 *
 * Boundary rules (each pinned by tests):
 *  - A private collection is a WORKING SET, never ownership: no handler here
 *    writes horse_people or horse_access_grants; adding a horse to two
 *    collections changes no ownership assertion.
 *  - Staff access is action-scoped (view / tasks_manage / export) and
 *    re-authorized LIVE at every read — a revoked assignment loses all
 *    access on the next request (same doctrine as P12 managers).
 *  - Tasks are user-entered reminders with mechanical recurrence; the
 *    veterinary category carries the qualified-person notice everywhere.
 *  - Deleting a collection removes memberships and tasks, never horses.
 *  - CSV export is formula-injection protected and contains no private
 *    contact or genetics data — registry-safe fields only.
 */

type Env = { DB: D1Database; SESSION_COOKIE_NAME: string };

const COLLECTION_NAME_MAX = 120;
const TASK_TITLE_MAX = 200;
const BULK_LIMIT = 50;

interface WorkspaceRow {
  id: number;
  name: string;
  description: string | null;
  owner_user_id: string;
  organization_id: number | null;
  first_dashboard_view_at: string | null;
  row_version: number;
  created_at: string;
  deleted_at: string | null;
}

async function workspaceManagerOf(db: D1Database, userId: string, organizationId: number): Promise<CurrentMembership> {
  // One predicate, one policy: the centralized membership policy decides
  // who may create/manage organization workspaces (write-time check).
  return requireMembershipCapability(db, userId, organizationId, "workspace_manager");
}

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

const CreateCollectionSchema = z.object({
  name: z.string().trim().min(2).max(COLLECTION_NAME_MAX),
  description: z.string().trim().max(500).nullable().optional(),
  organization_id: z.number().int().positive().nullable().optional(),
});

export async function createWorkspace(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  const parsed = CreateCollectionSchema.safeParse(await readJson<unknown>(request, 8 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_workspace", "Workspace failed validation", parsed.error.flatten());
  const d = parsed.data;
  if (d.organization_id != null) {
    try {
      await workspaceManagerOf(env.DB, auth.user.id, d.organization_id);
    } catch {
      throw new HttpError(403, "not_org_manager", "Only a current owner/manager of the organization can create its workspace. Memberships are checked live; expired, revoked and future memberships grant nothing.");
    }
  }
  // R95-N08: the free/paid capacity check, the entitlement check and the
  // insert are ONE statement — two simultaneous creates cannot both pass a
  // limit. Existing workspaces are never touched by the gate.
  const entitledHolderKey = d.organization_id != null ? `org:${d.organization_id}` : `user:${auth.user.id}`;
  const operationId = crypto.randomUUID();
  const [, insert] = await env.DB.batch(createCollectionStatements(env.DB, {
    name: d.name, description: d.description ?? null, ownerUserId: auth.user.id,
    organizationId: d.organization_id ?? null, operationId,
    freeLimit: FREE_WORKSPACE_LIMIT, paidLimit: MAX_COLLECTIONS_WITH_PLAN, entitledHolderKey,
    grantScope: acceptedGrantScope(env),
  }));
  if (Number(insert?.meta.changes ?? 0) !== 1) {
    // Refuse with the honest reason: free tier vs paid cap vs org capability.
    const owned = await env.DB.prepare("SELECT COUNT(*) AS n FROM workspace_collections WHERE owner_user_id=? AND deleted_at IS NULL").bind(auth.user.id).first<{ n: number }>();
    const count = Number(owned?.n ?? 0);
    if (count >= MAX_COLLECTIONS_WITH_PLAN) {
      throw new HttpError(409, "workspace_limit_reached", `The workspace collection limit (${MAX_COLLECTIONS_WITH_PLAN} with an active farm plan) is reached. Existing workspaces are untouched.`);
    }
    throw new HttpError(402, "entitlement_required", `The free tier includes ${FREE_WORKSPACE_LIMIT} workspace collection. Additional collections require an active farm workspace plan. Your existing workspaces are untouched.`);
  }
  const id = Number(insert?.meta.last_row_id ?? 0);
  return json({
    created: true,
    workspace: { id, name: d.name, organization_id: d.organization_id ?? null },
    ownership_note: "A private herd collection is a working set, not an ownership claim. Adding horses here changes no registry ownership assertion.",
  }, { status: 201 });
}

export async function myWorkspaces(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  const owned = await env.DB.prepare(`
    SELECT * FROM workspace_collections WHERE owner_user_id=? AND deleted_at IS NULL ORDER BY id DESC LIMIT 100
  `).bind(auth.user.id).all<WorkspaceRow>();
  const staff = await env.DB.prepare(`
    SELECT wc.*, wsa.actions AS staff_actions
    FROM workspace_collections wc
    JOIN workspace_staff_assignments wsa ON wsa.collection_id=wc.id AND wsa.user_id=? AND wsa.status='active'
    WHERE wc.deleted_at IS NULL
    ORDER BY wc.id DESC LIMIT 100
  `).bind(auth.user.id).all<WorkspaceRow & { staff_actions: string }>();
  // R95-N07: organization contexts — ONLY current workspace-manager memberships
  // surface org workspaces; an ordinary member (role 'member') sees none, and a
  // past payer/manager sees none until their membership is current again.
  const contexts = await myOrganizationContexts(env.DB, auth.user.id);
  const managerOrgIds = contexts.filter((c) => c.capabilities.includes("workspace_manager")).map((c) => c.organization_id);
  const organization: Array<WorkspaceRow & { your_role: string }> = [];
  if (managerOrgIds.length > 0) {
    const placeholders = managerOrgIds.map(() => "?").join(",");
    const orgRows = await env.DB.prepare(`
      SELECT * FROM workspace_collections
      WHERE organization_id IN (${placeholders}) AND deleted_at IS NULL AND owner_user_id != ?
      ORDER BY id DESC LIMIT 100
    `).bind(...managerOrgIds, auth.user.id).all<WorkspaceRow>();
    const roleByOrg = new Map(contexts.map((c) => [c.organization_id, c.role]));
    for (const row of orgRows.results ?? []) organization.push({ ...row, your_role: roleByOrg.get(Number(row.organization_id)) ?? "manager" });
  }
  const visibleOwned = (owned.results ?? []).filter((row) => row.organization_id == null || managerOrgIds.includes(row.organization_id));
  const managedIds = new Set([...visibleOwned, ...organization].map((row) => row.id));
  // R96 integration fix (tsc, their env ran syntax checks only): parseStaffActions
  // returns a discriminated union; listing must fail closed — an assignment with
  // an invalid action grant is not shown as a view-capable workspace (F16).
  const visibleStaff = (staff.results ?? []).filter((row) => {
    if (managedIds.has(row.id)) return false;
    const parsed = parseStaffActions(row.staff_actions);
    return parsed.ok && parsed.actions.includes("view");
  });
  const staffActionsBy = new Map<number, string>((staff.results ?? []).map((row) => {
    const parsed = parseStaffActions(row.staff_actions);
    return [row.id, parsed.ok ? parsed.actions.join(",") : ""];
  }));
  return json({
    owned: visibleOwned.map((row) => projectWorkspace(row, "owner")),
    staff: visibleStaff.map((row) => ({ ...projectWorkspace(row, "staff"), granted_actions: (staffActionsBy.get(row.id) ?? "").split(",").filter(Boolean) })),
    organization: organization.map((row) => ({ ...projectWorkspace(row, "manager"), your_role: row.your_role })),
    organization_contexts: contexts,
    membership_note: "Organization workspaces appear only for CURRENT owner/manager memberships. Ordinary members do not see private organization workspaces here; an assignment (if any) appears under staff.",
  });
}

function projectWorkspace(row: WorkspaceRow, role: "owner" | "staff" | "manager") {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    organization_id: row.organization_id,
    role,
    row_version: row.row_version,
    created_at: row.created_at,
  };
}

export async function workspaceDashboard(request: Request, env: Env, id: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  const access = await authorize(env, { userId: auth.user.id, role: auth.user.role }, id, "view");
  const collection = await env.DB.prepare("SELECT * FROM workspace_collections WHERE id=?").bind(id).first<WorkspaceRow>();

  // Time-to-first-useful-herd-view instrumentation: set ONCE (CAS).
  if (collection && !collection.first_dashboard_view_at) {
    await env.DB.prepare(`
      UPDATE workspace_collections SET first_dashboard_view_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND first_dashboard_view_at IS NULL
    `).bind(id).run();
  }

  const horses = await env.DB.prepare(`
    SELECT h.id, h.name_latin, h.name_native, h.sex_desc AS sex, h.birth_date, h.updated_at
    FROM workspace_collection_members wcm
    JOIN horses h ON h.id=wcm.horse_id
    WHERE wcm.collection_id=? AND h.deleted_at IS NULL
    ORDER BY h.name_latin LIMIT 500
  `).bind(id).all<Record<string, unknown>>();

  const tasks = await env.DB.prepare(`
    SELECT id, horse_id, title, category, due_date, due_timezone, recurrence, status, assigned_to_user_id, occurrence_key, row_version
    FROM workspace_tasks WHERE collection_id=? AND status='open' ORDER BY due_date,id LIMIT 501
  `).bind(id).all<{ due_date: string; due_timezone?: string; status: string; category: string; [key: string]: unknown }>();

  const staff = await env.DB.prepare(`
    SELECT user_id, actions, granted_at, status FROM workspace_staff_assignments WHERE collection_id=? AND status='active'
  `).bind(id).all<{ user_id: string; actions: string; granted_at: string; status: string }>();

  // R96-N09: due/overdue are computed in EACH TASK's own timezone — a
  // reminder due "2026-10-05" in Asia/Tehran is not late just because the
  // server's UTC calendar rolled over; the local date in the task's zone
  // decides. (Tasks from before N09 default to Asia/Tehran; the zone rides
  // the SAME query — no per-task re-read.)
  const nowIso = new Date().toISOString();
  const taskRows: Array<{ due_date: string; due_timezone: string; status: string; category: string; [key: string]: unknown }>=(tasks.results ?? []).slice(0,500).map(task=>({...task,due_date:String(task.due_date).slice(0,10),due_timezone:task.due_timezone || "Asia/Tehran",status:String(task.status)}));
  const buckets = bucketTasksInZones(taskRows,nowIso);
  const plan=await env.DB.prepare(`SELECT CASE WHEN ${workspaceWritableSql(acceptedGrantScope(env))} THEN 1 ELSE 0 END AS writable FROM workspace_collections wc WHERE wc.id=? AND wc.deleted_at IS NULL`).bind(id).first<{writable:number}>();
  const writable=Number(plan?.writable)===1;
  const withNotice = (tasksIn: Array<{ category: string; [key: string]: unknown }>) =>
    tasksIn.map((task) => ({ ...task, veterinary_notice: task.category === "veterinary_appointment" ? VETERINARY_NOTICE : undefined }));

  return json({
    workspace: collection ? { ...projectWorkspace(collection, access.as), granted_actions: writable ? access.actions : access.actions.filter(action=>action!=="manage"&&action!=="tasks_manage"), writable, protective_actions:access.actions.includes("manage")?["revoke_staff","archive"]:[] } : null,
    herd_size: (horses.results ?? []).length,
    horses: horses.results ?? [],
    tasks: {
      overdue: withNotice(buckets.overdue),
      due_soon: withNotice(buckets.dueSoon),
      later: withNotice(buckets.later),
      invalid: withNotice(buckets.invalid),
    },
    tasks_truncated:(tasks.results ?? []).length>500,
    task_limit:500,
    active_staff: (staff.results ?? []).map((row) => ({ user_id: row.user_id, actions: row.actions.split(","), granted_at: row.granted_at })),
    notes: [
      "A private herd collection is a working set, not an ownership claim.",
      VETERINARY_NOTICE,
    ],
  });
}

// ---------------------------------------------------------------------------
// Membership (working set — never ownership)
// ---------------------------------------------------------------------------

export async function addWorkspaceHorse(request: Request, env: Env, id: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  await authorize(env, { userId: auth.user.id, role: auth.user.role }, id, "manage");
  const parsed = z.object({ horse_id: z.number().int().positive() }).safeParse(await readJson<unknown>(request, 4 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_member", "horse_id is required");
  const horse = await env.DB.prepare("SELECT id FROM horses WHERE id=? AND deleted_at IS NULL").bind(parsed.data.horse_id).first();
  if (!horse) throw new HttpError(404, "horse_not_found", "Horse not found in the registry");
  // R95-N08: row lock + mutation-time authority + exact capacity in one batch.
  const results = await env.DB.batch(addHorseStatements(env.DB, {
    collectionId: id, horseId: parsed.data.horse_id, actorUserId: auth.user.id,
    operationId: crypto.randomUUID(), action: "manage",
  }));
  const inserted = Number(results[1]?.meta.changes ?? 0);
  if (inserted !== 1) {
    const existing = await env.DB.prepare("SELECT id FROM workspace_collection_members WHERE collection_id=? AND horse_id=?").bind(id, parsed.data.horse_id).first();
    if (existing) return json({ added: true, idempotent_replay: true, horse_id: parsed.data.horse_id, ownership_note: "Already in this private working set; nothing duplicated." });
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM workspace_collection_members WHERE collection_id=?").bind(id).first<{ n: number }>();
    throw new HttpError(409, "herd_capacity_reached", `This working set is at its capacity (${Number(count?.n ?? 0)} horses). Removing a horse makes room; the registry itself is unaffected.`);
  }
  return json({
    added: true,
    horse_id: parsed.data.horse_id,
    ownership_note: "Added to this private working set only. No ownership assertion was created or changed.",
  }, { status: 201 });
}

const BulkSchema = z.object({
  add: z.array(z.number().int().positive()).max(BULK_LIMIT).default([]),
  remove: z.array(z.number().int().positive()).max(BULK_LIMIT).default([]),
});

export async function bulkWorkspaceHorses(request: Request, env: Env, id: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  await authorize(env, { userId: auth.user.id, role: auth.user.role }, id, "manage");
  const parsed = BulkSchema.safeParse(await readJson<unknown>(request, 32 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_bulk", `Bulk operation failed validation (max ${BULK_LIMIT} per direction)`, parsed.error.flatten());
  // R95-N08: every add carries the exact-capacity guard; removes carry the
  // mutation-time authority. One batch = one transaction.
  const statements: ReturnType<typeof addHorseStatements>[number][] = [];
  const insertIndexes: number[] = [];
  const removeIndexes: number[] = [];
  for (const horseId of parsed.data.add) {
    insertIndexes.push(statements.length + 1); // +1: the lock UPDATE comes first
    statements.push(...addHorseStatements(env.DB, { collectionId: id, horseId, actorUserId: auth.user.id, operationId: crypto.randomUUID(), action: "manage" }));
  }
  for (const horseId of parsed.data.remove) {
    removeIndexes.push(statements.length + 1); // +1: the lock UPDATE comes first
    statements.push(...removeHorseStatements(env.DB, { collectionId: id, horseId, actorUserId: auth.user.id }));
  }
  const results = statements.length > 0 ? await env.DB.batch(statements) : [];
  const added = insertIndexes.reduce((sum, i) => sum + Number(results[i]?.meta.changes ?? 0), 0);
  const removed = removeIndexes.reduce((sum, i) => sum + Number(results[i]?.meta.changes ?? 0), 0);
  const requestedAdd = parsed.data.add.length;
  const finalCount = await env.DB.prepare("SELECT COUNT(*) AS n FROM workspace_collection_members WHERE collection_id=?").bind(id).first<{ n: number }>();
  return json({
    bulk: true,
    requested_add: requestedAdd,
    added,
    requested_remove: parsed.data.remove.length,
    removed,
    herd_size: Number(finalCount?.n ?? 0),
    ...(added < requestedAdd ? { partial_note: "Some horses were not added: they were already in the working set or the capacity limit stopped the remainder. Nothing was force-added." } : {}),
    note: "Bulk membership only. Canonical horses are never modified, and removing a horse from a collection never deletes the horse.",
  });
}

export async function removeWorkspaceHorse(request: Request, env: Env, id: number, horseId: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  await authorize(env, { userId: auth.user.id, role: auth.user.role }, id, "manage");
  const results = await env.DB.batch(removeHorseStatements(env.DB, { collectionId: id, horseId, actorUserId: auth.user.id }));
  const removed = Number(results[1]?.meta.changes ?? 0) === 1;
  return json({ removed, horse_id: horseId, note: removed ? "Removed from this working set only. The canonical horse record is untouched." : "The horse was not in this working set; nothing changed." });
}

// ---------------------------------------------------------------------------
// Staff assignments (action-scoped, live revocation)
// ---------------------------------------------------------------------------

export async function assignWorkspaceStaff(request: Request, env: Env, id: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  await authorize(env, { userId: auth.user.id, role: auth.user.role }, id, "manage");
  const parsed = z.object({
    user_id: z.string().min(3).max(64),
    actions: z.string().min(3).max(60),
  }).safeParse(await readJson<unknown>(request, 4 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_assignment", "user_id and actions are required");
  const actions = parseStaffActions(parsed.data.actions);
  if (!actions.ok) throw new HttpError(400, "invalid_actions", actions.reason);
  if (parsed.data.user_id === auth.user.id) {
    throw new HttpError(400, "not_self", "The owner already has full access; self-assignment is not a staff grant");
  }
  const user = await env.DB.prepare("SELECT id FROM users WHERE id=? AND is_active=1").bind(parsed.data.user_id).first();
  if (!user) throw new HttpError(404, "user_not_found", "User not found");
  // R95-N08: exact active-staff capacity + mutation-time authority; the
  // audit row is marker-gated so a retry writes no duplicate.
  const results = await env.DB.batch(assignStaffStatements(env.DB, {
    collectionId: id, userId: parsed.data.user_id, actions: actions.actions.join(","),
    actorUserId: auth.user.id, operationId: crypto.randomUUID(),
  }));
  if (Number(results[1]?.meta.changes ?? 0) !== 1) {
    const active = await env.DB.prepare("SELECT COUNT(*) AS n FROM workspace_staff_assignments WHERE collection_id=? AND status='active'").bind(id).first<{ n: number }>();
    throw new HttpError(409, "staff_capacity_reached", `This workspace already has ${Number(active?.n ?? 0)} active staff members (its limit). Revoke an assignment to make room.`);
  }
  return json({ assigned: true, user_id: parsed.data.user_id, actions: actions.actions, note: "Access is action-scoped and re-checked live; revocation takes effect on the staff member's next request." }, { status: 201 });
}

export async function revokeWorkspaceStaff(request: Request, env: Env, id: number, userId: string): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  await authorize(env, { userId: auth.user.id, role: auth.user.role }, id, "manage", { allowExpiredProtection: true });
  // R95-N08: the audit row is written ONLY for a current successful revoke
  // (marker-gated) — a failed revoke (already revoked / unknown user) leaves
  // no misleading trail. Unrelated staff and historical attribution stay.
  const operationId = crypto.randomUUID();
  const statements = revokeStaffStatements(env.DB, { collectionId: id, userId, actorUserId: auth.user.id, operationId });
  const suppressionIndex = statements.length;
  const results = await env.DB.batch([
    ...statements, suppressQueuedWorkspaceNotificationsStatement(env.DB, userId, id, operationId),
  ]);
  if (Number(results[1]?.meta.changes ?? 0) !== 1) {
    throw new HttpError(409, "not_active", "No active assignment for this user on this workspace");
  }
  return json({ revoked: true, user_id: userId, queued_notifications_suppressed: Number(results[suppressionIndex]?.meta.changes ?? 0), note: "Workspace access is re-checked live. Queued reminders from this workspace are suppressed atomically with this revocation; unrelated workspaces are unchanged." });
}

// ---------------------------------------------------------------------------
// Tasks / reminders
// ---------------------------------------------------------------------------

const CreateTaskSchema = z.object({
  horse_id: z.number().int().positive().nullable().optional(),
  title: z.string().trim().min(3).max(TASK_TITLE_MAX),
  category: z.enum(["document_renewal", "farrier", "veterinary_appointment", "other"]),
  due_date: z.string().refine(isValidDay, "due_date must be a real Gregorian day in YYYY-MM-DD format"),
  recurrence: z.enum(["none", "custom_days"]).default("none"),
  recurrence_interval_days: z.number().int().min(1).max(3650).nullable().optional(),
  assigned_to_user_id: z.string().min(3).max(64).nullable().optional(),
  due_timezone: z.string().trim().min(1).max(64).default("Asia/Tehran"),
});

export async function createWorkspaceTask(request: Request, env: Env, id: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  // Staff with tasks_manage may create tasks; view-only staff may not.
  // (Owner, org manager and staff roles pass inside authorize.)
  await authorize(env, { userId: auth.user.id, role: auth.user.role }, id, "tasks_manage");
  const parsed = CreateTaskSchema.safeParse(await readJson<unknown>(request, 8 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_task", "Task failed validation", parsed.error.flatten());
  const d = parsed.data;
  if (d.recurrence === "custom_days" && !(d.recurrence_interval_days ?? 0)) {
    throw new HttpError(400, "invalid_recurrence", "custom_days recurrence requires recurrence_interval_days (1-3650)");
  }
  if (!isValidTimezone(d.due_timezone)) {
    throw new HttpError(400, "invalid_timezone", "due_timezone must be a valid IANA timezone name (e.g. Asia/Tehran)");
  }
  if (d.horse_id != null) {
    const member = await env.DB.prepare(
      "SELECT horse_id FROM workspace_collection_members WHERE collection_id=? AND horse_id=?",
    ).bind(id, d.horse_id).first();
    if (!member) throw new HttpError(400, "horse_not_in_workspace", "The horse must be in this workspace before tasks can reference it");
  }
  const identity={collectionId:id,actorUserId:auth.user.id,horseId:d.horse_id ?? null,title:d.title,category:d.category,dueDate:d.due_date,dueTimezone:d.due_timezone,recurrence:d.recurrence,recurrenceIntervalDays:d.recurrence_interval_days ?? null,assignedToUserId:d.assigned_to_user_id ?? null};
  // Preserve a true legacy replay; a different zone/assignee/recurrence is
  // a different intent, not a successful replay of an unrelated task.
  const legacyKey=taskOccurrenceKey(`c${id}:h${d.horse_id ?? "all"}:k${d.category}:${d.title}`,d.due_date,0);
  const legacy=await env.DB.prepare("SELECT * FROM workspace_tasks WHERE collection_id=? AND occurrence_key=?").bind(id,legacyKey).first<Record<string,unknown>>();
  const occurrenceKey=legacy && matchesInitialTask(legacy,identity)?legacyKey:await initialTaskKey(identity);
  // R95-N08: mutation-time authority + marker-gated audit in one batch.
  const results = await env.DB.batch(createTaskStatements(env.DB, {
    collectionId: id, horseId: d.horse_id ?? null, title: d.title, category: d.category,
    dueDate: d.due_date, recurrence: d.recurrence, recurrenceIntervalDays: d.recurrence_interval_days ?? null,
    actorUserId: auth.user.id, assignedToUserId: d.assigned_to_user_id ?? null,
    occurrenceKey, operationId: crypto.randomUUID(), dueTimezone: d.due_timezone,
  }));
  if (Number(results[1]?.meta.changes ?? 0) === 0) {
    // A zero-row write is not proof of replay: the actor, assignment or horse
    // membership may have changed after preflight. Recheck access and the
    // exact persisted occurrence before claiming that anything exists.
    await authorize(env, { userId: auth.user.id, role: auth.user.role }, id, "tasks_manage");
    const existing = await env.DB.prepare(
      "SELECT * FROM workspace_tasks WHERE collection_id=? AND occurrence_key=?",
    ).bind(id, occurrenceKey).first<Record<string,unknown> & {id:number}>();
    if (!existing || !matchesInitialTask(existing,identity)) throw new HttpError(409, "task_not_created", "The workspace changed before the reminder was created; reload and retry");
    return json({ created: true, idempotent_replay: true, task_id: existing.id,
      note: "The same reminder already exists in this workspace; nothing duplicated." });
  }
  return json({
    created: true,
    task: { title: d.title, category: d.category, due_date: d.due_date, due_timezone:d.due_timezone, recurrence: d.recurrence },
    ...(d.category === "veterinary_appointment" ? { veterinary_notice: VETERINARY_NOTICE } : {}),
    note: "A reminder only. Recurring occurrences are mechanical date arithmetic.",
  }, { status: 201 });
}

export async function listWorkspaceTasks(request: Request, env: Env, id: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  await authorize(env, { userId: auth.user.id, role: auth.user.role }, id, "view");
  const url = new URL(request.url);
  const filter = url.searchParams.get("status") ?? "open";
  // R124 (master AI R122-T05): the reminder history is WALKABLE — keyset paging
  // on (due_date, id) ASC replaces the silent 300-row ceiling. ?cursor=
  // <due_date>|<id> resumes strictly AFTER that row in the same ordering, so a
  // large workspace can page through its full history without offset drift.
  // The legacy `tasks` array stays; the page metadata is additive.
  const validFilters = new Set(["open", "done", "all"]);
  if (!validFilters.has(filter)) throw new HttpError(400, "invalid_status", "status must be one of open, done, all");
  const limitRaw = Number(url.searchParams.get("limit") ?? "100");
  if (!Number.isInteger(limitRaw) || limitRaw < 1 || limitRaw > 500) throw new HttpError(400, "invalid_limit", "limit must be an integer between 1 and 500");
  const limit = limitRaw;
  const cursorRaw = url.searchParams.get("cursor");
  let cursorDate: string | null = null;
  let cursorId: number | null = null;
  if (cursorRaw) {
    const match = /^(\d{4}-\d{2}-\d{2})\|(\d+)$/.exec(cursorRaw);
    if (!match) throw new HttpError(400, "invalid_cursor", "cursor must be '<due_date>|<id>' from page.next_cursor");
    cursorDate = match[1];
    cursorId = Number(match[2]);
    if (cursorId < 1) throw new HttpError(400, "invalid_cursor", "cursor id is out of range");
  }
  const statusSql = filter === "all" ? "" : "AND status=?";
  const statusBinds: unknown[] = filter === "all" ? [] : [filter];
  const cursorSql = cursorId != null ? "AND (due_date > ? OR (due_date = ? AND id > ?))" : "";
  const cursorBinds: unknown[] = cursorId != null ? [cursorDate, cursorDate, cursorId] : [];
  const [rows, counts] = await env.DB.batch([
    env.DB.prepare(`SELECT * FROM workspace_tasks WHERE collection_id=? ${statusSql} ${cursorSql} ORDER BY due_date, id LIMIT ?`)
      .bind(id, ...statusBinds, ...cursorBinds, limit + 1),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM workspace_tasks WHERE collection_id=? ${statusSql}`)
      .bind(id, ...statusBinds),
  ]);
  const pageRows = (rows.results ?? []) as Array<{ id: number; due_date: string; [key: string]: unknown }>;
  const hasMore = pageRows.length > limit;
  const page = hasMore ? pageRows.slice(0, limit) : pageRows;
  const total = Number((counts.results?.[0] as { n?: number } | undefined)?.n ?? 0);
  const lastRow = page[page.length - 1];
  const nextCursor = hasMore && lastRow ? `${String(lastRow.due_date ?? "").slice(0, 10)}|${lastRow.id}` : null;
  return json({
    tasks: page.map((task) => ({
      ...task,
      veterinary_notice: task.category === "veterinary_appointment" ? VETERINARY_NOTICE : undefined,
    })),
    page: { limit, returned: page.length, next_cursor: nextCursor, has_more: hasMore, total, status: filter },
  });
}

export async function completeWorkspaceTask(request: Request, env: Env, id: number, taskId: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  await authorize(env, { userId: auth.user.id, role: auth.user.role }, id, "tasks_manage");
  const parsed = z.object({ expected_version: z.number().int().positive() }).safeParse(await readJson<unknown>(request, 4 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_complete", "expected_version is required");
  const task = await env.DB.prepare("SELECT * FROM workspace_tasks WHERE id=? AND collection_id=?").bind(taskId, id)
    .first<{ id: number; status: string; recurrence: string; recurrence_interval_days: number | null; due_date: string; title: string; row_version: number; occurrence_index: number }>();
  if (!task) throw new HttpError(404, "not_found", "Task not found in this workspace");
  if (task.status !== "open") throw new HttpError(409, "already_closed", `Task is already ${task.status}`);

  const next = nextOccurrence({ recurrence: task.recurrence, recurrence_interval_days: task.recurrence_interval_days, due_date: String(task.due_date).slice(0, 10) });
  const [update] = await env.DB.batch(completeTaskStatements(env.DB, {
    collectionId: id, taskId, actorUserId: auth.user.id, expectedVersion: parsed.data.expected_version,
    operationId: crypto.randomUUID(), nextDueDate: next?.dueDate ?? null,
  }));
  if (Number(update?.meta.changes ?? 0) !== 1) {
    await authorize(env, { userId: auth.user.id, role: auth.user.role }, id, "tasks_manage");
    const current = await env.DB.prepare("SELECT row_version FROM workspace_tasks WHERE id=? AND collection_id=?")
      .bind(taskId, id).first<{ row_version: number }>();
    throw new HttpError(409, "stale_version", "The task changed before your edit landed; reload and retry with the current row_version",
      current ? { current_version: Number(current.row_version) } : undefined);
  }
  return json({
    completed: true,
    next_occurrence: next ? { due_date: next.dueDate, interval_days: next.intervalDays } : null,
    ...(task.title && next ? { next_note: "The next occurrence was materialized in the same transaction; a retried request cannot duplicate it." } : {}),
  });
}

// ---------------------------------------------------------------------------
// R117-14 — task reopen (one-shot occurrences only)
// ---------------------------------------------------------------------------

/** Reopen a COMPLETED one-shot reminder. Completion of a recurring occurrence
 * already materialized the next occurrence in the same transaction, so a
 * closed recurring row is refused with an honest explanation (creating two
 * live occurrences of the same reminder would corrupt the working set). The
 * mutation is CAS-guarded like every task write: a stale expected_version is
 * a 409 that carries the current version, never a blind overwrite. */
export async function reopenWorkspaceTask(request: Request, env: Env, id: number, taskId: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  await authorize(env, { userId: auth.user.id, role: auth.user.role }, id, "tasks_manage");
  const parsed = z.object({ expected_version: z.number().int().positive() }).safeParse(await readJson<unknown>(request, 4 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_reopen", "expected_version is required");
  const RECURRING_REFUSAL = "Completing a recurring occurrence already scheduled its next occurrence in the same transaction; reopening the closed row would leave two live occurrences of the same reminder. If the completion was a mistake, complete nothing and create a one-shot reminder for the remaining work instead.";
  const task = await env.DB.prepare("SELECT status, recurrence, row_version FROM workspace_tasks WHERE id=? AND collection_id=?").bind(taskId, id)
    .first<{ status: string; recurrence: string; row_version: number }>();
  if (!task) throw new HttpError(404, "not_found", "Task not found in this workspace");
  if (task.status !== "done") throw new HttpError(409, "not_completed", `Only a completed reminder can be reopened (this one is ${task.status})`);
  if (task.recurrence !== "none") throw new HttpError(409, "recurring_occurrence_completed", RECURRING_REFUSAL);
  const results = await env.DB.batch(reopenTaskStatements(env.DB, {
    collectionId: id, taskId, actorUserId: auth.user.id, expectedVersion: parsed.data.expected_version, operationId: crypto.randomUUID(),
  }));
  // Statement 0 is the collection row lock; statement 1 is the guarded UPDATE.
  if (Number(results[1]?.meta.changes ?? 0) !== 1) {
    // Authority or the row itself may have changed after preflight. Recheck
    // access and report the REAL cause — never the current version to a
    // caller who no longer has access (existence stays hidden).
    await authorize(env, { userId: auth.user.id, role: auth.user.role }, id, "tasks_manage");
    const current = await env.DB.prepare("SELECT status, recurrence, row_version FROM workspace_tasks WHERE id=? AND collection_id=?")
      .bind(taskId, id).first<{ status: string; recurrence: string; row_version: number }>();
    if (!current) throw new HttpError(404, "not_found", "Task not found in this workspace");
    if (current.status !== "done") throw new HttpError(409, "not_completed", `Only a completed reminder can be reopened (this one is ${current.status})`);
    if (current.recurrence !== "none") throw new HttpError(409, "recurring_occurrence_completed", RECURRING_REFUSAL);
    throw new HttpError(409, "stale_version", "The task changed before your edit landed; reload and retry with the current row_version",
      { current_version: Number(current.row_version) });
  }
  return json({
    reopened: true,
    note: "The completed one-shot reminder is open again with a fresh version; the completion history stays audit-recorded and nothing was duplicated.",
  });
}

// ---------------------------------------------------------------------------
// CSV export (formula-injection protected, registry-safe fields only)
// ---------------------------------------------------------------------------

export async function exportWorkspaceCsv(request: Request, env: Env, id: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  await authorize(env, { userId: auth.user.id, role: auth.user.role }, id, "export");
  const rows = await env.DB.prepare(`
    SELECT h.id, h.name_latin, h.name_native, h.sex_desc AS sex, h.birth_date, h.color_desc AS color, h.breed_desc AS breed
    FROM workspace_collection_members wcm
    JOIN horses h ON h.id=wcm.horse_id
    WHERE wcm.collection_id=? AND h.deleted_at IS NULL
    ORDER BY h.id
  `).bind(id).all<Record<string, unknown>>();
  const header = csvRow(["horse_id", "name_latin", "name_native", "sex", "birth_date", "color", "breed"]);
  const body = (rows.results ?? []).map((row) => csvRow([
    row.id, row.name_latin, row.name_native, row.sex, row.birth_date, row.color, row.breed,
  ]));
  const csv = [header, ...body].join("\n");
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="workspace-${id}-herd.csv"`,
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    },
  });
}

// ---------------------------------------------------------------------------
// Delete (rollback rule: never delete canonical horses)
// ---------------------------------------------------------------------------

export async function deleteWorkspace(request: Request, env: Env, id: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  await authorize(env, { userId: auth.user.id, role: auth.user.role }, id, "manage", { allowExpiredProtection: true });
  // R95-N08: ARCHIVE semantics — a soft delete with the mutation-time
  // authority inside the batch and a marker-gated audit row. Historical
  // task/financial evidence rows are retained (never deleted); every later
  // mutation statement requires deleted_at IS NULL, so an archived
  // workspace accepts no new work.
  const results = await env.DB.batch(archiveWorkspaceStatements(env.DB, {
    collectionId: id, actorUserId: auth.user.id, operationId: crypto.randomUUID(),
  }));
  if (Number(results[1]?.meta.changes ?? 0) !== 1) throw new HttpError(404, "not_found", "Workspace not found");
  return json({
    deleted: true,
    note: "The workspace is archived (soft-deleted): it accepts no new work, and its memberships/tasks are retired from the API. Canonical horse records are NEVER deleted by this action, ownership assertions are unchanged, and historical task/financial evidence is retained.",
  });
}

// ---------------------------------------------------------------------------
// R98-N16 — staff invitations (consent before delegation), documents,
// reassignment, no-overwrite import, and staff-departure notification
// suppression.
// ---------------------------------------------------------------------------

import {
  inviteStaffStatements, acceptStaffInviteStatements, declineStaffInviteStatements, revokeStaffInviteStatements,
  expireStaffInvitesStatements, createDocumentStatements, updateDocumentStatements, archiveDocumentStatements,
  reassignTaskStatements, reopenTaskStatements, suppressQueuedWorkspaceNotificationsStatement,
  inviteExpiryText, WORKSPACE_DOCUMENT_CATEGORIES, MAX_TASK_IMPORT_ROWS, WORKSPACE_INVITE_EXPIRY_DAYS,
  type WorkspaceDocumentCategory,
} from "../../workspaces/collaboration";

const InviteSchema = z.object({
  invitee_user_id: z.string().trim().min(3).max(64),
  actions: z.string().trim().min(3).max(60),
  note: z.string().trim().max(500).nullable().optional(),
});

export async function inviteWorkspaceStaff(request: Request, env: Env, id: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  await authorize(env, { userId: auth.user.id, role: auth.user.role }, id, "manage");
  const parsed = InviteSchema.safeParse(await readJson<unknown>(request, 4 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_invite", "invitee_user_id and actions are required");
  const actions = parseStaffActions(parsed.data.actions);
  if (!actions.ok) throw new HttpError(400, "invalid_actions", actions.reason);
  if (parsed.data.invitee_user_id === auth.user.id) {
    throw new HttpError(400, "not_self", "You cannot invite yourself; the owner already has full access");
  }
  const invitee = await env.DB.prepare("SELECT id FROM users WHERE id=? AND is_active=1").bind(parsed.data.invitee_user_id).first();
  if (!invitee) throw new HttpError(404, "user_not_found", "User not found");
  const operationId = crypto.randomUUID();
  const results = await env.DB.batch(inviteStaffStatements(env.DB, {
    collectionId: id, inviteeUserId: parsed.data.invitee_user_id, proposedActions: actions.actions.join(","),
    actorUserId: auth.user.id, operationId, expiresAtText: inviteExpiryText(new Date()), note: parsed.data.note ?? null,
  }));
  if (Number(results[1]?.meta.changes ?? 0) !== 1) {
    const open = await env.DB.prepare(
      "SELECT 1 FROM workspace_staff_invites WHERE collection_id=? AND invitee_user_id=? AND status='pending'"
    ).bind(id, parsed.data.invitee_user_id).first();
    if (open) throw new HttpError(409, "invite_already_open", "This person already has an open invitation to this workspace");
    throw new HttpError(403, "workspace_authority_required", "Your authority to manage this workspace was removed before the invitation could be created");
  }
  return json({
    invited: true, invitee_user_id: parsed.data.invitee_user_id, actions: actions.actions,
    expires_in_days: WORKSPACE_INVITE_EXPIRY_DAYS,
    note: "The invitee must explicitly accept before any assignment is created. Acceptance re-checks your current authority and the staff capacity at that moment.",
  }, { status: 201 });
}

/** The invitee's own pending invitations across all workspaces. */
export async function myWorkspaceInvites(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  // Sweep expired invites first so the list never shows a dead invitation as open.
  await env.DB.batch(expireStaffInvitesStatements(env.DB));
  const rows = await env.DB.prepare(`
    SELECT i.collection_id, i.proposed_actions, i.note, i.expires_at, i.created_at, wc.name AS workspace_name
    FROM workspace_staff_invites i
    JOIN workspace_collections wc ON wc.id=i.collection_id AND wc.deleted_at IS NULL
    WHERE i.invitee_user_id=? AND i.status='pending'
    ORDER BY i.created_at DESC LIMIT 100`).bind(auth.user.id)
    .all<{ collection_id: number; proposed_actions: string; note: string | null; expires_at: string; created_at: string; workspace_name: string }>();
  return json({ rows: rows.results ?? [], note: "Accepting creates your staff assignment only if the inviter still holds management authority and the workspace has staff capacity." });
}

const InviteResponseSchema = z.object({
  action: z.enum(["accept", "decline"]),
});

/** The INVITEE responds to their own pending invitation. */
export async function respondWorkspaceInvite(request: Request, env: Env, collectionId: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  const parsed = InviteResponseSchema.safeParse(await readJson<unknown>(request, 2 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_response", "action must be accept or decline");
  // A (collection, invitee) may carry CLOSED history (declined/revoked/
  // expired/accepted) beside a FRESH pending invitation — the partial unique
  // index only forbids two OPEN invites. Resolve the invitation being
  // answered deterministically: the PENDING row if one exists, else the most
  // recent closed row (history still yields honest already-responded/expired
  // refusals; a stale declined row can never shadow a fresh invitation —
  // the exact order the partial index design promises).
  const invite = await env.DB.prepare(
    `SELECT status, expires_at, proposed_actions FROM workspace_staff_invites
     WHERE collection_id=? AND invitee_user_id=?
     ORDER BY CASE WHEN status='pending' THEN 0 ELSE 1 END, id DESC LIMIT 1`,
  ).bind(collectionId, auth.user.id).first<{ status: string; expires_at: string; proposed_actions: string }>();
  if (!invite) throw new HttpError(404, "not_found", "No invitation for you on this workspace");
  const expiry = parseUtcTimestamp(invite.expires_at);
  if (invite.status === "expired" || expiry === null || expiry <= Date.now()) {
    throw new HttpError(410, "invite_expired", "This invitation has expired; ask the workspace manager for a fresh one");
  }
  if (invite.status !== "pending") throw new HttpError(409, "already_responded", `This invitation is already ${invite.status}`);
  const operationId = crypto.randomUUID();
  const results = parsed.data.action === "accept"
    ? await env.DB.batch(acceptStaffInviteStatements(env.DB, { collectionId, inviteeUserId: auth.user.id, actorUserId: auth.user.id, operationId }))
    : await env.DB.batch(declineStaffInviteStatements(env.DB, { collectionId, inviteeUserId: auth.user.id, actorUserId: auth.user.id, operationId }));
  if (parsed.data.action === "accept" && Number(results[1]?.meta.changes ?? 0) !== 1) {
    throw new HttpError(409, "invite_not_acceptable", "The invitation could not be accepted: the inviter's authority or the workspace staff capacity changed. Ask the workspace manager for a fresh invitation.");
  }
  if (parsed.data.action === "decline" && Number(results[0]?.meta.changes ?? 0) !== 1) {
    throw new HttpError(409, "already_responded", "The invitation changed before your response landed; reload its current state");
  }
  return json({
    accepted: parsed.data.action === "accept",
    actions: parsed.data.action === "accept" ? invite.proposed_actions.split(",") : null,
    note: parsed.data.action === "accept"
      ? "Your staff assignment is active. Authorization is re-checked live on every request; a later revoke takes effect immediately."
      : "The invitation is declined. No assignment was created.",
  });
}

/** The inviter side revokes an open invitation. */
export async function revokeWorkspaceInvite(request: Request, env: Env, id: number, userId: string): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  await authorize(env, { userId: auth.user.id, role: auth.user.role }, id, "manage");
  const results = await env.DB.batch(revokeStaffInviteStatements(env.DB, {
    collectionId: id, inviteeUserId: userId, actorUserId: auth.user.id, operationId: crypto.randomUUID(),
  }));
  if (Number(results[1]?.meta.changes ?? 0) !== 1) {
    throw new HttpError(409, "not_pending", "No open invitation for this user on this workspace");
  }
  return json({ revoked: true, note: "The invitation is revoked before any assignment existed." });
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

const DocumentSchema = z.object({
  horse_id: z.number().int().positive().nullable().optional(),
  title: z.string().trim().min(1).max(300),
  category: z.enum(WORKSPACE_DOCUMENT_CATEGORIES),
  note: z.string().trim().max(2000).nullable().optional(),
  expires_at: z.string().trim().refine(isValidDay, "expires_at must be a real Gregorian day (YYYY-MM-DD)").nullable().optional(),
});

// R108-08: a document's horse association is FIXED AT CREATION. The update
// DTO still accepts horse_id for client round-trips, but the value must EQUAL
// the stored association — a different value is a deterministic 409 with NO
// mutation (the field is not silently ignored, and no unauthorized move exists).
const DocumentUpdateSchema = DocumentSchema.extend({
  horse_id: z.number().int().positive().nullable().optional(),
  expected_version: z.number().int().min(1),
});

export async function listWorkspaceDocuments(request: Request, env: Env, id: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  await authorize(env, { userId: auth.user.id, role: auth.user.role }, id, "view");
  const url = new URL(request.url);
  const includeArchived = url.searchParams.get("all") === "1";
  const rows = await env.DB.prepare(`
    SELECT d.id, d.horse_id, d.title, d.category, d.note, d.expires_at, d.status, d.row_version, d.created_at, d.updated_at
    FROM workspace_documents d
    WHERE d.collection_id=? ${includeArchived ? "" : "AND d.status='active'"}
    ORDER BY d.expires_at IS NULL, d.expires_at, d.title LIMIT 500`).bind(id)
    .all<Record<string, unknown>>();
  return json({
    rows: rows.results ?? [],
    veterinary_notice: VETERINARY_NOTICE,
    note: "Document rows are trackers for paper processes — no file bytes and no medical content are stored here. An expiry date is operator-entered and drives renewal reminders through date arithmetic only.",
  });
}

export async function createWorkspaceDocument(request: Request, env: Env, id: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  await authorize(env, { userId: auth.user.id, role: auth.user.role }, id, "tasks_manage");
  const parsed = DocumentSchema.safeParse(await readJson<unknown>(request, 8 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_document", "Document failed validation", parsed.error.flatten());
  const results = await env.DB.batch(createDocumentStatements(env.DB, {
    collectionId: id, horseId: parsed.data.horse_id ?? null, title: parsed.data.title,
    category: parsed.data.category as WorkspaceDocumentCategory, note: parsed.data.note ?? null,
    expiresAtDay: parsed.data.expires_at ?? null, actorUserId: auth.user.id, operationId: crypto.randomUUID(),
  }));
  if (Number(results[1]?.meta.changes ?? 0) !== 1) {
    const horse = parsed.data.horse_id == null ? null : await env.DB.prepare(
      "SELECT 1 FROM workspace_collection_members WHERE collection_id=? AND horse_id=?").bind(id, parsed.data.horse_id).first();
    if (parsed.data.horse_id != null && !horse) throw new HttpError(404, "horse_not_in_workspace", "That horse is not part of this workspace");
    throw new HttpError(409, "document_capacity_reached", "This workspace already tracks the document limit; archive unused rows first");
  }
  return json({ created: true, note: "The document tracker is created. Expiry (if set) can drive a document_renewal reminder." }, { status: 201 });
}

export async function updateWorkspaceDocument(request: Request, env: Env, id: number, documentId: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  await authorize(env, { userId: auth.user.id, role: auth.user.role }, id, "tasks_manage");
  const parsed = DocumentUpdateSchema.safeParse(await readJson<unknown>(request, 8 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_document", "Document failed validation (expected_version is required)", parsed.error.flatten());
  // R108-08: explicit association semantics — the horse link is immutable after
  // create. A round-tripped horse_id must equal the stored association.
  if (parsed.data.horse_id !== undefined) {
    const stored = await env.DB.prepare("SELECT horse_id, status FROM workspace_documents WHERE id=? AND collection_id=?")
      .bind(documentId, id).first<{ horse_id: number | null; status: string }>();
    if (!stored) {
      await authorize(env, { userId: auth.user.id, role: auth.user.role }, id, "tasks_manage");
      throw new HttpError(404, "not_found", "Document not found in this workspace");
    }
    if ((stored.horse_id == null ? null : Number(stored.horse_id)) !== parsed.data.horse_id) {
      throw new HttpError(409, "document_horse_immutable", "A document's horse association is fixed when the tracker is created and cannot be moved. Archive this tracker and create a new one for the other horse.", { stored_horse_id: stored.horse_id == null ? null : Number(stored.horse_id) });
    }
  }
  const results = await env.DB.batch(updateDocumentStatements(env.DB, {
    collectionId: id, documentId, expectedVersion: parsed.data.expected_version, title: parsed.data.title,
    category: parsed.data.category as WorkspaceDocumentCategory, note: parsed.data.note ?? null,
    expiresAtDay: parsed.data.expires_at ?? null, actorUserId: auth.user.id, operationId: crypto.randomUUID(),
  }));
  if (Number(results[1]?.meta.changes ?? 0) !== 1) {
    await authorize(env, { userId: auth.user.id, role: auth.user.role }, id, "tasks_manage");
    const row = await env.DB.prepare("SELECT row_version, status FROM workspace_documents WHERE id=? AND collection_id=?").bind(documentId, id)
      .first<{ row_version: number; status: string }>();
    if (!row) throw new HttpError(404, "not_found", "Document not found in this workspace");
    if (row.status !== "active") throw new HttpError(409, "document_archived", "Archived documents are read-only history");
    throw new HttpError(409, "document_version_conflict", "This document changed while you were editing; reload the current version and try again", { current_version: Number(row.row_version) });
  }
  return json({ updated: true });
}

export async function archiveWorkspaceDocument(request: Request, env: Env, id: number, documentId: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  await authorize(env, { userId: auth.user.id, role: auth.user.role }, id, "tasks_manage");
  const results = await env.DB.batch(archiveDocumentStatements(env.DB, {
    collectionId: id, documentId, actorUserId: auth.user.id, operationId: crypto.randomUUID(),
  }));
  if (Number(results[1]?.meta.changes ?? 0) !== 1) {
    throw new HttpError(409, "not_active", "No active document with this id in this workspace");
  }
  return json({ archived: true, note: "The tracker row is archived; the paper process history stays queryable." });
}

// ---------------------------------------------------------------------------
// Task reassignment + no-overwrite import
// ---------------------------------------------------------------------------

const ReassignSchema = z.object({
  assigned_to_user_id: z.string().trim().min(3).max(64).nullable(),
  // Optional on the wire for legacy R98 clients. All requests still use a CAS:
  // legacy requests adopt the freshly read version; current clients send theirs.
  expected_version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
});

export async function reassignWorkspaceTask(request: Request, env: Env, id: number, taskId: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  await authorize(env, { userId: auth.user.id, role: auth.user.role }, id, "tasks_manage");
  const parsed = ReassignSchema.safeParse(await readJson<unknown>(request, 2 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_reassign", "assigned_to_user_id (or null) and a valid expected_version are required");
  const task = await env.DB.prepare("SELECT status,row_version FROM workspace_tasks WHERE id=? AND collection_id=?")
    .bind(taskId, id).first<{ status: string; row_version: number }>();
  if (!task) throw new HttpError(404, "not_found", "Task not found in this workspace");
  if (task.status !== "open") throw new HttpError(409, "task_not_open", "Only an open task can be reassigned");
  const expectedVersion = parsed.data.expected_version ?? Number(task.row_version);
  const results = await env.DB.batch(reassignTaskStatements(env.DB, {
    collectionId: id, taskId, newAssigneeUserId: parsed.data.assigned_to_user_id,
    actorUserId: auth.user.id, operationId: crypto.randomUUID(), expectedVersion,
  }));
  if (Number(results[1]?.meta.changes ?? 0) !== 1) {
    // Authority may have changed after preflight. Do not disclose the current
    // task/version to a caller who no longer has access.
    await authorize(env, { userId: auth.user.id, role: auth.user.role }, id, "tasks_manage");
    const current = await env.DB.prepare("SELECT status,row_version FROM workspace_tasks WHERE id=? AND collection_id=?")
      .bind(taskId, id).first<{ status: string; row_version: number }>();
    if (!current) throw new HttpError(404, "not_found", "Task not found in this workspace");
    if (Number(current.row_version) !== expectedVersion) throw new HttpError(409, "task_version_conflict", "This task changed; reload before reassigning", { current_version: Number(current.row_version) });
    if (current.status !== "open") throw new HttpError(409, "task_not_open", "Only an open task can be reassigned");
    throw new HttpError(403, "assignee_not_authorized", "The new assignee does not currently have access to this workspace");
  }
  return json({
    reassigned: true, assigned_to_user_id: parsed.data.assigned_to_user_id, row_version: expectedVersion + 1,
    note: "Reassignment and unassignment advance the task version and are audit-recorded. Later staff revocation suppresses that workspace's queued reminders.",
  });
}

const ImportTasksSchema = z.object({
  // R108-08: durable client import intent id (e.g. a UUID held by the importer).
  // A replay after interruption with the SAME key reconciles to the exact
  // accepted rows: rows a previous attempt accepted report "already_imported"
  // and are never re-executed or duplicated.
  intent_key: z.string().trim().min(8).max(128).optional(),
  tasks: z.array(z.object({
    title: z.string().trim().min(1).max(300),
    category: z.enum(["document_renewal", "farrier", "veterinary_appointment", "other"]),
    due_date: z.string().refine(isValidDay, "due_date must be a real Gregorian day"),
    recurrence: z.enum(["none", "custom_days"]).default("none"),
    recurrence_interval_days: z.number().int().min(1).max(3650).nullable().optional(),
    horse_id: z.number().int().positive().nullable().optional(),
  }).refine(task => task.recurrence !== "custom_days" || task.recurrence_interval_days != null,
    { message: "custom_days requires recurrence_interval_days", path: ["recurrence_interval_days"] })
    .refine(task => task.recurrence !== "none" || task.recurrence_interval_days == null,
      { message: "Non-recurring tasks must not specify recurrence_interval_days", path: ["recurrence_interval_days"] })
  ).min(1).max(MAX_TASK_IMPORT_ROWS),
});

/**
 * NO-OVERWRITE task import with DURABLE PER-ROW RECEIPTS (R108-08): every
 * incoming row computes a deterministic IMPORT occurrence_key (separate from
 * manual client-intent keys); an existing occurrence is SKIPPED and REPORTED —
 * never overwritten, never duplicated. When the client supplies intent_key, a
 * replay after interruption reconciles to the EXACT accepted rows: a row whose
 * occurrence exists AND carries the SAME import_intent_key was accepted by a
 * previous attempt of THIS import (receipt "already_imported", counted as
 * accepted, never re-executed); a row that pre-dates the intent (different
 * import or manual creation) keeps the honest "occurrence_exists" skip.
 */
export async function importWorkspaceTasks(request: Request, env: Env, id: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  await authorize(env, { userId: auth.user.id, role: auth.user.role }, id, "tasks_manage");
  const parsed = ImportTasksSchema.safeParse(await readJson<unknown>(request, 256 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_import", `Import failed validation (1-${MAX_TASK_IMPORT_ROWS} tasks)`, parsed.error.flatten());
  const intentKey = parsed.data.intent_key ?? null;
  const imported: string[] = [];
  const skipped: Array<{ title: string; reason: string }> = [];
  const receipts: Array<{ title: string; category: string; due_date: string; horse_id: number | null; status: "imported" | "already_imported" | "occurrence_exists" | "row_refused"; task_id: number | null }> = [];
  let alreadyImported = 0;
  for (const task of parsed.data.tasks) {
    const key = taskOccurrenceKey(`import:${id}:${task.title}:${task.category}:${task.horse_id ?? 0}`, task.due_date, 0);
    const existing = await env.DB.prepare("SELECT id, import_intent_key FROM workspace_tasks WHERE occurrence_key=?").bind(key)
      .first<{ id: number; import_intent_key: string | null }>();
    if (existing) {
      // R108-08 receipt semantics: same intent key => this import already
      // accepted the row in a previous (interrupted) attempt; it is ACCEPTED,
      // not skipped, and is never re-executed.
      const sameIntent = intentKey != null && existing.import_intent_key === intentKey;
      receipts.push({ title: task.title, category: task.category, due_date: task.due_date, horse_id: task.horse_id ?? null, status: sameIntent ? "already_imported" : "occurrence_exists", task_id: Number(existing.id) });
      if (sameIntent) { alreadyImported++; continue; }
      skipped.push({ title: task.title, reason: "occurrence_exists" });
      continue;
    }
    const results = await env.DB.batch(createTaskStatements(env.DB, {
      collectionId: id, horseId: task.horse_id ?? null, title: task.title, category: task.category,
      dueDate: task.due_date, recurrence: task.recurrence, recurrenceIntervalDays: task.recurrence_interval_days ?? null,
      actorUserId: auth.user.id, assignedToUserId: null, occurrenceKey: key, operationId: crypto.randomUUID(),
      importIntentKey: intentKey,
    }));
    const insertMeta = results[1]?.meta as { changes?: number; last_row_id?: number } | undefined;
    if (Number(insertMeta?.changes ?? 0) === 1) {
      imported.push(task.title);
      receipts.push({ title: task.title, category: task.category, due_date: task.due_date, horse_id: task.horse_id ?? null, status: "imported", task_id: Number(insertMeta?.last_row_id ?? 0) || null });
    } else {
      skipped.push({ title: task.title, reason: "row_refused" });
      receipts.push({ title: task.title, category: task.category, due_date: task.due_date, horse_id: task.horse_id ?? null, status: "row_refused", task_id: null });
    }
  }
  return json({
    imported: imported.length, skipped: skipped.length,
    accepted: imported.length + alreadyImported, already_imported: alreadyImported,
    intent_key: intentKey,
    imported_titles: imported, skipped_rows: skipped,
    receipts,
    note: "Import never overwrites: an existing occurrence (same title/category/horse and due date) is skipped and reported, not replaced. Rows accepted by a previous attempt of the SAME import intent report already_imported and count as accepted — an interrupted import replays to its exact accepted rows without duplicating any task.",
  }, { status: 201 });
}

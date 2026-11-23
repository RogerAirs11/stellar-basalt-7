import { describe, expect, it } from "vitest";
import {
  createWorkspace, createWorkspaceTask, completeWorkspaceTask, reopenWorkspaceTask,
} from "../../src/api/modules/workspaces";
import { reopenTaskStatements } from "../../src/workspaces/collaboration";
import { assignStaffStatements, revokeStaffStatements } from "../../src/workspaces/mutationCommands";
import { openRealDatabase, seedUser, makeSession, authedRequest, countRows, type AuthedSession } from "../helpers/realDatabase";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * R117-14 evidence: the task REOPEN mutation on a real database with every
 * migration applied. Tasks double as reminders in this domain, so reopen is
 * the promised close/reopen half of the workspace.task and workspace.reminder
 * parity rows. Every case follows the established discipline:
 *
 *  - CAS: a stale expected_version is a 409 that carries the current version,
 *    never a blind overwrite;
 *  - recurring closures refuse honestly (the next occurrence already exists
 *    in the same transaction — reopening would duplicate the reminder);
 *  - mutation-time actor predicate: a revoke between preflight and mutation
 *    denies the late mutation with 0 changes;
 *  - marker-gated audit: a failed reopen writes no audit row, a retry writes
 *    no duplicate;
 *  - existence hiding: a task outside the caller's workspace is a plain 404.
 */

const env = (db: D1Database) => ({ DB: db, SESSION_COOKIE_NAME: "hr_session" }) as never;

async function ownerWithWorkspace(db: D1Database, name = "Reopen herd"): Promise<{ owner: AuthedSession; workspaceId: number }> {
  await seedUser(db, "owner-1", "user");
  const owner = await makeSession(db, "owner-1");
  const created = await createWorkspace(authedRequest("/api/workspaces", { name }, { session: owner }), env(db));
  const body = await created.json() as { workspace: { id: number } };
  return { owner, workspaceId: body.workspace.id };
}

interface TaskRow { id: number; status: string; recurrence: string; row_version: number; completed_at: string | null; completed_by_user_id: string | null }

async function taskRow(db: D1Database, taskId: number): Promise<TaskRow | null> {
  return db.prepare("SELECT id,status,recurrence,row_version,completed_at,completed_by_user_id FROM workspace_tasks WHERE id=?").bind(taskId)
    .first<TaskRow>();
}

async function createOneShot(db: D1Database, owner: AuthedSession, workspaceId: number, title: string): Promise<number> {
  const created = await createWorkspaceTask(authedRequest(`/api/workspaces/${workspaceId}/tasks`, {
    title, category: "other", due_date: "2026-11-02", due_timezone: "Asia/Tehran", recurrence: "none",
  }, { session: owner }), env(db), workspaceId);
  expect(created.status).toBe(201);
  const list = await db.prepare("SELECT id FROM workspace_tasks WHERE collection_id=? AND title=? ORDER BY id DESC").bind(workspaceId, title)
    .first<{ id: number }>();
  if (!list) throw new Error("task not created");
  return Number(list.id);
}

describe("R117-14 task reopen (one-shot occurrences) on the real database", () => {
  it("happy path: complete then reopen restores open, clears completion markers, advances the version, writes exactly ONE audit row", async () => {
    const db = await openRealDatabase();
    const { owner, workspaceId } = await ownerWithWorkspace(db);
    const taskId = await createOneShot(db, owner, workspaceId, "Reopen me once");

    const done = await completeWorkspaceTask(authedRequest(`/api/workspaces/${workspaceId}/tasks/${taskId}/complete`, { expected_version: 1 }, { session: owner }), env(db), workspaceId, taskId);
    expect(done.status).toBe(200);
    // Completion is self-evidencing (row + spawned occurrence); it writes no audit row.

    const reopened = await reopenWorkspaceTask(authedRequest(`/api/workspaces/${workspaceId}/tasks/${taskId}/reopen`, { expected_version: 2 }, { session: owner }), env(db), workspaceId, taskId);
    expect(reopened.status).toBe(200);
    const body = await reopened.json() as { reopened: boolean };
    expect(body.reopened).toBe(true);

    const row = await taskRow(db, taskId);
    expect(row?.status).toBe("open");
    expect(row?.recurrence).toBe("none");
    expect(row?.row_version).toBe(3);
    expect(row?.completed_at).toBeNull();
    expect(row?.completed_by_user_id).toBeNull();
    expect(await countRows(db, "audit_events", "action='workspace.task_reopened'")).toBe(1);
  });

  it("CAS: a wrong expected_version on a STILL-DONE row is 409 stale_version with the current version; a retry after someone else reopened is the honest not_completed", async () => {
    const db = await openRealDatabase();
    const { owner, workspaceId } = await ownerWithWorkspace(db);
    const taskId = await createOneShot(db, owner, workspaceId, "Conflict on reopen");
    await completeWorkspaceTask(authedRequest(`/api/workspaces/${workspaceId}/tasks/${taskId}/complete`, { expected_version: 1 }, { session: owner }), env(db), workspaceId, taskId);

    // A wrong version while the row is still done: the version conflict is the
    // real cause — the 409 carries the current version, nothing is written.
    const stale = reopenWorkspaceTask(authedRequest(`/api/workspaces/${workspaceId}/tasks/${taskId}/reopen`, { expected_version: 99 }, { session: owner }), env(db), workspaceId, taskId);
    await expect(stale).rejects.toMatchObject({ status: 409, code: "stale_version" });
    await stale.catch(error => {
      expect((error as { details?: { current_version?: number } }).details).toMatchObject({ current_version: 2 });
    });
    expect(await taskRow(db, taskId)).toMatchObject({ status: "done", row_version: 2 });
    expect(await countRows(db, "audit_events", "action='workspace.task_reopened'")).toBe(0);

    // Someone reopens first (v2 -> v3, row is OPEN again); the stale caller's
    // retry with version 2 now gets the truthful not_completed — even a fresh
    // version could not reopen an open reminder.
    await reopenWorkspaceTask(authedRequest(`/api/workspaces/${workspaceId}/tasks/${taskId}/reopen`, { expected_version: 2 }, { session: owner }), env(db), workspaceId, taskId);
    await expect(reopenWorkspaceTask(authedRequest(`/api/workspaces/${workspaceId}/tasks/${taskId}/reopen`, { expected_version: 2 }, { session: owner }), env(db), workspaceId, taskId))
      .rejects.toMatchObject({ status: 409, code: "not_completed" });
    expect(await taskRow(db, taskId)).toMatchObject({ status: "open", row_version: 3 });
    expect(await countRows(db, "audit_events", "action='workspace.task_reopened'")).toBe(1);
  });

  it("honest refusal: reopening an already-open task is 409 not_completed (a distinct answer, not a version conflict)", async () => {
    const db = await openRealDatabase();
    const { owner, workspaceId } = await ownerWithWorkspace(db);
    const taskId = await createOneShot(db, owner, workspaceId, "Never closed");
    await expect(reopenWorkspaceTask(authedRequest(`/api/workspaces/${workspaceId}/tasks/${taskId}/reopen`, { expected_version: 1 }, { session: owner }), env(db), workspaceId, taskId))
      .rejects.toMatchObject({ status: 409, code: "not_completed" });
    expect(await taskRow(db, taskId)).toMatchObject({ status: "open", row_version: 1 });
    expect(await countRows(db, "audit_events", "action='workspace.task_reopened'")).toBe(0);
  });

  it("recurring closures refuse honestly: the spawned next occurrence stays exactly once and the closed row is never duplicated", async () => {
    const db = await openRealDatabase();
    const { owner, workspaceId } = await ownerWithWorkspace(db);
    const created = await createWorkspaceTask(authedRequest(`/api/workspaces/${workspaceId}/tasks`, {
      title: "Recurring farrier loop", category: "farrier", due_date: "2026-11-02", due_timezone: "Asia/Tehran",
      recurrence: "custom_days", recurrence_interval_days: 30,
    }, { session: owner }), env(db), workspaceId);
    expect(created.status).toBe(201);
    const parent = await db.prepare("SELECT id FROM workspace_tasks WHERE collection_id=? AND title=? ORDER BY id").bind(workspaceId, "Recurring farrier loop")
      .first<{ id: number }>();
    if (!parent) throw new Error("recurring task not created");
    const parentId = Number(parent.id);

    const done = await completeWorkspaceTask(authedRequest(`/api/workspaces/${workspaceId}/tasks/${parentId}/complete`, { expected_version: 1 }, { session: owner }), env(db), workspaceId, parentId);
    expect(done.status).toBe(200);
    const body = await done.json() as { next_occurrence: { due_date: string } | null };
    expect(body.next_occurrence).toMatchObject({ due_date: "2026-12-02" });
    expect(await countRows(db, "workspace_tasks", `collection_id=${workspaceId} AND title='Recurring farrier loop'`)).toBe(2);

    // The refusal names the real reason; the spawned occurrence is untouched.
    await expect(reopenWorkspaceTask(authedRequest(`/api/workspaces/${workspaceId}/tasks/${parentId}/reopen`, { expected_version: 2 }, { session: owner }), env(db), workspaceId, parentId))
      .rejects.toMatchObject({ status: 409, code: "recurring_occurrence_completed" });
    expect(await countRows(db, "workspace_tasks", `collection_id=${workspaceId} AND title='Recurring farrier loop'`)).toBe(2);
    expect(await countRows(db, "workspace_tasks", `collection_id=${workspaceId} AND title='Recurring farrier loop' AND status='open'`)).toBe(1);
    expect(await countRows(db, "audit_events", "action='workspace.task_reopened'")).toBe(0);
  });

  it("existence hiding: a task id from ANOTHER workspace is a plain 404, never a cross-workspace leak", async () => {
    const db = await openRealDatabase();
    const first = await ownerWithWorkspace(db, "One");
    await seedUser(db, "owner-2", "user");
    const second = await makeSession(db, "owner-2");
    const created = await createWorkspace(authedRequest("/api/workspaces", { name: "Two" }, { session: second }), env(db));
    const secondBody = await created.json() as { workspace: { id: number } };
    const secondId = secondBody.workspace.id;
    const foreignTaskId = await createOneShot(db, second, secondId, "Someone else's one-shot");
    await completeWorkspaceTask(authedRequest(`/api/workspaces/${secondId}/tasks/${foreignTaskId}/complete`, { expected_version: 1 }, { session: second }), env(db), secondId, foreignTaskId);

    await expect(reopenWorkspaceTask(authedRequest(`/api/workspaces/${first.workspaceId}/tasks/${foreignTaskId}/reopen`, { expected_version: 2 }, { session: first.owner }), env(db), first.workspaceId, foreignTaskId))
      .rejects.toMatchObject({ status: 404, code: "not_found" });
    expect(await taskRow(db, foreignTaskId)).toMatchObject({ status: "done", row_version: 2 });
  });

  it("view-only staff cannot reopen (403); tasks_manage staff can", async () => {
    const db = await openRealDatabase();
    const { owner, workspaceId } = await ownerWithWorkspace(db);
    const taskId = await createOneShot(db, owner, workspaceId, "Staff permissions");
    await completeWorkspaceTask(authedRequest(`/api/workspaces/${workspaceId}/tasks/${taskId}/complete`, { expected_version: 1 }, { session: owner }), env(db), workspaceId, taskId);

    await seedUser(db, "viewer-1", "user");
    const viewer = await makeSession(db, "viewer-1");
    await db.batch(assignStaffStatements(db, { collectionId: workspaceId, userId: "viewer-1", actions: "view", actorUserId: "owner-1", operationId: crypto.randomUUID() }));
    // Insufficient action hides the workspace entirely (platform convention:
    // never confirm a workspace's existence to an unauthorized actor).
    await expect(reopenWorkspaceTask(authedRequest(`/api/workspaces/${workspaceId}/tasks/${taskId}/reopen`, { expected_version: 2 }, { session: viewer }), env(db), workspaceId, taskId))
      .rejects.toMatchObject({ status: 404, code: "not_found" });
    expect(await taskRow(db, taskId)).toMatchObject({ status: "done", row_version: 2 });

    await seedUser(db, "manager-1", "user");
    const manager = await makeSession(db, "manager-1");
    await db.batch(assignStaffStatements(db, { collectionId: workspaceId, userId: "manager-1", actions: "view,tasks_manage", actorUserId: "owner-1", operationId: crypto.randomUUID() }));
    const reopened = await reopenWorkspaceTask(authedRequest(`/api/workspaces/${workspaceId}/tasks/${taskId}/reopen`, { expected_version: 2 }, { session: manager }), env(db), workspaceId, taskId);
    expect(reopened.status).toBe(200);
    expect(await taskRow(db, taskId)).toMatchObject({ status: "open", row_version: 3 });
  });

  it("mutation-time authority: a revoke between preflight and mutation denies the LATE reopen — and writes NO audit row", async () => {
    const db = await openRealDatabase();
    const { owner, workspaceId } = await ownerWithWorkspace(db);
    const taskId = await createOneShot(db, owner, workspaceId, "Late mutation");
    await completeWorkspaceTask(authedRequest(`/api/workspaces/${workspaceId}/tasks/${taskId}/complete`, { expected_version: 1 }, { session: owner }), env(db), workspaceId, taskId);

    await seedUser(db, "staff-1", "user");
    await db.batch(assignStaffStatements(db, { collectionId: workspaceId, userId: "staff-1", actions: "view,tasks_manage", actorUserId: "owner-1", operationId: crypto.randomUUID() }));

    // The staff member's preflight passed (they hold the row version), but the
    // owner revokes them BEFORE the mutation batch runs — the row-level
    // authority predicate must refuse the late write with 0 changes.
    await db.batch(revokeStaffStatements(db, { collectionId: workspaceId, userId: "staff-1", actorUserId: "owner-1", operationId: crypto.randomUUID() }));
    const late = await db.batch(reopenTaskStatements(db, { collectionId: workspaceId, taskId, actorUserId: "staff-1", expectedVersion: 2, operationId: crypto.randomUUID() }));
    expect(Number(late[1]?.meta.changes ?? 0)).toBe(0);
    expect(await taskRow(db, taskId)).toMatchObject({ status: "done", row_version: 2 });
    expect(await countRows(db, "audit_events", "action='workspace.task_reopened'")).toBe(0);

    // The same batch retried by a caller who still holds authority writes
    // exactly one row and one audit row — never a duplicate.
    const legit = await db.batch(reopenTaskStatements(db, { collectionId: workspaceId, taskId, actorUserId: "owner-1", expectedVersion: 2, operationId: crypto.randomUUID() }));
    expect(Number(legit[1]?.meta.changes ?? 0)).toBe(1);
    const replay = await db.batch(reopenTaskStatements(db, { collectionId: workspaceId, taskId, actorUserId: "owner-1", expectedVersion: 2, operationId: crypto.randomUUID() }));
    expect(Number(replay[1]?.meta.changes ?? 0)).toBe(0);
    expect(await countRows(db, "audit_events", "action='workspace.task_reopened'")).toBe(1);
  });

  it("validation: expected_version is required — a malformed body is a 400 invalid_reopen", async () => {
    const db = await openRealDatabase();
    const { owner, workspaceId } = await ownerWithWorkspace(db);
    const taskId = await createOneShot(db, owner, workspaceId, "Validation guard");
    await completeWorkspaceTask(authedRequest(`/api/workspaces/${workspaceId}/tasks/${taskId}/complete`, { expected_version: 1 }, { session: owner }), env(db), workspaceId, taskId);
    await expect(reopenWorkspaceTask(authedRequest(`/api/workspaces/${workspaceId}/tasks/${taskId}/reopen`, {}, { session: owner }), env(db), workspaceId, taskId))
      .rejects.toMatchObject({ status: 400, code: "invalid_reopen" });
    expect(await taskRow(db, taskId)).toMatchObject({ status: "done", row_version: 2 });
  });
});

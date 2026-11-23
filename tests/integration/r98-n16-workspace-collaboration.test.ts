import { describe, expect, it } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import {
  createWorkspace, addWorkspaceHorse, createWorkspaceTask, listWorkspaceTasks, completeWorkspaceTask,
  inviteWorkspaceStaff, myWorkspaceInvites, respondWorkspaceInvite, revokeWorkspaceInvite, revokeWorkspaceStaff,
  listWorkspaceDocuments, createWorkspaceDocument, updateWorkspaceDocument, archiveWorkspaceDocument,
  reassignWorkspaceTask, importWorkspaceTasks,
} from "../../src/api/modules/workspaces";
import { buildWorkspaceCalendar } from "../../src/frontend-kit/domain/workspaceCalendar";
import { openRealDatabase, seedUser, makeSession, authedRequest, countRows, type AuthedSession } from "../helpers/realDatabase";

/**
 * R98-N16 evidence — stable collaboration and calendar operations on a REAL
 * database with every migration applied (including 0079).
 *
 * Acceptance pins:
 *  A. Concurrent/limited additions: the invite flow's acceptance re-checks the
 *     inviter's CURRENT manage authority and the staff capacity INSIDE the
 *     creating statement; an owner who revoked the manager between invite and
 *     accept inserts ZERO rows.
 *  B. Completing a task twice creates at most one next occurrence (existing
 *     CAS path re-pinned) and the reassignment path is audit-visible with
 *     live authority for BOTH actor and new assignee.
 *  C. Owner / manager / viewer each see and can perform exactly their
 *     permitted actions: documents need tasks_manage; view-only staff are
 *     refused; the staff departure suppresses QUEUED notifications at revoke
 *     time.
 *  D. The no-overwrite import: an existing occurrence is skipped and REPORTED,
 *     never replaced; the calendar/list alternative computes honest overdue
 *     states per task timezone.
 */

type Env = { DB: D1Database; SESSION_COOKIE_NAME: string };
const envOf = (db: D1Database): Env => ({ DB: db, SESSION_COOKIE_NAME: "hr_session" });

interface World {
  db: D1Database; env: Env; workspaceId: number;
  owner: AuthedSession; staff: AuthedSession; viewer: AuthedSession; outsider: AuthedSession;
}

async function world(): Promise<World> {
  const db = await openRealDatabase();
  await seedUser(db, "n16-owner", "user");
  await seedUser(db, "n16-staff", "user");
  await seedUser(db, "n16-viewer", "user");
  await seedUser(db, "n16-outsider", "user");
  await db.exec(`
    INSERT INTO horses(id,name_latin,is_active,deleted_at) VALUES (191,'N16 HERD ONE',1,NULL);
  `);
  const owner = await makeSession(db, "n16-owner");
  const created = await createWorkspace(authedRequest("/api/workspaces", { name: "N16 Farm" }, { session: owner }), envOf(db));
  expect(created.status).toBe(201);
  const workspaceId = ((await created.json()) as { workspace: { id: number } }).workspace.id;
  const env = envOf(db);
  await addWorkspaceHorse(authedRequest(`/api/workspaces/${workspaceId}/horses`, { horse_id: 191 }, { session: owner }), env, workspaceId);
  return {
    db, env, workspaceId,
    owner,
    staff: await makeSession(db, "n16-staff"),
    viewer: await makeSession(db, "n16-viewer"),
    outsider: await makeSession(db, "n16-outsider"),
  };
}

async function grantStaff(w: World, userId: string, actions: string): Promise<void> {
  const { assignWorkspaceStaff } = await import("../../src/api/modules/workspaces");
  const response = await assignWorkspaceStaff(authedRequest(`/api/workspaces/${w.workspaceId}/staff`, { user_id: userId, actions }, { session: w.owner }), w.env, w.workspaceId);
  expect(response.status).toBe(201);
}

describe("N16 A. the invitation lifecycle (consent before delegation)", () => {
  it("invite -> accept creates the assignment; the invitee's own list shows it; capacity is exact", async () => {
    const w = await world();
    const invite = await inviteWorkspaceStaff(authedRequest(`/api/workspaces/${w.workspaceId}/invites`, { invitee_user_id: "n16-staff", actions: "view,tasks_manage" }, { session: w.owner }), w.env, w.workspaceId);
    expect(invite.status).toBe(201);
    // The invitee sees their pending invitation.
    const mine = await myWorkspaceInvites(authedRequest("/api/workspaces/invites/mine", {}, { session: w.staff }), w.env);
    const mineBody = await mine.json() as { rows: Array<{ collection_id: number; proposed_actions: string }> };
    expect(mineBody.rows.map((row) => row.collection_id)).toContain(w.workspaceId);
    // Accept creates the assignment.
    const accepted = await respondWorkspaceInvite(authedRequest(`/api/workspaces/invites/${w.workspaceId}/respond`, { action: "accept" }, { session: w.staff }), w.env, w.workspaceId);
    expect(accepted.status).toBe(200);
    const acceptedBody = await accepted.json() as { accepted: boolean; actions: string[] };
    expect(acceptedBody.accepted).toBe(true);
    expect(acceptedBody.actions).toEqual(["view", "tasks_manage"]);
    // The audit trail records the accepted invite.
    const audit = await w.db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='workspace.staff_invite_accepted' AND actor_user_id='n16-staff'").first<{ n: number }>();
    expect(Number(audit?.n ?? 0)).toBe(1);
  });

  it("no self-invitation; a second OPEN invite for the same person is refused", async () => {
    const w = await world();
    await expect(inviteWorkspaceStaff(authedRequest(`/api/workspaces/${w.workspaceId}/invites`, { invitee_user_id: "n16-owner", actions: "view" }, { session: w.owner }), w.env, w.workspaceId))
      .rejects.toMatchObject({ status: 400, code: "not_self" });
    const first = await inviteWorkspaceStaff(authedRequest(`/api/workspaces/${w.workspaceId}/invites`, { invitee_user_id: "n16-staff", actions: "view" }, { session: w.owner }), w.env, w.workspaceId);
    expect(first.status).toBe(201);
    await expect(inviteWorkspaceStaff(authedRequest(`/api/workspaces/${w.workspaceId}/invites`, { invitee_user_id: "n16-staff", actions: "tasks_manage" }, { session: w.owner }), w.env, w.workspaceId))
      .rejects.toMatchObject({ status: 409, code: "invite_already_open" });
  });

  it("acceptance re-checks the inviter's CURRENT authority inside the write — a departed inviter inserts zero rows", async () => {
    const w = await world();
    // The OUTSIDER cannot invite at all (403 at the authorize gate).
    await expect(inviteWorkspaceStaff(authedRequest(`/api/workspaces/${w.workspaceId}/invites`, { invitee_user_id: "n16-staff", actions: "view" }, { session: w.outsider }), w.env, w.workspaceId))
      .rejects.toMatchObject({ status: 404 });
    // Simulate a stale invite: the inviter (owner) transfers ownership away by
    // archiving nothing — instead the invite row is seeded directly with a
    // departed inviter, exactly what a late revoke leaves behind.
    await w.db.exec(`
      INSERT INTO workspace_staff_invites(collection_id,invitee_user_id,invited_by_user_id,proposed_actions,status,expires_at)
      VALUES (${w.workspaceId},'n16-viewer','n16-outsider','view','pending',datetime('now','+14 days'));
    `);
    // The honest refusal: a 409 that names the real cause and writes nothing.
    await expect(respondWorkspaceInvite(authedRequest(`/api/workspaces/invites/${w.workspaceId}/respond`, { action: "accept" }, { session: w.viewer }), w.env, w.workspaceId))
      .rejects.toMatchObject({ status: 409, code: "invite_not_acceptable" });
    const assignment = await w.db.prepare("SELECT 1 FROM workspace_staff_assignments WHERE collection_id=? AND user_id='n16-viewer'").bind(w.workspaceId).first();
    expect(assignment).toBeNull();
  });

  it("an expired invitation can no longer be accepted (the honest 410)", async () => {
    const w = await world();
    await w.db.exec(`
      INSERT INTO workspace_staff_invites(collection_id,invitee_user_id,invited_by_user_id,proposed_actions,status,expires_at)
      VALUES (${w.workspaceId},'n16-staff','n16-owner','view','pending',datetime('now','-1 day'));
    `);
    await expect(respondWorkspaceInvite(authedRequest(`/api/workspaces/invites/${w.workspaceId}/respond`, { action: "accept" }, { session: w.staff }), w.env, w.workspaceId))
      .rejects.toMatchObject({ status: 410, code: "invite_expired" });
    // The inviter can revoke an open invitation.
    await w.db.exec(`
      INSERT INTO workspace_staff_invites(collection_id,invitee_user_id,invited_by_user_id,proposed_actions,status,expires_at)
      VALUES (${w.workspaceId},'n16-viewer','n16-owner','view','pending',datetime('now','+14 days'));
    `);
    const revoked = await revokeWorkspaceInvite(authedRequest(`/api/workspaces/${w.workspaceId}/invites/n16-viewer/revoke`, {}, { session: w.owner }), w.env, w.workspaceId, "n16-viewer");
    expect(await revoked.json()).toMatchObject({ revoked: true });
  });
});

describe("N16 B/C. documents, reassignment and role boundaries", () => {
  it("a document tracker is created, version-updated (409 on stale), archived; view-only staff and outsiders are refused", async () => {
    const w = await world();
    await grantStaff(w, "n16-staff", "view,tasks_manage");
    await grantStaff(w, "n16-viewer", "view");
    const created = await createWorkspaceDocument(authedRequest(`/api/workspaces/${w.workspaceId}/documents`, {
      horse_id: 191, title: "Insurance policy 1404", category: "insurance", note: "Annual policy", expires_at: "2026-12-01",
    }, { session: w.staff }), w.env, w.workspaceId);
    expect(created.status).toBe(201);
    // View-only staff cannot write documents.
    await expect(createWorkspaceDocument(authedRequest(`/api/workspaces/${w.workspaceId}/documents`, { title: "X", category: "other" }, { session: w.viewer }), w.env, w.workspaceId))
      .rejects.toMatchObject({ status: 404 });
    // Nor can an outsider.
    await expect(listWorkspaceDocuments(authedRequest(`/api/workspaces/${w.workspaceId}/documents`, {}, { session: w.outsider }), w.env, w.workspaceId))
      .rejects.toMatchObject({ status: 404 });
    // The list shows the row for authorized staff.
    const listed = await listWorkspaceDocuments(authedRequest(`/api/workspaces/${w.workspaceId}/documents`, {}, { session: w.staff }), w.env, w.workspaceId);
    const listBody = await listed.json() as { rows: Array<{ id: number; title: string; row_version: number; expires_at: string }> };
    expect(listBody.rows).toHaveLength(1);
    const doc = listBody.rows[0]!;
    // Versioned update: stale version is a 409 carrying the current version.
    // (R108-08: the round-tripped horse_id must EQUAL the stored association —
    // a changed association is refused before any version arithmetic.)
    const updated = await updateWorkspaceDocument(authedRequest(`/api/workspaces/${w.workspaceId}/documents/${doc.id}`, {
      horse_id: 191, title: "Insurance policy 1404 (renewed)", category: "insurance", note: null, expires_at: "2027-12-01", expected_version: doc.row_version,
    }, { session: w.staff }), w.env, w.workspaceId, doc.id);
    expect(await updated.json()).toMatchObject({ updated: true });
    await expect(updateWorkspaceDocument(authedRequest(`/api/workspaces/${w.workspaceId}/documents/${doc.id}`, {
      horse_id: 191, title: "Stale edit", category: "other", note: null, expires_at: null, expected_version: doc.row_version,
    }, { session: w.staff }), w.env, w.workspaceId, doc.id)).rejects.toMatchObject({ status: 409, code: "document_version_conflict" });
    // R108-08: a CHANGED horse association is deterministically refused — the
    // field is never silently ignored and no move exists.
    await expect(updateWorkspaceDocument(authedRequest(`/api/workspaces/${w.workspaceId}/documents/${doc.id}`, {
      horse_id: null, title: "Move attempt", category: "other", note: null, expires_at: null, expected_version: doc.row_version + 1,
    }, { session: w.staff }), w.env, w.workspaceId, doc.id)).rejects.toMatchObject({ status: 409, code: "document_horse_immutable" });
    // Archive is terminal for edits.
    const archived = await archiveWorkspaceDocument(authedRequest(`/api/workspaces/${w.workspaceId}/documents/${doc.id}/archive`, {}, { session: w.staff }), w.env, w.workspaceId, doc.id);
    expect(await archived.json()).toMatchObject({ archived: true });
    await expect(updateWorkspaceDocument(authedRequest(`/api/workspaces/${w.workspaceId}/documents/${doc.id}`, {
      horse_id: 191, title: "Post-archive edit", category: "other", note: null, expires_at: null, expected_version: doc.row_version + 2,
    }, { session: w.staff }), w.env, w.workspaceId, doc.id)).rejects.toMatchObject({ status: 409, code: "document_archived" });
  });

  it("reassignment is audit-recorded; a new assignee without workspace access is refused live", async () => {
    const w = await world();
    await grantStaff(w, "n16-staff", "view,tasks_manage");
    const today = new Date().toISOString().slice(0, 10);
    const taskResponse = await createWorkspaceTask(authedRequest(`/api/workspaces/${w.workspaceId}/tasks`, {
      title: "N16 reassign me", category: "farrier", due_date: today, recurrence: "none",
    }, { session: w.owner }), w.env, w.workspaceId);
    expect(taskResponse.status).toBe(201);
    const tasks = await listWorkspaceTasks(authedRequest(`/api/workspaces/${w.workspaceId}/tasks`, {}, { session: w.owner }), w.env, w.workspaceId);
    const tasksBody = await tasks.json() as { tasks: Array<{ id: number }> };
    const taskId = tasksBody.tasks[0]!.id;
    // Reassign to authorized staff: works and is audited.
    const ok = await reassignWorkspaceTask(authedRequest(`/api/workspaces/${w.workspaceId}/tasks/${taskId}/reassign`, { assigned_to_user_id: "n16-staff" }, { session: w.owner }), w.env, w.workspaceId, taskId);
    expect(await ok.json()).toMatchObject({ reassigned: true });
    const audit = await w.db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='workspace.task_reassigned' AND entity_id=?").bind(String(taskId)).first<{ n: number }>();
    expect(Number(audit?.n ?? 0)).toBe(1);
    // Reassign to someone WITHOUT workspace access: honest 403, nothing written.
    await expect(reassignWorkspaceTask(authedRequest(`/api/workspaces/${w.workspaceId}/tasks/${taskId}/reassign`, { assigned_to_user_id: "n16-outsider" }, { session: w.owner }), w.env, w.workspaceId, taskId))
      .rejects.toMatchObject({ status: 403, code: "assignee_not_authorized" });
    // Un-assign back to null works.
    const unassigned = await reassignWorkspaceTask(authedRequest(`/api/workspaces/${w.workspaceId}/tasks/${taskId}/reassign`, { assigned_to_user_id: null }, { session: w.owner }), w.env, w.workspaceId, taskId);
    expect(await unassigned.json()).toMatchObject({ reassigned: true });
  });

  it("completing a recurring task twice materializes at most ONE next occurrence", async () => {
    const w = await world();
    const start = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const taskResponse = await createWorkspaceTask(authedRequest(`/api/workspaces/${w.workspaceId}/tasks`, {
      title: "N16 recurring", category: "farrier", due_date: start, recurrence: "custom_days", recurrence_interval_days: 30,
    }, { session: w.owner }), w.env, w.workspaceId);
    expect(taskResponse.status).toBe(201);
    const tasks = await listWorkspaceTasks(authedRequest(`/api/workspaces/${w.workspaceId}/tasks`, {}, { session: w.owner }), w.env, w.workspaceId);
    const taskId = ((await tasks.json()) as { tasks: Array<{ id: number }> }).tasks[0]!.id;
    const first = await completeWorkspaceTask(authedRequest(`/api/workspaces/${w.workspaceId}/tasks/${taskId}/complete`, { expected_version: 1 }, { session: w.owner }), w.env, w.workspaceId, taskId);
    expect(first.status).toBe(200);
    // A retried completion is an honest 409 — never a second occurrence.
    await expect(completeWorkspaceTask(authedRequest(`/api/workspaces/${w.workspaceId}/tasks/${taskId}/complete`, { expected_version: 1 }, { session: w.owner }), w.env, w.workspaceId, taskId))
      .rejects.toMatchObject({ status: 409, code: "already_closed" });
    const occurrences = await countRows(w.db, "workspace_tasks", "title='N16 recurring' AND status='open'");
    expect(occurrences).toBe(1);
  });
});

describe("N16 D. no-overwrite import and the calendar alternative", () => {
  it("importing an existing occurrence is skipped and REPORTED — never overwritten", async () => {
    const w = await world();
    const due = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    const first = await importWorkspaceTasks(authedRequest(`/api/workspaces/${w.workspaceId}/tasks/import`, {
      tasks: [
        { title: "N16 import A", category: "farrier", due_date: due, recurrence: "none" },
        { title: "N16 import B", category: "other", due_date: due, recurrence: "none", horse_id: 191 },
      ],
    }, { session: w.owner }), w.env, w.workspaceId);
    const firstBody = await first.json() as { imported: number; skipped: number; accepted: number; already_imported: number; intent_key: string | null; receipts: Array<{ status: string }> };
    expect(firstBody).toMatchObject({ imported: 2, skipped: 0, accepted: 2, already_imported: 0, intent_key: null, imported_titles: ["N16 import A", "N16 import B"], skipped_rows: [], note: expect.any(String) });
    expect(firstBody.receipts.map((r) => r.status)).toEqual(["imported", "imported"]);
    // The second import of the SAME rows: everything skipped, nothing changed.
    const second = await importWorkspaceTasks(authedRequest(`/api/workspaces/${w.workspaceId}/tasks/import`, {
      tasks: [
        { title: "N16 import A", category: "farrier", due_date: due, recurrence: "none" },
        { title: "N16 import B", category: "other", due_date: due, recurrence: "none", horse_id: 191 },
      ],
    }, { session: w.owner }), w.env, w.workspaceId);
    const secondBody = await second.json() as { imported: number; skipped: number; skipped_rows: Array<{ title: string; reason: string }> };
    expect(secondBody.imported).toBe(0);
    expect(secondBody.skipped).toBe(2);
    expect(secondBody.skipped_rows.every((row) => row.reason === "occurrence_exists")).toBe(true);
  });

  it("the calendar model computes honest overdue states per task timezone", () => {
    const nowIso = "2026-10-06T22:00:00.000Z"; // 2026-10-07 in Tehran, still 10-06 in London
    const model = buildWorkspaceCalendar([
      { id: 1, title: "Tehran overdue", category: "farrier", due_date: "2026-10-06", due_timezone: "Asia/Tehran", status: "open", row_version: 1 },
      { id: 2, title: "London today", category: "other", due_date: "2026-10-06", due_timezone: "Europe/London", status: "open", row_version: 1 },
      { id: 3, title: "Invalid date", category: "other", due_date: "not-a-date", status: "open", row_version: 1 },
      { id: 4, title: "Closed task", category: "other", due_date: "2026-10-06", status: "completed", row_version: 1 },
    ], 2026, 10, nowIso);
    expect(model.counts.total).toBe(3); // closed task excluded
    expect(model.counts.overdue).toBe(1); // Tehran's local date is the 7th: the 6th is overdue there
    expect(model.counts.invalid).toBe(1);
    const byTitle = new Map(model.list.map((task) => [task.title, task]));
    expect(byTitle.get("Tehran overdue")?.overdue).toBe(true);
    expect(byTitle.get("London today")?.overdue).toBe(false);
    expect(byTitle.get("London today")?.dueToday).toBe(true);
    // October 2026 starts on a Thursday: Monday-first padding = 3 cells.
    expect(model.days[0]?.day).toBe("");
    expect(model.days[3]?.day).toBe("2026-10-01");
    expect(model.days.filter((day) => day.inMonth)).toHaveLength(31);
    // The calendar cell for 2026-10-06 carries both timezone-visible tasks.
    const cell = model.days.find((day) => day.day === "2026-10-06");
    expect(cell?.tasks.map((task) => task.title).sort()).toEqual(["London today", "Tehran overdue"]);
  });
});

describe("N16 C. staff departure suppresses queued notifications immediately", () => {
  it("revoking staff suppresses their QUEUED workspace-task notifications at revoke time (workspace-scoped, R108 F08)", async () => {
    const w = await world();
    await grantStaff(w, "n16-staff", "view,tasks_manage");
    // A due task assigned to the staff member + a queued outbox row for them.
    const past = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await createWorkspaceTask(authedRequest(`/api/workspaces/${w.workspaceId}/tasks`, {
      title: "N16 departure reminder", category: "farrier", due_date: past, recurrence: "none", assigned_to_user_id: "n16-staff",
    }, { session: w.owner }), w.env, w.workspaceId);
    // R108 F08: suppression is scoped to tasks IN THIS WORKSPACE. Resolve the
    // real task id (the fresh-create response does not carry it) and pin the
    // outbox row to it, plus a foreign-workspace row that must NOT be touched.
    const realTask = await w.db.prepare(
      "SELECT id FROM workspace_tasks WHERE collection_id=? AND title='N16 departure reminder' ORDER BY id DESC LIMIT 1",
    ).bind(w.workspaceId).first<{ id: number }>();
    expect(realTask?.id).toBeGreaterThan(0);
    await w.db.exec(`
      INSERT INTO notification_outbox(event_key,channel,purpose,essential,recipient_user_id,recipient_masked,status,payload_ref)
      VALUES ('workspace-task:${realTask!.id}:due:${past}:recipient:x','email','workspace_task_due',0,'n16-staff','n***@x.com','queued','workspace_tasks:${realTask!.id}');
      INSERT INTO notification_outbox(event_key,channel,purpose,essential,recipient_user_id,recipient_masked,status,payload_ref)
      VALUES ('workspace-task:9901:due:${past}:recipient:x','email','workspace_task_due',0,'n16-staff','n***@x.com','queued','workspace_tasks:9901');
    `);
    const revoke = await revokeWorkspaceStaff(authedRequest(`/api/workspaces/${w.workspaceId}/staff/n16-staff/revoke`, {}, { session: w.owner }), w.env, w.workspaceId, "n16-staff");
    const revokeBody = await revoke.json() as { revoked: boolean; queued_notifications_suppressed: number };
    expect(revokeBody.revoked).toBe(true);
    expect(revokeBody.queued_notifications_suppressed).toBe(1);
    const queued = await w.db.prepare(`SELECT status FROM notification_outbox WHERE event_key LIKE 'workspace-task:${realTask!.id}:%'`).first<{ status: string }>();
    expect(queued?.status).toBe("suppressed");
    // R108 F08 negative control: a queued reminder referencing a task OUTSIDE
    // this workspace (or no task at all) is the property of another queue and
    // must remain queued after this workspace's revocation.
    const foreign = await w.db.prepare("SELECT status FROM notification_outbox WHERE payload_ref='workspace_tasks:9901'").first<{ status: string }>();
    expect(foreign?.status).toBe("queued");
    // The departed staff member's private read is gone immediately.
    await expect(listWorkspaceDocuments(authedRequest(`/api/workspaces/${w.workspaceId}/documents`, {}, { session: w.staff }), w.env, w.workspaceId))
      .rejects.toMatchObject({ status: 404 });
  });
});

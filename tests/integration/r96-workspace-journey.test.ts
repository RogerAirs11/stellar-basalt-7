import { describe, expect, it } from "vitest";
import {
  createWorkspace, addWorkspaceHorse, assignWorkspaceStaff, revokeWorkspaceStaff,
  createWorkspaceTask, completeWorkspaceTask, workspaceDashboard, exportWorkspaceCsv, listWorkspaceTasks,
} from "../../src/api/modules/workspaces";
import { cancelOrder } from "../../src/api/modules/billing";
import { enqueueDueTaskReminders } from "../../src/workspaces/reminders";
import { localDateInZone } from "../../src/workspaces/domain";
import { drainNotificationOutbox } from "../../src/notifications/worker";
import {
  openRealDatabase, seedUser, makeSession, authedRequest, seedBillingPrices,
  createOrder, reserveAttempt, verifyOrder, countRows, withFakedFetch, type AuthedSession,
} from "../helpers/realDatabase";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * R96-N09 acceptance — ONE real paid workspace journey, end to end.
 *
 *  A. The happy path: a new owner creates an organization, pays for the farm
 *     plan (provider-verified), gets the org-held entitlement, creates the
 *     workspace, adds horses, invites staff, creates timezone-aware recurring
 *     reminders, completes one (the next occurrence materializes exactly
 *     once) and sees due/overdue buckets in each task's own timezone.
 *  B. Renewal and expiry: the renewed plan extends access; after expiry the
 *     workspace is READ-ONLY (writes refuse with a renewal pointer; reads
 *     and CSV export keep working; NO data is lost) — and renewal restores
 *     writes on the next request.
 *  C. Staff lifecycle: a revoked staff member loses reads AND writes; a
 *     view-only staff member cannot manage; membership is checked live.
 *  D. Delivery integration: due reminders enqueue exactly once per
 *     (task, due date) through the outbox and dispatch through the real
 *     notification worker (acceptance, not delivery).
 *  E. Customer support alongside: an unpaid order can be cancelled honestly.
 *
 * (Exact capacity races under concurrency are pinned by
 * tests/integration/workspace-concurrency.test.ts — R95-N08.)
 */

const env = (db: D1Database) => ({ DB: db, SESSION_COOKIE_NAME: "hr_session" }) as never;
const EMAIL_ENV = { EMAIL_API_URL: "https://email.example/send", EMAIL_API_KEY: "key-1", EMAIL_FROM: "registry@example.test" };
const NOW = () => new Date().toISOString();

async function paidOrgWorld(db: D1Database, key: string) {
  await seedUser(db, "farm-owner", "user");
  await seedUser(db, "staff-1", "user");
  await seedUser(db, "viewer-1", "user");
  await seedBillingPrices(db);
  await db.exec(`
    INSERT INTO organizations(id,slug,name_native,name_latin) VALUES(7,'sunrise-farm','مزرعه طلوع','Sunrise Farm');
    INSERT INTO organization_memberships(organization_id,user_id,role,status,valid_from)
    VALUES(7,'farm-owner','owner','active','2026-01-01 00:00:00');
  `);
  const owner = await makeSession(db, "farm-owner");
  // The paid order (organization payer) through the REAL commands.
  const order = (await createOrder(db, { buyer: "farm-owner", key, organizationId: 7 }))!;
  const { attemptId } = await reserveAttempt(db, order.id, "farm-owner");
  await verifyOrder(db, order, attemptId!, crypto.randomUUID(), NOW());
  return { owner, order, attemptId, orgId: 7 };
}

describe("N09 A. the happy path: one paid journey end to end", () => {
  it("organization selection -> paid order -> verified entitlement -> useful workspace action -> reminder lifecycle", async () => {
    const db = await openRealDatabase();
    const { owner } = await paidOrgWorld(db, "n09-journey-1");
    // The org holds a live entitlement.
    expect(await countRows(db, "entitlements", "holder_key='org:7' AND active=1")).toBe(1);

    // Workspace selection + creation (the org context).
    const created = await createWorkspace(authedRequest("/api/workspaces", {
      name: "Sunrise working herd", organization_id: 7,
    }, { session: owner }), env(db));
    expect(created.status).toBe(201);
    const workspaceId = ((await created.json()) as { workspace: { id: number } }).workspace.id;

    // Horse addition (the useful workspace action with correct access).
    await db.exec("INSERT INTO horses(id,name_latin,sex_desc,birth_date) VALUES(41,'Journey Horse','Mare','2019-04-01')");
    const added = await addWorkspaceHorse(authedRequest(`/api/workspaces/${workspaceId}/horses`, { horse_id: 41 }, { session: owner }), env(db), workspaceId);
    expect(added.status).toBe(201);

    // Staff invitation with an explicit action-scoped grant.
    const staff = await assignWorkspaceStaff(authedRequest(`/api/workspaces/${workspaceId}/staff`, { user_id: "staff-1", actions: "view,tasks_manage" }, { session: owner }), env(db), workspaceId);
    expect(staff.status).toBe(201);

    // Timezone-aware recurring reminder.
    const tehranToday = localDateInZone("Asia/Tehran", NOW());
    const task = await createWorkspaceTask(authedRequest(`/api/workspaces/${workspaceId}/tasks`, {
      title: "Hoof trimming rotation", category: "farrier", horse_id: 41,
      due_date: tehranToday, recurrence: "custom_days", recurrence_interval_days: 30,
      due_timezone: "Asia/Tehran",
    }, { session: owner }), env(db), workspaceId);
    expect(task.status).toBe(201);
    const taskBody = await task.json() as { task: { due_date: string } };
    expect(taskBody.task.due_date).toBe(tehranToday);

    // Completion materializes the next occurrence exactly once.
    const taskId = (await db.prepare("SELECT id FROM workspace_tasks WHERE collection_id=?").bind(workspaceId).first<{ id: number }>())!.id;
    const version = (await db.prepare("SELECT row_version FROM workspace_tasks WHERE id=?").bind(taskId).first<{ row_version: number }>())!.row_version;
    const completed = await completeWorkspaceTask(authedRequest(`/api/workspaces/${workspaceId}/tasks/${taskId}/complete`, { expected_version: version }, { session: owner }), env(db), workspaceId, taskId);
    expect(completed.status).toBe(200);
    const completedBody = await completed.json() as { next_occurrence: { due_date: string } | null };
    expect(completedBody.next_occurrence?.due_date).toBeTruthy();
    expect(await countRows(db, "workspace_tasks", `collection_id=${workspaceId}`)).toBe(2); // done + next open

    // The dashboard shows the buckets (reads work for the manager).
    const dashboard = await workspaceDashboard(authedRequest(`/api/workspaces/${workspaceId}`, undefined, { method: "GET", session: owner }), env(db), workspaceId);
    expect(dashboard.status).toBe(200);
    const dash = await dashboard.json() as { herd_size: number; tasks: { overdue: unknown[]; due_soon: unknown[]; later: unknown[] }; active_staff: Array<{ user_id: string }> };
    expect(dash.herd_size).toBe(1);
    expect(dash.active_staff).toHaveLength(1);
    expect(dash.tasks.overdue.length + dash.tasks.due_soon.length + dash.tasks.later.length).toBe(1);
  });

  it("a view-only staff member cannot manage: strict action parsing, no blanket access", async () => {
    const db = await openRealDatabase();
    const { owner } = await paidOrgWorld(db, "n09-viewonly-1");
    const created = await createWorkspace(authedRequest("/api/workspaces", { name: "ViewOnly herd", organization_id: 7 }, { session: owner }), env(db));
    const workspaceId = ((await created.json()) as { workspace: { id: number } }).workspace.id;
    await assignWorkspaceStaff(authedRequest(`/api/workspaces/${workspaceId}/staff`, { user_id: "viewer-1", actions: "view" }, { session: owner }), env(db), workspaceId);
    const viewer = await makeSession(db, "viewer-1");
    // View works.
    const dashboard = await workspaceDashboard(authedRequest(`/api/workspaces/${workspaceId}`, undefined, { method: "GET", session: viewer }), env(db), workspaceId);
    expect(dashboard.status).toBe(200);
    // Management refuses (view-only is not tasks_manage).
    const tehranToday = localDateInZone("Asia/Tehran", NOW());
    await expect(createWorkspaceTask(authedRequest(`/api/workspaces/${workspaceId}/tasks`, {
      title: "Should refuse", category: "other", due_date: tehranToday,
    }, { session: viewer }), env(db), workspaceId)).rejects.toMatchObject({ status: 404 });
  });
});

describe("N09 B. renewal, expiry read-only, and data preservation", () => {
  it("after expiry the workspace is READ-ONLY (writes refuse, reads + export stay, nothing is lost); renewal restores writes", async () => {
    const db = await openRealDatabase();
    const { owner } = await paidOrgWorld(db, "n09-expiry-1");
    const created = await createWorkspace(authedRequest("/api/workspaces", { name: "Expiry herd", organization_id: 7 }, { session: owner }), env(db));
    const workspaceId = ((await created.json()) as { workspace: { id: number } }).workspace.id;
    await db.exec("INSERT INTO horses(id,name_latin,sex_desc,birth_date) VALUES(51,'Expiry Horse','Mare','2018-02-02')");
    await addWorkspaceHorse(authedRequest(`/api/workspaces/${workspaceId}/horses`, { horse_id: 51 }, { session: owner }), env(db), workspaceId);
    await createWorkspaceTask(authedRequest(`/api/workspaces/${workspaceId}/tasks`, {
      title: "Renew passport", category: "document_renewal", due_date: localDateInZone("Asia/Tehran", NOW()), due_timezone: "Asia/Tehran",
    }, { session: owner }), env(db), workspaceId);
    expect(await countRows(db, "workspace_tasks", `collection_id=${workspaceId}`)).toBe(1);

    // Expire the plan (natural expiry: the entitlement interval ends).
    await db.exec("UPDATE entitlements SET expires_at=datetime('now','-1 day') WHERE holder_key='org:7' AND active=1");

    // Writes refuse with the honest renewal pointer...
    const tehranToday = localDateInZone("Asia/Tehran", NOW());
    await expect(createWorkspaceTask(authedRequest(`/api/workspaces/${workspaceId}/tasks`, {
      title: "Post-expiry task", category: "other", due_date: tehranToday,
    }, { session: owner }), env(db), workspaceId)).rejects.toMatchObject({ status: 403, code: "workspace_plan_expired" });
    await expect(addWorkspaceHorse(authedRequest(`/api/workspaces/${workspaceId}/horses`, { horse_id: 52 }, { session: owner }), env(db), workspaceId))
      .rejects.toMatchObject({ status: 403, code: "workspace_plan_expired" });
    await db.exec("INSERT INTO horses(id,name_latin,sex_desc,birth_date) VALUES(52,'Second Horse','Stallion','2017-01-01')");

    // ...but reads, listings and the CSV export keep working, and NOTHING was lost.
    const dashboard = await workspaceDashboard(authedRequest(`/api/workspaces/${workspaceId}`, undefined, { method: "GET", session: owner }), env(db), workspaceId);
    expect(dashboard.status).toBe(200);
    const tasks = await listWorkspaceTasks(authedRequest(`/api/workspaces/${workspaceId}/tasks`, undefined, { method: "GET", session: owner }), env(db), workspaceId);
    expect(tasks.status).toBe(200);
    const csv = await exportWorkspaceCsv(authedRequest(`/api/workspaces/${workspaceId}/export`, undefined, { method: "GET", session: owner }), env(db), workspaceId);
    expect(csv.status).toBe(200);
    expect(await countRows(db, "workspace_tasks", `collection_id=${workspaceId}`)).toBe(1); // preserved
    expect(await countRows(db, "workspace_collection_members", `collection_id=${workspaceId}`)).toBe(1); // preserved

    // Renewal (a new verified payment) restores writes on the NEXT request.
    const renewalOrder = (await createOrder(db, { buyer: "farm-owner", key: "n09-renewal-1", organizationId: 7 }))!;
    const { attemptId } = await reserveAttempt(db, renewalOrder.id, "farm-owner");
    await verifyOrder(db, renewalOrder, attemptId!, crypto.randomUUID(), NOW());
    expect(await countRows(db, "entitlements", "holder_key='org:7' AND active=1")).toBe(1);
    const postRenewal = await createWorkspaceTask(authedRequest(`/api/workspaces/${workspaceId}/tasks`, {
      title: "Post-renewal task", category: "other", due_date: tehranToday,
    }, { session: owner }), env(db), workspaceId);
    expect(postRenewal.status).toBe(201);
  });

  it("an organization that NEVER paid keeps the free-tier path (no read-only trap)", async () => {
    const db = await openRealDatabase();
    await seedUser(db, "free-owner", "user");
    await db.exec(`
      INSERT INTO organizations(id,slug,name_native,name_latin) VALUES(9,'free-farm','مزرعه آزاد','Free Farm');
      INSERT INTO organization_memberships(organization_id,user_id,role,status,valid_from)
      VALUES(9,'free-owner','owner','active','2026-01-01 00:00:00');
    `);
    const owner = await makeSession(db, "free-owner");
    const created = await createWorkspace(authedRequest("/api/workspaces", { name: "Free herd", organization_id: 9 }, { session: owner }), env(db));
    expect(created.status).toBe(201);
    const workspaceId = ((await created.json()) as { workspace: { id: number } }).workspace.id;
    const task = await createWorkspaceTask(authedRequest(`/api/workspaces/${workspaceId}/tasks`, {
      title: "Free-tier reminder", category: "other", due_date: localDateInZone("Asia/Tehran", NOW()),
    }, { session: owner }), env(db), workspaceId);
    expect(task.status).toBe(201); // never-paid orgs are not read-only
  });
});

describe("N09 C. staff lifecycle — revoked staff lose reads AND writes", () => {
  it("revocation removes every access surface immediately", async () => {
    const db = await openRealDatabase();
    const { owner } = await paidOrgWorld(db, "n09-revoke-1");
    const created = await createWorkspace(authedRequest("/api/workspaces", { name: "Revoke herd", organization_id: 7 }, { session: owner }), env(db));
    const workspaceId = ((await created.json()) as { workspace: { id: number } }).workspace.id;
    await assignWorkspaceStaff(authedRequest(`/api/workspaces/${workspaceId}/staff`, { user_id: "staff-1", actions: "view,tasks_manage" }, { session: owner }), env(db), workspaceId);
    const staffSession = await makeSession(db, "staff-1");
    // Before revocation the staff member can read.
    expect((await workspaceDashboard(authedRequest(`/api/workspaces/${workspaceId}`, undefined, { method: "GET", session: staffSession }), env(db), workspaceId)).status).toBe(200);
    // Revoke.
    const revoked = await revokeWorkspaceStaff(authedRequest(`/api/workspaces/${workspaceId}/staff/staff-1`, {}, { method: "DELETE", session: owner }), env(db), workspaceId, "staff-1");
    expect(revoked.status).toBe(200);
    // After revocation: no reads, no writes — live checks, no cached access.
    await expect(workspaceDashboard(authedRequest(`/api/workspaces/${workspaceId}`, undefined, { method: "GET", session: staffSession }), env(db), workspaceId))
      .rejects.toMatchObject({ status: 404 });
    await expect(createWorkspaceTask(authedRequest(`/api/workspaces/${workspaceId}/tasks`, {
      title: "Should refuse now", category: "other", due_date: localDateInZone("Asia/Tehran", NOW()),
    }, { session: staffSession }), env(db), workspaceId)).rejects.toMatchObject({ status: 404 });
  });
});

describe("N09 D. delivery integration — due reminders enqueue once and dispatch through the worker", () => {
  it("due-in-its-own-timezone reminders enqueue exactly once; not-yet-due do not; the worker accepts them", async () => {
    const db = await openRealDatabase();
    const { owner } = await paidOrgWorld(db, "n09-delivery-1");
    const created = await createWorkspace(authedRequest("/api/workspaces", { name: "Delivery herd", organization_id: 7 }, { session: owner }), env(db));
    const workspaceId = ((await created.json()) as { workspace: { id: number } }).workspace.id;
    const tehranToday = localDateInZone("Asia/Tehran", NOW());
    const newYorkTomorrow = (() => { const d = new Date(Date.now() + 36 * 3_600_000); return localDateInZone("America/New_York", d.toISOString()); })();
    // Task A: due TODAY in Tehran (due now). Task B: due TOMORROW in New York (not yet due).
    await createWorkspaceTask(authedRequest(`/api/workspaces/${workspaceId}/tasks`, {
      title: "Due today Tehran", category: "farrier", due_date: tehranToday, due_timezone: "Asia/Tehran",
    }, { session: owner }), env(db), workspaceId);
    await createWorkspaceTask(authedRequest(`/api/workspaces/${workspaceId}/tasks`, {
      title: "Due tomorrow New York", category: "other", due_date: newYorkTomorrow, due_timezone: "America/New_York",
    }, { session: owner }), env(db), workspaceId);

    const first = await enqueueDueTaskReminders(db, NOW());
    expect(first.enqueued).toBe(1); // only the due-today Tehran task
    expect(await countRows(db, "notification_outbox", "purpose='workspace_task_due'")).toBe(1);
    // Idempotent: the retry enqueues nothing.
    const second = await enqueueDueTaskReminders(db, NOW());
    expect(second.enqueued).toBe(0);
    expect(await countRows(db, "notification_outbox", "purpose='workspace_task_due'")).toBe(1);

    // The real worker dispatches it (acceptance, not delivery).
    const restore = withFakedFetch((_url, init) => {
      expect((init?.headers as Record<string, string>)["idempotency-key"]).toContain("workspace-task:");
      return new Response(JSON.stringify({ id: "ws-task-1" }), { status: 200 });
    });
    try {
      const summary = await drainNotificationOutbox(db, { ...EMAIL_ENV } as never);
      expect(summary.provider_accepted).toBe(1);
      const row = await db.prepare("SELECT status FROM notification_outbox WHERE purpose='workspace_task_due'").first<{ status: string }>();
      expect(row?.status).toBe("provider_accepted");
    } finally { restore(); }
  });
});

describe("N09 D2. reminder body safety — user-entered text never rides raw HTML", () => {
  it("task titles with markup are HTML-escaped in the email body (injection pin)", async () => {
    const { workspaceTaskReminderBody } = await import("../../src/workspaces/reminders");
    const body = workspaceTaskReminderBody({
      title: `Deworm <script>alert("x")</script> & "herd"`,
      category: "health", due_date: "2026-10-05", workspace_name: `<b>Farm</b>`,
    });
    expect(body.html).not.toContain("<script>");
    expect(body.html).not.toContain("<b>Farm</b>");
    expect(body.html).toContain("&lt;script&gt;");
    expect(body.html).toContain("&amp;");
    expect(body.html).toContain("&quot;herd&quot;");
  });
});

describe("N09 E. customer support alongside the happy path", () => {
  it("an unpaid order can be cancelled honestly (state change, never a delete)", async () => {
    const db = await openRealDatabase();
    await seedUser(db, "support-buyer", "user");
    await seedUser(db, "admin-1", "admin");
    await seedBillingPrices(db);
    const admin = await makeSession(db, "admin-1");
    const order = (await createOrder(db, { buyer: "support-buyer", key: "n09-cancel-1" }))!;
    const cancel = await cancelOrder(authedRequest(`/api/billing/orders/${order.id}/cancel`, {}, { method: "POST", session: admin }), env(db), order.id);
    expect(cancel.status).toBe(200);
    const row = await db.prepare("SELECT status FROM orders WHERE id=?").bind(order.id).first<{ status: string }>();
    expect(row?.status).toBe("cancelled"); // a state, not a delete
    expect(await countRows(db, "orders", `id=${order.id}`)).toBe(1);
  });
});

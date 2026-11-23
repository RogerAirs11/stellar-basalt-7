import { describe, expect, it } from "vitest";
import workerDefault from "../../src/worker";
import {
  openRealDatabase, seedUser, makeSession, authedRequest, countRows, type AuthedSession,
} from "../helpers/realDatabase";
import { revokeStaffStatements } from "../../src/workspaces/mutationCommands";
import {
  suppressQueuedWorkspaceNotificationsStatement, MAX_ACTIVE_STAFF_PER_COLLECTION_N16,
} from "../../src/workspaces/collaboration";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * R108-07: workspace collaboration SQL certified through the REAL Worker
 * router (src/worker.ts — the module Cloudflare deploys) over a REAL SQLite
 * database with EVERY migration applied and foreign keys enforced. No SQL
 * recorder stands in for the database and no handler is called directly:
 * every request travels the real route table, the real Zod schemas, the real
 * auth/CSRF guards and the real D1 batch boundary (BEGIN/COMMIT/ROLLBACK).
 *
 * Certified acceptance, after success AND after every refusal:
 *  A. invite accept/decline, staff capacity, inactive inviter, lost inviter
 *     authority — a refused acceptance never creates an assignment or audit;
 *  B. two same-version reassignment commands race: exactly one wins, the
 *     row_version advances ONCE, and a 409 carries current_version only for
 *     a still-authorized caller (a revoked caller learns nothing);
 *  C. staff departure in ONE workspace suppresses only that workspace's
 *     QUEUED reminders in the SAME atomic batch, and a middle-of-batch
 *     failure rolls back assignment state, audit and suppression together;
 *  D. invalid Gregorian dates and recurrence combinations are bounded 400s
 *     (never 500s) and write nothing — no import: occurrence key survives a
 *     refused import; a valid import never overwrites an existing occurrence.
 */

const worker = workerDefault as unknown as {
  fetch(request: Request, env: unknown): Promise<Response>;
};

const limiter = { limit: async () => ({ success: true }) };

function makeEnv(db: D1Database) {
  return {
    APP_ENV: "production",
    DB_PROVIDER_MODE: "d1_only", // R102: these tests exercise the D1 binding explicitly
    SESSION_COOKIE_NAME: "hr_session",
    DB: db,
    ASSETS: { fetch: async () => new Response("<html>") },
    PUBLIC_RATE_LIMITER: limiter,
    AUTH_RATE_LIMITER: limiter,
    EXPENSIVE_RATE_LIMITER: limiter,
    WRITE_RATE_LIMITER: limiter,
    ACCOUNT_RATE_LIMITER: limiter,
  } as unknown as Env;
}

async function call(db: D1Database, request: Request): Promise<Response> {
  return worker.fetch(request, makeEnv(db));
}

interface ErrorBody { error?: { code?: string; message?: string; details?: { current_version?: number } } }

async function readError(response: Response): Promise<ErrorBody> {
  return await response.json() as ErrorBody;
}

async function row<T>(db: D1Database, sql: string, ...args: unknown[]): Promise<T | null> {
  return await db.prepare(sql).bind(...args).first<T>();
}

async function scalar(db: D1Database, sql: string, ...args: unknown[]): Promise<number> {
  const found = await row<{ n: number }>(db, `SELECT COUNT(*) AS n FROM ${sql}`, ...args);
  return Number(found?.n ?? 0);
}

/** A fresh world: owner + invited-capable staff + outsider, all with REAL sessions. */
async function world(db: D1Database) {
  await seedUser(db, "owner-1", "user");
  await seedUser(db, "staff-1", "user");
  await seedUser(db, "outsider-1", "user");
  const owner = await makeSession(db, "owner-1");
  const staff = await makeSession(db, "staff-1");
  const outsider = await makeSession(db, "outsider-1");
  return { owner, staff, outsider };
}

/** An active farm-workspace plan so a holder may create paid-tier collections. */
async function seedFarmPlan(db: D1Database, userId: string): Promise<void> {
  await db.exec(`INSERT INTO orders(id,order_key,buyer_user_id,status,total_minor,currency,price_snapshot_json)
      VALUES(1,'r108-ws-order-1','${userId}','paid',1000000,'IRR','[]');
    INSERT INTO payment_attempts(id,order_id,provider,authority,amount_minor,state,verified_at)
      VALUES(1,1,'zarinpal','r108-ws-auth-1',1000000,'verified','2026-01-01 00:00:00');
    INSERT INTO entitlement_events(id,event_key,order_id,payment_attempt_id,buyer_user_id,sku,kind,granted_days,activated_at,expires_at,grant_scope,grant_source,provider_name)
      VALUES(1,'r108-ws-evt-1',1,1,'${userId}','farm_workspace_monthly','grant',30,'2026-01-01 00:00:00','2099-01-01 00:00:00','production','verified_payment','zarinpal');
    INSERT INTO entitlements(id,buyer_user_id,holder_key,sku,source_event_id,active,activated_at,expires_at,grant_scope)
      VALUES(1,'${userId}','user:${userId}','farm_workspace_monthly',1,1,'2026-01-01 00:00:00','2099-01-01 00:00:00','production')`);
}

async function createWorkspace(db: D1Database, session: AuthedSession, name: string): Promise<number> {
  const response = await call(db, authedRequest("/api/workspaces", { name }, { session }));
  expect(response.status).toBe(201);
  const body = await response.json() as { workspace: { id: number } };
  return body.workspace.id;
}

async function invite(db: D1Database, session: AuthedSession, workspaceId: number, inviteeId: string): Promise<Response> {
  return call(db, authedRequest(`/api/workspaces/${workspaceId}/invites`, { invitee_user_id: inviteeId, actions: "view,tasks_manage" }, { session }));
}

async function respond(db: D1Database, session: AuthedSession, workspaceId: number, action: "accept" | "decline"): Promise<Response> {
  return call(db, authedRequest(`/api/workspaces/invites/${workspaceId}/respond`, { action }, { session }));
}

async function assignStaff(db: D1Database, session: AuthedSession, workspaceId: number, userId: string): Promise<Response> {
  return call(db, authedRequest(`/api/workspaces/${workspaceId}/staff`, { user_id: userId, actions: "view,tasks_manage" }, { session }));
}

async function createTask(db: D1Database, session: AuthedSession, workspaceId: number, body: Record<string, unknown>): Promise<Response> {
  return call(db, authedRequest(`/api/workspaces/${workspaceId}/tasks`, body, { session }));
}

async function reassign(db: D1Database, session: AuthedSession, workspaceId: number, taskId: number, assignedTo: string | null, expectedVersion?: number): Promise<Response> {
  return call(db, authedRequest(`/api/workspaces/${workspaceId}/tasks/${taskId}/reassign`, {
    assigned_to_user_id: assignedTo, ...(expectedVersion === undefined ? {} : { expected_version: expectedVersion }),
  }, { session }));
}

function outboxSeed(db: D1Database, key: string, recipient: string, status: string, payloadRef: string): Promise<unknown> {
  return db.prepare(
    "INSERT INTO notification_outbox(event_key,channel,purpose,recipient_user_id,recipient_masked,status,payload_ref) VALUES(?,?,?,?,?,?,?)",
  ).bind(key, "email", "workspace_task_reminder", recipient, "m***@x.com", status, payloadRef).run();
}

// ---------------------------------------------------------------------------
// A. Invitations through the real routes
// ---------------------------------------------------------------------------

describe("R108-07 A. invite accept/decline through real HTTP", () => {
  it("acceptance creates exactly ONE audited assignment; a repeat accept is an honest 409 and duplicates nothing", async () => {
    const db = await openRealDatabase();
    const { owner, outsider } = await world(db);
    const workspaceId = await createWorkspace(db, owner, "Invite herd");

    const invited = await invite(db, owner, workspaceId, "outsider-1");
    expect(invited.status).toBe(201);
    // The invitee sees their own pending invitation through the real list route.
    const mine = await call(db, authedRequest("/api/workspaces/invites/mine", undefined, { session: outsider }));
    expect(mine.status).toBe(200);
    const listed = await mine.json() as { rows: Array<{ collection_id: number; proposed_actions: string }> };
    expect(listed.rows).toHaveLength(1);
    expect(listed.rows[0].collection_id).toBe(workspaceId);
    expect(listed.rows[0].proposed_actions).toBe("view,tasks_manage");

    const accepted = await respond(db, outsider, workspaceId, "accept");
    expect(accepted.status).toBe(200);
    const acceptedBody = await accepted.json() as { accepted: boolean; actions: string[] };
    expect(acceptedBody.accepted).toBe(true);
    expect(acceptedBody.actions).toEqual(["view", "tasks_manage"]);

    const assignment = await row<{ status: string; actions: string; granted_by_user_id: string }>(
      db, "SELECT status,actions,granted_by_user_id FROM workspace_staff_assignments WHERE collection_id=? AND user_id='outsider-1'", workspaceId);
    expect(assignment?.status).toBe("active");
    expect(assignment?.actions).toBe("view,tasks_manage");
    expect(assignment?.granted_by_user_id).toBe("owner-1");
    expect(await scalar(db, "workspace_staff_assignments WHERE collection_id=?", workspaceId)).toBe(1);
    expect(await scalar(db, "audit_events WHERE action='workspace.staff_invite_accepted'")).toBe(1);

    // A second acceptance is refused before any SQL: one row stays one row.
    const repeat = await respond(db, outsider, workspaceId, "accept");
    expect(repeat.status).toBe(409);
    expect((await readError(repeat)).error?.code).toBe("already_responded");
    expect(await scalar(db, "workspace_staff_assignments WHERE collection_id=?", workspaceId)).toBe(1);
    expect(await scalar(db, "audit_events WHERE action='workspace.staff_invite_accepted'")).toBe(1);
  });

  it("decline creates NO assignment; a fresh invitation after a decline can still be accepted", async () => {
    const db = await openRealDatabase();
    const { owner, outsider } = await world(db);
    const workspaceId = await createWorkspace(db, owner, "Decline herd");

    expect((await invite(db, owner, workspaceId, "outsider-1")).status).toBe(201);
    const declined = await respond(db, outsider, workspaceId, "decline");
    expect(declined.status).toBe(200);
    expect((await declined.json() as { accepted: boolean }).accepted).toBe(false);
    expect(await scalar(db, "workspace_staff_assignments WHERE collection_id=?", workspaceId)).toBe(0);
    expect(await scalar(db, "audit_events WHERE action='workspace.staff_invite_declined'")).toBe(1);

    // The workspace manager can issue a FRESH invitation after the decline.
    expect((await invite(db, owner, workspaceId, "outsider-1")).status).toBe(201);
    const accepted = await respond(db, outsider, workspaceId, "accept");
    expect(accepted.status).toBe(200);
    expect(await scalar(db, "workspace_staff_assignments WHERE collection_id=? AND user_id='outsider-1'", workspaceId)).toBe(1);
  });

  it("over-capacity acceptance cannot grant membership (invite stays pending, no audit)", async () => {
    const db = await openRealDatabase();
    const { owner, outsider } = await world(db);
    const workspaceId = await createWorkspace(db, owner, "Full herd");
    // Fill every active seat directly (capacity is read INSIDE the accept INSERT..SELECT).
    for (let n = 0; n < MAX_ACTIVE_STAFF_PER_COLLECTION_N16; n++) {
      await db.prepare(
        "INSERT INTO workspace_staff_assignments(collection_id,user_id,actions,status,granted_by_user_id) VALUES(?,?,'view','active','owner-1')",
      ).bind(workspaceId, `seat-${n}`).run();
    }
    expect((await invite(db, owner, workspaceId, "outsider-1")).status).toBe(201);

    const accepted = await respond(db, outsider, workspaceId, "accept");
    expect(accepted.status).toBe(409);
    expect((await readError(accepted)).error?.code).toBe("invite_not_acceptable");
    expect(await scalar(db, "workspace_staff_assignments WHERE collection_id=? AND user_id='outsider-1'", workspaceId)).toBe(0);
    expect(await scalar(db, "workspace_staff_assignments WHERE collection_id=?", workspaceId)).toBe(MAX_ACTIVE_STAFF_PER_COLLECTION_N16);
    expect(await scalar(db, "audit_events WHERE action='workspace.staff_invite_accepted'")).toBe(0);
    const inviteRow = await row<{ status: string }>(db, "SELECT status FROM workspace_staff_invites WHERE collection_id=?", workspaceId);
    expect(inviteRow?.status).toBe("pending"); // honestly retryable after a seat frees up
  });

  it("an INACTIVE inviter or a lost inviter authority cannot grant membership through acceptance", async () => {
    const db = await openRealDatabase();
    const { owner, outsider } = await world(db);
    const workspaceId = await createWorkspace(db, owner, "Inactive inviter");
    expect((await invite(db, owner, workspaceId, "outsider-1")).status).toBe(201);

    // The inviter's account is deactivated AFTER the invitation was sent.
    await db.prepare("UPDATE users SET is_active=0 WHERE id='owner-1'").run();
    const accepted = await respond(db, outsider, workspaceId, "accept");
    expect(accepted.status).toBe(409);
    expect((await readError(accepted)).error?.code).toBe("invite_not_acceptable");
    expect(await scalar(db, "workspace_staff_assignments WHERE collection_id=?", workspaceId)).toBe(0);
    expect(await scalar(db, "audit_events WHERE action='workspace.staff_invite_accepted'")).toBe(0);

    // Same boundary for a transferred personal workspace: the inviter is no
    // longer the owner, so their stale invitation grants nothing.
    await db.prepare("UPDATE users SET is_active=1 WHERE id='owner-1'").run();
    await db.prepare("UPDATE workspace_collections SET owner_user_id='staff-1' WHERE id=?").bind(workspaceId).run();
    const acceptedAfterTransfer = await respond(db, outsider, workspaceId, "accept");
    expect(acceptedAfterTransfer.status).toBe(409);
    expect((await readError(acceptedAfterTransfer)).error?.code).toBe("invite_not_acceptable");
    expect(await scalar(db, "workspace_staff_assignments WHERE collection_id=?", workspaceId)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// B. Reassignment races and the version-disclosure boundary
// ---------------------------------------------------------------------------

describe("R108-07 B. reassignment: one winner per version, versions never leaked", () => {
  async function taskWorld(db: D1Database) {
    const { owner, staff, outsider } = await world(db);
    const workspaceId = await createWorkspace(db, owner, "Race herd");
    expect((await assignStaff(db, owner, workspaceId, "staff-1")).status).toBe(201);
    const created = await createTask(db, owner, workspaceId, { title: "Hoof trim", category: "farrier", due_date: "2026-11-01" });
    expect(created.status).toBe(201);
    const task = await row<{ id: number; row_version: number }>(
      db, "SELECT id,row_version FROM workspace_tasks WHERE collection_id=? ORDER BY id DESC LIMIT 1", workspaceId);
    return { owner, staff, outsider, workspaceId, taskId: Number(task!.id), version: Number(task!.row_version) };
  }

  it("two same-version reassignment commands race: exactly ONE wins, version advances ONCE, one audit", async () => {
    const db = await openRealDatabase();
    const w = await taskWorld(db);
    expect(w.version).toBe(1);

    // Two commands carrying the SAME task version, from two authorized
    // principals, in flight simultaneously. Whatever the interleaving, only
    // one UPDATE can match the version guard.
    const settled = await Promise.allSettled([
      reassign(db, w.owner, w.workspaceId, w.taskId, "staff-1", 1),
      reassign(db, w.staff, w.workspaceId, w.taskId, null, 1),
    ]);
    const responses = settled.map((r) => (r.status === "fulfilled" ? r.value : null)) as Response[];
    const statuses = responses.map((r) => r?.status ?? 0).sort();
    expect(statuses).toEqual([200, 409]);

    const winner = responses.find((r) => r?.status === 200)!;
    const loser = responses.find((r) => r?.status === 409)!;
    const winnerBody = await winner.json() as { reassigned: boolean; row_version: number };
    expect(winnerBody.reassigned).toBe(true);
    expect(winnerBody.row_version).toBe(2);
    // The still-authorized loser learns the CURRENT version so it can retry.
    const loserBody = await readError(loser);
    expect(loserBody.error?.code).toBe("task_version_conflict");
    expect(loserBody.error?.details?.current_version).toBe(2);

    const task = await row<{ row_version: number; assigned_to_user_id: string | null }>(
      db, "SELECT row_version,assigned_to_user_id FROM workspace_tasks WHERE id=?", w.taskId);
    expect(Number(task?.row_version)).toBe(2); // advanced exactly ONCE
    expect(await scalar(db, "audit_events WHERE action='workspace.task_reassigned'")).toBe(1);
  });

  it("a REVOKED caller learns nothing: 404 without any current version; an unauthorized ASSIGNEE gets 403 without a version", async () => {
    const db = await openRealDatabase();
    const w = await taskWorld(db);

    // The staff member's assignment is revoked through the real route BEFORE
    // their command: authorize() hides the workspace (404), and the body must
    // not disclose the task's private current version.
    const revoked = await call(db, authedRequest(`/api/workspaces/${w.workspaceId}/staff/staff-1/revoke`, {}, { session: w.owner }));
    expect(revoked.status).toBe(200);
    const afterRevoke = await reassign(db, w.staff, w.workspaceId, w.taskId, null, 1);
    expect(afterRevoke.status).toBe(404);
    const revokeBody = await readError(afterRevoke);
    expect(revokeBody.error?.code).toBe("not_found");
    expect(JSON.stringify(revokeBody)).not.toContain("current_version");

    // The owner (still authorized) targets an assignee WITHOUT workspace
    // access: the write refuses with 403 and never leaks the version, and
    // the task is untouched (no audit, same version).
    const before = await row<{ row_version: number }>(db, "SELECT row_version FROM workspace_tasks WHERE id=?", w.taskId);
    const toOutsider = await reassign(db, w.owner, w.workspaceId, w.taskId, "outsider-1", Number(before!.row_version));
    expect(toOutsider.status).toBe(403);
    const outsiderBody = await readError(toOutsider);
    expect(outsiderBody.error?.code).toBe("assignee_not_authorized");
    expect(JSON.stringify(outsiderBody)).not.toContain("current_version");
    const after = await row<{ row_version: number; assigned_to_user_id: string | null }>(
      db, "SELECT row_version,assigned_to_user_id FROM workspace_tasks WHERE id=?", w.taskId);
    expect(Number(after?.row_version)).toBe(Number(before!.row_version));
    expect(await scalar(db, "audit_events WHERE action='workspace.task_reassigned'")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// C. Departure suppression is scoped, reported and atomic
// ---------------------------------------------------------------------------

describe("R108-07 C. staff departure suppression: scoped to ONE workspace, atomic batch", () => {
  async function twoWorkspaceWorld(db: D1Database) {
    const { owner, staff } = await world(db);
    await seedFarmPlan(db, "owner-1"); // the second collection needs an active plan
    const w1 = await createWorkspace(db, owner, "Alpha herd");
    const w2 = await createWorkspace(db, owner, "Beta herd");
    expect((await assignStaff(db, owner, w1, "staff-1")).status).toBe(201);
    expect((await assignStaff(db, owner, w2, "staff-1")).status).toBe(201);
    expect((await createTask(db, owner, w1, { title: "Alpha task", category: "other", due_date: "2026-11-02" })).status).toBe(201);
    expect((await createTask(db, owner, w2, { title: "Beta task", category: "other", due_date: "2026-11-03" })).status).toBe(201);
    const t1 = await row<{ id: number }>(db, "SELECT id FROM workspace_tasks WHERE collection_id=? ORDER BY id DESC LIMIT 1", w1);
    const t2 = await row<{ id: number }>(db, "SELECT id FROM workspace_tasks WHERE collection_id=? ORDER BY id DESC LIMIT 1", w2);
    // A realistic mixed outbox: queued reminders in both workspaces, one
    // already-delivered row, one unrelated queued purpose, and another
    // recipient's queued reminder for the SAME task.
    await outboxSeed(db, "ev-w1-queued", "staff-1", "queued", `workspace_tasks:${t1!.id}`);
    await outboxSeed(db, "ev-w2-queued", "staff-1", "queued", `workspace_tasks:${t2!.id}`);
    await outboxSeed(db, "ev-w1-delivered", "staff-1", "delivered", `workspace_tasks:${t1!.id}`);
    await outboxSeed(db, "ev-unrelated", "staff-1", "queued", "other:17");
    await outboxSeed(db, "ev-owner-w1", "owner-1", "queued", `workspace_tasks:${t1!.id}`);
    return { owner, staff, w1, w2 };
  }

  it("revoking staff in workspace 1 suppresses ONLY that workspace's queued reminders, atomically, with an honest count", async () => {
    const db = await openRealDatabase();
    const { owner, staff, w1, w2 } = await twoWorkspaceWorld(db);

    const response = await call(db, authedRequest(`/api/workspaces/${w1}/staff/staff-1/revoke`, {}, { session: owner }));
    expect(response.status).toBe(200);
    const body = await response.json() as { revoked: boolean; queued_notifications_suppressed: number };
    expect(body.revoked).toBe(true);
    expect(body.queued_notifications_suppressed).toBe(1);

    const states = Object.fromEntries(
      (await db.prepare("SELECT event_key,status FROM notification_outbox ORDER BY event_key").all<{ event_key: string; status: string }>()).results
        .map((r) => [r.event_key, r.status]),
    );
    expect(states).toEqual({
      "ev-w1-queued": "suppressed",  // THIS workspace's queued reminder — gone
      "ev-w2-queued": "queued",      // the other workspace is untouched
      "ev-w1-delivered": "delivered",// already-processed mail is never rewritten
      "ev-unrelated": "queued",      // unrelated purpose is untouched
      "ev-owner-w1": "queued",       // another recipient's reminder survives
    });
    // The revocation itself is scoped: workspace 2's assignment stays active.
    const w1Assignment = await row<{ status: string }>(db, "SELECT status FROM workspace_staff_assignments WHERE collection_id=? AND user_id='staff-1'", w1);
    const w2Assignment = await row<{ status: string }>(db, "SELECT status FROM workspace_staff_assignments WHERE collection_id=? AND user_id='staff-1'", w2);
    expect(w1Assignment?.status).toBe("revoked");
    expect(w2Assignment?.status).toBe("active");
    expect(await scalar(db, "audit_events WHERE action='workspace.staff_revoked'")).toBe(1);

    // The departed staff member genuinely loses API access to workspace 1
    // while keeping it in workspace 2 (live re-authorization).
    const dashboard1 = await call(db, authedRequest(`/api/workspaces/${w1}`, undefined, { session: staff }));
    expect(dashboard1.status).toBe(404);
    const dashboard2 = await call(db, authedRequest(`/api/workspaces/${w2}`, undefined, { session: staff }));
    expect(dashboard2.status).toBe(200);
  });

  it("a middle-of-batch failure rolls back assignment state, audit AND suppression together (real transaction boundary)", async () => {
    const db = await openRealDatabase();
    const { owner, staff, w1 } = await twoWorkspaceWorld(db);

    // The EXACT statement sequence the route batches: lock, revoke-update,
    // audit, suppression — with a statement that violates the outbox channel
    // CHECK injected in the MIDDLE. The real adapter must roll the whole
    // batch back: no revocation, no suppression, no audit.
    const statements = revokeStaffStatements(db, {
      collectionId: w1, userId: "staff-1", actorUserId: "owner-1", operationId: crypto.randomUUID(),
    });
    const failing = db.prepare(
      "INSERT INTO notification_outbox(event_key,channel,purpose,recipient_masked) VALUES('mid-batch-kaboom','carrier_pigeon','test','***')",
    );
    // Capture the pre-batch marker so rollback is proven by UNCHANGED state.
    const beforeAssignment = await row<{ status: string; last_operation_id: string | null }>(
      db, "SELECT status,last_operation_id FROM workspace_staff_assignments WHERE collection_id=? AND user_id='staff-1'", w1);
    const beforeAudit = await scalar(db, "audit_events WHERE action='workspace.staff_revoked'");
    await expect(db.batch([
      statements[0], statements[1], failing, statements[2],
      suppressQueuedWorkspaceNotificationsStatement(db, "staff-1", w1),
    ])).rejects.toThrow();

    const assignment = await row<{ status: string; last_operation_id: string | null }>(
      db, "SELECT status,last_operation_id FROM workspace_staff_assignments WHERE collection_id=? AND user_id='staff-1'", w1);
    expect(assignment?.status).toBe("active");
    expect(assignment?.last_operation_id).toBe(beforeAssignment?.last_operation_id); // the failed revoke left no marker
    expect(await scalar(db, "audit_events WHERE action='workspace.staff_revoked'")).toBe(beforeAudit);
    const outbox = await row<{ status: string }>(db, "SELECT status FROM notification_outbox WHERE event_key='ev-w1-queued'");
    expect(outbox?.status).toBe("queued"); // suppression rolled back too
    expect(await scalar(db, "notification_outbox WHERE event_key='mid-batch-kaboom'")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// D. Bounded validation: dates, recurrence, and the no-overwrite import
// ---------------------------------------------------------------------------

describe("R108-07 D. bounded 400s for invalid dates/recurrence; no-overwrite import", () => {
  async function oneWorkspace(db: D1Database) {
    const { owner } = await world(db);
    return { owner, workspaceId: await createWorkspace(db, owner, "Validation herd") };
  }

  it("impossible Gregorian dates and recurrence combinations are bounded 400s that write NOTHING", async () => {
    const db = await openRealDatabase();
    const { owner, workspaceId } = await oneWorkspace(db);

    const badCases: Array<[string, Record<string, unknown>, string]> = [
      ["February 30th", { title: "Bad day", category: "other", due_date: "2026-02-30" }, "invalid_task"],
      ["month 13", { title: "Bad month", category: "other", due_date: "2026-13-01" }, "invalid_task"],
      ["2025 Feb 29 (not a leap year)", { title: "Bad leap", category: "other", due_date: "2025-02-29" }, "invalid_task"],
      ["custom_days without interval", { title: "Bad recurrence", category: "other", due_date: "2026-06-01", recurrence: "custom_days" }, "invalid_recurrence"],
    ];
    for (const [label, body, expectedCode] of badCases) {
      const response = await createTask(db, owner, workspaceId, body);
      expect(response.status, label).toBe(400);
      expect((await readError(response)).error?.code, label).toBe(expectedCode);
    }

    // Refused imports: impossible date, custom_days missing its interval, and
    // none WITH an interval. Every one is a bounded 400 (never a 500), and
    // not a single import: occurrence key may survive.
    const badImports: Array<[string, unknown[]]> = [
      ["import impossible date", [{ title: "Import bad day", category: "other", due_date: "2026-02-30" }]],
      ["import custom_days without interval", [{ title: "Import bad recurrence", category: "other", due_date: "2026-06-01", recurrence: "custom_days" }]],
      ["import none WITH interval", [{ title: "Import contradictory", category: "other", due_date: "2026-06-01", recurrence: "none", recurrence_interval_days: 7 }]],
    ];
    for (const [label, tasks] of badImports) {
      const response = await call(db, authedRequest(`/api/workspaces/${workspaceId}/tasks/import`, { tasks }, { session: owner }));
      expect(response.status, label).toBe(400);
      expect((await readError(response)).error?.code, label).toBe("invalid_import");
    }
    expect(await scalar(db, "workspace_tasks WHERE occurrence_key LIKE 'task:import:%'")).toBe(0);
    expect(await scalar(db, "workspace_tasks")).toBe(0);

    // Controls: a real leap day and a consistent recurrence are accepted.
    expect((await createTask(db, owner, workspaceId, { title: "Leap trim", category: "farrier", due_date: "2024-02-29" })).status).toBe(201);
    expect((await createTask(db, owner, workspaceId, { title: "Every 9 days", category: "other", due_date: "2026-06-01", recurrence: "custom_days", recurrence_interval_days: 9 })).status).toBe(201);
  });

  it("import never overwrites: an identical replay is skipped and reported; a different date is a NEW occurrence", async () => {
    const db = await openRealDatabase();
    const { owner, workspaceId } = await oneWorkspace(db);
    const payload = { tasks: [{ title: "Deworming", category: "other", due_date: "2026-07-01" }] };

    const first = await call(db, authedRequest(`/api/workspaces/${workspaceId}/tasks/import`, payload, { session: owner }));
    expect(first.status).toBe(201);
    expect(await first.json() as { imported: number }).toMatchObject({ imported: 1, skipped: 0 });

    // The identical logical import replays as an honest skip, not a duplicate
    // and not an overwrite.
    const replay = await call(db, authedRequest(`/api/workspaces/${workspaceId}/tasks/import`, payload, { session: owner }));
    expect(replay.status).toBe(201);
    const replayBody = await replay.json() as { imported: number; skipped: number; skipped_rows: Array<{ reason: string }> };
    expect(replayBody.imported).toBe(0);
    expect(replayBody.skipped).toBe(1);
    expect(replayBody.skipped_rows[0].reason).toBe("occurrence_exists");

    expect(await scalar(db, "workspace_tasks WHERE occurrence_key LIKE 'task:import:%'")).toBe(1);
    const stored = await row<{ title: string; due_date: string }>(
      db, "SELECT title,due_date FROM workspace_tasks WHERE occurrence_key LIKE 'task:import:%'");
    expect(stored?.title).toBe("Deworming");
    expect(stored?.due_date).toBe("2026-07-01");

    // A different due date for the same title is a DIFFERENT occurrence: the
    // original row is never replaced.
    const shifted = await call(db, authedRequest(`/api/workspaces/${workspaceId}/tasks/import`, {
      tasks: [{ title: "Deworming", category: "other", due_date: "2026-08-01" }],
    }, { session: owner }));
    expect(shifted.status).toBe(201);
    expect(await shifted.json() as { imported: number }).toMatchObject({ imported: 1, skipped: 0 });
    expect(await scalar(db, "workspace_tasks WHERE occurrence_key LIKE 'task:import:%'")).toBe(2);
    const dates = (await db.prepare(
      "SELECT due_date FROM workspace_tasks WHERE occurrence_key LIKE 'task:import:%' ORDER BY due_date").all<{ due_date: string }>()).results;
    expect(dates.map((r) => r.due_date)).toEqual(["2026-07-01", "2026-08-01"]);
  });
});

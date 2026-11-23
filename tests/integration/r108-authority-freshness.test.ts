import { describe, expect, it } from "vitest";
import workerDefault from "../../src/worker";
import {
  openRealDatabase, seedUser, makeSession, authedRequest, type AuthedSession,
} from "../helpers/realDatabase";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * R108-19: the authority-read freshness sequence on an ISOLATED STAGING
 * FIXTURE — the same classes the runbook requires before any promotion
 * (session / staff-permission / account-deactivation / workspace revocation,
 * each with public-read interleaving and queued-notification suppression),
 * executed through the REAL Worker router (src/worker.ts) over a REAL
 * migrated database. Live production mutations are NOT performed (they need
 * separate explicit approval); this fixture proves the same-revision
 * semantics of the CURRENT candidate tree, complementing the R107 NEXT-02
 * live evidence on deployed R106.
 *
 * The freshness contract under test: authority is read at request time, never
 * cached across a revocation — the NEXT protected operation after a
 * revocation is refused, while cacheable PUBLIC reads keep serving honestly.
 */

const worker = workerDefault as unknown as {
  fetch(request: Request, env: unknown): Promise<Response>;
};

const limiter = { limit: async () => ({ success: true }) };

function makeEnv(db: D1Database) {
  return {
    APP_ENV: "production",
    DB_PROVIDER_MODE: "d1_only",
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

async function scalar(db: D1Database, sql: string, ...args: unknown[]): Promise<number> {
  const found = await db.prepare(`SELECT COUNT(*) AS n FROM ${sql}`).bind(...args).first<{ n: number }>();
  return Number(found?.n ?? 0);
}

/** A cacheable PUBLIC read that must keep serving across every revocation. */
async function publicRead(db: D1Database): Promise<Response> {
  return call(db, new Request("https://registry.example/api/horses?limit=1", { headers: { "user-agent": "vitest" } }));
}

/** A GUARDED read (requireAuth): the protected probe for freshness. */
async function guardedRead(db: D1Database, session: AuthedSession): Promise<Response> {
  return call(db, authedRequest("/api/workspaces/mine", undefined, { session }));
}

describe("R108-19 staging fixture: revocation freshness with public-read interleaving", () => {
  it("session revocation: the next authenticated read is refused; public reads keep serving", async () => {
    const db = await openRealDatabase();
    await seedUser(db, "fresh-user", "user");
    const session = await makeSession(db, "fresh-user");

    const warm = await call(db, authedRequest("/api/auth/me", undefined, { session }));
    expect(warm.status).toBe(200);
    expect(((await warm.json()) as { user: { id: string } | null }).user?.id).toBe("fresh-user");
    expect((await guardedRead(db, session)).status).toBe(200);
    expect((await publicRead(db)).status).toBe(200);

    // Server-side session revocation (the row disappears — the same state a
    // security logout, an operator revoke or an expiry reaches).
    await db.prepare("DELETE FROM sessions").run();
    expect(await scalar(db, "sessions")).toBe(0);

    // The very next authenticated operation is refused — no cached authority.
    expect((await guardedRead(db, session)).status).toBe(401);
    // Public reads are unaffected.
    expect((await publicRead(db)).status).toBe(200);
  });

  it("account deactivation: the next authenticated read is refused; public reads keep serving", async () => {
    const db = await openRealDatabase();
    await seedUser(db, "sleepy-user", "user");
    const session = await makeSession(db, "sleepy-user");

    expect((await guardedRead(db, session)).status).toBe(200);
    expect((await publicRead(db)).status).toBe(200);

    await db.prepare("UPDATE users SET is_active=0 WHERE id='sleepy-user'").run();

    expect((await guardedRead(db, session)).status).toBe(401);
    expect((await publicRead(db)).status).toBe(200);
  });

  it("staff-permission revocation: the next workspace write is a disclosure-free refusal; public reads keep serving", async () => {
    const db = await openRealDatabase();
    await seedUser(db, "f-owner", "user");
    await seedUser(db, "f-staff", "user");
    const owner = await makeSession(db, "f-owner");
    const staff = await makeSession(db, "f-staff");

    const created = await call(db, authedRequest("/api/workspaces", { name: "R108-19 freshness herd" }, { session: owner }));
    expect(created.status).toBe(201);
    const workspaceId = ((await created.json()) as { workspace: { id: number } }).workspace.id;

    // The staff member receives and accepts a real invitation.
    const invited = await call(db, authedRequest(`/api/workspaces/${workspaceId}/invites`, { invitee_user_id: "f-staff", actions: "view,tasks_manage" }, { session: owner }));
    expect(invited.status).toBe(201);
    const accepted = await call(db, authedRequest("/api/workspaces/invites/" + workspaceId + "/respond", { action: "accept" }, { session: staff }));
    expect(accepted.status).toBe(200);

    // The staff member CAN write before the revocation.
    const task = await call(db, authedRequest(`/api/workspaces/${workspaceId}/tasks`, { title: "freshness probe", category: "other", due_date: "2026-12-01" }, { session: staff }));
    expect(task.status).toBe(201);
    expect((await publicRead(db)).status).toBe(200);

    // Owner revokes staff through the real route.
    const revoked = await call(db, authedRequest(`/api/workspaces/${workspaceId}/staff/f-staff/revoke`, {}, { session: owner }));
    expect(revoked.status).toBe(200);

    // The next write is a disclosure-free 404 — no stale permission anywhere.
    const refused = await call(db, authedRequest(`/api/workspaces/${workspaceId}/tasks`, { title: "after revocation", category: "other", due_date: "2026-12-02" }, { session: staff }));
    expect(refused.status).toBe(404);
    // Public reads are unaffected.
    expect((await publicRead(db)).status).toBe(200);
  });

  it("queued-notification suppression: revoking staff suppresses only that workspace's queued reminders, with zero external sends", async () => {
    const db = await openRealDatabase();
    await seedUser(db, "n-owner", "user");
    await seedUser(db, "n-staff", "user");
    const owner = await makeSession(db, "n-owner");
    const staff = await makeSession(db, "n-staff");

    // The second collection needs an active farm plan.
    await db.exec(`
      INSERT INTO orders(id,order_key,buyer_user_id,status,total_minor,currency,price_snapshot_json)
        VALUES(1,'r108-19-order-1','n-owner','paid',1000000,'IRR','[]');
      INSERT INTO payment_attempts(id,order_id,provider,authority,amount_minor,state,verified_at)
        VALUES(1,1,'zarinpal','r108-19-auth-1',1000000,'verified','2026-01-01 00:00:00');
      INSERT INTO entitlement_events(id,event_key,order_id,payment_attempt_id,buyer_user_id,sku,kind,granted_days,activated_at,expires_at,grant_scope,grant_source,provider_name)
        VALUES(1,'r108-19-evt-1',1,1,'n-owner','farm_workspace_monthly','grant',30,'2026-01-01 00:00:00','2099-01-01 00:00:00','production','verified_payment','zarinpal');
      INSERT INTO entitlements(id,buyer_user_id,holder_key,sku,source_event_id,active,activated_at,expires_at,grant_scope)
        VALUES(1,'n-owner','user:n-owner','farm_workspace_monthly',1,1,'2026-01-01 00:00:00','2099-01-01 00:00:00','production');
    `);

    const created = await call(db, authedRequest("/api/workspaces", { name: "R108-19 suppression one" }, { session: owner }));
    const workspaceOne = ((await created.json()) as { workspace: { id: number } }).workspace.id;
    const createdTwo = await call(db, authedRequest("/api/workspaces", { name: "R108-19 suppression two" }, { session: owner }));
    const workspaceTwo = ((await createdTwo.json()) as { workspace: { id: number } }).workspace.id;

    // Staff joins BOTH workspaces; each gets a queued reminder for the staff member.
    for (const id of [workspaceOne, workspaceTwo]) {
      const invited = await call(db, authedRequest(`/api/workspaces/${id}/invites`, { invitee_user_id: "n-staff", actions: "view" }, { session: owner }));
      expect(invited.status).toBe(201);
      const accepted = await call(db, authedRequest(`/api/workspaces/invites/${id}/respond`, { action: "accept" }, { session: staff }));
      expect(accepted.status).toBe(200);
    }
    const taskOne = await call(db, authedRequest(`/api/workspaces/${workspaceOne}/tasks`, { title: "ws1 reminder", category: "other", due_date: "2026-12-01" }, { session: owner }));
    expect(taskOne.status).toBe(201);
    const taskTwo = await call(db, authedRequest(`/api/workspaces/${workspaceTwo}/tasks`, { title: "ws2 reminder", category: "other", due_date: "2026-12-01" }, { session: owner }));
    expect(taskTwo.status).toBe(201);
    const taskIdOne = ((await (await call(db, authedRequest(`/api/workspaces/${workspaceOne}/tasks`, undefined, { session: owner }))).json()) as { tasks: Array<{ id: number }> }).tasks[0].id;
    const taskIdTwo = ((await (await call(db, authedRequest(`/api/workspaces/${workspaceTwo}/tasks`, undefined, { session: owner }))).json()) as { tasks: Array<{ id: number }> }).tasks[0].id;
    await db.exec(`
      INSERT INTO notification_outbox(event_key,channel,purpose,recipient_user_id,recipient_masked,status,payload_ref)
        VALUES ('r108-19-ws1','email','workspace_task_reminder','n-staff','n***@x.com','queued','workspace_tasks:${taskIdOne}');
      INSERT INTO notification_outbox(event_key,channel,purpose,recipient_user_id,recipient_masked,status,payload_ref)
        VALUES ('r108-19-ws2','email','workspace_task_reminder','n-staff','n***@x.com','queued','workspace_tasks:${taskIdTwo}');
    `);

    // Revoking staff in workspace ONE suppresses only that workspace's queue.
    const revoked = await call(db, authedRequest(`/api/workspaces/${workspaceOne}/staff/n-staff/revoke`, {}, { session: owner }));
    expect(revoked.status).toBe(200);

    const suppressedOne = await scalar(db, "notification_outbox WHERE event_key='r108-19-ws1' AND status='suppressed'");
    const stillQueuedTwo = await scalar(db, "notification_outbox WHERE event_key='r108-19-ws2' AND status='queued'");
    const sent = await scalar(db, "notification_outbox WHERE status='sent'");
    expect(suppressedOne).toBe(1);
    expect(stillQueuedTwo).toBe(1);
    expect(sent).toBe(0); // nothing contacted an external provider — suppression only
  });
});

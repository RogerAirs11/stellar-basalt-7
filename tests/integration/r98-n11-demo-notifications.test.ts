import { describe, expect, it } from "vitest";
import { drainNotificationOutbox } from "../../src/notifications/worker";
import { outboxStatement } from "../../src/notifications/outbox";
import { resolveEmailProviderWithDemo, demoProviderMessageId, DEMO_EMAIL_PROVIDER_NAME } from "../../src/notifications/demoProvider";
import { getEmailProvider } from "../../src/notifications/email";
import { adminDemoDeliveries, adminSimulateDemoDelivery } from "../../src/api/modules/demoNotifications";
import { createWorkspace, createWorkspaceTask, completeWorkspaceTask } from "../../src/api/modules/workspaces";
import { enqueueDueTaskReminders } from "../../src/workspaces/reminders";
import { localDateInZone } from "../../src/workspaces/domain";
import {
  openRealDatabase, seedUser, makeSession, authedRequest, seedBillingPrices,
  createOrder, reserveAttempt, verifyOrder, countRows, type AuthedSession,
} from "../helpers/realDatabase";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * R98-N11 evidence — the demonstration notification pipeline on a REAL
 * database with every migration applied. The demo email provider (loopback)
 * satisfies the same EmailProvider contract as the real HTTP adapter, so the
 * REAL drain, lease, fingerprint-binding, idempotency-window and callback
 * recording code runs. Only the transmission is simulated (recorded in
 * demo_deliveries instead of leaving the process).
 *
 * A. Resolution honesty: the real provider always wins; the demo loopback is
 *    owner-enabled only; without either, the honest configuration failure.
 * B. The pipeline: a real due-task reminder enqueues once, drains through
 *    the demo provider (ACCEPTED — never delivered), settles ONLY through
 *    the signed callback path, and replays never regress a terminal state.
 * C. Suppression: a task completed between enqueue and drain sends nothing.
 * D. The operator demo inbox pairs provider-side and platform-side states.
 */

const NOW = () => new Date().toISOString();
const CALLBACK_SECRET = "test-callback-secret-0123456789abcdef";
const DEMO_ENV: Record<string, string> = { DEMO_NOTIFICATIONS_ENABLED: "true" };
const REAL_EMAIL_ENV: Record<string, string> = { EMAIL_API_URL: "https://api.resend.com/emails", EMAIL_API_KEY: "key-1", EMAIL_FROM: "registry@example.test" };

async function paidOwnerWorld(db: D1Database, key: string): Promise<{ owner: AuthedSession; orgId: number }> {
  await seedUser(db, "farm-owner", "user");
  await seedUser(db, "admin-1", "admin");
  await seedBillingPrices(db);
  await db.exec(`
    INSERT INTO organizations(id,slug,name_native,name_latin) VALUES(7,'demo-farm','مزرعه نمایشی','Demo Farm');
    INSERT INTO organization_memberships(organization_id,user_id,role,status,valid_from)
    VALUES(7,'farm-owner','owner','active','2026-01-01 00:00:00');
  `);
  const order = (await createOrder(db, { buyer: "farm-owner", key, organizationId: 7 }))!;
  const { attemptId } = await reserveAttempt(db, order.id, "farm-owner");
  await verifyOrder(db, order, attemptId!, crypto.randomUUID(), NOW());
  return { owner: await makeSession(db, "farm-owner"), orgId: 7 };
}

async function dueReminderWorld(db: D1Database, key: string): Promise<{ owner: AuthedSession; workspaceId: number; taskId: number }> {
  const { owner, orgId } = await paidOwnerWorld(db, key);
  const env = { DB: db, SESSION_COOKIE_NAME: "hr_session" } as never;
  const created = await createWorkspace(authedRequest("/api/workspaces", { name: "Notification demo herd", organization_id: orgId }, { session: owner }), env);
  const workspaceId = ((await created.json()) as { workspace: { id: number } }).workspace.id;
  await createWorkspaceTask(authedRequest(`/api/workspaces/${workspaceId}/tasks`, {
    title: "Deworming due", category: "veterinary_appointment", due_date: localDateInZone("Asia/Tehran", NOW()), due_timezone: "Asia/Tehran",
  }, { session: owner }), env, workspaceId);
  const enqueued = await enqueueDueTaskReminders(db, NOW());
  expect(enqueued.enqueued).toBe(1);
  const task = await db.prepare("SELECT id FROM workspace_tasks WHERE collection_id=?").bind(workspaceId).first<{ id: number }>();
  return { owner, workspaceId, taskId: task!.id };
}

function notificationsEnv(db: D1Database, extra: Record<string, string> = {}) {
  return { DB: db, SESSION_COOKIE_NAME: "hr_session", NOTIFICATION_CALLBACK_SECRET: CALLBACK_SECRET, ...extra } as never;
}

describe("N11 A. provider resolution honesty", () => {
  it("no real provider + owner-enabled demo -> the demo loopback", async () => {
    const db = await openRealDatabase();
    const provider = resolveEmailProviderWithDemo(DEMO_ENV as never, getEmailProvider(DEMO_ENV), db);
    expect(provider?.name).toBe(DEMO_EMAIL_PROVIDER_NAME);
    expect(provider?.idempotencyWindowMs).not.toBeNull();
  });

  it("a configured real provider ALWAYS wins over the demo loopback", async () => {
    const db = await openRealDatabase();
    const provider = resolveEmailProviderWithDemo(
      { ...REAL_EMAIL_ENV, DEMO_NOTIFICATIONS_ENABLED: "true" },
      getEmailProvider(REAL_EMAIL_ENV),
      db,
    );
    expect(provider?.name).toBe("http-email");
  });

  it("without either provider the resolution stays null (honest failure kept)", async () => {
    const db = await openRealDatabase();
    expect(resolveEmailProviderWithDemo({} as never, getEmailProvider({}), db)).toBeNull();
  });
});

describe("N11 B. the pipeline: enqueue -> drain (accepted) -> signed callback (delivered)", () => {
  it("a due reminder drains through the demo provider as ACCEPTED, never delivered; the inbox records it", async () => {
    const db = await openRealDatabase();
    await dueReminderWorld(db, "n11-drain-1");
    const summary = await drainNotificationOutbox(db, DEMO_ENV);
    expect(summary.provider_accepted).toBe(1);
    expect(summary.note).toContain("Demo email provider active");

    const outbox = await db.prepare("SELECT status, provider_name, provider_message_id FROM notification_outbox WHERE purpose='workspace_task_due'").first<{ status: string; provider_name: string; provider_message_id: string }>();
    expect(outbox?.status).toBe("provider_accepted"); // acceptance is NOT delivery
    expect(outbox?.provider_name).toBe(DEMO_EMAIL_PROVIDER_NAME);

    const delivery = await db.prepare("SELECT event_key, to_address, provider_message_id, status FROM demo_deliveries").first<{ event_key: string; to_address: string; provider_message_id: string; status: string }>();
    expect(delivery).not.toBeNull();
    expect(delivery?.to_address).toBe("farm-owner@example.test");
    expect(delivery?.provider_message_id).toBe(outbox?.provider_message_id);
    expect(delivery?.status).toBe("accepted");
    expect(await countRows(db, "notification_deliveries")).toBe(0); // no delivery fact yet
  });

  it("the operator's simulate action settles the delivery through the REAL signed callback path", async () => {
    const db = await openRealDatabase();
    await dueReminderWorld(db, "n11-callback-1");
    await drainNotificationOutbox(db, { ...DEMO_ENV } as never);
    const admin = await makeSession(db, "admin-1");
    const delivery = await db.prepare("SELECT id, event_key, provider_message_id FROM demo_deliveries").first<{ id: number; event_key: string; provider_message_id: string }>();

    const response = await adminSimulateDemoDelivery(
      authedRequest(`/api/admin/notifications/demo-deliveries/${delivery!.id}/callback`, { outcome: "delivered" }, { session: admin }),
      notificationsEnv(db, { DEMO_NOTIFICATIONS_ENABLED: "true" }),
      delivery!.id,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { simulated: boolean; provider_side_status: string };
    expect(body.simulated).toBe(true);
    expect(body.provider_side_status).toBe("delivered");

    const outbox = await db.prepare("SELECT status FROM notification_outbox WHERE event_key=?").bind(delivery!.event_key).first<{ status: string }>();
    expect(outbox?.status).toBe("delivered"); // ONLY the signed callback established delivery
    expect(await countRows(db, "notification_deliveries")).toBe(1);
    const inboxRow = await db.prepare("SELECT status FROM demo_deliveries WHERE id=?").bind(delivery!.id).first<{ status: string }>();
    expect(inboxRow?.status).toBe("delivered");
  });

  it("replaying the delivery callback never regresses or duplicates the terminal state", async () => {
    const db = await openRealDatabase();
    await dueReminderWorld(db, "n11-replay-1");
    await drainNotificationOutbox(db, { ...DEMO_ENV } as never);
    const admin = await makeSession(db, "admin-1");
    const delivery = await db.prepare("SELECT id FROM demo_deliveries").first<{ id: number }>();

    await adminSimulateDemoDelivery(authedRequest(`/api/admin/notifications/demo-deliveries/${delivery!.id}/callback`, { outcome: "delivered" }, { session: admin }), notificationsEnv(db), delivery!.id);
    const replay = await adminSimulateDemoDelivery(authedRequest(`/api/admin/notifications/demo-deliveries/${delivery!.id}/callback`, { outcome: "not_delivered" }, { session: admin }), notificationsEnv(db), delivery!.id);
    const replayBody = (await replay.json()) as { simulated: boolean; provider_side_status: string };
    // The demo inbox is already settled: the second action is an honest no-op,
    // and the outbox keeps its terminal delivered state (CAS replay rule).
    expect(replayBody.simulated).toBe(false);
    const outbox = await db.prepare("SELECT status FROM notification_outbox WHERE purpose='workspace_task_due'").first<{ status: string }>();
    expect(outbox?.status).toBe("delivered");
    expect(await countRows(db, "notification_deliveries")).toBe(1);
  });

  it("a not_delivered settlement marks the outbox failed honestly", async () => {
    const db = await openRealDatabase();
    await dueReminderWorld(db, "n11-failed-1");
    await drainNotificationOutbox(db, { ...DEMO_ENV } as never);
    const admin = await makeSession(db, "admin-1");
    const delivery = await db.prepare("SELECT id FROM demo_deliveries").first<{ id: number }>();
    const response = await adminSimulateDemoDelivery(authedRequest(`/api/admin/notifications/demo-deliveries/${delivery!.id}/callback`, { outcome: "not_delivered" }, { session: admin }), notificationsEnv(db), delivery!.id);
    expect(response.status).toBe(200);
    const outbox = await db.prepare("SELECT status, last_error FROM notification_outbox WHERE purpose='workspace_task_due'").first<{ status: string; last_error: string }>();
    expect(outbox?.status).toBe("failed");
    expect(outbox?.last_error).toBe("provider_reported_not_delivered");
  });

  it("without any provider the drain keeps its honest configuration failure (retryable, visible)", async () => {
    const db = await openRealDatabase();
    await dueReminderWorld(db, "n11-unconfigured-1");
    const summary = await drainNotificationOutbox(db, {} as never);
    expect(summary.provider_unconfigured).toBe(1);
    // The row stays retryable-queued with the machine-readable error — never
    // silently successful, never guessed into a terminal state.
    const outbox = await db.prepare("SELECT status, last_error, attempts FROM notification_outbox WHERE purpose='workspace_task_due'").first<{ status: string; last_error: string; attempts: number }>();
    expect(outbox?.status).toBe("queued");
    expect(outbox?.last_error).toBe("configuration");
    expect(Number(outbox?.attempts)).toBeGreaterThanOrEqual(1);
    expect(await countRows(db, "demo_deliveries")).toBe(0);
  });
});

describe("N11 C. suppression — a completed task sends nothing through the demo provider", () => {
  it("the send adapter re-checks current authority: task completed after enqueue -> suppressed, no demo delivery", async () => {
    const db = await openRealDatabase();
    const { owner, workspaceId, taskId } = await dueReminderWorld(db, "n11-suppress-1");
    const env = { DB: db, SESSION_COOKIE_NAME: "hr_session" } as never;
    const version = (await db.prepare("SELECT row_version FROM workspace_tasks WHERE id=?").bind(taskId).first<{ row_version: number }>())!.row_version;
    const completed = await completeWorkspaceTask(authedRequest(`/api/workspaces/${workspaceId}/tasks/${taskId}/complete`, { expected_version: version }, { session: owner }), env, workspaceId, taskId);
    expect(completed.status).toBe(200);

    const summary = await drainNotificationOutbox(db, DEMO_ENV);
    expect(summary.policy_suppressed).toBe(1);
    expect(summary.provider_accepted).toBe(0);
    expect(await countRows(db, "demo_deliveries")).toBe(0);
  });
});

describe("N11 D. the operator demo inbox view", () => {
  it("pairs the provider-side record with the platform-side outbox state", async () => {
    const db = await openRealDatabase();
    await dueReminderWorld(db, "n11-inbox-1");
    await drainNotificationOutbox(db, { ...DEMO_ENV } as never);
    const admin = await makeSession(db, "admin-1");

    const response = await adminDemoDeliveries(
      authedRequest("/api/admin/notifications/demo-deliveries", undefined, { method: "GET", session: admin }),
      notificationsEnv(db),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { demo_inbox: Array<{ event_key: string; to: string; provider_side_status: string; outbox_status: string }>; note: string };
    expect(body.demo_inbox).toHaveLength(1);
    expect(body.demo_inbox[0].to).toBe("farm-owner@example.test");
    expect(body.demo_inbox[0].provider_side_status).toBe("accepted");
    expect(body.demo_inbox[0].outbox_status).toBe("provider_accepted");
    expect(body.note).toContain("Acceptance");
  });

  it("requires an admin session (a normal user is refused)", async () => {
    const db = await openRealDatabase();
    await seedUser(db, "normal-user", "user");
    const user = await makeSession(db, "normal-user");
    await expect(adminDemoDeliveries(authedRequest("/api/admin/notifications/demo-deliveries", undefined, { method: "GET", session: user }), notificationsEnv(db)))
      .rejects.toMatchObject({ status: 403 });
  });

  it("the simulate action refuses without the callback secret configured", async () => {
    const db = await openRealDatabase();
    await dueReminderWorld(db, "n11-nosecret-1");
    await drainNotificationOutbox(db, { ...DEMO_ENV } as never);
    const admin = await makeSession(db, "admin-1");
    const delivery = await db.prepare("SELECT id FROM demo_deliveries").first<{ id: number }>();
    await expect(adminSimulateDemoDelivery(
      authedRequest(`/api/admin/notifications/demo-deliveries/${delivery!.id}/callback`, { outcome: "delivered" }, { session: admin }),
      { DB: db, SESSION_COOKIE_NAME: "hr_session" } as never, // no NOTIFICATION_CALLBACK_SECRET
      delivery!.id,
    )).rejects.toMatchObject({ status: 503, code: "callback_secret_unconfigured" });
  });
});

describe("N11 unit pins — demo provider contract", () => {
  it("the demo provider message id is deterministic per event key (provider-side dedupe)", async () => {
    expect(demoProviderMessageId("workspace-task:7:due:2026-10-06"))
      .toBe(demoProviderMessageId("workspace-task:7:due:2026-10-06"));
    expect(demoProviderMessageId("a")).not.toBe(demoProviderMessageId("b"));
  });

  it("a retried send with the same idempotency key records ONE provider row", async () => {
    const db = await openRealDatabase();
    const provider = resolveEmailProviderWithDemo(DEMO_ENV as never, null, db)!;
    const message = { to: "farm-owner@example.test", purpose: "service_request_notice" as const, subject: "A new service request is waiting", html: "<p>body</p>", idempotencyKey: "service-request:9:v1" };
    const first = await provider.send(message);
    const second = await provider.send(message);
    expect(first.accepted).toBe(true);
    expect(second.accepted).toBe(true);
    expect(first.providerMessageId).toBe(second.providerMessageId);
    expect(await countRows(db, "demo_deliveries")).toBe(1);
  });

  it("the outbox enqueue allowlist still refuses unknown purposes", async () => {
    const db = await openRealDatabase();
    expect(() => outboxStatement(db, { eventKey: "evil:1", channel: "email", purpose: "marketing_spam", recipientMasked: "x@example.test" }))
      .toThrow();
  });
});

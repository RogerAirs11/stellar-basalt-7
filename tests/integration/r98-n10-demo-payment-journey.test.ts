import { describe, expect, it } from "vitest";
import {
  startOrderPayment, verifyPaymentAttempt, createOrder as apiCreateOrder, myEntitlements,
} from "../../src/api/modules/billing";
import { demoPaymentSessionStatus, completeDemoPayment } from "../../src/api/modules/demoPayments";
import { resolvePaymentProvider, demoGatewayProvider, demoStartPayUrl, DEMO_PAYMENTS_NOTE } from "../../src/commerce/payments/demoGateway";
import { getPaymentProvider } from "../../src/commerce/payments/zarinpal";
import { createWorkspace, addWorkspaceHorse, createWorkspaceTask, workspaceDashboard, listWorkspaceTasks } from "../../src/api/modules/workspaces";
import { localDateInZone } from "../../src/workspaces/domain";
import {
  openRealDatabase, seedUser, makeSession, authedRequest, seedBillingPrices, countRows, type AuthedSession,
} from "../helpers/realDatabase";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * R98-N10 evidence — the demonstration payment journey on a REAL database
 * with every migration applied. The demo gateway settles inside the
 * application (demo_payment_sessions); every other layer — order freezing,
 * attempt reservation, authority attachment, server-side verification,
 * command receipts, entitlement grants, workspace gating, renewal
 * accumulation and expiry read-only — is the REAL production code.
 *
 * A. Provider resolution honesty: real merchant always wins; demo only when
 *    the owner enabled it; otherwise the honest 503 is unchanged.
 * B. The full journey: catalog order -> demo pay page contract -> simulated
 *    settlement -> server-side verify -> org-held entitlement -> useful
 *    workspace work -> renewal extends -> expiry turns read-only.
 * C. The negative matrix: unpaid session, cancelled session, forged
 *    authority, replayed completion, replayed verification, expired demo
 *    session, disabled gateway — none ever grants or extends anything.
 */

const NOW = () => new Date().toISOString();

function demoEnv(db: D1Database, extra: Record<string, string> = {}) {
  return {
    DB: db,
    SESSION_COOKIE_NAME: "hr_session",
    PAYMENT_CALLBACK_BASE_URL: "https://registry.example",
    DEMO_PAYMENTS_ENABLED: "true",
    APP_ENV: "local",
    ISOLATED_DEMO_MODE: "1",
    REGISTRY_DATASET_KIND: "synthetic",
    ...extra,
  } as never;
}

function disabledEnv(db: D1Database) {
  return {
    DB: db,
    SESSION_COOKIE_NAME: "hr_session",
    PAYMENT_CALLBACK_BASE_URL: "https://registry.example",
  } as never;
}

async function seedWorld(db: D1Database, key: string): Promise<{ owner: AuthedSession; orderId: number; orgId: number }> {
  await seedUser(db, "demo-buyer", "user");
  await seedBillingPrices(db);
  await db.exec(`
    INSERT INTO organizations(id,slug,name_native,name_latin) VALUES(7,'demo-farm','مزرعه نمایشی','Demo Farm');
    INSERT INTO organization_memberships(organization_id,user_id,role,status,valid_from)
    VALUES(7,'demo-buyer','owner','active','2026-01-01 00:00:00');
  `);
  const owner = await makeSession(db, "demo-buyer");
  // The order through the REAL API (catalog recomputation, frozen lines).
  const orderResponse = await apiCreateOrder(authedRequest("/api/billing/orders", {
    order_key: key, items: [{ sku: "farm_workspace_monthly", quantity: 1 }], payer_organization_id: 7,
  }, { session: owner }), demoEnv(db));
  expect(orderResponse.status).toBe(201);
  const order = (await orderResponse.json()) as { order: { id: number } };
  return { owner, orderId: order.order.id, orgId: 7 };
}

/** Start payment through the demo gateway and return attempt + authority. */
async function startDemoPayment(db: D1Database, owner: AuthedSession, orderId: number): Promise<{ attemptId: number; authority: string }> {
  const response = await startOrderPayment(authedRequest(`/api/billing/orders/${orderId}/pay`, {}, { session: owner }), demoEnv(db), orderId);
  expect(response.status).toBe(201);
  const body = (await response.json()) as { attempt_id: number; authority: string; start_pay_url: string; demo: boolean; note: string };
  expect(body.demo).toBe(true);
  expect(body.note).toContain(DEMO_PAYMENTS_NOTE);
  expect(body.start_pay_url).toBe(demoStartPayUrl("https://registry.example", body.authority));
  return { attemptId: body.attempt_id, authority: body.authority };
}

async function settleDemo(db: D1Database, authority: string, outcome: "paid" | "cancelled"): Promise<Record<string, unknown>> {
  const response = await completeDemoPayment(
    new Request(`https://registry.example/api/demo/payments/${authority}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ outcome }),
    }),
    demoEnv(db),
    authority,
  );
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

describe("N10 A. provider resolution honesty", () => {
  it("no merchant + owner-enabled demo flag -> the demo gateway (mode demo)", async () => {
    const db = await openRealDatabase();
    const resolved = resolvePaymentProvider(demoEnv(db) as never, getPaymentProvider);
    expect(resolved?.mode).toBe("demo");
    expect(resolved?.provider.name).toBe("demo");
  });

  it("a configured real merchant ALWAYS wins over the demo gateway", async () => {
    const db = await openRealDatabase();
    const resolved = resolvePaymentProvider({
      DB: db,
      PAYMENT_CALLBACK_BASE_URL: "https://registry.example",
      DEMO_PAYMENTS_ENABLED: "true",
      ZARINPAL_MERCHANT_ID: "merchant-uuid-1234",
      ZARINPAL_BASE_URL: "https://sandbox.zarinpal.com",
    }, getPaymentProvider);
    expect(resolved?.mode).toBe("live");
    expect(resolved?.provider.name).toBe("zarinpal");
  });

  it("no merchant + no demo flag -> null: the honest 503 path is unchanged", async () => {
    const db = await openRealDatabase();
    expect(resolvePaymentProvider(disabledEnv(db) as never, getPaymentProvider)).toBeNull();
  });

  it("the demo gateway without a callback origin still fails closed", async () => {
    const db = await openRealDatabase();
    expect(resolvePaymentProvider({ DB: db, DEMO_PAYMENTS_ENABLED: "true" } as never, getPaymentProvider)).toBeNull();
  });

  it("a production demo flag cannot resolve a provider", async () => {
    const db = await openRealDatabase();
    expect(resolvePaymentProvider({
      DB: db,
      PAYMENT_CALLBACK_BASE_URL: "https://registry.example",
      DEMO_PAYMENTS_ENABLED: "true",
      APP_ENV: "production",
      ISOLATED_DEMO_MODE: "1",
      REGISTRY_DATASET_KIND: "synthetic",
    }, getPaymentProvider)).toBeNull();
  });
});

describe("N10 B. the full demo journey end to end", () => {
  it("order -> demo pay page -> simulated settlement -> server-side verify -> entitlement -> useful workspace work", async () => {
    const db = await openRealDatabase();
    const { owner, orderId, orgId } = await seedWorld(db, "n10-journey-1");
    const { attemptId, authority } = await startDemoPayment(db, owner, orderId);

    // The hosted pay page's status endpoint shows non-sensitive facts only.
    const statusResponse = await demoPaymentSessionStatus(
      new Request(`https://registry.example/api/demo/payments/${authority}?authority=${authority}`),
      demoEnv(db),
    );
    expect(statusResponse.status).toBe(200);
    const status = (await statusResponse.json()) as Record<string, unknown>;
    expect(status.demo).toBe(true);
    expect(status.status).toBe("issued");
    expect(status.amount_minor).toBe(19_000_000);
    expect(String(status.note)).toContain("No real money moves");
    expect(JSON.stringify(status)).not.toContain("demo-buyer"); // no buyer PII

    // Verify BEFORE settlement: honestly not paid, no entitlement.
    const earlyVerify = await verifyPaymentAttempt(authedRequest("/api/billing/payments/verify", { attempt_id: attemptId }, { session: owner }), demoEnv(db));
    expect(earlyVerify.status).toBe(200);
    expect(((await earlyVerify.json()) as { verified: boolean }).verified).toBe(false);
    expect(await countRows(db, "entitlements", "holder_key='org:7'")).toBe(0);

    // Settle the demo session (the pay page's action).
    const settled = await settleDemo(db, authority, "paid");
    expect(settled.status).toBe(200);
    expect((settled.body as { status: string }).status).toBe("paid");
    expect(String((settled.body as { provider_ref: string }).provider_ref)).toMatch(/^DEMO-\d+$/);

    // Server-side verification grants the org-held entitlement exactly once.
    const verifyResponse = await verifyPaymentAttempt(authedRequest("/api/billing/payments/verify", { attempt_id: attemptId }, { session: owner }), demoEnv(db));
    expect(verifyResponse.status).toBe(200);
    const verified = (await verifyResponse.json()) as { verified: boolean; fulfilled: boolean; entitlements: Array<{ sku: string; granted_days: number }> };
    expect(verified.verified).toBe(true);
    expect(verified.fulfilled).toBe(true);
    expect(verified.entitlements).toHaveLength(1);
    expect(verified.entitlements[0].sku).toBe("farm_workspace_monthly");
    expect(verified.entitlements[0].granted_days).toBe(30);
    expect(await countRows(db, "entitlements", "holder_key='org:7' AND active=1")).toBe(1);
    const attempt = await db.prepare("SELECT state, provider FROM payment_attempts WHERE id=?").bind(attemptId).first<{ state: string; provider: string }>();
    expect(attempt?.state).toBe("verified");
    expect(attempt?.provider).toBe("demo");

    // The paid capability is visible to the buyer.
    const entitlements = await myEntitlements(authedRequest("/api/billing/entitlements", undefined, { method: "GET", session: owner }), demoEnv(db));
    expect(entitlements.status).toBe(200);

    // Useful work with the purchased access: the org workspace.
    const created = await createWorkspace(authedRequest("/api/workspaces", { name: "Demo Farm working herd", organization_id: orgId }, { session: owner }), demoEnv(db));
    expect(created.status).toBe(201);
    const workspaceId = ((await created.json()) as { workspace: { id: number } }).workspace.id;
    await db.exec("INSERT INTO horses(id,name_latin,sex_desc,birth_date) VALUES(61,'Journey Demo Horse','Mare','2019-04-01')");
    const added = await addWorkspaceHorse(authedRequest(`/api/workspaces/${workspaceId}/horses`, { horse_id: 61 }, { session: owner }), demoEnv(db), workspaceId);
    expect(added.status).toBe(201);
    const task = await createWorkspaceTask(authedRequest(`/api/workspaces/${workspaceId}/tasks`, {
      title: "Vaccination window", category: "veterinary_appointment", horse_id: 61,
      due_date: localDateInZone("Asia/Tehran", NOW()), due_timezone: "Asia/Tehran",
    }, { session: owner }), demoEnv(db), workspaceId);
    expect(task.status).toBe(201);
  });

  it("renewal through the demo gateway extends the SAME entitlement; replay never extends twice", async () => {
    const db = await openRealDatabase();
    const { owner, orderId } = await seedWorld(db, "n10-renewal-1");
    const first = await startDemoPayment(db, owner, orderId);
    await settleDemo(db, first.authority, "paid");
    const verify1 = await verifyPaymentAttempt(authedRequest("/api/billing/payments/verify", { attempt_id: first.attemptId }, { session: owner }), demoEnv(db));
    expect(((await verify1.json()) as { verified: boolean }).verified).toBe(true);

    const before = await db.prepare("SELECT expires_at FROM entitlements WHERE holder_key='org:7' AND active=1").first<{ expires_at: string }>();

    // A second order, paid through the demo gateway, renews (extends).
    const renewalOrder = await apiCreateOrder(authedRequest("/api/billing/orders", {
      order_key: "n10-renewal-1b", items: [{ sku: "farm_workspace_monthly", quantity: 1 }], payer_organization_id: 7,
    }, { session: owner }), demoEnv(db));
    const renewal = ((await renewalOrder.json()) as { order: { id: number } }).order;
    const second = await startDemoPayment(db, owner, renewal.id);
    await settleDemo(db, second.authority, "paid");
    const verify2 = await verifyPaymentAttempt(authedRequest("/api/billing/payments/verify", { attempt_id: second.attemptId }, { session: owner }), demoEnv(db));
    expect(((await verify2.json()) as { verified: boolean }).verified).toBe(true);

    expect(await countRows(db, "entitlements", "holder_key='org:7' AND active=1")).toBe(1);
    const after = await db.prepare("SELECT expires_at FROM entitlements WHERE holder_key='org:7' AND active=1").first<{ expires_at: string }>();
    expect(new Date(after!.expires_at).getTime()).toBeGreaterThan(new Date(before!.expires_at).getTime());

    // Replaying the second verification is an idempotent no-op (no extra time).
    const replay = await verifyPaymentAttempt(authedRequest("/api/billing/payments/verify", { attempt_id: second.attemptId }, { session: owner }), demoEnv(db));
    const replayBody = (await replay.json()) as { verified: boolean; idempotent_replay: boolean };
    expect(replayBody.verified).toBe(true);
    expect(replayBody.idempotent_replay).toBe(true);
    const final = await db.prepare("SELECT expires_at FROM entitlements WHERE holder_key='org:7' AND active=1").first<{ expires_at: string }>();
    expect(final!.expires_at).toBe(after!.expires_at);
  });

  it("after expiry the workspace is READ-ONLY and nothing is lost; a demo renewal restores writes", async () => {
    const db = await openRealDatabase();
    const { owner, orderId, orgId } = await seedWorld(db, "n10-expiry-1");
    const first = await startDemoPayment(db, owner, orderId);
    await settleDemo(db, first.authority, "paid");
    await verifyPaymentAttempt(authedRequest("/api/billing/payments/verify", { attempt_id: first.attemptId }, { session: owner }), demoEnv(db));
    const created = await createWorkspace(authedRequest("/api/workspaces", { name: "Expiry demo herd", organization_id: orgId }, { session: owner }), demoEnv(db));
    const workspaceId = ((await created.json()) as { workspace: { id: number } }).workspace.id;
    await createWorkspaceTask(authedRequest(`/api/workspaces/${workspaceId}/tasks`, {
      title: "Hoof trimming", category: "farrier", due_date: localDateInZone("Asia/Tehran", NOW()), due_timezone: "Asia/Tehran",
    }, { session: owner }), demoEnv(db), workspaceId);

    await db.exec("UPDATE entitlements SET expires_at=datetime('now','-1 day') WHERE holder_key='org:7' AND active=1");
    await expect(createWorkspaceTask(authedRequest(`/api/workspaces/${workspaceId}/tasks`, {
      title: "Should refuse", category: "other", due_date: localDateInZone("Asia/Tehran", NOW()),
    }, { session: owner }), demoEnv(db), workspaceId)).rejects.toMatchObject({ status: 403, code: "workspace_plan_expired" });
    const dashboard = await workspaceDashboard(authedRequest(`/api/workspaces/${workspaceId}`, undefined, { method: "GET", session: owner }), demoEnv(db), workspaceId);
    expect(dashboard.status).toBe(200);
    const tasks = await listWorkspaceTasks(authedRequest(`/api/workspaces/${workspaceId}/tasks`, undefined, { method: "GET", session: owner }), demoEnv(db), workspaceId);
    expect(tasks.status).toBe(200);
    expect(await countRows(db, "workspace_tasks", `collection_id=${workspaceId}`)).toBe(1); // preserved

    // Renewal through the demo gateway restores writes.
    const renewalOrder = await apiCreateOrder(authedRequest("/api/billing/orders", {
      order_key: "n10-expiry-1b", items: [{ sku: "farm_workspace_monthly", quantity: 1 }], payer_organization_id: 7,
    }, { session: owner }), demoEnv(db));
    const renewal = ((await renewalOrder.json()) as { order: { id: number } }).order;
    const second = await startDemoPayment(db, owner, renewal.id);
    await settleDemo(db, second.authority, "paid");
    await verifyPaymentAttempt(authedRequest("/api/billing/payments/verify", { attempt_id: second.attemptId }, { session: owner }), demoEnv(db));
    const restored = await createWorkspaceTask(authedRequest(`/api/workspaces/${workspaceId}/tasks`, {
      title: "Post-renewal task", category: "other", due_date: localDateInZone("Asia/Tehran", NOW()),
    }, { session: owner }), demoEnv(db), workspaceId);
    expect(restored.status).toBe(201);
  });

  it("R120: the SAME demo-paid database read through a NON-demo environment never treats the demo plan as a production plan", async () => {
    const db = await openRealDatabase();
    const { owner, orderId, orgId } = await seedWorld(db, "n10-scope-isolation-1");
    const first = await startDemoPayment(db, owner, orderId);
    await settleDemo(db, first.authority, "paid");
    await verifyPaymentAttempt(authedRequest("/api/billing/payments/verify", { attempt_id: first.attemptId }, { session: owner }), demoEnv(db));
    // The demo grant exists and is active — but scoped 'demo' (IMP-009).
    const scope = await db.prepare("SELECT grant_scope FROM entitlements WHERE holder_key='org:7' AND active=1").first<{ grant_scope: string }>();
    expect(scope?.grant_scope).toBe("demo");
    const created = await createWorkspace(authedRequest("/api/workspaces", { name: "Scope isolation herd", organization_id: orgId }, { session: owner }), demoEnv(db));
    const workspaceId = ((await created.json()) as { workspace: { id: number } }).workspace.id;
    // Expire the demo plan to expose the scope decision.
    await db.exec("UPDATE entitlements SET expires_at=datetime('now','-1 day') WHERE holder_key='org:7' AND active=1");
    // In the ISOLATED DEMO environment the org HAS a plan (demo scope): the
    // expired demo plan must make the workspace READ-ONLY (the honest expiry
    // story the demo exists to demonstrate).
    await expect(createWorkspaceTask(authedRequest(`/api/workspaces/${workspaceId}/tasks`, {
      title: "Demo scope", category: "other", due_date: localDateInZone("Asia/Tehran", NOW()),
    }, { session: owner }), demoEnv(db), workspaceId)).rejects.toMatchObject({ status: 403, code: "workspace_plan_expired" });
    // The SAME database, SAME workspace, SAME expired demo entitlement — read
    // through a production environment (no isolated-demo triple): the demo
    // grant imposes NO plan obligation there, so the write is NOT refused as
    // plan_expired. IMP-009 isolation holds in both directions.
    const prodEnv = {
      DB: db, SESSION_COOKIE_NAME: "hr_session", PAYMENT_CALLBACK_BASE_URL: "https://registry.example",
      DEMO_PAYMENTS_ENABLED: "true", APP_ENV: "production",
    } as never;
    const prodWrite = await createWorkspaceTask(authedRequest(`/api/workspaces/${workspaceId}/tasks`, {
      title: "Prod scope", category: "other", due_date: localDateInZone("Asia/Tehran", NOW()),
    }, { session: owner }), prodEnv, workspaceId);
    expect(prodWrite.status).toBe(201); // free-tier org in production, not plan-gated by a demo grant
  });
});

describe("N10 C. negative and idempotency matrix", () => {
  it("a cancelled demo session verifies as not paid and grants nothing", async () => {
    const db = await openRealDatabase();
    const { owner, orderId } = await seedWorld(db, "n10-cancel-1");
    const { attemptId, authority } = await startDemoPayment(db, owner, orderId);
    const settled = await settleDemo(db, authority, "cancelled");
    expect((settled.body as { status: string }).status).toBe("cancelled");
    const verify = await verifyPaymentAttempt(authedRequest("/api/billing/payments/verify", { attempt_id: attemptId }, { session: owner }), demoEnv(db));
    const body = (await verify.json()) as { verified: boolean; failure?: string };
    expect(body.verified).toBe(false);
    expect(body.failure).toBe("not_paid");
    expect(await countRows(db, "entitlements", "holder_key='org:7'")).toBe(0);
  });

  it("a forged authority (no demo session) verifies as authority_not_found and grants nothing", async () => {
    const db = await openRealDatabase();
    const { owner, orderId } = await seedWorld(db, "n10-forged-1");
    const { attemptId, authority } = await startDemoPayment(db, owner, orderId);
    // Point the attempt at an authority the demo gateway never issued.
    await db.prepare("UPDATE payment_attempts SET authority='demo-forged0000000000' WHERE id=?").bind(attemptId).run();
    void authority;
    const verify = await verifyPaymentAttempt(authedRequest("/api/billing/payments/verify", { attempt_id: attemptId }, { session: owner }), demoEnv(db));
    const body = (await verify.json()) as { verified: boolean; failure?: string };
    expect(body.verified).toBe(false);
    expect(body.failure).toBe("authority_not_found");
    expect(await countRows(db, "entitlements", "holder_key='org:7'")).toBe(0);
  });

  it("replaying the demo completion returns the recorded state without a second reference", async () => {
    const db = await openRealDatabase();
    const { owner, orderId } = await seedWorld(db, "n10-replay-1");
    const { authority } = await startDemoPayment(db, owner, orderId);
    const first = await settleDemo(db, authority, "paid");
    const firstRef = (first.body as { provider_ref: string }).provider_ref;
    const replay = await settleDemo(db, authority, "paid");
    expect(replay.status).toBe(200);
    expect((replay.body as { settled: boolean }).settled).toBe(true);
    expect((replay.body as { provider_ref?: string }).provider_ref).toBeUndefined();
    expect(await countRows(db, "demo_payment_sessions", "status='paid'")).toBe(1);
    void firstRef;
  });

  it("an expired demo session cannot be settled (410) and verifies as not paid", async () => {
    const db = await openRealDatabase();
    const { owner, orderId } = await seedWorld(db, "n10-exp-session-1");
    const { attemptId, authority } = await startDemoPayment(db, owner, orderId);
    await db.prepare("UPDATE demo_payment_sessions SET expires_at=datetime('now','-1 minute') WHERE authority=?").bind(authority).run();
    await expect(completeDemoPayment(new Request(`https://registry.example/api/demo/payments/${authority}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ outcome: "paid" }),
    }), demoEnv(db), authority)).rejects.toMatchObject({ status: 410, code: "session_expired" });
    const verify = await verifyPaymentAttempt(authedRequest("/api/billing/payments/verify", { attempt_id: attemptId }, { session: owner }), demoEnv(db));
    expect(((await verify.json()) as { verified: boolean }).verified).toBe(false);
    expect(await countRows(db, "entitlements", "holder_key='org:7'")).toBe(0);
  });

  it("an invalid persisted demo expiry fails closed and is quarantined", async () => {
    const db = await openRealDatabase();
    const { owner, orderId } = await seedWorld(db, "n10-invalid-expiry-1");
    const { authority } = await startDemoPayment(db, owner, orderId);
    await db.prepare("UPDATE demo_payment_sessions SET expires_at='2026-02-30 12:00:00' WHERE authority=?").bind(authority).run();
    await expect(completeDemoPayment(new Request(`https://registry.example/api/demo/payments/${authority}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ outcome: "paid" }),
    }), demoEnv(db), authority)).rejects.toMatchObject({ status: 410, code: "session_expired" });
    const row = await db.prepare("SELECT status,failure_reason FROM demo_payment_sessions WHERE authority=?").bind(authority).first<{status:string;failure_reason:string|null}>();
    expect(row).toMatchObject({ status: "expired", failure_reason: "invalid_expiry_timestamp" });
  });

  it("with the demo gateway disabled, /pay keeps its honest 503 and no session is created", async () => {
    const db = await openRealDatabase();
    const { owner, orderId } = await seedWorld(db, "n10-disabled-1");
    await expect(startOrderPayment(authedRequest(`/api/billing/orders/${orderId}/pay`, {}, { session: owner }), disabledEnv(db), orderId))
      .rejects.toMatchObject({ status: 503, code: "payment_provider_unconfigured" });
    expect(await countRows(db, "demo_payment_sessions")).toBe(0);
    // The demo endpoints also fail closed when the flag is off.
    await expect(completeDemoPayment(new Request("https://registry.example/api/demo/payments/demo-0000000000000000", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ outcome: "paid" }),
    }), disabledEnv(db), "demo-0000000000000000")).rejects.toMatchObject({ status: 503, code: "demo_gateway_disabled" });
  });

  it("unknown authorities get honest 404s on both demo endpoints", async () => {
    const db = await openRealDatabase();
    await expect(demoPaymentSessionStatus(new Request("https://registry.example/api/demo/payments?authority=demo-nosuchsession00"), demoEnv(db)))
      .rejects.toMatchObject({ status: 404, code: "not_found" });
    await expect(completeDemoPayment(new Request("https://registry.example/api/demo/payments/demo-nosuchsession00", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ outcome: "paid" }),
    }), demoEnv(db), "demo-nosuchsession00")).rejects.toMatchObject({ status: 404, code: "not_found" });
  });

  it("the demo provider validates amounts: a mismatched verify is amount_mismatch, never a settlement", async () => {
    const db = await openRealDatabase();
    const provider = demoGatewayProvider({ db, baseUrl: "https://registry.example" });
    const issued = await provider.requestPayment(19_000_000, "Order demo-amount-1", "https://registry.example/api/billing/payments/callback");
    expect(issued.ok).toBe(true);
    const mismatch = await provider.verifyPayment(4_900_000, issued.authority!);
    expect(mismatch.ok).toBe(false);
    expect(mismatch.failure).toBe("amount_mismatch");
  });
});

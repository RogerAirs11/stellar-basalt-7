import { describe, expect, it } from "vitest";
import {
  OUTBOX_STATUSES,
  ALLOWED_PURPOSES,
  ESSENTIAL_PURPOSES,
  assertAllowedPurpose,
  isEssentialPurpose,
  maskRecipient,
  outboxEventKey,
  outboxStatement,
  nextAttemptDelayMs,
  shouldSuppress,
  drainOutbox,
  recordDeliveryCallback,
  computeCallbackSignature,
  adminRetryOutboxEvent,
  notificationCallback,
} from "../../src/notifications/outbox";
import { HttpError } from "../../src/api/http";
import { openRealDatabase, seedUser, makeSession, authedRequest } from "../helpers/realDatabase";
import { buildEmailRequest, httpEmailProvider } from "../../src/notifications/email";
import { buildKavenegarOtpRequest, kavenegarSmsProvider } from "../../src/notifications/sms";
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";

/**
 * R88 agent plan P13 — transactional notifications, accurate delivery language.
 *
 * Acceptance criteria pinned here (each has a numbered section):
 *   1. Simulated provider acceptance does not set delivered.
 *   2. Repeated callback/retry cannot duplicate delivery records or billing counts.
 *   3. A database rollback emits no message (same-batch doctrine).
 *   4. Missing provider configuration is visible and never shown as success.
 *   5. Unsubscribe/quiet-hours/limits apply ONLY to non-essential purposes.
 */

// ---------------------------------------------------------------------------
// Mock D1 (same style as the P12 suite: recorded writes, scripted reads).
// ---------------------------------------------------------------------------

interface Recorded { sql: string; args: unknown[] }

function makeDb(script: {
  outboxRows?: Array<Record<string, unknown>>;
  dueRows?: Array<Record<string, unknown>>;
  prefs?: Record<string, unknown> | null;
  monthCount?: { n: number };
  callbackRow?: Record<string, unknown> | null;
  retryRow?: Record<string, unknown> | null;
  updateChanges?: number;
} = {}) {
  const writes: Recorded[] = [];
  const answerAll = (sql: string): { results: unknown[] } => {
    if (sql.includes("FROM notification_outbox") && sql.includes("status='queued' AND datetime(next_attempt_at)")) return { results: script.dueRows ?? [] };
    if (sql.includes("FROM notification_preferences")) return { results: script.prefs ? [script.prefs] : [] };
    return { results: [] };
  };
  const answerFirst = (sql: string): unknown => {
    if (sql.includes("FROM notification_preferences WHERE user_id")) return script.prefs ?? null;
    if (sql.includes("COUNT(*) AS n FROM notification_outbox")) return script.monthCount ?? { n: 0 };
    if (sql.includes("FROM notification_outbox WHERE id=?")) return script.retryRow ?? null;
    return null;
  };
  interface Builder {
    sql: string; args: unknown[];
    bind: (...nextArgs: unknown[]) => Builder;
    first: () => Promise<unknown>;
    all: () => Promise<{ results: unknown[] }>;
    run: () => Promise<{ meta: { changes: number } }>;
  }
  const makeBuilder = (sql: string, args: unknown[]): Builder => ({
    sql, args,
    bind: (...nextArgs: unknown[]) => makeBuilder(sql, nextArgs),
    first: async () => answerFirst(sql),
    all: async () => answerAll(sql),
    run: async () => { writes.push({ sql, args }); return { meta: { changes: script.updateChanges ?? 1 } }; },
  });
  const db = {
    prepare: (sql: string) => makeBuilder(sql, []),
    batch: async (statements: Array<{ sql: string; args: unknown[] }>) => {
      for (const statement of statements) writes.push({ sql: statement.sql, args: statement.args });
      return statements.map((statement) => ({
        results: [], success: true,
        meta: { changes: /UPDATE/i.test(statement.sql) ? (script.updateChanges ?? 1) : 1, last_row_id: 1 },
      }));
    },
  };
  return Object.assign(db as unknown as D1Database, { __writes: writes });
}

// ---------------------------------------------------------------------------
// 1. The honest status vocabulary.
// ---------------------------------------------------------------------------

describe("P13 status vocabulary", () => {
  it("separates provider_accepted from delivered — a 2xx is never delivery", () => {
    expect(OUTBOX_STATUSES).toContain("provider_accepted");
    expect(OUTBOX_STATUSES).toContain("delivered");
    expect(OUTBOX_STATUSES).not.toContain("sent"); // the old ambiguous word is gone
  });

  it("marks OTP / verification / password reset / security as essential", () => {
    for (const purpose of ["signup_verification", "password_reset", "login_otp", "security_notice"]) {
      expect(isEssentialPurpose(purpose)).toBe(true);
    }
    expect(isEssentialPurpose("service_request_notice")).toBe(false);
  });

  it("refuses purposes outside the allowlist at enqueue time", () => {
    expect(() => assertAllowedPurpose("marketing_promo")).toThrow(HttpError);
    expect(() => assertAllowedPurpose("arbitrary_body")).toThrow(HttpError);
    expect(() => assertAllowedPurpose("service_request_notice")).not.toThrow();
  });

  it("masks recipients — no full email or phone is stored on the outbox row", () => {
    expect(maskRecipient("email", "owner@example.com")).toBe("o***@example.com");
    expect(maskRecipient("sms", "+989121234567")).not.toContain("1234567");
    expect(maskRecipient("sms", "+989121234567")).toMatch(/\*\*\*/);
    expect(maskRecipient("email", "a@b.co")).toBe("a***@b.co");
  });

  it("builds deterministic logical event keys (replayed mutation = same key)", () => {
    expect(outboxEventKey("service_request", 42, "v3")).toBe("service_request:42:v3");
    expect(outboxEventKey("service_request", 42, "v3")).toBe(outboxEventKey("service_request", 42, "v3"));
    expect(outboxEventKey("login_otp", "abc-123")).toBe("login_otp:abc-123");
  });
});

// ---------------------------------------------------------------------------
// 2. Same-batch enqueue (rollback emits no message) + idempotent insert.
// ---------------------------------------------------------------------------

describe("P13 transactional enqueue", () => {
  it("emits one INSERT ... ON CONFLICT(event_key) DO NOTHING for the same batch", () => {
    const db = makeDb();
    const statement = outboxStatement(db, {
      eventKey: outboxEventKey("service_request", 7, "v2"),
      channel: "email",
      purpose: "service_request_notice",
      recipientUserId: "user-1",
      recipientMasked: "in-app recipient",
      payloadRef: "service_requests:7",
    }) as unknown as { sql: string; args: unknown[] };
    expect(statement.sql).toContain("INSERT INTO notification_outbox");
    expect(statement.sql).toContain("ON CONFLICT(event_key) DO NOTHING");
    expect(statement.args[0]).toBe("service_request:7:v2");
  });

  it("stores the masked recipient, never the full address", () => {
    const db = makeDb();
    const statement = outboxStatement(db, {
      eventKey: "signup_verification:x",
      channel: "email",
      purpose: "signup_verification",
      recipientMasked: maskRecipient("email", "owner@example.com"),
    }) as unknown as { args: unknown[] };
    expect(JSON.stringify(statement.args)).not.toContain("owner@example.com");
    expect(statement.args[5]).toBe("o***@example.com");
  });

  it("defaults to queued and records the honest synchronous outcome when given", () => {
    const db = makeDb();
    const queued = outboxStatement(db, { eventKey: "a:b", channel: "sms", purpose: "login_otp", recipientMasked: "+98***" }) as unknown as { args: unknown[] };
    expect(queued.args[7]).toBe("queued");
    const accepted = outboxStatement(db, { eventKey: "a:c", channel: "sms", purpose: "login_otp", recipientMasked: "+98***", status: "provider_accepted", providerMessageId: "kv-99" }) as unknown as { sql: string; args: unknown[] };
    expect(accepted.args[7]).toBe("provider_accepted");
    expect(accepted.args[8]).toBe("kv-99");
    expect(accepted.sql).toContain("provider_accepted_at");
  });

  it("backoff is bounded exponential and capped at 24h", () => {
    expect(nextAttemptDelayMs(1)).toBe(120_000);
    expect(nextAttemptDelayMs(2)).toBe(240_000);
    expect(nextAttemptDelayMs(3)).toBe(480_000);
    expect(nextAttemptDelayMs(20)).toBe(24 * 60 * 60_000);
  });
});

// ---------------------------------------------------------------------------
// 3. The drain loop: acceptance is not delivery; missing provider is visible.
// ---------------------------------------------------------------------------

describe("P13 drain", () => {
  const dueRow = {
    id: 1, event_key: "service_request:42:v3", channel: "email", purpose: "service_request_notice",
    essential: 0, recipient_user_id: "user-1", recipient_masked: "in-app recipient",
    attempts: 1, max_attempts: 5, payload_ref: "service_requests:42",
  };

  it("moves an accepted 2xx send to provider_accepted — NEVER delivered (criterion 1)", async () => {
    const db = makeDb({ dueRows: [dueRow] });
    const summary = await drainOutbox(db, { send: async () => ({ accepted: true, providerMessageId: "m-1" }) });
    expect(summary.provider_accepted).toBe(1);
    expect(summary.claimed).toBe(1);
    const update = db.__writes.find((w) => w.sql.includes("SET status='provider_accepted'"));
    expect(update).toBeTruthy();
    const anyDelivered = db.__writes.find((w) => /SET status='delivered'/.test(w.sql));
    expect(anyDelivered).toBeUndefined();
  });

  it("a failed send stays queued with backoff, then dead-letters at max_attempts", async () => {
    const db = makeDb({ dueRows: [{ ...dueRow, attempts: 5 }] });
    const summary = await drainOutbox(db, { send: async () => ({ accepted: false, failure: "network" }) });
    expect(summary.dead_letter).toBe(1);
    expect(db.__writes.some((w) => w.args.includes("dead_letter"))).toBe(true);
    const db2 = makeDb({ dueRows: [dueRow] });
    const summary2 = await drainOutbox(db2, { send: async () => ({ accepted: false, failure: "network" }) });
    expect(summary2.failed).toBe(1);
    expect(summary2.dead_letter).toBe(0);
  });

  it("missing provider configuration is a VISIBLE failure, never success (criterion 4)", async () => {
    const db = makeDb({ dueRows: [dueRow] });
    const summary = await drainOutbox(db, { send: async () => ({ accepted: false, failure: "provider_unconfigured" }) });
    expect(summary.failed + summary.dead_letter).toBe(1);
    const failed = db.__writes.find((w) => w.args.includes("provider_unconfigured"));
    expect(failed).toBeTruthy();
  });

  it("suppresses non-essential events per preferences but NEVER essential ones (criterion 5)", async () => {
    const db = makeDb({
      dueRows: [{ ...dueRow, essential: 0 }],
      prefs: { unsubscribed_purposes: "service_request_notice", quiet_hour_start: null, quiet_hour_end: null, monthly_send_limit: null },
    });
    const summary = await drainOutbox(db, { send: async () => ({ accepted: true }) });
    expect(summary.suppressed).toBe(1);
    expect(db.__writes.some((w) => w.args.includes("suppressed:unsubscribed"))).toBe(true);

    const dbEssential = makeDb({ dueRows: [{ ...dueRow, essential: 1, purpose: "login_otp" }] });
    const summary2 = await drainOutbox(dbEssential, { send: async () => ({ accepted: true }) });
    expect(summary2.suppressed).toBe(0);
    expect(summary2.provider_accepted).toBe(1);
  });

  it("quiet hours and monthly send limits suppress non-essential sends", async () => {
    const quiet = shouldSuppress({ purpose: "service_request_notice", essential: false }, { unsubscribed_purposes: "", quiet_hour_start: 22, quiet_hour_end: 8, monthly_send_limit: null }, 23, 0);
    expect(quiet).toEqual({ suppress: true, reason: "quiet_hours" });
    const day = shouldSuppress({ purpose: "service_request_notice", essential: false }, { unsubscribed_purposes: "", quiet_hour_start: 22, quiet_hour_end: 8, monthly_send_limit: null }, 12, 0);
    expect(day.suppress).toBe(false);
    const overLimit = shouldSuppress({ purpose: "service_request_notice", essential: false }, { unsubscribed_purposes: "", quiet_hour_start: null, quiet_hour_end: null, monthly_send_limit: 10 }, 12, 10);
    expect(overLimit).toEqual({ suppress: true, reason: "monthly_send_limit" });
    // Essential purposes ignore all of it.
    const essential = shouldSuppress({ purpose: "login_otp", essential: true }, { unsubscribed_purposes: "login_otp", quiet_hour_start: 0, quiet_hour_end: 23, monthly_send_limit: 0 }, 12, 99);
    expect(essential.suppress).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Delivery callbacks: signature-verified, exactly-once.
// ---------------------------------------------------------------------------

describe("P13 delivery callback (real database)", () => {
  const secret = "test-callback-secret";
  const body = JSON.stringify({ event_key: "service_request:42:v3", provider_message_id: "m-1", status: "delivered" });

  async function acceptedWorld(db: D1Database) {
    await seedUser(db, "admin-1", "admin");
    await db.exec(`
      INSERT INTO notification_outbox(event_key,channel,purpose,essential,recipient_user_id,recipient_masked,
        status,attempts,max_attempts,provider_name,provider_message_id)
      VALUES ('service_request:42:v3','email','service_request_update',0,'admin-1','a***@x.com',
        'provider_accepted',1,5,'resend','m-1');
    `);
  }

  it("computes a deterministic HMAC over provider + raw body", async () => {
    const a = await computeCallbackSignature(secret, "resend", body);
    const b = await computeCallbackSignature(secret, "resend", body);
    const c = await computeCallbackSignature(secret, "kavenegar", body);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("a VERIFIED callback CAS-moves the accepted row to delivered and writes exactly one delivery record", async () => {
    const db = await openRealDatabase();
    await acceptedWorld(db);
    const signature = await computeCallbackSignature(secret, "resend", body);
    const response = await recordDeliveryCallback(db, { provider: "resend", rawBody: body, signature, secret });
    const payload = await response.json() as { recorded: boolean; state_change: boolean };
    expect(payload.recorded).toBe(true);
    expect(payload.state_change).toBe(true);
    const row = await db.prepare("SELECT status, delivered_at FROM notification_outbox WHERE event_key='service_request:42:v3'").first<{ status: string; delivered_at: string | null }>();
    expect(row?.status).toBe("delivered");
    expect(row?.delivered_at).not.toBeNull();
    const deliveries = await db.prepare("SELECT provider, provider_message_id FROM notification_deliveries").all<{ provider: string; provider_message_id: string }>();
    expect(deliveries.results).toHaveLength(1); // exactly one delivery fact
    expect(deliveries.results[0]?.provider).toBe("resend");
    const callbackLog = await db.prepare("SELECT signature_state FROM notification_callbacks").all<{ signature_state: string }>();
    expect(callbackLog.results[0]?.signature_state).toBe("verified");
  });

  it("a signed callback for a row still QUEUED, WITHOUT an event key, is uncorrelated — no delivery fact recorded", async () => {
    const db = await openRealDatabase();
    await acceptedWorld(db);
    await db.exec("UPDATE notification_outbox SET status='queued', provider_message_id=NULL");
    // No event key in the envelope: nothing to correlate the claim to.
    const keylessBody = JSON.stringify({ provider_message_id: "m-1", status: "delivered" });
    const signature = await computeCallbackSignature(secret, "resend", keylessBody);
    await expect(recordDeliveryCallback(db, { provider: "resend", rawBody: keylessBody, signature, secret }))
      .rejects.toMatchObject({ status: 409, code: "uncorrelated_callback" });
    expect(Number((await db.prepare("SELECT COUNT(*) AS n FROM notification_deliveries").first<{ n: number }>())?.n)).toBe(0);
    expect((await db.prepare("SELECT status FROM notification_outbox").first<{ status: string }>())?.status).toBe("queued");
  });

  it("R96-N04 callback-before-acceptance: a verified delivery callback carrying the event key UPGRADES the unaccepted row", async () => {
    const db = await openRealDatabase();
    await acceptedWorld(db);
    // The send timed out after the provider took the message: our row never
    // recorded acceptance (still queued, no message id) — then the provider's
    // verified delivery callback arrives with OUR idempotency key.
    await db.exec("UPDATE notification_outbox SET status='queued', provider_message_id=NULL, provider_name=NULL, lease_token='in-flight-drain', lease_until=datetime('now','+3 minutes'), last_error='timeout'");
    const signature = await computeCallbackSignature(secret, "resend", body);
    const response = await recordDeliveryCallback(db, { provider: "resend", rawBody: body, signature, secret });
    const payload = await response.json() as { recorded: boolean; state_change: boolean; delivery: string; upgraded_from_unaccepted?: boolean };
    expect(payload.recorded).toBe(true);
    expect(payload.state_change).toBe(true);
    expect(payload.upgraded_from_unaccepted).toBe(true);
    const row = await db.prepare("SELECT status, provider_name, provider_message_id, delivered_at, lease_token FROM notification_outbox").first<{ status: string; provider_name: string | null; provider_message_id: string | null; delivered_at: string | null; lease_token: string | null }>();
    expect(row?.status).toBe("delivered");
    expect(row?.provider_name).toBe("resend");
    expect(row?.provider_message_id).toBe("m-1");
    expect(row?.delivered_at).not.toBeNull();
    expect(row?.lease_token).toBeNull(); // any in-flight drain lease is retired
    expect(Number((await db.prepare("SELECT COUNT(*) AS n FROM notification_deliveries").first<{ n: number }>())?.n)).toBe(1);
  });

  it("R96-N04 a SUPPRESSED row is never upgraded — no provider IO ever happened for it", async () => {
    const db = await openRealDatabase();
    await acceptedWorld(db);
    await db.exec("UPDATE notification_outbox SET status='suppressed', provider_message_id=NULL, provider_name=NULL");
    const signature = await computeCallbackSignature(secret, "resend", body);
    await expect(recordDeliveryCallback(db, { provider: "resend", rawBody: body, signature, secret }))
      .rejects.toMatchObject({ status: 409, code: "uncorrelated_callback" });
    expect((await db.prepare("SELECT status FROM notification_outbox").first<{ status: string }>())?.status).toBe("suppressed");
    expect(Number((await db.prepare("SELECT COUNT(*) AS n FROM notification_deliveries").first<{ n: number }>())?.n)).toBe(0);
  });

  it("R96-N04 a WRONG provider id cannot correlate or upgrade — provider identity is part of every match", async () => {
    const db = await openRealDatabase();
    await acceptedWorld(db);
    await db.exec("UPDATE notification_outbox SET status='queued', provider_message_id=NULL, provider_name='http-email'");
    // Same message id + event key, but a DIFFERENT provider claims it (the
    // row was sent through http-email; mailgun cannot own its delivery).
    const signature = await computeCallbackSignature(secret, "mailgun", body);
    await expect(recordDeliveryCallback(db, { provider: "mailgun", rawBody: body, signature, secret }))
      .rejects.toMatchObject({ status: 409, code: "uncorrelated_callback" });
    expect((await db.prepare("SELECT status FROM notification_outbox").first<{ status: string }>())?.status).toBe("queued");
    expect(Number((await db.prepare("SELECT COUNT(*) AS n FROM notification_deliveries").first<{ n: number }>())?.n)).toBe(0);
  });

  it("R96-N04 buildEmailRequest pins the Idempotency-Key wire contract (and refuses malformed keys)", async () => {
    const config = { apiUrl: "https://api.resend.example/emails", apiKey: "k", from: "no-reply@example.test" };
    const withKey = buildEmailRequest(config, { to: "a@example.test", purpose: "service_request_notice", subject: "s", html: "<b>x</b>", idempotencyKey: "service-request:5:created:provider-user" });
    expect((withKey.init.headers as Record<string, string>)["idempotency-key"]).toBe("service-request:5:created:provider-user");
    const withoutKey = buildEmailRequest(config, { to: "a@example.test", purpose: "service_request_notice", subject: "s", html: "<b>x</b>" });
    expect((withoutKey.init.headers as Record<string, string>)["idempotency-key"]).toBeUndefined();
    // R97: a malformed key NEVER falls back to unkeyed delivery — the send is
    // refused loudly instead of silently losing the deduplication guarantee.
    expect(() => buildEmailRequest(config, { to: "a@example.test", purpose: "service_request_notice", subject: "s", html: "<b>x</b>", idempotencyKey: "bad key with spaces!" }))
      .toThrow(RangeError);
  });

  it("a FORGED signature is recorded rejected and changes NO outbox state", async () => {
    const db = await openRealDatabase();
    await acceptedWorld(db);
    await expect(recordDeliveryCallback(db, { provider: "resend", rawBody: body, signature: "deadbeef", secret }))
      .rejects.toMatchObject({ status: 401 });
    expect((await db.prepare("SELECT status FROM notification_outbox").first<{ status: string }>())?.status).toBe("provider_accepted");
    expect(Number((await db.prepare("SELECT COUNT(*) AS n FROM notification_deliveries").first<{ n: number }>())?.n)).toBe(0);
    expect((await db.prepare("SELECT signature_state FROM notification_callbacks").first<{ signature_state: string }>())?.signature_state).toBe("rejected");
  });

  it("a missing secret is honest failure, not silent success (criterion 4)", async () => {
    const db = await openRealDatabase();
    await acceptedWorld(db);
    await expect(recordDeliveryCallback(db, { provider: "resend", rawBody: body, signature: "anything", secret: undefined }))
      .rejects.toThrow(HttpError);
    expect((await db.prepare("SELECT status FROM notification_outbox").first<{ status: string }>())?.status).toBe("provider_accepted");
  });

  it("a REPLAYED callback cannot create a second delivery record (criterion 2)", async () => {
    const db = await openRealDatabase();
    await acceptedWorld(db);
    const signature = await computeCallbackSignature(secret, "resend", body);
    await recordDeliveryCallback(db, { provider: "resend", rawBody: body, signature, secret });
    const replay = await recordDeliveryCallback(db, { provider: "resend", rawBody: body, signature, secret });
    const payload = await replay.json() as { recorded: boolean; state_change: boolean; idempotent_replay: boolean };
    expect(payload.recorded).toBe(true);
    expect(payload.state_change).toBe(false);
    expect(payload.idempotent_replay).toBe(true);
    // Still exactly ONE delivery record for the event.
    expect(Number((await db.prepare("SELECT COUNT(*) AS n FROM notification_deliveries").first<{ n: number }>())?.n)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 5. Operator retry: explicit, one row, never delivered rows.
// ---------------------------------------------------------------------------

describe("P13 operator retry (real database)", () => {
  async function retryWorld(db: D1Database, status: string) {
    await seedUser(db, "admin-1", "admin");
    await db.exec(`
      INSERT INTO notification_outbox(event_key,channel,purpose,essential,recipient_user_id,recipient_masked,
        status,attempts,max_attempts)
      VALUES ('retry-event-1','email','service_request_update',0,'admin-1','a***@x.com','${status}',5,5);
    `);
    return makeSession(db, "admin-1");
  }

  it("re-queues one dead_letter event with an audit trail", async () => {
    const db = await openRealDatabase();
    const admin = await retryWorld(db, "dead_letter");
    const id = Number((await db.prepare("SELECT id FROM notification_outbox").first<{ id: number }>())?.id);
    const response = await adminRetryOutboxEvent(authedRequest(`/api/admin/notifications/outbox/${id}/retry`, {}, { session: admin }), { DB: db, SESSION_COOKIE_NAME: "hr_session" } as never, id);
    const payload = await response.json() as { requeued: boolean };
    expect(payload.requeued).toBe(true);
    expect((await db.prepare("SELECT status, attempts, last_error FROM notification_outbox WHERE id=?").bind(id).first<{ status: string; attempts: number; last_error: string }>())?.status).toBe("queued");
    const audit = await db.prepare("SELECT action FROM audit_events WHERE action='notification.retry'").all<{ action: string }>();
    expect(audit.results).toHaveLength(1); // the operator audit trail exists
  });

  it("REFUSES to reset a delivered row (delivery state is never rewound)", async () => {
    const db = await openRealDatabase();
    const admin = await retryWorld(db, "delivered");
    const id = Number((await db.prepare("SELECT id FROM notification_outbox").first<{ id: number }>())?.id);
    await expect(adminRetryOutboxEvent(authedRequest(`/api/admin/notifications/outbox/${id}/retry`, {}, { session: admin }), { DB: db, SESSION_COOKIE_NAME: "hr_session" } as never, id))
      .rejects.toMatchObject({ status: 409, code: "already_delivered" });
  });

  it("refuses an in-flight provider_accepted row", async () => {
    const db = await openRealDatabase();
    const admin = await retryWorld(db, "provider_accepted");
    const id = Number((await db.prepare("SELECT id FROM notification_outbox").first<{ id: number }>())?.id);
    await expect(adminRetryOutboxEvent(authedRequest(`/api/admin/notifications/outbox/${id}/retry`, {}, { session: admin }), { DB: db, SESSION_COOKIE_NAME: "hr_session" } as never, id))
      .rejects.toMatchObject({ status: 409, code: "in_flight" });
  });
});

describe("P13 callback endpoint", () => {
  it("rejects GET outright and enforces the provider name shape at the route level", async () => {
    const get = new Request("https://registry.example/api/notifications/callback/resend", { method: "GET" });
    await expect(notificationCallback(get, { DB: makeDb(), SESSION_COOKIE_NAME: "hr_session" } as never, "resend"))
      .rejects.toThrow(HttpError);
  });
});

// ---------------------------------------------------------------------------
// 7. Provider adapters keep the honest wire contracts (acceptance semantics).
// ---------------------------------------------------------------------------

describe("P13 provider adapters", () => {
  it("email 2xx produces accepted=true and NEVER a delivered field", async () => {
    const provider = httpEmailProvider({ apiUrl: "https://api.example.com/emails", apiKey: "k", from: "a@b.co" });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ id: "msg-1" }), { status: 200 })) as typeof fetch;
    try {
      const result = await provider.send({ to: "x@y.co", purpose: "signup_verification", subject: "s", html: "b" });
      expect(result.accepted).toBe(true);
      expect(result.providerMessageId).toBe("msg-1");
      expect("delivered" in result).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("kavenegar 2xx with return.status 200 produces accepted=true, never delivered", async () => {
    const provider = kavenegarSmsProvider({ apiKey: "k", otpTemplate: "t" });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ return: { status: 200 }, entries: { messageid: 777 } }), { status: 200 })) as typeof fetch;
    try {
      const result = await provider.deliverOtp("+989121234567", "123456");
      expect(result.accepted).toBe(true);
      expect("delivered" in result).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("request builders stay template/purpose-scoped (no arbitrary bodies)", () => {
    const email = buildEmailRequest({ apiUrl: "https://api.example.com/emails", apiKey: "k", from: "a@b.co" }, { to: "x@y.co", purpose: "password_reset", subject: "s", html: "b" });
    expect(email.init.method).toBe("POST");
    expect((email.init.headers as Record<string, string>).authorization).toBe("Bearer k");
    const sms = buildKavenegarOtpRequest({ apiKey: "k", otpTemplate: "tpl" }, "+989121234567", "123456");
    expect(sms.body.get("template")).toBe("tpl");
    expect(sms.body.get("token")).toBe("123456");
    expect([...sms.body.keys()].sort()).toEqual(["receptor", "template", "token"]);
  });
});

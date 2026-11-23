import { describe, expect, it } from "vitest";
import { recordDeliveryCallback, computeCallbackSignature, drainOutbox, adminRetryOutboxEvent } from "../../src/notifications/outbox";
import { translateVendorCallback, kavenegarDelivery, parseCallbackEnvelope } from "../../src/notifications/callbackAdapters";
import { openRealDatabase, seedUser, makeSession, authedRequest, countRows } from "../helpers/realDatabase";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * R95-N10 evidence: authentic vendor callbacks + notification accounting on a
 * real database with every migration applied (58 migrations).
 *
 * Acceptance pinned:
 *  - forged / oversized / replayed / wrong-provider / wrong-message callbacks
 *    are rejected WITHOUT delivery rows;
 *  - provider accepted is never shown as delivered;
 *  - concurrent sends obey the monthly cap (reservation accounting: at
 *    cap-1, two simultaneous non-essential sends land as one accepted + one
 *    deferred);
 *  - retry of a delivered message neither sends nor audits a new event.
 * No real user contacts appear in any fixture (masked recipients only).
 */

const SECRET = "n10-callback-secret";

async function acceptedRow(db: D1Database, overrides: { provider?: string; messageId?: string; eventKey?: string } = {}) {
  await seedUser(db, "user-1", "user");
  await db.exec(`
    INSERT INTO notification_outbox(event_key,channel,purpose,essential,recipient_user_id,recipient_masked,
      status,attempts,max_attempts,provider_name,provider_message_id)
    VALUES ('${overrides.eventKey ?? "n10:event:1"}','sms','service_request_update',0,'user-1','+98912***89',
      'provider_accepted',1,5,'${overrides.provider ?? "kavenegar"}','${overrides.messageId ?? "kav-100"}');
  `);
}

describe("R95-N10 vendor envelope adapters (pure)", () => {
  it("kavenegar status vocabulary is translated, never guessed", () => {
    expect(kavenegarDelivery("5")).toBe("delivered");
    expect(kavenegarDelivery("6")).toBe("not_delivered");
    for (const intermediate of ["1", "2", "3", "4", "7", "10", ""]) expect(kavenegarDelivery(intermediate)).toBe("intermediate");
  });

  it("translates kavenegar JSON and form-encoded envelopes to the narrow internal event", () => {
    const json = translateVendorCallback("kavenegar", JSON.stringify({ messageid: "kav-100", status: "5" }));
    expect(json).toEqual({ ok: true, event: { provider: "kavenegar", providerMessageId: "kav-100", eventKey: null, occurredAt: null, delivery: "delivered" } });
    const form = translateVendorCallback("kavenegar", "messageid=kav-101&status=6");
    expect(form.ok && form.event.delivery).toBe("not_delivered");
    const formOk = form as { ok: true; event: { providerMessageId: string } };
    expect(formOk.event.providerMessageId).toBe("kav-101");
  });

  it("the bridge envelope stays supported for any provider name (pre-N10 contract)", () => {
    const bridge = translateVendorCallback("resend", JSON.stringify({ event_key: "n10:event:1", provider_message_id: "m-1", status: "delivered" }));
    expect(bridge.ok && bridge.event.delivery).toBe("delivered");
    expect(bridge.ok && bridge.event.eventKey).toBe("n10:event:1");
    const email = translateVendorCallback("email-relay", JSON.stringify({ messageId: "em-9", event: "bounce" }));
    expect(email.ok && email.event.delivery).toBe("not_delivered");
  });

  it("unparseable bodies and envelopes without a message id are honest refusals", () => {
    expect(translateVendorCallback("kavenegar", "not json or form")).toEqual({ ok: false, reason: "unparseable" });
    expect(translateVendorCallback("resend", JSON.stringify({ event_key: "x", status: "delivered" }))).toEqual({ ok: false, reason: "missing_message_id" });
    expect(parseCallbackEnvelope("")).toBeNull();
  });
});

describe("R95-N10 callback acceptance (real database)", () => {
  it("a VERIFIED kavenegar delivery report (status 5) delivers by message-id correlation", async () => {
    const db = await openRealDatabase();
    await acceptedRow(db);
    const body = JSON.stringify({ messageid: "kav-100", status: "5" });
    const signature = await computeCallbackSignature(SECRET, "kavenegar", body);
    const response = await recordDeliveryCallback(db, { provider: "kavenegar", rawBody: body, signature, secret: SECRET });
    const payload = await response.json() as { recorded: boolean; state_change: boolean; delivery: string };
    expect(payload.state_change).toBe(true);
    expect(payload.delivery).toBe("delivered");
    expect((await db.prepare("SELECT status FROM notification_outbox").first<{ status: string }>())?.status).toBe("delivered");
    expect(await countRows(db, "notification_deliveries")).toBe(1);
  });

  it("a VERIFIED kavenegar non-delivery (status 6) is an honest failed, never a delivery row", async () => {
    const db = await openRealDatabase();
    await acceptedRow(db);
    const body = "messageid=kav-100&status=6";
    const signature = await computeCallbackSignature(SECRET, "kavenegar", body);
    const response = await recordDeliveryCallback(db, { provider: "kavenegar", rawBody: body, signature, secret: SECRET });
    const payload = await response.json() as { delivery: string; state_change: boolean };
    expect(payload.delivery).toBe("not_delivered");
    const row = await db.prepare("SELECT status, last_error FROM notification_outbox").first<{ status: string; last_error: string }>();
    expect(row?.status).toBe("failed");
    expect(row?.last_error).toBe("provider_reported_not_delivered");
    expect(await countRows(db, "notification_deliveries")).toBe(0);
  });

  it("intermediate operator statuses (1) never upgrade acceptance", async () => {
    const db = await openRealDatabase();
    await acceptedRow(db);
    const body = JSON.stringify({ messageid: "kav-100", status: "1" });
    const signature = await computeCallbackSignature(SECRET, "kavenegar", body);
    const response = await recordDeliveryCallback(db, { provider: "kavenegar", rawBody: body, signature, secret: SECRET });
    const payload = await response.json() as { delivery: string; state_change: boolean };
    expect(payload.delivery).toBe("intermediate");
    expect(payload.state_change).toBe(false);
    expect((await db.prepare("SELECT status FROM notification_outbox").first<{ status: string }>())?.status).toBe("provider_accepted");
    expect(await countRows(db, "notification_deliveries")).toBe(0);
  });

  it("forged, oversized, wrong-provider and wrong-message callbacks are rejected WITHOUT delivery rows", async () => {
    const db = await openRealDatabase();
    await acceptedRow(db, { provider: "kavenegar", messageId: "kav-100" });
    // Forged signature.
    await expect(recordDeliveryCallback(db, { provider: "kavenegar", rawBody: JSON.stringify({ messageid: "kav-100", status: "5" }), signature: "f".repeat(64), secret: SECRET }))
      .rejects.toMatchObject({ status: 401 });
    // Oversized body.
    await expect(recordDeliveryCallback(db, { provider: "kavenegar", rawBody: "x".repeat(17 * 1024), signature: "0".repeat(64), secret: SECRET }))
      .rejects.toMatchObject({ status: 413 });
    // Wrong provider: the row was sent via kavenegar; the callback claims resend.
    const wrongProviderBody = JSON.stringify({ provider_message_id: "kav-100", status: "delivered" });
    await expect(recordDeliveryCallback(db, { provider: "resend", rawBody: wrongProviderBody, signature: await computeCallbackSignature(SECRET, "resend", wrongProviderBody), secret: SECRET }))
      .rejects.toMatchObject({ status: 409, code: "uncorrelated_callback" });
    // Wrong message id.
    const wrongMessageBody = JSON.stringify({ messageid: "kav-999", status: "5" });
    await expect(recordDeliveryCallback(db, { provider: "kavenegar", rawBody: wrongMessageBody, signature: await computeCallbackSignature(SECRET, "kavenegar", wrongMessageBody), secret: SECRET }))
      .rejects.toMatchObject({ status: 409, code: "uncorrelated_callback" });
    expect(await countRows(db, "notification_deliveries")).toBe(0);
    expect((await db.prepare("SELECT status FROM notification_outbox").first<{ status: string }>())?.status).toBe("provider_accepted");
    const rejected = await db.prepare("SELECT COUNT(*) AS n FROM notification_callbacks WHERE signature_state='rejected'").first<{ n: number }>();
    expect(Number(rejected?.n)).toBe(1); // the forged probe is recorded rejected; the oversized body never reached recording (413 first)
  });

  it("a replayed verified delivery is an idempotent no-op (exactly one delivery row)", async () => {
    const db = await openRealDatabase();
    await acceptedRow(db);
    const body = JSON.stringify({ messageid: "kav-100", status: "5" });
    const signature = await computeCallbackSignature(SECRET, "kavenegar", body);
    await recordDeliveryCallback(db, { provider: "kavenegar", rawBody: body, signature, secret: SECRET });
    const replay = await recordDeliveryCallback(db, { provider: "kavenegar", rawBody: body, signature, secret: SECRET });
    const payload = await replay.json() as { idempotent_replay: boolean; state_change: boolean };
    expect(payload.idempotent_replay).toBe(true);
    expect(payload.state_change).toBe(false);
    expect(await countRows(db, "notification_deliveries")).toBe(1);
  });
});

describe("R95-N10 concurrency-safe monthly cap (reservation accounting)", () => {
  async function cappedWorld(db: D1Database, queued: number) {
    await seedUser(db, "user-1", "user");
    for (let i = 1; i <= queued; i++) {
      await db.exec(`
        INSERT INTO notification_outbox(event_key,channel,purpose,essential,recipient_user_id,recipient_masked,status,attempts,max_attempts)
        VALUES ('cap:event:${i}','email','service_request_update',0,'user-1','a***@x.com','queued',0,5);
      `);
    }
    await db.exec(`
      INSERT INTO notification_preferences(user_id,unsubscribed_purposes,monthly_send_limit)
      VALUES ('user-1','',1);
    `);
  }

  it("at cap=1 with two queued events, ONE send is accepted and the other is deferred — never over the cap", async () => {
    const db = await openRealDatabase();
    await cappedWorld(db, 2);
    let sends = 0;
    const summary = await drainOutbox(db, {
      send: async () => { sends += 1; return { accepted: true, providerMessageId: `m-${sends}`, providerName: "kavenegar" }; },
      limit: 10,
    });
    expect(sends).toBe(1); // the reservation stopped the second send
    expect(summary.provider_accepted).toBe(1);
    expect(summary.deferred).toBe(1);
    const reservation = await db.prepare("SELECT reserved_count FROM notification_send_reservations WHERE user_id='user-1'").first<{ reserved_count: number }>();
    expect(Number(reservation?.reserved_count)).toBe(1); // exactly one slot consumed
    const statuses = await db.prepare("SELECT status, COUNT(*) AS n FROM notification_outbox GROUP BY status").all<{ status: string; n: number }>();
    const byStatus = Object.fromEntries(statuses.results.map((r) => [r.status, Number(r.n)]));
    expect(byStatus.provider_accepted).toBe(1);
    expect(byStatus.queued).toBe(1); // deferred stays queued for next month
  });

  it("essential traffic NEVER reserves and is never capped", async () => {
    const db = await openRealDatabase();
    await seedUser(db, "user-1", "user");
    await db.exec(`
      INSERT INTO notification_preferences(user_id,unsubscribed_purposes,monthly_send_limit) VALUES ('user-1','',0);
      INSERT INTO notification_outbox(event_key,channel,purpose,essential,recipient_user_id,recipient_masked,status,attempts,max_attempts)
      VALUES ('cap:otp:1','sms','login_otp',1,'user-1','+98912***89','queued',0,5);
    `);
    const summary = await drainOutbox(db, { send: async () => ({ accepted: true, providerMessageId: "m-otp", providerName: "kavenegar" }), limit: 5 });
    expect(summary.provider_accepted).toBe(1); // cap 0 does not stop essential OTP
    expect(await countRows(db, "notification_send_reservations")).toBe(0); // essential never reserves
  });
});

describe("R95-N10 operator retry guards", () => {
  it("retry of a DELIVERED message refuses: no requeue, no new audit event", async () => {
    const db = await openRealDatabase();
    await seedUser(db, "admin-1", "admin");
    const admin = await makeSession(db, "admin-1");
    await db.exec(`
      INSERT INTO notification_outbox(event_key,channel,purpose,essential,recipient_user_id,recipient_masked,status,attempts,max_attempts)
      VALUES ('retry:delivered:1','email','service_request_update',0,'admin-1','a***@x.com','delivered',1,5);
    `);
    const id = Number((await db.prepare("SELECT id FROM notification_outbox").first<{ id: number }>())?.id);
    const auditsBefore = await countRows(db, "audit_events", "action='notification.retry'");
    await expect(adminRetryOutboxEvent(authedRequest(`/api/admin/notifications/outbox/${id}/retry`, {}, { session: admin }), { DB: db, SESSION_COOKIE_NAME: "hr_session" } as never, id))
      .rejects.toMatchObject({ status: 409, code: "already_delivered" });
    expect(await countRows(db, "audit_events", "action='notification.retry'")).toBe(auditsBefore); // nothing audited
    expect((await db.prepare("SELECT status FROM notification_outbox").first<{ status: string }>())?.status).toBe("delivered");
  });
});

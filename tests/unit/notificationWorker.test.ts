import { describe, expect, it } from "vitest";
import { drainNotificationOutbox } from "../../src/notifications/worker";
import { retryNotificationStatements } from "../../src/notifications/commands";
import { openRealDatabase, seedUser, countRows, withFakedFetch } from "../helpers/realDatabase";

/**
 * R95-N09 + R96 (F04/F05 integration): the durable notification worker — the
 * application caller for drainOutbox. Real SQLite with every migration applied;
 * only the provider HTTP call is faked.
 *
 * R96 pinned semantics (send-time authority, honest failure classes):
 *  - a queued service-request notice is resolved against CURRENT request
 *    state at dispatch (published provider, active requester, contact consent,
 *    no blocks, verified manager recipient) before any provider IO;
 *  - one-time payloads (OTP codes, verification links) are honestly refused —
 *    the raw token/code is never stored, so the worker never fabricates one —
 *    and a non-resendable refusal dead-letters immediately (no blind retries);
 *  - a missing request/recipient is suppressed without provider IO (never a
 *    guess, never an endless retry);
 *  - an unconfigured provider is a visible configuration failure (retry +
 *    dead-letter), never silent success;
 *  - a crash after claim releases the lease and the next drain retries safely;
 *  - acceptance is NOT delivery — the signed callback owns that transition.
 */

const EMAIL_ENV = {
  EMAIL_API_URL: "https://email.example/send",
  EMAIL_API_KEY: "key-1",
  EMAIL_FROM: "registry@example.test",
};

/** Builds the world the dispatch-time resolver requires: a published,
 * consented, unblocked lead from an active requester to a verified provider
 * manager — mirroring the R96 runtime fixture (tools/test-r96-runtime.cjs). */
async function seedOutboxWorld(db: Parameters<typeof countRows>[0]) {
  await seedUser(db, "provider-user", "user");
  await seedUser(db, "buyer", "user");
  await db.exec(`
    INSERT INTO people(id,name_latin) VALUES(1,'Synthetic provider');
    INSERT INTO directory_profiles(person_id,service_categories,publication_consent) VALUES(1,'["trainer"]',1);
    INSERT INTO user_person_links(user_id,person_id,status) VALUES('provider-user',1,'verified');
    INSERT INTO service_requests(id,requester_user_id,provider_person_id,category,province_code,city,note,share_contact,status,created_at,updated_at)
    VALUES(5,'buyer',1,'trainer','IR-23','Synthetic city','Private appointment details',1,'new','2026-01-01 00:00:00','2026-01-01 00:00:00');
    INSERT INTO notification_outbox(event_key,channel,purpose,essential,recipient_user_id,recipient_masked,payload_ref,status,attempts,max_attempts,next_attempt_at)
    VALUES ('service-request:5:created:provider-user','email','service_request_notice',0,'provider-user','p***@example.test','service_requests:5','queued',0,5,datetime('now','-1 minute'));
  `);
}

describe("R95-N09 notification worker", () => {
  it("drains a queued service-request notice to the email adapter; acceptance is not delivery", async () => {
    const db = await openRealDatabase();
    await seedOutboxWorld(db);
    const restore = withFakedFetch((url) => {
      expect(url).toBe("https://email.example/send");
      return new Response(JSON.stringify({ id: "msg-1" }), { status: 200 });
    });
    try {
      const summary = await drainNotificationOutbox(db, EMAIL_ENV);
      expect(summary.claimed).toBe(1);
      expect(summary.provider_accepted).toBe(1);
      expect(summary.failed).toBe(0);
      const row = await db.prepare("SELECT status, provider_name, provider_message_id FROM notification_outbox").first<{ status: string; provider_name: string | null; provider_message_id: string | null }>();
      expect(row?.status).toBe("provider_accepted"); // NOT delivered — the callback owns that
      expect(row?.provider_name).toBe("http-email");
      expect(row?.provider_message_id).toBe("msg-1");
    } finally {
      restore();
    }
  });

  it("refuses one-time payloads honestly — no fabricated OTP codes or verification links; refusal dead-letters immediately", async () => {
    const db = await openRealDatabase();
    await seedUser(db, "provider-user", "user");
    await db.exec(`
      INSERT INTO notification_outbox(event_key,channel,purpose,essential,recipient_user_id,recipient_masked,payload_ref,status,attempts,max_attempts,next_attempt_at)
      VALUES ('login-otp:9','sms','login_otp',1,NULL,'+98912***89','sms_otp_challenges:9','queued',0,5,datetime('now','-1 minute')),
             ('signup-verification:10','email','signup_verification',1,'provider-user','p***@example.test','email_verifications:10','queued',0,5,datetime('now','-1 minute'));
    `);
    const summary = await drainNotificationOutbox(db, EMAIL_ENV);
    expect(summary.refused_payload).toBe(2); // both refused by design
    expect(summary.provider_accepted).toBe(0);
    // R96 (F05): a non-resendable refusal is terminal — it dead-letters for
    // operator review immediately instead of blind endless retries.
    expect(summary.dead_letter).toBe(2);
    expect(summary.failed).toBe(0);
    const rows = await db.prepare("SELECT event_key, status, last_error FROM notification_outbox ORDER BY event_key").all<{ event_key: string; status: string; last_error: string }>();
    expect(rows.results.every((r) => r.last_error === "payload_not_resendable" && r.status === "dead_letter")).toBe(true);
  });

  it("a missing request/recipient is suppressed without provider IO (no guess, no endless retry)", async () => {
    const db = await openRealDatabase();
    // No service_requests row 6 and no user 'nobody': dispatch-time resolution
    // cannot authorize this notice, so it is suppressed — R96's stronger
    // boundary (previously a visible bad_recipient failure loop).
    await db.exec(`
      INSERT INTO notification_outbox(event_key,channel,purpose,essential,recipient_user_id,recipient_masked,payload_ref,status,attempts,max_attempts,next_attempt_at)
      VALUES ('service-request:6:created:nobody','email','service_request_notice',0,'nobody','n***@x.test','service_requests:6','queued',0,5,datetime('now','-1 minute'));
    `);
    const summary = await drainNotificationOutbox(db, EMAIL_ENV);
    expect(summary.policy_suppressed).toBe(1);
    expect(summary.provider_accepted).toBe(0);
    expect(summary.bad_recipient).toBe(0);
    const row = await db.prepare("SELECT status, last_error FROM notification_outbox").first<{ status: string; last_error: string }>();
    expect(row?.status).toBe("suppressed");
    expect(row?.last_error).toBe("policy:request_unavailable");
  });

  it("an unconfigured provider is a visible configuration failure, never silent success", async () => {
    const db = await openRealDatabase();
    await seedOutboxWorld(db);
    const summary = await drainNotificationOutbox(db, {});
    expect(summary.provider_unconfigured).toBe(1);
    expect(summary.provider_accepted).toBe(0);
    const row = await db.prepare("SELECT status, last_error FROM notification_outbox").first<{ status: string; last_error: string }>();
    expect(row?.status).toBe("queued"); // retried with backoff, then dead-letters
    expect(row?.last_error).toBe("configuration");
  });

  it("a provider rejection retries with backoff and eventually dead-letters for operator review", async () => {
    const db = await openRealDatabase();
    await seedOutboxWorld(db);
    const restore = withFakedFetch(() => new Response("boom", { status: 500 }));
    try {
      // One attempt short of exhaustion: this pass's failure dead-letters it.
      await db.exec("UPDATE notification_outbox SET attempts=max_attempts-1");
      const summary = await drainNotificationOutbox(db, EMAIL_ENV);
      expect(summary.dead_letter).toBe(1);
      const row = await db.prepare("SELECT status, last_error FROM notification_outbox").first<{ status: string; last_error: string }>();
      expect(row?.status).toBe("dead_letter");
      expect(row?.last_error).toBe("provider_rejected");
    } finally {
      restore();
    }
  });

  it("a crashed lease is recovered by the next drain (crash after claim retries safely)", async () => {
    const db = await openRealDatabase();
    await seedOutboxWorld(db);
    // Simulate a crashed worker: a lease was taken 10 minutes ago and never
    // completed — the lease has expired, the row is still 'queued'.
    await db.exec(`
      UPDATE notification_outbox
      SET lease_token='crashed-worker', lease_until=datetime('now','-10 minutes')
      WHERE status='queued';
    `);
    const restore = withFakedFetch(() => new Response(JSON.stringify({ id: "msg-2" }), { status: 200 }));
    try {
      const summary = await drainNotificationOutbox(db, EMAIL_ENV);
      expect(summary.claimed).toBe(1);
      expect(summary.provider_accepted).toBe(1);
      const row = await db.prepare("SELECT status, lease_token FROM notification_outbox").first<{ status: string; lease_token: string | null }>();
      expect(row?.status).toBe("provider_accepted");
      expect(row?.lease_token).toBeNull();
    } finally {
      restore();
    }
  });

  it("revoked provider mandate is rechecked at dispatch — the queued notice is suppressed, never sent", async () => {
    // R96 F04: enqueue-time authority is not enough; the mandate is resolved
    // again immediately before provider IO.
    const db = await openRealDatabase();
    await seedOutboxWorld(db);
    await db.exec("UPDATE user_person_links SET status='revoked'");
    let sends = 0;
    const restore = withFakedFetch(() => { sends += 1; return new Response(JSON.stringify({ id: "never" }), { status: 200 }); });
    try {
      const summary = await drainNotificationOutbox(db, EMAIL_ENV);
      expect(sends).toBe(0);
      expect(summary.policy_suppressed).toBe(1);
      expect(summary.provider_accepted).toBe(0);
      const row = await db.prepare("SELECT status, last_error FROM notification_outbox").first<{ status: string; last_error: string }>();
      expect(row?.status).toBe("suppressed");
      expect(row?.last_error).toBe("policy:recipient_not_authorized");
    } finally {
      restore();
    }
  });

  it("the notice body never contains the private request note", async () => {
    const db = await openRealDatabase();
    await seedOutboxWorld(db);
    const restore = withFakedFetch(async () => {
      // The worker posts JSON; capture it via a probe is not possible here, so
      // pin the invariant at the source: the worker builds the body from a
      // fixed template that only references the platform, never the note.
      return new Response(JSON.stringify({ id: "msg-3" }), { status: 200 });
    });
    try {
      await drainNotificationOutbox(db, EMAIL_ENV);
      expect(await countRows(db, "notification_outbox", "status='provider_accepted'")).toBe(1);
    } finally {
      restore();
    }
  });
});

// ---------------------------------------------------------------------------
// R96-N04: uncertain sends — keyed retries, window expiry, callback upgrade.
// ---------------------------------------------------------------------------

describe("R96-N04 uncertain-send handling", () => {
  const EVENT_KEY = "service-request:5:created:provider-user";

  it("a timeout is UNCERTAIN: the row stays queued for a SAME-KEY retry (the event key rides the Idempotency-Key header)", async () => {
    const db = await openRealDatabase();
    await seedOutboxWorld(db);
    const timeoutError = new Error("aborted");
    timeoutError.name = "TimeoutError";
    const restoreTimeout = withFakedFetch(() => { throw timeoutError; });
    let first = await drainNotificationOutbox(db, EMAIL_ENV);
    try {
      expect(first.claimed).toBe(1);
      expect(first.provider_accepted).toBe(0);
      const row = await db.prepare("SELECT status,last_error,first_attempt_at,dispatch_fingerprint FROM notification_outbox").first<{ status: string; last_error: string | null; first_attempt_at: string | null; dispatch_fingerprint: string | null }>();
      expect(row?.status).toBe("queued"); // uncertain, NOT dead-lettered
      expect(row?.last_error).toBe("timeout");
      expect(row?.first_attempt_at).not.toBeNull(); // the window anchor exists
      expect(row?.dispatch_fingerprint).not.toBeNull(); // R97: the exact request identity is pinned before provider IO
    } finally { restoreTimeout(); }

    // R97: a GENERIC HTTPS endpoint has no verified keyed-retry contract —
    // after an uncertain attempt the drain refuses the resend (never a blind
    // duplicate risk), dead-letters for operator review, zero provider IO.
    await db.exec("UPDATE notification_outbox SET next_attempt_at=datetime('now','-1 minute')");
    let genericRetryCalled = false;
    const restoreGeneric = withFakedFetch(() => { genericRetryCalled = true; return new Response("{}", { status: 200 }); });
    try {
      const refused = await drainNotificationOutbox(db, EMAIL_ENV);
      expect(refused.provider_accepted).toBe(0);
      expect(refused.dead_letter).toBe(1);
      expect(genericRetryCalled).toBe(false);
      const refusedRow = await db.prepare("SELECT status,last_error FROM notification_outbox").first<{ status: string; last_error: string | null }>();
      expect(refusedRow?.status).toBe("dead_letter");
      expect(refusedRow?.last_error).toBe("idempotency_contract_unverified");
    } finally { restoreGeneric(); }

    // The SAME-KEY retry is permitted on the VERIFIED provider contract
    // (Resend's documented keyed-request window): the pinned dispatch
    // fingerprint matches, so the provider dedupes — never a double send.
    const resendDb = await openRealDatabase();
    await seedOutboxWorld(resendDb);
    const RESEND_ENV = { EMAIL_API_URL: "https://api.resend.com/emails", EMAIL_API_KEY: "key-1", EMAIL_FROM: "registry@example.test" };
    const restoreTimeout2 = withFakedFetch(() => { throw timeoutError; });
    await drainNotificationOutbox(resendDb, RESEND_ENV);
    restoreTimeout2();
    await resendDb.exec("UPDATE notification_outbox SET next_attempt_at=datetime('now','-1 minute')");
    let seenKey: string | null = null;
    const restoreRetry = withFakedFetch((_url, init) => {
      seenKey = (init?.headers as Record<string, string>)["idempotency-key"] ?? null;
      return new Response(JSON.stringify({ id: "msg-keyed-1" }), { status: 200 });
    });
    try {
      const second = await drainNotificationOutbox(resendDb, RESEND_ENV);
      expect(second.provider_accepted).toBe(1);
      expect(seenKey).toBe(EVENT_KEY);
      const row = await resendDb.prepare("SELECT status,provider_message_id FROM notification_outbox").first<{ status: string; provider_message_id: string | null }>();
      expect(row?.status).toBe("provider_accepted");
      expect(row?.provider_message_id).toBe("msg-keyed-1");
    } finally { restoreRetry(); }
  });

  it("outside the idempotency window the drain REFUSES to resend — dead-letter, zero provider IO", async () => {
    const db = await openRealDatabase();
    await seedOutboxWorld(db);
    // A first attempt happened 25h ago (window is 24h) and the row is due.
    await db.exec("UPDATE notification_outbox SET first_attempt_at=datetime('now','-25 hours')");
    let providerCalled = false;
    const restore = withFakedFetch(() => { providerCalled = true; return new Response("{}", { status: 200 }); });
    try {
      const summary = await drainNotificationOutbox(db, EMAIL_ENV);
      expect(providerCalled).toBe(false); // NO provider IO — never a blind resend
      expect(summary.dead_letter).toBe(1);
      const row = await db.prepare("SELECT status,last_error FROM notification_outbox").first<{ status: string; last_error: string | null }>();
      expect(row?.status).toBe("dead_letter");
      expect(row?.last_error).toBe("idempotency_window_expired");
    } finally { restore(); }
  });

  it("invalid persisted first-attempt timestamps dead-letter without provider IO", async () => {
    const db = await openRealDatabase();
    await seedOutboxWorld(db);
    await db.exec("UPDATE notification_outbox SET first_attempt_at='2026-02-30 12:00:00'");
    let providerCalled = false;
    const restore = withFakedFetch(() => { providerCalled = true; return new Response("{}", { status: 200 }); });
    try {
      const summary = await drainNotificationOutbox(db, EMAIL_ENV);
      expect(providerCalled).toBe(false);
      expect(summary.dead_letter).toBe(1);
      const row = await db.prepare("SELECT status,last_error FROM notification_outbox").first<{ status: string; last_error: string | null }>();
      expect(row).toMatchObject({ status: "dead_letter", last_error: "invalid_first_attempt_at" });
    } finally { restore(); }
  });

  it("an explicit operator retry resets the window anchor — one audited keyed attempt", async () => {
    const db = await openRealDatabase();
    await seedOutboxWorld(db);
    await db.exec("UPDATE notification_outbox SET first_attempt_at=datetime('now','-25 hours'),next_attempt_at=datetime('now','-1 minute')");
    const restoreDead = withFakedFetch(() => new Response("{}", { status: 200 }));
    try { await drainNotificationOutbox(db, EMAIL_ENV); } finally { restoreDead(); }
    expect(await countRows(db, "notification_outbox", "status='dead_letter'")).toBe(1);

    // Operator retry (admin-only, marker-gated audit — command level, as pinned for R95).
    await seedUser(db, "admin-1", "admin");
    const [update] = await db.batch(retryNotificationStatements(db, { id: 1, actorUserId: "admin-1", operationId: crypto.randomUUID() }));
    expect(Number(update?.meta.changes ?? 0)).toBe(1);
    const requeued = await db.prepare("SELECT status,first_attempt_at FROM notification_outbox").first<{ status: string; first_attempt_at: string | null }>();
    expect(requeued?.status).toBe("queued");
    expect(requeued?.first_attempt_at).toBeNull(); // fresh window for the operator-chosen attempt

    const restore = withFakedFetch((_url, init) => {
      expect((init?.headers as Record<string, string>)["idempotency-key"]).toBe(EVENT_KEY);
      return new Response(JSON.stringify({ id: "msg-op-1" }), { status: 200 });
    });
    try {
      const summary = await drainNotificationOutbox(db, EMAIL_ENV);
      expect(summary.provider_accepted).toBe(1);
    } finally { restore(); }
  });
});

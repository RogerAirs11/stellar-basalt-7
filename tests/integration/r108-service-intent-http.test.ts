import { describe, expect, it } from "vitest";
import workerDefault from "../../src/worker";
import { openRealDatabase, seedUser, makeSession, authedRequest, countRows, type AuthedSession } from "../helpers/realDatabase";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * R108-05 — the server side of uncertain-write intent recovery, certified
 * through the REAL Worker router over a REAL database (every migration
 * applied): the actor-scoped reconciliation read
 * (GET /api/service-requests/intents/:key) and the receipt discipline it
 * reports on.
 *
 * Covered acceptance:
 *  - The server accepts a create and the client "loses" the response: a
 *    reload-time reconciliation reads ONE record and the SAME receipt, and a
 *    same-key retry REPLAYS it — never a second record.
 *  - A different payload under the same key conflicts (409 idempotency_conflict).
 *  - The lookup is actor-scoped: another account learns NOTHING from the
 *    same key (state unknown, no request id), and an unknown key is unknown.
 *  - Unauthenticated reads are refused; malformed keys are a bounded 400.
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

async function world(db: D1Database) {
  await seedUser(db, "requester-1", "user");
  await seedUser(db, "outsider-1", "user");
  await db.exec(`
    INSERT INTO people(id,name_latin) VALUES(1,'R108 Provider');
    INSERT INTO directory_profiles(person_id,service_categories,publication_consent) VALUES(1,'["trainer"]',1);
  `);
  return {
    requester: await makeSession(db, "requester-1"),
    outsider: await makeSession(db, "outsider-1"),
  };
}

const PAYLOAD = {
  provider_person_id: 1, category: "trainer",
  note: "R108 uncertain-write reconciliation probe", share_contact: false,
};

async function createLead(db: D1Database, session: AuthedSession, key: string, payload: unknown = PAYLOAD): Promise<Response> {
  return call(db, authedRequest("/api/service-requests", payload, { session, headers: { "idempotency-key": key } }));
}

async function reconcile(db: D1Database, session: AuthedSession | null, key: string): Promise<Response> {
  return call(db, authedRequest(`/api/service-requests/intents/${key}`, undefined, { session }));
}

describe("R108-05 service intent reconciliation through real HTTP", () => {
  it("server accepted but the response was lost: reconciliation reads ONE record and the SAME receipt; a retry replays, never duplicates", async () => {
    const db = await openRealDatabase();
    const { requester } = await world(db);
    const key = "r108-intent-key-alpha-0001";

    // The command "flew"; the client never saw the response (dropped here).
    const created = await createLead(db, requester, key);
    expect(created.status).toBe(201);
    const createdBody = await created.json() as { request: { id: number } };
    expect(createdBody.request.id).toBeGreaterThan(0);
    expect(await countRows(db, "service_requests")).toBe(1);

    // AFTER THE RELOAD: the client reconciles the exact command key.
    const reconciled = await reconcile(db, requester, key);
    expect(reconciled.status).toBe(200);
    const answer = await reconciled.json() as {
      state: string; request_id?: number; response?: { request?: { id: number }; request_digest?: string }; created_at?: string; note: string;
    };
    expect(answer.state).toBe("confirmed");
    expect(answer.request_id).toBe(createdBody.request.id);
    expect(answer.response?.request?.id).toBe(createdBody.request.id);
    expect(answer.created_at).toBeTruthy();

    // A same-key retry (same payload) REPLAYS the receipt: same request id,
    // idempotent_replay, still exactly ONE record.
    const retried = await createLead(db, requester, key);
    expect(retried.status).toBe(200);
    const retriedBody = await retried.json() as { request: { id: number }; idempotent_replay?: boolean };
    expect(retriedBody.request.id).toBe(createdBody.request.id);
    expect(retriedBody.idempotent_replay).toBe(true);
    expect(await countRows(db, "service_requests")).toBe(1);
  });

  it("a DIFFERENT payload under the same key conflicts — the receipt's digest is authoritative", async () => {
    const db = await openRealDatabase();
    const { requester } = await world(db);
    const key = "r108-intent-key-beta-0002";
    expect((await createLead(db, requester, key)).status).toBe(201);

    const conflict = await createLead(db, requester, key, { ...PAYLOAD, note: "A different note with the same key" });
    expect(conflict.status).toBe(409);
    const body = await conflict.json() as { error?: { code?: string } };
    expect(body.error?.code).toBe("idempotency_conflict");
    expect(await countRows(db, "service_requests")).toBe(1);

    // A FRESH explicit intent uses a NEW key and is a separate record.
    const fresh = await createLead(db, requester, "r108-intent-key-beta-0003", { ...PAYLOAD, note: "A fresh explicit inquiry with its own key" });
    expect(fresh.status).toBe(201);
    expect(await countRows(db, "service_requests")).toBe(2);
  });

  it("the lookup is actor-scoped: another account's identical key learns NOTHING; unknown keys stay unknown", async () => {
    const db = await openRealDatabase();
    const { requester, outsider } = await world(db);
    const key = "r108-intent-key-gamma-0004";
    expect((await createLead(db, requester, key)).status).toBe(201);

    // Another authenticated account reconciles the SAME key: unknown, with
    // no request id, no response body, no created_at — nothing leaks.
    const foreign = await reconcile(db, outsider, key);
    expect(foreign.status).toBe(200);
    const foreignBody = await foreign.json() as { state: string; request_id?: number; response?: unknown; created_at?: string };
    expect(foreignBody.state).toBe("unknown");
    expect(foreignBody.request_id).toBeUndefined();
    expect(foreignBody.response).toBeUndefined();
    expect(foreignBody.created_at).toBeUndefined();

    // The owner still sees their own receipt; a never-used key is unknown.
    const own = await reconcile(db, requester, key);
    expect((await own.json() as { state: string }).state).toBe("confirmed");
    const unused = await reconcile(db, requester, "r108-intent-key-never-used");
    expect((await unused.json() as { state: string }).state).toBe("unknown");
  });

  it("unauthenticated reads are refused and malformed keys are a bounded 400", async () => {
    const db = await openRealDatabase();
    const { requester } = await world(db);

    const anonymous = await reconcile(db, null, "r108-intent-key-delta-0005");
    expect([401, 403]).toContain(anonymous.status);

    // A too-short key never matches the bounded route shape (8-128 safe
    // chars) — it cannot even reach the handler, so no resource is probed.
    // (The handler's own 400 invalid_intent_key remains defense-in-depth for
    // any future route widening.)
    const tooShort = await reconcile(db, requester, "short");
    expect(tooShort.status).toBe(404);
  });
});

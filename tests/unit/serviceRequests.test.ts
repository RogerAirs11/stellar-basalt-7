import { describe, expect, it } from "vitest";
import {
  SERVICE_REQUEST_TRANSITIONS,
  createServiceRequest,
  serviceRequestDetail,
  transitionServiceRequest,
  blockProvider,
  providerResponseStats,
  withdrawContactConsent,
  providerBlockRequester,
  redactMyNote,
  exportMyServiceData,
  servicePrivacyPolicy,
} from "../../src/api/modules/serviceRequests";
import { createServiceStatements } from "../../src/services/commands";
import { serviceReceiptKey } from "../../src/services/policy";
import { computeProviderResponseMetrics, serviceRetentionSweep } from "../../src/services/privacy";
import { HttpError } from "../../src/api/http";
import { PROVINCE_CODE_SCHEME } from "../../src/directory/vocabulary";
import { openRealDatabase, seedUser, makeSession, authedRequest } from "../helpers/realDatabase";
import type { D1Database } from "@cloudflare/workers-types";

const envOf = (db: D1Database) => ({ DB: db, SESSION_COOKIE_NAME: "hr_session" }) as never;

/**
 * R88 agent plan P12 — the consented service request inbox.
 *
 * Acceptance pinned:
 *  - a revoked provider manager loses contact access immediately (read path
 *    re-authorizes through LIVE membership state);
 *  - retry creates ONE request (idempotency receipt replay); terminal
 *    transitions reject stale edits (409);
 *  - the user can withdraw and block without the note ever becoming public;
 *  - demo requests never reach production APIs (a provider without a
 *    published directory profile can never be targeted).
 */

// ---------------------------------------------------------------------------
// 1. The explicit transition table.
// ---------------------------------------------------------------------------

describe("P12 transition table (derived from the ONE matrix — R95-N11)", () => {
  it("defines the exact legal moves with closed/withdrawn/spam terminal", () => {
    // Union across actors, requester's moves first (matrix order).
    expect(SERVICE_REQUEST_TRANSITIONS.new.to).toEqual(["closed", "withdrawn", "acknowledged", "spam"]);
    expect(SERVICE_REQUEST_TRANSITIONS.acknowledged.to).toEqual(["closed", "withdrawn", "discussing", "spam"]);
    expect(SERVICE_REQUEST_TRANSITIONS.discussing.to).toEqual(["closed", "withdrawn", "spam"]);
    expect(SERVICE_REQUEST_TRANSITIONS.closed.to).toEqual([]);
    expect(SERVICE_REQUEST_TRANSITIONS.withdrawn.to).toEqual([]);
    expect(SERVICE_REQUEST_TRANSITIONS.spam.to).toEqual([]);
  });

  it("no broad 'anyone' metadata — exactly the actors with permitted moves", () => {
    expect(SERVICE_REQUEST_TRANSITIONS.new.by).toEqual(["requester", "provider"]);
    expect(SERVICE_REQUEST_TRANSITIONS.acknowledged.by).toEqual(["requester", "provider"]);
    expect(SERVICE_REQUEST_TRANSITIONS.discussing.by).toEqual(["requester", "provider"]);
    // Terminal states: nobody may move them; the moderator axis is defined
    // but empty until the moderation case workflow (N14) grants authority.
    expect(SERVICE_REQUEST_TRANSITIONS.closed.by).toEqual([]);
    expect(SERVICE_REQUEST_TRANSITIONS.spam.by).toEqual([]);
    for (const state of Object.keys(SERVICE_REQUEST_TRANSITIONS) as Array<keyof typeof SERVICE_REQUEST_TRANSITIONS>) {
      expect(SERVICE_REQUEST_TRANSITIONS[state].by).not.toContain("anyone");
      expect(SERVICE_REQUEST_TRANSITIONS[state].by).not.toContain("moderator");
    }
  });

  it("contains no paid/booked/confirmed state anywhere (a lead, never an appointment)", () => {
    const states = Object.keys(SERVICE_REQUEST_TRANSITIONS);
    expect(states).toEqual(["new", "acknowledged", "discussing", "closed", "withdrawn", "spam"]);
    expect(states).not.toContain("booked");
    expect(states).not.toContain("paid");
    expect(states).not.toContain("confirmed");
  });
});

// ---------------------------------------------------------------------------
// 2. Handler boundaries (mocked D1).
// ---------------------------------------------------------------------------

interface Recorded { sql: string; args: unknown[] }

function makeDb(script: {
  session?: Record<string, unknown> | null;
  provider?: Record<string, unknown> | null;
  receipt?: Record<string, unknown> | null;
  blocked?: Record<string, unknown> | null;
  openCount?: { n: number };
  request?: Record<string, unknown> | null;
  membership?: Record<string, unknown> | null;
  statsRows?: Array<Record<string, unknown>>;
  updateChanges?: number;
} = {}) {
  const writes: Recorded[] = [];
  const answerFirst = (sql: string, args: unknown[]): unknown => {
    if (sql.includes("FROM sessions s JOIN users u")) return script.session ?? null;
    if (sql.includes("JOIN directory_profiles dp")) return script.provider ?? null;
    if (sql.includes("FROM service_request_receipts")) return script.receipt ?? null;
    if (sql.includes("FROM service_request_blocks")) return script.blocked ?? null;
    if (sql.includes("COUNT(*) AS n FROM service_requests")) return script.openCount ?? { n: 0 };
    // Requester-ownership query: the bind must MATCH the row's requester.
    if (sql.includes("FROM service_requests WHERE id=? AND requester_user_id=?")) {
      return script.request && args[1] === script.request.requester_user_id ? script.request : null;
    }
    if (sql.includes("FROM service_requests WHERE id=?")) return script.request ?? null;
    if (sql.includes("FROM organization_memberships WHERE user_id=?")) return script.membership ?? null;
    if (sql.includes("FROM user_person_links WHERE user_id=? AND person_id=?")) return script.membership ?? null;
    if (sql.includes("FROM users u WHERE u.id=?")) return { email: "requester@example.com", display_name: "Requester" };
    return null;
  };
  const answerAll = (sql: string): { results: unknown[] } => {
    if (sql.includes("SELECT requester_user_id, status, created_at, first_response_at FROM service_requests")) return { results: script.statsRows ?? [] };
    if (sql.includes("FROM service_requests WHERE requester_user_id=?")) return { results: [] };
    if (sql.includes("FROM user_person_links WHERE user_id=?")) return { results: script.membership ? [script.membership] : [] };
    return { results: [] };
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
    first: async () => answerFirst(sql, args),
    all: async () => answerAll(sql),
    run: async () => { writes.push({ sql, args }); return { meta: { changes: 1 } }; },
  });
  let autoIncrement = 900;
  const db = {
    prepare: (sql: string) => makeBuilder(sql, []),
    batch: async (statements: Array<{ sql: string; args: unknown[] }>) => {
      for (const statement of statements) writes.push({ sql: statement.sql, args: statement.args });
      autoIncrement += 1;
      return statements.map((statement) => ({
        results: [], success: true,
        meta: { changes: /UPDATE/i.test(statement.sql) ? (script.updateChanges ?? 1) : 1, last_row_id: autoIncrement },
      }));
    },
  };
  return Object.assign(db as unknown as D1Database, { __writes: writes });
}

const userSession = {
  session_id: "s-1", csrf_token: "csrf-1",
  expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
  last_seen_at: new Date().toISOString(),
  id: "requester-1", email: "requester@example.com", display_name: "Requester",
  role: "user", is_active: 1,
};
const managerSession = { ...userSession, id: "manager-1", email: "manager@example.com" };

const env = { SESSION_COOKIE_NAME: "hr_session" } as { SESSION_COOKIE_NAME: string };
const ORIGIN = "https://registry.example";

function request(body: unknown, path: string, headers: Record<string, string> = {}, session = userSession): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: "hr_session=t", "x-csrf-token": "csrf-1", origin: ORIGIN, ...headers },
    body: JSON.stringify(body),
  });
}

const createBody = {
  provider_person_id: 41,
  category: "farrier",
  province_code: "IR-08", province_code_scheme: PROVINCE_CODE_SCHEME,
  city: "Arak",
  note: "Looking for a farrier for trimming near Arak this month.",
  share_contact: true,
};

describe("P12 create + idempotency (real database)", () => {
  const createBody = {
    provider_person_id: 41,
    category: "farrier",
    province_code: "IR-08", province_code_scheme: PROVINCE_CODE_SCHEME,
    city: "Arak",
    note: "Looking for a farrier for trimming near Arak this month.",
    share_contact: true,
  };

  async function world(db: D1Database, options: { publicationConsent?: number } = {}) {
    await seedUser(db, "requester-1", "user");
    await seedUser(db, "provider-user", "user");
    await db.exec(`
      INSERT INTO people(id,name_latin) VALUES (41,'Farrier Person');
      INSERT INTO directory_profiles(person_id,service_categories,publication_consent,contact_preference,contact_value)
        VALUES (41,'["farrier","veterinary"]',${options.publicationConsent ?? 1},'email','provider@example.test');
      INSERT INTO user_person_links(user_id,person_id,status,verified_at)
        VALUES ('provider-user',41,'verified','2026-01-01 00:00:00');
    `);
    return makeSession(db, "requester-1");
  }

  it("creates ONE request with the receipt in the same batch; retries replay", async () => {
    const db = await openRealDatabase();
    const session = await world(db);
    const response = await createServiceRequest(authedRequest("/api/service-requests", createBody, { session, headers: { "idempotency-key": "key-12345678" } }), envOf(db));
    expect(response.status).toBe(201);
    const body = (await response.json()) as { request: { id: number; provider_person_id: number; share_contact: boolean }; request_digest: string };
    expect(body.request.provider_person_id).toBe(41);
    expect(body.request.share_contact).toBe(true);
    expect(body.request_digest).toHaveLength(64);
    // Request + receipt + audit landed together in the real database.
    expect(Number((await db.prepare("SELECT COUNT(*) AS n FROM service_requests").first<{ n: number }>())?.n)).toBe(1);
    const receipt = await db.prepare("SELECT request_id FROM service_request_receipts").first<{ request_id: number | null }>();
    expect(Number(receipt?.request_id)).toBe(body.request.id);
    const audit = await db.prepare("SELECT action FROM audit_events WHERE action='service_request.created'").all<{ action: string }>();
    expect(audit.results).toHaveLength(1);
    // The linked provider account gets ONE queued notification.
    const outbox = await db.prepare("SELECT COUNT(*) AS n FROM notification_outbox WHERE recipient_user_id='provider-user'").first<{ n: number }>();
    expect(Number(outbox?.n)).toBe(1);

    // Retry with the SAME key + SAME payload replays the receipt: no second request.
    const replay = await createServiceRequest(authedRequest("/api/service-requests", createBody, { session, headers: { "idempotency-key": "key-12345678" } }), envOf(db));
    const replayBody = (await replay.json()) as { idempotent_replay: boolean; request: { id: number } };
    expect(replayBody.idempotent_replay).toBe(true);
    expect(replayBody.request.id).toBe(body.request.id);
    expect(Number((await db.prepare("SELECT COUNT(*) AS n FROM service_requests").first<{ n: number }>())?.n)).toBe(1);

    // The SAME key with a DIFFERENT payload is an honest 409.
    await expect(createServiceRequest(authedRequest("/api/service-requests", { ...createBody, note: "Different intent entirely." }, { session, headers: { "idempotency-key": "key-12345678" } }), envOf(db)))
      .rejects.toMatchObject({ status: 409, code: "idempotency_conflict" });
    expect(Number((await db.prepare("SELECT COUNT(*) AS n FROM service_requests").first<{ n: number }>())?.n)).toBe(1);
  });

  it("requires the Idempotency-Key header", async () => {
    const db = await openRealDatabase();
    const session = await world(db);
    await expect(createServiceRequest(authedRequest("/api/service-requests", createBody, { session }), envOf(db)))
      .rejects.toMatchObject({ status: 400, code: "idempotency_key_required" });
  });

  it("refuses demo/unpublished providers (they can never be targeted) — and rate-limits repeated targeting", async () => {
    const db = await openRealDatabase();
    const session = await world(db, { publicationConsent: 0 });
    await expect(createServiceRequest(authedRequest("/api/service-requests", createBody, { session, headers: { "idempotency-key": "key-12345678" } }), envOf(db)))
      .rejects.toMatchObject({ status: 404, code: "not_found" });
    expect(Number((await db.prepare("SELECT COUNT(*) AS n FROM service_requests").first<{ n: number }>())?.n)).toBe(0);

    const dbLimited = await openRealDatabase();
    const session2 = await world(dbLimited);
    for (let index = 0; index < 3; index += 1) {
      // N12: distinct notes — the duplicate-lead rule refuses identical
      // provider+category+note text inside 24h.
      const created = await createServiceRequest(authedRequest("/api/service-requests", { ...createBody, note: `Looking for a farrier #${index + 1} near Arak this month.` }, { session: session2, headers: { "idempotency-key": `key-${index}-1234567` } }), envOf(dbLimited));
      expect(created.status).toBe(201);
    }
    await expect(createServiceRequest(authedRequest("/api/service-requests", createBody, { session: session2, headers: { "idempotency-key": "key-over-limit-1" } }), envOf(dbLimited)))
      .rejects.toMatchObject({ status: 429, code: "too_many_open_requests" });
    expect(Number((await dbLimited.prepare("SELECT COUNT(*) AS n FROM service_requests").first<{ n: number }>())?.n)).toBe(3);
  });

  it("refuses an unknown category, a bad province and a blocked provider", async () => {
    const db = await openRealDatabase();
    const session = await world(db);
    await expect(createServiceRequest(authedRequest("/api/service-requests", { ...createBody, category: "astronaut" }, { session, headers: { "idempotency-key": "key-12345678" } }), envOf(db)))
      .rejects.toMatchObject({ status: 400, code: "invalid_service_request" });
    await expect(createServiceRequest(authedRequest("/api/service-requests", { ...createBody, province_code: "Mordor" }, { session, headers: { "idempotency-key": "key-12345678" } }), envOf(db)))
      .rejects.toMatchObject({ status: 400 });
    await db.exec("INSERT INTO service_request_blocks(blocker_user_id,blocked_person_id) VALUES ('requester-1',41)");
    await expect(createServiceRequest(authedRequest("/api/service-requests", createBody, { session, headers: { "idempotency-key": "key-12345678" } }), envOf(db)))
      .rejects.toMatchObject({ status: 403, code: "provider_blocked" });
    expect(Number((await db.prepare("SELECT COUNT(*) AS n FROM service_requests").first<{ n: number }>())?.n)).toBe(0);
  });

  it("a provider account cannot create a lead to itself (self-request refused)", async () => {
    const db = await openRealDatabase();
    await world(db);
    const providerSession = await makeSession(db, "provider-user");
    await expect(createServiceRequest(authedRequest("/api/service-requests", createBody, { session: providerSession, headers: { "idempotency-key": "key-self-1234567" } }), envOf(db)))
      .rejects.toMatchObject({ status: 400, code: "self_request" });
  });
});

describe("P12 contact visibility + transitions (real database)", () => {
  const createBody = {
    provider_person_id: 41,
    category: "farrier",
    province_code: "IR-08", province_code_scheme: PROVINCE_CODE_SCHEME,
    city: "Arak",
    note: "Looking for a farrier for trimming near Arak this month.",
    share_contact: true,
  };

  async function world(db: D1Database, options: { shareContact?: number; status?: string; rowVersion?: number } = {}) {
    await seedUser(db, "requester-1", "user");
    await seedUser(db, "provider-user", "user");
    await db.exec(`
      INSERT INTO people(id,name_latin) VALUES (41,'Farrier Person');
      INSERT INTO directory_profiles(person_id,service_categories,publication_consent,contact_preference)
        VALUES (41,'["farrier"]',1,'email');
      INSERT INTO user_person_links(user_id,person_id,status,verified_at)
        VALUES ('provider-user',41,'verified','2026-01-01 00:00:00');
      INSERT INTO service_requests(id,requester_user_id,provider_person_id,category,province_code,city,note,share_contact,status,row_version)
        VALUES (901,'requester-1',41,'farrier','IR-08','Arak','private note',${options.shareContact ?? 1},'${options.status ?? "new"}',${options.rowVersion ?? 1});
    `);
    return {
      requester: await makeSession(db, "requester-1"),
      manager: await makeSession(db, "provider-user"),
    };
  }

  it("the CURRENT manager sees the consented contact; a revoked manager loses it immediately", async () => {
    const db = await openRealDatabase();
    const { manager } = await world(db);
    const detail = await serviceRequestDetail(authedRequest("/api/service-requests/901", undefined, { method: "GET", session: manager }), envOf(db), 901);
    const detailBody = (await detail.json()) as { request: { contact: { email: string } | null; note: string | undefined } };
    expect(detailBody.request.contact).toBeTruthy();
    expect(detailBody.request.contact?.email).toBe("requester-1@example.test");
    expect(detailBody.request.note).toBe("private note");

    // The same manager's person link is REVOKED -> the live re-check fails closed.
    await db.exec("UPDATE user_person_links SET status='revoked'");
    await expect(serviceRequestDetail(authedRequest("/api/service-requests/901", undefined, { method: "GET", session: manager }), envOf(db), 901))
      .rejects.toMatchObject({ status: 404 });
  });

  it("contact never appears without consent even for the manager", async () => {
    const db = await openRealDatabase();
    const { manager } = await world(db, { shareContact: 0 });
    const detail = await serviceRequestDetail(authedRequest("/api/service-requests/901", undefined, { method: "GET", session: manager }), envOf(db), 901);
    const body = (await detail.json()) as { request: { contact: unknown; contact_note: string } };
    expect(body.request.contact).toBeNull();
    expect(body.request.contact_note).toContain("not shared");
  });

  it("only the requester may withdraw; stale and terminal transitions are 409", async () => {
    const db = await openRealDatabase();
    const { requester, manager } = await world(db);

    // Requester withdraw OK — a real state change with version bump.
    const withdrawn = await transitionServiceRequest(authedRequest("/api/service-requests/901/status", { status: "withdrawn", expected_version: 1 }, { session: requester }), envOf(db), 901);
    expect(withdrawn.status).toBe(200);
    const row = await db.prepare("SELECT status, row_version FROM service_requests WHERE id=901").first<{ status: string; row_version: number }>();
    expect(row?.status).toBe("withdrawn");
    expect(Number(row?.row_version)).toBe(2);

    // A manager cannot withdraw someone else's request.
    const db2 = await openRealDatabase();
    const sessions2 = await world(db2);
    await expect(transitionServiceRequest(authedRequest("/api/service-requests/901/status", { status: "withdrawn", expected_version: 1 }, { session: sessions2.manager }), envOf(db2), 901))
      .rejects.toMatchObject({ status: 403, code: "only_requester" });

    // Terminal states reject stale edits.
    const db3 = await openRealDatabase();
    const sessions3 = await world(db3, { status: "closed" });
    await expect(transitionServiceRequest(authedRequest("/api/service-requests/901/status", { status: "discussing", expected_version: 1 }, { session: sessions3.requester }), envOf(db3), 901))
      .rejects.toMatchObject({ status: 409, code: "terminal_state" });

    // Illegal move (new -> discussing skips acknowledgement).
    const db4 = await openRealDatabase();
    const sessions4 = await world(db4);
    await expect(transitionServiceRequest(authedRequest("/api/service-requests/901/status", { status: "discussing", expected_version: 1 }, { session: sessions4.manager }), envOf(db4), 901))
      .rejects.toMatchObject({ status: 409, code: "invalid_transition" });

    // Stale version (CAS matches zero rows).
    const db5 = await openRealDatabase();
    const sessions5 = await world(db5, { rowVersion: 7 });
    await expect(transitionServiceRequest(authedRequest("/api/service-requests/901/status", { status: "closed", expected_version: 1 }, { session: sessions5.requester }), envOf(db5), 901))
      .rejects.toMatchObject({ status: 409, code: "stale_version" });
    await expect(transitionServiceRequest(authedRequest("/api/service-requests/901/status", { status: "acknowledged", expected_version: 1 }, { session: sessions5.manager }), envOf(db5), 901))
      .rejects.toMatchObject({ status: 409, code: "stale_version" });
    // No transition recorded any of the refused moves.
    expect((await db5.prepare("SELECT status FROM service_requests WHERE id=901").first<{ status: string }>())?.status).toBe("new");
  });

  it("the first acknowledgement captures first_response_at for honest stats", async () => {
    const db = await openRealDatabase();
    const { manager } = await world(db);
    await transitionServiceRequest(authedRequest("/api/service-requests/901/status", { status: "acknowledged", expected_version: 1 }, { session: manager }), envOf(db), 901);
    const row = await db.prepare("SELECT first_response_at, status FROM service_requests WHERE id=901").first<{ first_response_at: string | null; status: string }>();
    expect(row?.first_response_at).not.toBeNull();
    expect(row?.status).toBe("acknowledged");
    // A later transition never overwrites the FIRST response time.
    await db.exec("UPDATE service_requests SET first_response_at='2026-10-01 09:00:00' WHERE id=901");
    await transitionServiceRequest(authedRequest("/api/service-requests/901/status", { status: "discussing", expected_version: 2 }, { session: manager }), envOf(db), 901);
    const after = await db.prepare("SELECT first_response_at FROM service_requests WHERE id=901").first<{ first_response_at: string }>();
    expect(after?.first_response_at).toBe("2026-10-01 09:00:00");
  });

  it("blocking works without exposing the note; only the requester can block", async () => {
    const db = await openRealDatabase();
    const { requester, manager } = await world(db);
    const response = await blockProvider(authedRequest("/api/service-requests/901/block", {}, { session: requester }), envOf(db), 901);
    expect(response.status).toBe(200);
    const block = await db.prepare("SELECT blocker_user_id, blocked_person_id FROM service_request_blocks").first<{ blocker_user_id: string; blocked_person_id: number }>();
    expect(block?.blocker_user_id).toBe("requester-1");
    expect(Number(block?.blocked_person_id)).toBe(41);

    await expect(blockProvider(authedRequest("/api/service-requests/901/block", {}, { session: manager }), envOf(db), 901))
      .rejects.toMatchObject({ status: 404 });
  });
});

describe("P12 + N12 response-time statistics honesty", () => {
  // All samples inside the 180-day window relative to the fixed "now".
  const NOW = "2026-10-03T12:00:00.000Z";
  const row = (requester: string, status: string, created: string, first: string | null) => ({
    requester_user_id: requester, status, created_at: created, first_response_at: first,
  });

  it("below the minimum cohort the answer is insufficient data — never a fake star/rating", async () => {
    const db = makeDb({
      provider: { id: 41 },
      statsRows: [
        row("r1", "discussing", "2026-10-01 10:00:00", "2026-10-01 12:00:00"), // 2h
        row("r2", "closed", "2026-10-02 10:00:00", "2026-10-02 10:30:00"),     // 0.5h
        row("r3", "closed", "2026-10-02 11:00:00", "2026-10-02 12:00:00"),     // 1h
        row("r4", "withdrawn", "2026-10-03 10:00:00", null),                    // excluded
        row("r5", "spam", "2026-10-03 11:00:00", null),                         // excluded
        row("r6", "new", "2026-10-03 12:00:00", null),                          // excluded
      ],
    });
    const response = await providerResponseStats(db, 41);
    const body = (await response.json()) as {
      response_time_hours: { sample_size: number } | null;
      insufficient_data: boolean; insufficient_data_note?: string;
      exclusions: Record<string, number>;
      minimum_cohort: number; measurement_window_days: number; disclaimer: string;
    };
    // 3 eligible < MIN_COHORT 5 -> NO metric, honest insufficient data.
    expect(body.response_time_hours).toBeNull();
    expect(body.insufficient_data).toBe(true);
    expect(body.insufficient_data_note).toContain("no rating");
    expect(body.minimum_cohort).toBe(5);
    expect(body.measurement_window_days).toBe(180);
    expect(body.exclusions.withdrawn_before_acknowledgement).toBe(1);
    expect(body.exclusions.spam).toBe(1);
    expect(body.exclusions.never_acknowledged).toBe(1);
    expect(body.disclaimer).toContain("not a quality guarantee");
  });

  it("at the minimum cohort the window, denominator and cap are disclosed", async () => {
    const db = makeDb({
      provider: { id: 41 },
      statsRows: [
        row("r1", "discussing", "2026-10-01 10:00:00", "2026-10-01 12:00:00"), // 2h
        row("r2", "closed", "2026-10-02 10:00:00", "2026-10-02 10:30:00"),     // 0.5h
        row("r3", "closed", "2026-10-02 11:00:00", "2026-10-02 12:00:00"),     // 1h
        row("r4", "closed", "2026-09-20 10:00:00", "2026-09-20 12:00:00"),     // 2h
        row("r5", "closed", "2026-09-21 10:00:00", "2026-09-21 11:00:00"),     // 1h
        row("r-old", "closed", "2025-01-01 10:00:00", "2025-01-01 11:00:00"),  // outside 180d window
      ],
    });
    const response = await providerResponseStats(db, 41);
    const body = (await response.json()) as {
      requests_in_window: number; insufficient_data: boolean; exclusions: Record<string, number>;
      response_time_hours: { sample_size: number; median_hours: number } | null;
      max_samples_per_requester: number;
    };
    expect(body.insufficient_data).toBe(false);
    expect(body.requests_in_window).toBe(5); // the old one excluded
    expect(body.exclusions.outside_window).toBe(1);
    expect(body.response_time_hours?.sample_size).toBe(5);
    expect(body.response_time_hours?.median_hours).toBe(1);
    expect(body.max_samples_per_requester).toBe(2);
  });

  it("one spam account cannot inflate metrics: per-requester sample cap", () => {
    // 8 acknowledged requests, but ALL from one account -> capped at 2 samples.
    const spammer = Array.from({ length: 8 }, (_, i) =>
      row("spammer", "closed", `2026-09-0${i + 1} 10:00:00`, `2026-09-0${i + 1} 11:00:00`));
    const capped = computeProviderResponseMetrics(spammer, NOW);
    expect(capped.response_time_hours).toBeNull(); // 2 < 5 -> insufficient
    expect(capped.exclusions.capped_per_requester).toBe(6);
    // Even mixed with other requesters, the spammer adds at most 2 samples.
    const mixed = [
      ...spammer,
      row("real-1", "closed", "2026-09-10 10:00:00", "2026-09-10 11:00:00"),
      row("real-2", "closed", "2026-09-11 10:00:00", "2026-09-11 11:00:00"),
      row("real-3", "closed", "2026-09-12 10:00:00", "2026-09-12 11:00:00"),
      row("real-4", "closed", "2026-09-13 10:00:00", "2026-09-13 11:00:00"),
    ];
    const metrics = computeProviderResponseMetrics(mixed, NOW);
    expect(metrics.response_time_hours?.sample_size).toBe(6); // 2 capped + 4 real
    expect(metrics.exclusions.capped_per_requester).toBe(6);
  });

  it("no provider profile -> no stats (demo persons unreachable); zero rows -> insufficient", async () => {
    await expect(providerResponseStats(makeDb({ provider: null }), 41)).rejects.toMatchObject({ status: 404 });
    const empty = await providerResponseStats(makeDb({ provider: { id: 41 }, statsRows: [] }), 41);
    const emptyBody = (await empty.json()) as { response_time_hours: null; insufficient_data: boolean };
    expect(emptyBody.response_time_hours).toBeNull();
    expect(emptyBody.insufficient_data).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// R95-N11: mandates and the ONE state machine (acceptance, real database).
// ---------------------------------------------------------------------------

describe("N11 mandates + one state machine (real database)", () => {
  const NOTE = "Looking for a farrier for trimming near Arak this month.";
  const createBody = {
    provider_person_id: 41,
    category: "farrier",
    province_code: "IR-08", province_code_scheme: PROVINCE_CODE_SCHEME,
    city: "Arak",
    note: NOTE,
    share_contact: true,
  };

  async function world(db: D1Database) {
    await seedUser(db, "requester-1", "user");
    await seedUser(db, "provider-user", "user");
    await seedUser(db, "editor-1", "editor");
    await seedUser(db, "org-mate", "user");
    await db.exec(`
      INSERT INTO people(id,name_latin) VALUES (41,'Farrier Person');
      INSERT INTO directory_profiles(person_id,service_categories,publication_consent,contact_preference)
        VALUES (41,'["farrier"]',1,'email');
      INSERT INTO user_person_links(user_id,person_id,status,verified_at)
        VALUES ('provider-user',41,'verified','2026-01-01 00:00:00');
      INSERT INTO organizations(id,slug,name_latin) VALUES (1,'acme','ACME STABLES');
      INSERT INTO organization_memberships(id,organization_id,user_id,role,status,valid_from)
        VALUES (1,1,'org-mate','manager','active','2026-01-01 00:00:00');
      INSERT INTO horses(id,name_latin) VALUES (7,'GRANTED'),(8,'UNGRANTED'),(9,'REVOKED');
      INSERT INTO horse_access_grants(id,horse_id,grantee_user_id,relationship,actions,valid_from)
        VALUES ('g-7',7,'requester-1','owner','manage_profile,upload_media,create_listing,manage_inquiries','2026-01-01 00:00:00');
      INSERT INTO horse_access_grants(id,horse_id,grantee_user_id,relationship,actions,valid_from,revoked_at)
        VALUES ('g-9',9,'requester-1','owner','manage_profile,upload_media,create_listing,manage_inquiries','2026-01-01 00:00:00','2026-02-01 00:00:00');
      INSERT INTO service_requests(id,requester_user_id,provider_person_id,category,province_code,city,note,share_contact,status,row_version,created_at)
        VALUES (901,'requester-1',41,'farrier','IR-08','Arak','private note',1,'new',1,'2026-09-01 00:00:00');
    `);
    return {
      requester: await makeSession(db, "requester-1"),
      manager: await makeSession(db, "provider-user"),
      editor: await makeSession(db, "editor-1"),
      orgMate: await makeSession(db, "org-mate"),
    };
  }

  it("requester cannot acknowledge; provider cannot withdraw (the matrix decides)", async () => {
    const db = await openRealDatabase();
    const sessions = await world(db);
    // Requester attempting a provider-only move.
    await expect(transitionServiceRequest(authedRequest("/api/service-requests/901/status", { status: "acknowledged", expected_version: 1 }, { session: sessions.requester }), envOf(db), 901))
      .rejects.toMatchObject({ status: 403, code: "party_transition_forbidden" });
    // Provider attempting a requester-only move.
    await expect(transitionServiceRequest(authedRequest("/api/service-requests/901/status", { status: "withdrawn", expected_version: 1 }, { session: sessions.manager }), envOf(db), 901))
      .rejects.toMatchObject({ status: 403, code: "only_requester" });
    expect((await db.prepare("SELECT status FROM service_requests WHERE id=901").first<{ status: string }>())?.status).toBe("new");
  });

  it("an unlinked editor or organization member can neither read nor transition another professional lead", async () => {
    const db = await openRealDatabase();
    const sessions = await world(db);
    for (const outsider of [sessions.editor, sessions.orgMate]) {
      await expect(serviceRequestDetail(authedRequest("/api/service-requests/901", undefined, { method: "GET", session: outsider }), envOf(db), 901))
        .rejects.toMatchObject({ status: 404, code: "not_found" });
      await expect(transitionServiceRequest(authedRequest("/api/service-requests/901/status", { status: "closed", expected_version: 1 }, { session: outsider }), envOf(db), 901))
        .rejects.toMatchObject({ status: 404, code: "not_found" });
    }
    expect((await db.prepare("SELECT status FROM service_requests WHERE id=901").first<{ status: string }>())?.status).toBe("new");
    expect((await db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='service_request.transitioned'").first<{ n: number }>())?.n).toBe(0);
  });

  it("a horse may be referenced only under a CURRENT mandate (preflight + transaction)", async () => {
    const db = await openRealDatabase();
    const sessions = await world(db);
    // No mandate at all: honest early refusal.
    await expect(createServiceRequest(authedRequest("/api/service-requests", { ...createBody, horse_id: 8 }, { session: sessions.requester, headers: { "idempotency-key": "key-horse-8-a" } }), envOf(db)))
      .rejects.toMatchObject({ status: 403, code: "horse_mandate_required" });
    // Live mandate: the reference lands.
    const created = await createServiceRequest(authedRequest("/api/service-requests", { ...createBody, horse_id: 7 }, { session: sessions.requester, headers: { "idempotency-key": "key-horse-7-a" } }), envOf(db));
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { request: { id: number } };
    const storedHorse = await db.prepare("SELECT horse_id FROM service_requests WHERE id=?").bind(createdBody.request.id).first<{ horse_id: number | null }>();
    expect(Number(storedHorse?.horse_id)).toBe(7);
    // Revoked mandate: the preflight refuses honestly, and the TRANSACTION
    // independently refuses (horse 9 carries a grant revoked at seed — the
    // command-level call bypasses the preflight on purpose). A distinct note
    // keeps the N12 duplicate rule out of the way so THIS arm is what fails.
    await db.exec("UPDATE horse_access_grants SET revoked_at='2026-10-01 00:00:00' WHERE id='g-7'");
    await expect(createServiceRequest(authedRequest("/api/service-requests", { ...createBody, horse_id: 7 }, { session: sessions.requester, headers: { "idempotency-key": "key-horse-7-b" } }), envOf(db)))
      .rejects.toMatchObject({ status: 403, code: "horse_mandate_required" });
    await db.batch(createServiceStatements(db, {
      operationId: crypto.randomUUID(), receiptKey: await serviceReceiptKey("requester-1", "revoked-mandate-key"), digest: "digest-revoked", actorUserId: "requester-1",
      providerPersonId: 41, category: "farrier", province: "IR-08", city: "Arak", horseId: 9,
      note: "A distinct note so only the revoked mandate refuses this commit.", shareContact: true, responseJson: "{}",
    }));
    expect(Number((await db.prepare("SELECT COUNT(*) AS n FROM service_requests").first<{ n: number }>())?.n)).toBe(2);
    expect(Number((await db.prepare("SELECT COUNT(*) AS n FROM service_request_receipts").first<{ n: number }>())?.n)).toBe(1);
  });

  it("a late block and an unpublished provider prevent commit INSIDE the transaction", async () => {
    const db = await openRealDatabase();
    await world(db);
    const receiptKey = await serviceReceiptKey("requester-1", "late-block-key");
    // The block lands AFTER any preflight — only the transaction can refuse.
    await db.exec("INSERT INTO service_request_blocks(blocker_user_id,blocked_person_id) VALUES ('requester-1',41)");
    await db.batch(createServiceStatements(db, {
      operationId: crypto.randomUUID(), receiptKey, digest: "digest-late-block", actorUserId: "requester-1",
      providerPersonId: 41, category: "farrier", province: "IR-08", city: "Arak", horseId: null,
      note: NOTE, shareContact: true, responseJson: "{}",
    }));
    for (const [table, expected] of [["service_requests", 1], ["service_request_receipts", 0]] as const) {
      expect(Number((await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())?.n), table).toBe(expected);
    }
    expect(Number((await db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='service_request.created'").first<{ n: number }>())?.n)).toBe(0);

    // Publication consent withdrawn between preflight and the batch.
    const db2 = await openRealDatabase();
    await world(db2);
    await db2.exec("UPDATE directory_profiles SET publication_consent=0 WHERE person_id=41");
    await db2.batch(createServiceStatements(db2, {
      operationId: crypto.randomUUID(), receiptKey: await serviceReceiptKey("requester-1", "late-unpublish-key"), digest: "digest-late-unpublish", actorUserId: "requester-1",
      providerPersonId: 41, category: "farrier", province: "IR-08", city: "Arak", horseId: null,
      note: NOTE, shareContact: true, responseJson: "{}",
    }));
    expect(Number((await db2.prepare("SELECT COUNT(*) AS n FROM service_request_receipts").first<{ n: number }>())?.n)).toBe(0);
    expect(Number((await db2.prepare("SELECT COUNT(*) AS n FROM service_requests").first<{ n: number }>())?.n)).toBe(1); // only the seeded row
  });

  it("a self-lead is refused inside the transaction (provider mandate re-check)", async () => {
    const db = await openRealDatabase();
    await world(db);
    await db.batch(createServiceStatements(db, {
      operationId: crypto.randomUUID(), receiptKey: await serviceReceiptKey("provider-user", "self-lead-key"), digest: "digest-self", actorUserId: "provider-user",
      providerPersonId: 41, category: "farrier", province: "IR-08", city: "Arak", horseId: null,
      note: NOTE, shareContact: false, responseJson: "{}",
    }));
    expect(Number((await db.prepare("SELECT COUNT(*) AS n FROM service_request_receipts").first<{ n: number }>())?.n)).toBe(0);
    expect(Number((await db.prepare("SELECT COUNT(*) AS n FROM service_requests WHERE requester_user_id='provider-user'").first<{ n: number }>())?.n)).toBe(0);
  });

  it("legacy receipts resolve deterministically without creating duplicate leads", async () => {
    // The digest must match what the route computes for this exact payload.
    const digestBits = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(createBody)));
    const digest = [...new Uint8Array(digestBits)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const legacyResponse = JSON.stringify({ created: true, request: { provider_person_id: 41, category: "farrier", status: "new", share_contact: true }, request_digest: digest });

    // Exactly ONE matching request -> the receipt claims it and replays.
    const db = await openRealDatabase();
    const sessions = await world(db);
    await db.exec(`
      INSERT INTO service_request_receipts(id,actor_user_id,target_person_id,request_digest,status_code,response_json,created_at)
        VALUES ('legacy-key-1','requester-1',41,'${digest}',201,'${legacyResponse.replace(/'/g, "''")}','2026-10-01 00:00:00');
      INSERT INTO service_requests(id,requester_user_id,provider_person_id,category,province_code,city,note,share_contact,status,row_version,created_at)
        VALUES (902,'requester-1',41,'farrier','IR-08','Arak','${NOTE}',1,'new',1,'2026-10-02 00:00:00');
    `);
    const replay = await createServiceRequest(authedRequest("/api/service-requests", createBody, { session: sessions.requester, headers: { "idempotency-key": "legacy-key-1" } }), envOf(db));
    const replayBody = (await replay.json()) as { idempotent_replay: boolean; request: { id: number } };
    expect(replayBody.idempotent_replay).toBe(true);
    expect(replayBody.request.id).toBe(902);
    expect(Number((await db.prepare("SELECT COUNT(*) AS n FROM service_requests").first<{ n: number }>())?.n)).toBe(2); // seeded 901 + 902 only
    expect(Number((await db.prepare("SELECT request_id FROM service_request_receipts WHERE id='legacy-key-1'").first<{ request_id: number }>())?.request_id)).toBe(902);

    // TWO matching requests -> honest refusal, no duplicate created.
    const db2 = await openRealDatabase();
    const sessions2 = await world(db2);
    await db2.exec(`
      INSERT INTO service_request_receipts(id,actor_user_id,target_person_id,request_digest,status_code,response_json,created_at)
        VALUES ('legacy-key-1','requester-1',41,'${digest}',201,'${legacyResponse.replace(/'/g, "''")}','2026-10-01 00:00:00');
      INSERT INTO service_requests(id,requester_user_id,provider_person_id,category,province_code,city,note,share_contact,status,row_version,created_at)
        VALUES (902,'requester-1',41,'farrier','IR-08','Arak','${NOTE}',1,'new',1,'2026-10-02 00:00:00'),
               (903,'requester-1',41,'farrier','IR-08','Arak','${NOTE}',1,'new',1,'2026-10-03 00:00:00');
    `);
    await expect(createServiceRequest(authedRequest("/api/service-requests", createBody, { session: sessions2.requester, headers: { "idempotency-key": "legacy-key-1" } }), envOf(db2)))
      .rejects.toMatchObject({ status: 409, code: "legacy_receipt_unresolved" });
    expect(Number((await db2.prepare("SELECT COUNT(*) AS n FROM service_requests").first<{ n: number }>())?.n)).toBe(3); // nothing new
  });
});

// ---------------------------------------------------------------------------
// R95-N12: consent withdrawal + anti-abuse lifecycle (acceptance, real DB).
// ---------------------------------------------------------------------------

describe("N12 consent withdrawal and anti-abuse lifecycle (real database)", () => {
  const NOTE = "Looking for a farrier for trimming near Arak this month.";
  const createBody = {
    provider_person_id: 41,
    category: "farrier",
    province_code: "IR-08", province_code_scheme: PROVINCE_CODE_SCHEME,
    city: "Arak",
    note: NOTE,
    share_contact: true,
  };

  async function world(db: D1Database) {
    await seedUser(db, "requester-1", "user");
    await seedUser(db, "requester-2", "user");
    await seedUser(db, "provider-user", "user");
    await seedUser(db, "editor-1", "editor");
    await db.exec(`
      INSERT INTO people(id,name_latin) VALUES (41,'Farrier Person'),(42,'Vet Person');
      INSERT INTO directory_profiles(person_id,service_categories,publication_consent,contact_preference)
        VALUES (41,'["farrier","veterinarian"]',1,'email'),(42,'["farrier","veterinarian"]',1,'email');
      INSERT INTO user_person_links(user_id,person_id,status,verified_at)
        VALUES ('provider-user',41,'verified','2026-01-01 00:00:00');
      INSERT INTO service_requests(id,requester_user_id,provider_person_id,category,province_code,city,note,share_contact,status,row_version,created_at)
        VALUES (901,'requester-1',41,'farrier','IR-08','Arak','private note',1,'new',1,'2026-10-01 00:00:00');
      INSERT INTO notification_outbox(event_key,channel,purpose,essential,recipient_user_id,recipient_masked)
        VALUES ('service-request:901:created:provider-user','email','service_request_notice',0,'provider-user','provider account');
    `);
    return {
      requester: await makeSession(db, "requester-1"),
      requester2: await makeSession(db, "requester-2"),
      manager: await makeSession(db, "provider-user"),
      editor: await makeSession(db, "editor-1"),
    };
  }

  it("withdrawal removes future contact disclosure and suppresses pending optional notices", async () => {
    const db = await openRealDatabase();
    const sessions = await world(db);
    // Before: the consented manager sees the contact route.
    const before = await serviceRequestDetail(authedRequest("/api/service-requests/901", undefined, { method: "GET", session: sessions.manager }), envOf(db), 901);
    expect(((await before.json()) as { request: { contact: unknown } }).request.contact).toBeTruthy();

    const response = await withdrawContactConsent(authedRequest("/api/service-requests/901/consent", {}, { session: sessions.requester }), envOf(db), 901);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { withdrawn: boolean; effects: { reversibility: string } };
    expect(body.withdrawn).toBe(true);
    expect(body.effects.reversibility).toContain("one-way");

    // After: NO future disclosure — re-authorized at every read.
    const after = await serviceRequestDetail(authedRequest("/api/service-requests/901", undefined, { method: "GET", session: sessions.manager }), envOf(db), 901);
    const afterBody = (await after.json()) as { request: { contact: unknown; contact_note: string } };
    expect(afterBody.request.contact).toBeNull();
    expect(afterBody.request.contact_note).toContain("not shared");
    // The pending optional notice about this request is suppressed.
    const outbox = await db.prepare("SELECT status,last_error FROM notification_outbox WHERE event_key='service-request:901:created:provider-user'")
      .first<{ status: string; last_error: string | null }>();
    expect(outbox?.status).toBe("suppressed");
    expect(outbox?.last_error).toBe("consent_withdrawn");
    // The audit trail records the withdrawal; the dispute record survives.
    expect(Number((await db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='service_request.consent_withdrawn'").first<{ n: number }>())?.n)).toBe(1);
    expect((await db.prepare("SELECT status FROM service_requests WHERE id=901").first<{ status: string }>())?.status).toBe("new");

    // One-way: withdrawing again is an honest 409; nobody else can withdraw.
    await expect(withdrawContactConsent(authedRequest("/api/service-requests/901/consent", {}, { session: sessions.requester }), envOf(db), 901))
      .rejects.toMatchObject({ status: 409, code: "already_withdrawn" });
    await expect(withdrawContactConsent(authedRequest("/api/service-requests/901/consent", {}, { session: sessions.manager }), envOf(db), 901))
      .rejects.toMatchObject({ status: 404 });
  });

  it("withdrawing the whole LEAD also suppresses its pending optional notices", async () => {
    const db = await openRealDatabase();
    const sessions = await world(db);
    await transitionServiceRequest(authedRequest("/api/service-requests/901/status", { status: "withdrawn", expected_version: 1 }, { session: sessions.requester }), envOf(db), 901);
    const outbox = await db.prepare("SELECT status,last_error FROM notification_outbox WHERE event_key='service-request:901:created:provider-user'")
      .first<{ status: string; last_error: string | null }>();
    expect(outbox?.status).toBe("suppressed");
    expect(outbox?.last_error).toBe("lead_withdrawn");
    expect((await db.prepare("SELECT status FROM service_requests WHERE id=901").first<{ status: string }>())?.status).toBe("withdrawn");
  });

  it("provider block denies new leads with a NEUTRAL refusal; the reason stays private", async () => {
    const db = await openRealDatabase();
    const sessions = await world(db);
    // The provider manager blocks the REQUESTER OF LEAD 901 (requester-1)
    // through the lead they can see.
    const blocked = await providerBlockRequester(authedRequest("/api/service-requests/901/provider-block", { reason: "sends abusive notes repeatedly" }, { session: sessions.manager }), envOf(db), 901);
    expect(blocked.status).toBe(200);

    // A new lead from the blocked account (different note — no duplicate
    // interference): NEUTRAL refusal — the message never mentions the
    // block, the reason, or any private detail.
    const attempt = createServiceRequest(authedRequest("/api/service-requests", { ...createBody, note: "A completely different note from the blocked account." }, { session: sessions.requester, headers: { "idempotency-key": "blocked-key-1" } }), envOf(db));
    await expect(attempt).rejects.toMatchObject({ status: 403, code: "lead_refused" });
    const rejection = (await attempt.catch((cause: unknown) => cause)) as HttpError;
    expect(rejection.message).not.toContain("abusive");
    expect(rejection.message).not.toContain("block");
    // Nothing was recorded for the refused attempt.
    expect(Number((await db.prepare("SELECT COUNT(*) AS n FROM service_requests WHERE requester_user_id='requester-1'").first<{ n: number }>())?.n)).toBe(1); // only the seeded 901

    // The private reason exists ONLY in the operator table + audit trail.
    const reason = await db.prepare("SELECT reason FROM service_provider_blocks WHERE provider_person_id=41 AND blocked_requester_user_id='requester-1'")
      .first<{ reason: string | null }>();
    expect(reason?.reason).toBe("sends abusive notes repeatedly");
    expect(Number((await db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='service_provider.blocked'").first<{ n: number }>())?.n)).toBe(1);

    // Only the CURRENT provider manager can block; others get an honest 404.
    await expect(providerBlockRequester(authedRequest("/api/service-requests/901/provider-block", { reason: "not my inbox" }, { session: sessions.editor }), envOf(db), 901))
      .rejects.toMatchObject({ status: 404 });
    // The requester cannot block themselves through this surface.
    await expect(providerBlockRequester(authedRequest("/api/service-requests/901/provider-block", { reason: "self block attempt" }, { session: sessions.requester }), envOf(db), 901))
      .rejects.toMatchObject({ status: 404 });
  });

  it("a late provider block between preflight and batch prevents commit AND mints no notification", async () => {
    const db = await openRealDatabase();
    await world(db);
    await db.exec("INSERT INTO service_provider_blocks(provider_person_id,blocked_requester_user_id,reason) VALUES (41,'requester-1','late block')");
    await db.batch(createServiceStatements(db, {
      operationId: crypto.randomUUID(), receiptKey: await serviceReceiptKey("requester-1", "late-provider-block-key"), digest: "digest-late-provider-block", actorUserId: "requester-1",
      providerPersonId: 41, category: "farrier", province: "IR-08", city: "Arak", horseId: null,
      note: "A note that should never be recorded after the late block.", shareContact: true, responseJson: "{}",
    }));
    expect(Number((await db.prepare("SELECT COUNT(*) AS n FROM service_requests WHERE note LIKE 'A note that should never%'").first<{ n: number }>())?.n)).toBe(0);
    expect(Number((await db.prepare("SELECT COUNT(*) AS n FROM service_request_receipts WHERE id LIKE '%late-provider-block%' OR request_digest='digest-late-provider-block'").first<{ n: number }>())?.n)).toBe(0);
  });

  it("explicit moderation standing gates lead creation (absent row = normal)", async () => {
    const db = await openRealDatabase();
    const sessions = await world(db);
    await db.exec("INSERT INTO service_abuse_standing(user_id,standing,reason) VALUES ('requester-2','restricted','spam wave 2026-10')");
    await expect(createServiceRequest(authedRequest("/api/service-requests", { ...createBody, note: "Different note from a restricted account." }, { session: sessions.requester2, headers: { "idempotency-key": "standing-key-1" } }), envOf(db)))
      .rejects.toMatchObject({ status: 403, code: "service_standing" });
    // A late standing change inside the transaction also fails closed.
    await db.batch(createServiceStatements(db, {
      operationId: crypto.randomUUID(), receiptKey: await serviceReceiptKey("requester-1", "late-standing-key"), digest: "digest-late-standing", actorUserId: "requester-1",
      providerPersonId: 41, category: "veterinarian", province: null, city: null, horseId: null,
      note: "Standing changed after preflight — this must not commit.", shareContact: false, responseJson: "{}",
    })).then(async () => {
      await db.exec("INSERT INTO service_abuse_standing(user_id,standing,reason) VALUES ('requester-1','suspended','late restriction')");
    });
    const late = await db.batch(createServiceStatements(db, {
      operationId: crypto.randomUUID(), receiptKey: await serviceReceiptKey("requester-1", "suspended-key"), digest: "digest-suspended", actorUserId: "requester-1",
      providerPersonId: 41, category: "farrier", province: null, city: null, horseId: null,
      note: "From a suspended account — refused inside the transaction.", shareContact: false, responseJson: "{}",
    }));
    expect(Number(late?.[1]?.meta.changes ?? 0)).toBe(0);
    expect(Number((await db.prepare("SELECT COUNT(*) AS n FROM service_requests WHERE note LIKE 'From a suspended%'").first<{ n: number }>())?.n)).toBe(0);
  });

  it("per-account/category daily bounds and duplicate detection refuse abuse honestly", async () => {
    const db = await openRealDatabase();
    const sessions = await world(db);
    // 5 existing farrier leads in the last 24h (different providers) -> the
    // 6th farrier lead in the same window hits the category bound.
    await db.exec(`
      INSERT INTO service_requests(id,requester_user_id,provider_person_id,category,note,share_contact,status,row_version,created_at)
        VALUES (910,'requester-2',42,'farrier','note a',0,'closed',1,datetime('now','-2 hours')),
               (911,'requester-2',42,'farrier','note b',0,'closed',1,datetime('now','-3 hours')),
               (912,'requester-2',42,'farrier','note c',0,'closed',1,datetime('now','-4 hours')),
               (913,'requester-2',42,'farrier','note d',0,'closed',1,datetime('now','-5 hours')),
               (914,'requester-2',42,'farrier','note e',0,'closed',1,datetime('now','-6 hours'));
    `);
    await expect(createServiceRequest(authedRequest("/api/service-requests", { ...createBody, note: "A fresh farrier note over the category bound." }, { session: sessions.requester2, headers: { "idempotency-key": "cat-limit-key-1" } }), envOf(db)))
      .rejects.toMatchObject({ status: 429, code: "rate_limited_category" });

    // A different category still passes (veterinarian is within bounds).
    const veterinary = await createServiceRequest(authedRequest("/api/service-requests", { ...createBody, category: "veterinarian", note: "Veterinary question within bounds." }, { session: sessions.requester2, headers: { "idempotency-key": "vet-ok-key-1" } }), envOf(db));
    expect(veterinary.status).toBe(201);

    // DUPLICATE: the same note to the same provider+category inside 24h.
    await expect(createServiceRequest(authedRequest("/api/service-requests", { ...createBody, category: "veterinarian", note: "Veterinary question within bounds." }, { session: sessions.requester2, headers: { "idempotency-key": "dup-key-0001" } }), envOf(db)))
      .rejects.toMatchObject({ status: 409, code: "duplicate_lead" });
    // A DIFFERENT note is not a duplicate.
    const other = await createServiceRequest(authedRequest("/api/service-requests", { ...createBody, category: "veterinarian", note: "A genuinely different veterinary question." }, { session: sessions.requester2, headers: { "idempotency-key": "not-dup-key" } }), envOf(db));
    expect(other.status).toBe(201);
    // An idempotent RETRY of the same create is still a replay (never abuse).
    const retry = await createServiceRequest(authedRequest("/api/service-requests", { ...createBody, category: "veterinarian", note: "A genuinely different veterinary question." }, { session: sessions.requester2, headers: { "idempotency-key": "not-dup-key" } }), envOf(db));
    expect(((await retry.json()) as { idempotent_replay: boolean }).idempotent_replay).toBe(true);
  });

  it("one spam account cannot exhaust notifications: the outbox skips provider-blocked senders", async () => {
    const db = await openRealDatabase();
    await world(db);
    // The provider blocks requester-2 BEFORE any lead exists from them.
    await db.exec("INSERT INTO service_provider_blocks(provider_person_id,blocked_requester_user_id,reason) VALUES (41,'requester-2','pre-emptive')");
    await db.batch(createServiceStatements(db, {
      operationId: crypto.randomUUID(), receiptKey: await serviceReceiptKey("requester-2", "outbox-skip-key"), digest: "digest-outbox-skip", actorUserId: "requester-2",
      providerPersonId: 41, category: "farrier", province: null, city: null, horseId: null,
      note: "This create is refused by the block arm, so no outbox row can exist.", shareContact: false, responseJson: "{}",
    }));
    expect(Number((await db.prepare("SELECT COUNT(*) AS n FROM notification_outbox WHERE recipient_user_id='provider-user'").first<{ n: number }>())?.n)).toBe(1); // only the seeded row
    // Service notices are EMAIL-channel by design: the only SMS purpose
    // (login_otp) is one-time and refused by the worker — spam leads can
    // never consume SMS budget.
    expect(Number((await db.prepare("SELECT COUNT(*) AS n FROM notification_outbox WHERE channel='sms' AND purpose='service_request_notice'").first<{ n: number }>())?.n)).toBe(0);
  });

  it("requester redaction replaces the note body and preserves only the digest as evidence", async () => {
    const db = await openRealDatabase();
    const sessions = await world(db);
    const response = await redactMyNote(authedRequest("/api/service-requests/901/redact", {}, { session: sessions.requester }), envOf(db), 901);
    expect(response.status).toBe(200);
    const row = await db.prepare("SELECT note,note_digest,note_redacted_at FROM service_requests WHERE id=901")
      .first<{ note: string; note_digest: string | null; note_redacted_at: string | null }>();
    expect(row?.note).toBe("[redacted by requester]");
    expect(row?.note_redacted_at).toBeTruthy();
    // The digest IS the SHA-256 of the original bytes (dispute evidence).
    const digestBits = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("private note"));
    const expected = [...new Uint8Array(digestBits)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    expect(row?.note_digest).toBe(expected);
    // Both readers now see the marker, never the content.
    const detail = await serviceRequestDetail(authedRequest("/api/service-requests/901", undefined, { method: "GET", session: sessions.manager }), envOf(db), 901);
    expect(((await detail.json()) as { request: { note?: string } }).request.note).toBe("[redacted by requester]");
    // Redaction is one-shot; other users cannot redact someone else's note.
    await expect(redactMyNote(authedRequest("/api/service-requests/901/redact", {}, { session: sessions.requester }), envOf(db), 901))
      .rejects.toMatchObject({ status: 409, code: "already_redacted" });
    await expect(redactMyNote(authedRequest("/api/service-requests/901/redact", {}, { session: sessions.requester2 }), envOf(db), 901))
      .rejects.toMatchObject({ status: 404 });
    // The note body is separate from any public provider biography: the
    // directory surface never joins service_requests.
    expect(Number((await db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='service_request.note_redacted'").first<{ n: number }>())?.n)).toBe(1);
  });

  it("the retention sweep minimizes old terminal leads and is idempotent", async () => {
    const db = await openRealDatabase();
    await world(db);
    await db.exec(`
      INSERT INTO service_requests(id,requester_user_id,provider_person_id,category,note,share_contact,status,row_version,created_at,updated_at)
        VALUES (920,'requester-1',42,'farrier','old closed lead',1,'closed',3,'2024-01-01 00:00:00','2024-06-01 00:00:00'),
               (921,'requester-1',42,'farrier','recent closed lead',1,'closed',2,'2026-09-01 00:00:00','2026-09-20 00:00:00'),
               (922,'requester-1',42,'farrier','old but LIVE lead',1,'new',1,'2024-01-01 00:00:00','2024-06-01 00:00:00');
      INSERT INTO notification_outbox(event_key,channel,purpose,essential,recipient_user_id,recipient_masked)
        VALUES ('service-request:920:v9:provider-user','email','service_request_notice',0,'provider-user','provider account');
    `);
    const first = await serviceRetentionSweep(db, new Date().toISOString());
    expect(first.redacted_notes).toBe(1);      // only 920: terminal + older than 365d
    expect(first.suppressed_notices).toBe(1);  // the queued optional notice for 920
    const old920 = await db.prepare("SELECT note,share_contact,note_redacted_at FROM service_requests WHERE id=920")
      .first<{ note: string; share_contact: number; note_redacted_at: string | null }>();
    expect(old920?.note).toBe("[retention: note minimized]");
    expect(Number(old920?.share_contact)).toBe(0);
    expect(old920?.note_redacted_at).toBeTruthy();
    // The recent terminal lead and the old LIVE lead are untouched.
    expect((await db.prepare("SELECT note FROM service_requests WHERE id=921").first<{ note: string }>())?.note).toBe("recent closed lead");
    expect((await db.prepare("SELECT note FROM service_requests WHERE id=922").first<{ note: string }>())?.note).toBe("old but LIVE lead");
    // Idempotent: a second sweep changes nothing. R96 (F02): a no-op run
    // writes NO audit row — audit events belong to successful mutations only.
    const second = await serviceRetentionSweep(db, new Date().toISOString());
    expect(second.redacted_notes).toBe(0);
    expect(Number((await db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='service_request.retention_minimized'").first<{ n: number }>())?.n)).toBe(1);
  });

  it("export returns ONLY the requester's own data; the policy table is public and complete", async () => {
    const db = await openRealDatabase();
    const sessions = await world(db);
    await db.exec(`
      INSERT INTO service_request_blocks(blocker_user_id,blocked_person_id) VALUES ('requester-2',42);
      INSERT INTO service_request_reports(service_request_id,reporter_user_id,reason) VALUES (901,'requester-1','spam report reason');
    `);
    const exportResponse = await exportMyServiceData(authedRequest("/api/service-requests/export", undefined, { method: "GET", session: sessions.requester }), envOf(db));
    const exported = (await exportResponse.json()) as {
      exported_for: string; service_requests: { id: number }[];
      requester_blocks: { blocked_person_id: number }[];
      abuse_reports_filed: { service_request_id: number }[];
      moderation_standing: { standing: string };
    };
    expect(exported.exported_for).toBe("requester-1");
    expect(exported.service_requests.map((row) => row.id)).toEqual([901]);
    expect(exported.requester_blocks).toEqual([]); // requester-2's block is NOT here
    expect(exported.abuse_reports_filed).toHaveLength(1);
    expect(exported.moderation_standing.standing).toBe("normal");

    // The privacy policy decision table is public and documents every field.
    const policyResponse = await servicePrivacyPolicy();
    const policy = (await policyResponse.json()) as {
      policy_version: string;
      decision_table: { field: string; retention: string }[];
      ui_flow: { requester: string[]; provider: string[] };
    };
    expect(policy.policy_version).toBe("r95-n12");
    const fields = policy.decision_table.map((row) => row.field);
    for (const required of ["requester email + display name", "note body (the lead message)", "redaction digest", "blocks (requester-side and provider-side)", "moderation standing", "provider response-time metrics"]) {
      expect(fields).toContain(required);
    }
    expect(policy.decision_table.every((row) => row.retention.length > 10)).toBe(true);
    expect(policy.ui_flow.requester.length).toBeGreaterThanOrEqual(3);
    expect(policy.ui_flow.provider.length).toBeGreaterThanOrEqual(3);
  });
});

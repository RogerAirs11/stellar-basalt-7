import { describe, expect, it } from "vitest";
import {
  MODERATION_REASONS,
  MODERATION_TARGET_TABLES,
  SUPPORT_HOURS_NOTE,
  isModerationReason,
  isModerationTargetTable,
  severityRank,
} from "../../src/moderation/vocabulary";
import { reportCase, moderationQueue, assignCase, decideCase, appealCase, decideAppeal, caseDetail } from "../../src/api/modules/moderation";
import { confirmListingAvailability, createInquiry } from "../../src/api/modules/marketplace";
import { HttpError } from "../../src/api/http";
import { openRealDatabase, seedUser, makeSession, authedRequest } from "../helpers/realDatabase";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * R88 agent plan P16 — moderation, reporting and marketplace trust.
 *
 * Acceptance pinned:
 *  - a reported LISTING is hidden through the suspension overlay; no handler
 *    writes the horses table (python replay pins by snapshot comparison);
 *  - appeal + reversal retain the previous decision trail (append-only events);
 *  - an expired seller mandate blocks NEW inquiries (410) and renewal stays
 *    mandate-guarded;
 *  - no synthetic rating or sold amount enters production metrics (the queue
 *    reports counts, never ratings or GMV);
 *  - honest support hours everywhere (no 24/7 claim).
 */

interface Recorded { sql: string; args: unknown[] }

function makeDb(script: {
  session?: Record<string, unknown> | null;
  target?: Record<string, unknown> | null;
  open?: Record<string, unknown> | null;
  listing?: Record<string, unknown> | null;
  case?: Record<string, unknown> | null;
  appeal?: Record<string, unknown> | null;
  sellerGrants?: Array<Record<string, unknown>>;
  updateChanges?: number;
  insertChanges?: number;
} = {}) {
  const writes: Recorded[] = [];
  const answerFirst = (sql: string): unknown => {
    if (sql.includes("FROM sessions s JOIN users u")) return script.session ?? null;
    if (sql.includes("FROM listing_suspensions WHERE listing_id=?")) return null;
    if (/FROM sales_listings\s+l\s*\n?\s*JOIN horses h/.test(sql)) return script.listing ?? null;
    if (sql.includes("FROM sales_listings l JOIN horses h")) return script.listing ?? null;
    if (sql.includes("FROM sales_listings WHERE id=?")) return script.listing ?? null;
    if (sql.includes("FROM moderation_cases WHERE id=?")) return script.case ?? null;
    if (sql.includes("status NOT LIKE 'resolved%'")) return script.open ?? null;
    if (sql.includes("FROM moderation_appeals WHERE case_id=? AND status='open'")) return script.appeal ?? null;
    if (sql.includes("FROM moderation_appeals WHERE id=?")) return script.appeal ?? null;
    return null;
  };
  const answerAll = (sql: string): { results: unknown[] } => {
    if (sql.includes("FROM horse_access_grants g")) return { results: script.sellerGrants ?? [] };
    if (sql.includes("FROM moderation_cases")) return { results: [] };
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
    first: async () => answerFirst(sql),
    all: async () => answerAll(sql),
    run: async () => { writes.push({ sql, args }); return { meta: { changes: 1 } }; },
  });
  let autoIncrement = 900;
  const db = {
    prepare: (sql: string) => makeBuilder(sql, []),
    batch: async (statements: Array<{ sql: string; args: unknown[] }>) => {
      for (const statement of statements) writes.push({ sql: statement.sql, args: statement.args });
      autoIncrement += 1;
      return statements.map((statement, index) => ({
        results: [], success: true,
        meta: { changes: index === 0 ? (script.insertChanges ?? script.updateChanges ?? 1) : 1, last_row_id: autoIncrement },
      }));
    },
  };
  return Object.assign(db as unknown as D1Database, { __writes: writes });
}

const userSession = {
  session_id: "s-1", csrf_token: "csrf-1", expires_at: new Date(Date.now() + 3600_000).toISOString(),
  last_seen_at: new Date().toISOString(),
  id: "reporter-1", email: "r@example.com", display_name: "Reporter", role: "user", is_active: 1,
};
const adminSession = { ...userSession, id: "admin-1", role: "admin" };

const env = { SESSION_COOKIE_NAME: "hr_session" } as { SESSION_COOKIE_NAME: string };
const ORIGIN = "https://registry.example";
const envOf = (db: D1Database) => ({ DB: db, SESSION_COOKIE_NAME: "hr_session" }) as never;

function request(body: unknown, path: string, method = "POST", session = userSession): Request {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: { "content-type": "application/json", cookie: "hr_session=t", "x-csrf-token": "csrf-1", origin: ORIGIN },
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
}

describe("P16 vocabulary", () => {
  it("keeps the report-reason and target vocabularies closed", () => {
    expect(isModerationReason("fraud_suspected")).toBe(true);
    expect(isModerationReason("advertising")).toBe(false);
    expect(MODERATION_TARGET_TABLES).not.toContain("horses");
    expect(isModerationTargetTable("horses")).toBe(false);
    expect(isModerationTargetTable("sales_listings")).toBe(true);
  });

  it("severity rank orders the queue: urgent > high > medium > low", () => {
    expect(severityRank("urgent")).toBeGreaterThan(severityRank("high"));
    expect(severityRank("high")).toBeGreaterThan(severityRank("medium"));
    expect(severityRank("medium")).toBeGreaterThan(severityRank("low"));
  });

  it("states honest support hours — no 24/7 claim", () => {
    expect(SUPPORT_HOURS_NOTE).toContain("staffed hours");
    expect(SUPPORT_HOURS_NOTE).toContain("does not advertise 24/7");
    expect(MODERATION_REASONS).toContain("animal_welfare");
  });
});

describe("P16 report + queue (real database)", () => {
  async function world(db: D1Database) {
    await seedUser(db, "reporter-1", "user");
    await seedUser(db, "seller-1", "user");
    await seedUser(db, "op-admin", "admin");
    await db.exec(`
      INSERT INTO horses(id,name_latin,is_active) VALUES (9,'STAR',1);
      INSERT INTO sales_listings(id,horse_id,seller_user_id,seller_contact_name,status)
      VALUES ('listing-1',9,'seller-1','Seller One','active');
    `);
    return {
      reporter: await makeSession(db, "reporter-1"),
      seller: await makeSession(db, "seller-1"),
      admin: await makeSession(db, "op-admin"),
    };
  }

  it("creates a case with an append-only created event; duplicate open case = 409", async () => {
    const db = await openRealDatabase();
    const { reporter } = await world(db);
    const response = await reportCase(authedRequest("/api/moderation/reports", { target_table: "sales_listings", target_id: "listing-1", reason: "fraud_suspected", details: "Suspicious price" }, { session: reporter }), envOf(db));
    expect(response.status).toBe(201);
    const created = await db.prepare("SELECT id FROM moderation_cases").first<{ id: number }>();
    expect(Number(created?.id)).toBeGreaterThan(0);
    const events = await db.prepare("SELECT event_type FROM moderation_case_events ORDER BY id").all<{ event_type: string }>();
    expect(events.results.map((e) => e.event_type)).toContain("created");

    await expect(reportCase(authedRequest("/api/moderation/reports", { target_table: "sales_listings", target_id: "listing-1", reason: "spam" }, { session: reporter }), envOf(db)))
      .rejects.toMatchObject({ status: 409 });
    expect(Number((await db.prepare("SELECT COUNT(*) AS n FROM moderation_cases").first<{ n: number }>())?.n)).toBe(1);
  });

  it("refuses unknown reasons and horse-record targets outright", async () => {
    const db = await openRealDatabase();
    const { reporter } = await world(db);
    await expect(reportCase(authedRequest("/api/moderation/reports", { target_table: "sales_listings", target_id: "x", reason: "made_up_reason" }, { session: reporter }), envOf(db)))
      .rejects.toMatchObject({ status: 400 });
    await expect(reportCase(authedRequest("/api/moderation/reports", { target_table: "horses", target_id: "9", reason: "spam" }, { session: reporter }), envOf(db)))
      .rejects.toMatchObject({ status: 400 });
    expect(Number((await db.prepare("SELECT COUNT(*) AS n FROM moderation_cases").first<{ n: number }>())?.n)).toBe(0);
  });

  it("the queue is severity-ordered with honest counts and the support-hours note", async () => {
    const db = await openRealDatabase();
    const { admin } = await world(db);
    const response = await moderationQueue(authedRequest("/api/admin/moderation/queue", undefined, { method: "GET", session: admin }), envOf(db));
    const body = await response.json() as { queue: unknown[]; support_hours_note: string; ordering: string };
    expect(body.queue).toEqual([]);
    expect(body.support_hours_note).toBe(SUPPORT_HOURS_NOTE);
    expect(body.ordering).toContain("severity");
    expect(JSON.stringify(body)).not.toContain("rating");
    expect(JSON.stringify(body)).not.toContain("gmv");
  });
});

describe("P16 decisions, appeals and reversals (real database)", () => {
  async function decisionWorld(db: D1Database) {
    await seedUser(db, "reporter-1", "user");
    await seedUser(db, "seller-1", "user");
    await seedUser(db, "op-admin", "admin");
    await db.exec(`
      INSERT INTO horses(id,name_latin,is_active) VALUES (9,'STAR',1);
      INSERT INTO sales_listings(id,horse_id,seller_user_id,seller_contact_name,status)
      VALUES ('listing-1',9,'seller-1','Seller One','active');
      INSERT INTO moderation_cases(id,target_table,target_id,reporter_user_id,reason,details,status)
      VALUES (5,'sales_listings','listing-1','reporter-1','fraud_suspected','Suspicious price','triaged');
      INSERT INTO moderation_case_events(case_id,actor_user_id,event_type,event_json)
      VALUES (5,'reporter-1','created','{}');
    `);
    return {
      reporter: await makeSession(db, "reporter-1"),
      seller: await makeSession(db, "seller-1"),
      admin: await makeSession(db, "op-admin"),
    };
  }

  it("hide suspends the LISTING via the overlay — no horses write anywhere", async () => {
    const db = await openRealDatabase();
    const { admin } = await decisionWorld(db);
    const horsesBefore = await db.prepare("SELECT COUNT(*) AS n, MAX(updated_at) AS u FROM horses").first<{ n: number; u: string }>();
    const response = await decideCase(authedRequest("/api/admin/moderation/cases/5/decision", { decision: "hide", note: "Counterfeit documents in the listing description." }, { session: admin }), envOf(db), 5);
    const body = await response.json() as { decided: boolean; status: string };
    expect(body.decided).toBe(true);
    expect(body.status).toBe("resolved_hidden");
    const suspension = await db.prepare("SELECT listing_id, reinstated_at FROM listing_suspensions").first<{ listing_id: string; reinstated_at: string | null }>();
    expect(suspension?.listing_id).toBe("listing-1");
    expect(suspension?.reinstated_at).toBeNull();
    // The horse record was not touched by moderation.
    const horsesAfter = await db.prepare("SELECT COUNT(*) AS n, MAX(updated_at) AS u FROM horses").first<{ n: number; u: string }>();
    expect(horsesAfter?.u).toBe(horsesBefore?.u);
    const decision = await db.prepare("SELECT event_type FROM moderation_case_events WHERE event_type='decision'").all<{ event_type: string }>();
    expect(decision.results).toHaveLength(1);
  });

  it("direct reinstate is refused — reinstatement requires an appeal against the hiding decision (R95)", async () => {
    const db = await openRealDatabase();
    const { admin } = await decisionWorld(db);
    await db.exec(`
      INSERT INTO moderation_cases(id,target_table,target_id,reporter_user_id,reason,details,status)
      VALUES (6,'sales_listings','listing-1','seller-1','misrepresentation','Second report still open','triaged');
    `);
    await decideCase(authedRequest("/api/admin/moderation/cases/5/decision", { decision: "hide", note: "Counterfeit documents in the listing description." }, { session: admin }), envOf(db), 5);
    // The resolved case first refuses ANY new direct decision...
    await expect(decideCase(authedRequest("/api/admin/moderation/cases/5/decision", { decision: "reinstate", note: "Seller provided authentic documents on review." }, { session: admin }), envOf(db), 5))
      .rejects.toMatchObject({ status: 409, code: "already_resolved" });
    // ...and even an OPEN case refuses direct reinstatement: only an appeal
    // against the specific hiding decision can reinstate.
    await expect(decideCase(authedRequest("/api/admin/moderation/cases/6/decision", { decision: "reinstate", note: "Seller provided authentic documents on review." }, { session: admin }), envOf(db), 6))
      .rejects.toMatchObject({ status: 409, code: "appeal_required" });
    // The suspension survives: no back-door reinstatement.
    expect(Number((await db.prepare("SELECT COUNT(*) AS n FROM listing_suspensions WHERE reinstated_at IS NULL").first<{ n: number }>())?.n)).toBe(1);
  });

  it("assign moves new->triaged and writes an assigned event", async () => {
    const db = await openRealDatabase();
    const { admin } = await decisionWorld(db);
    const response = await assignCase(authedRequest("/api/admin/moderation/cases/5/assign", { operator_user_id: "op-admin", severity: "high" }, { session: admin }), envOf(db), 5);
    const body = await response.json() as { assigned: boolean };
    expect(body.assigned).toBe(true);
    const events = await db.prepare("SELECT event_type FROM moderation_case_events ORDER BY id").all<{ event_type: string }>();
    expect(events.results.map((e) => e.event_type)).toContain("assigned");
    expect((await db.prepare("SELECT status FROM moderation_cases WHERE id=5").first<{ status: string }>())?.status).toBe("triaged");
  });

  it("only the listing's SELLER can appeal a hidden outcome", async () => {
    const db = await openRealDatabase();
    const { seller } = await decisionWorld(db);
    await decideCase(authedRequest("/api/admin/moderation/cases/5/decision", { decision: "hide", note: "Counterfeit documents in the listing description." }, { session: await makeSession(db, "op-admin") }), envOf(db), 5);
    const response = await appealCase(authedRequest("/api/moderation/cases/5/appeal", { statement: "The documents are authentic and attached to the registry record." }, { session: seller }), envOf(db), 5);
    expect(response.status).toBe(201);
    // A second open appeal on the same case is refused.
    await expect(appealCase(authedRequest("/api/moderation/cases/5/appeal", { statement: "Another statement that is long enough to be valid." }, { session: seller }), envOf(db), 5))
      .rejects.toMatchObject({ status: 409, code: "appeal_exists" });
  });

  it("an overturned appeal reinstates the listing; the hide event survives forever", async () => {
    const db = await openRealDatabase();
    const { seller, admin } = await decisionWorld(db);
    await decideCase(authedRequest("/api/admin/moderation/cases/5/decision", { decision: "hide", note: "Counterfeit documents in the listing description." }, { session: admin }), envOf(db), 5);
    const appeal = await appealCase(authedRequest("/api/moderation/cases/5/appeal", { statement: "The documents are authentic and attached to the registry record." }, { session: seller }), envOf(db), 5);
    const appealId = (await appeal.json() as { appeal_id: number }).appeal_id;
    const response = await decideAppeal(authedRequest(`/api/admin/moderation/appeals/${appealId}/decision`, { outcome: "overturned", note: "Documents verified against the registry evidence." }, { session: admin }), envOf(db), appealId);
    const body = await response.json() as { outcome: string };
    expect(body.outcome).toBe("overturned");
    expect((await db.prepare("SELECT status FROM moderation_cases WHERE id=5").first<{ status: string }>())?.status).toBe("resolved_reinstated");
    expect((await db.prepare("SELECT reinstated_at FROM listing_suspensions").first<{ reinstated_at: string | null }>())?.reinstated_at).not.toBeNull();
    // The full trail survives: created + decision + appeal + reversal.
    const events = await db.prepare("SELECT event_type FROM moderation_case_events ORDER BY id").all<{ event_type: string }>();
    expect(events.results.map((e) => e.event_type)).toEqual(["created", "decision", "appeal", "reversal"]);
  });

  it("an overturned appeal reinstates ONLY its own case's suspension — an independent suspension survives (R95)", async () => {
    const db = await openRealDatabase();
    const { seller, admin } = await decisionWorld(db);
    // A SECOND reporter opens another case against the same listing.
    await db.exec(`
      INSERT INTO moderation_cases(id,target_table,target_id,reporter_user_id,reason,details,status)
      VALUES (6,'sales_listings','listing-1','seller-1','misrepresentation','Second independent report','triaged');
    `);
    await decideCase(authedRequest("/api/admin/moderation/cases/5/decision", { decision: "hide", note: "First case: counterfeit documents." }, { session: admin }), envOf(db), 5);
    await decideCase(authedRequest("/api/admin/moderation/cases/6/decision", { decision: "hide", note: "Second case: misrepresentation." }, { session: admin }), envOf(db), 6);
    expect(Number((await db.prepare("SELECT COUNT(*) AS n FROM listing_suspensions WHERE reinstated_at IS NULL").first<{ n: number }>())?.n)).toBe(2);

    const appeal = await appealCase(authedRequest("/api/moderation/cases/5/appeal", { statement: "The documents are authentic and attached to the registry record." }, { session: seller }), envOf(db), 5);
    const appealId = (await appeal.json() as { appeal_id: number }).appeal_id;
    await decideAppeal(authedRequest(`/api/admin/moderation/appeals/${appealId}/decision`, { outcome: "overturned", note: "Documents verified against the registry evidence." }, { session: admin }), envOf(db), appealId);

    const suspensions = await db.prepare("SELECT case_id, reinstated_at FROM listing_suspensions ORDER BY case_id").all<{ case_id: number; reinstated_at: string | null }>();
    // Case 5's suspension is reversed; case 6's INDEPENDENT suspension stands.
    expect(suspensions.results.find((r) => Number(r.case_id) === 5)?.reinstated_at).not.toBeNull();
    expect(suspensions.results.find((r) => Number(r.case_id) === 6)?.reinstated_at).toBeNull();
    expect((await db.prepare("SELECT status FROM moderation_cases WHERE id=6").first<{ status: string }>())?.status).toBe("resolved_hidden");
  });

  it("case detail: staff get the full trail + every active reason; participants get a minimal summary with no internal material", async () => {
    const db = await openRealDatabase();
    const { reporter, seller, admin } = await decisionWorld(db);
    // Hide the listing so there is an active suspension to explain.
    await decideCase(authedRequest("/api/admin/moderation/cases/5/decision", { decision: "hide", note: "Counterfeit documents in the listing description." }, { session: admin }), envOf(db), 5);

    // REPORTER view: a minimal summary. No events array, no appeals array,
    // no staff trail note, no suspension detail (not the reported party).
    const asReporter = await caseDetail(authedRequest("/api/moderation/cases/5", undefined, { method: "GET", session: reporter }), envOf(db), 5);
    const reporterBody = await asReporter.json() as Record<string, unknown>;
    expect(String(reporterBody.note)).toContain("summary view");
    expect(reporterBody.events).toBeUndefined();
    expect(reporterBody.appeals).toBeUndefined();
    expect(reporterBody.trail_note).toBeUndefined();
    expect(reporterBody.active_suspensions).toEqual([]);
    expect(reporterBody.your_appeals).toEqual([]);

    // REPORTED PARTY (seller) view: their listing's active suspension reasons,
    // their own appeals — and never the reporter's identity or staff notes.
    const asSeller = await caseDetail(authedRequest("/api/moderation/cases/5", undefined, { method: "GET", session: seller }), envOf(db), 5);
    const sellerBody = JSON.stringify(await asSeller.json());
    expect(sellerBody).not.toContain("reporter-1");
    const sellerJson = JSON.parse(sellerBody) as { active_suspensions: Array<{ reason: string }>; your_appeals: unknown[] };
    expect(sellerJson.active_suspensions).toHaveLength(1);
    expect(sellerJson.active_suspensions[0]!.reason).toContain("Counterfeit documents");
    expect(sellerJson.your_appeals).toEqual([]);

    // STAFF view: the full append-only trail, every active suspension reason
    // for the target, and the affected account's current standing.
    const asAdmin = await caseDetail(authedRequest("/api/moderation/cases/5", undefined, { method: "GET", session: admin }), envOf(db), 5);
    const adminBody = await asAdmin.json() as { events: unknown[]; appeals: unknown[]; active_suspensions: unknown[]; affected_account: string; affected_standing: { standing: string }; trail_note: string };
    expect(adminBody.trail_note).toContain("append-only");
    expect(adminBody.events).toHaveLength(2); // created (fixture) + the decision
    expect(adminBody.appeals).toHaveLength(0);
    expect(adminBody.active_suspensions).toHaveLength(1);
    expect(adminBody.affected_account).toBe("seller-1");
    expect(adminBody.affected_standing.standing).toBe("normal");
  });
});

describe("P16 seller authority + availability", () => {
  it("an EXPIRED seller mandate blocks NEW inquiries with 410", async () => {
    const db = makeDb({
      session: null,
      listing: { id: "listing-1", seller_user_id: "seller-1", horse_id: 9 },
      sellerGrants: [], // seller's mandate expired — no active grants
    });
    await expect(createInquiry(request({ buyer_name: "Buyer", buyer_contact: "b@x.co", message: "Still available?" }, "/api/market/listings/listing-1/inquiries"), { ...env, DB: db }, "listing-1"))
      .rejects.toMatchObject({ status: 410, code: "seller_authority_expired" });
  });

  it("a CURRENT seller mandate lets the inquiry through", async () => {
    const db = makeDb({
      session: null,
      listing: { id: "listing-1", seller_user_id: "seller-1", horse_id: 9 },
      sellerGrants: [{ id: "g1", horse_id: 9, grantee_user_id: "seller-1", grantee_organization_id: null, relationship: "owner", actions: "manage_profile,upload_media,create_listing,manage_inquiries", basis: "test", basis_ref: null, valid_from: "2026-01-01 00:00:00", valid_until: null, revoked_at: null }],
    });
    // The command layer runs; the mock just needs to not throw on the guard.
    const outcome = await createInquiry(request({ buyer_name: "Buyer", buyer_contact: "b@x.co", message: "Still available?" }, "/api/market/listings/listing-1/inquiries"), { ...env, DB: db }, "listing-1").catch((cause: { code?: string }) => cause);
    expect((outcome as { code?: string }).code).not.toBe("seller_authority_expired");
  });

  it("availability confirmation requires the CURRENT mandate (expired = 403 from the guard)", async () => {
    const db = makeDb({ session: { ...userSession, id: "seller-1" }, listing: { id: "listing-1", horse_id: 9, seller_user_id: "seller-1", status: "active" }, sellerGrants: [] });
    await expect(confirmListingAvailability(request({}, "/api/market/listings/listing-1/confirm-availability", "POST", { ...userSession, id: "seller-1" }), { ...env, DB: db }, "listing-1"))
      .rejects.toThrow(HttpError);
    const goodDb = makeDb({
      session: { ...userSession, id: "seller-1" },
      listing: { id: "listing-1", horse_id: 9, seller_user_id: "seller-1", status: "active" },
      sellerGrants: [{ id: "g1", horse_id: 9, grantee_user_id: "seller-1", grantee_organization_id: null, relationship: "owner", actions: "create_listing", basis: "test", basis_ref: null, valid_from: "2026-01-01 00:00:00", valid_until: null, revoked_at: null }],
    });
    const response = await confirmListingAvailability(request({}, "/api/market/listings/listing-1/confirm-availability", "POST", { ...userSession, id: "seller-1" }), { ...env, DB: goodDb }, "listing-1");
    const body = await response.json() as { confirmed: boolean };
    expect(body.confirmed).toBe(true);
    expect(goodDb.__writes.some((w) => w.sql.includes("SET availability_confirmed_at=CURRENT_TIMESTAMP"))).toBe(true);
  });
});

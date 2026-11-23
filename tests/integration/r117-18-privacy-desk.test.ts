import { describe, expect, it } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import {
  adminDecideRedactionRequest, adminFulfillRedactionRequest, adminRedactionRequestQueue,
  fileSubjectRedactionRequest,
} from "../../src/api/modules/serviceRequests";
import { authedRequest, makeSession, openRealDatabase, seedUser } from "../helpers/realDatabase";

/**
 * R117-18 evidence (Master AI R117 handoff D43) — the native privacy
 * redaction OPERATOR surface on a REAL database with every migration
 * applied. The R114 executor itself stays pinned by
 * privacyFulfillmentR114.test.ts; THIS suite pins the contracts the native
 * five-skin operator UI consumes (per the reviewed ticket's actions 2-3):
 *
 *  1. The QUEUE read carries everything the UI renders per row: subject
 *     name, category, both decision and SEPARATE execution state, the
 *     active-hold flag and the receipt-driven fulfillment indicator — and
 *     re-reading the queue after any command reproduces the server state
 *     (refresh equivalence, the receipt never the grant drives completed).
 *  2. A GRANT response never claims execution; the queue keeps showing
 *     "granted — not executed" until the separate executor receipt lands.
 *  3. Honest refusals keep their codes: grant_blocked_by_hold,
 *     redaction_scope_unresolved, not_granted, already_fulfilled.
 *  4. The queue read is admin-role gated — the native UI's forbidden state
 *     for non-admin staff is the honest boundary, not a missing queue.
 */

const env = (db: D1Database) => ({ DB: db, SESSION_COOKIE_NAME: "hr_session" }) as never;

async function world() {
  const db = await openRealDatabase();
  for (const [id, role] of [["r18-subject", "user"], ["r18-stranger", "user"], ["r18-admin", "admin"]]) {
    await seedUser(db, id!, role!);
  }
  await db.exec(`
    INSERT INTO people(id,name_latin) VALUES(1,'Fictional R117-18 provider');
    INSERT INTO service_requests(id,requester_user_id,provider_person_id,category,note,share_contact,status,province_code,city)
    VALUES(1,'r18-subject',1,'trainer','Private subject note for the R117-18 operator desk',1,'new','IR-23','Subject city'),
          (2,'r18-subject',1,'trainer','Second private row stays untouched',0,'new','IR-23','Other city');
  `);
  const subject = await makeSession(db, "r18-subject");
  const stranger = await makeSession(db, "r18-stranger");
  const admin = await makeSession(db, "r18-admin");
  return { db, subject, stranger, admin };
}
type World = Awaited<ReturnType<typeof world>>;

async function file(w: World, category: "service_request_notes" | "service_request_contact_location", serviceRequestId: number | null = 1) {
  const response = await fileSubjectRedactionRequest(authedRequest("/api/privacy/redaction-requests", {
    data_category: category, service_request_id: serviceRequestId,
    request_note: `Please minimize the ${category} on this request.`,
  }, { session: w.subject }), env(w.db));
  expect(response.status).toBe(201);
  return Number((await response.json() as { request_id: number }).request_id);
}

async function decide(w: World, id: number, decision: "grant" | "refuse", db = w.db) {
  const response = await adminDecideRedactionRequest(authedRequest(`/api/admin/privacy/redaction-requests/${id}/decide`, {
    decision, decision_note: "The operator verified the exact subject scope before deciding.",
  }, { session: w.admin }), env(db), id);
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function fulfill(w: World, id: number, db = w.db) {
  const response = await adminFulfillRedactionRequest(authedRequest(`/api/admin/privacy/redaction-requests/${id}/fulfill`, {
    execution_note: "Executed against the approved scope after verification.",
  }, { session: w.admin }), env(db), id);
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function queueRow(w: World, id: number) {
  const response = await adminRedactionRequestQueue(authedRequest("/api/admin/privacy/redaction-requests", undefined, { session: w.admin }), env(w.db));
  expect(response.status).toBe(200);
  const body = await response.json() as { requests: Array<Record<string, unknown>>; counts: Record<string, number> };
  const row = body.requests.find(request => Number(request.id) === id);
  expect(row).toBeDefined();
  return { row: row!, counts: body.counts };
}

describe("R117-18 1. the queue contract the native operator UI renders", () => {
  it("carries subject name, both states, the hold flag and the receipt-driven indicator per row", async () => {
    const w = await world();
    const id = await file(w, "service_request_notes");
    const { row, counts } = await queueRow(w, id);
    expect(row).toMatchObject({
      subject_user_id: "r18-subject", subject_name: expect.any(String),
      service_request_id: 1, data_category: "service_request_notes",
      status: "received", execution_status: null, request_under_active_hold: false,
      redaction_completed: false, fulfillment_status: "not_executed",
      request_note: expect.stringContaining("minimize"),
    });
    expect(counts).toMatchObject({ received: expect.any(Number), executed: expect.any(Number) });
  });

  it("re-reading the queue after completion reproduces the receipt-driven state (refresh equivalence)", async () => {
    const w = await world();
    const id = await file(w, "service_request_notes");
    await decide(w, id, "grant");
    await fulfill(w, id);
    const { row } = await queueRow(w, id);
    expect(row).toMatchObject({ status: "granted", execution_status: "completed", redaction_completed: true, fulfillment_status: "completed" });
    // The stored receipt is IN the queue row — the UI's receipt viewer is
    // data-backed (category, the minimized fields and the preserved digest).
    const receipt = JSON.parse(String(row.execution_receipt_json)) as Record<string, unknown>;
    expect(receipt).toMatchObject({
      category: "service_request_notes", already_minimized: false,
      fields: ["note", "note_digest", "note_digest_status", "note_redacted_at"],
      note_digest_status: "original_sha256", note_digest: expect.any(String),
    });
    expect(row.executed_at).toEqual(expect.any(String));
  });
});

describe("R117-18 2. a grant never claims execution", () => {
  it("the grant response and the queue both stay not_executed until the separate executor runs", async () => {
    const w = await world();
    const id = await file(w, "service_request_notes");
    const granted = await decide(w, id, "grant");
    expect(granted.status).toBe(200);
    expect(granted.body).toMatchObject({ decided: true, decision: "grant", redaction_completed: false, fulfillment_status: "not_executed" });
    expect(String(granted.body.note)).toContain("separate");
    const { row } = await queueRow(w, id);
    expect(row).toMatchObject({ status: "granted", execution_status: null, redaction_completed: false, fulfillment_status: "not_executed" });
    const done = await fulfill(w, id);
    expect(done.status).toBe(201);
    expect(done.body).toMatchObject({ fulfilled: true, redaction_completed: true, fulfillment_status: "completed" });
  });

  it("a refused request reports not_applicable and fulfillment refuses not_granted", async () => {
    const w = await world();
    const id = await file(w, "service_request_notes");
    const refused = await decide(w, id, "refuse");
    expect(refused.body).toMatchObject({ decided: true, decision: "refuse", redaction_completed: false, fulfillment_status: "not_applicable" });
    const { row } = await queueRow(w, id);
    expect(row).toMatchObject({ status: "refused", execution_status: null, redaction_completed: false, fulfillment_status: "not_applicable" });
    await expect(fulfill(w, id)).rejects.toMatchObject({ status: 409, code: "not_granted" });
  });
});

describe("R117-18 3. honest refusals keep their server codes", () => {
  it("a grant under an ACTIVE hold refuses grant_blocked_by_hold and the queue shows the hold flag", async () => {
    const w = await world();
    const { placeServiceRequestHoldStatements } = await import("../../src/services/privacy");
    await w.db.batch(placeServiceRequestHoldStatements(w.db, {
      requestId: 1, operatorUserId: "r18-admin", holdKind: "dispute",
      reason: "Preservation hold for the R117-18 operator desk journey.",
    }) as never);
    const id = await file(w, "service_request_notes");
    const { row } = await queueRow(w, id);
    expect(row.request_under_active_hold).toBe(true);
    await expect(decide(w, id, "grant")).rejects.toMatchObject({ status: 409, code: "grant_blocked_by_hold" });
  });

  it("an untargeted request refuses redaction_scope_unresolved on grant", async () => {
    const w = await world();
    const id = await file(w, "service_request_notes", null);
    await expect(decide(w, id, "grant")).rejects.toMatchObject({ status: 409, code: "redaction_scope_unresolved" });
    const { row } = await queueRow(w, id);
    expect(row).toMatchObject({ service_request_id: null, status: "received", redaction_completed: false });
  });

  it("a repeat fulfillment returns the stored receipt (already_fulfilled) with no second completion", async () => {
    const w = await world();
    const id = await file(w, "service_request_notes");
    await decide(w, id, "grant");
    const first = await fulfill(w, id);
    const receipt = first.body.execution_receipt as Record<string, unknown>;
    const repeat = await fulfill(w, id);
    expect(repeat.status).toBe(200);
    expect(repeat.body).toMatchObject({ fulfilled: true, already_fulfilled: true, redaction_completed: true, fulfillment_status: "completed" });
    const stored = repeat.body.execution_receipt as Record<string, unknown>;
    expect(stored.execution_receipt_operation_id).toBe(receipt.execution_receipt_operation_id);
    const audits = await w.db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='privacy.subject_redaction_fulfilled'").first<{ n: number }>();
    expect(audits?.n ?? 0).toBe(1);
  });
});

describe("R117-18 4. the queue read is admin-role gated (the honest forbidden state)", () => {
  it("a signed-in non-admin user is refused 403 — never an empty queue", async () => {
    const w = await world();
    await expect(adminRedactionRequestQueue(authedRequest("/api/admin/privacy/redaction-requests", undefined, { session: w.stranger }), env(w.db)))
      .rejects.toMatchObject({ status: 403 });
    await expect(adminDecideRedactionRequest(authedRequest("/api/admin/privacy/redaction-requests/1/decide", {
      decision: "grant", decision_note: "Unauthorized attempt that must refuse.",
    }, { session: w.stranger }), env(w.db), 1)).rejects.toMatchObject({ status: 403 });
    await expect(adminFulfillRedactionRequest(authedRequest("/api/admin/privacy/redaction-requests/1/fulfill", {}, { session: w.stranger }), env(w.db), 1))
      .rejects.toMatchObject({ status: 403 });
  });
});

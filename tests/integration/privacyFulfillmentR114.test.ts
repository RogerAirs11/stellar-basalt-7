import { describe, expect, it } from "vitest";
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import {
  adminDecideRedactionRequest, adminFulfillRedactionRequest, adminRedactionRequestQueue,
  fileSubjectRedactionRequest,
} from "../../src/api/modules/serviceRequests";
import { authedRequest, countRows, makeSession, openRealDatabase, seedUser } from "../helpers/realDatabase";

async function sha256(text: string): Promise<string> {
  const bits = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, "0")).join("");
}

const env = (db: D1Database) => ({ DB: db, SESSION_COOKIE_NAME: "hr_session" }) as never;

async function world() {
  const db = await openRealDatabase();
  for (const [id, role] of [["subject", "user"], ["other", "user"], ["admin-a", "admin"], ["admin-b", "admin"]]) {
    await seedUser(db, id!, role!);
  }
  await db.exec(`
    INSERT INTO people(id,name_latin) VALUES(1,'Fictional R114 provider');
    INSERT INTO service_requests(id,requester_user_id,provider_person_id,category,note,share_contact,status,province_code,city)
    VALUES(1,'subject',1,'trainer','Private subject evidence for the fulfillment executor',1,'new','IR-23','Subject city'),
          (2,'subject',1,'trainer','Second private evidence row kept untouched',0,'new','IR-23','Other city'),
          (3,'other',1,'trainer','Unrelated subject evidence',1,'new','IR-23','Third city');
  `);
  const subject = await makeSession(db, "subject");
  const admin = await makeSession(db, "admin-a");
  const adminB = await makeSession(db, "admin-b");
  return { db, subject, admin, adminB };
}
type World = Awaited<ReturnType<typeof world>>;

function interposeBatch(db: D1Database, before?: () => Promise<unknown>): D1Database {
  let first = true;
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === "batch") return async (statements: D1PreparedStatement[]) => {
        const interpose = first;
        first = false;
        if (interpose) await before?.();
        return db.batch(statements);
      };
      return Reflect.get(target, prop, receiver);
    },
  });
}

async function fileNotes(w: World, serviceId = 1, db = w.db) {
  const response = await fileSubjectRedactionRequest(authedRequest("/api/privacy/redaction-requests", {
    data_category: "service_request_notes", service_request_id: serviceId,
    request_note: "Please minimize the note on this specific request.",
  }, { session: w.subject }), env(db));
  const body = await response.json() as Record<string, unknown>;
  if (response.status !== 201) throw new Error(`fileNotes failed (${response.status}): ${JSON.stringify(body)}`);
  return { status: response.status, body };
}
async function fileContact(w: World, serviceId = 1, db = w.db) {
  const response = await fileSubjectRedactionRequest(authedRequest("/api/privacy/redaction-requests", {
    data_category: "service_request_contact_location", service_request_id: serviceId,
    request_note: "Please withdraw contact sharing and drop location on this request.",
  }, { session: w.subject }), env(db));
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}
async function grant(w: World, id: number, db = w.db) {
  const response = await adminDecideRedactionRequest(authedRequest(`/api/admin/privacy/redaction-requests/${id}/decide`, {
    decision: "grant", decision_note: "The operator verified the exact subject scope before approving.",
  }, { session: w.admin }), env(db), id);
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}
async function fulfill(w: World, id: number, db = w.db, note = "Executed against the approved scope after verification.") {
  const response = await adminFulfillRedactionRequest(authedRequest(`/api/admin/privacy/redaction-requests/${id}/fulfill`, {
    execution_note: note,
  }, { session: w.admin }), env(db), id);
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}
async function audits(db: D1Database, action: string) {
  return Number(await db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action=?").bind(action).first<{ n: number }>().then(r => r?.n ?? 0));
}
async function hold(w: World, serviceId = 1) {
  const { placeServiceRequestHoldStatements } = await import("../../src/services/privacy");
  await w.db.batch(placeServiceRequestHoldStatements(w.db, {
    requestId: serviceId, operatorUserId: "admin-b", holdKind: "dispute",
    reason: "Preservation hold placed for the R114 race window.",
  }) as never);
}

describe("R114-01 — the subject-request fulfillment executor (decision != execution)", () => {
  it("fulfills a granted notes request: fields actually minimized, one receipt, one audit", async () => {
    const w = await world();
    const filed = await fileNotes(w);
    const granted = await grant(w, Number(filed.body.request_id));
    expect(granted.body).toMatchObject({ redaction_completed: false, fulfillment_status: "not_executed" });
    const done = await fulfill(w, Number(filed.body.request_id));
    expect(done.status).toBe(201);
    expect(done.body).toMatchObject({
      fulfilled: true, already_minimized: false, redaction_completed: true, fulfillment_status: "completed",
    });
    const receipt = done.body.execution_receipt as Record<string, unknown>;
    expect(receipt.execution_status).toBe("completed");
    expect(receipt.execution_receipt_operation_id).toEqual(expect.any(String));
    const row = await w.db.prepare("SELECT note,note_digest,note_digest_status,note_redacted_at,row_version FROM service_requests WHERE id=1")
      .first<{ note: string; note_digest: string | null; note_digest_status: string | null; note_redacted_at: string | null; row_version: number }>();
    expect(row!.note).toBe("[redaction: note minimized]");
    expect(row!.note_digest).toBe(await sha256("Private subject evidence for the fulfillment executor"));
    expect(row!.note_digest_status).toBe("original_sha256");
    expect(row!.note_redacted_at).toEqual(expect.any(String));
    expect(await audits(w.db, "privacy.subject_redaction_fulfilled")).toBe(1);
    expect(await countRows(w.db, "audit_events", "action='privacy.subject_redaction_fulfilled'")).toBe(1);
    const request = await w.db.prepare("SELECT status,execution_status,executed_at,execution_receipt_json FROM subject_redaction_requests WHERE id=?")
      .bind(Number(filed.body.request_id)).first<{ status: string; execution_status: string; executed_at: string; execution_receipt_json: string }>();
    expect(request!.status).toBe("granted");
    expect(request!.execution_status).toBe("completed");
    expect(JSON.parse(request!.execution_receipt_json!)).toMatchObject({ category: "service_request_notes", already_minimized: false });
  });

  it("fulfills a granted contact/location request: sharing withdrawn and location dropped", async () => {
    const w = await world();
    const filed = await fileContact(w);
    await grant(w, Number(filed.body.request_id));
    const done = await fulfill(w, Number(filed.body.request_id));
    expect(done.status).toBe(201);
    expect(done.body).toMatchObject({ fulfilled: true, category: "service_request_contact_location", already_minimized: false });
    const row = await w.db.prepare("SELECT share_contact,province_code,city,consent_updated_at FROM service_requests WHERE id=1")
      .first<{ share_contact: number; province_code: string | null; city: string | null; consent_updated_at: string | null }>();
    expect(row!.share_contact).toBe(0);
    expect(row!.province_code).toBeNull();
    expect(row!.city).toBeNull();
    expect(row!.consent_updated_at).toEqual(expect.any(String));
    expect(await audits(w.db, "privacy.subject_redaction_fulfilled")).toBe(1);
  });

  it("a retry after completion returns the stored receipt and claims no second completion", async () => {
    const w = await world();
    const filed = await fileNotes(w);
    await grant(w, Number(filed.body.request_id));
    const first = await fulfill(w, Number(filed.body.request_id));
    const second = await fulfill(w, Number(filed.body.request_id));
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ fulfilled: true, already_fulfilled: true, redaction_completed: true, fulfillment_status: "completed" });
    const firstReceipt = first.body.execution_receipt as Record<string, unknown>;
    const secondReceipt = second.body.execution_receipt as Record<string, unknown>;
    expect(secondReceipt.execution_receipt_operation_id).toBe(firstReceipt.execution_receipt_operation_id);
    expect(await audits(w.db, "privacy.subject_redaction_fulfilled")).toBe(1);
    const auditRows = await countRows(w.db, "audit_events", "action='privacy.subject_redaction_fulfilled'");
    expect(auditRows).toBe(1);
  });

  it("an active hold placed after the grant blocks execution: no data change, no success audit, no completion write", async () => {
    const w = await world();
    const filed = await fileNotes(w);
    await grant(w, Number(filed.body.request_id));
    await hold(w);
    await expect(fulfill(w, Number(filed.body.request_id), w.db, "Blocked attempt that must leave everything unchanged.")).rejects.toMatchObject({ status: 409, code: "execution_blocked_by_hold" });
    const row = await w.db.prepare("SELECT note,note_redacted_at FROM service_requests WHERE id=1").first<{ note: string; note_redacted_at: string | null }>();
    expect(row!.note).toBe("Private subject evidence for the fulfillment executor");
    expect(row!.note_redacted_at).toBeNull();
    expect(await audits(w.db, "privacy.subject_redaction_fulfilled")).toBe(0);
    const request = await w.db.prepare("SELECT execution_status FROM subject_redaction_requests WHERE id=?")
      .bind(Number(filed.body.request_id)).first<{ execution_status: string | null }>();
    expect(request!.execution_status).toBeNull();
    // The queue still shows the grant AND the blocked state honestly.
    const queue = await (await adminRedactionRequestQueue(authedRequest("/api/admin/privacy/redaction-requests", undefined, { session: w.admin }), env(w.db))).json() as Record<string, any>;
    const queued = queue.requests.find((r: any) => Number(r.id) === Number(filed.body.request_id));
    expect(queued).toMatchObject({ redaction_completed: false, fulfillment_status: "blocked_active_hold" });
  });

  it("a demoted admin after preflight writes nothing", async () => {
    const w = await world();
    const filed = await fileNotes(w);
    await grant(w, Number(filed.body.request_id));
    const raced = interposeBatch(w.db, () => w.db.prepare("UPDATE users SET is_active=0 WHERE id='admin-a'").run());
    await expect(fulfill(w, Number(filed.body.request_id), raced, "Attempt that must be refused after demotion.")).rejects.toMatchObject({ status: 409, code: "execution_conflict" });
    const row = await w.db.prepare("SELECT note,note_redacted_at FROM service_requests WHERE id=1").first<{ note: string; note_redacted_at: string | null }>();
    expect(row!.note_redacted_at).toBeNull();
    expect(await audits(w.db, "privacy.subject_redaction_fulfilled")).toBe(0);
    const request = await w.db.prepare("SELECT execution_status FROM subject_redaction_requests WHERE id=?")
      .bind(Number(filed.body.request_id)).first<{ execution_status: string | null }>();
    expect(request!.execution_status).toBeNull();
  });

  it("a request that is not granted is refused without any write", async () => {
    const w = await world();
    const filed = await fileNotes(w);
    await expect(fulfill(w, Number(filed.body.request_id))).rejects.toMatchObject({ status: 409, code: "not_granted" });
    expect(await audits(w.db, "privacy.subject_redaction_fulfilled")).toBe(0);
    expect(await countRows(w.db, "audit_events", "action='privacy.subject_redaction_fulfilled'")).toBe(0);
  });

  it("already-minimized evidence completes without further loss and never fabricates a digest", async () => {
    const w = await world();
    // The subject redacted their own note earlier through the audited requester path.
    const digest = await sha256("Private subject evidence for the fulfillment executor");
    await w.db.prepare(`UPDATE service_requests SET note='[redaction: note minimized]',note_digest=?,note_digest_status='original_sha256',
        note_redacted_at=CURRENT_TIMESTAMP,last_operation_id='legacy-requester-redaction',row_version=row_version+1 WHERE id=1`).bind(digest).run();
    const filed = await fileNotes(w);
    await grant(w, Number(filed.body.request_id));
    const done = await fulfill(w, Number(filed.body.request_id));
    expect(done.status).toBe(201);
    expect(done.body).toMatchObject({ fulfilled: true, already_minimized: true, redaction_completed: true, fulfillment_status: "completed" });
    const row = await w.db.prepare("SELECT note,note_digest FROM service_requests WHERE id=1").first<{ note: string; note_digest: string | null }>();
    expect(row!.note).toBe("[redaction: note minimized]");
    expect(row!.note_digest).toBe(digest);
    expect(await audits(w.db, "privacy.subject_redaction_fulfilled")).toBe(1);
  });

  it("already-withdrawn contact completes without extra writes", async () => {
    const w = await world();
    await w.db.prepare("UPDATE service_requests SET share_contact=0,province_code=NULL,city=NULL WHERE id=1").run();
    const filed = await fileContact(w);
    await grant(w, Number(filed.body.request_id));
    const done = await fulfill(w, Number(filed.body.request_id));
    expect(done.status).toBe(201);
    expect(done.body).toMatchObject({ already_minimized: true, redaction_completed: true });
    expect(await audits(w.db, "privacy.subject_redaction_fulfilled")).toBe(1);
  });

  it("a concurrent completion race admits exactly one receipt", async () => {
    const w = await world();
    const filed = await fileNotes(w);
    await grant(w, Number(filed.body.request_id));
    const raceDb = interposeBatch(w.db, async () => {
      // A competing admin's fulfillment commits while this one's batch is in flight.
      await adminFulfillRedactionRequest(authedRequest(`/api/admin/privacy/redaction-requests/${Number(filed.body.request_id)}/fulfill`, {
        execution_note: "Competing execution that must be the only completion.",
      }, { session: w.adminB }), env(w.db), Number(filed.body.request_id));
    });
    const outcome = await fulfill(w, Number(filed.body.request_id), raceDb, "Losing execution that must claim nothing.");
    expect([200, 201, 409]).toContain(outcome.status);
    if (outcome.status === 409) {
      expect(outcome.body).toMatchObject({ code: "execution_conflict" });
    } else {
      expect(outcome.body).toMatchObject({ already_fulfilled: true });
    }
    expect(await countRows(w.db, "audit_events", "action='privacy.subject_redaction_fulfilled'")).toBe(1);
    const request = await w.db.prepare("SELECT execution_status,execution_receipt_operation_id FROM subject_redaction_requests WHERE id=?")
      .bind(Number(filed.body.request_id)).first<{ execution_status: string; execution_receipt_operation_id: string }>();
    expect(request!.execution_status).toBe("completed");
    expect(request!.execution_receipt_operation_id).toEqual(expect.any(String));
    const row = await w.db.prepare("SELECT note_redacted_at,note_digest FROM service_requests WHERE id=1").first<{ note_redacted_at: string | null; note_digest: string | null }>();
    expect(row!.note_redacted_at).toEqual(expect.any(String));
    expect(row!.note_digest).toBe(await sha256("Private subject evidence for the fulfillment executor"));
  });

  it("an unrelated request and an unrelated service row stay untouched", async () => {
    const w = await world();
    const filed = await fileNotes(w);
    await grant(w, Number(filed.body.request_id));
    await fulfill(w, Number(filed.body.request_id));
    const untouched = await w.db.prepare("SELECT note,share_contact,province_code FROM service_requests WHERE id IN (2,3)").all<{ note: string; share_contact: number; province_code: string | null }>();
    for (const row of untouched.results ?? []) {
      expect(row.note.startsWith("Second private") || row.note.startsWith("Unrelated subject")).toBe(true);
      expect(row.province_code).toBe("IR-23");
    }
    const second = await w.db.prepare("SELECT note_redacted_at FROM service_requests WHERE id=2").first<{ note_redacted_at: string | null }>();
    expect(second!.note_redacted_at).toBeNull();
  });
});

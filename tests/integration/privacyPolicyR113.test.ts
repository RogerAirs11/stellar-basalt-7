import { describe, expect, it } from "vitest";
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import {
  adminApproveRetentionPolicy, adminDecideRedactionRequest, adminRedactionRequestQueue,
  fileSubjectRedactionRequest,
} from "../../src/api/modules/serviceRequests";
import { placeServiceRequestHoldStatements, serviceRetentionSweep } from "../../src/services/privacy";
import { authedRequest, countRows, makeSession, openRealDatabase, seedUser } from "../helpers/realDatabase";

const env = (db: D1Database) => ({ DB: db, SESSION_COOKIE_NAME: "hr_session" }) as never;
const policy = (days = 30, category = "service_request_terminal") => ({
  data_category: category, retention_days: days,
  consent_withdrawal_behavior: "Withdrawal immediately prevents any future optional disclosure.",
  hold_authority: "Only an active administrator may place a reasoned preservation hold.",
  release_requirements: "An active administrator must record a substantive release reason.",
});

async function world() {
  const db = await openRealDatabase();
  for (const [id, role] of [["subject", "user"], ["other", "user"], ["admin-a", "admin"], ["admin-b", "admin"]]) {
    await seedUser(db, id!, role!);
  }
  await db.exec(`
    INSERT INTO people(id,name_latin) VALUES(1,'Fictional D43 provider');
    INSERT INTO service_requests(id,requester_user_id,provider_person_id,category,note,share_contact,status,province_code,city)
    VALUES(1,'subject',1,'trainer','Private subject evidence kept for the explicit request',1,'new','IR-23','Subject city'),
          (2,'other',1,'trainer','Private unrelated evidence',1,'new','IR-23','Other city');
  `);
  const subject = await makeSession(db, "subject");
  const admin = await makeSession(db, "admin-a");
  const adminB = await makeSession(db, "admin-b");
  return { db, subject, admin, adminB };
}
type World = Awaited<ReturnType<typeof world>>;

function interposeBatch(db: D1Database, before?: () => Promise<unknown>, after?: () => Promise<unknown>): D1Database {
  let first = true;
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === "batch") return async (statements: D1PreparedStatement[]) => {
        const interpose = first;
        first = false;
        if (interpose) await before?.();
        const result = await db.batch(statements);
        if (interpose) await after?.();
        return result;
      };
      return Reflect.get(target, prop, receiver);
    },
  });
}
async function file(w: World, db = w.db, serviceId: number | null = 1, note = "Please review redaction of this specific request's note.") {
  const response = await fileSubjectRedactionRequest(authedRequest("/api/privacy/redaction-requests", {
    data_category: "service_request_notes", service_request_id: serviceId, request_note: note,
  }, { session: w.subject }), env(db));
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}
async function decide(w: World, id: number, decision: "grant" | "refuse" = "grant", db = w.db) {
  return adminDecideRedactionRequest(authedRequest(`/api/admin/privacy/redaction-requests/${id}/decide`, {
    decision, decision_note: "The operator has reviewed the exact scope and recorded this decision.",
  }, { session: w.admin }), env(db), id);
}
async function approve(w: World, db = w.db, days = 30, category = "service_request_terminal", session = w.admin) {
  return adminApproveRetentionPolicy(authedRequest("/api/admin/privacy/retention-policies", policy(days, category), { session }), env(db));
}
async function hold(w: World) {
  return w.db.batch(placeServiceRequestHoldStatements(w.db, {
    requestId: 1, operatorUserId: "admin-b", holdKind: "dispute",
    reason: "This fictional dispute preserves the specific request as evidence.",
  }));
}
async function audits(db: D1Database, action: string) {
  return Number((await db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action=?").bind(action).first<{ n: number }>())!.n);
}

describe("R113 D43 — honest redaction decisions, current authority and atomic audit receipts", () => {
  it("approval explicitly remains unexecuted, with original evidence and unrelated data intact", async () => {
    const w = await world();
    const filed = await file(w);
    expect(filed.body).toMatchObject({ redaction_completed: false, fulfillment_status: "not_executed" });
    const granted = await (await decide(w, Number(filed.body.request_id))).json();
    expect(granted).toMatchObject({ decided: true, decision: "grant", redaction_completed: false, fulfillment_status: "not_executed" });
    const queue = await (await adminRedactionRequestQueue(authedRequest("/api/admin/privacy/redaction-requests", undefined, { session: w.admin }), env(w.db))).json() as { requests: Record<string, unknown>[] };
    expect(queue.requests[0]).toMatchObject({ status: "granted", redaction_completed: false, fulfillment_status: "not_executed" });
    expect(await serviceRetentionSweep(w.db, new Date().toISOString())).toMatchObject({ minimized_requests: 0 });
    const data = await w.db.prepare("SELECT note,share_contact,city,retention_minimized_at FROM service_requests ORDER BY id").all();
    expect(data.results).toEqual([
      { note: "Private subject evidence kept for the explicit request", share_contact: 1, city: "Subject city", retention_minimized_at: null },
      { note: "Private unrelated evidence", share_contact: 1, city: "Other city", retention_minimized_at: null },
    ]);
  });

  it("a repeated decision returns409 without appending a false success audit", async () => {
    const w = await world();
    const id = Number((await file(w)).body.request_id);
    expect((await decide(w, id, "refuse")).status).toBe(200);
    await expect(decide(w, id, "grant")).rejects.toMatchObject({ status: 409, code: "not_decidable" });
    expect(await audits(w.db, "privacy.subject_redaction_decided")).toBe(1);
    expect((await w.db.prepare("SELECT status FROM subject_redaction_requests WHERE id=?").bind(id).first())?.status).toBe("refused");
  });

  it.each(["policy", "decision"])("a demoted admin cannot commit a %s after successful preflight", async (kind) => {
    const w = await world();
    const id = Number((await file(w)).body.request_id);
    const raced = interposeBatch(w.db, () => w.db.prepare("UPDATE users SET role='user' WHERE id='admin-a'").run());
    await expect(kind === "policy" ? approve(w, raced) : decide(w, id, "refuse", raced)).rejects.toMatchObject({ status: 403 });
    expect(await countRows(w.db, "privacy_retention_policies")).toBe(0);
    expect(await audits(w.db, "privacy.retention_policy_approved")).toBe(0);
    expect(await audits(w.db, "privacy.subject_redaction_decided")).toBe(0);
    expect((await w.db.prepare("SELECT status FROM subject_redaction_requests WHERE id=?").bind(id).first())?.status).toBe("received");
  });

  it("a hold committed after preflight blocks the grant inside its atomic mutation", async () => {
    const w = await world();
    const id = Number((await file(w)).body.request_id);
    const raced = interposeBatch(w.db, () => hold(w));
    await expect(decide(w, id, "grant", raced)).rejects.toMatchObject({ status: 409, code: "grant_blocked_by_hold" });
    expect(await audits(w.db, "privacy.subject_redaction_decided")).toBe(0);
    expect(await countRows(w.db, "service_request_holds", "released_at IS NULL")).toBe(1);
    expect((await w.db.prepare("SELECT note FROM service_requests WHERE id=1").first())?.note).toContain("Private subject evidence");
    expect((await decide(w, id, "refuse")).status).toBe(200);
    expect(await audits(w.db, "privacy.subject_redaction_decided")).toBe(1);
  });

  it("an untargeted grant stays unresolved instead of inventing an account-wide erasure scope", async () => {
    const w = await world();
    const id = Number((await file(w, w.db, null)).body.request_id);
    await expect(decide(w, id)).rejects.toMatchObject({ status: 409, code: "redaction_scope_unresolved" });
    expect(await audits(w.db, "privacy.subject_redaction_decided")).toBe(0);
    expect((await w.db.prepare("SELECT status FROM subject_redaction_requests WHERE id=?").bind(id).first())?.status).toBe("received");
    expect((await decide(w, id, "refuse")).status).toBe(200);
  });

  it("each new policy records the exact predecessor and preserves its history", async () => {
    const w = await world();
    for (const days of [30, 60, 90]) expect((await approve(w, w.db, days)).status).toBe(201);
    const rows = (await w.db.prepare("SELECT id,status,policy_version,supersedes_policy_id,retired_by_user_id FROM privacy_retention_policies ORDER BY policy_version").all()).results!;
    expect(rows).toHaveLength(3);
    expect(rows.map(row => row.supersedes_policy_id)).toEqual([null, rows[0]!.id, rows[1]!.id]);
    expect(rows.map(row => row.status)).toEqual(["retired", "retired", "approved"]);
    expect(rows.map(row => row.retired_by_user_id)).toEqual(["admin-a", "admin-a", null]);
    expect(await audits(w.db, "privacy.retention_policy_approved")).toBe(3);
  });

  it("failure after policy retirement rolls back the complete approval and predecessor history", async () => {
    const w = await world();
    await approve(w);
    const original = (await w.db.prepare("SELECT * FROM privacy_retention_policies").all()).results;
    await w.db.exec(`CREATE TRIGGER fail_policy_audit BEFORE INSERT ON audit_events
      WHEN NEW.action='privacy.retention_policy_approved'
      BEGIN SELECT RAISE(ABORT,'injected policy audit fault'); END;`);
    await expect(approve(w, w.db, 60)).rejects.toThrow("injected policy audit fault");
    expect((await w.db.prepare("SELECT * FROM privacy_retention_policies").all()).results).toEqual(original);
    expect(await audits(w.db, "privacy.retention_policy_approved")).toBe(1);
  });

  it("policy receipt names its committed version even when another admin approves before response delivery", async () => {
    const w = await world();
    const raced = interposeBatch(w.db, undefined, () => approve(w, w.db, 60, "service_request_terminal", w.adminB));
    const response = await (await approve(w, raced)).json() as Record<string, unknown>;
    const own = await w.db.prepare("SELECT id,policy_version FROM privacy_retention_policies WHERE approved_by_user_id='admin-a'").first();
    expect(response).toMatchObject({ policy_approved: true, policy_id: own!.id, policy_version: 1, previous_policy_retired: 0 });
    expect((await w.db.prepare("SELECT policy_version FROM privacy_retention_policies WHERE status='approved'").first())?.policy_version).toBe(2);
  });

  it("an audit-record policy approval makes no claim that an audit purge executor exists", async () => {
    const w = await world();
    const response = await (await approve(w, w.db, 60, "audit_dispute_record")).json();
    expect(response).toMatchObject({ policy_approved: true, enforcement_status: "not_implemented" });
    expect(await audits(w.db, "privacy.retention_policy_approved")).toBe(1);
  });

  it("filing returns its own receipt when a second request commits before response delivery", async () => {
    const w = await world();
    let laterId: unknown;
    const raced = interposeBatch(w.db, undefined, async () => { laterId = (await file(w, w.db, 1, "Second, distinct request by the same subject.")).body.request_id; });
    const first = await file(w, raced, 1, "First, distinct request by the same subject.");
    expect(first.body.request_id).not.toBe(laterId);
    expect((await w.db.prepare("SELECT request_note FROM subject_redaction_requests WHERE id=?").bind(first.body.request_id).first())?.request_note).toBe("First, distinct request by the same subject.");
    expect(await audits(w.db, "privacy.subject_redaction_requested")).toBe(2);
  });

  it("deactivation after preflight cannot return a previous filing as a new success", async () => {
    const w = await world();
    await file(w);
    const raced = interposeBatch(w.db, () => w.db.prepare("UPDATE users SET is_active=0 WHERE id='subject'").run());
    await expect(file(w, raced)).rejects.toMatchObject({ status: 401 });
    expect(await countRows(w.db, "subject_redaction_requests")).toBe(1);
    expect(await audits(w.db, "privacy.subject_redaction_requested")).toBe(1);
  });

  it("filing derives the deferred status from a hold that arrived after its preflight", async () => {
    const w = await world();
    const raced = interposeBatch(w.db, () => hold(w));
    expect((await file(w, raced)).body).toMatchObject({ status: "deferred_active_hold", redaction_completed: false, fulfillment_status: "not_executed" });
    const audit = await w.db.prepare("SELECT after_json FROM audit_events WHERE action='privacy.subject_redaction_requested'").first<{ after_json: string }>();
    expect(JSON.parse(audit!.after_json)).toMatchObject({ status: "deferred_active_hold" });
  });

  it("mutation-time ownership loss cannot create a request for another subject's evidence", async () => {
    const w = await world();
    const raced = interposeBatch(w.db, () => w.db.prepare("UPDATE service_requests SET requester_user_id='other' WHERE id=1").run());
    await expect(file(w, raced)).rejects.toMatchObject({ status: 403, code: "not_data_subject" });
    expect(await countRows(w.db, "subject_redaction_requests")).toBe(0);
    expect(await audits(w.db, "privacy.subject_redaction_requested")).toBe(0);
  });

  it("queue counts distinguish all four decision states plus executions, including an empty queue", async () => {
    const w = await world();
    const queue = async () => (await adminRedactionRequestQueue(authedRequest("/api/admin/privacy/redaction-requests", undefined, { session: w.admin }), env(w.db))).json() as Promise<{ counts: Record<string, number> }>;
    expect((await queue()).counts).toEqual({ received: 0, deferred_active_hold: 0, granted: 0, refused: 0, executed: 0 });
    await decide(w, Number((await file(w)).body.request_id));
    await decide(w, Number((await file(w)).body.request_id), "refuse");
    await file(w);
    await hold(w);
    await file(w);
    expect((await queue()).counts).toEqual({ received: 1, deferred_active_hold: 1, granted: 1, refused: 1, executed: 0 });
  });

  it.each([2_147_483_648, Number.MAX_SAFE_INTEGER])("accepts owned service request ID %s without narrowing the nullable-ID guard", async (serviceId) => {
    const w = await world();
    await w.db.prepare(`INSERT INTO service_requests(id,requester_user_id,provider_person_id,category,note,share_contact,status)
      VALUES(?,'subject',1,'trainer','Private high-ID subject evidence',1,'new')`).bind(serviceId).run();
    const filed = await file(w, w.db, serviceId);
    expect(filed.status).toBe(201);
    const saved = await w.db.prepare("SELECT service_request_id,subject_user_id FROM subject_redaction_requests WHERE id=?")
      .bind(filed.body.request_id).first();
    expect(saved).toEqual({ service_request_id: serviceId, subject_user_id: "subject" });
    expect((await decide(w, Number(filed.body.request_id))).status).toBe(200);
    expect((await w.db.prepare("SELECT note FROM service_requests WHERE id=?").bind(serviceId).first())?.note)
      .toBe("Private high-ID subject evidence");
    expect(await audits(w.db, "privacy.subject_redaction_requested")).toBe(1);
    expect(await audits(w.db, "privacy.subject_redaction_decided")).toBe(1);
  });
});

import { describe, expect, it } from "vitest";
import worker from "../../src/worker";
import { openRealDatabase, seedUser, makeSession, authedRequest, type AuthedSession } from "../helpers/realDatabase";
import type { D1Database } from "@cloudflare/workers-types";

const limiter = { limit: async () => ({ success: true }) };
function call(db: D1Database, path: string, body?: unknown, session?: AuthedSession, method?: string) {
  return (worker as unknown as { fetch(r: Request, e: unknown): Promise<Response> }).fetch(authedRequest(path, body, { session, method }), {
    APP_ENV: "production", DB_PROVIDER_MODE: "d1_only", DB: db, SESSION_COOKIE_NAME: "hr_session",
    ASSETS: { fetch: async () => new Response("unused") }, PUBLIC_RATE_LIMITER: limiter, AUTH_RATE_LIMITER: limiter,
    EXPENSIVE_RATE_LIMITER: limiter, WRITE_RATE_LIMITER: limiter, ACCOUNT_RATE_LIMITER: limiter,
  });
}
async function setup() {
  const db = await openRealDatabase();
  for (const [id, role] of [["registrant", "user"], ["stranger", "user"], ["registrar", "admin"]]) await seedUser(db, id!, role!);
  const owner = await makeSession(db, "registrant"); const other = await makeSession(db, "stranger"); const admin = await makeSession(db, "registrar");
  return { db, owner, other, admin };
}
const submission = { name_latin: "R147 fictional mare", name_native: "مادیان آزمایشی", birth_name: "First Name", previous_names: ["Former Name"],
  passport_no: "۰۰۷", passport_issuer: "Test Studbook", uel_no: "00123", life_number: "00555", foreign_registration_no: "F001", foreign_registration_issuer: "Foreign Test",
  passport_issue_date: { value: "2024-04", precision: "month", calendar: "gregorian" },
  passport_expiry: { value: "2035", precision: "year", calendar: "gregorian" }, height_cm: 154.5, markings: "White star", life_status: "alive" };
async function draft(db: D1Database, owner: AuthedSession, fields: Record<string, unknown> = {}) {
  const response = await call(db, "/api/change-requests", { request_type: "create_horse", submit: false, submission: { ...submission, ...fields } }, owner);
  const body = await response.json() as { request: { id: string }; error?: unknown };
  expect(response.status, JSON.stringify(body)).toBe(201); return body.request.id;
}
const evidence = { role: "passport", file_name: "synthetic-passport.pdf", mime_type: "application/pdf", data_base64: btoa("%PDF-1.4\nSynthetic audit fixture\n%%EOF"), operation_id: "upload-fixture-0001" };

describe("R147 registration details and private draft evidence through actual HTTP", () => {
  it("applies complete identity fields, scoped identifiers and aliases in reviewed creation", async () => {
    const { db, owner, admin } = await setup(); const id = await draft(db, owner);
    expect((await call(db, `/api/change-requests/${id}/submit`, {}, owner)).status).toBe(200);
    const result = await call(db, `/api/admin/change-requests/${id}/review`, { decision: "approved", note: "Synthetic reviewed fixture" }, admin);
    const body = await result.json() as { canonical_horse_id: number };
    expect(result.status, JSON.stringify(body)).toBe(200);
    const row = await db.prepare("SELECT birth_name,previous_names_json,passport_no,passport_issuer,passport_expiry_value,height_cm,markings,life_status FROM horses WHERE id=?").bind(body.canonical_horse_id).first();
    expect(row).toMatchObject({ birth_name: "First Name", previous_names_json: '["Former Name"]', passport_no: "۰۰۷", passport_issuer: "Test Studbook", passport_expiry_value: "2035", height_cm: 154.5, markings: "White star", life_status: "alive" });
    expect(await db.prepare("SELECT normalized_value,issuer_namespace FROM horse_identifiers WHERE horse_id=? AND kind='passport_no'").bind(body.canonical_horse_id).first()).toMatchObject({ normalized_value: "007", issuer_namespace: "passport:test studbook" });
    expect((await db.prepare("SELECT alias FROM horse_aliases WHERE horse_id=?").bind(body.canonical_horse_id).all()).results).toHaveLength(2);
    const publicView = await (await call(db, `/api/horses/${body.canonical_horse_id}`)).text();
    expect(publicView).not.toContain('"passport_no"'); expect(publicView).not.toContain('"passport_issuer"');
  });
  it("requires an issuer and valid passport chronology before saving a submission", async () => {
    const { db, owner } = await setup();
    for (const fields of [{ passport_issuer: null }, { passport_expiry: { value: "2020", precision: "year", calendar: "gregorian" } }, { height_cm: 0 },
      { passport_issue_date: { value: "2024-03-01",precision:"day",calendar:"gregorian" },passport_expiry:{value:"2024-02",precision:"month",calendar:"gregorian"} },
      { passport_issue_date: { value: "1403-01-01",precision:"day",calendar:"solar_hijri" },passport_expiry:{value:"1402",precision:"year",calendar:"solar_hijri"} },
    ]) {
      expect((await call(db, "/api/change-requests", { request_type: "create_horse", submit: false, submission: { ...submission, ...fields } }, owner)).status).toBe(400);
    }
  });
  it("enforces issuer-scoped passport uniqueness and rolls back a losing approval", async () => {
    const { db, owner, admin } = await setup();
    const first = await draft(db, owner); const second = await draft(db, owner, { name_latin: "Second horse", uel_no: "00999", life_number: "00999", foreign_registration_no: "F002" });
    for (const id of [first, second]) expect((await call(db, `/api/change-requests/${id}/submit`, {}, owner)).status).toBe(200);
    expect((await call(db, `/api/admin/change-requests/${first}/review`, { decision: "approved" }, admin)).status).toBe(200);
    expect((await call(db, `/api/admin/change-requests/${second}/review`, { decision: "approved" }, admin)).status).toBe(409);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM horses").first()).toMatchObject({ n: 1 });
    expect(await db.prepare("SELECT status,canonical_horse_id FROM change_requests WHERE id=?").bind(second).first()).toMatchObject({ status: "pending", canonical_horse_id: null });
  });
  it("stores real private bytes before approval and rejects unrelated readers", async () => {
    const { db, owner, other, admin } = await setup(); const id = await draft(db, owner);
    const uploaded = await call(db, `/api/change-requests/${id}/evidence`, evidence, owner);
    const body = await uploaded.json() as { evidence: { id: string; public_visible: boolean } };
    expect(uploaded.status, JSON.stringify(body)).toBe(201); expect(body.evidence.public_visible).toBe(false);
    expect((await call(db, `/api/change-requests/${id}/evidence`, undefined, other)).status).toBe(404);
    expect((await call(db, `/api/change-requests/${id}/evidence`)).status).toBe(401);
    const file = await call(db, `/api/change-requests/${id}/evidence/${body.evidence.id}/file`, undefined, admin);
    expect(file.status).toBe(200); expect(file.headers.get("cache-control")).toBe("private, no-store");
    expect(file.headers.get("content-disposition")).toContain("attachment"); expect(await file.text()).toContain("Synthetic audit fixture");
  });
  it("replays identical upload operations, conflicts on changed content and freezes pending evidence", async () => {
    const { db, owner } = await setup(); const id = await draft(db, owner);
    const a = await call(db, `/api/change-requests/${id}/evidence`, evidence, owner); const body = await a.json() as { evidence: { id: string } };
    expect(a.status).toBe(201); expect((await call(db, `/api/change-requests/${id}/evidence`, evidence, owner)).status).toBe(200);
    expect((await call(db, `/api/change-requests/${id}/evidence`, { ...evidence, file_name: "changed.pdf" }, owner)).status).toBe(409);
    expect(await db.prepare("SELECT evidence_file_count FROM change_requests WHERE id=?").bind(id).first()).toMatchObject({ evidence_file_count: 1 });
    await call(db, `/api/change-requests/${id}/submit`, {}, owner);
    expect((await call(db, `/api/change-requests/${id}/evidence`, { ...evidence, operation_id: "new-upload-0002" }, owner)).status).toBe(409);
    expect((await call(db, `/api/change-requests/${id}/evidence/${body.evidence.id}`, {}, owner, "DELETE")).status).toBe(409);
  });
  it("removes draft bytes with an auditable tombstone and prevents deleted-key reuse", async () => {
    const { db, owner } = await setup(); const id = await draft(db, owner);
    const uploaded = await (await call(db, `/api/change-requests/${id}/evidence`, evidence, owner)).json() as { evidence: { id: string } };
    expect((await call(db, `/api/change-requests/${id}/evidence/${uploaded.evidence.id}`, {}, owner, "DELETE")).status).toBe(200);
    expect(await db.prepare("SELECT evidence_file_count,evidence_total_bytes FROM change_requests WHERE id=?").bind(id).first()).toMatchObject({ evidence_file_count: 0, evidence_total_bytes: 0 });
    expect(await db.prepare("SELECT COUNT(*) AS n FROM request_evidence_blobs").first()).toMatchObject({ n: 0 });
    expect((await call(db, `/api/change-requests/${id}/evidence`, evidence, owner)).status).toBe(409);
  });
  it("losing upload versus submit writes no partial evidence or counters", async () => {
    const { db, owner } = await setup(); const id = await draft(db, owner);
    const original = db.batch.bind(db); let injected = false;
    db.batch = (async statements => {
      if (!injected) { injected = true; await db.prepare("UPDATE change_requests SET status='pending' WHERE id=?").bind(id).run(); }
      return original(statements);
    }) as typeof db.batch;
    expect((await call(db, `/api/change-requests/${id}/evidence`, evidence, owner)).status).toBe(409);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM request_evidence").first()).toMatchObject({ n: 0 });
    expect(await db.prepare("SELECT evidence_file_count,evidence_total_bytes FROM change_requests WHERE id=?").bind(id).first()).toMatchObject({ evidence_file_count: 0, evidence_total_bytes: 0 });
  });
  it("denies a session revoked after validation without writing bytes or changing counters", async () => {
    const {db,owner}=await setup();const id=await draft(db,owner);
    const batch=db.batch.bind(db);let injected=false;
    db.batch=(async statements=>{if(!injected){injected=true;await db.prepare("DELETE FROM sessions WHERE user_id='registrant'").run();}return batch(statements);}) as typeof db.batch;
    const denied=await call(db,`/api/change-requests/${id}/evidence`,evidence,owner);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({error:{code:'mfa_step_up_required'}});
    expect(await db.prepare("SELECT COUNT(*) n FROM request_evidence").first()).toMatchObject({n:0});
    expect(await db.prepare("SELECT evidence_file_count,evidence_total_bytes FROM change_requests WHERE id=?").bind(id).first()).toMatchObject({evidence_file_count:0,evidence_total_bytes:0});
  });
  it("denies a revoked delete and preserves both evidence objects and counters", async () => {
    const {db,owner}=await setup();const id=await draft(db,owner);
    const first=await (await call(db,`/api/change-requests/${id}/evidence`,evidence,owner)).json() as {evidence:{id:string}};
    await call(db,`/api/change-requests/${id}/evidence`,{...evidence,operation_id:'second-evidence-0002'},owner);
    const before=await db.prepare('SELECT evidence_file_count,evidence_total_bytes FROM change_requests WHERE id=?').bind(id).first();
    const batch=db.batch.bind(db);let injected=false;
    db.batch=(async statements=>{if(!injected){injected=true;await db.prepare("UPDATE users SET is_active=0 WHERE id='registrant'").run();}return batch(statements);}) as typeof db.batch;
    const denied=await call(db,`/api/change-requests/${id}/evidence/${first.evidence.id}`,{},owner,'DELETE');
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({error:{code:'mfa_step_up_required'}});
    expect(await db.prepare('SELECT evidence_file_count,evidence_total_bytes FROM change_requests WHERE id=?').bind(id).first()).toEqual(before);
    expect(await db.prepare('SELECT COUNT(*) n FROM request_evidence WHERE deleted_at IS NULL').first()).toMatchObject({n:2});
  });
  it("corrects managed former-name aliases atomically while retaining independently sourced aliases", async () => {
    const {db,owner,admin}=await setup();const id=await draft(db,owner);
    await call(db,`/api/change-requests/${id}/submit`,{},owner);
    const approved=await (await call(db,`/api/admin/change-requests/${id}/review`,{decision:'approved'},admin)).json() as {canonical_horse_id:number};
    const horseId=approved.canonical_horse_id;
    await db.prepare("INSERT INTO horse_aliases(horse_id,alias,alias_normalized,alias_type,source) VALUES(?,'Other Source','other source','previous','independent-source')").bind(horseId).run();
    const version=await db.prepare('SELECT row_version FROM horses WHERE id=?').bind(horseId).first<{row_version:number}>();
    const updated=await call(db,`/api/horses/${horseId}`,{expected_row_version:version!.row_version,changes:{birth_name:'Corrected Birth Name',previous_names:['Reviewed Former Name']}},admin,'PATCH');
    expect(updated.status,await updated.text()).toBe(200);
    const aliases=(await db.prepare('SELECT alias FROM horse_aliases WHERE horse_id=? ORDER BY alias').bind(horseId).all<{alias:string}>()).results.map(row=>row.alias);
    expect(aliases).toEqual(['Corrected Birth Name','Other Source','Reviewed Former Name']);
  });
});

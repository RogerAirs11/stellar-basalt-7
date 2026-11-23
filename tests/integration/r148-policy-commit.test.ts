import { describe, expect, it } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import worker from "../../src/worker";
import { adminCreateRegistryRule, adminTransitionRegistryRule } from "../../src/api/modules/registryRules";
import { recordFieldClaims } from "../../src/api/modules/fieldClaims";
import { authedRequest, makeSession, openRealDatabase, seedUser, type AuthedSession } from "../helpers/realDatabase";

// Every command below executes the production Worker against every numbered
// SQLite migration. The hook changes real rows immediately before the atomic
// acceptance batch; it does not replace SQL or manufacture handler results.
const limiter = { limit: async () => ({ success: true }) };
function call(db: D1Database, path: string, body?: unknown, session?: AuthedSession, method?: string) {
  return (worker as unknown as { fetch(r: Request, e: unknown): Promise<Response> }).fetch(authedRequest(path, body, { session, method }), {
    APP_ENV: "production", DB_PROVIDER_MODE: "d1_only", DB: db, SESSION_COOKIE_NAME: "hr_session",
    ASSETS: { fetch: async () => new Response("unused") }, PUBLIC_RATE_LIMITER: limiter, AUTH_RATE_LIMITER: limiter,
    EXPENSIVE_RATE_LIMITER: limiter, WRITE_RATE_LIMITER: limiter, ACCOUNT_RATE_LIMITER: limiter,
  });
}
function beforeBatch(db: D1Database, action: () => Promise<unknown>): D1Database {
  let injected = false;
  return { ...db, async batch(statements: Parameters<D1Database["batch"]>[0]) {
    if (!injected) { injected = true; await action(); }
    return db.batch(statements);
  } } as D1Database;
}
async function world() {
  const db = await openRealDatabase();
  await seedUser(db, "policy-admin", "admin"); await seedUser(db, "policy-editor", "editor"); await seedUser(db, "policy-owner", "user");
  await db.exec("INSERT INTO horses(id,name_latin,birth_year,sex_desc) VALUES(9301,'Policy Mare',2015,'Mare'),(9302,'Policy Sire',2000,'Stallion')");
  return { db, admin: await makeSession(db, "policy-admin"), editor: await makeSession(db, "policy-editor"), owner: await makeSession(db, "policy-owner") };
}
async function installRule(db: D1Database, admin: AuthedSession, extra: Record<string, unknown> = {}) {
  const payload = { id: "policy.evidence", rule_type: "required_evidence", title: "Policy fixture evidence", severity: "blocker", spec: { require_document: true }, ...extra };
  const env = { DB: db, SESSION_COOKIE_NAME: "hr_session" };
  expect((await adminCreateRegistryRule(authedRequest("/api/admin/registry-rules", payload, { session: admin }), env)).status).toBe(201);
  for (const [expected_version, state] of [[1, "report_only"], [2, "active"]] as const) {
    expect((await adminTransitionRegistryRule(authedRequest("/api/admin/registry-rules/state", { expected_version, state }, { session: admin }), env, String(payload.id))).status).toBe(200);
  }
}
const override = { rule_overrides: [{ rule_id: "policy.evidence", reason: "Documented, authorized synthetic fixture exception" }] };
const newHorse = { id: 9303, name_latin: "Policy Created", birth_year: 2020, breed_desc: "Arabian" };
const edit = { expected_row_version: 1, changes: { name_latin: "Reviewed Policy Mare" } };
async function count(db: D1Database, table: string) { return Number(await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<number>("n")); }
async function state(db: D1Database) {
  const tables = ["horses", "horse_identifiers", "registry_policy_receipts", "registry_rule_outcomes", "canonical_mutation_log", "audit_events"];
  return { counts: await Promise.all(tables.map(table => count(db, table))), registry: await db.prepare("SELECT canonical_revision,analytics_stale FROM registry_state WHERE id=1").first() };
}
async function stale(response: Response) {
  expect(response.status, await response.clone().text()).toBe(409);
  expect(await response.json()).toMatchObject({ error: { code: "registry_policy_context_changed" } });
}
async function stage(db: D1Database, editor: AuthedSession, rows: Record<string, unknown>[] = [{ external_id: "row-one", name_latin: "Policy Imported", register_no: "POLICY9304" }]) {
  const source = await db.prepare("INSERT INTO import_sources(name,issuer_namespace,scope_note,redistribution_allowed) VALUES(?,'policy-fixture','Fictional local fixture',1)").bind(crypto.randomUUID()).run();
  const response = await call(db, "/api/admin/imports/stage", { source_id: Number(source.meta.last_row_id), file_name: "fixture.json", mapping_version: "v1", rows }, editor);
  expect(response.status, await response.clone().text()).toBe(201);
  return (await response.json() as { batch: { id: number; source_id: number } }).batch;
}
async function draft(db: D1Database, session: AuthedSession, update = false) {
  const body = update ? { horse_id: 9301, request_type: "update_horse", submit: false, summary: "Synthetic name correction",
    items: [{ field_name: "name_latin", old_value: "Policy Mare", proposed_value: "Proposal Name" }] }
    : { request_type: "create_horse", submit: false, submission: { name_latin: "Policy Submitted", breed_desc: "Arabian", birth_year: 2020 } };
  const response = await call(db, "/api/change-requests", body, session);
  expect(response.status, await response.clone().text()).toBe(201);
  const created = await response.json() as { request: { id: string; content_revision?: number } };
  return { id: created.request.id, revision: created.request.content_revision ?? 1 };
}
async function photo(db: D1Database, id = "policy-photo") {
  await db.prepare("INSERT INTO horse_media(id,horse_id,media_type,file_name,mime_type,size_bytes,verification) VALUES(?,9301,'photo','fixture.png','image/png',4,'owner_submitted')").bind(id).run();
  await db.prepare("INSERT INTO horse_media_blobs(media_id,chunk,data) VALUES(?,0,?)").bind(id, new Uint8Array([1, 2, 3, 4])).run();
}
async function document(db: D1Database, id: string, role = "passport") {
  await db.prepare("INSERT INTO horse_media(id,horse_id,media_type,role,file_name,mime_type,size_bytes,verification) VALUES(?,9301,'document',?,'fictional.pdf','application/pdf',4,'owner_submitted')").bind(id, role).run();
  await db.prepare("INSERT INTO horse_media_blobs(media_id,chunk,data) VALUES(?,0,?)").bind(id, new Uint8Array([1, 2, 3, 4])).run();
}
async function clinicalBinding(db: D1Database, mediaId: string) {
  await db.prepare("INSERT INTO equine_clinical_events(id,horse_id,event_type,body_json,evidence_media_id,created_by_user_id,last_operation_id) VALUES(?,9301,'examination','{}',?,'policy-owner',?)")
    .bind(crypto.randomUUID(), mediaId, crypto.randomUUID()).run();
}

describe("R148 policy acceptance is checked and receipted inside the canonical transaction", () => {
  it.each(["create", "update"] as const)("rejects empty-to-first-active policy during %s without residue", async operation => {
    const { db, admin, editor } = await world(); const before = await state(db);
    const raced = beforeBatch(db, () => installRule(db, admin));
    await stale(operation === "create" ? await call(raced, "/api/horses", newHorse, editor)
      : await call(raced, "/api/horses/9301", edit, editor, "PATCH"));
    expect(await state(db)).toEqual(before);
    expect(await db.prepare("SELECT revision FROM registry_policy_state WHERE id=1").first("revision")).toBe(3);
  });
  it("rejects retirement after an override was evaluated; no stale-version outcome lands", async () => {
    const { db, admin, editor } = await world(); await installRule(db, admin, { severity: "warning" }); const before = await state(db);
    const raced = beforeBatch(db, () => adminTransitionRegistryRule(authedRequest("/state", { expected_version: 3, state: "retired" }, { session: admin }), { DB: db, SESSION_COOKIE_NAME: "hr_session" }, "policy.evidence"));
    await stale(await call(raced, "/api/horses", { ...newHorse, ...override }, editor));
    expect(await state(db)).toEqual(before);
  });
  it("pins the exact rule definition even when a direct database change did not advance the epoch", async () => {
    const { db, admin, editor } = await world(); await installRule(db, admin, { spec: {} }); const before = await state(db);
    const raced = beforeBatch(db, () => db.prepare("UPDATE registry_rules SET spec_json=? WHERE id='policy.evidence'").bind('{"require_document":true}').run());
    await stale(await call(raced, "/api/horses", newHorse, editor)); expect(await state(db)).toEqual(before);
  });
  it("does not accept a child evaluated against a parent's obsolete birth context", async () => {
    const { db, admin, editor } = await world();
    await installRule(db, admin, { rule_type: "chronology", spec: { min_parent_age_gap_years: 4 } }); const before = await state(db);
    const raced = beforeBatch(db, () => db.exec("UPDATE horses SET birth_year=2019,row_version=row_version+1 WHERE id=9302"));
    await stale(await call(raced, "/api/horses", { ...newHorse, father_id: 9302 }, editor)); expect(await state(db)).toEqual(before);
  });
  it.each(["withdraw", "replace"] as const)("detects evidence %s even when the horse version is unchanged", async action => {
    const { db, admin, editor } = await world(); await photo(db); await installRule(db, admin, { spec: { require_photo: true } }); const before = await state(db);
    const raced = beforeBatch(db, async () => {
      if (action === "withdraw") await db.exec("UPDATE horse_media SET verification='rejected',row_version=row_version+1 WHERE id='policy-photo'");
      else { await db.exec("DELETE FROM horse_media WHERE id='policy-photo'"); await photo(db, "replacement-photo"); }
    });
    await stale(await call(raced, "/api/horses/9301", edit, editor, "PATCH")); expect(await state(db)).toEqual(before);
    expect(await db.prepare("SELECT name_latin,row_version FROM horses WHERE id=9301").first()).toMatchObject({ name_latin: "Policy Mare", row_version: 1 });
  });
  it.each(["veterinary", "genetic", "clinical", "reproduction", "sample", "report"] as const)("excludes %s evidence from generic admission decisions and receipts while retaining ordinary registration documents", async kind => {
    const { db, admin, editor } = await world();
    await installRule(db, admin);
    await installRule(db, admin, { id: "policy.minimum", rule_type: "studbook_admission", spec: { breed: "Arabian", min_evidence_items: 1 } });
    const absent = await call(db, "/api/horses/9301", edit, editor, "PATCH"); expect(absent.status).toBe(422);
    const privateId = `private-policy-${kind}`; await document(db, privateId, kind === "veterinary" ? "veterinary" : "passport");
    if (kind === "genetic") await db.prepare("INSERT INTO genetic_tests(horse_id,test_type,result,certificate_media_id) VALUES(9301,'SCID','private-fixture',?)").bind(privateId).run();
    if (kind === "clinical") await clinicalBinding(db, privateId);
    if (kind === "reproduction") await db.prepare("INSERT INTO equine_reproductive_episodes(id,horse_id,method,outcome,body_json,evidence_media_id,created_by_user_id,last_operation_id) VALUES('private-reproduction',9301,'natural_cover','planned','{}',?,'policy-owner','private-reproduction-operation')").bind(privateId).run();
    if (kind === "sample" || kind === "report") {
      await db.prepare("INSERT INTO equine_samples(id,horse_id,sample_ref,specimen,identity_check,body_json,evidence_media_id,created_by_user_id,last_operation_id) VALUES('private-sample',9301,'fixture','hair_root','not_checked','{}',?,'policy-owner','private-sample-operation')").bind(kind === "sample" ? privateId : null).run();
      if (kind === "report") await db.prepare("INSERT INTO equine_lab_reports(id,horse_id,sample_id,laboratory_ref,accession_ref,issued_on,panel_type,panel_version,method,evidence_media_id,evidence_sha256,body_json,created_by_user_id,last_operation_id) VALUES('private-report',9301,'private-sample','fixture','fixture','2020-01-01','disease','fixture','fixture',?,'fixture','{}','policy-owner','private-report-operation')").bind(privateId).run();
    }
    const before = await state(db);
    const withPrivate = await call(db, "/api/horses/9301", edit, editor, "PATCH");
    expect(withPrivate.status).toBe(422); expect(await withPrivate.json()).toEqual(await absent.json());
    expect(await state(db)).toEqual(before);
    await document(db, "ordinary-registration-document");
    // A private file version change must not create an observable policy
    // conflict or put its identifier in a generic registry receipt.
    const raced = beforeBatch(db, () => db.prepare("UPDATE horse_media SET row_version=row_version+1 WHERE id=?").bind(privateId).run());
    const accepted = await call(raced, "/api/horses/9301", edit, editor, "PATCH");
    expect(accepted.status, await accepted.clone().text()).toBe(200);
    const context = String(await db.prepare("SELECT context_json FROM registry_policy_receipts").first("context_json"));
    expect(context).not.toContain(privateId); expect(context).toContain("ordinary-registration-document");
    expect(JSON.parse(context)).toMatchObject({ record: { evidence_document_count: 1, evidence_photo_count: 0 } });
  });
  it("rejects an ordinary document becoming private clinical evidence after admission evaluation", async () => {
    const { db, admin, editor } = await world(); await document(db, "newly-private"); await installRule(db, admin);
    const before = await state(db);
    const raced = beforeBatch(db, () => clinicalBinding(db, "newly-private"));
    await stale(await call(raced, "/api/horses/9301", edit, editor, "PATCH"));
    expect(await state(db)).toEqual(before);
  });
  it("rolls back horse, identifiers, revision, journal and acceptance when an override receipt insert fails", async () => {
    const { db, admin, editor } = await world(); await installRule(db, admin, { severity: "warning" }); const before = await state(db);
    await db.exec("CREATE TRIGGER policy_receipt_failure BEFORE INSERT ON registry_rule_outcomes BEGIN SELECT RAISE(ABORT,'forced policy receipt failure'); END");
    expect((await call(db, "/api/horses", { ...newHorse, microchip_no: "001489303", ...override }, editor)).status).toBe(500);
    expect(await state(db)).toEqual(before);
    await db.exec("DROP TRIGGER policy_receipt_failure");
    expect((await call(db, "/api/horses", { ...newHorse, microchip_no: "001489303", ...override }, editor)).status).toBe(201);
    const receipt = await db.prepare("SELECT operation_id,policy_revision,decision FROM registry_policy_receipts").first<{ operation_id: string; policy_revision: number; decision: string }>();
    expect(receipt).toMatchObject({ policy_revision: 3, decision: "accepted" });
    expect(await db.prepare("SELECT operation_id,policy_revision,rule_version,outcome FROM registry_rule_outcomes").first()).toMatchObject({ operation_id: receipt!.operation_id, policy_revision: 3, rule_version: 3, outcome: "override" });
  });
  it("requires a durable acceptance receipt even with zero active rules", async () => {
    const { db, editor } = await world(); const before = await state(db);
    await db.exec("CREATE TRIGGER policy_receipt_failure BEFORE INSERT ON registry_policy_receipts BEGIN SELECT RAISE(ABORT,'forced acceptance failure'); END");
    expect((await call(db, "/api/horses/9301", edit, editor, "PATCH")).status).toBe(500); expect(await state(db)).toEqual(before);
    expect(await db.prepare("SELECT name_latin,row_version FROM horses WHERE id=9301").first()).toMatchObject({ name_latin: "Policy Mare", row_version: 1 });
  });
  it("stores only evaluated input fields in a policy receipt, excluding unrelated private horse data", async () => {
    const { db, editor } = await world();
    await db.prepare("UPDATE horses SET precise_address=? WHERE id=9301").bind("PRIVATE-ADDRESS-NOT-A-POLICY-INPUT").run();
    expect((await call(db, "/api/horses/9301", edit, editor, "PATCH")).status).toBe(200);
    const context = String(await db.prepare("SELECT context_json FROM registry_policy_receipts").first("context_json"));
    expect(context).not.toContain("PRIVATE-ADDRESS-NOT-A-POLICY-INPUT");
    expect(JSON.parse(context)).toMatchObject({ record: { horse_id: 9301, name_latin: "Reviewed Policy Mare" } });
  });
  it("fails closed when the singleton policy state disappears after preflight", async () => {
    const { db, editor } = await world(); const before = await state(db);
    await stale(await call(beforeBatch(db, () => db.exec("DELETE FROM registry_policy_state")), "/api/horses", newHorse, editor));
    expect(await state(db)).toEqual(before);
  });
});

describe("R148 reviewed input and evidence keep the policy context that was actually reviewed", () => {
  it.each([false, true])("pins the draft content revision during review (update=%s)", async update => {
    const { db, admin, editor } = await world(); const { id, revision } = await draft(db, editor, update);
    const beforeHorseCount = await count(db, "horses");
    const changed = update ? { expected_content_revision: revision, items: [{ field_name: "name_latin", old_value: "Policy Mare", proposed_value: "Changed Proposal" }] }
      : { expected_content_revision: revision, submission: { name_latin: "Changed Proposal", birth_year: 2021, breed_desc: "Arabian" } };
    const raced = beforeBatch(db, async () => { const editResponse = await call(db, `/api/change-requests/${id}`, changed, editor, "PATCH"); expect(editResponse.status, await editResponse.text()).toBe(200); });
    await stale(await call(raced, `/api/admin/change-requests/${id}/review`, { decision: "approved" }, admin));
    expect(await count(db, "horses")).toBe(beforeHorseCount); expect(await count(db, "registry_policy_receipts")).toBe(0);
    expect(await db.prepare("SELECT status,content_revision,canonical_horse_id FROM change_requests WHERE id=?").bind(id).first()).toMatchObject({ status: "draft", content_revision: 2, canonical_horse_id: null });
  });
  it("a draft edit that loses to approval cannot replace the approved child items", async () => {
    const { db, admin, editor } = await world(); const { id, revision } = await draft(db, editor, true);
    const raced = beforeBatch(db, async () => { const approved = await call(db, `/api/admin/change-requests/${id}/review`, { decision: "approved" }, admin); expect(approved.status, await approved.text()).toBe(200); });
    const response = await call(raced, `/api/change-requests/${id}`, { expected_content_revision: revision, items: [{ field_name: "name_latin", old_value: "Policy Mare", proposed_value: "Losing Proposal" }] }, editor, "PATCH");
    expect(response.status).toBe(409);
    expect(await db.prepare("SELECT name_latin FROM horses WHERE id=9301").first("name_latin")).toBe("Proposal Name");
    expect(await db.prepare("SELECT proposed_value_json FROM change_request_items WHERE change_request_id=?").bind(id).first("proposed_value_json")).toBe('"Proposal Name"');
    expect(await count(db, "registry_policy_receipts")).toBe(1);
  });
  it("rejects request evidence withdrawal before review and leaves the draft unapproved", async () => {
    const { db, admin, owner } = await world(); const { id } = await draft(db, owner);
    const upload = await call(db, `/api/change-requests/${id}/evidence`, { role: "passport", file_name: "fixture.pdf", mime_type: "application/pdf",
      data_base64: btoa("%PDF-1.4\nFictional policy fixture\n%%EOF"), operation_id: "policy-evidence-upload" }, owner);
    expect(upload.status).toBe(201); const evidenceId = (await upload.json() as { evidence: { id: string } }).evidence.id;
    await installRule(db, admin);
    const raced = beforeBatch(db, async () => { expect((await call(db, `/api/change-requests/${id}/evidence/${evidenceId}`, {}, owner, "DELETE")).status).toBe(200); });
    await stale(await call(raced, `/api/admin/change-requests/${id}/review`, { decision: "approved" }, admin));
    expect(await count(db, "horses")).toBe(2); expect(await count(db, "registry_policy_receipts")).toBe(0);
    expect(await db.prepare("SELECT status FROM change_requests WHERE id=?").bind(id).first("status")).toBe("draft");
  });
});

describe("R148 import policy decisions are atomic and replay safe", () => {
  it("captures the empty policy epoch on import and retries a first activation", async () => {
    const { db, admin, editor } = await world(); const batch = await stage(db, editor);
    await stale(await call(beforeBatch(db, () => installRule(db, admin)), `/api/admin/imports/batches/${batch.id}/apply`, {}, editor));
    expect(await count(db, "horses")).toBe(2); expect(await count(db, "registry_policy_receipts")).toBe(0);
    expect(await db.prepare("SELECT outcome FROM import_staging_rows WHERE batch_id=?").bind(batch.id).first("outcome")).toBe("pending");
  });
  it("source-agreement changes cannot accept the old source context", async () => {
    const { db, editor } = await world(); const batch = await stage(db, editor);
    const raced = beforeBatch(db, () => db.prepare("UPDATE import_sources SET license_note='Changed agreement conditions' WHERE id=?").bind(batch.source_id).run());
    await stale(await call(raced, `/api/admin/imports/batches/${batch.id}/apply`, {}, editor));
    expect(await count(db, "horses")).toBe(2); expect(await count(db, "registry_policy_receipts")).toBe(0);
  });
  it("receipt failure leaves an import pending; retry and replay cannot duplicate acceptance", async () => {
    const { db, admin, editor } = await world(); const batch = await stage(db, editor); await installRule(db, admin, { severity: "warning" }); const before = await state(db);
    await db.exec("CREATE TRIGGER policy_receipt_failure BEFORE INSERT ON registry_rule_outcomes BEGIN SELECT RAISE(ABORT,'forced import receipt failure'); END");
    expect((await call(db, `/api/admin/imports/batches/${batch.id}/apply`, override, editor)).status).toBe(503);
    expect(await state(db)).toEqual(before); expect(await db.prepare("SELECT outcome FROM import_staging_rows WHERE batch_id=?").bind(batch.id).first("outcome")).toBe("pending");
    await db.exec("DROP TRIGGER policy_receipt_failure");
    expect((await call(db, `/api/admin/imports/batches/${batch.id}/apply`, override, editor)).status).toBe(200);
    const after = await state(db); expect(await count(db, "registry_policy_receipts")).toBe(1); expect(await count(db, "registry_rule_outcomes")).toBe(1);
    expect((await call(db, `/api/admin/imports/batches/${batch.id}/apply`, override, editor)).status).toBe(200); expect(await state(db)).toEqual(after);
  });
  it("a rule-blocked import cannot mark conflict without its rejection receipt", async () => {
    const { db, admin, editor } = await world(); const batch = await stage(db, editor); await installRule(db, admin);
    await db.exec("CREATE TRIGGER policy_receipt_failure BEFORE INSERT ON registry_rule_outcomes BEGIN SELECT RAISE(ABORT,'forced rejection receipt failure'); END");
    expect((await call(db, `/api/admin/imports/batches/${batch.id}/apply`, {}, editor)).status).toBe(500);
    expect(await db.prepare("SELECT outcome FROM import_staging_rows WHERE batch_id=?").bind(batch.id).first("outcome")).toBe("pending"); expect(await count(db, "registry_policy_receipts")).toBe(0);
    await db.exec("DROP TRIGGER policy_receipt_failure");
    expect((await call(db, `/api/admin/imports/batches/${batch.id}/apply`, {}, editor)).status).toBe(200);
    expect(await db.prepare("SELECT decision FROM registry_policy_receipts").first("decision")).toBe("rejected"); expect(await count(db, "registry_rule_outcomes")).toBe(1);
    const after = await state(db); expect((await call(db, `/api/admin/imports/batches/${batch.id}/apply`, {}, editor)).status).toBe(200); expect(await state(db)).toEqual(after);
  });
});

describe("R148 claim selection and reversal use the same policy transaction", () => {
  it("rolls back a selection on receipt failure and reverses only once with its own receipt", async () => {
    const { db, editor } = await world();
    const claimId = (await recordFieldClaims(db, 9301, [{ field_name: "birth_year", claimed_value: 2012, source_type: "owner_statement", source_ref: "fictional-fixture" }]))[0]!.claim_id!;
    const path = `/api/admin/horses/9301/field-claims/${claimId}/select`; const reason = { reason: "Reviewed fictional source correction" };
    await db.exec("CREATE TRIGGER policy_receipt_failure BEFORE INSERT ON registry_policy_receipts BEGIN SELECT RAISE(ABORT,'forced claim receipt failure'); END");
    expect((await call(db, path, reason, editor)).status).toBe(500);
    expect(await db.prepare("SELECT birth_year,row_version FROM horses WHERE id=9301").first()).toMatchObject({ birth_year: 2015, row_version: 1 }); expect(await count(db, "field_claim_decisions")).toBe(0);
    await db.exec("DROP TRIGGER policy_receipt_failure"); expect((await call(db, path, reason, editor)).status).toBe(200);
    const decisionId = Number(await db.prepare("SELECT id FROM field_claim_decisions WHERE decision='select_claim'").first("id"));
    const reversal = `/api/admin/horses/9301/field-claims/decisions/${decisionId}/revert`;
    expect((await call(db, reversal, reason, editor)).status).toBe(200); expect((await call(db, reversal, reason, editor)).status).toBe(409);
    expect(await count(db, "registry_policy_receipts")).toBe(2); expect(await count(db, "field_claim_decisions")).toBe(2);
    expect(await db.prepare("SELECT birth_year FROM horses WHERE id=9301").first("birth_year")).toBe(2015);
  });
  it("source licence changes while selecting an imported claim roll back selection", async () => {
    const { db, editor } = await world(); const batch = await stage(db, editor);
    const rowId = Number(await db.prepare("SELECT id FROM import_staging_rows WHERE batch_id=?").bind(batch.id).first("id"));
    await db.prepare("UPDATE import_staging_rows SET horse_id=9301 WHERE id=?").bind(rowId).run();
    const claimId = (await recordFieldClaims(db, 9301, [{ field_name: "birth_year", claimed_value: 2012, source_type: "import", source_ref: `batch:${batch.id}:row:${rowId}` }]))[0]!.claim_id!;
    const raced = beforeBatch(db, () => db.prepare("UPDATE import_sources SET redistribution_allowed=0 WHERE id=?").bind(batch.source_id).run());
    await stale(await call(raced, `/api/admin/horses/9301/field-claims/${claimId}/select`, { reason: "Reviewed source correction" }, editor));
    expect(await count(db, "field_claim_decisions")).toBe(0); expect(await count(db, "registry_policy_receipts")).toBe(0);
    expect(await db.prepare("SELECT birth_year FROM horses WHERE id=9301").first("birth_year")).toBe(2015);
  });
});

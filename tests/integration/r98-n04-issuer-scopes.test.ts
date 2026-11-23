import { describe, expect, it } from "vitest";
import workerDefault from "../../src/worker";
import { openRealDatabase, seedUser, makeSession, authedRequest, countRows } from "../helpers/realDatabase";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * R98-N04 acceptance: issuer authority, structured scopes and review
 * responsibilities as ENFORCED claims.
 *
 * Acceptance under test:
 *  - Out-of-scope, expired, revoked and malformed grants cannot issue or
 *    supersede records.
 *  - Paid subscriptions and generic staff roles cannot create an official
 *    attestation.
 *  - An issuer suspension takes effect on commands and the public
 *    effective-status projection without deleting history.
 * Plus: registration evidence gates scope approval, scope approval is
 * versioned, the issuer owner cannot self-approve authority, the operator
 * queue surfaces trust operations, and the public trust labels are honest.
 */
const worker = workerDefault as unknown as { fetch(request: Request, env: Env): Promise<Response> };
const limiter = { limit: async () => ({ success: true }) };
function env(db: D1Database): Env {
  return { APP_ENV: "production", DB_PROVIDER_MODE: "d1_only", SESSION_COOKIE_NAME: "hr_session", DB: db,
    ASSETS: { fetch: async () => new Response("<html>") }, PUBLIC_RATE_LIMITER: limiter, AUTH_RATE_LIMITER: limiter,
    EXPENSIVE_RATE_LIMITER: limiter, WRITE_RATE_LIMITER: limiter, ACCOUNT_RATE_LIMITER: limiter } as unknown as Env;
}
async function body(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

const EVIDENCE = "Laboratory accreditation certificate IR-LAB-2026-041 reviewed and archived by platform staff";

async function trustFixture() {
  const db = await openRealDatabase();
  for (const [id, role] of [["owner", "user"], ["attester", "user"], ["other", "user"], ["editor", "editor"], ["admin", "admin"], ["paid", "user"]]) await seedUser(db, id!, role!);
  await db.exec(`INSERT INTO horses(id,name_latin) VALUES(1,'Synthetic Horse');
    INSERT INTO genetic_tests(id,horse_id,test_type,result,verified) VALUES(1,1,'SCID','N/N',1);
    INSERT INTO horse_media(id,horse_id,media_type,file_name,mime_type,size_bytes,uploaded_by_user_id,consent_state)
      VALUES('media-1',1,'document','lab.pdf','application/pdf',10,'other','private')`);
  const created = await worker.fetch(authedRequest("/api/admin/issuers", { slug: "scope-lab", name: "Scope Laboratory", kind: "laboratory", registration_evidence: EVIDENCE }, { session: await makeSession(db, "admin") }), env(db));
  expect(created.status).toBe(201);
  const issuerId = ((await body(created)) as { issuer: { id: string } }).issuer.id;
  return { db, issuerId, owner: await makeSession(db, "owner"), attester: await makeSession(db, "attester"),
    other: await makeSession(db, "other"), editor: await makeSession(db, "editor"), admin: await makeSession(db, "admin"), paid: await makeSession(db, "paid") };
}

async function grantScope(w: Awaited<ReturnType<typeof trustFixture>>, recordKind: string, actions: string[], extra: Record<string, unknown> = {}) {
  return worker.fetch(authedRequest(`/api/admin/issuers/${w.issuerId}/scopes`, { record_kind: recordKind, actions, evidence_note: "Accreditation scope reviewed against the archived certificate", ...extra }, { session: w.admin }), env(w.db));
}
async function grantMemberships(w: Awaited<ReturnType<typeof trustFixture>>) {
  await worker.fetch(authedRequest(`/api/admin/issuers/${w.issuerId}/memberships`, { user_id: "owner", role: "owner" }, { session: w.admin }), env(w.db));
  await worker.fetch(authedRequest(`/api/admin/issuers/${w.issuerId}/memberships`, { user_id: "attester", role: "attester" }, { session: w.owner }), env(w.db));
}

describe("R98-N04 structured issuer scopes over HTTP", () => {
  it("out-of-scope, malformed, expired, future and revoked grants cannot issue; the approved kind can", async () => {
    const w = await trustFixture();
    await grantMemberships(w);
    // Approved scope for horse_identity; a MALFORMED approved scope (end before
    // start, seeded directly) occupies the media slot.
    expect((await grantScope(w, "horse_identity", ["attest", "supersede"])).status).toBe(201);
    await w.db.exec(`INSERT INTO issuer_scopes(id,issuer_id,record_kind,status,scope_version,valid_from,valid_until,evidence_note,approved_by_user_id)
      VALUES('scope-bad','${w.issuerId}','media','approved',1,'2020-01-01 00:00:00','2019-01-01 00:00:00','Malformed interval','admin');
      INSERT INTO issuer_scope_actions(scope_id,action) VALUES('scope-bad','attest'),('scope-bad','supersede')`);
    // Out-of-scope: genetic_test has NO scope at all.
    expect((await worker.fetch(authedRequest(`/api/issuers/${w.issuerId}/attestations`, { record_kind: "genetic_test", record_id: "1" }, { session: w.attester }), env(w.db))).status).toBe(403);
    // Malformed interval: an approved scope with impossible dates never authorizes.
    expect((await worker.fetch(authedRequest(`/api/issuers/${w.issuerId}/attestations`, { record_kind: "media", record_id: "media-1" }, { session: w.attester }), env(w.db))).status).toBe(403);
    expect(await countRows(w.db, "attestations")).toBe(0);
    // The approved kind issues.
    const issued = await worker.fetch(authedRequest(`/api/issuers/${w.issuerId}/attestations`, { record_kind: "horse_identity", record_id: "1" }, { session: w.attester }), env(w.db));
    expect(issued.status).toBe(201);
    expect(await countRows(w.db, "attestations")).toBe(1);
    expect(await countRows(w.db, "attestation_snapshots")).toBe(1);
  });

  it("expired and future-dated approved scopes refuse at command time; revocation refuses supersession", async () => {
    const w = await trustFixture();
    await grantMemberships(w);
    // Expired scope (approved, valid_until in the past).
    await w.db.exec(`INSERT INTO issuer_scopes(id,issuer_id,record_kind,status,scope_version,valid_from,valid_until,evidence_note,approved_by_user_id)
      VALUES('scope-exp','${w.issuerId}','horse_identity','approved',1,'2019-01-01 00:00:00','2020-01-01 00:00:00','Expired accreditation','admin');
      INSERT INTO issuer_scope_actions(scope_id,action) VALUES('scope-exp','attest'),('scope-exp','supersede')`);
    expect((await worker.fetch(authedRequest(`/api/issuers/${w.issuerId}/attestations`, { record_kind: "horse_identity", record_id: "1" }, { session: w.attester }), env(w.db))).status).toBe(403);
    expect(await countRows(w.db, "attestations")).toBe(0);
    // Future-dated scope (effective interval has not started).
    await w.db.exec(`UPDATE issuer_scopes SET valid_from=datetime('now','+30 days'),valid_until=NULL WHERE id='scope-exp'`);
    expect((await worker.fetch(authedRequest(`/api/issuers/${w.issuerId}/attestations`, { record_kind: "horse_identity", record_id: "1" }, { session: w.attester }), env(w.db))).status).toBe(403);
    // A scope with attest but WITHOUT supersede: issuance works, supersession is refused.
    expect((await grantScope(w, "horse_identity", ["attest"], { valid_until: "2030-01-01" })).status).toBe(201);
    const issued = await worker.fetch(authedRequest(`/api/issuers/${w.issuerId}/attestations`, { record_kind: "horse_identity", record_id: "1" }, { session: w.attester }), env(w.db));
    expect(issued.status).toBe(201);
    const attestationId = ((await body(issued)) as { attestation: { id: string } }).attestation.id;
    const supersession = await worker.fetch(authedRequest(`/api/attestations/${attestationId}/supersede`, { reason: "Attempted supersession without the supersede action", replacement: { record_kind: "horse_identity", record_id: "1" } }, { session: w.owner }), env(w.db));
    expect(supersession.status).toBe(409);
    expect(await countRows(w.db, "attestations", "status='active'")).toBe(1);
    // Revoking the scope takes effect on commands immediately.
    const scopeRow = await w.db.prepare("SELECT id FROM issuer_scopes WHERE status='approved'").first<{ id: string }>();
    expect((await worker.fetch(authedRequest(`/api/issuer-scopes/${scopeRow!.id}/revoke`, { reason: "Accreditation withdrawn by the authority" }, { session: w.admin }), env(w.db))).status).toBe(200);
    expect((await worker.fetch(authedRequest(`/api/issuers/${w.issuerId}/attestations`, { record_kind: "horse_identity", record_id: "1" }, { session: w.attester }), env(w.db))).status).toBe(403);
    expect(await countRows(w.db, "attestations")).toBe(1);
  });

  it("paid subscriptions and generic staff roles cannot create an official attestation", async () => {
    const w = await trustFixture();
    // A genuinely paid entitlement (real ledger rows) must not convey issuer authority.
    await w.db.exec(`INSERT INTO orders(id,order_key,buyer_user_id,status,total_minor,currency,price_snapshot_json)
        VALUES(1,'paid-order-1','paid','paid',1000000,'IRR','[]');
      INSERT INTO payment_attempts(id,order_id,provider,authority,amount_minor,state,verified_at)
        VALUES(1,1,'zarinpal','paid-auth-1',1000000,'verified','2026-01-01 00:00:00');
      INSERT INTO entitlement_events(id,event_key,order_id,payment_attempt_id,buyer_user_id,sku,kind,granted_days,activated_at,expires_at)
        VALUES(1,'paid-evt-1',1,1,'paid','farm-stable-annual','grant',365,'2026-01-01 00:00:00','2027-01-01 00:00:00');
      INSERT INTO entitlements(id,buyer_user_id,sku,source_event_id,active,activated_at,expires_at)
        VALUES(1,'paid','farm-stable-annual',1,1,'2026-01-01 00:00:00','2027-01-01 00:00:00')`);
    await grantMemberships(w);
    expect((await grantScope(w, "horse_identity", ["attest"])).status).toBe(201);
    // Paid account WITHOUT membership.
    const paidAttempt = await worker.fetch(authedRequest(`/api/issuers/${w.issuerId}/attestations`, { record_kind: "horse_identity", record_id: "1" }, { session: w.paid }), env(w.db));
    expect(paidAttempt.status).toBe(403);
    expect(((await body(paidAttempt)) as { error: { code: string } }).error.code).toBe("no_membership");
    // Generic staff (admin) without membership.
    const staffAttempt = await worker.fetch(authedRequest(`/api/issuers/${w.issuerId}/attestations`, { record_kind: "horse_identity", record_id: "1" }, { session: w.admin }), env(w.db));
    expect(staffAttempt.status).toBe(403);
    expect(await countRows(w.db, "attestations")).toBe(0);
  });

  it("issuer suspension takes effect on commands and the public projection without deleting history", async () => {
    const w = await trustFixture();
    await grantMemberships(w);
    expect((await grantScope(w, "horse_identity", ["attest", "supersede"])).status).toBe(201);
    const issued = await worker.fetch(authedRequest(`/api/issuers/${w.issuerId}/attestations`, { record_kind: "horse_identity", record_id: "1" }, { session: w.attester }), env(w.db));
    expect(issued.status).toBe(201);
    const attestationId = ((await body(issued)) as { attestation: { id: string } }).attestation.id;
    // Suspend the issuer.
    expect((await worker.fetch(authedRequest(`/api/admin/issuers/${w.issuerId}/status`, { status: "suspended", reason: "Authority dispute under review" }, { session: w.admin }), env(w.db))).status).toBe(200);
    // Commands: issuance and supersession are refused while suspended.
    expect((await worker.fetch(authedRequest(`/api/issuers/${w.issuerId}/attestations`, { record_kind: "horse_identity", record_id: "1" }, { session: w.attester }), env(w.db))).status).toBe(403);
    expect((await worker.fetch(authedRequest(`/api/attestations/${attestationId}/supersede`, { reason: "Attempt while suspended", replacement: { record_kind: "horse_identity", record_id: "1" } }, { session: w.owner }), env(w.db))).status).toBe(403);
    // Public projection names the suspension; history is intact.
    const publicList = await worker.fetch(authedRequest("/api/horses/1/attestations", undefined), env(w.db));
    expect(publicList.status).toBe(200);
    const listBody = (await body(publicList)) as { attestations: Array<{ effective_status: string; status: string }> };
    expect(listBody.attestations[0]!.status).toBe("active");
    expect(listBody.attestations[0]!.effective_status).toBe("issuer_suspended");
    expect(await countRows(w.db, "attestations")).toBe(1);
    expect(await countRows(w.db, "attestation_events")).toBe(1);
    const verify = await worker.fetch(authedRequest(`/api/attestations/${attestationId}/verify`, undefined), env(w.db));
    expect(((await body(verify)) as { verification_state: string }).verification_state).toBe("issuer_suspended");
    // Suspension of an already-suspended issuer is an honest conflict; resume restores commands.
    expect((await worker.fetch(authedRequest(`/api/admin/issuers/${w.issuerId}/status`, { status: "suspended", reason: "Double suspension" }, { session: w.admin }), env(w.db))).status).toBe(409);
    expect((await worker.fetch(authedRequest(`/api/admin/issuers/${w.issuerId}/status`, { status: "active", reason: "Dispute resolved in the issuer's favor" }, { session: w.admin }), env(w.db))).status).toBe(200);
    const reissued = await worker.fetch(authedRequest(`/api/issuers/${w.issuerId}/attestations`, { record_kind: "horse_identity", record_id: "1" }, { session: w.attester }), env(w.db));
    expect(reissued.status).toBe(201);
  });

  it("scope approval is versioned, evidence-gated, platform-only and audited", async () => {
    const w = await trustFixture();
    await grantMemberships(w);
    // The issuer's own owner cannot approve authority (no self-approval).
    const ownerAttempt = await worker.fetch(authedRequest(`/api/admin/issuers/${w.issuerId}/scopes`, { record_kind: "horse_identity", actions: ["attest"], evidence_note: "Owner attempting to approve their own authority" }, { session: w.owner }), env(w.db));
    expect(ownerAttempt.status).toBe(403);
    expect(await countRows(w.db, "issuer_scopes")).toBe(0);
    // Editor (no content.manage) cannot approve scopes either.
    expect((await worker.fetch(authedRequest(`/api/admin/issuers/${w.issuerId}/scopes`, { record_kind: "horse_identity", actions: ["attest"], evidence_note: "Editorial attempt at authority approval" }, { session: w.editor }), env(w.db))).status).toBe(403);
    // A legacy issuer without recorded registration evidence is refused.
    await w.db.exec("INSERT INTO issuers(id,slug,name,status) VALUES('11111111-1111-1111-1111-111111111111','legacy-body','Legacy Body','active')");
    const legacy = await worker.fetch(authedRequest("/api/admin/issuers/11111111-1111-1111-1111-111111111111/scopes", { record_kind: "horse_identity", actions: ["attest"], evidence_note: "Attempt without recorded evidence" }, { session: w.admin }), env(w.db));
    expect(legacy.status).toBe(422);
    expect(((await body(legacy)) as { error: { code: string } }).error.code).toBe("issuer_evidence_required");
    // Versioned approval: v1 is superseded by v2 without deleting history.
    const v1 = await grantScope(w, "horse_identity", ["attest"]);
    expect(v1.status).toBe(201);
    const v1Id = ((await body(v1)) as { scope_id: string }).scope_id;
    const v2 = await grantScope(w, "horse_identity", ["attest", "supersede"], { valid_until: "2031-01-01" });
    expect(v2.status).toBe(201);
    const versions = await w.db.prepare("SELECT id,scope_version,status FROM issuer_scopes ORDER BY scope_version").all<{ id: string; scope_version: number; status: string }>();
    expect(versions.results).toHaveLength(2);
    expect(versions.results[0]).toMatchObject({ id: v1Id, scope_version: 1, status: "superseded" });
    expect(versions.results[1]).toMatchObject({ scope_version: 2, status: "approved" });
    expect(await countRows(w.db, "audit_events", "action='issuer.scope.granted'")).toBe(2);
    // Suspension keeps visible history while blocking the kind.
    const v2Id = versions.results[1]!.id;
    expect((await worker.fetch(authedRequest(`/api/issuer-scopes/${v2Id}/suspend`, { reason: "Rechecking accreditation coverage" }, { session: w.admin }), env(w.db))).status).toBe(200);
    expect((await worker.fetch(authedRequest(`/api/issuers/${w.issuerId}/attestations`, { record_kind: "horse_identity", record_id: "1" }, { session: w.attester }), env(w.db))).status).toBe(403);
    expect((await w.db.prepare("SELECT status FROM issuer_scopes WHERE id=?").bind(v2Id).first<{ status: string }>())?.status).toBe("suspended");
    expect((await worker.fetch(authedRequest(`/api/issuer-scopes/${v2Id}/resume`, { reason: "Accreditation reconfirmed" }, { session: w.admin }), env(w.db))).status).toBe(200);
    expect((await worker.fetch(authedRequest(`/api/issuers/${w.issuerId}/attestations`, { record_kind: "horse_identity", record_id: "1" }, { session: w.attester }), env(w.db))).status).toBe(201);
    // New issuer registration REQUIRES documentary evidence.
    expect((await worker.fetch(authedRequest("/api/admin/issuers", { slug: "evidence-less", name: "Evidence Less", kind: "clinic" }, { session: w.admin }), env(w.db))).status).toBe(400);
  });

  it("the operator queue surfaces trust operations without private evidence; trust labels are public", async () => {
    const w = await trustFixture();
    await grantMemberships(w);
    expect((await grantScope(w, "horse_identity", ["attest"], { valid_until: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10) })).status).toBe(201);
    await w.db.exec(`INSERT INTO issuers(id,slug,name,status) VALUES('11111111-1111-1111-1111-111111111111','legacy-body','Legacy Body','active');
      INSERT INTO issuers(id,slug,name,status) VALUES('22222222-2222-2222-2222-222222222222','susp-body','Suspended Body','suspended')`);
    // Editor cannot read the operator queue.
    expect((await worker.fetch(authedRequest("/api/admin/trust/queue", undefined, { session: w.editor }), env(w.db))).status).toBe(403);
    const queue = await worker.fetch(authedRequest("/api/admin/trust/queue", undefined, { session: w.admin }), env(w.db));
    expect(queue.status).toBe(200);
    const queueBody = (await body(queue)) as { items: Array<{ reason_code: string }> };
    const reasons = new Set(queueBody.items.map((item) => item.reason_code));
    expect(reasons.has("issuer_registration_evidence_missing")).toBe(true);
    expect(reasons.has("issuer_suspended")).toBe(true);
    // The expiring scope/membership windows are surfaced with their dates.
    expect(reasons.has("scope_expiring") || reasons.has("membership_expiring")).toBe(true);
    // Queue output carries no private evidence text.
    const queueText = JSON.stringify(queueBody);
    expect(queueText).not.toContain(EVIDENCE);
    // Trust labels are PUBLIC (no session) and explain the distinct concepts.
    const labels = await worker.fetch(authedRequest("/api/trust/labels", undefined), env(w.db));
    expect(labels.status).toBe(200);
    const labelsBody = (await body(labels)) as { verification_levels: Record<string, { en: string }>; issuer_authority: { en: string }; documents: { registry_extract: string } };
    expect(Object.keys(labelsBody.verification_levels)).toEqual(["owner_declared", "imported_unverified", "platform_reviewed", "issuer_attested"]);
    expect(labelsBody.issuer_authority.en).toContain("does not certify every field");
    expect(labelsBody.documents.registry_extract).toContain("not an official certificate");
  });
});

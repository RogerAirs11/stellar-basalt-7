import { describe, expect, it } from "vitest";
import workerDefault from "../../src/worker";
import { openRealDatabase, seedUser, makeSession, authedRequest, countRows } from "../helpers/realDatabase";
import { PROVINCE_CODE_SCHEME } from "../../src/directory/vocabulary";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * R98-N01 (agent extension of the included r98-directory-trust-http suite):
 * real router, real sessions/CSRF, fully migrated database. Negative-permission
 * and lifecycle coverage for claims, issuer grants/revocations, attestation
 * supersession/revocation, retention holds, and consent withdrawal.
 *
 * No capability here may be weakened to make a screen succeed: every losing
 * mutation must leave zero grants, zero success audits and zero disclosures.
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

async function fixture() {
  const db = await openRealDatabase();
  for (const [id, role] of [["owner", "user"], ["other", "user"], ["editor", "editor"], ["admin", "admin"], ["attester", "user"], ["expired", "user"]]) await seedUser(db, id!, role!);
  await db.exec("INSERT INTO people(id,name_latin) VALUES(1,'Synthetic professional'); INSERT INTO user_person_links(user_id,person_id,status) VALUES('owner',1,'verified')");
  return { db, owner: await makeSession(db, "owner"), other: await makeSession(db, "other"), editor: await makeSession(db, "editor"), admin: await makeSession(db, "admin"), attester: await makeSession(db, "attester"), expiredUser: await makeSession(db, "expired") };
}

const profile = { service_categories: ["farrier"], province_code: "IR-23", province_code_scheme: PROVINCE_CODE_SCHEME,
  contact_value: "private@example.test", publication_consent: false, expected_version: 0 };

describe("R98-N01 claims over HTTP (winning operations only)", () => {
  it("double submission leaves exactly ONE pending claim; approval verifies the link; editor cannot review", async () => {
    const w = await fixture();
    const first = await worker.fetch(authedRequest("/api/directory/claims", { claim_type: "person", person_id: 1, evidence_note: "National ID card scan attached" }, { session: w.other }), env(w.db));
    expect(first.status).toBe(201);
    // Double-click: the duplicate-pending predicate refuses the second create.
    const duplicate = await worker.fetch(authedRequest("/api/directory/claims", { claim_type: "person", person_id: 1, evidence_note: "National ID card scan attached" }, { session: w.other }), env(w.db));
    expect(duplicate.status).toBe(409);
    expect((await body(duplicate)).error).toMatchObject({ code: "claim_conflict" });
    expect(await countRows(w.db, "directory_claims")).toBe(1);
    // An editor lacks claim.review (admin/super_admin only).
    const claimId = ((await body(first)) as { claim: { id: number } }).claim.id;
    expect((await worker.fetch(authedRequest(`/api/admin/directory/claims/${claimId}/review`, { decision: "approved", review_note: "Editorial approval attempt" }, { session: w.editor }), env(w.db))).status).toBe(403);
    expect(await countRows(w.db, "user_person_links", "user_id='other'")).toBe(0);
    // Admin approval verifies the link in the same winning batch.
    const approved = await worker.fetch(authedRequest(`/api/admin/directory/claims/${claimId}/review`, { decision: "approved", review_note: "ID matches the federation registry" }, { session: w.admin }), env(w.db));
    expect(approved.status).toBe(200);
    expect(await countRows(w.db, "user_person_links", "user_id='other' AND person_id=1 AND status='verified'")).toBe(1);
    expect(await countRows(w.db, "audit_events", "action='directory.claim.approved'")).toBe(1);
    // A stale re-review is a 409 with no second grant or audit.
    expect((await worker.fetch(authedRequest(`/api/admin/directory/claims/${claimId}/review`, { decision: "rejected", review_note: "Changing my mind" }, { session: w.admin }), env(w.db))).status).toBe(409);
    expect(await countRows(w.db, "audit_events", "action='directory.claim.rejected'")).toBe(0);
  });

  it("a claim against a deleted person is refused (target integrity)", async () => {
    const w = await fixture();
    await w.db.exec("INSERT INTO people(id,name_latin,deleted_at) VALUES(2,'Deleted person','2026-01-01 00:00:00')");
    const response = await worker.fetch(authedRequest("/api/directory/claims", { claim_type: "person", person_id: 2, evidence_note: "Claim against a deleted person" }, { session: w.other }), env(w.db));
    expect(response.status).toBe(404);
    expect(await countRows(w.db, "directory_claims")).toBe(0);
  });
});

describe("R98-N01 issuer membership lifecycle over HTTP", () => {
  async function issuerWorld() {
    const w = await fixture();
    const created = await worker.fetch(authedRequest("/api/admin/issuers", { slug: "synthetic-lab", name: "Synthetic Laboratory", kind: "laboratory", registration_evidence: "Laboratory accreditation certificate IR-LAB-2026-041 reviewed and archived by platform staff" }, { session: w.admin }), env(w.db));
    expect(created.status).toBe(201);
    const issuerId = ((await body(created)) as { issuer: { id: string } }).issuer.id;
    return { ...w, issuerId };
  }
  async function grantGeneticScope(w: { db: D1Database; issuerId: string; admin: { userId: string; role: string; cookie: string; csrfToken: string } }, actions: string[] = ["attest", "supersede"]) {
    const granted = await worker.fetch(authedRequest(`/api/admin/issuers/${w.issuerId}/scopes`, { record_kind: "genetic_test", actions, evidence_note: "Accreditation covers genetic test result attestations" }, { session: w.admin }), env(w.db));
    expect(granted.status).toBe(201);
    return granted;
  }

  it("platform staff without membership cannot create attestations; grants and revocations gate issuance at command time", async () => {
    const w = await issuerWorld();
    await w.db.exec("INSERT INTO horses(id,name_latin) VALUES(1,'Synthetic Horse'); INSERT INTO genetic_tests(id,horse_id,test_type,result) VALUES(1,1,'disease','clear')");
    // An admin WITHOUT an issuer membership cannot attest (staff cannot impersonate an outside issuer).
    const staffAttempt = await worker.fetch(authedRequest(`/api/issuers/${w.issuerId}/attestations`, { record_kind: "genetic_test", record_id: "1" }, { session: w.admin }), env(w.db));
    expect(staffAttempt.status).toBe(403);
    expect(await countRows(w.db, "attestations")).toBe(0);
    // Admin grants an owner membership to the owner user, then an attester membership to the attester user.
    expect((await worker.fetch(authedRequest(`/api/admin/issuers/${w.issuerId}/memberships`, { user_id: "owner", role: "owner" }, { session: w.admin }), env(w.db))).status).toBe(201);
    expect((await worker.fetch(authedRequest(`/api/admin/issuers/${w.issuerId}/memberships`, { user_id: "attester", role: "attester" }, { session: w.owner }), env(w.db))).status).toBe(201);
    expect(await countRows(w.db, "issuer_memberships", "status='active'")).toBe(2);
    expect(await countRows(w.db, "issuer_management_operations", "action='grant'")).toBe(2);
    // R98-N04: issuance additionally requires an approved structured scope.
    await grantGeneticScope(w);
    // The attester issues a valid attestation.
    const issued = await worker.fetch(authedRequest(`/api/issuers/${w.issuerId}/attestations`, { record_kind: "genetic_test", record_id: "1", statement: "Reviewed lab result within scope" }, { session: w.attester }), env(w.db));
    expect(issued.status).toBe(201);
    const attestationId = ((await body(issued)) as { attestation: { id: string } }).attestation.id;
    // Revoking the attester membership: issuance must be refused afterwards.
    const memberships = await w.db.prepare("SELECT id,user_id FROM issuer_memberships WHERE user_id='attester' AND status='active'").all<{ id: string; user_id: string }>();
    const membershipId = memberships.results[0]!.id;
    expect((await worker.fetch(authedRequest(`/api/issuer-memberships/${membershipId}/revoke`, { reason: "Left the laboratory" }, { session: w.owner }), env(w.db))).status).toBe(200);
    const afterRevoke = await worker.fetch(authedRequest(`/api/issuers/${w.issuerId}/attestations`, { record_kind: "genetic_test", record_id: "1" }, { session: w.attester }), env(w.db));
    expect(afterRevoke.status).toBe(403);
    expect(await countRows(w.db, "attestations")).toBe(1);
    // Revoking the same membership twice is a no-op conflict (no second audit).
    expect((await worker.fetch(authedRequest(`/api/issuer-memberships/${membershipId}/revoke`, { reason: "Revoking twice by mistake" }, { session: w.owner }), env(w.db))).status).toBe(409);
    expect(await countRows(w.db, "issuer_management_operations", "action='revoke'")).toBe(1);
    void attestationId;
  });

  it("an expired membership never authorizes issuance (validity intervals are enforced)", async () => {
    const w = await issuerWorld();
    await w.db.exec("INSERT INTO horses(id,name_latin) VALUES(1,'Synthetic Horse'); INSERT INTO genetic_tests(id,horse_id,test_type,result) VALUES(1,1,'disease','carrier')");
    await worker.fetch(authedRequest(`/api/admin/issuers/${w.issuerId}/memberships`, { user_id: "expired", role: "attester", valid_until: "2020-01-01T00:00:00Z" }, { session: w.admin }), env(w.db));
    const attempt = await worker.fetch(authedRequest(`/api/issuers/${w.issuerId}/attestations`, { record_kind: "genetic_test", record_id: "1" }, { session: w.expiredUser }), env(w.db));
    expect(attempt.status).toBe(403);
    expect(await countRows(w.db, "attestations")).toBe(0);
  });
});

describe("R98-N01 attestation supersession and public privacy over HTTP", () => {
  async function attestedWorld() {
    const w = await fixture();
    const created = await worker.fetch(authedRequest("/api/admin/issuers", { slug: "synthetic-fed", name: "Synthetic Federation", kind: "federation", registration_evidence: "Federation charter excerpt and board letter archived as evidence by platform staff" }, { session: w.admin }), env(w.db));
    const issuerId = ((await body(created)) as { issuer: { id: string } }).issuer.id;
    await w.db.exec(`INSERT INTO horses(id,name_latin) VALUES(1,'Synthetic Horse'); INSERT INTO genetic_tests(id,horse_id,test_type,result) VALUES(1,1,'parentage','confirmed')`);
    await worker.fetch(authedRequest(`/api/admin/issuers/${issuerId}/memberships`, { user_id: "owner", role: "owner" }, { session: w.admin }), env(w.db));
    await worker.fetch(authedRequest(`/api/admin/issuers/${issuerId}/memberships`, { user_id: "attester", role: "attester" }, { session: w.owner }), env(w.db));
    expect((await worker.fetch(authedRequest(`/api/admin/issuers/${issuerId}/scopes`, { record_kind: "genetic_test", actions: ["attest", "supersede"], evidence_note: "Parentage verification authority covers genetic test attestations" }, { session: w.admin }), env(w.db))).status).toBe(201);
    const issued = await worker.fetch(authedRequest(`/api/issuers/${issuerId}/attestations`, { record_kind: "genetic_test", record_id: "1", statement: "PRIVATE free-text statement that must never be public", field_scope: ["result"], source_version: "synthetic-v1" }, { session: w.attester }), env(w.db));
    const attestationId = ((await body(issued)) as { attestation: { id: string } }).attestation.id;
    return { ...w, issuerId, attestationId };
  }

  it("supersession flips the old record and the public projection omits private payloads", async () => {
    const w = await attestedWorld();
    const superseded = await worker.fetch(authedRequest(`/api/attestations/${w.attestationId}/supersede`, { reason: "Corrected scope after lab re-read", replacement: { record_kind: "genetic_test", record_id: "1", statement: "PRIVATE corrected statement", field_scope: ["result", "tested_at"], source_version: "synthetic-v2" } }, { session: w.owner }), env(w.db));
    expect(superseded.status).toBe(200);
    expect(await countRows(w.db, "attestations", "status='superseded'")).toBe(1);
    expect(await countRows(w.db, "attestations", "status='active'")).toBe(1);
    // The public horse attestation list exposes neither the free-text statement
    // nor the field scope nor the source version.
    const publicList = await worker.fetch(authedRequest("/api/horses/1/attestations", undefined), env(w.db));
    expect(publicList.status).toBe(200);
    const text = await publicList.text();
    expect(text).not.toContain("PRIVATE");
    expect(text).not.toContain("synthetic-v1");
    // Revocation projects honestly and keeps history.
    const activeId = await w.db.prepare("SELECT id FROM attestations WHERE status='active'").first<{ id: string }>();
    expect((await worker.fetch(authedRequest(`/api/attestations/${activeId!.id}/revoke`, { reason: "Withdrawn by the federation" }, { session: w.owner }), env(w.db))).status).toBe(200);
    expect(await countRows(w.db, "attestations", "status='revoked'")).toBe(1);
    expect(await countRows(w.db, "attestations", "status='active'")).toBe(0);
  });
});

describe("R98-N01 retention holds and consent withdrawal over HTTP", () => {
  async function requestWorld() {
    const w = await fixture();
    await w.db.exec(`
      INSERT INTO people(id,name_latin) VALUES (41,'Farrier Person');
      INSERT INTO directory_profiles(person_id,service_categories,publication_consent,contact_preference,contact_value)
        VALUES (41,'["farrier"]',1,'email','provider@example.test');
      INSERT INTO user_person_links(user_id,person_id,status,verified_at) VALUES ('owner',41,'verified','2026-01-01 00:00:00');
    `);
    const created = await worker.fetch(authedRequest("/api/service-requests", { provider_person_id: 41, category: "farrier", note: "Looking for a farrier near Arak this month.", share_contact: true, province_code: "IR-08", province_code_scheme: PROVINCE_CODE_SCHEME }, { session: w.other, headers: { "idempotency-key": "r98n01-hold-1" } }), env(w.db));
    expect(created.status).toBe(201);
    const id = ((await body(created)) as { request: { id: number } }).request.id;
    return { ...w, requestId: id };
  }

  it("hold placement is single and audited; duplicate and double-release are honest conflicts", async () => {
    const w = await requestWorld();
    const place = await worker.fetch(authedRequest(`/api/admin/service-requests/${w.requestId}/hold`, { hold_kind: "legal_hold", reason: "Preservation order received for the dispute" }, { session: w.admin }), env(w.db));
    expect(place.status).toBe(201);
    expect(await countRows(w.db, "service_request_holds", "released_at IS NULL")).toBe(1);
    // Duplicate hold -> 409, no second row.
    expect((await worker.fetch(authedRequest(`/api/admin/service-requests/${w.requestId}/hold`, { hold_kind: "dispute", reason: "Second hold attempt on the same request" }, { session: w.admin }), env(w.db))).status).toBe(409);
    expect(await countRows(w.db, "service_request_holds")).toBe(1);
    // Release, then a second release is a conflict (no fabricated audit).
    expect((await worker.fetch(authedRequest(`/api/admin/service-requests/${w.requestId}/hold/release`, { release_reason: "Preservation order lifted by the court" }, { session: w.admin }), env(w.db))).status).toBe(200);
    expect((await worker.fetch(authedRequest(`/api/admin/service-requests/${w.requestId}/hold/release`, { release_reason: "Accidental double release attempt" }, { session: w.admin }), env(w.db))).status).toBe(409);
    expect(await countRows(w.db, "service_request_holds", "released_at IS NOT NULL")).toBe(1);
    // Editors cannot place holds (admin minimum).
    const w2 = await requestWorld();
    expect((await worker.fetch(authedRequest(`/api/admin/service-requests/${w2.requestId}/hold`, { hold_kind: "dispute", reason: "Editor attempting an admin operation" }, { session: w2.editor }), env(w2.db))).status).toBe(403);
    expect(await countRows(w2.db, "service_request_holds")).toBe(0);
  });

  it("consent withdrawal unpublishes the profile immediately (public 404, private data retained for the representative)", async () => {
    const w = await fixture();
    const url = "/api/directory/persons/1/profile";
    expect((await worker.fetch(authedRequest(url, { ...profile, publication_consent: true }, { session: w.owner, method: "PUT" }), env(w.db))).status).toBe(200);
    expect((await worker.fetch(authedRequest("/api/directory/persons/1", undefined), env(w.db))).status).toBe(200);
    const withdrawn = await worker.fetch(authedRequest(url, { ...profile, publication_consent: false, expected_version: 1 }, { session: w.owner, method: "PUT" }), env(w.db));
    expect(withdrawn.status).toBe(200);
    expect((await worker.fetch(authedRequest("/api/directory/persons/1", undefined), env(w.db))).status).toBe(404);
    // The representative still sees the private contact through the managed view.
    const managed = await worker.fetch(authedRequest(url, undefined, { session: w.owner }), env(w.db));
    expect(managed.status).toBe(200);
    expect(((await body(managed)) as { profile: { contact_value: string } }).profile.contact_value).toBe("private@example.test");
    // Anonymous access to the managed profile is authentication-required.
    expect((await worker.fetch(new Request("https://registry.example" + url), env(w.db))).status).toBe(401);
  });
});

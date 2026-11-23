import { describe, expect, it } from "vitest";
import workerDefault from "../../src/worker";
import { openRealDatabase, seedUser, makeSession, authedRequest, countRows } from "../helpers/realDatabase";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * R98-N05 acceptance: attestations bound to immutable server-derived evidence
 * snapshots.
 *
 * Acceptance under test:
 *  - Changing the horse, evidence file or publication state cannot silently
 *    change a previously issued document (the snapshot is preserved; public
 *    verification reports source_changed against the ORIGINAL digest).
 *  - A caller cannot attach a made-up source_version to an unrelated record
 *    (the input is accepted for compatibility and ignored; the stored marker
 *    is always server-derived from the snapshot).
 *  - Concurrent source changes either produce an exact valid snapshot or a
 *    conflict — reproduced with a real interleaving hook (a trigger on the
 *    issuer parent-row lock statement mutating the target mid-batch).
 *  - Private fields never appear in public verification metadata.
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

async function snapshotFixture() {
  const db = await openRealDatabase();
  for (const [id, role] of [["owner", "user"], ["attester", "user"], ["other", "user"], ["admin", "admin"]]) await seedUser(db, id!, role!);
  await db.exec(`INSERT INTO horses(id,name_latin,name_native,birth_year,color_desc,breed_desc) VALUES(1,'Original Name','نام اصلی',2018,'bay','Arabian');
    INSERT INTO genetic_tests(id,horse_id,test_type,test_category,result,verified,provenance) VALUES(1,1,'SCID','disease','N/N',1,'user');
    INSERT INTO horse_media(id,horse_id,media_type,role,file_name,mime_type,size_bytes,uploaded_by_user_id,consent_state,verification)
      VALUES('media-1',1,'document','certificate','lab-report.pdf','application/pdf',2048,'other','private','pending')`);
  const admin = await makeSession(db, "admin");
  const created = await worker.fetch(authedRequest("/api/admin/issuers", { slug: "snapshot-lab", name: "Snapshot Laboratory", kind: "laboratory", registration_evidence: "Accreditation certificate archived and reviewed by platform staff" }, { session: admin }), env(db));
  expect(created.status).toBe(201);
  const issuerId = ((await body(created)) as { issuer: { id: string } }).issuer.id;
  await worker.fetch(authedRequest(`/api/admin/issuers/${issuerId}/memberships`, { user_id: "owner", role: "owner" }, { session: admin }), env(db));
  await worker.fetch(authedRequest(`/api/admin/issuers/${issuerId}/memberships`, { user_id: "attester", role: "attester" }, { session: await makeSession(db, "owner") }), env(db));
  for (const kind of ["horse_identity", "genetic_test", "media"]) {
    const granted = await worker.fetch(authedRequest(`/api/admin/issuers/${issuerId}/scopes`, { record_kind: kind, actions: ["attest", "supersede"], evidence_note: "Scope covers this record kind under the archived accreditation" }, { session: admin }), env(db));
    expect(granted.status).toBe(201);
  }
  return { db, issuerId, owner: await makeSession(db, "owner"), attester: await makeSession(db, "attester"), other: await makeSession(db, "other"), admin };
}

async function issue(w: Awaited<ReturnType<typeof snapshotFixture>>, payload: Record<string, unknown>) {
  return worker.fetch(authedRequest(`/api/issuers/${w.issuerId}/attestations`, payload, { session: w.attester }), env(w.db));
}

describe("R98-N05 immutable server-derived evidence snapshots", () => {
  it("rejects a genetic report's known submitter as issuer reviewer, including a commit-time attribution change", async () => {
    const w = await snapshotFixture();
    await w.db.exec("UPDATE genetic_tests SET created_by_user_id='attester' WHERE id=1");
    const own = await issue(w,{record_kind:"genetic_test",record_id:"1"});
    expect(own.status).toBe(403);expect((await body(own)).error).toMatchObject({code:"self_review_forbidden"});
    expect(await countRows(w.db,"attestations")).toBe(0);
    await w.db.exec("UPDATE genetic_tests SET created_by_user_id='other' WHERE id=1");
    await w.db.exec(`CREATE TEMP TRIGGER genetic_submitter_issuance_race AFTER UPDATE ON issuers
      BEGIN UPDATE genetic_tests SET created_by_user_id='attester' WHERE id=1; END`);
    expect((await issue(w,{record_kind:"genetic_test",record_id:"1"})).status).toBe(409);
    expect(await countRows(w.db,"attestations")).toBe(0);
    expect(await countRows(w.db,"attestation_snapshots")).toBe(0);
    expect(await countRows(w.db,"attestation_events")).toBe(0);
  });

  it("binds issuance to a snapshot in the same boundary and derives the version marker server-side", async () => {
    const w = await snapshotFixture();
    const issued = await issue(w, { record_kind: "horse_identity", record_id: "1", statement: "PRIVATE statement about identity", field_scope: ["name_latin"], source_version: "made-up-caller-version-9", evidence_media_id: "media-1" });
    expect(issued.status).toBe(201);
    const attestationId = ((await body(issued)) as { attestation: { id: string; source_version: string } }).attestation.id;
    // The caller-supplied version NEVER becomes the stored marker.
    const stored = await w.db.prepare("SELECT source_version FROM attestations WHERE id=?").bind(attestationId).first<{ source_version: string }>();
    expect(stored!.source_version).toMatch(/^snap:1:[0-9a-f]{16}$/);
    expect(stored!.source_version).not.toContain("made-up-caller-version-9");
    // Exactly one snapshot, digest-bound, private, carrying per-row versions.
    const snapshot = await w.db.prepare("SELECT schema_version,canonical_json,content_digest,source_row_versions,issuer_scope_snapshot,is_private FROM attestation_snapshots WHERE attestation_id=?").bind(attestationId)
      .first<{ schema_version: number; canonical_json: string; content_digest: string; source_row_versions: string; issuer_scope_snapshot: string; is_private: number }>();
    expect(snapshot).not.toBeNull();
    expect(snapshot!.schema_version).toBe(1);
    expect(snapshot!.is_private).toBe(1);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(snapshot!.canonical_json));
    const digestHex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(snapshot!.content_digest).toBe(digestHex);
    const rowVersions = JSON.parse(snapshot!.source_row_versions) as Record<string, string>;
    expect(rowVersions.horses).toMatch(/^[0-9a-f]{64}$/);
    expect(rowVersions.horse_media).toMatch(/^[0-9a-f]{64}$/);
    const scopeAuthority = JSON.parse(snapshot!.issuer_scope_snapshot) as { scope: { version: number; action: string } };
    expect(scopeAuthority.scope.action).toBe("attest");
    // The snapshot bytes are the frozen facts, not the caller's claims.
    const canonical = JSON.parse(snapshot!.canonical_json) as { record_kind: string; target: { name_latin: string }; evidence: { file_name: string } };
    expect(canonical.record_kind).toBe("horse_identity");
    expect(canonical.target.name_latin).toBe("Original Name");
    expect(canonical.evidence.file_name).toBe("lab-report.pdf");
    expect(await countRows(w.db, "attestation_events", "event='issued'")).toBe(1);
  });

  it("a source change after issuance never rewrites the issued document; verification reports the mismatch", async () => {
    const w = await snapshotFixture();
    const issued = await issue(w, { record_kind: "horse_identity", record_id: "1", evidence_media_id: "media-1" });
    expect(issued.status).toBe(201);
    const attestationId = ((await body(issued)) as { attestation: { id: string } }).attestation.id;
    const before = await w.db.prepare("SELECT canonical_json,content_digest FROM attestation_snapshots WHERE attestation_id=?").bind(attestationId)
      .first<{ canonical_json: string; content_digest: string }>();
    // Verification is CURRENT right after issuance (public, no session).
    const current = await worker.fetch(authedRequest(`/api/attestations/${attestationId}/verify`, undefined), env(w.db));
    expect(current.status).toBe(200);
    expect(((await body(current)) as { verification_state: string }).verification_state).toBe("current");
    // The horse record changes (rename + evidence file replaced).
    await w.db.exec("UPDATE horses SET name_latin='Renamed After Issuance',updated_at=CURRENT_TIMESTAMP WHERE id=1; UPDATE horse_media SET size_bytes=999,updated_at=CURRENT_TIMESTAMP WHERE id='media-1'");
    const changed = await worker.fetch(authedRequest(`/api/attestations/${attestationId}/verify`, undefined), env(w.db));
    const changedBody = (await body(changed)) as { verification_state: string; source_detail: { changed_tables: string[] }; snapshot: { content_digest: string; source_row_versions: Record<string, string> } };
    expect(changedBody.verification_state).toBe("source_changed");
    expect(changedBody.source_detail.changed_tables.sort()).toEqual(["horse_media", "horses"]);
    // The issued document itself is preserved EXACTLY: same digest, same bytes.
    const after = await w.db.prepare("SELECT canonical_json,content_digest FROM attestation_snapshots WHERE attestation_id=?").bind(attestationId)
      .first<{ canonical_json: string; content_digest: string }>();
    expect(after!.content_digest).toBe(before!.content_digest);
    expect(after!.canonical_json).toBe(before!.canonical_json);
    expect(changedBody.snapshot.content_digest).toBe(before!.content_digest);
    // Evidence REMOVAL is reported as a removal, not a silent mismatch.
    await w.db.exec("DELETE FROM horse_media WHERE id='media-1'");
    const removed = await worker.fetch(authedRequest(`/api/attestations/${attestationId}/verify`, undefined), env(w.db));
    const removedBody = (await body(removed)) as { source_detail: { removed_tables: string[] } };
    expect(removedBody.source_detail.removed_tables).toContain("horse_media");
  });

  it("a concurrent source change between read and commit refuses the whole issuance", async () => {
    const w = await snapshotFixture();
    // Real interleaving hook: the issuance batch's parent-row lock statement is
    // `UPDATE issuers SET status=status`; a trigger on it mutates the target
    // horse AFTER the snapshot read but BEFORE the guarded INSERT. The column
    // guard must refuse (0 rows) instead of certifying a mixture.
    await w.db.exec(`CREATE TEMP TRIGGER issuance_race_hook AFTER UPDATE ON issuers
      BEGIN UPDATE horses SET name_latin='Raced Mid-Flight',updated_at=CURRENT_TIMESTAMP WHERE id=1; END`);
    const attempted = await issue(w, { record_kind: "horse_identity", record_id: "1" });
    expect(attempted.status).toBe(409);
    expect(await countRows(w.db, "attestations")).toBe(0);
    expect(await countRows(w.db, "attestation_snapshots")).toBe(0);
    expect(await countRows(w.db, "attestation_events")).toBe(0);
    await w.db.exec("DROP TRIGGER issuance_race_hook");
    // With the interleaving gone, issuance succeeds against the NEW facts.
    const retried = await issue(w, { record_kind: "horse_identity", record_id: "1" });
    expect(retried.status).toBe(201);
    const snapshot = await w.db.prepare("SELECT canonical_json FROM attestation_snapshots").first<{ canonical_json: string }>();
    expect(snapshot!.canonical_json).toContain("Raced Mid-Flight");
  });

  it("verification distinguishes superseded, revoked, tampered and unbound legacy records", async () => {
    const w = await snapshotFixture();
    await w.db.exec("UPDATE genetic_tests SET public_disclosed=1 WHERE id=1");
    const issued = await issue(w, { record_kind: "genetic_test", record_id: "1" });
    expect(issued.status).toBe(201);
    const attestationId = ((await body(issued)) as { attestation: { id: string } }).attestation.id;
    // Supersession: old record flips to superseded; the replacement verifies current.
    const superseded = await worker.fetch(authedRequest(`/api/attestations/${attestationId}/supersede`, { reason: "Corrected after lab re-read", replacement: { record_kind: "genetic_test", record_id: "1" } }, { session: w.owner }), env(w.db));
    expect(superseded.status).toBe(200);
    const oldVerify = (await body(await worker.fetch(authedRequest(`/api/attestations/${attestationId}/verify`, undefined), env(w.db)))) as { verification_state: string };
    expect(oldVerify.verification_state).toBe("superseded");
    const replacementId = ((await body(superseded)) as { replacement: { id: string } }).replacement.id;
    const newVerify = (await body(await worker.fetch(authedRequest(`/api/attestations/${replacementId}/verify`, undefined), env(w.db)))) as { verification_state: string };
    expect(newVerify.verification_state).toBe("current");
    // Revocation is terminal and keeps history.
    expect((await worker.fetch(authedRequest(`/api/attestations/${replacementId}/revoke`, { reason: "Withdrawn by the laboratory" }, { session: w.owner }), env(w.db))).status).toBe(200);
    const revokedVerify = (await body(await worker.fetch(authedRequest(`/api/attestations/${replacementId}/verify`, undefined), env(w.db)))) as { verification_state: string };
    expect(revokedVerify.verification_state).toBe("revoked");
    // Tampered snapshot bytes are detected on an ACTIVE document, never
    // re-certified. (A terminal lifecycle state still takes priority, so this
    // uses a fresh live attestation.)
    const liveIssued = await issue(w, { record_kind: "genetic_test", record_id: "1" });
    expect(liveIssued.status).toBe(201);
    const liveId = ((await body(liveIssued)) as { attestation: { id: string } }).attestation.id;
    await w.db.prepare("UPDATE attestation_snapshots SET canonical_json=? WHERE attestation_id=?").bind('{"tampered":true}', liveId).run();
    const tamperedVerify = (await body(await worker.fetch(authedRequest(`/api/attestations/${liveId}/verify`, undefined), env(w.db)))) as { verification_state: string };
    expect(tamperedVerify.verification_state).toBe("snapshot_tampered");
    // A legacy pre-snapshot attestation is an unbound historical record.
    await w.db.exec(`INSERT INTO attestations(id,issuer_id,horse_id,record_kind,record_id,status,attested_by_user_id)
      VALUES('33333333-3333-3333-3333-333333333333','${w.issuerId}',1,'genetic_test','1','active','owner')`);
    const legacyVerify = (await body(await worker.fetch(authedRequest("/api/attestations/33333333-3333-3333-3333-333333333333/verify", undefined), env(w.db)))) as { verification_state: string };
    expect(legacyVerify.verification_state).toBe("unbound_legacy");
  });

  it("public verification never discloses private snapshot bytes or free text; review is authority-gated", async () => {
    const w = await snapshotFixture();
    const issued = await issue(w, { record_kind: "horse_identity", record_id: "1", statement: "PRIVATE free-text statement that must never leak", field_scope: ["name_latin"], evidence_media_id: "media-1" });
    expect(issued.status).toBe(201);
    const attestationId = ((await body(issued)) as { attestation: { id: string } }).attestation.id;
    const verify = await worker.fetch(authedRequest(`/api/attestations/${attestationId}/verify`, undefined), env(w.db));
    expect(verify.status).toBe(200);
    const verifyText = await verify.text();
    expect(verifyText).not.toContain("PRIVATE free-text statement");
    expect(verifyText).not.toContain("canonical_json");
    expect(verifyText).not.toContain("lab-report.pdf");
    const verifyBody = JSON.parse(verifyText) as { snapshot: { content_digest: string; is_private: boolean; source_row_versions: Record<string, string> } };
    expect(verifyBody.snapshot.is_private).toBe(true);
    expect(verifyBody.snapshot.source_row_versions.horse_media).toMatch(/^[0-9a-f]{64}$/);
    // The private full-snapshot review path: unrelated user 403, issuer owner 200.
    expect((await worker.fetch(authedRequest(`/api/admin/attestations/${attestationId}/snapshot`, undefined, { session: w.other }), env(w.db))).status).toBe(403);
    const reviewed = await worker.fetch(authedRequest(`/api/admin/attestations/${attestationId}/snapshot`, undefined, { session: w.owner }), env(w.db));
    expect(reviewed.status).toBe(200);
    const reviewBody = (await body(reviewed)) as { snapshot: { canonical_json: string } };
    expect(reviewBody.snapshot.canonical_json).toContain("lab-report.pdf");
    // Platform content managers may review too.
    expect((await worker.fetch(authedRequest(`/api/admin/attestations/${attestationId}/snapshot`, undefined, { session: w.admin }), env(w.db))).status).toBe(200);
  });
  it("genetic snapshot export requires current horse-scoped evidence authority, including for platform and issuer owners",async()=>{
    const w=await snapshotFixture();
    await w.db.exec("UPDATE genetic_tests SET lab_accession='PRIVATE-SNAPSHOT-ACCESSION',result_interpretation='PRIVATE-SNAPSHOT-INTERPRETATION' WHERE id=1");
    const issued=await issue(w,{record_kind:"genetic_test",record_id:"1"});expect(issued.status).toBe(201);
    const id=((await body(issued)) as {attestation:{id:string}}).attestation.id,path=`/api/admin/attestations/${id}/snapshot`;
    for(const session of [w.admin,w.owner,w.other]) expect((await worker.fetch(authedRequest(path,undefined,{session}),env(w.db))).status).toBe(403);
    await w.db.exec(`INSERT INTO professional_access_grants(id,horse_id,grantee_user_id,professional_kind,permissions,authority_ref,assignment_ref,basis,granted_by_user_id,valid_from)
      VALUES('snapshot-evidence',1,'other','veterinarian','genetic_evidence_read','SYNTHETIC-AUTHORITY','SYNTHETIC-REVIEW','admin_grant','admin','2020-01-01')`);
    const granted=await worker.fetch(authedRequest(path,undefined,{session:w.other}),env(w.db));expect(granted.status).toBe(200);
    const text=await granted.text();expect(text).toContain("PRIVATE-SNAPSHOT-ACCESSION");expect(text).toContain("PRIVATE-SNAPSHOT-INTERPRETATION");
    await w.db.exec("UPDATE professional_access_grants SET revoked_at=CURRENT_TIMESTAMP WHERE id='snapshot-evidence'");
    expect((await worker.fetch(authedRequest(path,undefined,{session:w.other}),env(w.db))).status).toBe(403);
  });

});

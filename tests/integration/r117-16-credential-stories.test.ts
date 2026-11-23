import { describe, expect, it } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import {
  createAttestation, revokeAttestation, supersedeAttestation,
  verifyAttestationHandler, attestationSnapshotHandler, listHorseAttestations,
} from "../../src/trust/attestations";
import { openRealDatabase, seedUser, makeSession, authedRequest, type AuthedSession } from "../helpers/realDatabase";
import { HttpError } from "../../src/api/http";

/** Direct handler calls throw HttpError (the route layer maps them to JSON
 * responses); tests assert on the same status/code the client would see. */
async function attempt(execute: () => Promise<Response>): Promise<{ status: number; body: Record<string, any> }> {
  try {
    const response = await execute();
    const body = await response.json().catch(() => ({})) as Record<string, any>;
    return { status: response.status, body };
  } catch (error) {
    if (error instanceof HttpError) return { status: error.status, body: { error: { code: error.code, message: error.message } } };
    throw error;
  }
}

/**
 * R117-16 evidence (Master AI R117 handoff D24) — truthful credential
 * demonstration stories on a REAL database with every migration applied.
 *
 * Acceptance pins (per the reviewed ticket):
 *  1. No demo badge implies real federation, ownership or laboratory
 *     approval: the fictional issuer carries explicit registration evidence
 *     and a NARROW approved scope; issuance outside the scope is refused
 *     403 issuer_scope_required — never silently widened.
 *  2. Revocation/expiry changes the VISIBLE current status without rewriting
 *     the recorded snapshot: the public digest is byte-identical before and
 *     after revoke/supersede/expiry transitions.
 *  3. Unauthorized evidence remains private: genetic snapshot bytes require
 *     current exact-horse evidence-read authority, independently of platform
 *     and issuer roles. Other snapshot kinds retain current manager/owner
 *     eligibility. Public rows/verification never carry private bytes.
 *  4. Two principals: the member attester issues; the issuer OWNER (a
 *     different principal) revokes/supersedes. Genetic snapshot reading needs
 *     its own explicit scoped permission, including for that issuer owner.
 */

type Env = { DB: D1Database; SESSION_COOKIE_NAME: string };
const envOf = (db: D1Database): Env => ({ DB: db, SESSION_COOKIE_NAME: "hr_session" });

const LAB = "i-r16-fictional-lab";
const SCOPE = "s-r16-genetic-scope";

interface World {
  db: D1Database; env: Env;
  attester: AuthedSession; owner: AuthedSession; stranger: AuthedSession; admin: AuthedSession;
}

async function world(): Promise<World> {
  const db = await openRealDatabase();
  await seedUser(db, "r16-attester", "user");
  await seedUser(db, "r16-owner", "user");
  await seedUser(db, "r16-stranger", "user");
  await seedUser(db, "r16-admin", "admin");
  await db.exec(`
    INSERT INTO horses(id,name_latin,name_native,is_active,deleted_at) VALUES (91,'R16 STAR','رستم',1,NULL);
    INSERT INTO genetic_tests(id,horse_id,test_type,test_category,result,verified,lab_name,provenance,public_disclosed,lab_accession,result_interpretation)
      VALUES (501,91,'CA','disease','N/CA',1,'FICTIONAL DEMO LAB - NO ACTUAL TEST','demo',1,
        'PRIVATE-FICTIONAL-ACCESSION','PRIVATE-FICTIONAL-INTERPRETATION');
    -- The explicitly fictional issuer with a NARROW scope: genetic tests only.
    INSERT INTO issuers(id,slug,name,name_native,kind,status,registration_evidence,registration_reviewed_at,registration_reviewed_by_user_id)
      VALUES ('${LAB}','r16-fictional-lab','R16 Fictional Laboratory','آزمایشگاه خیالی','laboratory','active',
              'SYNTHETIC DEMONSTRATION ONLY. Fictional laboratory; no accreditation, no real tests.','2026-01-01T00:00:00Z','r16-admin');
    INSERT INTO issuer_scopes(id,issuer_id,record_kind,status,scope_version,valid_from,evidence_note,approved_by_user_id,approved_at)
      VALUES ('${SCOPE}','${LAB}','genetic_test','approved',1,'2000-01-01T00:00:00Z','Fictional narrow scope evidence.','r16-admin','2026-01-01T00:00:00Z');
    INSERT INTO issuer_scope_actions(scope_id,action) VALUES ('${SCOPE}','attest'),('${SCOPE}','supersede');
    -- TWO principals: the attester issues; the OWNER (a different user) manages.
    INSERT INTO issuer_memberships(id,issuer_id,user_id,role,status,valid_from)
      VALUES ('m-r16-attester','${LAB}','r16-attester','attester','active','2000-01-01T00:00:00Z'),
             ('m-r16-owner','${LAB}','r16-owner','owner','active','2000-01-01T00:00:00Z');
  `);
  return {
    db, env: envOf(db),
    attester: await makeSession(db, "r16-attester"),
    owner: await makeSession(db, "r16-owner"),
    stranger: await makeSession(db, "r16-stranger"),
    admin: await makeSession(db, "r16-admin"),
  };
}

const issueBody = (overrides: Record<string, unknown> = {}) => ({
  record_kind: "genetic_test", record_id: "501", statement: "Fictional reviewed genotype statement; no actual laboratory test.",
  ...overrides,
});

async function issueOne(w: World, overrides: Record<string, unknown> = {}): Promise<{ id: string }> {
  const response = await createAttestation(authedRequest(`/api/issuers/${LAB}/attestations`, issueBody(overrides), { session: w.attester }), w.env, LAB);
  expect(response.status).toBe(201);
  const body = await response.json() as { attestation: { id: string } };
  return body.attestation;
}

async function verify(w: World, id: string): Promise<Record<string, any>> {
  const response = await verifyAttestationHandler(w.db, id);
  expect(response.status).toBe(200);
  return await response.json() as Record<string, any>;
}

describe("R117-16 truthful credential demonstration stories", () => {
  it("issues within the narrow approved scope and verifies CURRENT publicly", async () => {
    const w = await world();
    const { id } = await issueOne(w);
    const state = await verify(w, id);
    expect(state.verification_state).toBe("current");
    expect(state.effective_status).toBe("active");
    expect(state.issuer.slug).toBe("r16-fictional-lab");
    expect(state.snapshot?.content_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(state.snapshot?.is_private).toBe(true);
    // The public verification never carries the canonical bytes or statement.
    expect(JSON.stringify(state)).not.toContain("canonical_json");
  });

  it("refuses issuance OUTSIDE the issuer's narrow scope (media under a genetic-test issuer)", async () => {
    const w = await world();
    const { status, body } = await attempt(() => createAttestation(authedRequest(`/api/issuers/${LAB}/attestations`, issueBody({ record_kind: "media", record_id: "m-1" }), { session: w.attester }), w.env, LAB));
    expect(status).toBe(403);
    expect(String(body.error?.code)).toBe("issuer_scope_required");
  });

  it("refuses issuance without an active membership (stranger) and unauthenticated callers", async () => {
    const w = await world();
    const stranger = await attempt(() => createAttestation(authedRequest(`/api/issuers/${LAB}/attestations`, issueBody(), { session: w.stranger }), w.env, LAB));
    expect(stranger.status).toBe(403);
    const anonymous = await attempt(() => createAttestation(authedRequest(`/api/issuers/${LAB}/attestations`, issueBody(), { session: null }), w.env, LAB));
    expect(anonymous.status).toBe(401);
  });

  it("keeps the public horse projection metadata-only (statement/scope never public)", async () => {
    const w = await world();
    const { id } = await issueOne(w);
    const response = await listHorseAttestations(w.db, 91);
    expect(response.status).toBe(200);
    const body = await response.json() as { attestations: Array<Record<string, any>> };
    const row = body.attestations.find(item => item.id === id);
    expect(row).toBeDefined();
    expect(row!.statement).toBeNull();
    expect(row!.field_scope).toBeNull();
    expect(row!.scope_redacted).toBe(true);
    expect(String(row!.scope_note)).toContain("Public metadata only");
  });

  it("revocation changes the VISIBLE status while the snapshot digest stays identical (issuer OWNER, second principal)", async () => {
    const w = await world();
    const { id } = await issueOne(w);
    const before = await verify(w, id);
    const refused = await attempt(() => revokeAttestation(authedRequest(`/api/attestations/${id}/revoke`, { reason: "Fictional demo revocation" }, { session: w.attester }), w.env, id));
    expect(refused.status).toBe(403); // the ATTESTER cannot revoke — owner/content-manager only
    const response = await revokeAttestation(authedRequest(`/api/attestations/${id}/revoke`, { reason: "Fictional demo revocation" }, { session: w.owner }), w.env, id);
    expect(response.status).toBe(200);
    const after = await verify(w, id);
    expect(after.verification_state).toBe("revoked");
    expect(after.status).toBe("revoked");
    expect(after.snapshot?.content_digest).toBe(before.snapshot?.content_digest); // snapshot NOT rewritten
    // A repeat revoke is an honest 409, not a silent no-op.
    const repeat = await attempt(() => revokeAttestation(authedRequest(`/api/attestations/${id}/revoke`, { reason: "again" }, { session: w.owner }), w.env, id));
    expect(repeat.status).toBe(409);
  });

  it("supersession keeps the history visible: original superseded, replacement current, digest preserved", async () => {
    const w = await world();
    const { id } = await issueOne(w);
    const before = await verify(w, id);
    const response = await supersedeAttestation(authedRequest(`/api/attestations/${id}/supersede`, {
      reason: "Fictional corrected statement",
      replacement: { record_kind: "genetic_test", record_id: "501", statement: "Fictional corrected genotype statement; still no actual test." },
    }, { session: w.owner }), w.env, id);
    expect(response.status).toBe(200);
    const body = await response.json() as { replacement: { id: string } };
    const original = await verify(w, id);
    expect(original.verification_state).toBe("superseded");
    expect(original.snapshot?.content_digest).toBe(before.snapshot?.content_digest);
    const replacement = await verify(w, body.replacement.id);
    expect(replacement.verification_state).toBe("current");
  });

  it("refuses supersession whose replacement concerns a DIFFERENT record (scope mismatch)", async () => {
    const w = await world();
    await db_insert_second_test(w);
    const { id } = await issueOne(w);
    const { status, body } = await attempt(() => supersedeAttestation(authedRequest(`/api/attestations/${id}/supersede`, {
      reason: "Fictional mismatch attempt",
      replacement: { record_kind: "genetic_test", record_id: "502", statement: "Fictional other record." },
    }, { session: w.owner }), w.env, id));
    expect(status).toBe(400);
    expect(String(body.error?.code)).toBe("scope_mismatch");
  });

  it("a REAL elapsed expiry flips the visible status to expired with the snapshot preserved", async () => {
    const w = await world();
    const expiresAt = new Date(Date.now() + 1200).toISOString();
    const { id } = await issueOne(w, { expires_at: expiresAt });
    const before = await verify(w, id);
    expect(before.effective_status).toBe("active");
    await new Promise(resolve => setTimeout(resolve, 2000));
    const after = await verify(w, id);
    expect(after.effective_status).toBe("expired");
    expect(after.verification_state).toBe("expired");
    expect(after.snapshot?.content_digest).toBe(before.snapshot?.content_digest); // history preserved, never rewritten
  }, 15000);

  it("requires exact genetic evidence-read authority for private snapshots, independently of platform/issuer roles", async () => {
    const w = await world();
    const { id } = await issueOne(w);
    const snapshot = (session: AuthedSession) => attempt(() => attestationSnapshotHandler(
      authedRequest(`/api/admin/attestations/${id}/snapshot`,undefined,{session,method:"GET"}),w.env,id));
    for (const session of [w.attester,w.stranger,w.owner,w.admin]) {
      const denied=await snapshot(session);
      expect(denied.status).toBe(403);
      expect(denied.body.error.code).toBe("snapshot_permission_required");
      expect(JSON.stringify(denied.body)).not.toContain("PRIVATE-FICTIONAL");
    }
    const grant = async (userId: string,horseId: number,permission: string) => {
      const grantId=crypto.randomUUID();
      await w.db.prepare(`INSERT INTO professional_access_grants(id,horse_id,grantee_user_id,professional_kind,permissions,
        authority_ref,assignment_ref,basis,granted_by_user_id,valid_from)
        VALUES(?,?,?,'laboratory',?,'SYNTHETIC-AUTHORITY','SYNTHETIC-SNAPSHOT-REVIEW','admin_grant','r16-admin','2000-01-01')`)
        .bind(grantId,horseId,userId,permission).run();
      return grantId;
    };
    await w.db.exec("INSERT INTO horses(id,name_latin) VALUES(92,'Fictional unrelated subject')");
    await grant("r16-stranger",92,"genetic_evidence_read");
    await grant("r16-stranger",91,"private_health_read");
    expect((await snapshot(w.stranger)).status).toBe(403); // Wrong horse or result-only never exports raw evidence.
    const readerGrant=await grant("r16-stranger",91,"genetic_evidence_read");
    const authorized=await snapshot(w.stranger); // No issuer membership or platform role is needed for an explicit read grant.
    expect(authorized.status).toBe(200);
    expect(authorized.body.snapshot.canonical_json).toContain("PRIVATE-FICTIONAL-ACCESSION");
    expect(authorized.body.snapshot.canonical_json).toContain("PRIVATE-FICTIONAL-INTERPRETATION");
    for (const [userId,session] of [["r16-owner",w.owner],["r16-admin",w.admin]] as const) {
      expect((await snapshot(session)).status).toBe(403);
      await grant(userId,91,"genetic_evidence_read");
      expect((await snapshot(session)).status).toBe(200);
    }
    await w.db.prepare("UPDATE professional_access_grants SET revoked_at=CURRENT_TIMESTAMP WHERE id=?").bind(readerGrant).run();
    expect((await snapshot(w.stranger)).status).toBe(403);
    expect(JSON.stringify(await verify(w,id))).not.toContain("PRIVATE-FICTIONAL");
  });

  it("preserves current issuer-owner and content-manager eligibility for non-genetic snapshots", async () => {
    const w=await world();
    // Deliberately approve this distinct scope only in this non-genetic story.
    await w.db.prepare(`INSERT INTO issuer_scopes(id,issuer_id,record_kind,status,scope_version,valid_from,evidence_note,approved_by_user_id,approved_at)
      VALUES('r16-explicit-identity-scope',?,'horse_identity','approved',1,'2000-01-01',
        'Fictional identity review scope for this isolated story','r16-admin','2026-01-01')`).bind(LAB).run();
    await w.db.exec("INSERT INTO issuer_scope_actions(scope_id,action) VALUES('r16-explicit-identity-scope','attest')");
    const {id}=await issueOne(w,{record_kind:"horse_identity",record_id:"91"});
    const snapshot=(session: AuthedSession)=>attempt(()=>attestationSnapshotHandler(
      authedRequest(`/api/admin/attestations/${id}/snapshot`,undefined,{session,method:"GET"}),w.env,id));
    for(const session of [w.attester,w.stranger]) expect((await snapshot(session)).status).toBe(403);
    for(const session of [w.owner,w.admin]) {
      const response=await snapshot(session);
      expect(response.status).toBe(200);expect(response.body.snapshot.canonical_json).toContain("R16 STAR");
    }
    await w.db.exec("UPDATE issuer_memberships SET status='revoked',revoked_at=CURRENT_TIMESTAMP,revoked_reason='Fictional membership withdrawal' WHERE id='m-r16-owner'");
    expect((await snapshot(w.owner)).status).toBe(403);
    expect((await snapshot(w.admin)).status).toBe(200);
  });

  it("keeps the demo honest: the issuer's fictional registration evidence is recorded on the row", async () => {
    const w = await world();
    const row = await w.db.prepare("SELECT registration_evidence FROM issuers WHERE id=?").bind(LAB).first<{ registration_evidence: string }>();
    expect(row?.registration_evidence).toContain("SYNTHETIC DEMONSTRATION ONLY");
    expect(row?.registration_evidence).toContain("no accreditation");
  });
});

async function db_insert_second_test(w: World): Promise<void> {
  await w.db.exec(`
    INSERT INTO genetic_tests(id,horse_id,test_type,test_category,result,verified,lab_name,provenance,public_disclosed)
      VALUES (502,91,'SCID','disease','N/N',1,'FICTIONAL DEMO LAB - NO ACTUAL TEST','demo',1);
  `);
}

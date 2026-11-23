import { describe, expect, it } from "vitest";
import {
  canAttest,
  isSelfReview,
  membershipValidity,
  resolveVerificationLevel,
  stripCallerAuthority,
  VERIFICATION_LEVELS,
  type MembershipRow,
} from "../../src/trust/policy";
import { issueAttestation } from "../../src/trust/attestations";
import { openRealDatabase, seedUser, countRows } from "../helpers/realDatabase";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * Master-Ai plan T05 (finding F03): editorial review and issuer attestation
 * are separate powers. These fixtures pin the separation: forged caller
 * authority is discarded, memberships are validity-windowed, self-review of
 * protected evidence is blocked, and no verification level masquerades as a
 * universal quality guarantee.
 */

const NOW = new Date("2026-10-03T12:00:00.000Z");

function membership(overrides: Partial<MembershipRow> & { id?: string } = {}): MembershipRow & { id?: string } {
  return {
    issuer_id: "issuer-a",
    user_id: "user-1",
    role: "attester",
    status: "active",
    valid_from: "2026-01-01T00:00:00.000Z",
    valid_until: null,
    revoked_at: null,
    ...overrides,
  };
}

describe("verification levels vocabulary (T05)", () => {
  it("defines the four levels as distinct, non-authority claims", () => {
    const levels = Object.values(VERIFICATION_LEVELS);
    expect(new Set(levels.map((meta) => meta.en)).size).toBe(4);
    for (const meta of levels) {
      expect(meta.isAuthorityClaim).toBe(false);
      expect(meta.en.length).toBeGreaterThan(20);
      expect(meta.fa.length).toBeGreaterThan(10);
    }
  });

  it("resolves levels from database state, highest first", () => {
    expect(resolveVerificationLevel({ platformVerified: true, provenance: "user", activeIssuerAttestations: 2 })).toBe("issuer_attested");
    expect(resolveVerificationLevel({ platformVerified: true, provenance: "user", activeIssuerAttestations: 0 })).toBe("platform_reviewed");
    expect(resolveVerificationLevel({ platformVerified: false, provenance: "demo", activeIssuerAttestations: 0 })).toBe("imported_unverified");
    expect(resolveVerificationLevel({ platformVerified: false, provenance: "user", activeIssuerAttestations: 0 })).toBe("owner_declared");
  });
});

describe("caller authority stripping (T05 step 3 / F03)", () => {
  it("discards verified flags and federation provenance from ordinary creates", () => {
    expect(stripCallerAuthority("federation")).toEqual({ verified: 0, provenance: "user" });
    expect(stripCallerAuthority("user")).toEqual({ verified: 0, provenance: "user" });
    expect(stripCallerAuthority("demo")).toEqual({ verified: 0, provenance: "demo" });
    expect(stripCallerAuthority(null)).toEqual({ verified: 0, provenance: "user" });
  });
});

describe("membership validity windows", () => {
  it("marks active, revoked, expired and not-yet-valid memberships", () => {
    expect(membershipValidity(membership(), NOW)).toBe("active");
    expect(membershipValidity(membership({ status: "revoked", revoked_at: "2026-06-01T00:00:00.000Z" }), NOW)).toBe("revoked");
    expect(membershipValidity(membership({ valid_until: "2026-09-01T00:00:00.000Z" }), NOW)).toBe("expired");
    expect(membershipValidity(membership({ valid_from: "2026-11-01T00:00:00.000Z" }), NOW)).toBe("not_yet_valid");
    expect(membershipValidity(null, NOW)).toBe("revoked");
  });

  it("canAttest rejects every invalid state with a precise reason", () => {
    expect(canAttest({ issuerId: "issuer-a", issuerStatus: "active", membership: membership(), now: NOW })).toEqual({ ok: true });
    expect(canAttest({ issuerId: "issuer-a", issuerStatus: "suspended", membership: membership(), now: NOW }).reason).toBe("issuer_suspended");
    expect(canAttest({ issuerId: "issuer-a", issuerStatus: "active", membership: null, now: NOW }).reason).toBe("no_membership");
    expect(canAttest({ issuerId: "issuer-a", issuerStatus: "active", membership: membership({ status: "revoked", revoked_at: "2026-06-01T00:00:00.000Z" }), now: NOW }).reason).toBe("membership_revoked");
    expect(canAttest({ issuerId: "issuer-a", issuerStatus: "active", membership: membership({ valid_until: "2026-09-01T00:00:00.000Z" }), now: NOW }).reason).toBe("membership_expired");
    expect(canAttest({ issuerId: "issuer-a", issuerStatus: "active", membership: membership({ valid_from: "2026-11-01T00:00:00.000Z" }), now: NOW }).reason).toBe("membership_not_yet_valid");
    expect(canAttest({ issuerId: "issuer-a", issuerStatus: "active", membership: membership({ role: "viewer" }), now: NOW }).reason).toBe("insufficient_role");
  });

  it("rejects a membership that belongs to a different issuer (cross-organization)", () => {
    const check = canAttest({ issuerId: "issuer-a", issuerStatus: "active", membership: membership({ issuer_id: "issuer-b" }), now: NOW });
    expect(check.reason).toBe("membership_issuer_mismatch");
  });
});

describe("self-review protection (T05 step 5)", () => {
  it("blocks attesting evidence the attester produced themselves", () => {
    expect(isSelfReview({ attesterUserId: "user-1", evidenceUploaderId: "user-1" })).toBe(true);
    expect(isSelfReview({ attesterUserId: "user-1", evidenceUploaderId: "user-2" })).toBe(false);
    expect(isSelfReview({ attesterUserId: "user-1", evidenceUploaderId: null })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// R98: service-path assertions use the full migrated database. Recording an
// INSERT's arguments never proves that the command actually inserted a row.

async function serviceFixture(): Promise<D1Database> {
  const db = await openRealDatabase();
  await seedUser(db, "user-1");
  await seedUser(db, "user-2");
  await seedUser(db, "staff-1", "super_admin");
  await db.exec(`INSERT INTO horses(id,name_latin) VALUES(7,'Synthetic subject'),(8,'Other synthetic subject');
    INSERT INTO issuers(id,slug,name,status,registration_evidence) VALUES('issuer-a','synthetic-a','Synthetic issuer A','active','Board resolution 2026-07 reviewed by platform staff'),('issuer-b','synthetic-b','Synthetic issuer B','active','Registry license IR-2026-118 reviewed by platform staff');
    INSERT INTO issuer_memberships(id,issuer_id,user_id,role,valid_from) VALUES('m1','issuer-a','user-1','attester','2020-01-01 00:00:00');
    INSERT INTO issuer_scopes(id,issuer_id,record_kind,status,scope_version,valid_from,evidence_note,approved_by_user_id)
      VALUES('scope-a-genetic','issuer-a','genetic_test','approved',1,'2020-01-01 00:00:00','Laboratory accreditation covers genetic test attestations','staff-1'),
             ('scope-a-media','issuer-a','media','approved',1,'2020-01-01 00:00:00','Document review covers media evidence attestations','staff-1');
    INSERT INTO issuer_scope_actions(scope_id,action) VALUES('scope-a-genetic','attest'),('scope-a-genetic','supersede'),('scope-a-media','attest');
    INSERT INTO genetic_tests(id,horse_id,test_type,test_category,result,verified,provenance) VALUES(55,7,'SCID','disease','N/N',0,'user');
    INSERT INTO horse_media(id,horse_id,media_type,file_name,mime_type,size_bytes,uploaded_by_user_id,consent_state)
      VALUES('media-1',7,'document','synthetic.pdf','application/pdf',1,'user-2','private')`);
  return db;
}
const baseInput = {
  record_kind: "genetic_test" as const, record_id: "55", horse_id: 7,
  statement: "Synthetic lab evidence statement", field_scope: ["result", "lab_name"],
};
async function expectHttpError(promise: Promise<unknown>, status: number, code: string) {
  await expect(promise).rejects.toMatchObject({ status, code });
}
describe("issueAttestation service path on real SQLite", () => {
  it("stores record-derived horse identity, scope and exactly one issuance event", async () => {
    const db = await serviceFixture();
    const { horse_id: _unused, ...withoutCallerHorse } = baseInput;
    const result = await issueAttestation(db, { userId: "user-1" }, "issuer-a", withoutCallerHorse);
    expect(result.horse_id).toBe(7);
    const stored = await db.prepare("SELECT horse_id,issuer_id,field_scope,issued_at FROM attestations WHERE id=?").bind(result.id).first<Record<string, unknown>>();
    expect(stored?.horse_id).toBe(7);
    expect(stored?.issuer_id).toBe("issuer-a");
    expect(JSON.parse(String(stored?.field_scope))).toEqual(["result", "lab_name"]);
    expect(result.issued_at).toBe(stored?.issued_at);
    expect(await countRows(db, "attestation_events")).toBe(1);
  });
  it("rejects a super-admin without issuer membership", async () => {
    const db = await serviceFixture();
    await expectHttpError(issueAttestation(db, { userId: "staff-1" }, "issuer-a", baseInput), 403, "no_membership");
    expect(await countRows(db, "attestations")).toBe(0);
  });
  it("rejects expired and malformed membership intervals", async () => {
    const db = await serviceFixture();
    await db.exec("UPDATE issuer_memberships SET valid_until='2001-01-01T00:00:00Z',valid_from='2000-01-01T00:00:00Z'");
    await expectHttpError(issueAttestation(db, { userId: "user-1" }, "issuer-a", baseInput), 403, "membership_expired");
    await db.exec("UPDATE issuer_memberships SET valid_from='2025-02-30T00:00:00Z',valid_until=NULL");
    await expectHttpError(issueAttestation(db, { userId: "user-1" }, "issuer-a", baseInput), 403, "membership_invalid");
  });
  it("rejects revoked membership", async () => {
    const db = await serviceFixture();
    await db.exec("UPDATE issuer_memberships SET status='revoked',revoked_at=CURRENT_TIMESTAMP,revoked_reason='Synthetic revocation'");
    await expectHttpError(issueAttestation(db, { userId: "user-1" }, "issuer-a", baseInput), 403, "membership_revoked");
  });
  it("a membership in a different issuer does not satisfy this issuer's query", async () => {
    const db = await serviceFixture();
    await db.exec("UPDATE issuer_memberships SET issuer_id='issuer-b'");
    await expectHttpError(issueAttestation(db, { userId: "user-1" }, "issuer-a", baseInput), 403, "no_membership");
  });
  it("blocks target and evidence self-review without leaving events", async () => {
    const db = await serviceFixture();
    await db.exec("UPDATE horse_media SET uploaded_by_user_id='user-1'");
    await expectHttpError(issueAttestation(db, { userId: "user-1" }, "issuer-a", { ...baseInput, record_kind: "media", record_id: "media-1" }), 403, "self_review_forbidden");
    await expectHttpError(issueAttestation(db, { userId: "user-1" }, "issuer-a", { ...baseInput, evidence_media_id: "media-1" }), 403, "self_review_forbidden");
    expect(await countRows(db, "attestation_events")).toBe(0);
  });
  it("rejects unknown records and contradictory horse binding", async () => {
    const db = await serviceFixture();
    await expectHttpError(issueAttestation(db, { userId: "user-1" }, "issuer-a", { ...baseInput, record_id: "999" }), 404, "not_found");
    await expectHttpError(issueAttestation(db, { userId: "user-1" }, "issuer-a", { ...baseInput, horse_id: 8 }), 400, "scope_mismatch");
    expect(await countRows(db, "attestations")).toBe(0);
  });
});

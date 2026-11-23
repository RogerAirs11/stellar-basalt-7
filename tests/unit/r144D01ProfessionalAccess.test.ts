import { describe, expect, it } from "vitest";
import {
  PROFESSIONAL_GRANT_BASES,
  PROFESSIONAL_GRANT_PERMISSIONS,
  PROFESSIONAL_GRANT_LOOKUP_SQL,
  PROFESSIONAL_KINDS,
  PROFESSIONAL_REVOKE_AUDIT_SQL,
  REVOKE_PROFESSIONAL_GRANT_SQL,
  authorizeProfessionalAction,
  parseProfessionalPermissions,
  professionalPermissionsForViewer,
  revokeProfessionalGrant,
} from "../../src/access/professionalAccess";

/**
 * R144-D01 (Master-AI plan): professional grants scoped to horse, data and
 * purpose. These fixtures pin the vocabulary, the mandate shape, the SQL
 * containment filters (revocation + validity + grantee identity) and the
 * marker-conditioned revoke audit — the same guarantees the 0034 editorial
 * grants carry.
 */

const NOW = new Date("2026-10-03T12:00:00.000Z");

function fakeDb(rows: Array<Record<string, unknown>>) {
  return {
    prepare: (_sql: string) => ({
      bind: () => ({
        all: async () => ({ results: rows.map(row => ({ professional_kind: "veterinarian", ...row })) }),
        first: async () => rows[0] ?? null,
      }),
    }),
    batch: async () => [],
  } as never;
}

describe("professional grant vocabulary (D01)", () => {
  it("defines the distinct professional and scoped genetic permissions, each distinct", () => {
    expect(PROFESSIONAL_GRANT_PERMISSIONS).toEqual([
      "private_health_read",
      "clinical_write",
      "sample_submit",
      "evidence_review",
      "official_attestation",
      "private_file_export",
      "genetic_evidence_read", "genetic_intake", "genetic_review", "genetic_publish",
    ]);
  });

  it("defines the professional kinds including veterinarian and laboratory", () => {
    expect(PROFESSIONAL_KINDS).toEqual(["veterinarian", "laboratory", "farrier", "physiotherapist", "dentist", "nutritionist", "federation_official"]);
  });

  it("defines the three grant bases", () => {
    expect(PROFESSIONAL_GRANT_BASES).toEqual(["admin_grant", "owner_consent", "institution_assignment"]);
  });

  it("parses, deduplicates and vocabulary-filters the stored permissions list", () => {
    expect(parseProfessionalPermissions("private_health_read,sample_submit,private_health_read")).toEqual(["private_health_read", "sample_submit"]);
    expect(parseProfessionalPermissions("private_health_read,horse.edit")).toEqual(["private_health_read"]);
    expect(parseProfessionalPermissions("")).toEqual([]);
    expect(parseProfessionalPermissions(null)).toEqual([]);
  });
});

describe("professional grant lookup SQL containment (D01)", () => {
  it("filters revoked, unstarted, expired grants and requires an active membership for org grants", () => {
    expect(PROFESSIONAL_GRANT_LOOKUP_SQL).toContain("g.revoked_at IS NULL");
    expect(PROFESSIONAL_GRANT_LOOKUP_SQL).toContain("(g.valid_until IS NULL OR datetime(g.valid_until) > datetime(?))");
    expect(PROFESSIONAL_GRANT_LOOKUP_SQL).toContain("g.grantee_user_id=?");
    expect(PROFESSIONAL_GRANT_LOOKUP_SQL).toContain("m.status='active'");
    expect(PROFESSIONAL_GRANT_LOOKUP_SQL).toContain("m.revoked_at IS NULL");
    expect(PROFESSIONAL_GRANT_LOOKUP_SQL).toContain("o.status='active'");
  });

  it("resolves only grants made out to the viewer (never another user's row)", async () => {
    const mine = { id: "pg1", horse_id: 7, grantee_user_id: "vet-1", grantee_organization_id: null, permissions: "private_health_read", valid_from: "2026-01-01T00:00:00Z", valid_until: null, revoked_at: null };
    const someoneElses = { id: "pg2", horse_id: 7, grantee_user_id: "vet-other", grantee_organization_id: null, permissions: "private_health_read", valid_from: "2026-01-01T00:00:00Z", valid_until: null, revoked_at: null };
    expect(await professionalPermissionsForViewer(fakeDb([mine, someoneElses]), "vet-1", 7, NOW)).toEqual(["private_health_read"]);
  });

  it("honors validity windows: expired and not-yet-valid grants contribute nothing", async () => {
    const expired = { id: "pg1", horse_id: 7, grantee_user_id: "vet-1", grantee_organization_id: null, permissions: "private_health_read", valid_from: "2026-01-01T00:00:00Z", valid_until: "2026-10-01T00:00:00Z", revoked_at: null };
    const future = { id: "pg2", horse_id: 7, grantee_user_id: "vet-1", grantee_organization_id: null, permissions: "clinical_write", valid_from: "2026-11-01T00:00:00Z", valid_until: null, revoked_at: null };
    expect(await professionalPermissionsForViewer(fakeDb([expired, future]), "vet-1", 7, NOW)).toEqual([]);
  });

  it("authorizeProfessionalAction denies an ungranted permission", async () => {
    const grant = { id: "pg1", horse_id: 7, grantee_user_id: "vet-1", grantee_organization_id: null, permissions: "private_health_read", valid_from: "2026-01-01T00:00:00Z", valid_until: null, revoked_at: null };
    expect((await authorizeProfessionalAction(fakeDb([grant]), "vet-1", 7, "private_health_read", NOW)).ok).toBe(true);
    const denied = await authorizeProfessionalAction(fakeDb([grant]), "vet-1", 7, "official_attestation", NOW);
    expect(denied).toEqual({ ok: false, reason: "not_granted" });
  });
});

describe("professional grant revocation (D01)", () => {
  it("requires a reason", async () => {
    await expect(revokeProfessionalGrant(fakeDb([]), { grantId: "pg1", byUserId: "admin-1", sessionId: "test-session", reason: "  " })).rejects.toMatchObject({ status: 422 });
  });

  it("conditions the audit row on THIS call's operation marker landing", () => {
    expect(REVOKE_PROFESSIONAL_GRANT_SQL).toContain("revoked_at=CURRENT_TIMESTAMP");
    expect(REVOKE_PROFESSIONAL_GRANT_SQL).toContain("last_operation_id=?");
    expect(REVOKE_PROFESSIONAL_GRANT_SQL).toContain("revoked_at IS NULL");
    expect(PROFESSIONAL_REVOKE_AUDIT_SQL).toContain("g.last_operation_id=?");
    expect(PROFESSIONAL_REVOKE_AUDIT_SQL).toContain("g.revoked_at IS NOT NULL");
  });
});

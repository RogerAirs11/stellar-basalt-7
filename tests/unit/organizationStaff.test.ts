import { describe, expect, it } from "vitest";
import {
  classifyInvitationFailure,
  commandFeedback,
  normalizeMyOrganizationInvites,
  normalizeOrganizationRoster,
} from "../../src/frontend-kit/domain/organizationStaff";
import { ORGANIZATION_STAFF } from "../../src/frontend-kit/domain/locale";
import { PlatformClientError } from "../../src/frontend-kit/errors";
import { pick } from "../../src/frontend-kit/domain/locale";

/**
 * R114-04 (Master AI R113 handoff D21) — the ONE headless staff-lifecycle
 * module shared by all five frontends. Pinning it here pins every native
 * surface (heritage panel, Retro/FEI/Elite/Classic editors):
 *
 *  1. The roster normalizes memberships and invites honestly: current vs
 *     former vs pending, with revocation reasons and expiry dates intact.
 *  2. My-invites normalization keeps the server's `actionable` flag — only
 *     pending AND unexpired invitations are answerable.
 *  3. Answer refusals map to their honest causes: 409 revoked, 410 expired,
 *     404 gone, anything else unknown — never translated into a success.
 *  4. Command feedback never fabricates a message while submitting.
 *  5. The copy keeps user memberships, person profiles and person-level
 *     officiating roles distinct, bilingual (EN+FA).
 */

describe("R114-04 roster normalization", () => {
  it("normalizes membership rows with the live current flag and revocation evidence", () => {
    const entries = normalizeOrganizationRoster([
      { kind: "membership", user_id: "demo-owner-a", email: "demo-owner-a@local.invalid", role: "owner", status: "active", is_current: 1, valid_from: "2000-01-01T00:00:00Z", valid_until: null, revoked_at: null, revoke_reason: null },
      { kind: "membership", user_id: "ex-staff", email: "ex@local.invalid", role: "member", status: "active", is_current: 0, valid_from: "2000-01-01T00:00:00Z", valid_until: "2026-01-01T00:00:00Z", revoked_at: "2026-09-01T00:00:00Z", revoke_reason: "Left the stable" },
    ]);
    expect(entries).toHaveLength(2);
    const current = entries[0];
    if (current.kind !== "membership") throw new Error("expected membership");
    expect(current.is_current).toBe(true);
    expect(current.role).toBe("owner");
    const former = entries[1];
    if (former.kind !== "membership") throw new Error("expected membership");
    expect(former.is_current).toBe(false);
    expect(former.revoked_at).toBe("2026-09-01T00:00:00Z");
    expect(former.revoke_reason).toBe("Left the stable");
  });

  it("normalizes invite rows with status and expiry", () => {
    const entries = normalizeOrganizationRoster([
      { kind: "invite", id: 7, invitee_user_id: "demo-staff", email: "demo-staff@local.invalid", proposed_role: "member", status: "pending", expires_at: "2026-11-01T00:00:00Z", created_at: "2026-10-17T00:00:00Z" },
    ]);
    const invite = entries[0];
    if (invite.kind !== "invite") throw new Error("expected invite");
    expect(invite.invitee_user_id).toBe("demo-staff");
    expect(invite.status).toBe("pending");
    expect(invite.expires_at).toBe("2026-11-01T00:00:00Z");
  });

  it("never fabricates fields the server omitted (nullable stays null)", () => {
    const entries = normalizeOrganizationRoster([{ kind: "membership", user_id: "u1", role: "member" }]);
    const membership = entries[0];
    if (membership.kind !== "membership") throw new Error("expected membership");
    expect(membership.revoked_at).toBeNull();
    expect(membership.revoke_reason).toBeNull();
    expect(membership.email).toBeNull();
    expect(membership.is_current).toBe(false);
  });
});

describe("R114-04 my-invitations normalization", () => {
  it("keeps the server's actionable flag: pending AND unexpired only", () => {
    const invitations = normalizeMyOrganizationInvites([
      { id: 1, organization_id: 970004001, name_native: "باشگاه نمایشی", name_latin: "DEMO Fictional Stable", proposed_role: "member", status: "pending", note: "Welcome", expires_at: "2026-11-01T00:00:00Z", created_at: "2026-10-17T00:00:00Z", actionable: 1 },
      { id: 2, organization_id: 970004002, name_native: null, name_latin: "Other Stable", proposed_role: "manager", status: "pending", note: null, expires_at: "2026-10-01T00:00:00Z", created_at: "2026-09-01T00:00:00Z", actionable: 0 },
    ]);
    expect(invitations[0].actionable).toBe(true);
    expect(invitations[1].actionable).toBe(false);
    expect(invitations[1].note).toBeNull();
  });
});

describe("R114-04 honest answer classification", () => {
  it("maps 409 to revoked, 410 to expired, 404 to gone", () => {
    expect(classifyInvitationFailure(new PlatformClientError(409, "invite_revoked", "This invitation was revoked by the organization")).kind).toBe("revoked");
    expect(classifyInvitationFailure(new PlatformClientError(410, "invite_expired", "This invitation expired")).kind).toBe("expired");
    expect(classifyInvitationFailure(new PlatformClientError(404, "not_found", "Invite not found or already answered")).kind).toBe("gone");
  });
  it("keeps every other outcome unknown — never a success", () => {
    expect(classifyInvitationFailure(new PlatformClientError(500, "server_error", "boom")).kind).toBe("unknown");
    expect(classifyInvitationFailure(new Error("network dropped")).kind).toBe("unknown");
    expect(classifyInvitationFailure("not even an error").kind).toBe("unknown");
  });
});

describe("R114-04 command feedback", () => {
  it("carries messages only for decided outcomes; submitting stays silent", () => {
    expect(commandFeedback({ phase: "submitting" })).toBe("");
    expect(commandFeedback({ phase: "accepted", message: "Invitation sent." })).toBe("Invitation sent.");
    expect(commandFeedback({ phase: "rejected", code: "invite_conflict", message: "Conflict", status: 409 })).toBe("Conflict");
    expect(commandFeedback({ phase: "failed", message: "Unknown outcome" })).toBe("Unknown outcome");
    expect(commandFeedback({ phase: "idle" })).toBe("");
  });
});

describe("R114-04 bilingual copy keeps entities distinct", () => {
  it("carries EN+FA for every staff-lifecycle line", () => {
    for (const key of Object.keys(ORGANIZATION_STAFF) as Array<keyof typeof ORGANIZATION_STAFF>) {
      const entry = ORGANIZATION_STAFF[key] as { en: string; fa: string };
      expect(entry.en.length).toBeGreaterThan(0);
      expect(entry.fa.length).toBeGreaterThan(0);
    }
  });
  it("picks by locale", () => {
    expect(pick(ORGANIZATION_STAFF.current, "en")).toBe("Current");
    expect(pick(ORGANIZATION_STAFF.current, "fa")).toBe("جاری");
  });
  it("keeps the person/membership separation explicit", () => {
    expect(ORGANIZATION_STAFF.personNotMembership.en).toContain("user-account facts");
    expect(ORGANIZATION_STAFF.personNotMembership.fa).toContain("حساب کاربر");
  });
});

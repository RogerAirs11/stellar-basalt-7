import { describe, expect, it } from "vitest";
import {
  writeOrganizationProfile, inviteStaff, respondToInvite, changeStaffRole, revokeStaffMembership,
  organizationInbox, appointOfficial, publicOrganizationCard, managedOrganization, organizationStaffRoster,
  myStaffInvites, parseOpeningHours,
} from "../../src/organizations/onboarding";
import { createOrganizationCredential, reviewOrganizationCredential } from "../../src/organizations/onboarding";
import { HttpError } from "../../src/api/http";
import { openRealDatabase, seedUser, makeSession, countRows } from "../helpers/realDatabase";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * R98-N07 acceptance — organization and professional onboarding on a real
 * database with every migration applied (including 0075).
 *
 * Acceptance under test (from the reviewed N07 ticket):
 *  1. A former employee cannot edit the organization or read new leads after
 *     revocation — the live membership predicate denies both, immediately.
 *  2. One staff member can belong to two businesses without leaking one
 *     business inbox into the other (inbox scoped by organization_id).
 *  3. Public cards expose consented data only and show unknown/unconfirmed
 *     location or credentials accurately (honest periods, fail-closed states).
 *  4. The org profile write mirrors the person profile: stored row_version on
 *     every update, first creation without expected_version, explicit
 *     province-scheme confirmation, private contact only for current staff,
 *     and publication consent that an editor-curator can never grant.
 *  5. Staff lifecycle: invite → accept (bounded expiry, no replay), role
 *     change with no self-escalation, revocation with audit, last-owner-seat
 *     protection, owner-role grants restricted to current owners.
 *  6. Officiating appointments (judge/steward/ringmaster/dc) require a
 *     CURRENT credential in the same role — dates_not_recorded, expired,
 *     revoked and invalid dates never qualify.
 */

async function seedOrg(db: D1Database, slug: string): Promise<number> {
  const result = await db.prepare("INSERT INTO organizations(slug,name_native,name_latin,kind,status) VALUES(?,?,?,?, 'active')")
    .bind(slug, `مزرعه ${slug}`, `Farm ${slug}`, "stable").run();
  return Number(result.meta.last_row_id ?? 0);
}

async function seedMembership(db: D1Database, orgId: number, userId: string, role: "owner" | "manager" | "member", extra: { revokedAt?: string; validUntil?: string | null } = {}): Promise<void> {
  await db.prepare(`INSERT INTO organization_memberships(organization_id,user_id,role,status,valid_from,valid_until,revoked_at)
  VALUES(?,?,?,'active','2020-01-01 00:00:00',?,?)`)
    .bind(orgId, userId, role, extra.validUntil ?? null, extra.revokedAt ?? null).run();
}

async function seedLead(db: D1Database, orgId: number, providerPersonId: number, id: number, note: string): Promise<void> {
  await db.prepare(`INSERT INTO service_requests(id,requester_user_id,provider_person_id,provider_organization_id,category,province_code,city,note,share_contact,status)
  VALUES(?,'lead-buyer-n07',?,?,?,'IR-23','Tehran',?,1,'new')`)
    .bind(id, providerPersonId, orgId, "boarding", note).run();
}

async function baseWorld(db: D1Database) {
  await seedUser(db, "owner-1", "user");
  await seedUser(db, "manager-1", "user");
  await seedUser(db, "staff-1", "user");
  await seedUser(db, "outsider-1", "user");
  await seedUser(db, "editor-1", "editor");
  await seedUser(db, "admin-1", "admin");
  await db.exec(`INSERT INTO people(id,name_latin) VALUES(1,'N07 Provider Person');`);
}

const SCHEME = "iso3166-2-ir:2020-11-24";

describe("R98-N07 organization profile: version gates + private contact + consent", () => {
  it("first creation needs no expected_version; updates require the exact stored row_version", async () => {
    const db = await openRealDatabase();
    await baseWorld(db);
    const orgId = await seedOrg(db, "n07-version");
    await seedMembership(db, orgId, "owner-1", "owner");
    // First creation (expectedVersion 0 = no stored row).
    const created = await writeOrganizationProfile(db, {
      actorId: "owner-1", organizationId: orgId, expectedVersion: 0,
      description: "Versioned farm", categories: ["boarding"], specialties: ["dressage"], serviceAreas: ["IR-23"],
      accessibilityNotes: "Ramp access", openingHours: JSON.stringify({ mon: "08:00-14:00" }),
      province: "IR-23", provinceScheme: SCHEME, city: "Tehran",
      contactPreference: "platform_message", contactValue: "+98 21 000 0001", consent: true,
    });
    expect(created).toBe(true);
    const row = await db.prepare("SELECT row_version,publication_consent,published_at FROM organization_profiles WHERE organization_id=?").bind(orgId).first<{ row_version: number; publication_consent: number; published_at: string | null }>();
    expect(row?.row_version).toBe(1);
    expect(row?.publication_consent).toBe(1);
    expect(row?.published_at).not.toBeNull();
    // Stale version (an outdated view of the profile) must NOT apply.
    const stale = await writeOrganizationProfile(db, {
      actorId: "owner-1", organizationId: orgId, expectedVersion: 0,
      description: "Stale write", categories: ["boarding"], specialties: [], serviceAreas: [],
      accessibilityNotes: null, openingHours: null, province: null, provinceScheme: null, city: null,
      contactPreference: "platform_message", contactValue: null, consent: false,
    });
    expect(stale).toBe(false);
    // Correct version applies and bumps.
    const updated = await writeOrganizationProfile(db, {
      actorId: "owner-1", organizationId: orgId, expectedVersion: 1,
      description: "Fresh write", categories: ["boarding", "training"], specialties: ["jumping"], serviceAreas: ["IR-23", "IR-08"],
      accessibilityNotes: null, openingHours: null, province: "IR-23", provinceScheme: SCHEME, city: "Tehran",
      contactPreference: "email", contactValue: "farm@example.com", consent: true,
    });
    expect(updated).toBe(true);
    const after = await db.prepare("SELECT row_version,contact_preference,contact_value,service_areas FROM organization_profiles WHERE organization_id=?").bind(orgId)
      .first<{ row_version: number; contact_preference: string; contact_value: string | null; service_areas: string }>();
    expect(after?.row_version).toBe(2);
    expect(after?.contact_preference).toBe("email");
    expect(after?.contact_value).toBe("farm@example.com");
    expect(JSON.parse(after?.service_areas ?? "[]")).toEqual(["IR-23", "IR-08"]);
  });

  it("province scheme confirmation is mandatory and invalid service areas are refused", async () => {
    const db = await openRealDatabase();
    await baseWorld(db);
    const orgId = await seedOrg(db, "n07-province");
    await seedMembership(db, orgId, "owner-1", "owner");
    await expect(writeOrganizationProfile(db, {
      actorId: "owner-1", organizationId: orgId, expectedVersion: 0,
      description: null, categories: [], specialties: [], serviceAreas: [],
      accessibilityNotes: null, openingHours: null, province: "IR-23", provinceScheme: "legacy_r97_unconfirmed",
      city: null, contactPreference: "platform_message", contactValue: null, consent: false,
    })).rejects.toThrow(/province.*reference dataset/i);
    await expect(writeOrganizationProfile(db, {
      actorId: "owner-1", organizationId: orgId, expectedVersion: 0,
      description: null, categories: [], specialties: [], serviceAreas: ["IR-99"],
      accessibilityNotes: null, openingHours: null, province: null, provinceScheme: null,
      city: null, contactPreference: "platform_message", contactValue: null, consent: false,
    })).rejects.toThrow(/Service area/);
    await expect(writeOrganizationProfile(db, {
      actorId: "owner-1", organizationId: orgId, expectedVersion: 0,
      description: null, categories: [], specialties: [], serviceAreas: [],
      accessibilityNotes: null, openingHours: "{bad", province: null, provinceScheme: null,
      city: null, contactPreference: "platform_message", contactValue: null, consent: false,
    })).rejects.toThrow(/Opening hours/);
    expect(parseOpeningHours('{"mon":"8-14","tue":"closed"}')).toEqual({ mon: "8-14", tue: "closed" });
    expect(parseOpeningHours('{"funday":"8"}')).toBeNull();
    expect(parseOpeningHours("[\"mon\"]")).toBeNull();
  });

  it("an editorial curator may curate but never sees private contact nor grants initial publication", async () => {
    const db = await openRealDatabase();
    await baseWorld(db);
    const orgId = await seedOrg(db, "n07-curator");
    await seedMembership(db, orgId, "owner-1", "owner");
    await writeOrganizationProfile(db, {
      actorId: "owner-1", organizationId: orgId, expectedVersion: 0,
      description: "Curated farm", categories: ["boarding"], specialties: [], serviceAreas: [],
      accessibilityNotes: null, openingHours: null, province: "IR-23", provinceScheme: SCHEME, city: "Tehran",
      contactPreference: "phone", contactValue: "+98 900 000 0001", consent: true,
    });
    // The curator CAN update content but CANNOT see the private contact value.
    const curatorView = await managedOrganization(db, "editor-1", orgId);
    expect(curatorView).not.toBeNull();
    expect((curatorView?.organization as { contact_value: string | null }).contact_value).toBeNull();
    expect((curatorView?.permissions as { private_contact: boolean }).private_contact).toBe(false);
    // A curator re-save keeps the stored private contact untouched.
    const curated = await writeOrganizationProfile(db, {
      actorId: "editor-1", organizationId: orgId, expectedVersion: 1,
      description: "Curated description", categories: ["boarding"], specialties: [], serviceAreas: [],
      accessibilityNotes: null, openingHours: null, province: "IR-08", provinceScheme: SCHEME, city: "Karaj",
      contactPreference: "email", contactValue: "curator-should-not-set-this@example.com", consent: true,
    });
    expect(curated).toBe(true);
    const kept = await db.prepare("SELECT contact_value,contact_preference FROM organization_profiles WHERE organization_id=?").bind(orgId)
      .first<{ contact_value: string | null; contact_preference: string }>();
    expect(kept?.contact_value).toBe("+98 900 000 0001"); // untouched by the curator
    expect(kept?.contact_preference).toBe("phone");
    // An unrelated account sees no managed view at all.
    expect(await managedOrganization(db, "outsider-1", orgId)).toBeNull();
  });

  it("an editor cannot create the FIRST publication without current staff consent", async () => {
    const db = await openRealDatabase();
    await baseWorld(db);
    const orgId = await seedOrg(db, "n07-firstpub");
    // No membership at all: an editor cannot publish an unpublished org.
    const attempt = await writeOrganizationProfile(db, {
      actorId: "editor-1", organizationId: orgId, expectedVersion: 0,
      description: "Editor tries to publish", categories: [], specialties: [], serviceAreas: [],
      accessibilityNotes: null, openingHours: null, province: null, provinceScheme: null, city: null,
      contactPreference: "platform_message", contactValue: null, consent: true,
    });
    expect(attempt).toBe(false);
    const row = await db.prepare("SELECT publication_consent FROM organization_profiles WHERE organization_id=?").bind(orgId).first();
    expect(row).toBeNull(); // nothing was created
  });
});

describe("R98-N07 staff lifecycle", () => {
  async function inviteWorld(db: D1Database) {
    await baseWorld(db);
    const orgId = await seedOrg(db, "n07-staff");
    await seedMembership(db, orgId, "owner-1", "owner");
    return orgId;
  }

  it("invite → accept grants the membership; invitee cannot be current staff; no self-invitation", async () => {
    const db = await openRealDatabase();
    const orgId = await inviteWorld(db);
    await expect(inviteStaff(db, { actorId: "owner-1", organizationId: orgId, inviteeUserId: "owner-1", proposedRole: "member", note: null }))
      .rejects.toThrow(/cannot invite yourself/i);
    // An outsider cannot invite.
    expect(await inviteStaff(db, { actorId: "outsider-1", organizationId: orgId, inviteeUserId: "staff-1", proposedRole: "member", note: null })).toBeNull();
    const inviteId = await inviteStaff(db, { actorId: "owner-1", organizationId: orgId, inviteeUserId: "staff-1", proposedRole: "member", note: "Welcome" });
    expect(inviteId).not.toBeNull();
    // Only the invitee sees it as actionable.
    const mine = await myStaffInvites(db, "staff-1");
    expect(mine.length).toBe(1);
    expect(mine[0]?.actionable).toBe(1);
    // Someone else cannot respond to it.
    expect((await respondToInvite(db, { actorId: "outsider-1", inviteId: Number(inviteId), accept: true })).status).toBe("gone");
    const outcome = await respondToInvite(db, { actorId: "staff-1", inviteId: Number(inviteId), accept: true });
    expect(outcome.status).toBe("accepted");
    expect(outcome.membershipId).not.toBeNull();
    // Replay is refused.
    expect((await respondToInvite(db, { actorId: "staff-1", inviteId: Number(inviteId), accept: true })).status).toBe("gone");
    const membership = await db.prepare("SELECT role,status,revoked_at FROM organization_memberships WHERE organization_id=? AND user_id='staff-1'").bind(orgId)
      .first<{ role: string; status: string; revoked_at: string | null }>();
    expect(membership?.role).toBe("member");
    expect(membership?.status).toBe("active");
    expect(membership?.revoked_at).toBeNull();
    // Already-staff users cannot be invited again while current.
    expect(await inviteStaff(db, { actorId: "owner-1", organizationId: orgId, inviteeUserId: "staff-1", proposedRole: "manager", note: null })).toBeNull();
    // Audit exists.
    expect(await countRows(db, "audit_events", "action='organization.staff.invited'")).toBeGreaterThanOrEqual(1);
    expect(await countRows(db, "audit_events", "action='organization.staff.joined'")).toBe(1);
  });

  it("expired invites never grant membership; decline is honored", async () => {
    const db = await openRealDatabase();
    const orgId = await inviteWorld(db);
    const inviteId = await inviteStaff(db, { actorId: "owner-1", organizationId: orgId, inviteeUserId: "staff-1", proposedRole: "member", note: null });
    // Force-expire it.
    await db.prepare("UPDATE organization_staff_invites SET expires_at=datetime('now','-1 day') WHERE id=?").bind(inviteId).run();
    const outcome = await respondToInvite(db, { actorId: "staff-1", inviteId: Number(inviteId), accept: true });
    expect(outcome.status).toBe("expired");
    expect(await countRows(db, "organization_memberships", "organization_id=" + orgId + " AND user_id='staff-1'")).toBe(0);
    // A declined invite cannot be accepted afterwards.
    const invite2 = await inviteStaff(db, { actorId: "owner-1", organizationId: orgId, inviteeUserId: "staff-1", proposedRole: "member", note: null });
    expect((await respondToInvite(db, { actorId: "staff-1", inviteId: Number(invite2), accept: false })).status).toBe("declined");
    expect((await respondToInvite(db, { actorId: "staff-1", inviteId: Number(invite2), accept: true })).status).toBe("gone");
  });

  it("only a current owner may grant the owner role; nobody changes their own role; the last owner seat cannot be demoted", async () => {
    const db = await openRealDatabase();
    const orgId = await inviteWorld(db);
    await seedMembership(db, orgId, "manager-1", "manager");
    await seedMembership(db, orgId, "staff-1", "member");
    // Self-escalation is refused outright.
    await expect(changeStaffRole(db, { actorId: "manager-1", organizationId: orgId, targetUserId: "manager-1", newRole: "owner" }))
      .rejects.toThrow(/cannot change your own/i);
    // A manager cannot promote anyone to owner.
    expect(await changeStaffRole(db, { actorId: "manager-1", organizationId: orgId, targetUserId: "staff-1", newRole: "owner" })).toBe(false);
    // A manager CAN set ordinary roles.
    expect(await changeStaffRole(db, { actorId: "manager-1", organizationId: orgId, targetUserId: "staff-1", newRole: "manager" })).toBe(true);
    // The last owner seat cannot be demoted: self-change is refused outright,
    // and a manager cannot demote the only owner either.
    await expect(changeStaffRole(db, { actorId: "owner-1", organizationId: orgId, targetUserId: "owner-1", newRole: "member" }))
      .rejects.toThrow(/cannot change your own/i);
    expect(await changeStaffRole(db, { actorId: "manager-1", organizationId: orgId, targetUserId: "owner-1", newRole: "member" })).toBe(false);
    // With a second owner, succession works: owner promotes staff-1 (manager) to owner.
    expect(await changeStaffRole(db, { actorId: "owner-1", organizationId: orgId, targetUserId: "staff-1", newRole: "owner" })).toBe(true);
    // Now demoting the original owner is possible (another owner remains).
    expect(await changeStaffRole(db, { actorId: "staff-1", organizationId: orgId, targetUserId: "owner-1", newRole: "member" })).toBe(true);
    const roles = await db.prepare("SELECT user_id,role FROM organization_memberships WHERE organization_id=? ORDER BY user_id").bind(orgId).all();
    expect(roles.results?.map((r) => `${r.user_id}:${r.role}`).sort()).toEqual(["manager-1:manager", "owner-1:member", "staff-1:owner"]);
    expect(await countRows(db, "audit_events", "action='organization.staff.role_changed'")).toBeGreaterThanOrEqual(3);
  });

  it("ACCEPTANCE: a former employee cannot edit the organization or read new leads after revocation", async () => {
    const db = await openRealDatabase();
    const orgId = await inviteWorld(db);
    await seedMembership(db, orgId, "manager-1", "manager");
    await writeOrganizationProfile(db, {
      actorId: "manager-1", organizationId: orgId, expectedVersion: 0,
      description: "Before revocation", categories: ["boarding"], specialties: [], serviceAreas: [],
      accessibilityNotes: null, openingHours: null, province: "IR-23", provinceScheme: SCHEME, city: "Tehran",
      contactPreference: "platform_message", contactValue: "+98 900 111 2222", consent: true,
    });
    const version = (await db.prepare("SELECT row_version FROM organization_profiles WHERE organization_id=?").bind(orgId).first<{ row_version: number }>())?.row_version ?? 0;
    await seedLead(db, orgId, 1, 9001, "N07 lead for the org inbox");
    // Before revocation the manager sees the inbox and can edit.
    expect((await organizationInbox(db, "manager-1", orgId)).length).toBe(1);
    // Revocation by the owner.
    expect(await revokeStaffMembership(db, { actorId: "owner-1", organizationId: orgId, targetUserId: "manager-1", reason: "left the company" })).toBe(true);
    // After revocation: no inbox, no edit, no managed private view.
    expect((await organizationInbox(db, "manager-1", orgId)).length).toBe(0);
    const afterRevoke = await writeOrganizationProfile(db, {
      actorId: "manager-1", organizationId: orgId, expectedVersion: version,
      description: "After revocation attempt", categories: [], specialties: [], serviceAreas: [],
      accessibilityNotes: null, openingHours: null, province: null, provinceScheme: null, city: null,
      contactPreference: "platform_message", contactValue: null, consent: false,
    });
    expect(afterRevoke).toBe(false);
    const view = await managedOrganization(db, "manager-1", orgId);
    expect(view).toBeNull();
    // The owner still sees the inbox (authority intact) and the audit carries the revocation.
    expect((await organizationInbox(db, "owner-1", orgId)).length).toBe(1);
    expect(await countRows(db, "audit_events", "action='organization.staff.revoked'")).toBe(1);
    // Self-revocation is refused.
    await expect(revokeStaffMembership(db, { actorId: "owner-1", organizationId: orgId, targetUserId: "owner-1", reason: "self out" }))
      .rejects.toThrow(/cannot revoke your own/i);
  });

  it("ACCEPTANCE: one staff member in two businesses never leaks one inbox into the other", async () => {
    const db = await openRealDatabase();
    await baseWorld(db);
    const orgA = await seedOrg(db, "n07-org-a");
    const orgB = await seedOrg(db, "n07-org-b");
    await seedMembership(db, orgA, "owner-1", "owner");
    await seedMembership(db, orgB, "owner-1", "owner"); // the SAME person staffs both
    await seedMembership(db, orgA, "manager-1", "manager"); // manager only in A
    await seedLead(db, orgA, 1, 9101, "lead for A");
    await seedLead(db, orgA, 1, 9102, "another lead for A");
    await seedLead(db, orgB, 1, 9103, "lead for B");
    const inboxA = await organizationInbox(db, "owner-1", orgA);
    const inboxB = await organizationInbox(db, "owner-1", orgB);
    expect(inboxA.length).toBe(2);
    expect(inboxB.length).toBe(1);
    expect(inboxB.map((lead) => Number(lead.id))).toEqual([9103]);
    expect(inboxA.map((lead) => Number(lead.id)).sort()).toEqual([9101, 9102]);
    // The manager of A sees nothing from B.
    expect((await organizationInbox(db, "manager-1", orgA)).length).toBe(2);
    expect((await organizationInbox(db, "manager-1", orgB)).length).toBe(0);
    // An outsider sees nothing at all.
    expect((await organizationInbox(db, "outsider-1", orgA)).length).toBe(0);
    // Roster flags current vs former honestly.
    const roster = await organizationStaffRoster(db, "owner-1", orgA);
    expect(roster).not.toBeNull();
    const memberships = roster?.filter((entry) => entry.kind === "membership") ?? [];
    expect(memberships.find((entry) => entry.user_id === "manager-1")?.is_current).toBe(true);
  });

  it("an expired membership grants nothing (the former-employee rule covers expiry too)", async () => {
    const db = await openRealDatabase();
    const orgId = await inviteWorld(db);
    await seedMembership(db, orgId, "manager-1", "manager", { validUntil: "2020-01-02 00:00:00" }); // long expired
    await seedLead(db, orgId, 1, 9201, "expired member must not see this");
    expect((await organizationInbox(db, "manager-1", orgId)).length).toBe(0);
    const expiredWrite = await writeOrganizationProfile(db, {
      actorId: "manager-1", organizationId: orgId, expectedVersion: 0,
      description: "expired member write", categories: [], specialties: [], serviceAreas: [],
      accessibilityNotes: null, openingHours: null, province: null, provinceScheme: null, city: null,
      contactPreference: "platform_message", contactValue: null, consent: false,
    });
    expect(expiredWrite).toBe(false);
    expect(await managedOrganization(db, "manager-1", orgId)).toBeNull();
  });
});

describe("R98-N07 public card honesty + officials + credentials", () => {
  async function publicWorld(db: D1Database) {
    await baseWorld(db);
    const orgId = await seedOrg(db, "n07-public");
    await seedMembership(db, orgId, "owner-1", "owner");
    return orgId;
  }

  it("ACCEPTANCE: public cards expose consented data only, with honest location and credential states", async () => {
    const db = await openRealDatabase();
    const orgId = await publicWorld(db);
    // Unpublished: the card exists but exposes nothing beyond identity.
    const before = await publicOrganizationCard(db, orgId);
    const beforeOrg = before?.organization as Record<string, unknown>;
    expect(beforeOrg.published).toBe(false);
    expect(beforeOrg.description).toBeUndefined();
    expect(beforeOrg.service_categories).toBeUndefined();
    // Publish with a LEGACY (unconfirmed) province stored directly — the card
    // must report it honestly as needs-review, never as a canonical location.
    await writeOrganizationProfile(db, {
      actorId: "owner-1", organizationId: orgId, expectedVersion: 0,
      description: "Public description", categories: ["boarding"], specialties: ["endurance"], serviceAreas: ["IR-23"],
      accessibilityNotes: "Wheelchair ramp", openingHours: JSON.stringify({ sat: "09:00-13:00" }),
      province: "IR-23", provinceScheme: SCHEME, city: "Tehran",
      contactPreference: "platform_message", contactValue: "+98 900 333 4444", consent: true,
    });
    // Directly degrade the stored scheme to the legacy value (simulating an
    // unconfirmed historical row) — the card must fail closed, not display it.
    await db.prepare("UPDATE organization_profiles SET province_code='99',province_code_scheme='legacy_r97_unconfirmed' WHERE organization_id=?").bind(orgId).run();
    const card = await publicOrganizationCard(db, orgId);
    const org = card?.organization as Record<string, unknown>;
    expect(org.published).toBe(true);
    expect(org.description).toBe("Public description");
    expect(org.accessibility_notes).toBe("Wheelchair ramp");
    expect(org.opening_hours).toEqual({ sat: "09:00-13:00" });
    expect(org.province_code).toBeNull(); // unconfirmed scheme never surfaces as canonical
    expect(org.province_code_raw).toBe("99");
    expect(org.province_needs_review).toBe(true);
    // Private contact NEVER appears on the public card.
    expect(JSON.stringify(org)).not.toContain("+98 900 333 4444");
    expect(JSON.stringify(org)).not.toContain("contact_value");
  });

  it("credential periods on the public card are honest: expired and dates_not_recorded never read as current", async () => {
    const db = await openRealDatabase();
    const orgId = await publicWorld(db);
    await writeOrganizationProfile(db, {
      actorId: "owner-1", organizationId: orgId, expectedVersion: 0,
      description: null, categories: [], specialties: [], serviceAreas: [],
      accessibilityNotes: null, openingHours: null, province: null, provinceScheme: null, city: null,
      contactPreference: "platform_message", contactValue: null, consent: true,
    });
    // Expired credential, undated credential, and a platform_reviewed one.
    await createOrganizationCredential(db, { actorId: "owner-1", organizationId: orgId, role: "transport_permit", issuerName: "Road Authority", identifier: "TP-EXP", issuedAt: "2020-01-01", expiresAt: "2021-01-01", evidenceId: null });
    await createOrganizationCredential(db, { actorId: "owner-1", organizationId: orgId, role: "chamber_license", issuerName: "Chamber", identifier: "CH-NODATE", issuedAt: null, expiresAt: null, evidenceId: null });
    const noDateId = await createOrganizationCredential(db, { actorId: "owner-1", organizationId: orgId, role: "stable_license", issuerName: "Federation", identifier: "SL-CURRENT", issuedAt: "2025-01-01", expiresAt: "2030-01-01", evidenceId: null });
    expect(noDateId).not.toBeNull();
    const card = await publicOrganizationCard(db, orgId);
    const credentials = ((card?.organization as { credentials: Array<{ identifier?: string; period: string; verification_state: string }> }).credentials ?? []);
    const byPeriod = credentials.map((c) => c.period).sort();
    expect(byPeriod).toContain("expired");
    expect(byPeriod).toContain("dates_not_recorded");
    expect(byPeriod).toContain("within_recorded_dates");
    // Every credential shows unverified until platform review.
    expect(credentials.every((c) => c.verification_state === "unverified")).toBe(true);
    // Platform review marks exactly the current one; issuer_attested never comes from an editor.
    const rowVersion = (await db.prepare("SELECT row_version FROM organization_credentials WHERE id=?").bind(noDateId).first<{ row_version: number }>())?.row_version ?? 0;
    expect(await reviewOrganizationCredential(db, { actorId: "admin-1", credentialId: Number(noDateId), expectedVersion: rowVersion, decision: "platform_reviewed", note: "License verified against the registry copy" })).toBe(true);
    const after = await publicOrganizationCard(db, orgId);
    const reviewed = ((after?.organization as { credentials: Array<{ verification_state: string }> }).credentials ?? []);
    expect(reviewed.some((c) => c.verification_state === "platform_reviewed")).toBe(true);
    await expect(reviewOrganizationCredential(db, { actorId: "admin-1", credentialId: Number(noDateId), expectedVersion: rowVersion + 1, decision: "issuer_attested", note: "should be refused" }))
      .rejects.toThrow(/issuer-bound workflow/i);
  });

  it("officiating appointments require a CURRENT credential in the SAME role (judge/steward/ringmaster/dc stay distinct)", async () => {
    const db = await openRealDatabase();
    const orgId = await publicWorld(db);
    // Publish first — officials appear on the public card only with consent.
    await writeOrganizationProfile(db, {
      actorId: "owner-1", organizationId: orgId, expectedVersion: 0,
      description: null, categories: [], specialties: [], serviceAreas: [],
      accessibilityNotes: null, openingHours: null, province: null, provinceScheme: null, city: null,
      contactPreference: "platform_message", contactValue: null, consent: true,
    });
    // A person with judge credential currently valid, a steward credential expired.
    await db.exec(`
      INSERT INTO person_credentials(person_id,role,issuer_name,identifier,issued_at,expires_at,verification_state,created_by_user_id)
      VALUES (1,'judge','Federation','J-100','2025-01-01','2030-01-01','platform_reviewed','owner-1'),
             (1,'steward','Federation','S-200','2020-01-01','2021-01-01','platform_reviewed','owner-1'),
             (1,'ringmaster','Federation','R-300',NULL,NULL,'platform_reviewed','owner-1');
    `);
    const judgeId = (await db.prepare("SELECT id FROM person_credentials WHERE identifier='J-100'").first<{ id: number }>())?.id ?? 0;
    const stewardId = (await db.prepare("SELECT id FROM person_credentials WHERE identifier='S-200'").first<{ id: number }>())?.id ?? 0;
    const ringmasterId = (await db.prepare("SELECT id FROM person_credentials WHERE identifier='R-300'").first<{ id: number }>())?.id ?? 0;
    // Current judge credential → judge appointment works.
    expect(await appointOfficial(db, { actorId: "owner-1", organizationId: orgId, personId: 1, officialRole: "judge", credentialId: judgeId, validUntil: "2027-01-01", scopeNote: "National shows" })).not.toBeNull();
    // Expired steward credential → refused.
    await expect(appointOfficial(db, { actorId: "owner-1", organizationId: orgId, personId: 1, officialRole: "steward", credentialId: stewardId, validUntil: null, scopeNote: null }))
      .rejects.toThrow(/within its recorded dates/i);
    // Undated ringmaster credential → refused (dates_not_recorded is not current).
    await expect(appointOfficial(db, { actorId: "owner-1", organizationId: orgId, personId: 1, officialRole: "ringmaster", credentialId: ringmasterId, validUntil: null, scopeNote: null }))
      .rejects.toThrow(/within its recorded dates/i);
    // Role mismatch: a judge credential cannot appoint a steward.
    await expect(appointOfficial(db, { actorId: "owner-1", organizationId: orgId, personId: 1, officialRole: "steward", credentialId: judgeId, validUntil: null, scopeNote: null }))
      .rejects.toThrow(/same officiating role/i);
    // Non-staff cannot appoint (authority failure returns null, consistent
    // with the invite/credential authority pattern).
    expect(await appointOfficial(db, { actorId: "outsider-1", organizationId: orgId, personId: 1, officialRole: "judge", credentialId: judgeId, validUntil: null, scopeNote: null })).toBeNull();
    // The public card lists the judge appointment.
    const card = await publicOrganizationCard(db, orgId);
    const officials = ((card?.organization as { officials: Array<{ official_role: string }> }).officials ?? []);
    expect(officials).toEqual([{ official_role: "judge", scope_note: "National shows", valid_from: expect.any(String), valid_until: "2027-01-01" }]);
  });
});

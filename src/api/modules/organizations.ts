/**
 * R98-N07 — organization onboarding HTTP surface.
 *
 * Public card: consented data only, honest location/credential states.
 * Managed view + profile write: current staff or editorial curator, with the
 * SAME version/428 semantics as the person profile. Staff lifecycle:
 * invite/accept/decline, role change, revocation — all with CSRF, audit and
 * live membership checks. Inbox: current staff of THIS organization only.
 */
import { z } from "zod";
import { HttpError, json, readJson } from "../http";
import { requireAuth, requireCsrf, requirePermission } from "../../auth/guards";
import type { D1Database } from "@cloudflare/workers-types";

type Env = { DB: D1Database; SESSION_COOKIE_NAME: string };
import {
  writeOrganizationProfile, inviteStaff, respondToInvite, changeStaffRole, revokeStaffMembership,
  organizationInbox, appointOfficial, createOrganizationCredential, reviewOrganizationCredential,
  publicOrganizationCard, managedOrganization, organizationStaffRoster, myStaffInvites,
  ONBOARDING_POLICY_NOTE, parseOpeningHours, type StaffRole,
} from "../../organizations/onboarding";
import { isServiceCategoryId, isValidProvinceCode, isOfficiatingRoleId, PROVINCE_CODE_SCHEME } from "../../directory/vocabulary";

export async function getPublicOrganization(_request: Request, env: Env, organizationId: number): Promise<Response> {
  const card = await publicOrganizationCard(env.DB, organizationId);
  if (!card) throw new HttpError(404, "not_found", "Organization not found (or not active)");
  return json(card);
}

export async function getManagedOrganization(request: Request, env: Env, organizationId: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  const view = await managedOrganization(env.DB, auth.user.id, organizationId);
  if (!view) throw new HttpError(403, "organization_staff_required", "This account cannot manage the requested organization (current staff or editorial role required)");
  return json(view, { headers: { "Cache-Control": "private, no-store" } });
}

export async function getOrganizationStaff(request: Request, env: Env, organizationId: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  const roster = await organizationStaffRoster(env.DB, auth.user.id, organizationId);
  if (roster === null) throw new HttpError(403, "organization_staff_required", "This account cannot view the requested organization's staff");
  return json({ staff: roster, policy: ONBOARDING_POLICY_NOTE }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function getMyStaffInvites(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  const invites = await myStaffInvites(env.DB, auth.user.id);
  return json({ invites }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function getOrganizationInbox(request: Request, env: Env, organizationId: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  const organization = await env.DB.prepare("SELECT id FROM organizations WHERE id=? AND status='active'").bind(organizationId).first();
  if (!organization) throw new HttpError(404, "not_found", "Organization not found (or not active)");
  const leads = await organizationInbox(env.DB, auth.user.id, organizationId);
  return json({ leads, policy: "The lead inbox is visible to CURRENT staff of this organization only. A revoked or expired membership sees nothing, and one person staffing two businesses never sees one inbox inside the other." },
    { headers: { "Cache-Control": "private, no-store" } });
}

const OrgProfileSchema = z.object({
  description: z.string().trim().max(2000).nullable().optional(),
  service_categories: z.array(z.string().trim().min(2).max(40)).max(22).default([]),
  specialties: z.array(z.string().trim().min(2).max(60)).max(30).default([]),
  service_areas: z.array(z.string().trim().min(4).max(8)).max(31).default([]),
  accessibility_notes: z.string().trim().max(1000).nullable().optional(),
  opening_hours: z.string().max(1000).nullable().optional(),
  province_code: z.string().trim().max(8).nullable().optional(),
  province_code_scheme: z.string().max(80).optional(),
  city: z.string().trim().max(120).nullable().optional(),
  contact_preference: z.enum(["platform_message", "phone", "email"]).default("platform_message"),
  contact_value: z.string().trim().max(240).nullable().optional(),
  publication_consent: z.boolean(),
  expected_version: z.number().int().nonnegative().optional(),
});

export async function updateOrganizationProfile(request: Request, env: Env, organizationId: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  const organization = await env.DB.prepare("SELECT id FROM organizations WHERE id=? AND status='active'").bind(organizationId).first();
  if (!organization) throw new HttpError(404, "not_found", "Organization not found (or not active)");
  const parsed = OrgProfileSchema.safeParse(await readJson<unknown>(request, 24 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_profile", "Organization profile failed validation", parsed.error.flatten());
  const d = parsed.data;
  for (const category of d.service_categories)
    if (!isServiceCategoryId(category)) throw new HttpError(400, "invalid_category", `Unknown service category: ${category}`);
  for (const area of d.service_areas)
    if (!isValidProvinceCode(area)) throw new HttpError(400, "invalid_service_area", `Service area must be an approved province code (e.g. IR-08): ${area}`);
  if (d.opening_hours != null && d.opening_hours.trim() !== "" && parseOpeningHours(d.opening_hours) === null)
    throw new HttpError(400, "invalid_opening_hours", "Opening hours must be a weekday-to-text JSON object (mon..sun)");
  if (d.publication_consent && d.contact_preference == null)
    throw new HttpError(400, "invalid_profile", "A published organization needs a contact preference");
  if (d.province_code && d.province_code_scheme !== PROVINCE_CODE_SCHEME)
    throw new HttpError(400, "province_scheme_required", "Select the province again using the current reference dataset");
  const prior = await env.DB.prepare("SELECT row_version FROM organization_profiles WHERE organization_id=?").bind(organizationId).first<{ row_version: number }>();
  if (prior && d.expected_version === undefined) throw new HttpError(428, "profile_version_required", "Read the manageable organization profile and submit its exact row_version; updates cannot silently overwrite an unseen edit");
  const applied = await writeOrganizationProfile(env.DB, {
    actorId: auth.user.id, organizationId, expectedVersion: d.expected_version ?? 0,
    description: d.description ?? null, categories: d.service_categories, specialties: d.specialties,
    serviceAreas: d.service_areas, accessibilityNotes: d.accessibility_notes ?? null,
    openingHours: d.opening_hours ?? null, province: d.province_code || null,
    provinceScheme: d.province_code_scheme ?? null, city: d.city ?? null,
    contactPreference: d.contact_preference, contactValue: d.contact_value ?? null, consent: d.publication_consent,
  });
  if (!applied) throw new HttpError(409, "profile_conflict", "Organization profile or staff authority changed. Initial publication requires current staff consent.");
  const view = await managedOrganization(env.DB, auth.user.id, organizationId);
  return json({
    organization: view?.organization,
    contact_value_stored: view && (view.permissions as { private_contact?: boolean }).private_contact ? (view.organization as { contact_value?: string | null }).contact_value : null,
    publication: d.publication_consent ? "published" : "unpublished (consent not given or withdrawn)",
  });
}

const InviteSchema = z.object({
  invitee_user_id: z.string().trim().min(3).max(64),
  proposed_role: z.enum(["owner", "manager", "member"]),
  note: z.string().trim().max(500).nullable().optional(),
});

export async function createStaffInvite(request: Request, env: Env, organizationId: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  const parsed = InviteSchema.safeParse(await readJson<unknown>(request, 4 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_invite", "Invite failed validation", parsed.error.flatten());
  const id = await inviteStaff(env.DB, { actorId: auth.user.id, organizationId,
    inviteeUserId: parsed.data.invitee_user_id, proposedRole: parsed.data.proposed_role as StaffRole,
    note: parsed.data.note ?? null });
  if (!id) throw new HttpError(409, "invite_conflict", "You must be current staff (manager or owner) to invite; the owner role needs a current owner; the invitee must be an active non-staff user without a pending invite");
  const invite = await env.DB.prepare("SELECT id,organization_id,invitee_user_id,proposed_role,status,expires_at,created_at FROM organization_staff_invites WHERE id=?").bind(id).first();
  return json({ invite, policy: ONBOARDING_POLICY_NOTE }, { status: 201 });
}

const InviteResponseSchema = z.object({ accept: z.boolean() });

export async function respondToStaffInvite(request: Request, env: Env, inviteId: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  const parsed = InviteResponseSchema.safeParse(await readJson<unknown>(request, 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_response", "Response failed validation");
  const outcome = await respondToInvite(env.DB, { actorId: auth.user.id, inviteId, accept: parsed.data.accept });
  if (outcome.status === "gone") throw new HttpError(404, "not_found", "Invite not found or already answered");
  if (outcome.status === "revoked") throw new HttpError(409, "invite_revoked", "This invitation was revoked by the organization");
  if (outcome.status === "expired") throw new HttpError(410, "invite_expired", "This invitation expired; ask the organization for a new one");
  return json({ outcome });
}

const RoleChangeSchema = z.object({ new_role: z.enum(["owner", "manager", "member"]) });

export async function updateStaffRole(request: Request, env: Env, organizationId: number, targetUserId: string): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  const parsed = RoleChangeSchema.safeParse(await readJson<unknown>(request, 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_role", "Role failed validation");
  const applied = await changeStaffRole(env.DB, { actorId: auth.user.id, organizationId,
    targetUserId, newRole: parsed.data.new_role as StaffRole });
  if (!applied) throw new HttpError(409, "role_change_conflict", "Only a current owner may grant the owner role; a manager may set manager/member; you cannot change your own role; the last owner seat cannot be demoted");
  return json({ target_user_id: targetUserId, new_role: parsed.data.new_role });
}

const RevokeSchema = z.object({ reason: z.string().trim().min(3).max(500) });

export async function revokeStaff(request: Request, env: Env, organizationId: number, targetUserId: string): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  const parsed = RevokeSchema.safeParse(await readJson<unknown>(request, 2 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_revocation", "A revocation reason is required");
  const applied = await revokeStaffMembership(env.DB, { actorId: auth.user.id, organizationId,
    targetUserId, reason: parsed.data.reason });
  if (!applied) throw new HttpError(409, "revocation_conflict", "You must be current staff to revoke; an owner can only be revoked while another owner remains; you cannot revoke yourself");
  return json({ target_user_id: targetUserId, status: "revoked", note: "The former staff member loses every organization capability immediately (edits, inbox, billing) — memberships are evaluated live." });
}

const OfficialSchema = z.object({
  person_id: z.number().int().positive(),
  official_role: z.enum(["judge", "steward", "ringmaster", "dc"]),
  credential_id: z.number().int().positive(),
  valid_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD required").nullable().optional(),
  scope_note: z.string().trim().max(300).nullable().optional(),
});

export async function appointOrganizationOfficial(request: Request, env: Env, organizationId: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  const parsed = OfficialSchema.safeParse(await readJson<unknown>(request, 4 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_appointment", "Appointment failed validation", parsed.error.flatten());
  if (!isOfficiatingRoleId(parsed.data.official_role)) throw new HttpError(400, "invalid_appointment", "Official role must be one of the distinct officiating roles");
  const id = await appointOfficial(env.DB, { actorId: auth.user.id, organizationId,
    personId: parsed.data.person_id, officialRole: parsed.data.official_role,
    credentialId: parsed.data.credential_id, validUntil: parsed.data.valid_until ?? null,
    scopeNote: parsed.data.scope_note ?? null });
  if (!id) throw new HttpError(409, "appointment_conflict", "You must be current staff; judge, steward, ringmaster and disciplinary-committee appointments require a current credential in the same role");
  const appointment = await env.DB.prepare("SELECT id,organization_id,person_id,official_role,scope_note,valid_from,valid_until,credential_id FROM organization_official_appointments WHERE id=?").bind(id).first();
  return json({ appointment, note: "Official appointments are person-level officiating roles (judge/steward/ringmaster/disciplinary committee). They never substitute for organization staff roles." }, { status: 201 });
}

const OrgCredentialSchema = z.object({
  role: z.string().trim().min(2).max(40),
  issuer_name: z.string().trim().min(2).max(200),
  identifier: z.string().trim().min(1).max(120),
  issued_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD required").nullable().optional(),
  expires_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD required").nullable().optional(),
  evidence_media_id: z.string().trim().max(64).nullable().optional(),
});

export async function addOrganizationCredential(request: Request, env: Env, organizationId: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  const parsed = OrgCredentialSchema.safeParse(await readJson<unknown>(request, 8 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_credential", "Credential failed validation", parsed.error.flatten());
  const d = parsed.data;
  if (d.issued_at && d.expires_at && d.expires_at < d.issued_at) throw new HttpError(400, "invalid_credential", "Expiry precedes issue date");
  const id = await createOrganizationCredential(env.DB, { actorId: auth.user.id, organizationId,
    role: d.role, issuerName: d.issuer_name, identifier: d.identifier,
    issuedAt: d.issued_at ?? null, expiresAt: d.expires_at ?? null, evidenceId: d.evidence_media_id ?? null });
  if (!id) throw new HttpError(409, "credential_conflict", "Credential already exists, evidence is unavailable, or you are not current staff");
  const credential = await env.DB.prepare("SELECT id,organization_id,role,issuer_name,identifier,issued_at,expires_at,verification_state,row_version FROM organization_credentials WHERE id=?").bind(id).first();
  return json({ credential, verification_level: "unverified", note: "Self-declared organization credentials remain unverified until platform review. Issuer-bound attestation is a separate workflow." }, { status: 201 });
}

export async function reviewOrganizationCredentialEndpoint(request: Request, env: Env, credentialId: number): Promise<Response> {
  const auth = await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "claim.review");
  requireCsrf(request, auth);
  const parsed = z.object({ decision: z.enum(["platform_reviewed", "revoked", "issuer_attested"]),
    note: z.string().trim().min(3).max(500), expected_version: z.number().int().positive().optional() })
    .safeParse(await readJson<unknown>(request, 4 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_review", "Review failed validation", parsed.error.flatten());
  if (parsed.data.decision === "issuer_attested") throw new HttpError(409, "issuer_authority_required",
    "Platform staff cannot issue an external attestation. Issuer-bound attestation follows the N04/N05 issuer workflow.");
  const credential = await env.DB.prepare("SELECT id,row_version FROM organization_credentials WHERE id=?").bind(credentialId)
    .first<{ id: number; row_version: number }>();
  if (!credential) throw new HttpError(404, "not_found", "Credential not found");
  const applied = await reviewOrganizationCredential(env.DB, { actorId: auth.user.id, credentialId,
    expectedVersion: parsed.data.expected_version ?? credential.row_version,
    decision: parsed.data.decision as "platform_reviewed" | "revoked", note: parsed.data.note });
  if (!applied) throw new HttpError(409, "credential_conflict", "Credential or authority changed; revoked credentials cannot be re-reviewed");
  const after = await env.DB.prepare("SELECT id,organization_id,role,issuer_name,identifier,issued_at,expires_at,verification_state,verified_at,revoked_at,row_version FROM organization_credentials WHERE id=?").bind(credentialId).first();
  return json({ credential: after });
}

/** Exported for the route table: list my organization contexts (reuse). */
export async function myOrganizationContextsEndpoint(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  const { myOrganizationContexts } = await import("../../organizations/membershipPolicy");
  const contexts = await myOrganizationContexts(env.DB, auth.user.id);
  return json({ contexts, policy: ONBOARDING_POLICY_NOTE });
}

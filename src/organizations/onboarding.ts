/**
 * R98-N07 — the ONE organization onboarding command layer.
 *
 * Entity separation (the reviewed plan's core rule): a PERSON, a LOGIN
 * ACCOUNT, a LEGAL ORGANIZATION and a HORSE OWNER are different entities.
 * An organization acts through CURRENT memberships only — never because an
 * account once paid, never because of a generic registry staff role.
 *
 * Pinned behaviors (from the reviewed N07 ticket):
 *  - Organization profile read/edit/publication uses the SAME rules as person
 *    profiles: current authority, stored row_version on every update, first
 *    creation without expected_version, explicit province-scheme confirmation,
 *    private contact only for current staff, and publication consent that can
 *    never be granted by an editor who is not current staff.
 *  - Staff invitation/acceptance/expiry/role-change/revocation carry audit
 *    records and forbid self-escalation (you cannot invite yourself, you
 *    cannot change your own role, only a current owner may grant the owner
 *    role, and the last owner seat can never be revoked away).
 *  - A former employee (revoked/expired membership) can neither edit the
 *    organization nor read its leads — the current-membership predicate is
 *    evaluated live at write time AND read time, never cached.
 *  - The organization lead inbox is scoped per organization: a staff member
 *    in two businesses never sees one inbox inside the other.
 *  - Public cards expose consented data only and show unknown/unconfirmed
 *    location or credentials accurately (publicProvince + the fail-closed
 *    credential vocabulary — dates_not_recorded is never "active").
 *
 * SQL alias convention inside embedded subqueries: the shared
 * CURRENT_MEMBERSHIP_PREDICATE hardcodes aliases `m` (membership) and `o`
 * (organization). Outer queries here bind `o` to the MANAGED organization, so
 * every embedded subquery renames the organization alias to `mo` through
 * currentMembership("mo") — one helper, no predicate drift.
 */
import type { D1Database } from "@cloudflare/workers-types";
import { HttpError } from "../api/http";
import { CURRENT_MEMBERSHIP_PREDICATE } from "./membershipPolicy";
import { isValidProvinceCode, parseServiceCategories, PROVINCE_CODE_SCHEME, publicProvince } from "../directory/vocabulary";
import { credentialPeriod } from "../directory/credentialPolicy";

/** Staff may be invited as manager/member; the OWNER role is transfer-gated:
 * only a CURRENT owner may appoint another owner (succession), and platform
 * claim review remains a separate path (directory commands). */
export type StaffRole = "owner" | "manager" | "member";

export const STAFF_INVITE_TTL_DAYS = 14;

/** Editorial staff can curate published content but are NOT organization
 * staff: they may never grant initial publication consent and never see or
 * write the private contact route. */
const EDITOR_CURATOR = "u.is_active=1 AND u.role IN ('editor','admin','super_admin')";
const REVIEWER = "u.is_active=1 AND u.role IN ('admin','super_admin')";

/** The shared current-membership predicate with BOTH aliases renamed (the
 * fragment hardcodes `m` and `o`; embedded subqueries use their own aliases).
 * Word-boundary regexes never touch `am.`/`mo.` style aliases. */
function currentMembership(membershipAlias = "m", orgAlias = "o"): string {
  return CURRENT_MEMBERSHIP_PREDICATE.replace(/\bm\./g, `${membershipAlias}.`).replace(/\bo\./g, `${orgAlias}.`);
}

/** actor (alias u) is CURRENT staff of the organization row (alias o — the
 * organizations row always exists in both the write and managed paths, unlike
 * the LEFT-JOINed profile alias which is NULL before first creation). */
const CURRENT_STAFF = `EXISTS(SELECT 1 FROM organization_memberships m JOIN organizations mo ON mo.id=m.organization_id
      WHERE m.user_id=u.id AND m.organization_id=o.id AND ${currentMembership("m", "mo")})`;

export interface OrganizationProfileWrite {
    actorId: string;
    organizationId: number;
    expectedVersion: number;
    description: string | null;
    categories: string[];
    specialties: string[];
    serviceAreas: string[];
    accessibilityNotes: string | null;
    openingHours: string | null;
    province: string | null;
    provinceScheme: string | null;
    city: string | null;
    contactPreference: "platform_message" | "phone" | "email";
    contactValue: string | null;
    consent: boolean;
}

function validDateOnly(value: string | null): boolean {
    return value === null || /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** Opening hours: a compact JSON object of weekday -> text, or null. The shape
 * is validated here (not in SQL) so every frontend shares ONE parser. */
export function parseOpeningHours(value: string | null): Record<string, string> | null {
    if (value === null || value.trim() === "") return null;
    try {
        const parsed = JSON.parse(value) as unknown;
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
        const out: Record<string, string> = {};
        for (const [day, hours] of Object.entries(parsed as Record<string, unknown>)) {
            if (!/^(mon|tue|wed|thu|fri|sat|sun)$/.test(day) || typeof hours !== "string" || hours.length > 60) return null;
            out[day] = hours;
        }
        return Object.keys(out).length === 0 ? null : out;
    } catch {
        return null;
    }
}

/** The organization profile write — same trust rules as the person profile. */
export async function writeOrganizationProfile(db: D1Database, input: OrganizationProfileWrite): Promise<boolean> {
    if (input.province !== null && input.province !== "" && !isValidProvinceCode(input.province))
        throw new HttpError(422, "invalid_province_code", "Province code is not part of the current reference dataset");
    if (input.province && input.provinceScheme !== PROVINCE_CODE_SCHEME)
        throw new HttpError(422, "province_scheme_confirmation_required", "The province must be re-confirmed under the current reference dataset before it can be stored");
    for (const area of input.serviceAreas)
        if (!isValidProvinceCode(area)) throw new HttpError(422, "invalid_service_area", `Service area ${area} is not a current province code`);
    if (input.openingHours !== null && input.openingHours.trim() !== "" && parseOpeningHours(input.openingHours) === null)
        throw new HttpError(422, "invalid_opening_hours", "Opening hours must be a weekday-to-text JSON object");
    const province = input.province === "" ? null : input.province;
    const op = crypto.randomUUID();
    const consent = input.consent ? 1 : 0;
    const d = input;
    const [result] = await db.batch([
        db.prepare(`INSERT INTO organization_profiles(organization_id,description,service_categories,specialties,service_areas,
      accessibility_notes,opening_hours,province_code,province_code_scheme,city,contact_preference,contact_value,
      publication_consent,published_at,created_by_user_id,row_version,last_operation_id)
      SELECT o.id,?,?,?,?,?,?,?,?,?,CASE WHEN ${CURRENT_STAFF} THEN ? ELSE COALESCE((SELECT old.contact_preference FROM organization_profiles old WHERE old.organization_id=o.id),'platform_message') END,
        CASE WHEN ${CURRENT_STAFF} THEN ? ELSE (SELECT old.contact_value FROM organization_profiles old WHERE old.organization_id=o.id) END,
        ?,CASE WHEN ?=1 THEN CURRENT_TIMESTAMP ELSE NULL END,u.id,1,?
      FROM organizations o JOIN users u ON u.id=? WHERE o.id=? AND o.status='active' AND u.is_active=1
      AND (${CURRENT_STAFF} OR (${EDITOR_CURATOR}))
      AND (?=0 OR ${CURRENT_STAFF} OR EXISTS(SELECT 1 FROM organization_profiles old WHERE old.organization_id=o.id AND old.publication_consent=1))
      AND COALESCE((SELECT old.row_version FROM organization_profiles old WHERE old.organization_id=o.id),0)=?
      ON CONFLICT(organization_id) DO UPDATE SET description=excluded.description,
        service_categories=excluded.service_categories,specialties=excluded.specialties,service_areas=excluded.service_areas,
        accessibility_notes=excluded.accessibility_notes,opening_hours=excluded.opening_hours,
        province_code=excluded.province_code,province_code_scheme=excluded.province_code_scheme,city=excluded.city,
        contact_preference=excluded.contact_preference,contact_value=excluded.contact_value,
        publication_consent=excluded.publication_consent,
        published_at=CASE WHEN excluded.publication_consent=0 THEN NULL
          WHEN organization_profiles.publication_consent=1 THEN organization_profiles.published_at ELSE excluded.published_at END,
        updated_at=CURRENT_TIMESTAMP,row_version=organization_profiles.row_version+1,last_operation_id=excluded.last_operation_id
      WHERE organization_profiles.row_version=?`)
            .bind(d.description, JSON.stringify([...new Set(d.categories)]), JSON.stringify([...new Set(d.specialties)]),
                JSON.stringify([...new Set(d.serviceAreas)]), d.accessibilityNotes, d.openingHours, province,
                input.province ? PROVINCE_CODE_SCHEME : (d.provinceScheme ?? PROVINCE_CODE_SCHEME), d.city, d.contactPreference, d.contactValue,
                consent, consent, op, d.actorId, d.organizationId, consent, d.expectedVersion, d.expectedVersion),
        db.prepare(`INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
      SELECT ?,'organization.profile.updated','organization_profile',CAST(organization_id AS TEXT),'null',?,CURRENT_TIMESTAMP
      FROM organization_profiles WHERE organization_id=? AND last_operation_id=?`)
            .bind(d.actorId, JSON.stringify({ publication_consent: d.consent, categories: d.categories, specialties: d.specialties, service_areas: d.serviceAreas, operation_id: op }), d.organizationId, op),
    ]);
    return Number(result?.meta.changes ?? 0) === 1;
}

/** Invite staff. No self-invitation; a current manager may invite
 * manager/member; only a current OWNER may create an owner-succession invite;
 * the invitee must be an active user and not already current staff; pending
 * invites per organization are bounded. */
export async function inviteStaff(db: D1Database, input: {
    actorId: string; organizationId: number; inviteeUserId: string; proposedRole: StaffRole; note: string | null;
}): Promise<number | null> {
    if (input.inviteeUserId === input.actorId)
        throw new HttpError(422, "self_invitation_forbidden", "You cannot invite yourself to an organization");
    const op = crypto.randomUUID();
    const [result] = await db.batch([
        db.prepare(`INSERT INTO organization_staff_invites(organization_id,invitee_user_id,invited_by_user_id,proposed_role,note,expires_at,last_operation_id)
      SELECT o.id,invitee.id,inviter.id,?,?,datetime('now','+${STAFF_INVITE_TTL_DAYS} days'),?
      FROM organizations o JOIN users inviter ON inviter.id=? JOIN users invitee ON invitee.id=?
      WHERE o.id=? AND o.status='active' AND inviter.is_active=1 AND invitee.is_active=1
      AND EXISTS(SELECT 1 FROM organization_memberships m JOIN organizations mo ON mo.id=m.organization_id
        WHERE m.user_id=inviter.id AND m.organization_id=o.id AND ${currentMembership("m", "mo")}
          AND (m.role='owner' OR (m.role='manager' AND ?<>'owner')))
      AND NOT EXISTS(SELECT 1 FROM organization_memberships m JOIN organizations mo ON mo.id=m.organization_id
        WHERE m.user_id=invitee.id AND m.organization_id=o.id AND ${currentMembership("m", "mo")})
      AND (SELECT COUNT(*) FROM organization_staff_invites pi WHERE pi.organization_id=o.id AND pi.status='pending')<20
      AND NOT EXISTS(SELECT 1 FROM organization_staff_invites pi WHERE pi.organization_id=o.id AND pi.invitee_user_id=invitee.id AND pi.status='pending')`)
            .bind(input.proposedRole, input.note, op, input.actorId, input.inviteeUserId, input.organizationId, input.proposedRole),
        db.prepare(`INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
      SELECT ?,'organization.staff.invited','organization_staff_invite',CAST(id AS TEXT),'null',?,CURRENT_TIMESTAMP
      FROM organization_staff_invites WHERE last_operation_id=?`)
            .bind(input.actorId, JSON.stringify({ invitee_user_id: input.inviteeUserId, proposed_role: input.proposedRole, operation_id: op }), op),
    ]);
    if (Number(result?.meta.changes ?? 0) !== 1) return null;
    const row = await db.prepare("SELECT id FROM organization_staff_invites WHERE last_operation_id=?").bind(op).first<{ id: number }>();
    return row?.id ?? null;
}

/** The invitee accepts or declines. Acceptance grants the membership at the
 * invite's proposed role; expiry and revocation are honored; an already
 * answered invite cannot be replayed. */
export async function respondToInvite(db: D1Database, input: {
    actorId: string; inviteId: number; accept: boolean;
}): Promise<{ status: "accepted" | "declined" | "expired" | "revoked" | "gone"; membershipId: number | null }> {
    const op = crypto.randomUUID();
    const invite = await db.prepare(`SELECT id,organization_id,proposed_role,status,expires_at FROM organization_staff_invites
    WHERE id=? AND invitee_user_id=?`).bind(input.inviteId, input.actorId).first<{ id: number; organization_id: number; proposed_role: StaffRole; status: string; expires_at: string }>();
    if (!invite) return { status: "gone", membershipId: null };
    if (invite.status === "revoked") return { status: "revoked", membershipId: null };
    if (invite.status === "accepted" || invite.status === "declined") return { status: "gone", membershipId: null };
    const expired = await db.prepare(`SELECT 1 AS e WHERE datetime(?)<datetime('now')`).bind(invite.expires_at).first();
    if (expired) {
        await db.prepare(`UPDATE organization_staff_invites SET status='expired',responded_at=CURRENT_TIMESTAMP,row_version=row_version+1,last_operation_id=?
      WHERE id=? AND status='pending'`).bind(op, input.inviteId).run();
        return { status: "expired", membershipId: null };
    }
    if (!input.accept) {
        const [declined] = await db.batch([
            db.prepare(`UPDATE organization_staff_invites SET status='declined',responded_at=CURRENT_TIMESTAMP,row_version=row_version+1,last_operation_id=?
        WHERE id=? AND status='pending'`).bind(op, input.inviteId),
            db.prepare(`INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
        SELECT ?,'organization.staff.invite.declined','organization_staff_invite',CAST(id AS TEXT),'null',?,CURRENT_TIMESTAMP
        FROM organization_staff_invites WHERE id=? AND last_operation_id=?`)
                .bind(input.actorId, JSON.stringify({ operation_id: op }), input.inviteId, op),
        ]);
        return Number(declined?.meta.changes ?? 0) === 1 ? { status: "declined", membershipId: null } : { status: "gone", membershipId: null };
    }
    const [accepted] = await db.batch([
        db.prepare(`UPDATE organization_staff_invites SET status='accepted',accepted_at=CURRENT_TIMESTAMP,responded_at=CURRENT_TIMESTAMP,row_version=row_version+1,last_operation_id=?
      WHERE id=? AND status='pending' AND datetime(expires_at)>=datetime('now')`).bind(op, input.inviteId),
        db.prepare(`INSERT INTO organization_memberships(organization_id,user_id,role,status,valid_from,revoked_at,revoked_by_user_id,revoke_reason)
      SELECT i.organization_id,i.invitee_user_id,i.proposed_role,'active',CURRENT_TIMESTAMP,NULL,NULL,NULL
      FROM organization_staff_invites i JOIN organizations mo ON mo.id=i.organization_id
      WHERE i.id=? AND i.last_operation_id=? AND i.status='accepted' AND mo.status='active'
      ON CONFLICT(organization_id,user_id) DO UPDATE SET
        role=CASE WHEN organization_memberships.role='owner' THEN 'owner' ELSE excluded.role END,
        status='active',valid_from=excluded.valid_from,valid_until=NULL,
        revoked_at=NULL,revoked_by_user_id=NULL,revoke_reason=NULL`)
            .bind(input.inviteId, op),
        db.prepare(`UPDATE organization_staff_invites SET granted_membership_id=
      (SELECT m.id FROM organization_memberships m WHERE m.organization_id=organization_staff_invites.organization_id
        AND m.user_id=organization_staff_invites.invitee_user_id)
      WHERE id=? AND last_operation_id=?`).bind(input.inviteId, op),
        db.prepare(`INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
      SELECT ?,'organization.staff.joined','organization_membership',CAST(granted_membership_id AS TEXT),'null',?,CURRENT_TIMESTAMP
      FROM organization_staff_invites WHERE id=? AND last_operation_id=?`)
            .bind(input.actorId, JSON.stringify({ invite_id: input.inviteId, operation_id: op }), input.inviteId, op),
    ]);
    if (Number(accepted?.meta.changes ?? 0) !== 1) return { status: "gone", membershipId: null };
    const row = await db.prepare("SELECT granted_membership_id FROM organization_staff_invites WHERE id=?").bind(input.inviteId).first<{ granted_membership_id: number | null }>();
    return { status: "accepted", membershipId: row?.granted_membership_id ?? null };
}

/** Change a staff role. No self-escalation: you cannot change your own role;
 * only a current OWNER may set the owner role on someone else; and demoting
 * the last active owner is refused. */
export async function changeStaffRole(db: D1Database, input: {
    actorId: string; organizationId: number; targetUserId: string; newRole: StaffRole;
}): Promise<boolean> {
    if (input.targetUserId === input.actorId)
        throw new HttpError(422, "self_role_change_forbidden", "You cannot change your own organization role; ask another owner");
    const op = crypto.randomUUID();
    const [result] = await db.batch([
        db.prepare(`UPDATE organization_memberships SET role=?,last_operation_id=?
      WHERE organization_id=? AND user_id=? AND status='active' AND revoked_at IS NULL
        AND (valid_until IS NULL OR datetime(valid_until)>datetime('now'))
        AND EXISTS(SELECT 1 FROM organization_memberships am JOIN organizations mo ON mo.id=am.organization_id
          WHERE am.user_id=? AND am.organization_id=organization_memberships.organization_id AND ${currentMembership("am", "mo")}
            AND (am.role='owner' OR (am.role='manager' AND ?<>'owner')))
        AND (SELECT COUNT(*) FROM organization_memberships owners WHERE owners.organization_id=organization_memberships.organization_id
            AND owners.role='owner' AND owners.status='active' AND owners.revoked_at IS NULL
            AND (owners.valid_until IS NULL OR datetime(owners.valid_until)>datetime('now')))
          - CASE WHEN organization_memberships.role='owner' AND ?<>'owner' THEN 1 ELSE 0 END >= 1`)
            .bind(input.newRole, op, input.organizationId, input.targetUserId, input.actorId, input.newRole, input.newRole),
        db.prepare(`INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
      SELECT ?,'organization.staff.role_changed','organization_membership',CAST(id AS TEXT),'null',?,CURRENT_TIMESTAMP
      FROM organization_memberships WHERE organization_id=? AND user_id=? AND status='active' AND revoked_at IS NULL`)
            .bind(input.actorId, JSON.stringify({ target_user_id: input.targetUserId, new_role: input.newRole, operation_id: op }), input.organizationId, input.targetUserId),
    ]);
    return Number(result?.meta.changes ?? 0) === 1;
}

/** Revoke staff membership. The former employee loses every org capability
 * immediately — the live predicate sees revoked_at. A current staff member
 * may revoke ordinary staff; revoking an OWNER requires a remaining owner
 * seat besides the target (the last owner seat can never be revoked away). */
export async function revokeStaffMembership(db: D1Database, input: {
    actorId: string; organizationId: number; targetUserId: string; reason: string;
}): Promise<boolean> {
    if (input.targetUserId === input.actorId)
        throw new HttpError(422, "self_revocation_forbidden", "You cannot revoke your own membership; ask another owner, or transfer ownership first");
    const op = crypto.randomUUID();
    const [result] = await db.batch([
        db.prepare(`UPDATE organization_memberships SET status='revoked',revoked_at=CURRENT_TIMESTAMP,revoked_by_user_id=?,revoke_reason=?,last_operation_id=?
      WHERE organization_id=? AND user_id=? AND status='active' AND revoked_at IS NULL
        AND EXISTS(SELECT 1 FROM organization_memberships am JOIN organizations mo ON mo.id=am.organization_id
          WHERE am.user_id=? AND am.organization_id=organization_memberships.organization_id AND ${currentMembership("am", "mo")})
        AND (organization_memberships.role<>'owner' OR (SELECT COUNT(*) FROM organization_memberships owners WHERE owners.organization_id=organization_memberships.organization_id
            AND owners.role='owner' AND owners.status='active' AND owners.revoked_at IS NULL
            AND (owners.valid_until IS NULL OR datetime(owners.valid_until)>datetime('now'))) >= 2)`)
            .bind(input.actorId, input.reason, op, input.organizationId, input.targetUserId, input.actorId),
        db.prepare(`INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
      SELECT ?,'organization.staff.revoked','organization_membership',CAST(id AS TEXT),'null',?,CURRENT_TIMESTAMP
      FROM organization_memberships WHERE organization_id=? AND user_id=? AND status='revoked' AND revoked_by_user_id=?`)
            .bind(input.actorId, JSON.stringify({ target_user_id: input.targetUserId, reason: input.reason, operation_id: op }), input.organizationId, input.targetUserId, input.actorId),
    ]);
    return Number(result?.meta.changes ?? 0) === 1;
}

/** The organization lead inbox — readable ONLY by current staff of THIS
 * organization. One person staffing two businesses sees each inbox strictly
 * separately (the query is scoped by organization_id + live membership). */
export async function organizationInbox(db: D1Database, actorId: string, organizationId: number, limit = 50): Promise<Array<Record<string, unknown>>> {
    const rows = await db.prepare(`SELECT sr.id,sr.requester_user_id,sr.category,sr.province_code,sr.city,sr.horse_id,sr.share_contact,
    sr.status,sr.created_at,sr.first_response_at
    FROM service_requests sr
    WHERE sr.provider_organization_id=?
      AND EXISTS(SELECT 1 FROM organization_memberships m JOIN organizations mo ON mo.id=m.organization_id
        WHERE m.user_id=? AND m.organization_id=sr.provider_organization_id AND ${currentMembership("m", "mo")})
    ORDER BY sr.created_at DESC LIMIT ?`)
        .bind(organizationId, actorId, Math.min(Math.max(limit, 1), 100)).all<Record<string, unknown>>();
    return (rows.results ?? []).map((row) => ({ ...row, id: Number(row.id) }));
}

/** Appoint an official (judge/steward/ringmaster/dc). The person must hold a
 * credential in the SAME officiating role that is currently within its
 * recorded dates (dates_not_recorded/expired/revoked/invalid never qualify). */
export async function appointOfficial(db: D1Database, input: {
    actorId: string; organizationId: number; personId: number; officialRole: "judge" | "steward" | "ringmaster" | "dc";
    credentialId: number; validUntil: string | null; scopeNote: string | null;
}): Promise<number | null> {
    if (input.validUntil !== null && !validDateOnly(input.validUntil))
        throw new HttpError(422, "invalid_date", "valid_until must be a YYYY-MM-DD date or null");
    const credential = await db.prepare(`SELECT c.id,c.person_id,c.role,c.issued_at,c.expires_at,c.revoked_at,c.verification_state
    FROM person_credentials c JOIN people p ON p.id=c.person_id
    WHERE c.id=? AND c.person_id=? AND p.deleted_at IS NULL`).bind(input.credentialId, input.personId)
        .first<{ id: number; person_id: number; role: string; issued_at: string | null; expires_at: string | null; revoked_at: string | null; verification_state: string }>();
    if (!credential || credential.role !== input.officialRole)
        throw new HttpError(422, "credential_role_mismatch", "The credential must be in the same officiating role as the appointment");
    if (credentialPeriod(credential) !== "within_recorded_dates")
        throw new HttpError(422, "credential_not_current", "Only a credential within its recorded dates qualifies for an official appointment (dates_not_recorded, expired, revoked and invalid dates never qualify)");
    const op = crypto.randomUUID();
    const [result] = await db.batch([
        db.prepare(`INSERT INTO organization_official_appointments(organization_id,person_id,official_role,scope_note,valid_until,credential_id,appointed_by_user_id,last_operation_id)
      SELECT o.id,?,?,?,?,?,u.id,?
      FROM organizations o JOIN users u ON u.id=?
      WHERE o.id=? AND o.status='active' AND u.is_active=1
        AND EXISTS(SELECT 1 FROM organization_memberships m JOIN organizations mo ON mo.id=m.organization_id
          WHERE m.user_id=u.id AND m.organization_id=o.id AND ${currentMembership("m", "mo")})
      ON CONFLICT(organization_id,person_id,official_role) DO UPDATE SET
        scope_note=excluded.scope_note,valid_until=excluded.valid_until,credential_id=excluded.credential_id,
        revoked_at=NULL,revoked_by_user_id=NULL,revoke_reason=NULL,appointed_by_user_id=excluded.appointed_by_user_id,
        row_version=organization_official_appointments.row_version+1,last_operation_id=excluded.last_operation_id
      WHERE organization_official_appointments.revoked_at IS NOT NULL`)
            .bind(input.personId, input.officialRole, input.scopeNote, input.validUntil, input.credentialId, op, input.actorId, input.organizationId),
        db.prepare(`INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
      SELECT ?,'organization.official.appointed','organization_official_appointment',CAST(id AS TEXT),'null',?,CURRENT_TIMESTAMP
      FROM organization_official_appointments WHERE last_operation_id=?`)
            .bind(input.actorId, JSON.stringify({ person_id: input.personId, official_role: input.officialRole, credential_id: input.credentialId, operation_id: op }), op),
    ]);
    if (Number(result?.meta.changes ?? 0) !== 1) return null;
    const row = await db.prepare("SELECT id FROM organization_official_appointments WHERE last_operation_id=?").bind(op).first<{ id: number }>();
    return row?.id ?? null;
}

/** Record organization credential evidence (self-declared first). */
export async function createOrganizationCredential(db: D1Database, input: {
    actorId: string; organizationId: number; role: string; issuerName: string; identifier: string;
    issuedAt: string | null; expiresAt: string | null; evidenceId: string | null;
}): Promise<number | null> {
    if (!validDateOnly(input.issuedAt) || !validDateOnly(input.expiresAt))
        throw new HttpError(422, "invalid_date", "Credential dates must be YYYY-MM-DD or null");
    const op = crypto.randomUUID();
    const [result] = await db.batch([
        db.prepare(`INSERT INTO organization_credentials(organization_id,role,issuer_name,identifier,issued_at,expires_at,evidence_media_id,verification_state,created_by_user_id,last_operation_id)
      SELECT o.id,?,?,?,?,?,?,'unverified',u.id,?
      FROM organizations o JOIN users u ON u.id=?
      WHERE o.id=? AND o.status='active' AND u.is_active=1
        AND EXISTS(SELECT 1 FROM organization_memberships m JOIN organizations mo ON mo.id=m.organization_id
          WHERE m.user_id=u.id AND m.organization_id=o.id AND ${currentMembership("m", "mo")})
        AND (CAST(? AS TEXT) IS NULL OR EXISTS(SELECT 1 FROM horse_media e WHERE e.id=? AND e.uploaded_by_user_id=u.id
          AND e.media_type='document' AND e.quarantined_at IS NULL))
        AND NOT EXISTS(SELECT 1 FROM organization_credentials prior WHERE prior.organization_id=o.id AND prior.role=? AND prior.identifier=?)`)
            .bind(input.role, input.issuerName, input.identifier, input.issuedAt, input.expiresAt, input.evidenceId, op, input.actorId, input.organizationId, input.evidenceId, input.evidenceId, input.role, input.identifier),
        db.prepare(`INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
      SELECT created_by_user_id,'organization.credential.self_declared','organization_credential',CAST(id AS TEXT),'null',?,CURRENT_TIMESTAMP
      FROM organization_credentials WHERE last_operation_id=?`)
            .bind(JSON.stringify({ role: input.role, verification_state: "unverified", operation_id: op }), op),
    ]);
    if (Number(result?.meta.changes ?? 0) !== 1) return null;
    const row = await db.prepare("SELECT id FROM organization_credentials WHERE last_operation_id=?").bind(op).first<{ id: number }>();
    return row?.id ?? null;
}

/** Platform review of an organization credential — the same fail-closed rule
 * as person credentials: a reviewer can mark platform_reviewed or revoked,
 * and issuer_attested stays reserved for the issuer-bound workflow (N04/N05). */
export async function reviewOrganizationCredential(db: D1Database, input: {
    actorId: string; credentialId: number; expectedVersion: number; decision: "platform_reviewed" | "revoked" | "issuer_attested" | (string & {}); note: string;
}): Promise<boolean> {
    const op = crypto.randomUUID();
    if (!["platform_reviewed", "revoked"].includes(input.decision))
        throw new HttpError(422, "invalid_decision", "Issuer attestation requires the separate issuer-bound workflow");
    const revoke = input.decision === "revoked" ? 1 : 0;
    const [result] = await db.batch([
        db.prepare(`UPDATE organization_credentials SET
      verification_state=CASE WHEN ?=1 THEN verification_state ELSE 'platform_reviewed' END,
      verified_by_user_id=CASE WHEN ?=1 THEN verified_by_user_id ELSE ? END,
      verified_at=CASE WHEN ?=1 THEN verified_at ELSE CURRENT_TIMESTAMP END,
      revoked_at=CASE WHEN ?=1 THEN CURRENT_TIMESTAMP ELSE revoked_at END,
      revoked_by_user_id=CASE WHEN ?=1 THEN ? ELSE revoked_by_user_id END,
      revoke_reason=CASE WHEN ?=1 THEN ? ELSE revoke_reason END,
      row_version=row_version+1,last_operation_id=?
      WHERE id=? AND row_version=? AND revoked_at IS NULL
      AND EXISTS(SELECT 1 FROM users u WHERE u.id=? AND ${REVIEWER})`)
            .bind(revoke, revoke, input.actorId, revoke, revoke, revoke, input.actorId, revoke, input.note, op, input.credentialId, input.expectedVersion, input.actorId),
        db.prepare(`INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
      SELECT ?,?,'organization_credential',CAST(id AS TEXT),'null',?,CURRENT_TIMESTAMP
      FROM organization_credentials WHERE id=? AND last_operation_id=?`)
            .bind(input.actorId, `organization.credential.${input.decision}`, JSON.stringify({ decision: input.decision, note: input.note, operation_id: op }), input.credentialId, op),
    ]);
    return Number(result?.meta.changes ?? 0) === 1;
}

/** The public organization card — consented data only, honest location and
 * credential states (publicProvince + fail-closed verification levels). */
export async function publicOrganizationCard(db: D1Database, organizationId: number): Promise<Record<string, unknown> | null> {
    const row = await db.prepare(`SELECT o.id,o.slug,o.name_native,o.name_latin,o.kind,
    op.description,op.service_categories,op.specialties,op.service_areas,op.accessibility_notes,op.opening_hours,
    op.province_code,op.province_code_scheme,op.city,op.publication_consent,op.published_at
    FROM organizations o LEFT JOIN organization_profiles op ON op.organization_id=o.id
    WHERE o.id=? AND o.status='active'`).bind(organizationId).first<{
        id: number; slug: string; name_native: string | null; name_latin: string | null; kind: string;
        description: string | null; service_categories: string | null; specialties: string | null; service_areas: string | null;
        accessibility_notes: string | null; opening_hours: string | null; province_code: string | null;
        province_code_scheme: string | null; city: string | null; publication_consent: number; published_at: string | null;
    }>();
    if (!row) return null;
    const consented = row.publication_consent === 1 && row.published_at !== null;
    const credentials = await db.prepare(`SELECT role,issuer_name,identifier,issued_at,expires_at,revoked_at,verification_state
    FROM organization_credentials WHERE organization_id=? AND revoked_at IS NULL ORDER BY id`).bind(organizationId)
        .all<{ role: string; issuer_name: string; identifier: string; issued_at: string | null; expires_at: string | null; revoked_at: string | null; verification_state: string }>();
    const officials = await db.prepare(`SELECT a.official_role,a.scope_note,a.valid_from,a.valid_until
    FROM organization_official_appointments a
    WHERE a.organization_id=? AND a.revoked_at IS NULL ORDER BY a.official_role`).bind(organizationId)
        .all<{ official_role: string; scope_note: string | null; valid_from: string; valid_until: string | null }>();
    return {
        organization: {
            id: row.id, slug: row.slug, name_native: row.name_native, name_latin: row.name_latin, kind: row.kind,
            ...(consented ? {
                description: row.description,
                service_categories: parseServiceCategories(row.service_categories),
                specialties: parseServiceCategories(row.specialties),
                service_areas: parseServiceCategories(row.service_areas),
                accessibility_notes: row.accessibility_notes,
                opening_hours: parseOpeningHours(row.opening_hours),
                city: row.city,
                ...publicProvince(row.province_code, row.province_code_scheme),
                // Honest credential states: issuer labels without issuer-bound
                // evidence fail closed to unverified; period is reported, never
                // assumed (dates_not_recorded is never "currently qualified").
                credentials: (credentials.results ?? []).map((c) => ({
                    role: c.role, issuer_name: c.issuer_name,
                    verification_state: c.verification_state === "platform_reviewed" ? "platform_reviewed" : "unverified",
                    period: credentialPeriod(c),
                })),
                officials: (officials.results ?? []).map((a) => ({
                    official_role: a.official_role, scope_note: a.scope_note,
                    valid_from: a.valid_from, valid_until: a.valid_until,
                })),
            } : {}),
            published: consented,
        },
    };
}

/** The managed (staff/curator) view of an organization for the editor UI. */
export async function managedOrganization(db: D1Database, actorId: string, organizationId: number): Promise<Record<string, unknown> | null> {
    const row = await db.prepare(`SELECT o.id,o.slug,o.name_native,o.name_latin,o.kind,o.status,
    COALESCE(op.row_version,0) AS row_version,op.description,op.service_categories,op.specialties,op.service_areas,
    op.accessibility_notes,op.opening_hours,op.province_code,op.province_code_scheme,op.city,
    COALESCE(op.contact_preference,'platform_message') AS contact_preference,
    CASE WHEN ${CURRENT_STAFF} THEN op.contact_value ELSE NULL END AS contact_value,
    COALESCE(op.publication_consent,0) AS publication_consent,op.published_at,
    CASE WHEN ${CURRENT_STAFF} THEN 1 ELSE 0 END AS is_current_staff
    FROM organizations o LEFT JOIN organization_profiles op ON op.organization_id=o.id, users u
    WHERE o.id=? AND u.id=? AND u.is_active=1 AND (u.role IN ('editor','admin','super_admin')
      OR ${CURRENT_STAFF})`)
        .bind(organizationId, actorId).first<Record<string, unknown>>();
    if (!row) return null;
    return {
        organization: {
            id: Number(row.id), slug: row.slug as string, name_native: row.name_native as string | null,
            name_latin: row.name_latin as string | null, kind: row.kind as string, status: row.status as string,
            row_version: Number(row.row_version ?? 0),
            description: row.description ?? null,
            service_categories: parseServiceCategories(row.service_categories as string | null),
            specialties: parseServiceCategories(row.specialties as string | null),
            service_areas: parseServiceCategories(row.service_areas as string | null),
            accessibility_notes: row.accessibility_notes ?? null,
            opening_hours: parseOpeningHours(row.opening_hours as string | null),
            ...publicProvince(row.province_code as string | null, row.province_code_scheme as string | null),
            city: (row.city as string | null) ?? null,
            contact_preference: row.contact_preference as string,
            contact_value: (row.contact_value as string | null) ?? null,
            publication_consent: Number(row.publication_consent ?? 0) === 1,
            published_at: (row.published_at as string | null) ?? null,
        },
        permissions: {
            edit: true,
            initial_publication: Number(row.is_current_staff ?? 0) === 1,
            private_contact: Number(row.is_current_staff ?? 0) === 1,
        },
        current_province_scheme: PROVINCE_CODE_SCHEME,
    };
}

/** Staff roster for the manage view: memberships (current flagged live) and
 * pending/answered invites — the full lifecycle in one honest listing. */
export async function organizationStaffRoster(db: D1Database, actorId: string, organizationId: number): Promise<Array<Record<string, unknown>> | null> {
    const allowed = await db.prepare(`SELECT 1 FROM users u
    WHERE u.id=? AND u.is_active=1 AND (u.role IN ('editor','admin','super_admin')
      OR EXISTS(SELECT 1 FROM organization_memberships m JOIN organizations mo ON mo.id=m.organization_id
        WHERE m.user_id=u.id AND m.organization_id=? AND ${currentMembership("m", "mo")}))`)
        .bind(actorId, organizationId).first();
    if (!allowed) return null;
    const staff = await db.prepare(`SELECT m.user_id,u.email,m.role,m.status,m.valid_from,m.valid_until,m.revoked_at,m.revoke_reason,
    CASE WHEN m.status='active' AND m.revoked_at IS NULL AND mo.status='active'
      AND datetime(m.valid_from)<=datetime('now') AND (m.valid_until IS NULL OR datetime(m.valid_until)>datetime('now'))
      THEN 1 ELSE 0 END AS is_current
    FROM organization_memberships m JOIN organizations mo ON mo.id=m.organization_id JOIN users u ON u.id=m.user_id
    WHERE m.organization_id=?
    ORDER BY CASE WHEN m.status='active' AND m.revoked_at IS NULL THEN 0 ELSE 1 END, m.user_id LIMIT 200`).bind(organizationId)
        .all<Record<string, unknown>>();
    const invites = await db.prepare(`SELECT i.id,i.invitee_user_id,u.email,i.proposed_role,i.status,i.expires_at,i.created_at
    FROM organization_staff_invites i JOIN users u ON u.id=i.invitee_user_id
    WHERE i.organization_id=? ORDER BY i.id DESC LIMIT 50`).bind(organizationId).all<Record<string, unknown>>();
    return [
        ...(staff.results ?? []).map((s) => ({ kind: "membership", ...s, is_current: Number(s.is_current ?? 0) === 1 })),
        ...(invites.results ?? []).map((i) => ({ kind: "invite", ...i })),
    ];
}

/** My invites (any organization) for the invitee UI — pending ones flagged
 * actionable only while unexpired. */
export async function myStaffInvites(db: D1Database, actorId: string): Promise<Array<Record<string, unknown>>> {
    const rows = await db.prepare(`SELECT i.id,i.organization_id,o.name_native,o.name_latin,i.proposed_role,i.status,i.note,i.expires_at,i.created_at,
    CASE WHEN i.status='pending' AND datetime(i.expires_at)>=datetime('now') THEN 1 ELSE 0 END AS actionable
    FROM organization_staff_invites i JOIN organizations o ON o.id=i.organization_id JOIN users u ON u.id=i.invitee_user_id
    WHERE i.invitee_user_id=? AND u.is_active=1
    ORDER BY CASE WHEN i.status='pending' THEN 0 ELSE 1 END, i.id DESC LIMIT 100`).bind(actorId)
        .all<Record<string, unknown>>();
    return rows.results ?? [];
}

export const ONBOARDING_POLICY_NOTE = "Organization authority is evaluated live from CURRENT memberships only. A former employee (revoked or expired) can neither edit the organization nor read its leads. One staff member in two businesses sees each inbox strictly separately. Owner succession and owner-role grants require a current owner; nobody can invite, promote or demote themselves. Public cards show consented data only, with unknown or unconfirmed locations and credentials labeled honestly — dates_not_recorded is never treated as currently qualified.";

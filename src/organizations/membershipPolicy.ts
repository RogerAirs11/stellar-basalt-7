/**
 * R95-N07: the ONE organization-membership policy.
 *
 * Entity separation (the review's core ask): a PERSON (directory), a LOGIN
 * ACCOUNT (users), a LEGAL ORGANIZATION and a HORSE OWNER are different
 * entities. A membership authorizes a login account to act for an
 * organization ONLY while the membership is CURRENT — never because the
 * account once paid, and never because of a generic registry staff role.
 *
 * What "current" means (ALL must hold — one predicate, used everywhere):
 *   status='active' AND revoked_at IS NULL AND organization status='active'
 *   AND valid_from <= now AND (valid_until IS NULL OR valid_until > now)
 * A FUTURE membership (valid_from > now) grants nothing yet; an EXPIRED or
 * REVOKED membership grants nothing anymore.
 *
 * Capability mapping over the org's own role vocabulary:
 *   owner   -> billing_manager + workspace_manager + ordinary_staff
 *   manager -> billing_manager + workspace_manager + ordinary_staff
 *   member  -> ordinary_staff (org conveniences only; NO private management)
 * This module deliberately does NOT touch horse representation grants
 * (0034 representation machinery) or service-provider mandates — those are
 * separate policies with their own governance.
 *
 * Payer-leaves policy: an organization-held entitlement (holder_key
 * 'org:<id>') stays valid for the ORGANIZATION regardless of who paid. A
 * departing payer loses org-context discovery and every org capability the
 * moment their membership stops being current, but keeps PERSONAL payment
 * evidence for orders they bought (buyer_user_id is theirs). Money history
 * is never rewritten by membership changes.
 *
 * Ordinary staff privacy boundary: ordinary_staff may SEE which org
 * conveniences are active (product + expiry; no amounts — the entitlements
 * table carries none), but never organization invoices/totals, and never
 * private workspaces they have no assignment for.
 */
import type { D1Database } from "@cloudflare/workers-types";
import { HttpError } from "../api/http";

export type OrgCapability = "billing_manager" | "workspace_manager" | "ordinary_staff";

export interface CurrentMembership {
  organization_id: number;
  organization_name: string | null;
  role: "owner" | "manager" | "member";
  capabilities: OrgCapability[];
  valid_from: string;
  valid_until: string | null;
}

/**
 * The single SQL predicate for a CURRENT membership, embedded by command
 * builders (paymentCommands, workspaces) and this module's queries so the
 * rule can never drift between read and write paths. `?` placeholders are
 * bound IN ORDER: (user_id, organization_id) — callers interpolate this
 * fragment where the enclosing statement already binds those two values.
 */
export const CURRENT_MEMBERSHIP_PREDICATE = `m.status='active' AND m.revoked_at IS NULL AND o.status='active'
      AND datetime(m.valid_from)<=datetime('now') AND (m.valid_until IS NULL OR datetime(m.valid_until)>datetime('now'))`;

export function capabilitiesForRole(role: string): OrgCapability[] {
  if (role === "owner" || role === "manager") return ["billing_manager", "workspace_manager", "ordinary_staff"];
  return ["ordinary_staff"];
}

/** The caller's CURRENT membership in one organization, or null. */
export async function currentMembership(db: D1Database, userId: string, organizationId: number): Promise<CurrentMembership | null> {
  const row = await db.prepare(`
    SELECT m.organization_id, o.name_native AS organization_name, m.role, m.valid_from, m.valid_until
    FROM organization_memberships m JOIN organizations o ON o.id=m.organization_id
    WHERE m.user_id=? AND m.organization_id=? AND ${CURRENT_MEMBERSHIP_PREDICATE}
  `).bind(userId, organizationId).first<{ organization_id: number; organization_name: string | null; role: "owner" | "manager" | "member"; valid_from: string; valid_until: string | null }>();
  if (!row) return null;
  return {
    organization_id: Number(row.organization_id),
    organization_name: row.organization_name,
    role: row.role,
    capabilities: capabilitiesForRole(row.role),
    valid_from: row.valid_from,
    valid_until: row.valid_until,
  };
}

/** Guard form: the caller must hold the capability NOW (write-time check). */
export async function requireMembershipCapability(db: D1Database, userId: string, organizationId: number, capability: Exclude<OrgCapability, "ordinary_staff">): Promise<CurrentMembership> {
  const membership = await currentMembership(db, userId, organizationId);
  if (!membership || !membership.capabilities.includes(capability)) {
    throw new HttpError(403, "org_capability_required",
      `This action requires a current ${capability === "billing_manager" ? "billing manager" : "workspace manager"} role in the organization. Memberships are checked live; expired, revoked and future memberships grant nothing.`);
  }
  return membership;
}

/** Every CURRENT organization context of the caller, with capabilities. */
export async function myOrganizationContexts(db: D1Database, userId: string): Promise<CurrentMembership[]> {
  const rows = await db.prepare(`
    SELECT m.organization_id, o.name_native AS organization_name, m.role, m.valid_from, m.valid_until
    FROM organization_memberships m JOIN organizations o ON o.id=m.organization_id
    WHERE m.user_id=? AND ${CURRENT_MEMBERSHIP_PREDICATE}
    ORDER BY m.organization_id LIMIT 50
  `).bind(userId).all<{ organization_id: number; organization_name: string | null; role: "owner" | "manager" | "member"; valid_from: string; valid_until: string | null }>();
  return (rows.results ?? []).map((row) => ({
    organization_id: Number(row.organization_id),
    organization_name: row.organization_name,
    role: row.role,
    capabilities: capabilitiesForRole(row.role),
    valid_from: row.valid_from,
    valid_until: row.valid_until,
  }));
}

export const MEMBERSHIP_POLICY_NOTE = "Organization contexts list only CURRENT memberships (active, unrevoked, within their validity window). A past payer without a current membership sees no organization products; the organization keeps what it paid for. Ordinary staff see active conveniences without money details and never private workspaces without an assignment.";

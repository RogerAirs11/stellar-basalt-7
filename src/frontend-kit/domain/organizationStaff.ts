import { useCallback } from "react";
import { useDomainResource } from "./useDomainResource";
import { usePlatformCommand, type CommandState } from "./commandStatus";
import { isPlatformClientError } from "../errors";

/**
 * R114-04 (Master AI R113 handoff D21) — the shared headless organization
 * STAFF lifecycle surface. The backend (R98-N07) already enforces every rule
 * live; this module gives the five independent renderers ONE honest state
 * machine over it:
 *
 *  - The roster is private to CURRENT staff: a 403 answer renders as an
 *    explicit forbidden state and never paints any private row — so a
 *    membership revoked mid-session (stale UI) masks the roster and the
 *    inbox instead of showing the former member yesterday's view.
 *  - Invitations are the invitee's decision: accept/decline answers map the
 *    server's honest refusals distinctly (revoked 409 / expired 410 / gone
 *    404 / unknown otherwise). Nothing is retried blindly and no refusal is
 *    ever translated into a success.
 *  - Membership rows are USER-account facts. Person-level officiating roles
 *    (judge/steward/ringmaster/dc) are a different entity and never appear
 *    here — the copy keeps a person profile and a user membership distinct.
 *  - Self-targeted role changes and self-revocation are blocked in the UI
 *    outright; the server enforces it again on every request.
 */

// ---------------------------------------------------------------------------
// The minimal platform surface the staff lifecycle needs (typed exactly as
// in contracts/platform.ts — never widened, never guessed).
// ---------------------------------------------------------------------------

export interface OrganizationStaffPlatform {
  modules: {
    organizations: {
      staff(organizationId: number, options?: unknown): Promise<{ staff: Array<Record<string, unknown>>; policy?: string }>;
      myInvites(options?: unknown): Promise<{ invites: Array<Record<string, unknown>> }>;
      invite(organizationId: number, input: { invitee_user_id: string; proposed_role: "owner" | "manager" | "member"; note?: string | null }, options?: unknown): Promise<{ invite: Record<string, unknown> }>;
      respondInvite(inviteId: number, accept: boolean, options?: unknown): Promise<{ outcome: { status: string; membershipId: number | null } }>;
      setStaffRole(organizationId: number, targetUserId: string, newRole: "owner" | "manager" | "member", options?: unknown): Promise<{ target_user_id: string; new_role: string }>;
      revokeStaff(organizationId: number, targetUserId: string, reason: string, options?: unknown): Promise<{ target_user_id: string; status: string; note: string }>;
    };
  };
}

// ---------------------------------------------------------------------------
// Roster normalization (server rows are Record<string, unknown>)
// ---------------------------------------------------------------------------

export interface OrganizationRosterMembership {
  kind: "membership";
  user_id: string;
  email: string | null;
  role: "owner" | "manager" | "member" | string;
  status: string;
  /** Live evaluation: only CURRENT memberships hold authority. */
  is_current: boolean;
  valid_from: string | null;
  valid_until: string | null;
  revoked_at: string | null;
  revoke_reason: string | null;
}

export interface OrganizationRosterInvite {
  kind: "invite";
  id: number;
  invitee_user_id: string;
  email: string | null;
  proposed_role: "owner" | "manager" | "member" | string;
  status: "pending" | "accepted" | "declined" | "revoked" | "expired" | string;
  expires_at: string | null;
  created_at: string | null;
}

export type OrganizationRosterEntry = OrganizationRosterMembership | OrganizationRosterInvite;

const asString = (value: unknown): string | null => (typeof value === "string" ? value : null);

export function normalizeOrganizationRoster(rows: ReadonlyArray<Record<string, unknown>>): OrganizationRosterEntry[] {
  const entries: OrganizationRosterEntry[] = [];
  for (const row of rows) {
    if (row.kind === "invite") {
      entries.push({
        kind: "invite",
        id: typeof row.id === "number" ? row.id : Number(row.id ?? 0),
        invitee_user_id: String(row.invitee_user_id ?? ""),
        email: asString(row.email),
        proposed_role: String(row.proposed_role ?? "member"),
        status: String(row.status ?? "pending"),
        expires_at: asString(row.expires_at),
        created_at: asString(row.created_at),
      });
    } else {
      entries.push({
        kind: "membership",
        user_id: String(row.user_id ?? ""),
        email: asString(row.email),
        role: String(row.role ?? "member"),
        status: String(row.status ?? "active"),
        is_current: row.is_current === 1 || row.is_current === true,
        valid_from: asString(row.valid_from),
        valid_until: asString(row.valid_until),
        revoked_at: asString(row.revoked_at),
        revoke_reason: asString(row.revoke_reason),
      });
    }
  }
  return entries;
}

/** Server rows for MY pending invitations (any organization). */
export interface MyOrganizationInvitation {
  id: number;
  organization_id: number;
  name_native: string | null;
  name_latin: string | null;
  proposed_role: "owner" | "manager" | "member" | string;
  status: string;
  note: string | null;
  expires_at: string | null;
  created_at: string | null;
  /** Pending AND unexpired — the only rows the server flags answerable. */
  actionable: boolean;
}

export function normalizeMyOrganizationInvites(rows: ReadonlyArray<Record<string, unknown>>): MyOrganizationInvitation[] {
  return rows.map((row) => ({
    id: typeof row.id === "number" ? row.id : Number(row.id ?? 0),
    organization_id: typeof row.organization_id === "number" ? row.organization_id : Number(row.organization_id ?? 0),
    name_native: asString(row.name_native),
    name_latin: asString(row.name_latin),
    proposed_role: String(row.proposed_role ?? "member"),
    status: String(row.status ?? "pending"),
    note: asString(row.note),
    expires_at: asString(row.expires_at),
    created_at: asString(row.created_at),
    actionable: row.actionable === 1 || row.actionable === true,
  }));
}

// ---------------------------------------------------------------------------
// Honest invitation-answer classification
// ---------------------------------------------------------------------------

export type InvitationAnswerFailure =
  | { kind: "revoked"; message: string }
  | { kind: "expired"; message: string }
  | { kind: "gone"; message: string }
  | { kind: "unknown"; message: string };

/** Map a respondInvite refusal to its honest cause. The server codes are
 * distinct on purpose; an unknown outcome stays unknown — never a success. */
export function classifyInvitationFailure(error: unknown): InvitationAnswerFailure {
  if (isPlatformClientError(error)) {
    if (error.status === 409) return { kind: "revoked", message: error.message };
    if (error.status === 410) return { kind: "expired", message: error.message };
    if (error.status === 404) return { kind: "gone", message: error.message };
  }
  return { kind: "unknown", message: error instanceof Error ? error.message : String(error) };
}

/** Why an unanswerable invitation is unanswerable: expired when the server
 * already marked it OR its expiry date is in the past (the server only flags
 * pending+unexpired rows actionable); revoked otherwise. Honest for the
 * pending-but-past state a mid-flight expiry leaves behind. */
export function unanswerableInvitationReason(invitation: MyOrganizationInvitation): "expired" | "revoked" {
  if (invitation.status === "expired") return "expired";
  if (invitation.expires_at && Number.isFinite(Date.parse(invitation.expires_at)) && Date.parse(invitation.expires_at) < Date.now()) return "expired";
  return "revoked";
}

// ---------------------------------------------------------------------------
// React bindings shared by all five renderers
// ---------------------------------------------------------------------------

export type OrganizationRosterSnapshot =
  | { phase: "idle" | "loading" }
  | { phase: "ready" | "reloading"; entries: OrganizationRosterEntry[] }
  | { phase: "empty" }
  | { phase: "forbidden"; reason: string }
  | { phase: "unavailable" | "error"; reason: string };

/** Load the private staff roster for ONE organization. The resource identity
 * combines the organization, the principal scope and the viewer's user id, so
 * a principal change (or a mid-session revocation that changes the permission
 * epoch) re-keys and the previous principal's rows can never paint under the
 * new one. The domain loader keeps forbidden/unavailable/error distinct. */
export function useOrganizationRoster(options: {
  organizationId: number;
  platform: OrganizationStaffPlatform | null;
  scope?: string;
  userId?: string | null;
}): { roster: OrganizationRosterSnapshot; retry: () => void } {
  const { organizationId, platform, scope, userId } = options;
  const identity = `${scope ?? "principal:unscoped"}|organization:${organizationId}|viewer:${userId ?? "anonymous"}`;
  const load = useCallback((signal: AbortSignal) => {
    if (platform === null) return Promise.resolve({ staff: [] as Array<Record<string, unknown>> });
    return platform.modules.organizations.staff(organizationId, { signal });
  }, [platform, organizationId]);
  const state = useDomainResource<{ staff: Array<Record<string, unknown>> }>(
    "organization-roster", identity, load, { isEmpty: (data) => (data.staff?.length ?? 0) === 0, enabled: platform !== null });
  const roster: OrganizationRosterSnapshot =
    state.state.phase === "ready" || state.state.phase === "reloading"
      ? { phase: state.state.phase, entries: normalizeOrganizationRoster(state.state.data.staff ?? []) }
      : state.state.phase === "empty" || state.state.phase === "forbidden" || state.state.phase === "unavailable" || state.state.phase === "error"
        ? state.state
        : { phase: "loading" };
  return { roster, retry: state.retry };
}

/** The invitee's own cross-organization inbox (R114-04): pending invitations
 * answerable WITHOUT selecting any organization. Principal-scoped the same
 * way — one principal's list can never leak into another's view. */
export function useMyOrganizationInvitations(options: {
  platform: OrganizationStaffPlatform | null;
  scope?: string;
  userId?: string | null;
  enabled?: boolean;
}): { invitations: MyOrganizationInvitation[]; phase: "idle" | "loading" | "ready" | "forbidden" | "unavailable" | "error"; reason?: string; retry: () => void } {
  const { platform, scope, userId, enabled = true } = options;
  const identity = `${scope ?? "principal:unscoped"}|org-invites-mine|viewer:${userId ?? "anonymous"}`;
  const load = useCallback((signal: AbortSignal) => {
    if (platform === null) return Promise.resolve({ invites: [] as Array<Record<string, unknown>> });
    return platform.modules.organizations.myInvites({ signal });
  }, [platform]);
  const state = useDomainResource<{ invites: Array<Record<string, unknown>> }>(
    "organization-invites-mine", identity, load,
    { isEmpty: (data) => (data.invites?.length ?? 0) === 0, enabled: enabled && platform !== null && userId != null });
  if (state.state.phase === "ready" || state.state.phase === "reloading")
    return { invitations: normalizeMyOrganizationInvites(state.state.data.invites ?? []), phase: "ready", retry: state.retry };
  if (state.state.phase === "empty") return { invitations: [], phase: "ready", retry: state.retry };
  if (state.state.phase === "forbidden" || state.state.phase === "unavailable" || state.state.phase === "error")
    return { invitations: [], phase: state.state.phase, reason: state.state.reason, retry: state.retry };
  return { invitations: [], phase: state.state.phase === "idle" ? "idle" : "loading", retry: state.retry };
}

/** Scoped command slots for the staff actions; the renderer decides which to
 * surface. Scope changes mask feedback and reject stale handlers — they never
 * cancel or retry an already submitted write. */
export function useOrganizationStaffCommands(scope: string | undefined) {
  const invite = usePlatformCommand(`${scope ?? "principal:unscoped"}|org-invite`);
  const roleChange = usePlatformCommand(`${scope ?? "principal:unscoped"}|org-role`);
  const revoke = usePlatformCommand(`${scope ?? "principal:unscoped"}|org-revoke`);
  const respond = usePlatformCommand(`${scope ?? "principal:unscoped"}|org-respond`);
  return { invite, roleChange, revoke, respond };
}

/** Honest command feedback text: accepted/rejected/failed carry a message;
 * submitting carries none (renderers show progress, never a fabricated result). */
export function commandFeedback(state: CommandState): string {
  if (state.phase === "accepted" || state.phase === "rejected" || state.phase === "failed") return state.message;
  return "";
}

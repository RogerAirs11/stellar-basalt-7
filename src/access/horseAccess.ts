import { timestampMillis } from "../security/timestamps";
import { HttpError } from "../api/http";
import type { AuthContext } from "../auth/session";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * Master-Ai plan T10 — people, organizations and horse-scoped grants.
 *
 * Doctrine (from the plan, accepted at R79):
 * - The authenticated ACCOUNT (users.role) is never a global per-horse edit
 *   permission. Editorial staff keep their platform capabilities; everyone
 *   else needs an explicit, currently-valid grant on THIS horse.
 * - Legal ownership (horse_people) is a historical record about the horse.
 *   A grant is a permission to act. The two are deliberately distinct: a
 *   manager can hold an active grant without being the recorded legal owner,
 *   and a recorded owner holds no permission until a grant exists.
 * - An approved evidence-reviewed claim maps to an explicit grant; selecting
 *   an arbitrary person_id proves nothing.
 * - Revocation (revoked_at) and validity windows take effect on the next
 *   request: nothing in front of the authorization check caches grants.
 */

export const HORSE_GRANT_ACTIONS = ["manage_profile", "upload_media", "create_listing", "manage_inquiries"] as const;
export type HorseGrantAction = (typeof HORSE_GRANT_ACTIONS)[number];

export type HorseGrantRelationship = "owner" | "breeder" | "manager" | "seller";

/** Which actions each mandate grants. Legal-owner display is NOT part of this. */
export const RELATIONSHIP_ACTION_SETS: Record<HorseGrantRelationship, readonly HorseGrantAction[]> = {
  owner: ["manage_profile", "upload_media", "create_listing", "manage_inquiries"],
  breeder: ["manage_profile", "upload_media"],
  manager: ["manage_profile", "upload_media", "manage_inquiries"],
  seller: ["create_listing", "manage_inquiries"],
};

export const GRANT_RELATIONSHIPS: readonly HorseGrantRelationship[] = ["owner", "breeder", "manager", "seller"];

export interface GrantRow {
  id: string;
  horse_id: number;
  grantee_user_id: string | null;
  grantee_organization_id: number | null;
  relationship: string;
  actions: string;
  basis: string;
  basis_ref: string | null;
  valid_from: string;
  valid_until: string | null;
  revoked_at: string | null;
}

export type GrantValidity = "active" | "revoked" | "expired" | "not_yet_valid" | "invalid";

function isIso(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Effective validity of a single grant at a point in time. Invalid storage denies access. */
export function grantValidity(grant: Pick<GrantRow, "revoked_at" | "valid_until" | "valid_from">, now: Date): GrantValidity {
  if (isIso(grant.revoked_at)) return "revoked";
  const nowMs = now.getTime();
  const from = timestampMillis(grant.valid_from);
  const until = grant.valid_until === null ? null : timestampMillis(grant.valid_until);
  if (!Number.isFinite(nowMs) || from === null || (grant.valid_until !== null && until === null)) return "invalid";
  if (until !== null && until <= from) return "invalid";
  if (nowMs < from) return "not_yet_valid";
  if (until !== null && nowMs >= until) return "expired";
  return "active";
}

/** Parse the stored comma-separated actions list, deduplicated, vocabulary-filtered. */
export function parseGrantActions(actions: string | null | undefined): HorseGrantAction[] {
  const vocabulary = new Set<string>(HORSE_GRANT_ACTIONS);
  const seen = new Set<string>();
  for (const token of String(actions ?? "").split(",")) {
    const action = token.trim();
    if (action && vocabulary.has(action)) seen.add(action);
  }
  return [...seen] as HorseGrantAction[];
}

/** Actions a relationship grants, intersected with the stored list (storage can only narrow). */
export function grantActions(grant: Pick<GrantRow, "relationship" | "actions">): HorseGrantAction[] {
  const set = Object.hasOwn(RELATIONSHIP_ACTION_SETS, grant.relationship) ? RELATIONSHIP_ACTION_SETS[grant.relationship as HorseGrantRelationship] : [];
  const allowed = new Set<string>(set);
  return parseGrantActions(grant.actions).filter((action) => allowed.has(action));
}

/** Merge actions across every ACTIVE grant (user + organization mandates). */
export function activeGrantActions(grants: Array<Pick<GrantRow, "relationship" | "actions" | "revoked_at" | "valid_from" | "valid_until">>, now: Date): HorseGrantAction[] {
  const merged = new Set<string>();
  for (const grant of grants) {
    if (grantValidity(grant, now) !== "active") continue;
    for (const action of grantActions(grant)) merged.add(action);
  }
  return [...merged].sort() as HorseGrantAction[];
}

/** Editorial roles keep their platform capabilities (the existing model). */
/** The ONE editorial-role list (R96-N07): TypeScript checks and SQL predicates must agree. */
export const EDITORIAL_ROLES: readonly string[] = ["editor", "admin", "super_admin"];

export function isEditorialRole(role: string): boolean {
  return (EDITORIAL_ROLES as readonly string[]).includes(role);
}

export interface HorseViewer {
  userId: string;
  role: string;
}

export interface HorseActionsSnapshot {
  horse_id: number;
  is_staff: boolean;
  relationships: HorseGrantRelationship[];
  actions: HorseGrantAction[];
  grants: Array<{ id: string; relationship: HorseGrantRelationship; actions: HorseGrantAction[]; via: "user" | "organization"; valid_until: string | null }>;
}

/**
 * SQL that resolves every candidate grant for a viewer on one horse: direct
 * user grants plus grants to organizations where the viewer holds an ACTIVE,
 * unexpired, unrevoked membership. Exported so the python replay suite and
 * tests stay source-anchored (R82 pattern).
 */
export const HORSE_GRANT_LOOKUP_SQL = `
  SELECT g.id,g.horse_id,g.grantee_user_id,g.grantee_organization_id,g.relationship,g.actions,g.basis,g.basis_ref,
         g.valid_from,g.valid_until,g.revoked_at
  FROM horse_access_grants g
  WHERE g.horse_id=?
    AND g.revoked_at IS NULL
    AND (g.valid_until IS NULL OR datetime(g.valid_until) > datetime(?))
    AND (
      g.grantee_user_id=?
      OR EXISTS(
        SELECT 1 FROM organization_memberships m
        JOIN organizations o ON o.id=m.organization_id AND o.status='active'
        WHERE m.organization_id=g.grantee_organization_id
          AND m.user_id=?
          AND m.status='active'
          AND m.revoked_at IS NULL
          AND datetime(m.valid_from) <= datetime(?)
          AND (m.valid_until IS NULL OR datetime(m.valid_until) > datetime(?))
      )
    )
`;

interface GrantQueryRow {
  id: string;
  horse_id: number;
  grantee_user_id: string | null;
  grantee_organization_id: number | null;
  relationship: string;
  actions: string;
  basis: string;
  basis_ref: string | null;
  valid_from: string;
  valid_until: string | null;
  revoked_at: string | null;
}

/**
 * Per-horse actions for a viewer, as the backend computes them (the UI never
 * re-derives permissions from the account role). Staff see staff actions;
 * everyone else sees exactly what their active grants allow on THIS horse.
 */
export async function horseActionsForViewer(db: D1Database, viewer: HorseViewer, horseId: number, now: Date): Promise<HorseActionsSnapshot> {
  const isStaff = isEditorialRole(viewer.role);
  const grants: GrantQueryRow[] = isStaff
    ? []
    : ((await db
        .prepare(HORSE_GRANT_LOOKUP_SQL)
        .bind(horseId, now.toISOString(), viewer.userId, viewer.userId, now.toISOString(), now.toISOString())
        .all<GrantQueryRow>()).results ?? []);
  const eligible = grants
    // Defense-in-depth on top of the SQL WHERE clause: only grants made out to
    // this user (user grants) or to one of this user's organizations (the SQL
    // EXISTS already proved the membership; those rows carry a NULL user id)
    // can contribute actions. A row for somebody else must never survive,
    // whatever the surrounding query shape.
    .filter((row) => row.grantee_user_id === viewer.userId || row.grantee_user_id == null)
    .filter((row) => row.horse_id === horseId);
  const viaOrganization = new Set(eligible.filter((row) => row.grantee_user_id !== viewer.userId && row.grantee_organization_id != null).map((row) => row.id));
  const active = eligible
    .filter((row) => grantValidity(row, now) === "active")
    .map((row) => ({
      id: row.id,
      relationship: row.relationship as HorseGrantRelationship,
      actions: grantActions(row),
      via: (viaOrganization.has(row.id) ? "organization" : "user") as "user" | "organization",
      valid_until: row.valid_until,
    }))
    .filter((row) => row.actions.length > 0);
  return {
    horse_id: horseId,
    is_staff: isStaff,
    relationships: [...new Set(active.map((row) => row.relationship))],
    actions: isStaff ? [...HORSE_GRANT_ACTIONS] : activeGrantActions(eligible, now),
    grants: active,
  };
}

export type HorseAuthorization =
  | { ok: true; via: "editorial" | "grant"; actions: HorseGrantAction[] }
  | { ok: false; reason: "authentication_required" | "horse_access_required" };

/**
 * Authorization decision for one action on one horse. Editorial staff pass on
 * their platform capability (unchanged model); any other account needs an
 * active grant covering the action on exactly this horse. Owner A acting on
 * Horse B without a grant fails here — the IDOR boundary.
 */
export async function authorizeHorseAction(db: D1Database, viewer: HorseViewer, horseId: number, action: HorseGrantAction, now: Date): Promise<HorseAuthorization> {
  if (!viewer?.userId) return { ok: false, reason: "authentication_required" };
  if (isEditorialRole(viewer.role)) return { ok: true, via: "editorial", actions: [...HORSE_GRANT_ACTIONS] };
  const snapshot = await horseActionsForViewer(db, viewer, horseId, now);
  if (snapshot.actions.includes(action)) {
    return { ok: true, via: "grant", actions: snapshot.actions };
  }
  return { ok: false, reason: "horse_access_required" };
}

/** Route-facing guard: throws the precise HTTP error instead of returning a reason. */
export async function requireHorseAction(
  db: D1Database,
  auth: AuthContext,
  horseId: number,
  action: HorseGrantAction,
  now: Date = new Date(),
): Promise<{ via: "editorial" | "grant" }> {
  const decision = await authorizeHorseAction(db, { userId: auth.user.id, role: auth.user.role }, horseId, action, now);
  if (decision.ok) return { via: decision.via };
  if (decision.reason === "authentication_required") throw new HttpError(401, "authentication_required", "Sign in is required");
  throw new HttpError(403, "horse_access_required", "You do not have permission to manage this horse. An approved ownership claim or an explicit grant is required.");
}

/**
 * R74 batch discipline (REV-01) applied to grants: the INSERT is conditioned
 * on THIS review's approval having landed in the same batch, so a losing
 * concurrent reviewer can never mint a permission. Mirrors CLAIM_OWNER_LINK_SQL.
 */
export const CLAIM_GRANT_SQL = `INSERT INTO horse_access_grants(id,horse_id,grantee_user_id,grantee_organization_id,relationship,actions,basis,basis_ref,granted_by_user_id,valid_from,created_at)
  SELECT ?,?,?,NULL,'owner','manage_profile,upload_media,create_listing,manage_inquiries','claim_approval',?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
  WHERE EXISTS(SELECT 1 FROM horse_claims WHERE id=? AND status='approved' AND reviewed_by_user_id=?)`;

export function claimApprovalGrantStatement(db: D1Database, input: { grantId: string; horseId: number; claimantUserId: string; claimId: string; reviewerUserId: string }): D1PreparedStatement {
  return db
    .prepare(CLAIM_GRANT_SQL)
    .bind(input.grantId, input.horseId, input.claimantUserId, input.claimId, input.reviewerUserId, input.claimId, input.reviewerUserId);
}

export const REVOKE_GRANT_SQL = `UPDATE horse_access_grants
  SET revoked_at=CURRENT_TIMESTAMP, revoked_by_user_id=?, revoke_reason=?, last_operation_id=?
  WHERE id=? AND revoked_at IS NULL`;

/**
 * P02 (R88 agent plan): the audit event is an INSERT ... SELECT conditioned on
 * THIS call's operation marker having actually landed on the row. A repeat
 * revoke, a racing second writer or a non-existent grant matches zero rows and
 * can never mint a successful-revocation audit event. The batch (UPDATE + this
 * INSERT) is one D1 transaction, so state change and audit land together or not
 * at all. Portable SQL only — no json_object()/||-concat engine divergence: the
 * payload is built in TypeScript, and the SELECT merely gates it on the marker.
 */
export const GRANT_REVOKE_AUDIT_SQL = `INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,after_json,reason,created_at)
  SELECT ?,?,?,?,?,?,CURRENT_TIMESTAMP
  FROM horse_access_grants g
  WHERE g.id=? AND g.last_operation_id=? AND g.revoked_at IS NOT NULL`;

/**
 * Revoke a grant: compare-and-set on revoked_at IS NULL so double-revoke is a
 * clean 409, with a marker-conditioned audit row in the SAME atomic batch.
 * Takes effect immediately — the next request no longer sees the grant
 * (HORSE_GRANT_LOOKUP_SQL filters revoked_at IS NULL).
 */
export async function revokeHorseGrant(db: D1Database, input: { grantId: string; byUserId: string; reason: string }): Promise<{ id: string; revoked: true }> {
  if (!input.reason || input.reason.trim().length < 3) {
    throw new HttpError(422, "invalid_reason", "A revocation reason is required");
  }
  const operationId = crypto.randomUUID();
  const [revoke] = await db.batch([
    db.prepare(REVOKE_GRANT_SQL).bind(input.byUserId, input.reason.trim(), operationId, input.grantId),
    db.prepare(GRANT_REVOKE_AUDIT_SQL).bind(
      input.byUserId,
      "grant.revoke",
      "horse_access_grant",
      input.grantId,
      JSON.stringify({ grant_id: input.grantId, prior_state: "active", new_state: "revoked", operation_id: operationId }),
      input.reason.trim(),
      input.grantId,
      operationId,
    ),
  ]);
  if (Number((revoke as { meta?: { changes?: number } } | undefined)?.meta?.changes ?? 0) !== 1) {
    throw new HttpError(409, "grant_not_active", "This grant is already revoked or does not exist");
  }
  return { id: input.grantId, revoked: true };
}

/**
 * Organization service (minimal, T10): creating an organization and granting a
 * membership are separate audited operations. Nothing here confers horse
 * access by itself — a horse_access_grants row with grantee_organization_id is
 * still required, and revoking the membership removes the path immediately.
 */
export const ORGANIZATION_KINDS = ["stable", "breeder", "club", "association", "service"] as const;
export type OrganizationKind = (typeof ORGANIZATION_KINDS)[number];

export function slugifyOrganization(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9\u0600-\u06FF-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (slug.length < 2 || slug.length > 64) {
    throw new HttpError(422, "invalid_organization_name", "Organization name must produce a 2-64 character slug");
  }
  return slug;
}

export const ORGANIZATION_MEMBERSHIP_REVOKE_SQL = `UPDATE organization_memberships
  SET status='revoked', revoked_at=CURRENT_TIMESTAMP, revoked_by_user_id=?, revoke_reason=?, last_operation_id=?
  WHERE id=? AND status='active'`;

/** P02: marker-conditioned audit INSERT — same guarantees as GRANT_REVOKE_AUDIT_SQL. */
export const MEMBERSHIP_REVOKE_AUDIT_SQL = `INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,after_json,reason,created_at)
  SELECT ?,?,?,?,?,?,CURRENT_TIMESTAMP
  FROM organization_memberships m
  WHERE m.id=? AND m.last_operation_id=? AND m.status='revoked'`;

export async function revokeOrganizationMembership(db: D1Database, input: { membershipId: number; byUserId: string; reason: string }): Promise<{ id: number; revoked: true }> {
  if (!input.reason || input.reason.trim().length < 3) {
    throw new HttpError(422, "invalid_reason", "A revocation reason is required");
  }
  const operationId = crypto.randomUUID();
  const [revoke] = await db.batch([
    db.prepare(ORGANIZATION_MEMBERSHIP_REVOKE_SQL).bind(input.byUserId, input.reason.trim(), operationId, input.membershipId),
    db.prepare(MEMBERSHIP_REVOKE_AUDIT_SQL).bind(
      input.byUserId,
      "organization.membership_revoke",
      "organization_membership",
      String(input.membershipId),
      JSON.stringify({ membership_id: input.membershipId, prior_state: "active", new_state: "revoked", operation_id: operationId }),
      input.reason.trim(),
      input.membershipId,
      operationId,
    ),
  ]);
  if (Number((revoke as { meta?: { changes?: number } } | undefined)?.meta?.changes ?? 0) !== 1) {
    throw new HttpError(409, "membership_not_active", "This membership is already revoked or not active");
  }
  return { id: input.membershipId, revoked: true };
}

/** Bounded bulk authorization for inboxes; avoids one database query per message. */
export async function horseIdsWithAction(
  db: D1Database, viewer: HorseViewer, horseIds: number[], action: HorseGrantAction, now = new Date(),
): Promise<Set<number>> {
  const ids = [...new Set(horseIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (ids.length > 500) throw new Error("Bulk horse authorization is limited to 500 resources");
  if (isEditorialRole(viewer.role)) return new Set(ids);
  if (ids.length === 0) return new Set();
  const statements = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const sql = HORSE_GRANT_LOOKUP_SQL.replace("g.horse_id=?", `g.horse_id IN (${chunk.map(() => "?").join(",")})`);
    statements.push(db.prepare(sql).bind(...chunk, now.toISOString(), viewer.userId, viewer.userId, now.toISOString(), now.toISOString()));
  }
  const wanted = new Set(ids);
  const allowed = new Set<number>();
  for (const result of await db.batch<GrantQueryRow>(statements)) {
    for (const row of result.results ?? []) {
      if (!wanted.has(row.horse_id)) continue;
      if (row.grantee_user_id !== viewer.userId && row.grantee_user_id != null) continue;
      if (grantValidity(row, now) === "active" && grantActions(row).includes(action)) allowed.add(row.horse_id);
    }
  }
  return allowed;
}

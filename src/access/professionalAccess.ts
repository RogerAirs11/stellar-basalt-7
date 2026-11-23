import { HttpError } from "../api/http";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * R144-D01 (Master-AI plan) — professional grants scoped to horse, data and
 * purpose. Migration 0105. Companion to horseAccess.ts (0034 editorial
 * mandates): this module is the ONLY non-staff path to private health data.
 *
 * Doctrine:
 * - Distinct permission vocabulary — private health reading, clinical
 *   writing, sample/test submission, evidence review, official attestation
 *   and private file export are separate permissions, never one umbrella.
 * - A grant binds horse + grantee (user or institution) + professional kind
 *   + professional-authority reference + assignment reference + validity.
 * - Revocation (revoked_at) and validity windows take effect on the next
 *   request: nothing in front of the authorization check caches grants.
 * - A generic horse-edit capability NEVER implies private health access.
 */

import { PROFESSIONAL_GRANT_PERMISSIONS, PROFESSIONAL_KINDS, PROFESSIONAL_KIND_PERMISSIONS } from "../contracts/professionalAccess";
import type { ProfessionalGrantPermission, ProfessionalKind } from "../contracts/professionalAccess";
export { PROFESSIONAL_GRANT_PERMISSIONS, PROFESSIONAL_KINDS, PROFESSIONAL_KIND_PERMISSIONS, PROFESSIONAL_GRANT_BASES, GENETIC_GRANT_PERMISSIONS } from "../contracts/professionalAccess";
export type { ProfessionalGrantPermission, ProfessionalKind, ProfessionalGrantBasis, GeneticGrantPermission } from "../contracts/professionalAccess";

export interface ProfessionalGrantRow {
  id: string;
  horse_id: number;
  grantee_user_id: string | null;
  grantee_organization_id: number | null;
  professional_kind: string;
  permissions: string;
  authority_ref: string;
  assignment_ref: string;
  basis: string;
  basis_ref: string | null;
  valid_from: string;
  valid_until: string | null;
  revoked_at: string | null;
}

/** Parse the stored comma-separated permissions list, deduplicated, vocabulary-filtered. */
export function parseProfessionalPermissions(permissions: string | null | undefined): ProfessionalGrantPermission[] {
  const vocabulary = new Set<string>(PROFESSIONAL_GRANT_PERMISSIONS);
  const seen = new Set<string>();
  for (const token of String(permissions ?? "").split(",")) {
    const permission = token.trim();
    if (permission && vocabulary.has(permission)) seen.add(permission);
  }
  return [...seen] as ProfessionalGrantPermission[];
}

/**
 * SQL that resolves every candidate professional grant for a viewer on one
 * horse: direct user grants plus grants to organizations where the viewer
 * holds an ACTIVE, unexpired, unrevoked membership (same mandate shape as
 * HORSE_GRANT_LOOKUP_SQL). Exported so tests and the python replay suite
 * stay source-anchored.
 */
export const PROFESSIONAL_GRANT_LOOKUP_SQL = `
  SELECT g.id,g.horse_id,g.grantee_user_id,g.grantee_organization_id,g.professional_kind,g.permissions,
         g.authority_ref,g.assignment_ref,g.basis,g.basis_ref,g.valid_from,g.valid_until,g.revoked_at
  FROM professional_access_grants g
  WHERE g.horse_id=?
    AND EXISTS(SELECT 1 FROM horses ph WHERE ph.id=g.horse_id AND ph.deleted_at IS NULL)
    AND EXISTS(SELECT 1 FROM users pu WHERE pu.id=? AND pu.is_active=1)
    AND g.revoked_at IS NULL
    AND (g.valid_until IS NULL OR datetime(g.valid_until) > datetime(?))
    AND (
      (g.grantee_user_id=? AND g.grantee_organization_id IS NULL)
      OR (g.grantee_user_id IS NULL AND EXISTS(
        SELECT 1 FROM organization_memberships m
        JOIN organizations o ON o.id=m.organization_id AND o.status='active'
        WHERE m.organization_id=g.grantee_organization_id
          AND m.user_id=?
          AND m.status='active'
          AND m.role IN ('owner','manager')
          AND m.revoked_at IS NULL
          AND datetime(m.valid_from) <= datetime(?)
          AND (m.valid_until IS NULL OR datetime(m.valid_until) > datetime(?))
      ))
    )
`;

interface ProfessionalGrantQueryRow {
  id: string;
  horse_id: number;
  grantee_user_id: string | null;
  grantee_organization_id: number | null;
  permissions: string;
  professional_kind: string;
  valid_from: string;
  valid_until: string | null;
  revoked_at: string | null;
}

/**
 * Active professional permissions for a viewer on ONE horse. Grants made out
 * to somebody else must never contribute (defense-in-depth filter mirrors
 * horseActionsForViewer). Staff pass their own capability path elsewhere —
 * this function deliberately knows nothing about roles.
 */
export async function professionalPermissionsForViewer(db: D1Database, viewerUserId: string, horseId: number, now: Date): Promise<ProfessionalGrantPermission[]> {
  if (!viewerUserId) return [];
  const grants: ProfessionalGrantQueryRow[] = (await db
    .prepare(PROFESSIONAL_GRANT_LOOKUP_SQL)
    .bind(horseId, viewerUserId, now.toISOString(), viewerUserId, viewerUserId, now.toISOString(), now.toISOString())
    .all<ProfessionalGrantQueryRow>()).results ?? [];
  const merged = new Set<string>();
  for (const grant of grants) {
    // Same defense-in-depth as horseAccess: only grants made out to this
    // user (direct) or to an organization (the SQL EXISTS proved membership;
    // those rows carry a NULL user id) can contribute.
    if (grant.grantee_user_id !== viewerUserId && grant.grantee_user_id != null) continue;
    if (grant.horse_id !== horseId) continue;
    if (grant.revoked_at) continue;
    const from = Date.parse(grant.valid_from);
    if (!Number.isFinite(from) || now.getTime() < from) continue;
    if (grant.valid_until !== null) {
      const until = Date.parse(grant.valid_until);
      if (!Number.isFinite(until) || now.getTime() >= until) continue;
    }
    const allowed = PROFESSIONAL_KIND_PERMISSIONS[grant.professional_kind as ProfessionalKind] ?? [];
    for (const permission of parseProfessionalPermissions(grant.permissions)) {
      if (allowed.includes(permission)) merged.add(permission);
    }
  }
  return [...merged] as ProfessionalGrantPermission[];
}

/** The same authority check inside a transactional write. Callers must bind
 * these values; no user-controlled SQL fragments are accepted. Institution
 * membership alone is not professional authority: only its current owners
 * and managers can exercise the institution's explicitly granted powers. */
export type ProfessionalSubject = number | { column: "h.id" | "g.horse_id" | "m.horse_id" | "b.sire_id" | "b.dam_id" };

export function professionalActionPredicate(input: {
  viewerUserId: string;
  horseId: ProfessionalSubject;
  permission: ProfessionalGrantPermission;
  now?: Date;
  /** SQL reads/commits use the database clock, so an elapsed grant cannot
   * survive merely because authorization began before its expiry. */
  atTransactionTime?: boolean;
}): { sql: string; bindings: Array<string | number> } {
  const now = (input.now ?? new Date()).toISOString();
  const kinds = PROFESSIONAL_KINDS.filter(kind => PROFESSIONAL_KIND_PERMISSIONS[kind].includes(input.permission));
  if (!kinds.length) return { sql: "0=1", bindings: [] };
  const subjectSql = typeof input.horseId === "number" ? "?" : input.horseId.column;
  const subjectBindings = typeof input.horseId === "number" ? [input.horseId] : [];
  const clockSql = input.atTransactionTime ? "CURRENT_TIMESTAMP" : "datetime(?)";
  return {
    sql: `EXISTS(
      SELECT 1 FROM professional_access_grants pg_grant
      JOIN horses pg_subject ON pg_subject.id=pg_grant.horse_id AND pg_subject.deleted_at IS NULL
      JOIN users pg_user ON pg_user.id=? AND pg_user.is_active=1
      WHERE pg_grant.horse_id=${subjectSql} AND pg_grant.revoked_at IS NULL
        AND pg_grant.professional_kind IN (${kinds.map(() => "?").join(",")})
        AND (',' || pg_grant.permissions || ',') LIKE ?
        AND datetime(pg_grant.valid_from)<=${clockSql}
        AND (pg_grant.valid_until IS NULL OR datetime(pg_grant.valid_until)>${clockSql})
        AND ((pg_grant.grantee_user_id=pg_user.id AND pg_grant.grantee_organization_id IS NULL)
          OR (pg_grant.grantee_user_id IS NULL AND EXISTS(
            SELECT 1 FROM organization_memberships pg_member
            JOIN organizations pg_org ON pg_org.id=pg_member.organization_id AND pg_org.status='active'
            WHERE pg_member.organization_id=pg_grant.grantee_organization_id AND pg_member.user_id=pg_user.id
              AND pg_member.role IN ('owner','manager') AND pg_member.status='active' AND pg_member.revoked_at IS NULL
              AND datetime(pg_member.valid_from)<=${clockSql}
              AND (pg_member.valid_until IS NULL OR datetime(pg_member.valid_until)>${clockSql})
          )))
    )`,
    bindings: [input.viewerUserId, ...subjectBindings, ...kinds, `%,${input.permission},%`, ...(input.atTransactionTime ? [] : [now, now, now, now])],
  };
}

export type ProfessionalAuthorization =
  | { ok: true; permissions: ProfessionalGrantPermission[] }
  | { ok: false; reason: "not_granted" };

/** Authorization decision for one professional permission on one horse. */
export async function authorizeProfessionalAction(db: D1Database, viewerUserId: string, horseId: number, permission: ProfessionalGrantPermission, now: Date = new Date()): Promise<ProfessionalAuthorization> {
  const permissions = await professionalPermissionsForViewer(db, viewerUserId, horseId, now);
  if (permissions.includes(permission)) return { ok: true, permissions };
  return { ok: false, reason: "not_granted" };
}

export const REVOKE_PROFESSIONAL_GRANT_SQL = `UPDATE professional_access_grants
  SET revoked_at=CURRENT_TIMESTAMP, revoked_by_user_id=?, revoke_reason=?, last_operation_id=?
  WHERE id=? AND revoked_at IS NULL
    AND EXISTS(SELECT 1 FROM users WHERE id=? AND is_active=1 AND role IN ('admin','super_admin'))
    AND EXISTS(SELECT 1 FROM sessions WHERE id=? AND user_id=? AND datetime(expires_at)>CURRENT_TIMESTAMP)`;

/** Marker-conditioned audit INSERT — same guarantees as GRANT_REVOKE_AUDIT_SQL. */
export const PROFESSIONAL_REVOKE_AUDIT_SQL = `INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,after_json,reason,created_at)
  SELECT ?,?,?,?,?,?,CURRENT_TIMESTAMP
  FROM professional_access_grants g
  WHERE g.id=? AND g.last_operation_id=? AND g.revoked_at IS NOT NULL`;

/**
 * Revoke a professional grant: compare-and-set on revoked_at IS NULL so a
 * double-revoke is a clean 409, with a marker-conditioned audit row in the
 * SAME atomic batch. Takes effect immediately — the next request no longer
 * sees the grant (PROFESSIONAL_GRANT_LOOKUP_SQL filters revoked_at IS NULL).
 */
export async function revokeProfessionalGrant(db: D1Database, input: { grantId: string; byUserId: string; sessionId: string; reason: string }): Promise<{ id: string; revoked: true }> {
  if (!input.reason || input.reason.trim().length < 3) {
    throw new HttpError(422, "invalid_reason", "A revocation reason is required");
  }
  const operationId = crypto.randomUUID();
  const [revoke] = await db.batch([
    db.prepare(REVOKE_PROFESSIONAL_GRANT_SQL).bind(input.byUserId, input.reason.trim(), operationId, input.grantId, input.byUserId, input.sessionId, input.byUserId),
    db.prepare(PROFESSIONAL_REVOKE_AUDIT_SQL).bind(
      input.byUserId,
      "professional.grant.revoke",
      "professional_access_grant",
      input.grantId,
      JSON.stringify({ grant_id: input.grantId, prior_state: "active", new_state: "revoked", operation_id: operationId }),
      input.reason.trim(),
      input.grantId,
      operationId,
    ),
  ]);
  if (Number((revoke as { meta?: { changes?: number } } | undefined)?.meta?.changes ?? 0) !== 1) {
    throw new HttpError(409, "professional_grant_not_active", "This professional grant is already revoked or does not exist");
  }
  return { id: input.grantId, revoked: true };
}

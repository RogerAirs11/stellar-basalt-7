import type { D1Database } from "@cloudflare/workers-types";
import { HttpError } from "../api/http";
import type { PrivacyViewer } from "../privacy/policy";
import { professionalActionPredicate, type ProfessionalSubject } from "./professionalAccess";
import { GENETIC_ACCESS_POLICY_VERSION, GENETIC_GRANT_PERMISSIONS, type GeneticAccessResponse, type ProfessionalGrantPermission } from "../contracts/professionalAccess";
import { privateEvidenceSessionPredicate } from "./privateEvidence";

export type GeneticSqlGuard = { sql: string; bindings: Array<string | number> };

/** Never consumes a client permission flag or a role. The current session,
 * user, horse, exact grant, profession and membership are checked in SQL at
 * the actual read/write boundary, using the database's current clock. */
export function geneticActionPredicate(viewer: PrivacyViewer | null | undefined, horseId: ProfessionalSubject, permissions: readonly ProfessionalGrantPermission[]): GeneticSqlGuard {
  if (!viewer?.user?.id || !viewer.sessionId || !viewer.sessionTokenHash || !permissions.length) return { sql: "0=1", bindings: [] };
  const grants = permissions.map(permission => professionalActionPredicate({ viewerUserId: viewer.user.id, horseId, permission, atTransactionTime: true }));
  const session = privateEvidenceSessionPredicate(viewer);
  return {
    sql: `(${session.sql}) AND ${grants.map(grant => `(${grant.sql})`).join(" AND ")}`,
    bindings: [...session.bindings, ...grants.flatMap(grant => grant.bindings)],
  };
}

export async function requireGeneticPermissions(db: D1Database, viewer: PrivacyViewer, horseId: number, permissions: readonly ProfessionalGrantPermission[]): Promise<void> {
  const guard = geneticActionPredicate(viewer, horseId, permissions);
  if (!await db.prepare(`SELECT 1 AS allowed WHERE ${guard.sql}`).bind(...guard.bindings).first()) {
    throw new HttpError(403, "genetic_permission_required", "A current horse-scoped genetic permission is required for this operation");
  }
}

/** One query yields capabilities only for a visible subject. No private
 * counts, grant references, report identifiers or organization data escape. */
export async function geneticCapabilities(db: D1Database, viewer: PrivacyViewer, horseId: number): Promise<GeneticAccessResponse> {
  const keys = ["private_health_read", ...GENETIC_GRANT_PERMISSIONS] as const;
  const guards = keys.map(permission => geneticActionPredicate(viewer, horseId, [permission]));
  const row = await db.prepare(`SELECT * FROM (
    SELECT h.id,h.is_active,${guards.map((guard, index) => `(${guard.sql}) AS permission_${index}`).join(",")}
    FROM horses h WHERE h.id=? AND h.deleted_at IS NULL
  ) subject WHERE is_active=1 OR ${keys.map((_, index) => `permission_${index}`).join(" OR ")}`)
    .bind(...guards.flatMap(guard => guard.bindings), horseId).first<Record<string, unknown>>();
  if (!row) throw new HttpError(404, "not_found", "Horse not found");
  const permissions = keys.filter((_, index) => Number(row[`permission_${index}`]) === 1 || row[`permission_${index}`] === true);
  const evidence = permissions.includes("genetic_evidence_read");
  return { horse_id: horseId, policy_version: GENETIC_ACCESS_POLICY_VERSION, permissions: [...permissions],
    can_view_private_evidence: evidence,
    can_view_verified_health_results: evidence || permissions.includes("private_health_read"),
    can_intake: permissions.includes("genetic_intake"),
    can_review: evidence && permissions.includes("genetic_review"),
    can_publish: permissions.includes("genetic_publish") };
}

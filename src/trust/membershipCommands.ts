import type { D1Database } from "@cloudflare/workers-types";
import { timestampMillis } from "../security/timestamps";
import { membershipValidity, type MembershipRow } from "./policy";
/** Grant/revoke/issuance acquire the same issuer row before evaluating authority.
 * Active membership dates are checked again inside each winning command. */
export const CURRENT_ISSUER_MEMBER_SQL = `m.id=CAST(? AS TEXT) AND m.valid_from=CAST(? AS TEXT)
  AND COALESCE(m.valid_until,'')=CAST(? AS TEXT) AND m.status='active' AND m.revoked_at IS NULL
  AND datetime(m.valid_from)<=datetime('now')
  AND (m.valid_until IS NULL OR (datetime(m.valid_until)>datetime('now') AND datetime(m.valid_until)>datetime(m.valid_from)))`;
export const MANAGE_ISSUER_SQL = `(u.role IN ('admin','super_admin') OR
  (i.status='active' AND EXISTS(SELECT 1 FROM issuer_memberships m WHERE m.issuer_id=i.id AND m.user_id=u.id
    AND m.role='owner' AND ${CURRENT_ISSUER_MEMBER_SQL})))`;
/** Strictly validate legacy date bytes before using SQL's timestamp conversion.
 * SQLite normalizes some impossible dates; PostgreSQL may throw instead. The
 * conditional command re-binds these exact bytes, membership ID, current role,
 * status and DB time, so a changed row cannot reuse this proof. No proof is an
 * SQL NULL equality (never an authorization). Platform management still needs
 * an active admin in the command and cannot itself authorize issuance. */
export async function currentIssuerMembershipProof(db: D1Database, issuerId: string, actorId: string): Promise<readonly [
    string | null,
    string | null,
    string | null
]> {
    const rows = await db.prepare(`SELECT id,issuer_id,user_id,role,status,valid_from,valid_until,revoked_at
    FROM issuer_memberships WHERE issuer_id=? AND user_id=? AND status='active' LIMIT 2`)
        .bind(issuerId, actorId).all<MembershipRow & {
        id: string;
    }>();
    const row = rows.results.length === 1 ? rows.results[0] : null;
    if (!row || !["owner", "attester"].includes(row.role) || membershipValidity(row) !== "active")
        return [null, null, null];
    return [row.id, row.valid_from, row.valid_until ?? ""];
}
/** Date-only expiry means end of that UTC calendar day. Instants must include
 * a timezone. Normalize storage; malformed and already-expired input is denied. */
export function normalizeTrustExpiry(value: string | null | undefined, now = Date.now()): string | null {
    if (value == null)
        return null;
    const day = /^\d{4}-\d{2}-\d{2}$/.test(value);
    if (!day && !/(?:Z|[+-]\d{2}:\d{2})$/.test(value))
        throw new Error("An offset-qualified expiry instant is required");
    const parsed = timestampMillis(day ? `${value}T00:00:00Z` : value);
    const end = parsed === null ? null : parsed + (day ? 86400000 : 0);
    if (end === null || !Number.isFinite(now) || end <= now)
        throw new Error("Expiry must be a real future date or instant");
    return new Date(end).toISOString();
}
export async function grantMembership(db: D1Database, input: {
    actorId: string;
    issuerId: string;
    targetId: string;
    role: "owner" | "attester";
    validUntil?: string | null;
}): Promise<string | null> {
    if (!["owner", "attester"].includes(input.role))
        throw new Error("Invalid issuer role");
    const until = normalizeTrustExpiry(input.validUntil);
    const proof = await currentIssuerMembershipProof(db, input.issuerId, input.actorId);
    const op = crypto.randomUUID(), id = crypto.randomUUID();
    const results = await db.batch([
        db.prepare("UPDATE issuers SET status=status WHERE id=?").bind(input.issuerId),
        db.prepare(`INSERT INTO issuer_management_operations(id,issuer_id,actor_user_id,target_user_id,membership_id,action,reason)
      SELECT ?,i.id,u.id,?,?,'grant','explicit membership grant' FROM issuers i JOIN users u ON u.id=?
      WHERE i.id=? AND i.status='active' AND u.is_active=1 AND ${MANAGE_ISSUER_SQL}
      AND EXISTS(SELECT 1 FROM users target WHERE target.id=? AND target.is_active=1)`)
            .bind(op, input.targetId, id, input.actorId, input.issuerId, ...proof, input.targetId),
        db.prepare(`UPDATE issuer_memberships SET status='revoked',revoked_at=CURRENT_TIMESTAMP,revoked_reason='superseded by explicit re-grant'
      WHERE issuer_id=? AND user_id=? AND status='active' AND EXISTS(SELECT 1 FROM issuer_management_operations WHERE id=?)`)
            .bind(input.issuerId, input.targetId, op),
        db.prepare(`INSERT INTO issuer_memberships(id,issuer_id,user_id,role,status,valid_from,valid_until)
      SELECT membership_id,issuer_id,target_user_id,?,'active',CURRENT_TIMESTAMP,? FROM issuer_management_operations WHERE id=?`)
            .bind(input.role, until, op),
        db.prepare(`INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
      SELECT actor_user_id,'issuer.membership.granted','issuer_membership',membership_id,'null',?,CURRENT_TIMESTAMP
      FROM issuer_management_operations WHERE id=?`)
            .bind(JSON.stringify({ role: input.role, valid_until: until, operation_id: op }), op),
    ]);
    return Number(results[3]?.meta.changes ?? 0) === 1 ? id : null;
}
export async function revokeMembership(db: D1Database, input: {
    actorId: string;
    membershipId: string;
    reason: string;
}): Promise<boolean> {
    const target = await db.prepare("SELECT issuer_id FROM issuer_memberships WHERE id=?").bind(input.membershipId).first<{
        issuer_id: string;
    }>();
    if (!target)
        return false;
    const proof = await currentIssuerMembershipProof(db, target.issuer_id, input.actorId);
    const op = crypto.randomUUID();
    const results = await db.batch([
        db.prepare("UPDATE issuers SET status=status WHERE id=(SELECT issuer_id FROM issuer_memberships WHERE id=?)").bind(input.membershipId),
        db.prepare(`INSERT INTO issuer_management_operations(id,issuer_id,actor_user_id,target_user_id,membership_id,action,reason)
      SELECT ?,i.id,u.id,target.user_id,target.id,'revoke',? FROM issuer_memberships target JOIN issuers i ON i.id=target.issuer_id
      JOIN users u ON u.id=? WHERE target.id=? AND target.status='active' AND u.is_active=1 AND ${MANAGE_ISSUER_SQL}`)
            .bind(op, input.reason, input.actorId, input.membershipId, ...proof),
        db.prepare(`UPDATE issuer_memberships SET status='revoked',revoked_at=CURRENT_TIMESTAMP,revoked_reason=?
      WHERE id=? AND status='active' AND EXISTS(SELECT 1 FROM issuer_management_operations WHERE id=?)`)
            .bind(input.reason, input.membershipId, op),
        db.prepare(`INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
      SELECT actor_user_id,'issuer.membership.revoked','issuer_membership',membership_id,'null',?,CURRENT_TIMESTAMP
      FROM issuer_management_operations WHERE id=?`)
            .bind(JSON.stringify({ reason: input.reason, operation_id: op }), op),
    ]);
    return Number(results[2]?.meta.changes ?? 0) === 1;
}

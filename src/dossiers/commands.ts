import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { buildActiveGrantPredicate } from "../marketplace/commands";
import { EDITORIAL_ROLES } from "../access/horseAccess";

/**
 * R95-N13 — dossier creation and link minting carry the CURRENT horse/seller
 * mandate INSIDE the transaction. The preflight (requireHorseAction) gives
 * the honest early error; the INSERT..SELECT is the enforcement: a mandate
 * revoked (or a horse deleted) between preflight and the batch makes the
 * insert match zero rows — no snapshot, no share token, no partial state.
 * Each batch also lands a marker-gated audit row (the operation receipt)
 * conditioned on THIS call's operation id, so an audit event can only exist
 * for a write that actually happened.
 */

export interface DossierCreateCommand {
  operationId: string; actorUserId: string; actorRole: string;
  horseId: number; version: number; snapshotJson: string; sectionsMetaJson: string; issuedDigest: string;
}

export const DOSSIER_INSERT_SQL = `INSERT INTO dossier_snapshots(horse_id,created_by_user_id,version,snapshot_json,sections_meta_json,issued_digest,last_operation_id)
  SELECT ?,?,?,?,?,?,?
  FROM horses h
  WHERE h.id=? AND h.deleted_at IS NULL AND h.is_active=1
    AND EXISTS(SELECT 1 FROM users u WHERE u.id=? AND u.is_active=1 AND (u.role IN ({{editorialSlots}}) OR {{grantPredicate}}))`;

export const DOSSIER_INSERT_AUDIT_SQL = `INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
  SELECT ?,'dossier.created','dossier_snapshots',CAST(id AS TEXT),'null',?,CURRENT_TIMESTAMP
  FROM dossier_snapshots WHERE last_operation_id=?`;

export function createDossierStatements(db: D1Database, input: DossierCreateCommand): D1PreparedStatement[] {
  const nowIso = new Date().toISOString();
  const grant = buildActiveGrantPredicate("h.id", "create_listing", { userId: input.actorUserId }, nowIso);
  return [
    db.prepare(DOSSIER_INSERT_SQL.replace("{{grantPredicate}}", grant.sql).replace("{{editorialSlots}}", EDITORIAL_ROLES.map(() => "?").join(",")))
      .bind(input.horseId, input.actorUserId, input.version, input.snapshotJson, input.sectionsMetaJson, input.issuedDigest, input.operationId,
        input.horseId, input.actorUserId, ...EDITORIAL_ROLES, ...grant.binds),
    db.prepare(DOSSIER_INSERT_AUDIT_SQL)
      .bind(input.actorUserId, JSON.stringify({ horse_id: input.horseId, issued_digest: input.issuedDigest }), input.operationId),
  ];
}

export interface DossierLinkMintCommand {
  operationId: string; actorUserId: string; actorRole: string;
  dossierId: number; tokenHash: string; expiresAt: string; recipientUserId: string | null;
}

export const DOSSIER_LINK_INSERT_SQL = `INSERT INTO dossier_share_links(dossier_id,token_hash,expires_at,recipient_user_id,created_by_user_id,last_operation_id)
  SELECT ?,?,?,?,?,?
  FROM dossier_snapshots ds
  WHERE ds.id=? AND ds.status='active' AND ds.created_by_user_id=?
    AND EXISTS(SELECT 1 FROM horses WHERE id=ds.horse_id AND deleted_at IS NULL AND is_active=1)
    AND EXISTS(SELECT 1 FROM users u WHERE u.id=? AND u.is_active=1 AND (u.role IN ({{editorialSlots}}) OR {{grantPredicate}}))`;

export const DOSSIER_LINK_INSERT_AUDIT_SQL = `INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
  SELECT ?,'dossier.link_created','dossier_share_links',CAST(id AS TEXT),'null',?,CURRENT_TIMESTAMP
  FROM dossier_share_links WHERE last_operation_id=?`;

export function createDossierLinkStatements(db: D1Database, input: DossierLinkMintCommand): D1PreparedStatement[] {
  const nowIso = new Date().toISOString();
  const grant = buildActiveGrantPredicate("ds.horse_id", "create_listing", { userId: input.actorUserId }, nowIso);
  return [
    db.prepare(DOSSIER_LINK_INSERT_SQL.replace("{{grantPredicate}}", grant.sql).replace("{{editorialSlots}}", EDITORIAL_ROLES.map(() => "?").join(",")))
      .bind(input.dossierId, input.tokenHash, input.expiresAt, input.recipientUserId, input.actorUserId, input.operationId,
        input.dossierId, input.actorUserId, input.actorUserId, ...EDITORIAL_ROLES, ...grant.binds),
    db.prepare(DOSSIER_LINK_INSERT_AUDIT_SQL)
      .bind(input.actorUserId, JSON.stringify({ dossier_id: input.dossierId, recipient_restricted: input.recipientUserId != null }), input.operationId),
  ];
}

export function revokeDossierStatements(db: D1Database, input: {id: number; actorUserId: string; operationId: string}): D1PreparedStatement[] {
  return [
    db.prepare(`UPDATE dossier_snapshots SET status='revoked',row_version=row_version+1,last_operation_id=?
      WHERE id=? AND status='active' AND created_by_user_id=?`)
      .bind(input.operationId,input.id,input.actorUserId),
    db.prepare(`UPDATE dossier_share_links SET revoked_at=CURRENT_TIMESTAMP,revoked_by_user_id=?
      WHERE dossier_id=? AND revoked_at IS NULL AND EXISTS(SELECT 1 FROM dossier_snapshots d WHERE d.id=dossier_share_links.dossier_id AND d.last_operation_id=?)`)
      .bind(input.actorUserId,input.id,input.operationId),
    db.prepare(`INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
      SELECT ?,'dossier.revoked','dossier_snapshots',CAST(id AS TEXT),'{}','{"status":"revoked","all_links_revoked":true}',CURRENT_TIMESTAMP
      FROM dossier_snapshots WHERE id=? AND last_operation_id=?`).bind(input.actorUserId,input.id,input.operationId),
  ];
}
export function revokeDossierLinkStatements(db: D1Database, input: {id: number; linkId: number; actorUserId: string; operationId: string}): D1PreparedStatement[] {
  return [
    db.prepare(`UPDATE dossier_share_links SET revoked_at=CURRENT_TIMESTAMP,revoked_by_user_id=?,last_operation_id=?
      WHERE id=? AND dossier_id=? AND revoked_at IS NULL AND EXISTS(SELECT 1 FROM dossier_snapshots d WHERE d.id=dossier_share_links.dossier_id AND d.created_by_user_id=?)`)
      .bind(input.actorUserId,input.operationId,input.linkId,input.id,input.actorUserId),
    db.prepare(`INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
      SELECT ?,'dossier.link_revoked','dossier_share_links',CAST(id AS TEXT),'{}','{"revoked":true}',CURRENT_TIMESTAMP
      FROM dossier_share_links WHERE id=? AND last_operation_id=?`).bind(input.actorUserId,input.linkId,input.operationId),
  ];
}

// ---------------------------------------------------------------------------
// R96-N07 — the VIEW linearization point
// ---------------------------------------------------------------------------

export interface DossierViewClaimCommand {
  /** The link being claimed (already resolved by token hash). */
  linkId: number;
  /** Session user id, or null for anonymous — recipient-restricted links can never be claimed anonymously. */
  viewerUserId: string | null;
  nowIso: string;
}

/**
 * THE linearization point of a public dossier view (R96-N07).
 *
 * Before N07 the view authorized SEQUENTIALLY: read link, read dossier, read
 * creator, read horse, check the mandate, then bump the counter — six awaited
 * reads with no consistency between them, so a revocation (or mandate
 * withdrawal, or horse deletion) landing between two reads could still serve
 * forbidden bytes, and the counter could count a view that was later refused.
 *
 * Now ONE conditional UPDATE decides everything: the access counter — the
 * recorded fact that an authorized view happened — is incremented IF AND ONLY
 * IF, at this single statement's instant, ALL of these hold:
 *   the link is live (not revoked, not expired),
 *   the recipient restriction matches the CURRENT viewer session,
 *   the dossier is still active,
 *   the creator's account is still active (users.is_active),
 *   the horse still exists (not deleted),
 *   the creator's CURRENT role is editorial OR they still hold a live
 *     create_listing mandate for that horse — evaluated for the ROW-DERIVED
 *     creator (ds.created_by_user_id) inside the statement, never a
 *     JS-passed stale copy of who the creator was.
 * changes=1  -> the view is authorized as of this instant (counter = proof).
 * changes=0  -> the view is refused; the counter is NOT touched, so refused
 *               views never masquerade as authorized accesses.
 * The dossier bytes SELECT that follows in the same batch reads immutable
 * frozen content (snapshot_json is never rewritten), and re-asserts status
 * 'active' — a concurrent revocation committing between the two statements
 * (possible on PostgreSQL READ COMMITTED) can only make the view MORE
 * restrictive, never less.
 */
export const DOSSIER_VIEW_CLAIM_SQL = `UPDATE dossier_share_links
  SET access_count=access_count+1, last_accessed_at=CURRENT_TIMESTAMP
  WHERE id=?
    AND revoked_at IS NULL
    AND datetime(expires_at) > datetime('now')
    AND (recipient_user_id IS NULL OR (recipient_user_id=? AND EXISTS(SELECT 1 FROM users recipient WHERE recipient.id=dossier_share_links.recipient_user_id AND recipient.is_active=1)))
    AND EXISTS(
      SELECT 1 FROM dossier_snapshots ds
      JOIN users u ON u.id=ds.created_by_user_id AND u.is_active=1
      JOIN horses h ON h.id=ds.horse_id AND h.deleted_at IS NULL AND h.is_active=1
      WHERE ds.id=dossier_share_links.dossier_id
        AND ds.status='active'
        AND (u.role IN ({{editorialSlots}}) OR {{grantPredicate}})
    )`;

export const DOSSIER_VIEW_READ_SQL = `SELECT ds.id, ds.horse_id, ds.snapshot_json, ds.sections_meta_json,
    ds.version, ds.created_at, ds.created_by_user_id, ds.issued_digest
  FROM dossier_snapshots ds
  WHERE ds.id=(SELECT dossier_id FROM dossier_share_links WHERE id=?) AND ds.status='active'
    AND EXISTS(SELECT 1 FROM horses h WHERE h.id=ds.horse_id AND h.deleted_at IS NULL AND h.is_active=1)`;

export function claimDossierViewStatements(db: D1Database, input: DossierViewClaimCommand): D1PreparedStatement[] {
  const grant = buildActiveGrantPredicate("ds.horse_id", "create_listing", { userIdColumn: "ds.created_by_user_id" }, input.nowIso);
  return [
    db.prepare(DOSSIER_VIEW_CLAIM_SQL
        .replace("{{editorialSlots}}", EDITORIAL_ROLES.map(() => "?").join(","))
        .replace("{{grantPredicate}}", grant.sql).replace("{{editorialSlots}}", EDITORIAL_ROLES.map(() => "?").join(",")))
      .bind(input.linkId, input.viewerUserId, ...EDITORIAL_ROLES, ...grant.binds),
    db.prepare(DOSSIER_VIEW_READ_SQL).bind(input.linkId),
  ];
}

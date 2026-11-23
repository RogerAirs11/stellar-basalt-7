import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import {
  PERSON_MANDATE_AUTHORITY_SQL,
  HORSE_MANDATE_REFERENCE_SQL,
  SERVICE_TRANSITION_MATRIX,
  isServiceProviderManager,
  serviceReceiptKey,
  serviceTransitionAllowed,
  type ServiceActor,
} from "./policy";
import {
  MAX_NEW_PER_CATEGORY_PER_DAY,
  MAX_NEW_REQUESTS_PER_DAY,
} from "./privacy";

/**
 * R95-N11 — service-request commands derive every transition fact from the
 * ONE matrix in ./policy.ts and re-check ALL create-time authority inside the
 * transaction: active actor, published provider + reviewed category, the
 * self-lead refusal (current personal mandate), requester blocks, the open
 * lead bound, and the requester's CURRENT horse mandate. A block, an
 * unpublish, a revoked grant or a withdrawn link landing between route
 * preflight and the batch makes the receipt INSERT match zero rows — the
 * request is never recorded, and no partial state survives.
 *
 * R95-N12 — the create transaction additionally enforces the anti-abuse
 * lifecycle: provider-side blocks (neutral refusal), explicit moderation
 * standing, the per-account daily bound, the per-account/category bound and
 * duplicate-lead detection. Every bound is about the ACTING account only —
 * no other requester's identity is ever examined or revealed.
 *
 * The SQL lives in exported template constants (placeholder form) so the
 * python parity suite regex-extracts and replays the EXACT production SQL
 * against real PostgreSQL (marketplace GRANT_PREDICATE_TEMPLATE pattern).
 */

export { serviceTransitionAllowed, serviceReceiptKey, isServiceProviderManager, SERVICE_TRANSITION_MATRIX } from "./policy";

/** Self-lead refusal: the actor holds the CURRENT personal mandate for the
 * provider person. The outer claim SELECT has no people alias in scope, so
 * the person is bound as a parameter ({{personColumn}} -> ?). */
const SELF_LEAD_REFUSAL_SQL = `NOT EXISTS(${PERSON_MANDATE_AUTHORITY_SQL.replace("{{personColumn}}", "?")})`;

export interface CreateServiceCommand {
  operationId: string; receiptKey: string; digest: string; actorUserId: string;
  providerPersonId: number; category: string; province: string | null; city: string | null;
  horseId: number | null; note: string; shareContact: boolean; responseJson: string;
}

/**
 * Receipt claim + ALL create-time authority in one statement. Placeholders:
 * {{selfLeadRefusal}} (mandate predicate on p.id) and {{horseMandate}} (the
 * grant predicate; only evaluated for a non-NULL horse reference).
 * N12 arms: provider-side block, abuse standing, daily + per-category rate
 * bounds and duplicate detection (all transactional — a race that lands
 * between preflight and batch makes the INSERT match zero rows).
 */
export const SERVICE_RECEIPT_INSERT_SQL = `INSERT INTO service_request_receipts(id,actor_user_id,target_person_id,request_digest,status_code,response_json,operation_id)
      SELECT ?,?,?,?,201,?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND is_active=1)
        AND EXISTS(SELECT 1 FROM people p JOIN directory_profiles dp ON dp.person_id=p.id
          WHERE p.id=? AND p.deleted_at IS NULL AND dp.publication_consent=1 AND dp.service_categories LIKE ?)
        AND {{selfLeadRefusal}}
        AND NOT EXISTS(SELECT 1 FROM service_request_blocks WHERE blocker_user_id=? AND blocked_person_id=?)
        AND NOT EXISTS(SELECT 1 FROM service_provider_blocks WHERE provider_person_id=? AND blocked_requester_user_id=?)
        AND NOT EXISTS(SELECT 1 FROM service_abuse_standing WHERE user_id=? AND standing<>'normal')
        AND (SELECT COUNT(*) FROM service_requests WHERE requester_user_id=? AND provider_person_id=?
          AND status IN ('new','acknowledged','discussing'))<3
        AND (SELECT COUNT(*) FROM service_requests WHERE requester_user_id=? AND datetime(created_at)>=datetime(?))<${MAX_NEW_REQUESTS_PER_DAY}
        AND (SELECT COUNT(*) FROM service_requests WHERE requester_user_id=? AND category=? AND datetime(created_at)>=datetime(?))<${MAX_NEW_PER_CATEGORY_PER_DAY}
        AND NOT EXISTS(SELECT 1 FROM service_requests WHERE requester_user_id=? AND provider_person_id=? AND category=? AND note=? AND datetime(created_at)>=datetime(?))
        AND (CAST(? AS BIGINT) IS NULL OR EXISTS({{horseMandate}}))
      ON CONFLICT(id) DO NOTHING`;

export const SERVICE_REQUEST_INSERT_SQL = `INSERT INTO service_requests(requester_user_id,provider_person_id,provider_organization_id,category,province_code,city,horse_id,note,share_contact,creation_operation_id,province_code_scheme)
      SELECT ?,?,NULL,?,?,?,?,?,?,?,'iso3166-2-ir:2020-11-24' FROM service_request_receipts WHERE operation_id=?`;

export const SERVICE_RECEIPT_LINK_SQL = `UPDATE service_request_receipts SET request_id=(SELECT id FROM service_requests WHERE creation_operation_id=?) WHERE operation_id=?`;

export const SERVICE_CREATE_AUDIT_SQL = `INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
      SELECT ?,'service_request.created','service_request',CAST(id AS TEXT),'null',?,CURRENT_TIMESTAMP
      FROM service_requests WHERE creation_operation_id=?`;

export const SERVICE_CREATE_OUTBOX_SQL = `INSERT INTO notification_outbox(event_key,channel,purpose,essential,recipient_user_id,recipient_masked,payload_ref)
      SELECT 'service-request:' || CAST(r.id AS TEXT) || ':created:' || l.user_id,'email','service_request_notice',0,l.user_id,'provider account','service_requests:' || CAST(r.id AS TEXT)
      FROM service_requests r JOIN user_person_links l ON l.person_id=r.provider_person_id AND l.status='verified'
      JOIN users u ON u.id=l.user_id AND u.is_active=1
      WHERE r.creation_operation_id=? AND l.user_id<>r.requester_user_id
        AND NOT EXISTS(SELECT 1 FROM service_provider_blocks b
          WHERE b.provider_person_id=r.provider_person_id AND b.blocked_requester_user_id=r.requester_user_id)
      ON CONFLICT(event_key) DO NOTHING`;

export function createServiceStatements(db: D1Database, input: CreateServiceCommand): D1PreparedStatement[] {
  const nowIso = new Date().toISOString();
  const dayStartIso = new Date(new Date(nowIso).getTime() - 24 * 3_600_000).toISOString();
  const receiptSql = SERVICE_RECEIPT_INSERT_SQL
    .replace("{{selfLeadRefusal}}", SELF_LEAD_REFUSAL_SQL)
    .replace("{{horseMandate}}", HORSE_MANDATE_REFERENCE_SQL);
  return [
    // Serialize this actor's quota check across distinct idempotency keys.
    db.prepare("UPDATE users SET updated_at=updated_at WHERE id=? AND is_active=1").bind(input.actorUserId),
    db.prepare(receiptSql).bind(
      input.receiptKey, input.actorUserId, input.providerPersonId, input.digest, input.responseJson, input.operationId,
      input.actorUserId, input.providerPersonId, `%"${input.category}"%`, input.actorUserId, input.providerPersonId,
      input.actorUserId, input.providerPersonId, input.providerPersonId, input.actorUserId,
      input.actorUserId,
      input.actorUserId, input.providerPersonId,
      input.actorUserId, dayStartIso,
      input.actorUserId, input.category, dayStartIso,
      input.actorUserId, input.providerPersonId, input.category, input.note, dayStartIso,
      input.horseId,
      input.horseId, nowIso, input.actorUserId, input.actorUserId, nowIso, nowIso,
    ),
    db.prepare(SERVICE_REQUEST_INSERT_SQL)
      .bind(input.actorUserId, input.providerPersonId, input.category, input.province, input.city, input.horseId, input.note, input.shareContact ? 1 : 0, input.operationId, input.operationId),
    db.prepare(SERVICE_RECEIPT_LINK_SQL).bind(input.operationId, input.operationId),
    db.prepare(SERVICE_CREATE_AUDIT_SQL)
      .bind(input.actorUserId, JSON.stringify({ provider_person_id: input.providerPersonId, category: input.category, share_contact: input.shareContact }), input.operationId),
    db.prepare(SERVICE_CREATE_OUTBOX_SQL).bind(input.operationId),
  ];
}

export interface TransitionServiceCommand {
  requestId: number; expectedVersion: number; from: string; to: string;
  actorUserId: string; actor: ServiceActor; operationId: string;
}

/**
 * The transition UPDATE: CAS on (id, row_version, status) with the actor's
 * authority arm evaluated in the SAME statement — the provider arm requires
 * the CURRENT personal mandate (a revoked link fails closed, zero rows).
 * The moderator axis has no SQL arm: the matrix permits no moderator
 * transition, so the RangeError fires long before SQL runs.
 * Placeholder form ({{personMandate}}) so the python parity suite
 * regex-extracts and reconstructs the EXACT production SQL.
 */
export const SERVICE_TRANSITION_UPDATE_SQL = `UPDATE service_requests SET status=?,row_version=row_version+1,updated_at=CURRENT_TIMESTAMP,
      closed_at=CASE WHEN ? IN ('closed','withdrawn','spam') THEN CURRENT_TIMESTAMP ELSE closed_at END,
      first_response_at=CASE WHEN ? IN ('acknowledged','discussing') AND first_response_at IS NULL THEN CURRENT_TIMESTAMP ELSE first_response_at END,
      last_transition_by_user_id=?,last_operation_id=?
      WHERE id=? AND row_version=? AND status=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND is_active=1)
        AND ((?='requester' AND requester_user_id=?) OR (?='provider' AND EXISTS({{personMandate}})))`;

export const SERVICE_TRANSITION_AUDIT_SQL = `INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
      SELECT ?,'service_request.transitioned','service_request',CAST(id AS TEXT),?,?,CURRENT_TIMESTAMP FROM service_requests WHERE last_operation_id=?`;

export const SERVICE_TRANSITION_OUTBOX_SQL = `INSERT INTO notification_outbox(event_key,channel,purpose,essential,recipient_user_id,recipient_masked,payload_ref)
      SELECT 'service-request:' || CAST(r.id AS TEXT) || ':v' || CAST(r.row_version AS TEXT) || ':' || u.id,'email','service_request_notice',0,u.id,'participant account','service_requests:' || CAST(r.id AS TEXT)
      FROM service_requests r JOIN users u ON u.is_active=1 AND u.id<>?
        AND ((?='provider' AND u.id=r.requester_user_id) OR (?='requester' AND EXISTS(
          SELECT 1 FROM user_person_links l WHERE l.person_id=r.provider_person_id AND l.user_id=u.id AND l.status='verified')))
      WHERE r.last_operation_id=? ON CONFLICT(event_key) DO NOTHING`;

/**
 * Marker-gated notice suppression appended when a requester WITHDRAWS a lead
 * (N12): pending optional (non-essential) notices about that request are
 * suppressed. Essential security notices are never touched (essential=0).
 */
export const SERVICE_TRANSITION_SUPPRESS_SQL = `UPDATE notification_outbox SET status='suppressed',last_error='lead_withdrawn',last_operation_id=?
      WHERE status='queued' AND essential=0
        AND event_key LIKE 'service-request:' || CAST(? AS TEXT) || ':%'
        AND EXISTS(SELECT 1 FROM service_requests WHERE id=? AND last_operation_id=? AND status='withdrawn')`;

export function transitionServiceStatements(db: D1Database, input: TransitionServiceCommand): D1PreparedStatement[] {
  if (!serviceTransitionAllowed(input.from, input.to, input.actor)) throw new RangeError(`Illegal service-request transition ${input.from}->${input.to} for actor ${input.actor}`);
  const transitionSql = SERVICE_TRANSITION_UPDATE_SQL.replace("{{personMandate}}", PERSON_MANDATE_AUTHORITY_SQL.replace("{{personColumn}}", "service_requests.provider_person_id"));
  const statements: D1PreparedStatement[] = [
    db.prepare(transitionSql)
      .bind(input.to, input.to, input.to, input.actorUserId, input.operationId, input.requestId, input.expectedVersion, input.from, input.actorUserId, input.actor, input.actorUserId, input.actor, input.actorUserId),
    db.prepare(SERVICE_TRANSITION_AUDIT_SQL)
      .bind(input.actorUserId, JSON.stringify({ status: input.from, row_version: input.expectedVersion }), JSON.stringify({ status: input.to, by: input.actor }), input.operationId),
    db.prepare(SERVICE_TRANSITION_OUTBOX_SQL).bind(input.actorUserId, input.actor, input.actor, input.operationId),
  ];
  // N12: withdrawing the whole lead also suppresses its pending optional
  // notices (marker-gated on the transition that just landed). The LIKE
  // pattern bind is a STRING — the local driver binds numbers as REAL and
  // CAST(901.0 AS TEXT) would render '901.0'.
  if (input.to === "withdrawn") {
    statements.push(db.prepare(SERVICE_TRANSITION_SUPPRESS_SQL).bind(input.operationId, String(input.requestId), input.requestId, input.operationId));
  }
  return statements;
}

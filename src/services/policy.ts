import type { D1Database } from "@cloudflare/workers-types";

/**
 * R95-N11 — the ONE service-request state machine and provider mandate policy.
 *
 * Doctrine (from the R95 reviewed plan):
 *  - There is exactly ONE role-aware transition graph. The route metadata and
 *    the pure command layer both DERIVE from SERVICE_TRANSITION_MATRIX; no
 *    surface may keep its own copy of the transition facts.
 *  - A provider mandate (WHO may act as a provider person) is established by
 *    a VERIFIED user/person link — account/person verification. Organization
 *    affiliation authority is a SEPARATE concept from ordinary organization
 *    membership; until a reviewed person/organization affiliation mandate
 *    exists, organization-routed leads stay disabled (honest refusal, never
 *    a silent fallback to membership).
 *  - Moderation is NOT blanket staff access: the moderator axis exists in the
 *    matrix but is empty by design. N14 landed the moderation authority
 *    elsewhere: staff act through the moderation case workflow
 *    (src/moderation — the case state machine + the standing lifecycle in
 *    src/moderation/standing.ts), never through this lead machine. Editors/
 *    admins still do not read or move another person's leads by role alone.
 *  - A service request is a LEAD, never an appointment: no paid/booked/
 *    confirmed state exists anywhere in the matrix (the DB CHECK constraint
 *    is the storage-level proof).
 */

// ---------------------------------------------------------------------------
// States and actors.
// ---------------------------------------------------------------------------

export { SERVICE_STATES, SERVICE_ACTORS, SERVICE_TERMINAL_STATES,
  SERVICE_TRANSITION_MATRIX, serviceTransitionAllowed, serviceTransitionsFor,
  serviceActorsPermitting, serviceRouteTransitions } from "../shared/serviceTransitions";
export type { ServiceState, ServiceActor, ServiceRouteTransitions } from "../shared/serviceTransitions";

// ---------------------------------------------------------------------------
// Provider mandates: account/person verification vs organization affiliation.
// ---------------------------------------------------------------------------

/** Mandate kinds the state machine currently understands. */
export const SERVICE_MANDATE_KINDS = ["person"] as const;
export type ServiceMandateKind = (typeof SERVICE_MANDATE_KINDS)[number];

/**
 * Organization-routed provider mandates are NOT supported yet. The reviewed
 * person/organization affiliation workflow does not exist, and ordinary
 * organization membership deliberately does NOT establish authority over a
 * professional person's leads. The route surfaces this refusal verbatim.
 */
export const ORGANIZATION_SERVICE_LEADS = {
  supported: false,
  refusal: {
    status: 422 as const,
    code: "provider_affiliation_required",
    message: "Organization-routed leads require a reviewed person/organization affiliation, which is not yet supported. Send a person-directed request instead.",
  },
} as const;

/**
 * The CURRENT personal provider-mandate predicate (SQL): the account is
 * active, the person is a live registry person, and the user/person link is
 * VERIFIED. `{{personColumn}}` is substituted per statement — this one
 * template backs the create self-lead refusal, the transition authority arm
 * and the notification fan-out, so mandate semantics can never drift.
 * Placeholder form so the python parity suite regex-extracts the EXACT
 * production SQL (marketplace GRANT_PREDICATE_TEMPLATE pattern).
 */
export const PERSON_MANDATE_AUTHORITY_SQL = "SELECT 1 FROM user_person_links l JOIN people pl ON pl.id=l.person_id AND pl.deleted_at IS NULL JOIN users pu ON pu.id=l.user_id AND pu.is_active=1 WHERE l.user_id=? AND l.person_id={{personColumn}} AND l.status='verified'";

/**
 * A requester may reference a horse in a lead only while they hold a CURRENT
 * mandate on it (a live direct grant, or a grant to one of their active
 * organizations). The action list narrows what you may DO with the horse;
 * referencing it in your own consented lead needs the mandate itself.
 * Re-checked INSIDE the create transaction, not only in route preflight.
 */
export const HORSE_MANDATE_REFERENCE_SQL = `SELECT 1 FROM horse_access_grants g
  WHERE g.horse_id=?
    AND g.revoked_at IS NULL
    AND (g.valid_until IS NULL OR datetime(g.valid_until) > datetime(?))
    AND (
      g.grantee_user_id=?
      OR (g.grantee_user_id IS NULL AND EXISTS(
        SELECT 1 FROM organization_memberships m
        JOIN organizations o ON o.id=m.organization_id AND o.status='active'
        WHERE m.organization_id=g.grantee_organization_id
          AND m.user_id=?
          AND m.status='active'
          AND m.revoked_at IS NULL
          AND datetime(m.valid_from) <= datetime(?)
          AND (m.valid_until IS NULL OR datetime(m.valid_until) > datetime(?))
      ))
    )`;

/** Route preflight for the horse mandate (the transaction re-checks anyway). */
export async function requesterHasHorseMandate(db: D1Database, userId: string, horseId: number, nowIso: string): Promise<boolean> {
  const row = await db.prepare(`SELECT 1 AS ok WHERE EXISTS(${HORSE_MANDATE_REFERENCE_SQL})`)
    .bind(horseId, nowIso, userId, userId, nowIso, nowIso).first();
  return Boolean(row);
}

/** Staff moderation is not blanket permission to read another person's leads. */
export async function isServiceProviderManager(db: D1Database, userId: string, personId: number): Promise<boolean> {
  return Boolean(await db.prepare(`SELECT l.id FROM user_person_links l JOIN users u ON u.id=l.user_id AND u.is_active=1
    JOIN people p ON p.id=l.person_id AND p.deleted_at IS NULL
    WHERE l.user_id=? AND l.person_id=? AND l.status='verified'`).bind(userId,personId).first());
}

/**
 * The old receipt PK was global. Namespace new client keys by actor without
 * modifying or stealing any legacy receipt. No user-controlled SQL identifiers.
 */
export async function serviceReceiptKey(actor: string, clientKey: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([actor, clientKey])));
  return "sr1:" + [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2,"0")).join("");
}

// ---------------------------------------------------------------------------
// Legacy receipt conflict resolution (defined; never a duplicate lead).
// ---------------------------------------------------------------------------

export interface LegacyServiceReceipt {
  id: string;
  response_json: string;
  request_digest: string;
  request_id: number | null;
  created_at: string;
}

export type LegacyReceiptResolution =
  | { kind: "linked"; requestId: number }
  | { kind: "unresolved"; reason: "no_candidate" | "ambiguous" | "unreadable" };

/**
 * A pre-0054 receipt has no durable request link. Resolution is DETERMINISTIC:
 * if exactly ONE request from this actor to the receipt's provider/category
 * exists at or after the receipt time, it is claimed atomically (CAS on
 * request_id IS NULL) and replayed. Zero or multiple candidates is an honest
 * `unresolved` — the client must use a new key, and NO duplicate lead is ever
 * created to paper over the gap.
 */
export async function resolveLegacyServiceReceipt(db: D1Database, actorUserId: string, receipt: LegacyServiceReceipt): Promise<LegacyReceiptResolution> {
  if (receipt.request_id != null) return { kind: "linked", requestId: receipt.request_id };
  let target: { provider_person_id?: unknown; category?: unknown } = {};
  try {
    const parsed = JSON.parse(receipt.response_json) as { request?: { provider_person_id?: unknown; category?: unknown } };
    if (parsed && typeof parsed === "object" && parsed.request && typeof parsed.request === "object") {
      target = parsed.request as { provider_person_id?: unknown; category?: unknown };
    }
  } catch {
    return { kind: "unresolved", reason: "unreadable" };
  }
  const providerPersonId = Number(target.provider_person_id);
  const category = typeof target.category === "string" ? target.category : null;
  if (!Number.isInteger(providerPersonId) || providerPersonId <= 0 || !category) {
    return { kind: "unresolved", reason: "unreadable" };
  }
  const candidates = await db.prepare(
    "SELECT id FROM service_requests WHERE requester_user_id=? AND provider_person_id=? AND category=? AND (created_at>=? OR ?='') ORDER BY id",
  ).bind(actorUserId, providerPersonId, category, receipt.created_at, receipt.created_at).all<{ id: number }>();
  const ids = (candidates.results ?? []).map((row) => Number(row.id));
  if (ids.length !== 1) return { kind: "unresolved", reason: ids.length === 0 ? "no_candidate" : "ambiguous" };
  const requestId = ids[0]!;
  const claim = await db.prepare(
    "UPDATE service_request_receipts SET request_id=? WHERE id=? AND actor_user_id=? AND request_id IS NULL",
  ).bind(requestId, receipt.id, actorUserId).run();
  if (Number(claim?.meta.changes ?? 0) !== 1) {
    // A concurrent replay linked it first — deterministic candidate, same id.
    const after = await db.prepare("SELECT request_id FROM service_request_receipts WHERE id=? AND actor_user_id=?")
      .bind(receipt.id, actorUserId).first<{ request_id: number | null }>();
    if (after?.request_id != null) return { kind: "linked", requestId: Number(after.request_id) };
    return { kind: "unresolved", reason: "ambiguous" };
  }
  return { kind: "linked", requestId };
}

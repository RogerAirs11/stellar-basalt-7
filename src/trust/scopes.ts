import type { D1Database } from "@cloudflare/workers-types";
import { timestampMillis } from "../security/timestamps";
import { normalizeTrustExpiry } from "./membershipCommands";

/**
 * R98-N04: structured issuer scopes.
 *
 * An issuer membership proves WHO the person is; a scope proves WHAT that
 * issuer may attest. Both are re-checked at commit time inside the issuance
 * write. Free-text scope strings are declarative metadata only — they are
 * never an access rule. Scopes carry versioned approval (a new approval
 * supersedes the previous version row without deleting it), effective
 * intervals, suspension (visible history, blocked commands) and revocation.
 *
 * Scope approval is a PLATFORM responsibility (content.manage) exercised only
 * after the issuer's registration evidence has been recorded/reviewed — a
 * federation title in a profile, an editorial role or a paid plan never
 * establishes delegated authority.
 */

export const SCOPE_RECORD_KINDS = ["genetic_test", "media", "competition_result", "horse_identity"] as const;
export type ScopeRecordKind = (typeof SCOPE_RECORD_KINDS)[number];

export const SCOPE_ACTIONS = ["attest", "supersede"] as const;
export type ScopeAction = (typeof SCOPE_ACTIONS)[number];

/** Commit-time scope predicate, evaluated inside the issuance INSERT..SELECT.
 * Mirrors the CURRENT_ISSUER_MEMBER_SQL discipline: exact-bound proof rows,
 * SQL-time date comparisons, no client-trusted values. */
export const ACTIVE_ISSUER_SCOPE_SQL = `EXISTS(SELECT 1 FROM issuer_scopes s JOIN issuer_scope_actions sa ON sa.scope_id=s.id
  WHERE s.issuer_id=i.id AND s.record_kind=? AND s.status='approved'
  AND s.valid_from IS NOT NULL AND datetime(s.valid_from)<=datetime('now')
  AND (s.valid_until IS NULL OR (datetime(s.valid_until)>datetime('now') AND datetime(s.valid_until)>datetime(s.valid_from)))
  AND sa.action=?)`;

export interface IssuerScopeRow {
  id: string;
  issuer_id: string;
  record_kind: ScopeRecordKind;
  status: string;
  scope_version: number;
  valid_from: string;
  valid_until: string | null;
  evidence_note: string;
  actions?: string[];
}

export type ScopeValidity = "approved" | "suspended" | "revoked" | "superseded"
  | "not_yet_valid" | "expired" | "invalid";

/** Pure date/status logic over a stored scope row (mirrors membershipValidity). */
export function scopeValidity(scope: IssuerScopeRow | null | undefined, now = new Date()): ScopeValidity {
  if (!scope) return "revoked";
  if (scope.status === "suspended") return "suspended";
  if (scope.status === "revoked") return "revoked";
  if (scope.status === "superseded") return "superseded";
  const nowMs = now.getTime();
  const start = timestampMillis(scope.valid_from);
  const end = scope.valid_until === null ? null : timestampMillis(scope.valid_until);
  if (!Number.isFinite(nowMs) || start === null || (scope.valid_until !== null && end === null)
    || (end !== null && end <= start)) return "invalid";
  if (start > nowMs) return "not_yet_valid";
  if (end !== null && end <= nowMs) return "expired";
  return "approved";
}

export interface GrantScopeInput {
  actorId: string;
  issuerId: string;
  recordKind: ScopeRecordKind;
  actions: readonly ScopeAction[];
  validFrom?: string | null;
  validUntil?: string | null;
  evidenceNote: string;
}

/**
 * Versioned scope approval, one batch:
 *  1. lock the issuer row (UPDATE ... WHERE id=?) and verify the issuer is
 *     active AND carries recorded registration evidence;
 *  2. INSERT the new scope version (MAX(version)+1) + its action rows,
 *     conditioned on the actor being an active platform manager;
 *  3. mark any previous live scope version superseded (history kept);
 *  4. marker-gated audit event.
 * Returns the new scope id, or null when a predicate refused the write.
 */
export async function grantIssuerScope(db: D1Database, input: GrantScopeInput): Promise<string | null> {
  if (!SCOPE_RECORD_KINDS.includes(input.recordKind)) throw new Error("Unsupported scope record kind");
  const actions = [...new Set(input.actions)].sort();
  if (actions.length === 0 || actions.some((a) => !SCOPE_ACTIONS.includes(a))) throw new Error("At least one structured action is required");
  if (!input.evidenceNote || input.evidenceNote.trim().length < 10) throw new Error("Evidence note must describe the documentary basis of this authority");
  const validUntil = normalizeTrustExpiry(input.validUntil);
  let validFrom: string | null = null;
  if (input.validFrom != null && input.validFrom !== "") {
    const startMs = timestampMillis(input.validFrom);
    if (startMs === null) throw new Error("A real timezone-qualified start instant is required");
    validFrom = new Date(startMs).toISOString();
  }
  const op = crypto.randomUUID(), id = crypto.randomUUID();
  // Order matters: the previous live scope is superseded BEFORE the new
  // version is inserted (the partial unique index issuer_one_live_scope would
  // otherwise reject the insert), and the supersede carries the SAME authority
  // + evidence predicate as the insert — a losing batch leaves the previous
  // live scope untouched. Both engines run batches transactionally, and the
  // leading issuer-row UPDATE serializes competing grants.
  const results = await db.batch([
    db.prepare("UPDATE issuers SET status=status WHERE id=?").bind(input.issuerId),
    db.prepare(`UPDATE issuer_scopes SET status='superseded',superseded_by=?
      WHERE issuer_id=? AND record_kind=? AND status IN ('approved','suspended') AND id<>?
        AND EXISTS(SELECT 1 FROM issuers i JOIN users u ON u.id=? WHERE i.id=issuer_scopes.issuer_id
          AND i.status='active' AND u.is_active=1 AND u.role IN ('admin','super_admin')
          AND i.registration_evidence IS NOT NULL AND length(i.registration_evidence)>0)`)
      .bind(id, input.issuerId, input.recordKind, id, input.actorId),
    db.prepare(`INSERT INTO issuer_scopes(id,issuer_id,record_kind,status,scope_version,valid_from,valid_until,evidence_note,approved_by_user_id)
      SELECT ?,i.id,?,'approved',COALESCE((SELECT MAX(scope_version) FROM issuer_scopes prev WHERE prev.issuer_id=i.id AND prev.record_kind=?),0)+1,
        COALESCE(?,CURRENT_TIMESTAMP),?,?,u.id
      FROM issuers i JOIN users u ON u.id=? WHERE i.id=? AND i.status='active' AND u.is_active=1
        AND u.role IN ('admin','super_admin')
        AND i.registration_evidence IS NOT NULL AND length(i.registration_evidence)>0
        AND NOT EXISTS(SELECT 1 FROM issuer_scopes live WHERE live.issuer_id=i.id AND live.record_kind=? AND live.status IN ('approved','suspended'))`)
      .bind(id, input.recordKind, input.recordKind, validFrom, validUntil, input.evidenceNote.trim(), input.actorId, input.issuerId, input.recordKind),
    db.prepare(`INSERT INTO issuer_scope_actions(scope_id,action) SELECT ?,? WHERE EXISTS(SELECT 1 FROM issuer_scopes WHERE id=?)`)
      .bind(id, actions[0], id),
    ...(actions.length > 1 ? [db.prepare(`INSERT INTO issuer_scope_actions(scope_id,action) SELECT ?,? WHERE EXISTS(SELECT 1 FROM issuer_scopes WHERE id=?)`)
      .bind(id, actions[1], id)] : []),
    db.prepare(`INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
      SELECT approved_by_user_id,'issuer.scope.granted','issuer_scope',id,'null',?,CURRENT_TIMESTAMP
      FROM issuer_scopes WHERE id=? AND status='approved'`)
      .bind(JSON.stringify({ record_kind: input.recordKind, actions, valid_from: validFrom, valid_until: validUntil, evidence_note: input.evidenceNote.trim(), operation_id: op, supersedes_previous_live_version: true }), id),
  ]);
  return Number(results[2]?.meta.changes ?? 0) === 1 ? id : null;
}

export async function transitionIssuerScope(db: D1Database, input: {
  actorId: string;
  scopeId: string;
  to: "suspended" | "approved" | "revoked";
  reason: string;
}): Promise<boolean> {
  if (input.to === "revoked" && (!input.reason || input.reason.trim().length < 3)) throw new Error("A revocation reason is required");
  const op = crypto.randomUUID();
  // NOTE: a SET clause must never repeat the target column — SQLite evaluates
  // right-hand sides against the ORIGINAL row, so `status=?, status=status`
  // would silently restore the old status.
  const setSql = input.to === "suspended"
    ? "status=?,suspended_at=CURRENT_TIMESTAMP,suspended_reason=?"
    : input.to === "revoked"
      ? "status=?,revoked_at=CURRENT_TIMESTAMP,revoked_reason=?"
      : "status=?";
  // Suspended scopes may still be permanently revoked; only resume is
  // confined to the suspended state and suspension to the approved state.
  const fromSql = input.to === "revoked" ? "status IN ('approved','suspended')" : "status=?";
  const fromStatus = input.to === "approved" ? "suspended" : "approved";
  const binds = input.to === "approved"
    ? [input.to, input.scopeId, fromStatus, input.actorId]
    : input.to === "revoked"
      ? [input.to, input.reason, input.scopeId, input.actorId]
      : [input.to, input.reason, input.scopeId, fromStatus, input.actorId];
  const results = await db.batch([
    db.prepare(`UPDATE issuer_scopes SET ${setSql}
      WHERE id=? AND ${fromSql} AND EXISTS(SELECT 1 FROM users u WHERE u.id=? AND u.is_active=1 AND u.role IN ('admin','super_admin'))`)
      .bind(...(binds as unknown[])),
    db.prepare(`INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
      SELECT ?,'issuer.scope.${input.to}','issuer_scope',?,'null',?,CURRENT_TIMESTAMP
      WHERE EXISTS(SELECT 1 FROM issuer_scopes WHERE id=? AND status=?)`)
      .bind(input.actorId, input.scopeId, JSON.stringify({ reason: input.reason || null, operation_id: op }), input.scopeId, input.to),
  ]);
  return Number(results[0]?.meta.changes ?? 0) === 1;
}

/** Issuer-level suspension/retirement/resumption — takes effect on commands
 * and the public effective-status projection, never deleting history. */
export async function transitionIssuerStatus(db: D1Database, input: {
  actorId: string;
  issuerId: string;
  to: "active" | "suspended" | "retired";
  reason: string;
}): Promise<boolean> {
  if (input.to !== "active" && (!input.reason || input.reason.trim().length < 3)) throw new Error("A reason is required for issuer suspension/retirement");
  const op = crypto.randomUUID();
  const results = await db.batch([
    db.prepare(`UPDATE issuers SET status=? WHERE id=? AND status<>?
      AND EXISTS(SELECT 1 FROM users u WHERE u.id=? AND u.is_active=1 AND u.role IN ('admin','super_admin'))`)
      .bind(input.to, input.issuerId, input.to, input.actorId),
    db.prepare(`INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
      SELECT ?,'issuer.status.${input.to}','issuer',?,'null',?,CURRENT_TIMESTAMP WHERE EXISTS(SELECT 1 FROM issuers WHERE id=? AND status=?)`)
      .bind(input.actorId, input.issuerId, JSON.stringify({ reason: input.reason || null, operation_id: op }), input.issuerId, input.to),
  ]);
  return Number(results[0]?.meta.changes ?? 0) === 1;
}

export interface TrustQueueItem {
  kind: string;
  issuer_id: string;
  issuer_slug: string;
  subject_id: string;
  reason_code: string;
  detail_en: string;
}

const EXPIRY_WINDOW_DAYS = 30;

/** Private operator queue (N04 step 4): expiring memberships/scopes, invalid
 * dates, suspended issuers, legacy issuers without recorded registration
 * evidence. Only non-private identifiers and reason codes — no contact data,
 * no evidence notes, no unrelated private rows. */
export async function trustOperatorQueue(db: D1Database): Promise<{ items: TrustQueueItem[] }> {
  const memberships = await db.prepare(`SELECT m.id, m.issuer_id, i.slug, m.valid_until FROM issuer_memberships m
    JOIN issuers i ON i.id=m.issuer_id WHERE m.status='active' AND m.valid_until IS NOT NULL
      AND datetime(m.valid_until) BETWEEN datetime('now') AND datetime('now','+${EXPIRY_WINDOW_DAYS} days')`).all<{ id: string; issuer_id: string; slug: string; valid_until: string }>();
  const invalidMemberships = await db.prepare(`SELECT m.id, m.issuer_id, i.slug FROM issuer_memberships m
    JOIN issuers i ON i.id=m.issuer_id WHERE m.valid_from IS NULL OR (m.valid_until IS NOT NULL AND datetime(m.valid_until)<=datetime(m.valid_from))`).all<{ id: string; issuer_id: string; slug: string }>();
  const suspendedIssuers = await db.prepare(`SELECT id, slug FROM issuers WHERE status='suspended'`).all<{ id: string; slug: string }>();
  const unevidencedIssuers = await db.prepare(`SELECT id, slug FROM issuers WHERE registration_evidence IS NULL OR length(registration_evidence)=0`).all<{ id: string; slug: string }>();
  const expiringScopes = await db.prepare(`SELECT s.id, s.issuer_id, i.slug, s.record_kind, s.valid_until FROM issuer_scopes s
    JOIN issuers i ON i.id=s.issuer_id WHERE s.status='approved' AND s.valid_until IS NOT NULL
      AND datetime(s.valid_until) BETWEEN datetime('now') AND datetime('now','+${EXPIRY_WINDOW_DAYS} days')`).all<{ id: string; issuer_id: string; slug: string; record_kind: string; valid_until: string }>();
  const invalidScopes = await db.prepare(`SELECT s.id, s.issuer_id, i.slug, s.record_kind FROM issuer_scopes s
    JOIN issuers i ON i.id=s.issuer_id WHERE s.valid_from IS NULL OR (s.valid_until IS NOT NULL AND datetime(s.valid_until)<=datetime(s.valid_from))`).all<{ id: string; issuer_id: string; slug: string; record_kind: string }>();
  const suspendedScopes = await db.prepare(`SELECT s.id, s.issuer_id, i.slug, s.record_kind FROM issuer_scopes s
    JOIN issuers i ON i.id=s.issuer_id WHERE s.status='suspended'`).all<{ id: string; issuer_id: string; slug: string; record_kind: string }>();
  const items: TrustQueueItem[] = [
    ...memberships.results.map((m) => ({ kind: "membership", issuer_id: m.issuer_id, issuer_slug: m.slug, subject_id: m.id,
      reason_code: "membership_expiring", detail_en: `Active membership expires ${m.valid_until}` })),
    ...invalidMemberships.results.map((m) => ({ kind: "membership", issuer_id: m.issuer_id, issuer_slug: m.slug, subject_id: m.id,
      reason_code: "membership_invalid_dates", detail_en: "Membership interval is malformed (end before start or missing start)" })),
    ...suspendedIssuers.results.map((i) => ({ kind: "issuer", issuer_id: i.id, issuer_slug: i.slug, subject_id: i.id,
      reason_code: "issuer_suspended", detail_en: "Issuer is suspended; issuance and supersession are refused while history is preserved" })),
    ...unevidencedIssuers.results.map((i) => ({ kind: "issuer", issuer_id: i.id, issuer_slug: i.slug, subject_id: i.id,
      reason_code: "issuer_registration_evidence_missing", detail_en: "Legacy issuer without recorded registration evidence; scope approval is refused until reviewed" })),
    ...expiringScopes.results.map((s) => ({ kind: "scope", issuer_id: s.issuer_id, issuer_slug: s.slug, subject_id: s.id,
      reason_code: "scope_expiring", detail_en: `Approved ${s.record_kind} scope expires ${s.valid_until}` })),
    ...invalidScopes.results.map((s) => ({ kind: "scope", issuer_id: s.issuer_id, issuer_slug: s.slug, subject_id: s.id,
      reason_code: "scope_invalid_dates", detail_en: `${s.record_kind} scope interval is malformed` })),
    ...suspendedScopes.results.map((s) => ({ kind: "scope", issuer_id: s.issuer_id, issuer_slug: s.slug, subject_id: s.id,
      reason_code: "scope_suspended", detail_en: `${s.record_kind} scope is suspended; issuance for this kind is refused` })),
  ];
  return { items };
}

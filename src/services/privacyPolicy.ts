import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { HttpError } from "../api/http";

/**
 * R98-N09 — operator-approved privacy/retention policy + subject redaction
 * requests.
 *
 * Doctrine (from the reviewed N09 ticket):
 *  - The inherited numeric defaults (privacy.ts RETENTION_DAYS) are
 *    CONFIGURATION ASSUMPTIONS. Until an operator approves a policy for a
 *    data category, the effective interval is the inherited default and every
 *    report says so. An approval never rewrites history: the superseded row
 *    is retired and a NEW versioned row is inserted.
 *  - A direct subject redaction request against a request under an ACTIVE
 *    dispute/legal hold is recorded and DEFERRED — never silently executed
 *    (the hold preserves minimal legally/operationally required evidence) and
 *    never silently dropped (the deferral stays visible in the operator queue
 *    until the hold's authorized release).
 *  - Release audits use operation receipts; a replayed release produces no
 *    second success audit (unique release_operation_id, migration 0072).
 *
 * A subject grant is an audited decision, not an execution receipt. The
 * separate age-based terminal retention sweep does not execute this queue.
 * SQL templates are exported for adapter parity tests.
 */

/** Categories an operator may approve a retention interval for. */
export const RETENTION_POLICY_CATEGORIES = ["service_request_terminal", "audit_dispute_record"] as const;
export type RetentionPolicyCategory = (typeof RETENTION_POLICY_CATEGORIES)[number];

/** Categories a data subject may request redaction for. */
export const SUBJECT_REDACTION_CATEGORIES = ["service_request_notes", "service_request_contact_location"] as const;
export type SubjectRedactionCategory = (typeof SUBJECT_REDACTION_CATEGORIES)[number];

/** Approval replaces the inherited default only for this many days (1-3650). */
export function validateRetentionDays(days: unknown): number {
  const n = typeof days === "number" ? days : Number.NaN;
  if (!Number.isSafeInteger(n) || n < 1 || n > 3650) {
    throw new HttpError(400, "invalid_retention_days", "retention_days must be an integer between 1 and 3650");
  }
  return n;
}

function requirePolicyText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length < 10 || value.trim().length > 2000) {
    throw new HttpError(400, `invalid_${field}`, `${field} must be 10-2000 characters describing the approved behavior`);
  }
  return value.trim();
}

// ---------------------------------------------------------------------------
// Effective policy resolution (inherited default vs operator-approved).
// ---------------------------------------------------------------------------

export interface EffectiveRetentionPolicy {
  data_category: RetentionPolicyCategory;
  retention_days: number;
  source: "inherited_default" | "operator_approved";
  policy_version: number | null;
  approved_by_user_id: string | null;
  approved_at: string | null;
}

export const EFFECTIVE_RETENTION_POLICY_SQL = `SELECT retention_days, policy_version, approved_by_user_id, approved_at
  FROM privacy_retention_policies WHERE data_category=? AND status='approved'`;

/** Resolve the effective interval: the APPROVED policy when one exists, the
 * inherited default (recorded as an assumption) otherwise. */
export async function getEffectiveRetentionPolicy(
  db: D1Database,
  category: RetentionPolicyCategory,
  inheritedDefaultDays: number,
): Promise<EffectiveRetentionPolicy> {
  const row = await db.prepare(EFFECTIVE_RETENTION_POLICY_SQL).bind(category)
    .first<{ retention_days: number; policy_version: number; approved_by_user_id: string; approved_at: string }>();
  if (row) {
    return {
      data_category: category, retention_days: row.retention_days, source: "operator_approved",
      policy_version: row.policy_version, approved_by_user_id: row.approved_by_user_id, approved_at: row.approved_at,
    };
  }
  return {
    data_category: category, retention_days: inheritedDefaultDays, source: "inherited_default",
    policy_version: null, approved_by_user_id: null, approved_at: null,
  };
}

// ---------------------------------------------------------------------------
// Operator approval (admin-only; versioned; audited; history preserved).
// ---------------------------------------------------------------------------

/** Serialize a command with demotion/deactivation of its current operator.
 * Repeated predicates in the actual mutations also fail closed on adapters
 * where a row lock is not needed (SQLite/D1 serialize writers). */
export const PRIVACY_ADMIN_LOCK_SQL = `UPDATE users SET is_active=is_active
  WHERE id=? AND is_active=1 AND role IN ('admin','super_admin')`;

export const POLICY_RETIRE_PREVIOUS_SQL = `UPDATE privacy_retention_policies
  SET status='retired', retired_at=CURRENT_TIMESTAMP, retired_by_user_id=?
  WHERE id=(SELECT supersedes_policy_id FROM privacy_retention_policies WHERE operation_id=?)
    AND status='approved'
    AND EXISTS(SELECT 1 FROM users WHERE id=? AND is_active=1 AND role IN ('admin','super_admin'))`;

/** Capture the predecessor BEFORE retirement, all within one transaction.
 * The candidate is invisible outside the batch until promoted. The existing
 * category/version uniqueness constraint makes concurrent approval losers a
 * no-op; their operation marker cannot retire or audit the winner's policy. */
export const POLICY_APPROVE_INSERT_SQL = `INSERT INTO privacy_retention_policies(
    id,data_category,retention_days,consent_withdrawal_behavior,hold_authority,release_requirements,
    status,policy_version,approved_by_user_id,operation_id,supersedes_policy_id)
  SELECT ?,?,?,?,?,?,'retired',
    COALESCE((SELECT MAX(policy_version)+1 FROM privacy_retention_policies WHERE data_category=?),1),
    ?,?,
    (SELECT id FROM privacy_retention_policies WHERE data_category=? AND status='approved')
  WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND is_active=1 AND role IN ('admin','super_admin'))
  ON CONFLICT(data_category,policy_version) DO NOTHING`;

export const POLICY_APPROVE_PROMOTE_SQL = `UPDATE privacy_retention_policies SET status='approved'
  WHERE operation_id=? AND status='retired'
    AND EXISTS(SELECT 1 FROM users WHERE id=? AND is_active=1 AND role IN ('admin','super_admin'))
    AND NOT EXISTS(SELECT 1 FROM privacy_retention_policies previous
      WHERE previous.data_category=privacy_retention_policies.data_category AND previous.status='approved')`;

export const POLICY_APPROVE_AUDIT_SQL = `INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
  SELECT ?,'privacy.retention_policy_approved','privacy_retention_policy',id,NULL,?,CURRENT_TIMESTAMP
  FROM privacy_retention_policies WHERE operation_id=? AND status='approved'`;

export const POLICY_APPROVE_RECEIPT_SQL = `SELECT id,policy_version,supersedes_policy_id
  FROM privacy_retention_policies WHERE operation_id=? AND status='approved'`;

export interface RetentionPolicyApprovalCommand {
  operatorUserId: string;
  dataCategory: RetentionPolicyCategory;
  retentionDays: number;
  consentWithdrawalBehavior: string;
  holdAuthority: string;
  releaseRequirements: string;
}

export function approveRetentionPolicyStatements(db: D1Database, input: RetentionPolicyApprovalCommand): D1PreparedStatement[] {
  const days = validateRetentionDays(input.retentionDays);
  const consent = requirePolicyText(input.consentWithdrawalBehavior, "consent_withdrawal_behavior");
  const holdAuthority = requirePolicyText(input.holdAuthority, "hold_authority");
  const releaseRequirements = requirePolicyText(input.releaseRequirements, "release_requirements");
  const operationId = crypto.randomUUID();
  const policyId = crypto.randomUUID();
  return [
    db.prepare(PRIVACY_ADMIN_LOCK_SQL).bind(input.operatorUserId),
    db.prepare(POLICY_APPROVE_INSERT_SQL).bind(
      policyId, input.dataCategory, days, consent, holdAuthority, releaseRequirements,
      input.dataCategory, input.operatorUserId, operationId, input.dataCategory, input.operatorUserId,
    ),
    db.prepare(POLICY_RETIRE_PREVIOUS_SQL).bind(input.operatorUserId, operationId, input.operatorUserId),
    db.prepare(POLICY_APPROVE_PROMOTE_SQL).bind(operationId, input.operatorUserId),
    db.prepare(POLICY_APPROVE_AUDIT_SQL).bind(
      input.operatorUserId,
      JSON.stringify({ data_category: input.dataCategory, retention_days: days, replaces_inherited_default: true }),
      operationId,
    ),
    // Return the receipt inside the same transaction. A later approval must
    // not make this response claim the other operator's version.
    db.prepare(POLICY_APPROVE_RECEIPT_SQL).bind(operationId),
  ];
}

// ---------------------------------------------------------------------------
// Subject redaction requests (bounded intake, honest hold interaction).
// ---------------------------------------------------------------------------

// The optional-ID null check must retain bigint range on PostgreSQL, whose
// INTEGER is narrower than SQLite's INTEGER and the accepted safe-integer IDs.
export const SUBJECT_REDACTION_INSERT_SQL = `INSERT INTO subject_redaction_requests(
    subject_user_id,service_request_id,data_category,request_note,status,hold_interaction,operation_id)
  SELECT ?,?,?,?,
    CASE WHEN EXISTS(SELECT 1 FROM service_request_holds WHERE service_request_id=? AND released_at IS NULL)
      THEN 'deferred_active_hold' ELSE 'received' END,
    CASE WHEN EXISTS(SELECT 1 FROM service_request_holds WHERE service_request_id=? AND released_at IS NULL)
      THEN 'deferred_to_release' ELSE 'none' END,?
  WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND is_active=1)
    AND (CAST(? AS BIGINT) IS NULL OR EXISTS(SELECT 1 FROM service_requests WHERE id=? AND requester_user_id=?))`;

export const SUBJECT_REDACTION_AUDIT_SQL = `INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
  SELECT ?,'privacy.subject_redaction_requested','subject_redaction_request',CAST(id AS TEXT),NULL,
    json_object('data_category',data_category,'service_request_id',service_request_id,'status',status),CURRENT_TIMESTAMP
  FROM subject_redaction_requests WHERE operation_id=?`;

/** The data subject of a service request's note/contact/location is its
 * requester; a redaction request may only reference their OWN request. */
export const SUBJECT_REDACTION_OWNERSHIP_SQL = `SELECT id FROM service_requests WHERE id=? AND requester_user_id=?`;

export async function subjectRedactionRequestStatements(db: D1Database, input: {
  subjectUserId: string; serviceRequestId: number | null;
  dataCategory: SubjectRedactionCategory; requestNote: string;
}): Promise<D1PreparedStatement[]> {
  const note = requirePolicyText(input.requestNote, "request_note");
  const operationId = crypto.randomUUID();
  if (input.serviceRequestId !== null) {
    const owned = await db.prepare(SUBJECT_REDACTION_OWNERSHIP_SQL)
      .bind(input.serviceRequestId, input.subjectUserId).first<{ id: number }>();
    if (!owned) {
      throw new HttpError(403, "not_data_subject", "A redaction request may only reference your own service request");
    }
  }
  return [
    db.prepare("UPDATE users SET is_active=is_active WHERE id=? AND is_active=1").bind(input.subjectUserId),
    // Same parent lock as hold placement/release and the retention sweep.
    // Holds that win first determine the status in the INSERT, not preflight.
    db.prepare(`UPDATE service_requests SET row_version=row_version WHERE id=? AND requester_user_id=?
      AND EXISTS(SELECT 1 FROM users WHERE id=? AND is_active=1)`)
      .bind(input.serviceRequestId, input.subjectUserId, input.subjectUserId),
    db.prepare(SUBJECT_REDACTION_INSERT_SQL).bind(
      input.subjectUserId, input.serviceRequestId, input.dataCategory, note,
      input.serviceRequestId, input.serviceRequestId, operationId, input.subjectUserId,
      input.serviceRequestId, input.serviceRequestId, input.subjectUserId,
    ),
    db.prepare(SUBJECT_REDACTION_AUDIT_SQL).bind(input.subjectUserId, operationId),
    db.prepare(`SELECT id,status,hold_interaction FROM subject_redaction_requests WHERE operation_id=? AND subject_user_id=?`)
      .bind(operationId, input.subjectUserId),
  ];
}

// ---------------------------------------------------------------------------
// Operator decision on a redaction request (audited; grant respects holds).
// ---------------------------------------------------------------------------

export const SUBJECT_REDACTION_DECIDE_SQL = `UPDATE subject_redaction_requests
  SET status=?, decided_by_user_id=?, decided_at=CURRENT_TIMESTAMP, decision_note=?, operation_id=?
  WHERE id=? AND status IN ('received','deferred_active_hold')
    AND EXISTS(SELECT 1 FROM users WHERE id=? AND is_active=1 AND role IN ('admin','super_admin'))
    AND (?='refused' OR (
      EXISTS(SELECT 1 FROM service_requests sr WHERE sr.id=subject_redaction_requests.service_request_id
        AND sr.requester_user_id=subject_redaction_requests.subject_user_id)
      AND NOT EXISTS(SELECT 1 FROM service_request_holds h
        WHERE h.service_request_id=subject_redaction_requests.service_request_id AND h.released_at IS NULL)))`;

export const SUBJECT_REDACTION_DECIDE_AUDIT_SQL = `INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
  SELECT ?,'privacy.subject_redaction_decided','subject_redaction_request',CAST(id AS TEXT),NULL,?,CURRENT_TIMESTAMP
  FROM subject_redaction_requests WHERE id=? AND operation_id=? AND decided_by_user_id=?`;

/** Grant for a held request is REFUSED: the operator must release the hold
 * through its own audited path first — a grant never bypasses a hold. */
export const SUBJECT_REDACTION_GRANT_HOLD_GUARD_SQL = `SELECT r.service_request_id,
  EXISTS(SELECT 1 FROM service_requests sr WHERE sr.id=r.service_request_id AND sr.requester_user_id=r.subject_user_id) AS exact_subject_scope,
  (h.service_request_id IS NOT NULL) AS held FROM subject_redaction_requests r
  LEFT JOIN service_request_holds h ON h.service_request_id=r.service_request_id AND h.released_at IS NULL
  WHERE r.id=?`;

export interface RedactionDecisionCommand {
  operatorUserId: string;
  redactionRequestId: number;
  decision: "grant" | "refuse";
  decisionNote: string;
}

export function decideSubjectRedactionRequestStatements(db: D1Database, input: RedactionDecisionCommand): D1PreparedStatement[] {
  const note = requirePolicyText(input.decisionNote, "decision_note");
  const operationId = crypto.randomUUID();
  const nextStatus = input.decision === "grant" ? "granted" : "refused";
  return [
    db.prepare(PRIVACY_ADMIN_LOCK_SQL).bind(input.operatorUserId),
    db.prepare(`UPDATE service_requests SET row_version=row_version
      WHERE id=(SELECT service_request_id FROM subject_redaction_requests WHERE id=?)
        AND EXISTS(SELECT 1 FROM users WHERE id=? AND is_active=1 AND role IN ('admin','super_admin'))`)
      .bind(input.redactionRequestId, input.operatorUserId),
    db.prepare(SUBJECT_REDACTION_DECIDE_SQL).bind(
      nextStatus, input.operatorUserId, note, operationId, input.redactionRequestId, input.operatorUserId, nextStatus,
    ),
    db.prepare(SUBJECT_REDACTION_DECIDE_AUDIT_SQL).bind(
      input.operatorUserId,
      JSON.stringify({ decision: input.decision, redaction_completed: false }),
      input.redactionRequestId, operationId, input.operatorUserId,
    ),
  ];
}

/** Completion of this request is distinct from any independent, age-based
 * retention sweep. Until R114-01 no subject-grant executor wrote a completion
 * receipt; now one exists, an unexecuted grant still reports honestly.
 * Refused is not applicable; an actually-completed execution (verified by the
 * executor's own receipt in the same transaction) reports completed. */
export function subjectRedactionFulfillment(
  status: string,
  execution?: { execution_status?: string | null; blocked_by_hold?: boolean },
) {
  if (execution?.execution_status === "completed") {
    return { redaction_completed: true as const, fulfillment_status: "completed" as const };
  }
  if (status === "refused") {
    return { redaction_completed: false as const, fulfillment_status: "not_applicable" as const };
  }
  if (status === "granted" && execution?.blocked_by_hold) {
    return { redaction_completed: false as const, fulfillment_status: "blocked_active_hold" as const };
  }
  return { redaction_completed: false as const, fulfillment_status: "not_executed" as const };
}

// ---------------------------------------------------------------------------
// R114-01 — the subject-request FULFILLMENT executor (decision != execution).
// ---------------------------------------------------------------------------

export interface FulfillRedactionCommand {
  operatorUserId: string;
  redactionRequestId: number;
  executionNote?: string;
}

export interface FulfillmentPreRead {
  request_id: number;
  status: string;
  data_category: "service_request_notes" | "service_request_contact_location";
  service_request_id: number | null;
  execution_status: string | null;
  sr_id: number | null;
  sr_row_version: number | null;
  note: string | null;
  note_digest: string | null;
  note_redacted_at: string | null;
  note_digest_status: string | null;
  share_contact: number | null;
  province_code: string | null;
  city: string | null;
  subject_user_id: string;
  active_holds: number;
  exact_subject_scope: number;
}

/** Read the exact request + target state before building the executor batch.
 * Read-only; every value is re-derived inside the transaction anyway. */
export const FULFILLMENT_PRE_READ_SQL = `SELECT r.id AS request_id, r.status, r.data_category, r.service_request_id,
    r.execution_status, r.subject_user_id,
    sr.id AS sr_id, sr.row_version AS sr_row_version, sr.note, sr.note_digest, sr.note_redacted_at,
    sr.note_digest_status, sr.share_contact, sr.province_code, sr.city,
    EXISTS(SELECT 1 FROM service_requests s2 WHERE s2.id=r.service_request_id AND s2.requester_user_id=r.subject_user_id) AS exact_subject_scope,
    (SELECT COUNT(*) FROM service_request_holds h WHERE h.service_request_id=r.service_request_id AND h.released_at IS NULL) AS active_holds
  FROM subject_redaction_requests r LEFT JOIN service_requests sr ON sr.id=r.service_request_id
  WHERE r.id=?`;

/** Serialize the executor with its operator's demotion/deactivation. */
export const FULFILL_PARENT_LOCK_SQL = `UPDATE service_requests SET row_version=row_version
  WHERE id=(SELECT service_request_id FROM subject_redaction_requests WHERE id=? AND status='granted' AND execution_status IS NULL)
    AND EXISTS(SELECT 1 FROM users WHERE id=? AND is_active=1 AND role IN ('admin','super_admin'))`;

/** Category A — notes: minimize the note ONCE, compare-and-set on the exact
 * current bytes and row version. The digest is derived before the transaction
 * from the exact note being minimized; it is never invented afterwards. */
export const FULFILL_NOTES_MINIMIZE_SQL = `UPDATE service_requests
    SET note='[redaction: note minimized]',note_digest=?,note_digest_status=?,note_redacted_at=COALESCE(note_redacted_at,?),
        row_version=row_version+1,last_operation_id=?
  WHERE id=(SELECT service_request_id FROM subject_redaction_requests WHERE id=? AND status='granted' AND execution_status IS NULL)
    AND note_redacted_at IS NULL AND note=? AND row_version=?
    AND EXISTS(SELECT 1 FROM users WHERE id=? AND is_active=1 AND role IN ('admin','super_admin'))
    AND NOT EXISTS(SELECT 1 FROM service_request_holds h WHERE h.service_request_id=service_requests.id AND h.released_at IS NULL)`;

/** Category B — contact/location: withdraw sharing and drop the coarse
 * location fields. Only runs when something is actually still disclosed. */
export const FULFILL_CONTACT_MINIMIZE_SQL = `UPDATE service_requests
    SET share_contact=0,province_code=NULL,city=NULL,consent_updated_at=COALESCE(consent_updated_at,?),
        row_version=row_version+1,last_operation_id=?
  WHERE id=(SELECT service_request_id FROM subject_redaction_requests WHERE id=? AND status='granted' AND execution_status IS NULL)
    AND (share_contact=1 OR province_code IS NOT NULL OR city IS NOT NULL)
    AND EXISTS(SELECT 1 FROM users WHERE id=? AND is_active=1 AND role IN ('admin','super_admin'))
    AND NOT EXISTS(SELECT 1 FROM service_request_holds h WHERE h.service_request_id=service_requests.id AND h.released_at IS NULL)`;

/** The completion receipt — written ONLY when the target row is in the
 * approved category end-state inside this same transaction (the minimization
 * statements above run first). The category end-state predicates are strict:
 * notes => note_redacted_at set; contact/location => sharing withdrawn and
 * both location fields cleared. A blocked hold, a lost grant or a concurrent
 * completion leaves this at 0 rows and writes nothing. */
export const FULFILL_COMPLETE_SQL = `UPDATE subject_redaction_requests
    SET execution_status='completed',executed_at=CURRENT_TIMESTAMP,
        execution_receipt_operation_id=?,execution_receipt_json=?
  WHERE id=? AND status='granted' AND execution_status IS NULL
    AND EXISTS(SELECT 1 FROM users WHERE id=? AND is_active=1 AND role IN ('admin','super_admin'))
    AND EXISTS(SELECT 1 FROM service_requests sr WHERE sr.id=subject_redaction_requests.service_request_id
      AND sr.requester_user_id=subject_redaction_requests.subject_user_id
      AND NOT EXISTS(SELECT 1 FROM service_request_holds h WHERE h.service_request_id=sr.id AND h.released_at IS NULL)
      AND CASE subject_redaction_requests.data_category
        WHEN 'service_request_notes' THEN sr.note_redacted_at IS NOT NULL
        WHEN 'service_request_contact_location' THEN (sr.share_contact=0 AND sr.province_code IS NULL AND sr.city IS NULL)
        ELSE 0 END)`;

export const FULFILL_AUDIT_SQL = `INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
  SELECT ?,'privacy.subject_redaction_fulfilled','subject_redaction_request',CAST(id AS TEXT),NULL,?,CURRENT_TIMESTAMP
  FROM subject_redaction_requests WHERE id=? AND execution_receipt_operation_id=? AND execution_status='completed'`;

export const FULFILL_RECEIPT_SQL = `SELECT id,status,data_category,service_request_id,execution_status,executed_at,
    execution_receipt_operation_id,execution_receipt_json
  FROM subject_redaction_requests WHERE id=? AND execution_receipt_operation_id=? AND execution_status='completed'`;

/** Deterministic evidence for the executor: never invent a digest of bytes
 * that are no longer available (same doctrine as the retention sweep). */
export async function fulfillmentNoteEvidence(row: Pick<FulfillmentPreRead, "note" | "note_digest" | "note_redacted_at" | "note_digest_status">): Promise<{
  digest: string | null; status: "original_sha256" | "legacy_recorded_sha256" | "unavailable";
}> {
  if (!row.note_redacted_at && typeof row.note === "string" && row.note.length > 0) {
    const bits = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(row.note));
    return { digest: [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, "0")).join(""), status: "original_sha256" };
  }
  if (row.note_digest && /^[a-f0-9]{64}$/i.test(row.note_digest)) {
    return { digest: row.note_digest.toLowerCase(), status: row.note_digest_status === "original_sha256" ? "original_sha256" : "legacy_recorded_sha256" };
  }
  return { digest: null, status: "unavailable" };
}

export interface FulfillmentPlan {
  statements: D1PreparedStatement[];
  receiptJson: string;
  alreadyMinimized: boolean;
  category: "service_request_notes" | "service_request_contact_location";
}

/** Build the one-transaction fulfillment batch from the pre-read state.
 * Called only after the handler validated the pre-read (grant + scope + no
 * hold); every guard is repeated inside the transaction regardless. */
export async function buildFulfillmentStatements(db: D1Database, cmd: FulfillRedactionCommand, pre: FulfillmentPreRead): Promise<FulfillmentPlan> {
  const operationId = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    db.prepare(PRIVACY_ADMIN_LOCK_SQL).bind(cmd.operatorUserId),
    db.prepare(FULFILL_PARENT_LOCK_SQL).bind(cmd.redactionRequestId, cmd.operatorUserId),
  ];
  let alreadyMinimized = false;
  let receipt: Record<string, unknown>;
  if (pre.data_category === "service_request_notes") {
    if (pre.note_redacted_at) {
      // Already minimized by an earlier authorized path: this execution
      // changes nothing further and never fabricates a digest.
      alreadyMinimized = true;
      const evidence = await fulfillmentNoteEvidence(pre);
      receipt = {
        category: "service_request_notes", already_minimized: true,
        fields: ["note", "note_digest", "note_digest_status", "note_redacted_at"],
        note_digest_status: evidence.status, note_digest: evidence.digest,
      };
    } else {
      const evidence = await fulfillmentNoteEvidence(pre);
      if (!evidence.digest) {
        // Unavailable original bytes with no recorded digest: the fields
        // cannot be minimized safely — refuse rather than guess.
        receipt = {
          category: "service_request_notes", already_minimized: false,
          fields: ["note", "note_digest", "note_digest_status", "note_redacted_at"],
          note_digest_status: "unavailable", note_digest: null,
        };
      } else {
        receipt = {
          category: "service_request_notes", already_minimized: false,
          fields: ["note", "note_digest", "note_digest_status", "note_redacted_at"],
          note_digest_status: evidence.status, note_digest: evidence.digest,
        };
        statements.push(db.prepare(FULFILL_NOTES_MINIMIZE_SQL).bind(
          evidence.digest, evidence.status, nowIso, operationId,
          cmd.redactionRequestId, pre.note, pre.sr_row_version, cmd.operatorUserId,
        ));
      }
    }
  } else {
    const needsMinimize = Number(pre.share_contact) === 1 || pre.province_code !== null || pre.city !== null;
    alreadyMinimized = !needsMinimize;
    receipt = {
      category: "service_request_contact_location", already_minimized: alreadyMinimized,
      fields: ["share_contact", "province_code", "city", "consent_updated_at"],
    };
    if (needsMinimize) {
      statements.push(db.prepare(FULFILL_CONTACT_MINIMIZE_SQL).bind(
        nowIso, operationId, cmd.redactionRequestId, cmd.operatorUserId,
      ));
    }
  }
  if (cmd.executionNote) receipt.execution_note = cmd.executionNote;
  const receiptJson = JSON.stringify(receipt);
  if (receiptJson.length > 2000) throw new HttpError(400, "invalid_execution_note", "execution_note would overflow the receipt bound");
  statements.push(
    db.prepare(FULFILL_COMPLETE_SQL).bind(operationId, receiptJson, cmd.redactionRequestId, cmd.operatorUserId),
    db.prepare(FULFILL_AUDIT_SQL).bind(cmd.operatorUserId, receiptJson, cmd.redactionRequestId, operationId),
    db.prepare(FULFILL_RECEIPT_SQL).bind(cmd.redactionRequestId, operationId),
  );
  return { statements, receiptJson, alreadyMinimized, category: pre.data_category };
}

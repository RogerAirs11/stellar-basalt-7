/**
 * R95-N05: gateway uncertainty and the reconciliation workflow.
 *
 * Three rules, each pinned by tests:
 *  1. An operator inquiry RECORDS evidence — it never fulfills, never
 *     expires, never marks anything paid/failed on its own. Inquiry is a
 *     POST because it writes an audit row; no GET mutates financial state.
 *  2. A review case closes ONLY when the submitted evidence reconciles
 *     against the stored rows: attempt->order linkage, order key, amounts,
 *     currency and authority must all match, and outcome-specific proof
 *     must exist (a recorded not-paid inquiry, a verify receipt, or a
 *     provider-verified event with the reference).
 *  3. The periodic scan is READ-ONLY: it cross-checks attempts, orders,
 *     entitlement events and settlement rows and REPORTS discrepancies.
 *     Uncertainty is never resolved into a guessed outcome here.
 */
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { HttpError } from "../api/http";
import { isTerminalReleasePolicy, type TerminalReleasePolicy } from "./payments/terminalPolicy";

export const REVIEW_RESOLUTION_OUTCOMES = [
  "provider_not_paid_confirmed",
  "provider_verified_fulfilled",
  "provider_verified_retained",
  "duplicate_dismissed",
  "operator_error_dismissed",
] as const;
export type ReviewResolutionOutcome = (typeof REVIEW_RESOLUTION_OUTCOMES)[number];

/** FAILED is an incomplete observation, not documented proof that a session
 * can never settle. Only a fresh, scoped reversal is eligible, and only under
 * separately approved deployment policy. Inquiry never verifies payment. */
export const TERMINAL_INQUIRY_OUTCOMES: readonly ProviderInquiryOutcome[] = ["reversed"];

/** Additional LOCAL cooldown. This is not a documented settlement window and
 * cannot turn missing/failed/stale observations into provider proof. */
export const TERMINAL_RELEASE_MIN_ATTEMPT_AGE_HOURS = 24;

/** R96-N06: the explicitly confirmed new-attempt policy a terminal release
 * must carry. The release ends the session and ALLOWS the buyer to start a
 * NEW payment attempt (the reserve guard only permits one payable attempt
 * per order — the released attempt is terminal, so a new one is legal). */
export const TERMINAL_NEW_ATTEMPT_POLICY = "allow_new_attempt";

/** The evidence an operator must echo back for a resolution to reconcile.
 * Every field is compared against stored rows — nothing is taken on faith. */
export interface ReviewResolutionEvidence {
  attempt_id: number;
  order_id: number;
  order_key: string;
  amount_minor: number;
  currency: string;
  authority: string | null;
  provider_reference: string | null;
}

export function parseResolutionEvidence(input: unknown): ReviewResolutionEvidence {
  if (!input || typeof input !== "object") throw new HttpError(400, "invalid_resolution", "Evidence linking the attempt, order, amounts and authority is required");
  const e = input as Partial<ReviewResolutionEvidence>;
  if (typeof e.attempt_id !== "number" || !Number.isSafeInteger(e.attempt_id) || e.attempt_id <= 0
    || typeof e.order_id !== "number" || !Number.isSafeInteger(e.order_id) || e.order_id <= 0
    || typeof e.order_key !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(e.order_key)
    || typeof e.amount_minor !== "number" || !Number.isSafeInteger(e.amount_minor) || e.amount_minor <= 0
    || e.currency !== "IRR"
    || (e.authority !== null && (typeof e.authority !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(e.authority)))
    || (e.provider_reference !== null && (typeof e.provider_reference !== "string" || !/^[1-9][0-9]{0,63}$/.test(e.provider_reference)))) {
    throw new HttpError(400, "invalid_resolution", "Evidence linking the attempt, order, amounts and authority is required");
  }
  return {
    attempt_id: e.attempt_id, order_id: e.order_id, order_key: e.order_key,
    amount_minor: e.amount_minor, currency: "IRR",
    authority: e.authority ?? null, provider_reference: e.provider_reference ?? null,
  };
}

export type ProviderInquiryOutcome =
  | "verified" | "not_paid" | "authority_not_found" | "amount_mismatch"
  | "configuration" | "timeout" | "network" | "provider_rejected" | "unknown"
  | "paid_unverified" | "in_bank" | "failed_observed" | "reversed";

/**
 * Record an operator inquiry as an append-only payment_event. The attempt's
 * state is NOT changed: an inquiry is evidence, not a state transition.
 * Payload keeps only codes/references/outcomes — never card or contact data.
 */
export function providerInquiryStatements(db: D1Database, input: {
  attemptId: number; operatorUserId: string; outcome: ProviderInquiryOutcome;
  providerReference?: string | null; providerCode?: number | null; note?: string;
  providerScopeHash?: string | null; observedAuthority?: string | null;
}): D1PreparedStatement[] {
  if (!Number.isSafeInteger(input.attemptId) || input.attemptId <= 0 || !input.operatorUserId) throw new RangeError("attemptId and operatorUserId are required");
  return [db.prepare(`
    INSERT INTO payment_events(payment_attempt_id,actor,from_state,to_state,payload_json,inquiry_outcome,inquiry_provider_scope,inquiry_authority)
    SELECT id,'operator',state,state,?,?,?,? FROM payment_attempts WHERE id=?
      AND (CAST(? AS TEXT) IS NULL OR authority=?)
      AND EXISTS(SELECT 1 FROM users WHERE id=? AND is_active=1 AND role IN ('admin','super_admin'))
  `).bind(JSON.stringify({
    inquiry: true,
    outcome: input.outcome,
    ...(input.providerReference ? { providerReference: input.providerReference } : {}),
    ...(input.providerCode != null ? { providerCode: input.providerCode } : {}),
    operator_user_id: input.operatorUserId,
    ...(input.note ? { note: input.note } : {}),
  }), input.outcome, input.providerScopeHash ?? null, input.observedAuthority ?? null, input.attemptId, input.providerScopeHash ?? null,input.observedAuthority ?? null,input.operatorUserId)];
}

/**
 * Resolve a review case. The UPDATE fires ONLY when:
 *  - the case is open and belongs to exactly this attempt;
 *  - the echoed evidence reconciles with the stored attempt/order rows
 *    (linkage, order key, amounts, currency, authority);
 *  - the outcome's specific proof exists (recorded inquiry / verify receipt /
 *    verified provider event with the exact reference).
 *
 * R96-N06: `provider_not_paid_confirmed` — the TERMINAL RELEASE — is now
 * implemented (the previous unconditional 501 is gone) but remains
 * fail-closed: it requires the EXPLICIT new-attempt policy, a TERMINAL
 * provider inquiry (the inquiry API's fresh merchant-scoped REVERSED status — never
 * not_paid, timeout, authority_not_found or a missing local authority) that
 * is the LATEST recorded observation for the attempt, an attempt older than
 * the local cooldown, and a current operator. The release
 * moves the attempt to 'failed' (terminal — a late verify of a released
 * session can never auto-fulfill; it lands in explicit review), writes ONE
 * operation receipt (payment_events, marker-gated) and a matching audit
 * row. One order can never acquire two concurrently payable attempts: the
 * release itself creates nothing, and the reserve guard still refuses while
 * any created/redirected attempt exists.
 */
export function resolveReviewCaseStatements(db: D1Database, input: {
  caseId: number; operatorUserId: string; outcome: ReviewResolutionOutcome;
  resolutionNote: string; evidence: ReviewResolutionEvidence;
  newAttemptPolicy?: string;
  terminalPolicy?: TerminalReleasePolicy;
}): D1PreparedStatement[] {
  if (!Number.isSafeInteger(input.caseId) || input.caseId <= 0) throw new RangeError("caseId is required");
  if (!REVIEW_RESOLUTION_OUTCOMES.includes(input.outcome)) throw new RangeError("Unknown resolution outcome");
  if (!input.operatorUserId || typeof input.resolutionNote !== "string" || input.resolutionNote.trim().length < 3 || input.resolutionNote.length > 2000) {
    throw new HttpError(400, "invalid_resolution", "An actor and a substantive resolution note (3-2000 chars) are required");
  }
  const ev = parseResolutionEvidence(input.evidence);
  if (input.outcome === "provider_not_paid_confirmed") {
    if (input.newAttemptPolicy !== TERMINAL_NEW_ATTEMPT_POLICY || !isTerminalReleasePolicy(input.terminalPolicy)) {
      throw new HttpError(501, "terminal_payment_proof_required",
        "A terminal release requires deployment-approved merchant-specific reversal policy plus explicit new-attempt acknowledgement. FAILED, timeout, old or unscoped inquiries are not proof. Configure and verify the approval record before enabling this operation.");
    }
    return terminalReleaseStatements(db, {
      caseId: input.caseId, operatorUserId: input.operatorUserId,
      resolutionNote: input.resolutionNote, evidence: ev, policy: input.terminalPolicy,
    });
  }
  const operationId=crypto.randomUUID();
  // Core linkage — identical for every outcome. Placeholder order:
  //   1 attempt_id, 2 order_id, 3 order_key, 4 amount_minor, 5 authority, 6 authority
  const reconciles = `
    SELECT 1 FROM payment_attempts p JOIN orders o ON o.id=p.order_id
    WHERE p.id=? AND p.id=billing_review_cases.payment_attempt_id
      AND o.id=? AND o.order_key=? AND o.total_minor=p.amount_minor
      AND o.currency=p.currency AND p.currency='IRR' AND p.amount_minor=?
      AND ((p.authority IS NULL AND CAST(? AS TEXT) IS NULL) OR p.authority=?)`;
  let outcomeGateSql = "";
  const outcomeGateBinds: unknown[] = [];
  if (input.outcome === "provider_verified_fulfilled") {
    outcomeGateSql = ` AND p.state='verified' AND o.status IN ('paid','refunded','partially_refunded') AND EXISTS(
      SELECT 1 FROM billing_command_receipts r
      WHERE r.kind='verify' AND r.order_id=o.id AND r.payment_attempt_id=p.id)`;
  } else if (input.outcome === "provider_verified_retained") {
    // The proof is the attempt's OWN verified state carrying this exact
    // provider reference (verification_json is written deterministically by
    // verifiedOrderStatements in the same batch as the state transition).
    // provider_reference is validated digits-only, so the LIKE pattern cannot
    // be injected with wildcards; the same statement translates to ILIKE on
    // PostgreSQL with identical semantics.
    outcomeGateSql = ` AND ? IS NOT NULL AND p.state='verified' AND p.verification_json LIKE ?`;
    outcomeGateBinds.push(ev.provider_reference, `%"providerReference":"${ev.provider_reference}"%`);
  }
  const statements: D1PreparedStatement[] = [
    db.prepare(`
      UPDATE billing_review_cases SET
        status='resolved', resolved_at=CURRENT_TIMESTAMP, resolved_by_user_id=?,
        resolution_outcome=?, resolution_evidence_json=?, resolution_note=?,last_operation_id=?
      WHERE id=? AND status='open'
        AND EXISTS(SELECT 1 FROM users WHERE id=? AND is_active=1 AND role IN ('admin','super_admin')) AND EXISTS(${reconciles}${outcomeGateSql})
    `).bind(input.operatorUserId, input.outcome, JSON.stringify(ev), input.resolutionNote.trim(), operationId,input.caseId,input.operatorUserId,
      ev.attempt_id, ev.order_id, ev.order_key, ev.amount_minor, ev.authority, ev.authority, ...outcomeGateBinds),
  ];
  statements.push(db.prepare(`INSERT INTO payment_events(payment_attempt_id,actor,from_state,to_state,payload_json)
    SELECT p.id,'operator',p.state,p.state,? FROM payment_attempts p
    WHERE p.id=? AND EXISTS(SELECT 1 FROM billing_review_cases c WHERE c.id=? AND c.payment_attempt_id=p.id AND c.last_operation_id=?)`)
    .bind(JSON.stringify({review_case:input.caseId,resolution:input.outcome,operator_user_id:input.operatorUserId}),ev.attempt_id,input.caseId,operationId));
  return statements;
}

/**
 * R96-N06 — the terminal release (provider_not_paid_confirmed). ALL proof
 * conditions live inside the UPDATE's WHERE so nothing lands unless every
 * one holds at the same instant:
 *   - open case for exactly this attempt + current admin operator;
 *   - the echoed evidence reconciles (linkage, order key, amount, currency,
 *     authority);
 *   - the attempt is in a session state (redirected/failed/expired — never
 *     verified: verified means money DID move; never created: no session
 *     exists yet);
 *   - TERMINAL provider proof bound to this exact attempt: the LATEST
 *     recorded inquiry is the inquiry API's merchant-scoped REVERSED status (a later
 *     contradictory observation — in_bank, verified — blocks the release);
 *   - a deployment-owned policy approval and a fresh, matching observation;
 *   - a local minimum-age cooldown (not a provider settlement guarantee).
 * Effects (one batch): the review case resolves; the attempt moves to
 * 'failed' (terminal); ONE payment_events operation receipt records the
 * release with the full evidence; an audit row lands. The order is left
 * awaiting payment — the buyer may reserve a NEW attempt (the reserve
 * guard still refuses while any created/redirected attempt exists, so no
 * two payable attempts can ever coexist).
 */
function terminalReleaseStatements(db: D1Database, input: {
  caseId: number; operatorUserId: string; resolutionNote: string; evidence: ReviewResolutionEvidence; policy:TerminalReleasePolicy;
}): D1PreparedStatement[] {
  const ev = input.evidence;
  const operationId = crypto.randomUUID();
  const reconciles = `
    SELECT 1 FROM payment_attempts p JOIN orders o ON o.id=p.order_id
    WHERE p.id=? AND p.id=billing_review_cases.payment_attempt_id
      AND o.id=? AND o.order_key=? AND o.total_minor=p.amount_minor
      AND o.currency=p.currency AND p.currency='IRR' AND p.amount_minor=?
      AND ((p.authority IS NULL AND CAST(? AS TEXT) IS NULL) OR p.authority=?)`;
  const terminalProof = `
    AND EXISTS(
      SELECT 1 FROM payment_events e
      WHERE e.payment_attempt_id=p.id AND e.inquiry_outcome='reversed' AND e.inquiry_provider_scope=? AND e.inquiry_authority=p.authority
        AND datetime(e.created_at)>=datetime('now',?) AND datetime(e.created_at)<=datetime('now')
        AND e.id=(SELECT MAX(e2.id) FROM payment_events e2
          WHERE e2.payment_attempt_id=p.id AND e2.inquiry_outcome IS NOT NULL))
    AND datetime(p.created_at) <= datetime('now','-${TERMINAL_RELEASE_MIN_ATTEMPT_AGE_HOURS} hours')`;
  return [
    // 1. Resolve the case (the claim — every proof condition rides this UPDATE).
    db.prepare(`
      UPDATE billing_review_cases SET
        status='resolved', resolved_at=CURRENT_TIMESTAMP, resolved_by_user_id=?,
        resolution_outcome='provider_not_paid_confirmed', resolution_evidence_json=?, resolution_note=?,last_operation_id=?
      WHERE id=? AND status='open'
        AND EXISTS(SELECT 1 FROM users WHERE id=? AND is_active=1 AND role IN ('admin','super_admin'))
        AND EXISTS(${reconciles}
          AND p.provider='zarinpal' AND p.state IN ('redirected','failed','expired') AND o.status='awaiting_payment'
          AND NOT EXISTS(SELECT 1 FROM payment_events receipt WHERE receipt.payment_attempt_id=p.id AND receipt.to_state='verified')${terminalProof})
    `).bind(input.operatorUserId, JSON.stringify({ ...ev, new_attempt_policy: TERMINAL_NEW_ATTEMPT_POLICY, terminal_policy:input.policy }),
      input.resolutionNote.trim(), operationId, input.caseId, input.operatorUserId,
      ev.attempt_id, ev.order_id, ev.order_key, ev.amount_minor, ev.authority, ev.authority,input.policy.providerScopeHash,`-${input.policy.maxEvidenceAgeMinutes} minutes`),
    // 2. The attempt becomes terminally failed — marker-gated on the resolved case.
    db.prepare(`
      UPDATE payment_attempts SET state='failed'
      WHERE id=? AND state IN ('redirected','failed','expired')
        AND EXISTS(SELECT 1 FROM billing_review_cases c
          WHERE c.id=? AND c.payment_attempt_id=payment_attempts.id AND c.last_operation_id=? AND c.status='resolved')
    `).bind(ev.attempt_id, input.caseId, operationId),
    // 3. THE operation receipt: one append-only payment_events row with the
    //    full evidence and the operation id.
    db.prepare(`
      INSERT INTO payment_events(payment_attempt_id,actor,from_state,to_state,payload_json)
      SELECT p.id,'operator',p.state,'failed',? FROM payment_attempts p
      WHERE p.id=? AND EXISTS(SELECT 1 FROM billing_review_cases c
        WHERE c.id=? AND c.payment_attempt_id=p.id AND c.last_operation_id=? AND c.status='resolved')
    `).bind(JSON.stringify({
      terminal_release: true, operation_id: operationId,
      evidence: ev, new_attempt_policy: TERMINAL_NEW_ATTEMPT_POLICY, terminal_policy:input.policy,
      operator_user_id: input.operatorUserId, note: input.resolutionNote.trim(),
    }), ev.attempt_id, input.caseId, operationId),
    // 4. Matching audit row.
    db.prepare(`
      INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
      SELECT ?,'payment.terminal_released','payment_attempts',CAST(payment_attempt_id AS TEXT),'{}',?,CURRENT_TIMESTAMP
      FROM billing_review_cases WHERE id=? AND last_operation_id=? AND status='resolved'
    `).bind(input.operatorUserId,
      JSON.stringify({ state: "failed", outcome: "provider_not_paid_confirmed", new_attempt_policy: TERMINAL_NEW_ATTEMPT_POLICY }),
      input.caseId, operationId),
  ];
}

export interface ReconciliationScanCheck {
  name: string;
  count: number;
  rows: Array<Record<string, unknown>>;
  /** "violation" = internal integrity must not exist; "observation" = expected
   * while a provider-side source (settlement import) is owner-gated. */
  kind: "violation" | "observation";
  note: string;
}

/** Read-only cross-check of attempts, orders, entitlement events, receipts
 * and settlement rows. NO writes — uncertainty is reported, never guessed. */
export async function reconciliationScan(db: D1Database): Promise<{ checks: ReconciliationScanCheck[]; generated_note: string }> {
  const define = async (name: string, kind: "violation" | "observation", note: string, sql: string): Promise<ReconciliationScanCheck> => {
    const rows = await db.prepare(sql).all<Record<string, unknown>>();
    return { name, kind, note, count: (rows.results ?? []).length, rows: (rows.results ?? []).slice(0, 50) };
  };
  const checks = [
    await define("paid_order_without_verified_attempt", "violation",
      "A paid order must have exactly one verified attempt; investigate before anything else.",
      `SELECT o.id AS order_id, o.order_key, o.total_minor, o.status FROM orders o
       WHERE o.status='paid' AND NOT EXISTS(
         SELECT 1 FROM payment_attempts p WHERE p.order_id=o.id AND p.state='verified')`),
    await define("verified_attempt_without_paid_order", "violation",
      "Provider-verified money whose order has no paid or recorded refund state requires reconciliation.",
      `SELECT p.id AS attempt_id, p.order_id, p.amount_minor, p.authority, o.status AS order_status
       FROM payment_attempts p JOIN orders o ON o.id=p.order_id
       WHERE p.state='verified' AND o.status NOT IN ('paid','refunded','partially_refunded')`),
    await define("verified_amount_disagreement", "violation",
      "A verified attempt must carry the exact order amount (server-side check).",
      `SELECT p.id AS attempt_id, p.order_id, p.amount_minor AS attempt_amount, o.total_minor AS order_total
       FROM payment_attempts p JOIN orders o ON o.id=p.order_id
       WHERE p.state='verified' AND p.amount_minor<>o.total_minor`),
    await define("entitlement_event_without_verify_receipt", "observation",
      "Pre-R95 legacy fulfillment events have no command receipt; they are retained, never re-fulfilled.",
      `SELECT e.id AS event_id, e.payment_attempt_id, e.sku, e.kind FROM entitlement_events e
       WHERE NOT EXISTS(
         SELECT 1 FROM billing_command_receipts r
         WHERE r.kind='verify' AND r.payment_attempt_id=e.payment_attempt_id)`),
    await define("verified_attempt_without_settlement_record", "observation",
      "Settlement facts come from the provider's merchant reporting; import is owner-gated. Until then this is an observation, never a guessed settlement.",
      `SELECT p.id AS attempt_id, p.order_id, p.amount_minor FROM payment_attempts p
       WHERE p.state='verified' AND NOT EXISTS(
         SELECT 1 FROM payment_settlements s WHERE s.payment_attempt_id=p.id)`),
    await define("settlement_amount_mismatch", "violation",
      "A recorded settlement whose gross disagrees with the attempt amount must be investigated.",
      `SELECT s.id AS settlement_id, s.payment_attempt_id, s.settled_gross_minor, p.amount_minor AS attempt_amount
       FROM payment_settlements s JOIN payment_attempts p ON p.id=s.payment_attempt_id
       WHERE s.settled_gross_minor<>p.amount_minor`),
  ];
  return {
    checks,
    generated_note: "Read-only scan. Every finding is reported, never auto-resolved: no row is written by this scan.",
  };
}

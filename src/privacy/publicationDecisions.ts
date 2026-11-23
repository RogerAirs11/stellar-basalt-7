import { HttpError } from "../api/http";
import type { D1Database } from "@cloudflare/workers-types";
import { geneticActionPredicate } from "../access/geneticAccess";
import type { PrivacyViewer } from "./policy";

/**
 * R144-D02 (Master-AI plan) — versioned publication decisions. Migration
 * 0106. Companion to the 0101 `public_disclosed` boolean, which stays as the
 * MATERIALIZED projection of the latest decision.
 *
 * Doctrine:
 * - Every publication/withdrawal appends an immutable decision row (who,
 *   what basis, what purpose, what evidence, why, which version).
 * - Optimistic concurrency: a caller may pass expected_version; a request
 *   that is behind the current decision version is rejected 409 and can
 *   NEVER overwrite a newer withdrawal.
 * - The materialized boolean is updated in the SAME transactional batch as
 *   the decision INSERT; UNIQUE(subject_kind, record_id, decision_version)
 *   makes two racing writers exactly-one-winner.
 * - Compatibility: records without decision history fall back to the legacy
 *   boolean (pre-0106 behavior preserved verbatim).
 */

export const PUBLICATION_DECISION_BASES = ["owner_consent", "staff_publication", "official_basis"] as const;
export type PublicationDecisionBasis = (typeof PUBLICATION_DECISION_BASES)[number];

export type PublicationDecisionChoice = "publish" | "withdraw";

export interface PublicationDecisionRow {
  id: string;
  subject_kind: "genetic_test";
  record_id: string;
  horse_id: number;
  decision: PublicationDecisionChoice;
  decision_version: number;
  basis: PublicationDecisionBasis;
  purpose: string | null;
  evidence_ref: string | null;
  reason: string;
  actor_user_id: string;
  expected_version: number | null;
  created_at: string;
}

export interface PublicationDecision {
  id: string;
  subject_kind: "genetic_test";
  record_id: string;
  horse_id: number;
  decision: PublicationDecisionChoice;
  decision_version: number;
  basis: PublicationDecisionBasis;
  purpose: string | null;
  evidence_ref: string | null;
  reason: string;
  actor_user_id: string;
  expected_version: number | null;
  created_at: string;
}

/**
 * Compatibility reader: the effective disclosure state of one genetic-test
 * row. Decision history takes precedence; the legacy boolean is the fallback
 * for rows that predate 0106 (or were written by the legacy path).
 * `materializedMatches` reports whether the stored public_disclosed boolean
 * agrees with the computed state — a diagnostic for the reconciliation
 * backfill, never a substitute for the guarded writer.
 */
export function effectiveDisclosure(
  row: { public_disclosed?: number | null },
  decisions: Array<Pick<PublicationDecisionRow, "decision" | "decision_version">>,
): { disclosed: boolean; source: "decision_log" | "legacy_boolean"; latest_version: number | null; materialized_matches: boolean } {
  let latest: Pick<PublicationDecisionRow, "decision" | "decision_version"> | null = null;
  for (const decision of decisions) {
    if (latest === null || Number(decision.decision_version) > Number(latest.decision_version)) latest = decision;
  }
  if (latest) {
    const disclosed = latest.decision === "publish";
    return {
      disclosed,
      source: "decision_log",
      latest_version: Number(latest.decision_version),
      materialized_matches: Number(row.public_disclosed ?? 0) === (disclosed ? 1 : 0),
    };
  }
  const legacy = Number(row.public_disclosed ?? 0) === 1;
  return { disclosed: legacy, source: "legacy_boolean", latest_version: null, materialized_matches: true };
}

/**
 * The SQL boundary predicate used everywhere `public_disclosed` gates a
 * public read (pairing projection, attestation listing, dossier snapshot).
 * The materialized column is kept correct by the guarded writer below, so
 * withdrawal reaches every derived output atomically. Exported as a single
 * source of truth so future SQL surfaces reuse the exact same predicate.
 */
export const MATERIALIZED_DISCLOSURE_SQL = "COALESCE(public_disclosed,0)=1";

export const DECISION_VERSION_SQL = `
  SELECT COALESCE(MAX(decision_version),0) AS current_version
  FROM publication_decisions
  WHERE subject_kind='genetic_test' AND record_id=?
`;

/**
 * Append a publication decision and materialize it onto the legacy boolean
 * in ONE atomic batch. Concurrency:
 * - expected_version, when supplied, must equal the current max decision
 *   version — otherwise 409 publication_decision_conflict (a stale caller
 *   can never overwrite a newer withdrawal).
 * - The decision INSERT carries UNIQUE(subject_kind, record_id,
 *   decision_version); a racing writer loses the batch and surfaces as 409.
 * - A request whose desired state already holds is a clean no-op
 *   (changed:false) that appends nothing — replays stay idempotent.
 */
export async function recordPublicationDecision(
  db: D1Database,
  input: {
    testId: number;
    horseId: number;
    desired: PublicationDecisionChoice;
    basis: PublicationDecisionBasis;
    purpose?: string | null;
    evidenceRef?: string | null;
    reason: string;
    actorUserId: string;
    actorSessionId: string;
    actor?: PrivacyViewer;
    expectedVersion?: number | null;
  },
): Promise<{ changed: boolean; decision: PublicationDecision | null; current_version: number; disclosed: boolean }> {
  if (!input.reason || input.reason.trim().length < 3) {
    throw new HttpError(422, "invalid_reason", "A decision reason is required");
  }
  if (!Number.isSafeInteger(input.expectedVersion) || Number(input.expectedVersion) < 0) {
    throw new HttpError(422, "missing_decision_version", "Read the current decision version before changing publication");
  }
  const purpose = input.purpose?.trim() || null;
  const evidenceRef = input.evidenceRef?.trim() || null;
  if (input.desired === "publish" && (!purpose || purpose.length < 3)) {
    throw new HttpError(422, "missing_publication_purpose", "Publication requires a specific purpose");
  }
  if (input.desired === "publish" && input.basis !== "staff_publication" && (!evidenceRef || evidenceRef.length < 3)) {
    throw new HttpError(422, "missing_publication_evidence", "Consent or official publication requires a supporting evidence reference");
  }
  const disclosedAfter = input.desired === "publish";
  const expectedVersion = Number(input.expectedVersion);
  const decisionId = crypto.randomUUID();
  const nextVersion = expectedVersion + 1;
  const authority = geneticActionPredicate({ ...input.actor, user: { id: input.actorUserId, role: "user" }, sessionId: input.actorSessionId }, input.horseId, ["genetic_publish"]);
  const authoritySql = `(${authority.sql})`;
  let results;
  try {
    results = await db.batch([
      // Separate first statement locks this record on PostgreSQL; subsequent
      // READ COMMITTED statements observe the winner before checking version.
      // SQLite/D1 serialize the writer transaction. No stale state is used to
      // return a successful no-op outside this boundary.
      db.prepare("UPDATE genetic_tests SET public_disclosed=public_disclosed WHERE id=? AND horse_id=?").bind(input.testId, input.horseId),
      db.prepare(`INSERT INTO publication_decisions(id,subject_kind,record_id,horse_id,decision,decision_version,basis,purpose,evidence_ref,reason,actor_user_id,expected_version,created_at)
        SELECT ?, 'genetic_test', CAST(g.id AS TEXT), g.horse_id, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP
        FROM genetic_tests g WHERE g.id=? AND g.horse_id=?
          AND COALESCE(g.public_disclosed,0)<>?
          AND (SELECT COALESCE(MAX(d.decision_version),0) FROM publication_decisions d WHERE d.subject_kind='genetic_test' AND d.record_id=CAST(g.id AS TEXT))=?
          AND (?='withdraw' OR g.verified=1)
          AND ${authoritySql}`)
        .bind(decisionId, input.desired, nextVersion, input.basis, purpose, evidenceRef, input.reason.trim(), input.actorUserId, expectedVersion,
          input.testId, input.horseId, disclosedAfter ? 1 : 0, expectedVersion, input.desired, ...authority.bindings),
      db.prepare(`UPDATE genetic_tests SET public_disclosed=? WHERE id=? AND horse_id=?
        AND EXISTS(SELECT 1 FROM publication_decisions WHERE id=?)`)
        .bind(disclosedAfter ? 1 : 0, input.testId, input.horseId, decisionId),
      db.prepare(`INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,reason,created_at)
        SELECT actor_user_id,'genetic.disclosure.updated','genetic_test',record_id,?,?,'Publication decision recorded; see authorized decision history',CURRENT_TIMESTAMP
        FROM publication_decisions WHERE id=?`)
        .bind(JSON.stringify({ public_disclosed: !disclosedAfter }), JSON.stringify({ public_disclosed: disclosedAfter, decision: input.desired, decision_version: nextVersion, basis: input.basis }), decisionId),
      db.prepare(`SELECT g.id,g.public_disclosed,g.verified,
          (SELECT COALESCE(MAX(d.decision_version),0) FROM publication_decisions d WHERE d.subject_kind='genetic_test' AND d.record_id=CAST(g.id AS TEXT)) AS current_version,
          ${authoritySql} AS actor_allowed
        FROM genetic_tests g WHERE g.id=? AND g.horse_id=?`)
        .bind(...authority.bindings, input.testId, input.horseId),
    ]);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if ((cause as { code?: string } | null)?.code === "23505" || /UNIQUE constraint failed: publication_decisions/i.test(message)) {
      throw new HttpError(409, "publication_decision_conflict", "Another publication decision landed first; reload the current version and retry");
    }
    throw cause;
  }
  const state = results[4]?.results?.[0] as { public_disclosed: number; verified: number; current_version: number; actor_allowed: number | boolean } | undefined;
  if (!state) throw new HttpError(404, "not_found", "Genetic test not found for this horse");
  if (!state.actor_allowed) throw new HttpError(403, "publication_authority_changed", "Publication authority changed; no decision was accepted");
  if (disclosedAfter && Number(state.verified) !== 1) throw new HttpError(409, "verified_record_required", "Confirm the underlying record before making a publication decision");
  const changed = Number(results[1]?.meta.changes ?? 0) === 1;
  if (!changed) {
    if (Number(state.current_version) !== expectedVersion) {
      throw new HttpError(409, "publication_decision_conflict", "The publication version changed; reload it before retrying");
    }
    return { changed: false, decision: null, current_version: expectedVersion, disclosed: Number(state.public_disclosed) === 1 };
  }
  const decision = await db.prepare(`SELECT * FROM publication_decisions WHERE id=? AND (${authority.sql})`)
    .bind(decisionId,...authority.bindings).first<PublicationDecision>();
  if (!decision) throw new HttpError(500, "publication_receipt_unavailable", "The decision was committed but its receipt could not be read");
  return { changed: true, decision, current_version: nextVersion, disclosed: disclosedAfter };
}

/** Full explainable history for one record, oldest first. */
export async function publicationDecisionHistory(db: D1Database, testId: number, viewer: PrivacyViewer): Promise<PublicationDecisionRow[]> {
  const publish = geneticActionPredicate(viewer, { column: "g.horse_id" }, ["genetic_publish"]);
  const review = geneticActionPredicate(viewer, { column: "g.horse_id" }, ["genetic_review", "genetic_evidence_read"]);
  const rows = (await db.prepare(`SELECT d.id,d.subject_kind,d.record_id,d.horse_id,d.decision,d.decision_version,
      d.basis,d.purpose,d.evidence_ref,d.reason,d.actor_user_id,d.expected_version,d.created_at
    FROM publication_decisions d JOIN genetic_tests g ON CAST(g.id AS TEXT)=d.record_id AND d.subject_kind='genetic_test'
    WHERE g.id=? AND ((${publish.sql}) OR (${review.sql})) ORDER BY d.decision_version ASC`)
    .bind(testId,...publish.bindings,...review.bindings).all<PublicationDecisionRow>()).results ?? [];
  return rows.map(row => ({ ...row, decision_version: Number(row.decision_version) }));
}

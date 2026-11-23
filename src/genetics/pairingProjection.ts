import type { D1Database } from "@cloudflare/workers-types";
import { analyzeArabianPairingEvidence, type ArabianVariant, type ArabianVariantEvidence } from "./arabianPairingEvidence";
import type { PrivacyViewer } from "../privacy/policy";
import { geneticActionPredicate } from "../access/geneticAccess";
import { GENETIC_ACCESS_POLICY_VERSION } from "../contracts/professionalAccess";
import { parseUtcTimestamp } from "../shared/utcTimestamp";
import { HttpError } from "../api/http";

export const PAIRING_EVIDENCE_POLICY_VERSION = GENETIC_ACCESS_POLICY_VERSION;
type EvidenceRow = {
  subject_count: number; id: number; horse_id: number; test_type: string; result: string; verified: number; provenance: string;
  assay_key: ArabianVariant | null; result_snapshot: string | null; test_type_snapshot: string | null;
  review_state: string | null; expires_at: string | null;
};
import type { ArabianPairingEvidenceResponse, PairingEvidenceExclusions } from "../contracts/genetics";

/** Project only evidence the current viewer may already read. Counts follow
 * the same boundary, so the presence of private tests cannot leak via analysis.
 * Assays come exclusively from an explicit reviewer mapping, never test prose.
 */
export async function projectArabianPairing(db: D1Database, parentA: number, parentB: number, viewer?: PrivacyViewer | null, now = Date.now()): Promise<ArabianPairingEvidenceResponse> {
  if (!Number.isSafeInteger(parentA) || !Number.isSafeInteger(parentB) || parentA <= 0 || parentB <= 0 || parentA === parentB) {
    throw new HttpError(400, "invalid_pairing", "Choose two different horses");
  }
  const evidence = geneticActionPredicate(viewer, { column: "h.id" }, ["genetic_evidence_read"]);
  const health = geneticActionPredicate(viewer, { column: "h.id" }, ["private_health_read"]);
  // Every parent's subject and evidence gate is resolved independently in
  // the same statement. One parent's grant cannot unlock the other parent's
  // unpublished tests, hidden identity, excluded counts or probabilities.
  const result = await db.prepare(`WITH subjects AS (
      SELECT h.id,h.is_active,
        CASE WHEN ${evidence.sql} THEN 1 ELSE 0 END AS can_evidence,
        CASE WHEN ${health.sql} THEN 1 ELSE 0 END AS can_health
      FROM horses h WHERE h.id IN (?,?) AND h.deleted_at IS NULL
    ), visible AS (SELECT * FROM subjects WHERE is_active=1 OR can_evidence=1 OR can_health=1)
    SELECT (SELECT COUNT(*) FROM visible) AS subject_count,g.id,g.horse_id,g.test_type,g.result,g.verified,g.provenance,
      r.assay_key,r.result_snapshot,r.test_type_snapshot,r.review_state,r.expires_at
    FROM visible s LEFT JOIN genetic_tests g ON g.horse_id=s.id AND g.test_category='disease'
      AND (s.can_evidence=1 OR (g.verified=1 AND (COALESCE(g.public_disclosed,0)=1 OR s.can_health=1)))
    LEFT JOIN genetic_pairing_reviews r ON r.test_id=g.id
    ORDER BY s.id,g.id LIMIT 1003`)
    .bind(...evidence.bindings,...health.bindings,parentA,parentB).all<EvidenceRow>();
  if (!result.results?.length || Number(result.results[0].subject_count) !== 2) throw new HttpError(404, "not_found", "Horse not found");
  const rows = result.results.filter(row => row.id != null);
  // Never silently omit a conflicting retest because a list was truncated.
  if (rows.length > 1000 || [parentA,parentB].some(id => rows.filter(row => Number(row.horse_id) === id).length > 500)) {
    throw new HttpError(422, "pairing_evidence_limit", "Too many test records for a bounded comparison; a reviewer must reconcile the evidence");
  }
  let syntheticEvidence = false;
  function collect(id: number) {
    const excluded: PairingEvidenceExclusions = { unmapped: 0, expired: 0, withdrawn: 0, changed: 0, unverified: 0 };
    const evidence: ArabianVariantEvidence[] = [];
    for (const row of rows.filter(item => Number(item.horse_id) === id)) {
      if (!row.assay_key) { excluded.unmapped++; continue; }
      let usable = Number(row.verified) === 1;
      if (!usable) excluded.unverified++;
      if (row.review_state !== "accepted") { excluded.withdrawn++; usable = false; }
      if (row.result_snapshot !== row.result || row.test_type_snapshot !== row.test_type) { excluded.changed++; usable = false; }
      if (row.expires_at != null) {
        const expiry = parseUtcTimestamp(row.expires_at);
        if (expiry === null || expiry <= now) { excluded.expired++; usable = false; }
      }
      if (row.provenance === "demo") syntheticEvidence = true;
      evidence.push({ evidenceId: `genetic-test:${row.id}`, horseId: id, assayKey: row.assay_key,
        result: row.result, verified: usable });
    }
    return { evidence, excluded };
  }
  const a = collect(parentA), b = collect(parentB);
  return { ...analyzeArabianPairingEvidence(parentA, parentB, a.evidence, b.evidence),
    policyVersion: PAIRING_EVIDENCE_POLICY_VERSION, syntheticEvidence,
    verificationBasis: "reviewed_record_not_issuer_attestation" as const,
    excludedEvidence: { parentA: a.excluded, parentB: b.excluded } };
}

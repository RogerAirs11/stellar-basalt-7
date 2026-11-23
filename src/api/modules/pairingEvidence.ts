import { z } from "zod";
import type { D1Database } from "@cloudflare/workers-types";
import { requireAuth, requireCsrf } from "../../auth/guards";
import { HttpError, json, readJson } from "../http";
import { parseUtcTimestamp } from "../../shared/utcTimestamp";
import type { PairingReviewRecord } from "../../contracts/genetics";
import { geneticActionPredicate } from "../../access/geneticAccess";
import { geneticOperationReceipt, isGeneticReceiptConflict, type GeneticOperationContext } from "../../genetics/operationReceipts";

const Review = z.object({
  operation_id: z.string().uuid(),
  assay_key: z.enum(["SCID", "CA", "LFS", "OAAM1"]),
  expected_version: z.number().int().min(0),
  expected_test_version: z.number().int().positive(),
  expected_test_type: z.string().min(1).max(60),
  expected_result: z.string().min(1).max(256),
  legacy_origin_acknowledged: z.boolean().default(false),
  state: z.enum(["accepted", "withdrawn"]),
  expires_at: z.string().datetime({ offset: true }).nullable().optional(),
  reason: z.string().trim().min(10).max(1000),
});

/** An independent, scoped reviewer maps a previously reviewed record to one
 * exact variant. This is never issuer attestation or a clinical diagnosis. */
export async function reviewPairingEvidence(request: Request, env: { DB: D1Database; SESSION_COOKIE_NAME: string }, testId: number) {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME);
  requireCsrf(request, auth);
  const permissions = ["genetic_evidence_read", "genetic_review"] as const;
  const scope = geneticActionPredicate(auth, { column: "g.horse_id" }, permissions);
  const test = await env.DB.prepare(`SELECT g.id,g.horse_id,g.verified,g.test_type,g.result,g.test_category,g.row_version,g.created_by_user_id
    FROM genetic_tests g WHERE g.id=? AND (${scope.sql})`)
    .bind(testId,...scope.bindings).first<{ id: number; horse_id: number; verified: number; test_type: string; result: string;
      test_category: string; row_version: number; created_by_user_id: string | null }>();
  if (!test) throw new HttpError(403, "genetic_review_required", "Current evidence-read and review permissions are required for this record");
  const parsed = Review.safeParse(await readJson(request, 8 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_pairing_review", "Review failed validation", parsed.error.flatten());
  const d = parsed.data;
  const context: GeneticOperationContext = { viewer: auth, horseId: Number(test.horse_id), operationId: d.operation_id,
    action: "pairing_review", requestJson: JSON.stringify({ test_id: testId, ...d }), permissions };
  const prior = await geneticOperationReceipt<PairingReviewRecord>(env.DB, context);
  if (prior) return json({ review: prior, operation_id: d.operation_id, replayed: true });
  const expires = d.expires_at == null ? null : parseUtcTimestamp(d.expires_at);
  if (d.expires_at != null && (expires === null || (d.state === "accepted" && expires <= Date.now()))) {
    throw new HttpError(400, "invalid_review_expiry", "An accepted review needs a valid future expiry or no expiry");
  }
  if (d.state === "accepted" && (Number(test.verified) !== 1 || test.test_category !== "disease")) {
    throw new HttpError(409, "verified_record_required", "Review the underlying disease-test evidence before approving a variant mapping");
  }
  if (d.state === "accepted" && test.created_by_user_id === auth.user.id) {
    throw new HttpError(403, "independent_reviewer_required", "A submitter cannot approve their own report for pairing");
  }
  if (d.state === "accepted" && !test.created_by_user_id && !d.legacy_origin_acknowledged) {
    throw new HttpError(422, "legacy_origin_acknowledgement_required", "This legacy record has no known submitter; acknowledge that limitation before accepting its mapping");
  }
  if (Number(test.row_version) !== d.expected_test_version || test.result !== d.expected_result || test.test_type !== d.expected_test_type) {
    throw new HttpError(409, "evidence_changed", "The recorded test changed; review the current report");
  }
  const before = await env.DB.prepare("SELECT * FROM genetic_pairing_reviews WHERE test_id=?").bind(testId).first<Record<string, unknown>>();
  if (Number(before?.row_version ?? 0) !== d.expected_version || (d.state === "withdrawn" && !before)) {
    throw new HttpError(409, "review_conflict", "The review changed; reload before deciding");
  }
  const attemptId = crypto.randomUUID();
  const guard = geneticActionPredicate(auth, Number(test.horse_id), permissions);
  const receiptExists = "EXISTS(SELECT 1 FROM genetic_evidence_operations WHERE operation_id=? AND attempt_id=?)";
  let committed = false;
  try {
    const results = await env.DB.batch([
      env.DB.prepare("UPDATE genetic_tests SET row_version=row_version WHERE id=?").bind(testId),
      env.DB.prepare(`INSERT INTO genetic_evidence_operations(operation_id,attempt_id,test_id,horse_id,actor_user_id,action,request_json,decision_json,private_detail_json)
        SELECT ?,?,g.id,g.horse_id,?,'pairing_review',?,
          json_object('test_id',g.id,'assay_key',CAST(? AS TEXT),'review_state',CAST(? AS TEXT),
            'row_version',CAST(? AS INTEGER),'expires_at',CAST(? AS TEXT),'reviewed_at',CURRENT_TIMESTAMP),?
        FROM genetic_tests g WHERE g.id=? AND g.horse_id=? AND g.row_version=? AND g.test_type=? AND g.result=?
          AND (?='withdrawn' OR (g.verified=1 AND g.test_category='disease'))
          AND (g.created_by_user_id IS NULL OR g.created_by_user_id<>? OR ?='withdrawn')
          AND (g.created_by_user_id IS NOT NULL OR ?=1 OR ?='withdrawn')
          AND COALESCE((SELECT r.row_version FROM genetic_pairing_reviews r WHERE r.test_id=g.id),0)=?
          AND (${guard.sql}) AND NOT EXISTS(SELECT 1 FROM genetic_evidence_operations WHERE operation_id=?)
        ON CONFLICT(operation_id) DO NOTHING`)
        .bind(d.operation_id,attemptId,auth.user.id,context.requestJson,d.assay_key,d.state,d.expected_version+1,d.expires_at ?? null,
          JSON.stringify({ before, decision: d, source: { test_id: testId, row_version: test.row_version, test_type: test.test_type, result: test.result } }),
          testId,test.horse_id,d.expected_test_version,test.test_type,test.result,d.state,auth.user.id,d.state,d.legacy_origin_acknowledged ? 1 : 0,d.state,d.expected_version,...guard.bindings,d.operation_id),
      before
        ? env.DB.prepare(`UPDATE genetic_pairing_reviews SET assay_key=?,result_snapshot=?,test_type_snapshot=?,review_state=?,
            reviewed_by_user_id=?,reviewed_at=CURRENT_TIMESTAMP,expires_at=?,row_version=row_version+1,last_operation_id=?,review_note=?
            WHERE test_id=? AND ${receiptExists}`)
          .bind(d.assay_key,test.result,test.test_type,d.state,auth.user.id,d.expires_at ?? null,d.operation_id,d.reason,testId,d.operation_id,attemptId)
        : env.DB.prepare(`INSERT INTO genetic_pairing_reviews(test_id,assay_key,result_snapshot,test_type_snapshot,review_state,reviewed_by_user_id,expires_at,last_operation_id,review_note)
            SELECT ?,?,?,?,?,?,?,?,? WHERE ${receiptExists}`)
          .bind(testId,d.assay_key,test.result,test.test_type,d.state,auth.user.id,d.expires_at ?? null,d.operation_id,d.reason,d.operation_id,attemptId),
      env.DB.prepare(`INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,after_json)
        SELECT actor_user_id,?,'genetic_test',CAST(test_id AS TEXT),? FROM genetic_evidence_operations
        WHERE operation_id=? AND attempt_id=?`)
        .bind("genetic.pairing_review."+d.state,JSON.stringify({ operation_id: d.operation_id, row_version: d.expected_version+1,
          authority_scope: "genetic_review" }),d.operation_id,attemptId),
    ]);
    committed = Number(results[1]?.meta.changes ?? 0) === 1;
  } catch (cause) {
    if (!isGeneticReceiptConflict(cause)) throw cause;
  }
  const review = await geneticOperationReceipt<PairingReviewRecord>(env.DB, context);
  if (!review) throw new HttpError(409, "review_conflict", "The evidence, review or permission changed; reload before retrying");
  return json({ review, operation_id: d.operation_id, replayed: !committed });
}

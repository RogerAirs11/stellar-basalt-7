/** R117-20: change-request route handlers (create/submit/withdraw/edit/review),
 * extracted verbatim from src/api/routes.ts (dispatch lines unchanged there;
 * endpoint order and middleware order preserved). Includes the change-request
 * zod schemas + decision CAS SQL + the family's SQL/load helpers.
 */
import { z } from "zod";
import { ADMIN_HORSE_DETAIL_COLUMNS, type HorseRow } from "../../db/types";
import { CHANGE_REQUEST_APPLICABLE_FIELDS, type ProposedChangeItem, validateProposedChangeItems } from "../changeRequestValidation";
import { CHANGE_REQUEST_ITEMS_MAX } from "../../contracts/platform";
import { HorseSubmissionSchema, SUBMISSION_NEEDS_CHANGES_SQL, buildSubmissionApprovalStatements, isIdempotencyViolation, parseStoredSubmission, resolveIdempotencyReplay, submissionPayloadDigest, submissionReviewStatus, type HorseSubmission, validateSubmissionReferences } from "../../registry/submissions";
import { RULE_OVERRIDES_SCHEMA } from "../../registry/validation";
import { buildRuleSubject } from "../../registry/rulesEngine";
import { enforceRegistryRules } from "../modules/registryRules";
import { HttpError, error, json, readJson, requestId } from "../http";
import { PARENT_CORRECTION_SCHEMA as PARENT_CORRECTION_INPUT_SCHEMA, parentCorrectionAutoSummary, parseStoredParentCorrection, type ParentCorrection, validateParentCorrectionInput } from "../../registry/relations";
import { abortCanonicalMutation, canonicalMutationIntentStatement } from "../../audit/mutationJournal";
import { assertJsonEvidenceComplexity } from "../../security/jsonComplexity";
import { buildCanonicalHorseUpdateStatements, planHorseMutation, runGuardedHorseBatch, staleBaseFieldDifferences } from "../../registry/mutations";
import { identifierTableReady } from "../../registry/identifiers";
import { requireAuth, requireCsrf } from "../../auth/guards";
import { requireHorseAction } from "../../access/horseAccess";
import { assertNoLiveHorseDuplicates, assertValidParentAssignment, settleWorkflowMutation, settleCanonicalHorseMutation, audit, parseJsonObject, parseJsonArray } from "./registryShared";

const ChangeRequestCreateSchema = z.object({
  horse_id: z.number().int().positive().nullable().optional(),
  request_type: z.enum(["create_horse", "update_horse", "ownership", "other"]),
  summary: z.string().trim().min(3).max(2000).optional(),
  evidence: z.record(z.string(), z.unknown()).optional(),
  items: z.array(z.object({
    field_name: z.string().trim().min(1).max(120),
    old_value: z.unknown().optional(),
    proposed_value: z.unknown(),
  })).max(CHANGE_REQUEST_ITEMS_MAX).optional(),
  // Master-Ai plan T11: structured new-horse submissions.
  submission: HorseSubmissionSchema.nullable().optional(),
  // Master-Ai plan T12: structured parent-correction submissions on
  // update_horse requests (kind, target parents, reason, evidence source).
  parent_correction: PARENT_CORRECTION_INPUT_SCHEMA.nullable().optional(),
  idempotency_key: z.string().trim().min(8).max(120).optional(),
  submit: z.boolean().optional(),
});
const ChangeRequestReviewSchema = z.object({
  decision: z.enum(["approved", "rejected", "needs_changes"]),
  note: z.string().trim().max(2000).nullable().optional(),
  // T07: a reviewer must explicitly reconfirm a change whose submitted base
  // values no longer match the horse row. A post-commit warning is not enough.
  confirm_stale: z.boolean().optional(),
  // R146-D04: permitted policy overrides for an approval (rule_id + reason).
  rule_overrides: RULE_OVERRIDES_SCHEMA.optional(),
});
// T11: edits are only allowed while the request is back in draft (e.g. after
// a needs_changes decision). The payload mirrors the create payload.
const ChangeRequestEditSchema = z.object({
  // R148 Task 5: the client must send the content_revision its form actually loaded.
  // A draft opened in another tab (or restored after a later save) conflicts here
  // instead of silently clobbering the newer edit via a freshly-read revision.
  expected_content_revision: z.number().int().positive(),
  summary: z.string().trim().min(3).max(2000).optional(),
  evidence: z.record(z.string(), z.unknown()).nullable().optional(),
  items: z.array(z.object({
    field_name: z.string().trim().min(1).max(120),
    old_value: z.unknown().optional(),
    proposed_value: z.unknown(),
  })).max(CHANGE_REQUEST_ITEMS_MAX).nullable().optional(),
  submission: HorseSubmissionSchema.nullable().optional(),
  parent_correction: PARENT_CORRECTION_INPUT_SCHEMA.nullable().optional(),
});

// R74 (audit REV-01/REV-02): reviewed mutations must commit their decision and
// their canonical effects together or not at all. On D1 and the Supabase full
// provider a batch is a single transaction, so every canonical-effect statement
// below is CONDITIONED on the decision (or the version-guarded horse update)
// actually having landed in this same batch. A losing reviewer's batch becomes
// an all-no-op batch instead of silently applying canonical effects.
// (T07: the horse-update/reindex/revision statements now come from the shared
// builder in src/registry/mutations.ts; only the decision CAS lives here.)

const CHANGE_DECISION_CAS_SQL = `UPDATE change_requests SET status=?,reviewed_by_user_id=?,review_note=?,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('pending','draft')`;
// When a version-guarded horse update is part of the batch, the decision write
// itself is conditioned on that update having landed (last_mutation_id=ours):
// a stale row_version therefore leaves the request pending instead of recording
// an approved-but-not-applied review.
const CHANGE_DECISION_AFTER_UPDATE_SQL = `UPDATE change_requests SET status=?,reviewed_by_user_id=?,review_note=?,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
  WHERE id=? AND status IN ('pending','draft')
  AND EXISTS(SELECT 1 FROM horses WHERE id=? AND last_mutation_id=?)`;


export async function createChangeRequest(request: Request, env: Env): Promise<Response> {
  // Master-Ai plan T10: proposals are open to the owner role (reviewed path,
  // unchanged) AND to any account holding an active manage_profile grant on
  // the target horse — a manager/breeder mandate includes profile proposals
  // without conferring any global permission.
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  const parsed = ChangeRequestCreateSchema.safeParse(await readJson<unknown>(request, 128 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_change_request", "Change request failed validation", parsed.error.flatten());
  const payload = parsed.data;
  if (auth.user.role === "user" && payload.horse_id) {
    await requireHorseAction(env.DB, auth, payload.horse_id, "manage_profile");
  } else if (auth.user.role === "user" && !payload.submission) {
    throw new HttpError(403, "horse_access_required", "An approved ownership claim or an explicit grant is required to propose changes");
  }
  if (payload.evidence) assertJsonEvidenceComplexity(payload.evidence, "change-request evidence");
  for (const item of payload.items ?? []) {
    assertJsonEvidenceComplexity(item.proposed_value, "change-request proposed value");
    if (item.old_value !== undefined) assertJsonEvidenceComplexity(item.old_value, "change-request old value");
  }
  if (payload.horse_id) {
    const horse = await env.DB.prepare("SELECT id FROM horses WHERE id=? AND deleted_at IS NULL").bind(payload.horse_id).first();
    if (!horse) return error(404, "not_found", "Horse not found");
  }
  // R74 (REV-02): update_horse items are validated at SUBMISSION with the same
  // rules as direct edits — duplicate fields, unsupported fields and invalid
  // values are deterministic 422s instead of a later silently-skipped apply.
  if (payload.request_type === "update_horse" && payload.items?.length) {
    const issues = validateProposedChangeItems(payload.items as ProposedChangeItem[]);
    if (issues.length) throw new HttpError(422, "invalid_change_items", "Proposed changes failed validation", { issues });
  }
  // Master-Ai plan T11: create_horse proposals are STRUCTURED submissions —
  // a summary-only create request can never yield a canonical record, so it
  // is refused up front instead of being approved review-only later.
  let submission: HorseSubmission | null = null;
  if (payload.request_type === "create_horse") {
    if (!payload.submission) {
      throw new HttpError(422, "structured_submission_required", "create_horse requests must carry a structured submission: a native or Latin name, parents as existing registry ids or explicit unresolved assertions, and shared-field values");
    }
    if (payload.horse_id) {
      throw new HttpError(422, "invalid_submission", "A new-horse submission cannot reference an existing horse id");
    }
    if (payload.parent_correction) {
      throw new HttpError(422, "invalid_submission", "A create_horse request cannot carry a parent correction");
    }
    submission = payload.submission;
    const issues = await validateSubmissionReferences(env.DB, submission);
    if (issues.length) throw new HttpError(422, "invalid_submission_references", "The submission references records that do not exist or are unavailable", { issues });
    await assertValidParentAssignment(env.DB, null, submission.father_horse_id ?? undefined, submission.mother_horse_id ?? undefined);
    await assertNoLiveHorseDuplicates(env.DB, null, {
      register_no: submission.register_no ?? null,
      microchip_no: submission.microchip_no ?? null,
    });
  }
  // Master-Ai plan T12: parent corrections are STRUCTURED update_horse
  // submissions — an item-list cannot express source/conflict evidence, so
  // parent changes through the review path must arrive as a correction.
  let parentCorrection: ParentCorrection | null = null;
  if (payload.parent_correction) {
    if (payload.request_type !== "update_horse") {
      throw new HttpError(422, "invalid_parent_correction", "A parent correction is an update_horse request");
    }
    if (!payload.horse_id) {
      throw new HttpError(422, "invalid_parent_correction", "A parent correction must reference the horse it corrects");
    }
    if (payload.submission || payload.items?.length) {
      throw new HttpError(422, "invalid_parent_correction", "A parent correction is structured: it cannot be mixed with items or a new-horse submission");
    }
    const correctionCheck = validateParentCorrectionInput(payload.parent_correction);
    if (!correctionCheck.ok) throw new HttpError(422, "invalid_parent_correction", correctionCheck.message, { issues: correctionCheck.issues });
    if (correctionCheck.correction.horse_id !== payload.horse_id) {
      throw new HttpError(422, "invalid_parent_correction", "The correction's horse_id does not match the request's horse_id");
    }
    // Validate the asserted parents against the CURRENT pedigree graph —
    // existence, cycles and plausibility — exactly like a direct edit.
    await assertValidParentAssignment(env.DB, payload.horse_id, correctionCheck.correction.father_id ?? undefined, correctionCheck.correction.mother_id ?? undefined);
    parentCorrection = correctionCheck.correction;
  }
  const summary = payload.summary
    ?? (submission ? submissionAutoSummary(submission) : parentCorrection ? parentCorrectionAutoSummary(parentCorrection) : undefined);
  if (!summary) throw new HttpError(422, "summary_required", "A summary is required for this request type");
  const id = crypto.randomUUID();
  const mutationId = crypto.randomUUID();
  const reqId = requestId(request);
  const initialStatus = payload.submit === false ? "draft" : "pending";
  // R140-C: the idempotency key binds to a payload fingerprint — a replayed
  // key with DIFFERENT content is an explicit conflict, not a silent replay
  // of the first submission.
  const payloadDigest = payload.idempotency_key
    ? await submissionPayloadDigest({ horse_id: payload.horse_id ?? undefined, request_type: payload.request_type, submission: payload.submission, items: payload.items, parent_correction: payload.parent_correction })
    : null;
  const statements = [
    canonicalMutationIntentStatement(env.DB, {
      id: mutationId, actorUserId: auth.user.id, action: initialStatus === "draft" ? "change_request.draft" : "change_request.create", entityType: "change_request", entityId: id,
      requested: payload, requestId: reqId, searchStatus: "not_applicable",
    }),
    env.DB.prepare(`INSERT INTO change_requests(id,submitted_by_user_id,horse_id,request_type,status,summary,evidence_json,submitted_at,submission_json,idempotency_key,payload_digest)
      VALUES(?,?,?,?,?,?,?,${payload.submit === false ? "NULL" : "CURRENT_TIMESTAMP"},?,?,?)`)
      .bind(id, auth.user.id, payload.horse_id ?? null, payload.request_type, initialStatus, summary,
        payload.evidence ? JSON.stringify(payload.evidence) : null,
        submission ? JSON.stringify(submission) : (parentCorrection ? JSON.stringify(parentCorrection) : null),
        payload.idempotency_key ?? null,
        payloadDigest),
    ...(payload.items ?? []).map((item) => env.DB.prepare(`INSERT INTO change_request_items(change_request_id,field_name,old_value_json,proposed_value_json)
      VALUES(?,?,?,?)`).bind(id, item.field_name, item.old_value === undefined ? null : JSON.stringify(item.old_value), JSON.stringify(item.proposed_value))),
  ];
  try {
    await env.DB.batch(statements);
  } catch (cause) {
    // T11 idempotency: the partial unique index on (submitter, key) turns a
    // double-submitted key into a replay of the original request.
    if (isIdempotencyViolation(cause)) {
      const existing = await resolveIdempotencyReplay(env.DB, auth.user.id, payload.idempotency_key ?? null);
      if (existing) {
        // R140-C: key reuse with a DIFFERENT payload is an explicit conflict —
        // the client must mint a fresh key instead of receiving a receipt for
        // a horse it never submitted. Legacy rows (stored before the digest
        // existed) keep the T11 replay behavior, flagged for transparency.
        if (existing.payload_digest != null && payloadDigest != null && existing.payload_digest !== payloadDigest) {
          throw new HttpError(409, "idempotency_conflict", "This idempotency key was already used for a different submission. Mint a fresh key and resubmit.");
        }
        const created = await loadChangeRequest(env.DB, existing.id);
        return json({ request: created, idempotent_replay: true, workflowEffect: "review_only", canonicalApplied: false, review_status: submissionReviewStatus({ status: existing.status }) });
      }
    }
    throw cause;
  }
  const created = await loadChangeRequest(env.DB, id);
  await settleWorkflowMutation(env.DB, mutationId, id, auth.user.id, "change_request.create", "change_request", null, created, reqId);
  return json({ request: created, workflowEffect: "review_only", canonicalApplied: false }, { status: 201 });
}

/** Deterministic review-facing summary for a structured submission. */
export function submissionAutoSummary(submission: HorseSubmission): string {
  const displayName = submission.name_latin ?? submission.name_native ?? "Unnamed";
  const parts = [`New horse submission: ${displayName}`];
  if (submission.register_no) parts.push(`reg ${submission.register_no}`);
  if (submission.father_horse_id != null || submission.mother_horse_id != null) {
    parts.push(`sire ${submission.father_horse_id ?? "unresolved"}`, `dam ${submission.mother_horse_id ?? "unresolved"}`);
  }
  return parts.join(" · ").slice(0, 2000);
}

// T11: draft -> pending. Clearing review_outcome marks the end of a
// needs_changes round-trip; the reviewer's note history stays in audit.
export async function submitChangeRequest(request: Request, env: Env, changeId: string): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  const mutationId = crypto.randomUUID();
  const reqId = requestId(request);
  const results = await env.DB.batch([
    canonicalMutationIntentStatement(env.DB, {
      id: mutationId, actorUserId: auth.user.id, action: "change_request.submit", entityType: "change_request", entityId: changeId,
      requested: { changeId }, requestId: reqId, searchStatus: "not_applicable",
    }),
    env.DB.prepare(`UPDATE change_requests SET status='pending',submitted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP,review_outcome=NULL
      WHERE id=? AND status='draft' AND submitted_by_user_id=?`).bind(changeId, auth.user.id),
  ]);
  if (Number(results[1]?.meta.changes ?? 0) !== 1) {
    try { await abortCanonicalMutation(env.DB, mutationId, "submission was not an editable draft of this user"); } catch {}
    return error(409, "change_request_not_submittable", "Only your own draft submissions can be submitted");
  }
  const after = await loadChangeRequest(env.DB, changeId);
  await settleWorkflowMutation(env.DB, mutationId, changeId, auth.user.id, "change_request.submit", "change_request", null, after, reqId);
  return json({ request: after, workflowEffect: "review_only", canonicalApplied: false });
}

// T11: draft/pending -> withdrawn (submitter-initiated exit).
export async function withdrawChangeRequest(request: Request, env: Env, changeId: string): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  const mutationId = crypto.randomUUID();
  const reqId = requestId(request);
  const results = await env.DB.batch([
    canonicalMutationIntentStatement(env.DB, {
      id: mutationId, actorUserId: auth.user.id, action: "change_request.withdraw", entityType: "change_request", entityId: changeId,
      requested: { changeId }, requestId: reqId, searchStatus: "not_applicable",
    }),
    env.DB.prepare(`UPDATE change_requests SET status='withdrawn',updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND status IN ('draft','pending') AND submitted_by_user_id=?`).bind(changeId, auth.user.id),
  ]);
  if (Number(results[1]?.meta.changes ?? 0) !== 1) {
    try { await abortCanonicalMutation(env.DB, mutationId, "submission was not withdrawable by this user"); } catch {}
    return error(409, "change_request_not_withdrawable", "Only your own draft or pending submissions can be withdrawn");
  }
  const after = await loadChangeRequest(env.DB, changeId);
  await settleWorkflowMutation(env.DB, mutationId, changeId, auth.user.id, "change_request.withdraw", "change_request", null, after, reqId);
  return json({ request: after, workflowEffect: "review_only", canonicalApplied: false });
}

// T11: edit the content of a request that is back in draft (needs_changes).
// Re-validates with exactly the create-path rules — an edit can never weaken
// the submission's guarantees.
export async function editChangeRequest(request: Request, env: Env, changeId: string): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  const before = await loadChangeRequest(env.DB, changeId);
  if (!before) return error(404, "not_found", "Change request not found");
  if (before.submitted_by_user_id !== auth.user.id) throw new HttpError(403, "forbidden", "Only the submitter can edit a request");
  if (before.status !== "draft") throw new HttpError(409, "change_request_not_editable", "Only requests in draft can be edited; needs_changes returns them to draft");
  const parsed = ChangeRequestEditSchema.safeParse(await readJson<unknown>(request, 128 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_change_request", "Edit failed validation", parsed.error.flatten());
  const payload = parsed.data;
  // R148 Task 5: stale-browser-draft version contract. The guarded UPDATE below
  // is bound to the EXPECTED revision the form loaded, not the freshly-read one,
  // so a stale tab can no longer overwrite a newer save from another tab.
  if (payload.expected_content_revision !== Number(before.content_revision)) {
    return error(409, "content_revision_conflict",
      "This draft changed after your form loaded. Review the current server state before saving.",
      { current_content_revision: Number(before.content_revision) });
  }
  if (before.request_type === "create_horse") {
    if (!payload.submission) throw new HttpError(422, "structured_submission_required", "A create_horse request must keep its structured submission");
    const issues = await validateSubmissionReferences(env.DB, payload.submission);
    if (issues.length) throw new HttpError(422, "invalid_submission_references", "The submission references records that do not exist or are unavailable", { issues });
    await assertValidParentAssignment(env.DB, null, payload.submission.father_horse_id ?? undefined, payload.submission.mother_horse_id ?? undefined);
    await assertNoLiveHorseDuplicates(env.DB, null, {
      register_no: payload.submission.register_no ?? null,
      microchip_no: payload.submission.microchip_no ?? null,
    });
  }
  if (before.request_type === "update_horse" && payload.items?.length) {
    const issues = validateProposedChangeItems(payload.items as ProposedChangeItem[]);
    if (issues.length) throw new HttpError(422, "invalid_change_items", "Proposed changes failed validation", { issues });
  }
  // T12: a draft parent correction keeps its structured shape on edit — the
  // same create-path rules apply (target horse, evidence, current graph).
  let editedCorrection: ParentCorrection | null = null;
  if (payload.parent_correction) {
    const correctionCheck = validateParentCorrectionInput(payload.parent_correction);
    if (!correctionCheck.ok) throw new HttpError(422, "invalid_parent_correction", correctionCheck.message, { issues: correctionCheck.issues });
    if (correctionCheck.correction.horse_id !== Number(before.horse_id)) {
      throw new HttpError(422, "invalid_parent_correction", "The correction's horse_id does not match the request's horse_id");
    }
    await assertValidParentAssignment(env.DB, correctionCheck.correction.horse_id, correctionCheck.correction.father_id ?? undefined, correctionCheck.correction.mother_id ?? undefined);
    if (payload.submission || payload.items?.length) {
      throw new HttpError(422, "invalid_parent_correction", "A parent correction is structured: it cannot be mixed with items or a new-horse submission");
    }
    editedCorrection = correctionCheck.correction;
  }
  const summary = payload.summary
    ?? (payload.submission ? submissionAutoSummary(payload.submission)
      : editedCorrection ? parentCorrectionAutoSummary(editedCorrection)
      : before.summary);
  const evidence = payload.evidence === undefined ? before.evidence : payload.evidence;
  if (evidence) assertJsonEvidenceComplexity(evidence, "change-request evidence");
  const mutationId = crypto.randomUUID();
  const reqId = requestId(request);
  const results = await env.DB.batch([
    canonicalMutationIntentStatement(env.DB, {
      id: mutationId, actorUserId: auth.user.id, action: "change_request.edit", entityType: "change_request", entityId: changeId,
      requested: payload, requestId: reqId, searchStatus: "not_applicable",
    }),
    env.DB.prepare("UPDATE change_requests SET content_revision=content_revision WHERE id=?").bind(changeId),
    env.DB.prepare(`UPDATE change_requests SET summary=?,evidence_json=?,submission_json=?,content_revision=content_revision+1,last_edit_operation_id=?,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND status='draft' AND submitted_by_user_id=? AND content_revision=?`)
      .bind(summary, evidence === null || evidence === undefined ? null : JSON.stringify(evidence),
        payload.parent_correction !== undefined
          ? (payload.parent_correction === null ? null : JSON.stringify(payload.parent_correction))
          : payload.submission === undefined ? (before.submission ? JSON.stringify(before.submission) : null) : (payload.submission === null ? null : JSON.stringify(payload.submission)),
        mutationId, changeId, auth.user.id, Number(payload.expected_content_revision)),
    ...(payload.items === undefined ? [] : [
      env.DB.prepare("DELETE FROM change_request_items WHERE change_request_id=? AND EXISTS(SELECT 1 FROM change_requests WHERE id=? AND last_edit_operation_id=?)").bind(changeId, changeId, mutationId),
      ...(payload.items ?? []).map((item) => env.DB.prepare(`INSERT INTO change_request_items(change_request_id,field_name,old_value_json,proposed_value_json)
        SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM change_requests WHERE id=? AND last_edit_operation_id=?)`)
        .bind(changeId, item.field_name, item.old_value === undefined ? null : JSON.stringify(item.old_value), JSON.stringify(item.proposed_value), changeId, mutationId)),
    ]),
  ]);
  if (Number(results[2]?.meta.changes ?? 0) !== 1) {
    try { await abortCanonicalMutation(env.DB, mutationId, "request was no longer an editable draft"); } catch {}
    // Distinguish a lost race against the expected-revision guard from a
    // non-editable status: the row was an editable draft when checked, so a
    // mismatch here is a concurrent edit between check and write.
    const current = await env.DB.prepare("SELECT content_revision,status FROM change_requests WHERE id=?").bind(changeId).first<{ content_revision: number; status: string }>();
    if (current && current.status === "draft" && Number(current.content_revision) !== payload.expected_content_revision) {
      return error(409, "content_revision_conflict",
        "This draft changed after your form loaded. Review the current server state before saving.",
        { current_content_revision: Number(current.content_revision) });
    }
    return error(409, "change_request_not_editable", "Only requests in draft can be edited");
  }
  const after = await loadChangeRequest(env.DB, changeId);
  await settleWorkflowMutation(env.DB, mutationId, changeId, auth.user.id, "change_request.edit", "change_request", before, after, reqId);
  return json({ request: after, workflowEffect: "review_only", canonicalApplied: false });
}

export async function myChangeRequests(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "owner");
  const rows = await env.DB.prepare(`${changeRequestSelectSql()}
    WHERE r.submitted_by_user_id=? ORDER BY r.created_at DESC LIMIT 100`).bind(auth.user.id).all();
  return json({ requests: rows.results.map(normalizeChangeRequestRow) });
}

export async function adminChangeRequests(request: Request, env: Env): Promise<Response> {
  await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "admin");
  const rows = await env.DB.prepare(`${changeRequestSelectSql()}
    ORDER BY CASE r.status WHEN 'pending' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,r.created_at DESC LIMIT 100`).all();
  return json({ requests: rows.results.map(normalizeChangeRequestRow) });
}

export async function reviewChangeRequest(request: Request, env: Env, changeId: string): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "admin");
  requireCsrf(request, auth);
  const parsed = ChangeRequestReviewSchema.safeParse(await readJson<unknown>(request, 16 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_review", "Review data failed validation", parsed.error.flatten());
  const before = await loadChangeRequest(env.DB, changeId);
  if (!before) return error(404, "not_found", "Change request not found");
  if (!["pending", "draft"].includes(before.status)) throw new HttpError(409, "change_request_closed", "This change request has already been decided");
  const mutationId = crypto.randomUUID();
  const reqId = requestId(request);
  // R59: approving an update_horse change request applies whitelisted field
  // changes to the canonical horse row. R74 (REV-01/REV-02): the apply is now
  // version-guarded and every statement in the batch is conditioned on the
  // previous one having landed, so a losing reviewer (or a concurrently edited
  // horse) can never overwrite the canonical row — and a stale row_version
  // leaves the request PENDING instead of recording approved-but-not-applied.
  // T07: the apply now plans through the SAME typed mutation service as direct
  // edits — normalized parsed values only (raw "  X  " never reaches the row),
  // stale submitted base values BLOCK the approval (409 with safe field
  // differences) unless the reviewer explicitly reconfirms, identifier edits
  // claim horse_identifiers, and a parent rename queues the children for
  // search reindex (T09).
  let appliedFields: string[] = [];
  let skippedFields: string[] = [];
  let staleFields: string[] = [];
  let plan: ReturnType<typeof planHorseMutation> | null = null;
  let updateStatements: D1PreparedStatement[] = [];
  let decisionStatement: D1PreparedStatement;
  let expectedRowVersion: number | null = null;
  let reviewedHorse: HorseRow | null = null;
  // Master-Ai plan T11: approving a structured create_horse submission creates
  // the canonical record, claims its identifiers, records the permitted
  // relationships, mints the initial owner grant and records the approval —
  // ALL in ONE transaction (see src/registry/submissions.ts). Any failure
  // leaves the submission pending with NO partial canonical horse.
  let submissionApproval: ReturnType<typeof buildSubmissionApprovalStatements> | null = null;
  let submissionDecisionIndex = -1;
  // Rule evaluation and the exact reviewed proposal are pinned; receipts
  // are appended inside the same atomic canonical-approval batch.
  let submissionRuleSubject: import("../../registry/rulesEngine").RuleEvaluationSubject | null = null;
  let submissionRules: Awaited<ReturnType<typeof enforceRegistryRules>> | null = null;
  const needsChanges = parsed.data.decision === "needs_changes";
  if (needsChanges) {
    // T11: needs_changes returns the request to draft with a recorded outcome
    // so the submitter can edit and resubmit. A note telling them WHAT to
    // change is mandatory — an unexplained bounce is useless.
    if (!parsed.data.note?.trim()) {
      throw new HttpError(422, "review_note_required", "needs_changes requires a note explaining what the submitter must change");
    }
    decisionStatement = env.DB.prepare(SUBMISSION_NEEDS_CHANGES_SQL)
      .bind(auth.user.id, parsed.data.note, changeId);
  } else if (parsed.data.decision === "approved" && before.request_type === "create_horse") {
    // T11: only STRUCTURED submissions can be approved into a canonical
    // record. Legacy summary-only create requests are refused — approving
    // them review-only would silently promise a registration that never
    // happened (the exact anti-pattern the plan calls out).
    const submission = parseStoredSubmission(before.submission);
    if (!submission) {
      throw new HttpError(422, "legacy_create_horse_without_submission", "This create_horse request predates structured submissions and cannot be approved into a canonical record; ask the submitter to resubmit through the submission form");
    }
    // Re-validate against the CURRENT database: parents or people may have
    // changed (archived, deleted) while the submission sat in the queue.
    const issues = await validateSubmissionReferences(env.DB, submission);
    if (issues.length) throw new HttpError(409, "submission_references_stale", "The submission references records that changed while it was pending; ask the submitter to update it", { issues });
    await assertValidParentAssignment(env.DB, null, submission.father_horse_id ?? undefined, submission.mother_horse_id ?? undefined);
    await assertNoLiveHorseDuplicates(env.DB, null, {
      register_no: submission.register_no ?? null,
      microchip_no: submission.microchip_no ?? null,
    });
    // R146-D04: the registration review path evaluates the SAME engine as
    // manual entry and imports (studbook admission, numbering, chronology).
    submissionRuleSubject = await buildRuleSubject(env.DB, {
      subjectType: "submission_review", subjectRef: changeId, includeEvidenceCounts: false, requestEvidenceId: String(changeId),
      requestContent: { id: changeId, revision: Number(before.content_revision), status: String(before.status) },
      record: {
        name_latin: submission.name_latin ?? null,
        breed_desc: submission.breed_desc ?? null,
        sex_desc: submission.sex_desc ?? null,
        register_no: submission.register_no ?? null,
        microchip_no: submission.microchip_no ?? null,
        birth_year: submission.birth_year ?? null,
        birth_date_value: submission.birth_date?.value ?? null,
        birth_date_precision: submission.birth_date?.precision ?? null,
        birth_date_calendar: submission.birth_date?.calendar ?? null,
        death_date_value: submission.death_date?.value ?? null,
        death_date_precision: submission.death_date?.precision ?? null,
        death_date_calendar: submission.death_date?.calendar ?? null,
        is_dead: submission.death_date != null || submission.life_status === "dead" ? 1 : 0,
        father_id: submission.father_horse_id ?? null,
        mother_id: submission.mother_horse_id ?? null,
      },
    });
    submissionRules = await enforceRegistryRules(env.DB, submissionRuleSubject, parsed.data.rule_overrides);
    submissionApproval = buildSubmissionApprovalStatements({
      db: env.DB,
      changeRequestId: changeId,
      submission,
      submitterUserId: String(before.submitted_by_user_id ?? ""),
      reviewerUserId: auth.user.id,
      mutationId,
      reviewNote: parsed.data.note ?? null,
      identifierTableReady: await identifierTableReady(env.DB),
      grantId: crypto.randomUUID(),
    });
    submissionDecisionIndex = 2 + submissionApproval.afterInsertStatements.indexOf(submissionApproval.decisionStatement);
    decisionStatement = submissionApproval.decisionStatement;
  } else if (parsed.data.decision === "approved" && before.request_type === "update_horse" && before.horse_id != null) {
    const horseRow = await env.DB.prepare("SELECT * FROM horses WHERE id=? AND deleted_at IS NULL").bind(before.horse_id).first<HorseRow>();
    if (!horseRow) throw new HttpError(409, "horse_gone", "The horse referenced by this change request no longer exists");
    reviewedHorse = horseRow;
    expectedRowVersion = horseRow.row_version;
    // Master-Ai plan T12: a structured parent-correction submission applies
    // the asserted parents through the SAME guarded mutation service as a
    // direct edit — cycle guard, version CAS, reindex and decision are all in
    // one conditioned batch. Source/conflict evidence rides on the request.
    const storedCorrection = parseStoredParentCorrection(before.submission);
    if (storedCorrection) {
      // Re-validate against the CURRENT graph: the pedigree may have moved
      // while the correction sat in the queue.
      await assertValidParentAssignment(env.DB, before.horse_id, storedCorrection.father_id ?? undefined, storedCorrection.mother_id ?? undefined);
      const rawChanges: Record<string, unknown> = {};
      if (storedCorrection.father_id !== undefined) rawChanges.father_id = storedCorrection.father_id;
      if (storedCorrection.mother_id !== undefined) rawChanges.mother_id = storedCorrection.mother_id;
      plan = planHorseMutation(horseRow, rawChanges);
      appliedFields = Object.keys(rawChanges);
      const built = buildCanonicalHorseUpdateStatements(env.DB, {
        plan,
        horseId: before.horse_id,
        expectedRowVersion,
        mutationId,
        viaChangeRequestId: changeId,
        identifierTableReady: await identifierTableReady(env.DB),
      });
      updateStatements = [built.updateStatement, ...built.afterUpdateStatements];
      decisionStatement = env.DB.prepare(CHANGE_DECISION_AFTER_UPDATE_SQL)
        .bind(parsed.data.decision, auth.user.id, parsed.data.note ?? null, changeId, before.horse_id, mutationId);
    } else {
    const items = (Array.isArray(before.items) ? before.items : []) as ProposedChangeItem[];
    // Legacy rows may predate submit-time validation: re-validate before any
    // canonical apply. Invalid or duplicated items are a deterministic 422 and
    // the review is NOT recorded (the reviewer should reject instead).
    const issues = validateProposedChangeItems(items);
    if (issues.length) throw new HttpError(422, "invalid_change_items", "This request contains proposed values that cannot be applied", { issues });
    const applicable = items.filter((item) => CHANGE_REQUEST_APPLICABLE_FIELDS.has(item.field_name));
    appliedFields = applicable.map((item) => item.field_name);
    skippedFields = items.filter((item) => !CHANGE_REQUEST_APPLICABLE_FIELDS.has(item.field_name)).map((item) => item.field_name);
    if (applicable.length) {
      // T07: base-value drift blocks the approval until the reviewer has seen
      // the current values and explicitly reconfirmed. A post-commit warning
      // cannot undo an approval applied against stale content.
      const columns = applicable.map((item) => item.field_name).join(",");
      const current = await env.DB.prepare(`SELECT ${columns} FROM horses WHERE id=?`).bind(before.horse_id).first<Record<string, unknown>>();
      const staleDiffs = staleBaseFieldDifferences(applicable, current ?? {});
      if (staleDiffs.length && parsed.data.decision === "approved" && !parsed.data.confirm_stale) {
        throw new HttpError(409, "stale_base_values", "The record changed after this request was submitted. Review the current values, then approve with confirm_stale to reconfirm.", {
          stale_fields: staleDiffs,
          current_row_version: horseRow.row_version,
        });
      }
      staleFields = staleDiffs.map((diff) => diff.field);

      // Normalize through the shared per-field rules — the SAME parsed values
      // the direct-edit path would store (whitespace transforms applied).
      const rawChanges: Record<string, unknown> = {};
      for (const item of applicable) {
        rawChanges[item.field_name] = item.proposed_value === undefined ? null : item.proposed_value;
      }
      plan = planHorseMutation(horseRow, rawChanges);
      // Identifier proposals face the same live-duplicate guard as direct edits.
      await assertNoLiveHorseDuplicates(env.DB, before.horse_id, plan.normalizedChanges);

      const built = buildCanonicalHorseUpdateStatements(env.DB, {
        plan,
        horseId: before.horse_id,
        expectedRowVersion,
        mutationId,
        viaChangeRequestId: changeId,
        identifierTableReady: await identifierTableReady(env.DB),
      });
      updateStatements = [built.updateStatement, ...built.afterUpdateStatements];
      decisionStatement = env.DB.prepare(CHANGE_DECISION_AFTER_UPDATE_SQL)
        .bind(parsed.data.decision, auth.user.id, parsed.data.note ?? null, changeId, before.horse_id, mutationId);
    } else {
      decisionStatement = env.DB.prepare(CHANGE_DECISION_CAS_SQL)
        .bind(parsed.data.decision, auth.user.id, parsed.data.note ?? null, changeId);
    }
    } // T12: end of the item-list update path (parent corrections applied above)
  } else {
    decisionStatement = env.DB.prepare(CHANGE_DECISION_CAS_SQL)
      .bind(parsed.data.decision, auth.user.id, parsed.data.note ?? null, changeId);
  }
  // R146-D04: reviewed applies evaluate the SAME engine as direct edits —
  // the merged (before + proposed) record, active rules only. Zero active
  // rules = no-op.
  let reviewRuleSubject: import("../../registry/rulesEngine").RuleEvaluationSubject | null = null;
  let reviewRules: Awaited<ReturnType<typeof enforceRegistryRules>> | null = null;
  if (parsed.data.decision === "approved" && plan && before.horse_id != null) {
    const mergedForRules: Record<string, unknown> = { ...reviewedHorse };
    for (const [field, value] of Object.entries(plan.normalizedChanges)) {
      mergedForRules[field] = value;
      if ((field === "birth_date" || field === "death_date") && value != null && typeof value === "object" && "__typedDate" in (value as object)) {
        const marker = value as { date?: { value?: string; precision?: string; calendar?: string } | null; gregorianYear?: number | null };
        mergedForRules[`${field}_value`] = marker.date?.value ?? null;
        mergedForRules[`${field}_precision`] = marker.date?.precision ?? null;
        mergedForRules[`${field}_calendar`] = marker.date?.calendar ?? null;
        if (field === "birth_date" && marker.gregorianYear != null) mergedForRules.birth_year = marker.gregorianYear;
        if (field === "death_date" && marker.date != null) mergedForRules.is_dead = 1;
      }
    }
    reviewRuleSubject = await buildRuleSubject(env.DB, {
      requestContent: { id: changeId, revision: Number(before.content_revision), status: String(before.status) },
      subjectType: "horse_update", subjectRef: before.horse_id, includeEvidenceCounts: true,
      record: {
        horse_id: before.horse_id,
        name_latin: mergedForRules.name_latin == null ? null : String(mergedForRules.name_latin),
        breed_desc: mergedForRules.breed_desc == null ? null : String(mergedForRules.breed_desc),
        sex_desc: mergedForRules.sex_desc == null ? null : String(mergedForRules.sex_desc),
        register_no: mergedForRules.register_no == null ? null : String(mergedForRules.register_no),
        microchip_no: mergedForRules.microchip_no == null ? null : String(mergedForRules.microchip_no),
        birth_year: mergedForRules.birth_year == null ? null : Number(mergedForRules.birth_year),
        birth_date_value: mergedForRules.birth_date_value == null ? null : String(mergedForRules.birth_date_value),
        birth_date_precision: mergedForRules.birth_date_precision == null ? null : String(mergedForRules.birth_date_precision),
        birth_date_calendar: mergedForRules.birth_date_calendar == null ? null : String(mergedForRules.birth_date_calendar),
        death_date_value: mergedForRules.death_date_value == null ? null : String(mergedForRules.death_date_value),
        death_date_precision: mergedForRules.death_date_precision == null ? null : String(mergedForRules.death_date_precision),
        death_date_calendar: mergedForRules.death_date_calendar == null ? null : String(mergedForRules.death_date_calendar),
        is_dead: mergedForRules.is_dead == null ? null : Number(mergedForRules.is_dead),
        father_id: mergedForRules.father_id == null ? null : Number(mergedForRules.father_id),
        mother_id: mergedForRules.mother_id == null ? null : Number(mergedForRules.mother_id),
      },
    });
    reviewRules = await enforceRegistryRules(env.DB, reviewRuleSubject, parsed.data.rule_overrides);
  }
  const batchStatements = [
    canonicalMutationIntentStatement(env.DB, {
      id: mutationId, actorUserId: auth.user.id, action: `change_request.${parsed.data.decision}`, entityType: "change_request", entityId: changeId,
      before, requested: parsed.data, requestId: reqId, searchStatus: updateStatements.length || submissionApproval ? "pending" : "not_applicable",
    }),
    ...(submissionApproval ? [submissionApproval.horseInsertStatement, ...submissionApproval.afterInsertStatements] : []),
    ...(updateStatements.length ? [updateStatements[0]] : []),
    ...(submissionApproval ? [] : [decisionStatement]),
    ...(updateStatements.length ? updateStatements.slice(1) : []),
  ];
  const results = await (updateStatements.length || submissionApproval
    ? runGuardedHorseBatch(env.DB, batchStatements, plan?.effectiveIdentifierChanges ?? submissionApproval?.identifierChanges ?? {},
      { graphLock: Boolean(submissionApproval || plan?.parentageChanged),
        policy: submissionRuleSubject && submissionRules
          ? { subject: submissionRuleSubject, ...submissionRules, operationId: mutationId, actorUserId: auth.user.id }
          : reviewRuleSubject && reviewRules ? { subject: reviewRuleSubject, ...reviewRules, operationId: mutationId, actorUserId: auth.user.id } : undefined })
    : env.DB.batch(batchStatements));
  const updateIndex = 1;
  const decisionIndex = submissionApproval ? submissionDecisionIndex : (updateStatements.length ? 1 : 0) + 1;
  const updateResult = updateStatements.length ? results[updateIndex] : null;
  const review = results[decisionIndex];
  if (Number(review?.meta.changes ?? 0) !== 1) {
    try { await abortCanonicalMutation(env.DB, mutationId, "change-request review preconditions not met"); } catch {}
    // Distinguish a lost review race from a stale horse row: if the request is
    // still pending, our conditioned decision could not run because the
    // version-guarded horse update did not land.
    const currentStatus = await env.DB.prepare("SELECT status FROM change_requests WHERE id=?").bind(changeId).first<{ status: string }>();
    if (currentStatus && ["pending", "draft"].includes(currentStatus.status)) {
      throw new HttpError(409, "stale_horse_version", "The horse changed while this request was being reviewed; re-review against the current record");
    }
    throw new HttpError(409, "change_request_closed", "This change request has already been decided");
  }
  // T11: canonicalApplied + the horse id are reported only after reading the
  // created record back from the database — never from an intermediate value.
  let canonicalHorseId: number | null = null;
  let createdHorse: Record<string, unknown> | null = null;
  if (submissionApproval) {
    const horseRow = await env.DB.prepare(`SELECT ${ADMIN_HORSE_DETAIL_COLUMNS} FROM horses WHERE last_mutation_id=?`).bind(mutationId).first<Record<string, unknown>>();
    if (!horseRow) {
      // Defensive: the decision is conditioned on the horse landing, so this
      // means a data-integrity fault — surface it loudly, never silently.
      throw new HttpError(500, "canonical_horse_missing_after_approval", "The approval was recorded but the canonical horse could not be read back; investigate immediately");
    }
    canonicalHorseId = Number(horseRow.id);
    createdHorse = horseRow;
  }
  const after = await loadChangeRequest(env.DB, changeId);
  if (submissionApproval && canonicalHorseId != null) {
    await settleCanonicalHorseMutation(env.DB, mutationId, canonicalHorseId, auth.user.id, "submission.approve", null, createdHorse, reqId);
  } else {
    await settleWorkflowMutation(env.DB, mutationId, changeId, auth.user.id, `change_request.${parsed.data.decision}`, "change_request", before, after, reqId);
  }
  return json({
    request: after,
    workflowEffect: submissionApproval ? "canonical_horse_create" : updateStatements.length ? "canonical_horse_update" : "review_only",
    canonicalApplied: Boolean(submissionApproval) || (Boolean(updateStatements.length) && Number(updateResult?.meta.changes ?? 0) === 1),
    ...(submissionApproval && canonicalHorseId != null ? { canonical_horse_id: canonicalHorseId, horse: createdHorse } : {}),
    // T11: the ownership request type is labeled instead of silently approved
    // review-only — title transfers go through the claim + grant workflow.
    ...(before.request_type === "ownership" ? { ownership_note: "ownership_via_claims_workflow — title transfers use the claim + grant workflow, never a review-only approval" } : {}),
    appliedFields,
    skippedFields,
    staleFields,
    staleReconfirmed: Boolean(staleFields.length && parsed.data.confirm_stale),
  });
}

export function changeRequestSelectSql(): string {
  return `SELECT r.id,r.horse_id,r.request_type,r.status,r.summary,r.evidence_json,r.submitted_at,r.reviewed_at,r.review_note,r.created_at,r.updated_at,r.submission_json,r.review_outcome,r.canonical_horse_id,r.submitted_by_user_id,r.content_revision,
    h.name_latin,h.name_native,u.display_name AS submitted_by,
    COALESCE((SELECT json_group_array(json_object('id',i.id,'field_name',i.field_name,'old_value',json(i.old_value_json),'proposed_value',json(i.proposed_value_json)))
      FROM change_request_items i WHERE i.change_request_id=r.id),'[]') AS items_json
    FROM change_requests r
    LEFT JOIN horses h ON h.id=r.horse_id
    LEFT JOIN users u ON u.id=r.submitted_by_user_id`;
}

export async function loadChangeRequest(db: D1Database, id: string): Promise<any | null> {
  const row = await db.prepare(`${changeRequestSelectSql()} WHERE r.id=? LIMIT 1`).bind(id).first<Record<string, unknown>>();
  return row ? normalizeChangeRequestRow(row) : null;
}

export function normalizeChangeRequestRow(row: Record<string, unknown>): Record<string, unknown> {
  const { evidence_json, items_json, submission_json, review_outcome, ...rest } = row;
  const status = String(rest.status ?? "");
  return {
    ...rest,
    evidence: parseJsonObject(evidence_json),
    items: parseJsonArray(items_json),
    submission: parseJsonObject(submission_json),
    review_outcome: (review_outcome as string | null) ?? null,
    review_status: submissionReviewStatus({ status, review_outcome: (review_outcome as string | null) ?? null }),
  };
}


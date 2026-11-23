/** R117-20: claims + access-grant route handlers, extracted verbatim from
 * src/api/routes.ts (dispatch lines unchanged there; endpoint order and
 * middleware order preserved). Includes the claim zod schemas + decision SQL.
 */
import { z } from "zod";
import { HttpError, error, json, readJson, requestId } from "../http";
import { abortCanonicalMutation, canonicalMutationIntentStatement } from "../../audit/mutationJournal";
import { assertJsonEvidenceComplexity } from "../../security/jsonComplexity";
import { claimApprovalGrantStatement, horseActionsForViewer, revokeHorseGrant, revokeOrganizationMembership } from "../../access/horseAccess";
import { getAuth } from "../../auth/session";
import { register } from "../modules/authExt";
import { requireAuth, requireCsrf } from "../../auth/guards";
import { settleWorkflowMutation, audit, parseJsonObject } from "./registryShared";

const ClaimCreateSchema = z.object({
  horse_id: z.number().int().positive(),
  person_id: z.number().int().positive().nullable().optional(),
  evidence: z.record(z.string(), z.unknown()).optional(),
});
const ClaimReviewSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  note: z.string().trim().max(2000).nullable().optional(),
});

const CLAIM_DECISION_SQL = `UPDATE horse_claims SET status=?,reviewed_by_user_id=?,review_note=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'`;
const CLAIM_OWNER_LINK_SQL = `INSERT OR IGNORE INTO horse_people(horse_id,person_id,role,is_current,created_at)
  SELECT ?,?,'owner',1,CURRENT_TIMESTAMP
  WHERE EXISTS(SELECT 1 FROM horse_claims WHERE id=? AND status='approved' AND reviewed_by_user_id=?)`;
const CLAIM_REINDEX_SQL = `INSERT OR IGNORE INTO horse_search_reindex_queue(horse_id,reason)
  SELECT ?,'claim_approved_owner'
  WHERE EXISTS(SELECT 1 FROM horse_claims WHERE id=? AND status='approved' AND reviewed_by_user_id=?)`;

export async function createClaim(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "owner");
  requireCsrf(request, auth);
  const parsed = ClaimCreateSchema.safeParse(await readJson<unknown>(request, 64 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_claim", "Claim data failed validation", parsed.error.flatten());
  if (parsed.data.evidence) assertJsonEvidenceComplexity(parsed.data.evidence, "ownership-claim evidence");
  const horse = await env.DB.prepare("SELECT id FROM horses WHERE id=? AND deleted_at IS NULL").bind(parsed.data.horse_id).first();
  if (!horse) return error(404, "not_found", "Horse not found");
  // R59: a claim may name the person record it represents; approval links that
  // person to the horse canonically in horse_people (review fact-check #9).
  let personId: number | null = null;
  if (parsed.data.person_id != null) {
    const person = await env.DB.prepare("SELECT id FROM people WHERE id=? AND deleted_at IS NULL").bind(parsed.data.person_id).first<{ id: number }>();
    if (!person) throw new HttpError(404, "person_not_found", "The person referenced by this claim does not exist");
    personId = person.id;
  }
  const existing = await env.DB.prepare("SELECT id,status FROM horse_claims WHERE horse_id=? AND claimant_user_id=?").bind(parsed.data.horse_id, auth.user.id).first<{id:string;status:string}>();
  if (existing && ["pending", "approved"].includes(existing.status)) throw new HttpError(409, "claim_exists", "You already have an active claim for this horse");
  const id = crypto.randomUUID();
  const mutationId = crypto.randomUUID();
  const reqId = requestId(request);
  const intent = canonicalMutationIntentStatement(env.DB, {
    id: mutationId, actorUserId: auth.user.id, action: "claim.create", entityType: "horse_claim", entityId: id,
    before: existing ?? null, requested: parsed.data, requestId: reqId, searchStatus: "not_applicable",
  });
  if (existing) {
    const [, write] = await env.DB.batch([
      intent,
      env.DB.prepare("UPDATE horse_claims SET id=?,status='pending',evidence_json=?,person_id=?,reviewed_by_user_id=NULL,review_note=NULL,created_at=CURRENT_TIMESTAMP,reviewed_at=NULL WHERE horse_id=? AND claimant_user_id=? AND status IN ('rejected','revoked')")
        .bind(id, parsed.data.evidence ? JSON.stringify(parsed.data.evidence) : null, personId, parsed.data.horse_id, auth.user.id),
    ]);
    if (Number(write?.meta.changes ?? 0) !== 1) {
      try { await abortCanonicalMutation(env.DB, mutationId, "claim resubmission state changed concurrently"); } catch {}
      throw new HttpError(409, "claim_exists", "Claim state changed while resubmitting; reload before retrying");
    }
  } else {
    await env.DB.batch([
      intent,
      env.DB.prepare("INSERT INTO horse_claims(id,horse_id,claimant_user_id,status,evidence_json,person_id) VALUES(?,?,?,'pending',?,?)")
        .bind(id, parsed.data.horse_id, auth.user.id, parsed.data.evidence ? JSON.stringify(parsed.data.evidence) : null, personId),
    ]);
  }
  const after = await env.DB.prepare("SELECT id,horse_id,status,created_at FROM horse_claims WHERE id=?").bind(id).first();
  await settleWorkflowMutation(env.DB, mutationId, id, auth.user.id, "claim.create", "horse_claim", existing ?? null, after, reqId);
  return json({ claim: after, workflowEffect: "review_only", canonicalApplied: false }, { status: 201 });
}

export async function myClaims(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "owner");
  const rows = await env.DB.prepare(`
    SELECT c.id,c.horse_id,c.status,c.review_note,c.created_at,c.reviewed_at,h.name_latin,h.name_native
    FROM horse_claims c JOIN horses h ON h.id=c.horse_id
    WHERE c.claimant_user_id=? ORDER BY c.created_at DESC LIMIT 100
  `).bind(auth.user.id).all();
  return json({ claims: rows.results });
}

export async function adminClaims(request: Request, env: Env): Promise<Response> {
  await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "editor");
  const rows = await env.DB.prepare(`
    SELECT c.id,c.horse_id,c.person_id,c.evidence_json,c.status,c.created_at,c.reviewed_at,c.review_note,h.name_latin,h.name_native,u.display_name AS claimant
    FROM horse_claims c JOIN horses h ON h.id=c.horse_id JOIN users u ON u.id=c.claimant_user_id
    ORDER BY CASE c.status WHEN 'pending' THEN 0 ELSE 1 END,c.created_at DESC LIMIT 100
  `).all<Record<string, unknown>>();
  return json({ claims: rows.results.map(({ evidence_json, ...row }) => ({ ...row, evidence: parseJsonObject(evidence_json) })) });
}

// ---------------------------------------------------------------------------
// Master-Ai plan T10: horse-scoped access grants.

/** GET /api/horses/:id/actions — backend-computed per-horse actions for the caller. */
export async function horseActionsEndpoint(request: Request, env: Env, horseId: number): Promise<Response> {
  const auth = await getAuth(env.DB, request, env.SESSION_COOKIE_NAME);
  if (!auth) {
    return json({ horse_id: horseId, is_staff: false, relationships: [], actions: [], grants: [] });
  }
  const snapshot = await horseActionsForViewer(env.DB, { userId: auth.user.id, role: auth.user.role }, horseId, new Date());
  return json(snapshot);
}

/** GET /api/grants/mine — the caller's active grants (owner self-service dashboard). */
export async function myGrants(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  const now = new Date().toISOString();
  // P02: myGrants now applies the SAME effective-now policy as actual
  // authorization (HORSE_GRANT_LOOKUP_SQL): not revoked, started (valid_from),
  // not expired (valid_until), and the horse still exists (deleted horses
  // hide their grants) — so the account page can never advertise a grant the
  // API would not honor. Timestamps normalize via datetime() like the lookup.
  const rows = await env.DB.prepare(`
    SELECT g.id,g.horse_id,g.relationship,g.actions,g.basis,g.basis_ref,g.valid_from,g.valid_until,
           h.name_latin,h.name_native
    FROM horse_access_grants g JOIN horses h ON h.id=g.horse_id
    WHERE g.grantee_user_id=? AND g.revoked_at IS NULL
      AND (g.valid_from IS NULL OR datetime(g.valid_from) <= datetime(?))
      AND (g.valid_until IS NULL OR datetime(g.valid_until) > datetime(?))
      AND h.deleted_at IS NULL
    ORDER BY g.created_at DESC LIMIT 200
  `).bind(auth.user.id, now, now).all();
  return json({ grants: rows.results });
}

/** GET /api/admin/grants?horse_id=N — grant register for staff (audit + support). */
export async function adminGrants(request: Request, env: Env, url: URL): Promise<Response> {
  await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "editor");
  const horseIdParam = url.searchParams.get("horse_id");
  const horseId = horseIdParam && /^\d+$/.test(horseIdParam) ? Number(horseIdParam) : null;
  const rows = await env.DB.prepare(`
    SELECT g.id,g.horse_id,g.grantee_user_id,g.grantee_organization_id,g.relationship,g.actions,g.basis,g.basis_ref,
           g.valid_from,g.valid_until,g.revoked_at,g.revoked_by_user_id,g.revoke_reason,
           h.name_latin,h.name_native
    FROM horse_access_grants g JOIN horses h ON h.id=g.horse_id
    ${horseId ? "WHERE g.horse_id=?" : ""}
    ORDER BY g.created_at DESC LIMIT 200
  `).bind(...(horseId ? [horseId] : [])).all();
  return json({ grants: rows.results });
}

const GrantRevokeSchema = z.object({ reason: z.string().min(3).max(500) });

/** POST /api/admin/grants/:id/revoke — immediate, audited, reason-required. */
export async function adminRevokeGrant(request: Request, env: Env, grantId: string): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "admin");
  requireCsrf(request, auth);
  const parsed = GrantRevokeSchema.safeParse(await readJson<unknown>(request, 8 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_reason", "A revocation reason is required", parsed.error.flatten());
  const result = await revokeHorseGrant(env.DB, { grantId, byUserId: auth.user.id, reason: parsed.data.reason });
  return json(result);
}

/** POST /api/admin/org-memberships/:id/revoke — stops every org-mediated grant path immediately. */
export async function adminRevokeOrgMembership(request: Request, env: Env, membershipId: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "admin");
  requireCsrf(request, auth);
  const parsed = GrantRevokeSchema.safeParse(await readJson<unknown>(request, 8 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_reason", "A revocation reason is required", parsed.error.flatten());
  const result = await revokeOrganizationMembership(env.DB, { membershipId, byUserId: auth.user.id, reason: parsed.data.reason });
  return json(result);
}


export async function reviewClaim(request: Request, env: Env, claimId: string): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "admin");
  requireCsrf(request, auth);
  const parsed = ClaimReviewSchema.safeParse(await readJson<unknown>(request, 16 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_review", "Review data failed validation", parsed.error.flatten());
  const before = await env.DB.prepare("SELECT * FROM horse_claims WHERE id=?").bind(claimId).first<{ status: string } & Record<string, unknown>>();
  if (!before) return error(404, "not_found", "Claim not found");
  if (before.status !== "pending") throw new HttpError(409, "claim_closed", "This claim has already been decided");
  const mutationId = crypto.randomUUID();
  const reqId = requestId(request);
  // R59: approving a claim with a person record links that person to the horse
  // as a current owner. R74 (REV-01): the link and the reindex queue entry are
  // conditioned on THIS review's decision having landed in the same batch, so
  // a losing concurrent reviewer (or a rejected decision) can never create a
  // canonical owner link.
  const claimBefore = await env.DB.prepare("SELECT horse_id, person_id, claimant_user_id FROM horse_claims WHERE id=?").bind(claimId).first<{ horse_id: number; person_id: number | null; claimant_user_id: string }>();
  const applyOwnerLink =
    parsed.data.decision === "approved" && claimBefore?.person_id != null
      ? env.DB.prepare(CLAIM_OWNER_LINK_SQL)
          .bind(claimBefore.horse_id, claimBefore.person_id, claimId, auth.user.id)
      : null;
  const queueReindex =
    parsed.data.decision === "approved" && claimBefore
      ? env.DB.prepare(CLAIM_REINDEX_SQL).bind(claimBefore.horse_id, claimId, auth.user.id)
      : null;
  // Master-Ai plan T10: an approved evidence-reviewed claim maps to an EXPLICIT
  // horse-scoped grant (owner mandate, claim provenance) — the permission to
  // act is the grant, never the account role. Same R74 REV-01 batch discipline
  // as the owner link: conditioned on THIS decision having landed.
  const mintGrant =
    parsed.data.decision === "approved" && claimBefore
      ? claimApprovalGrantStatement(env.DB, {
          grantId: crypto.randomUUID(),
          horseId: claimBefore.horse_id,
          claimantUserId: claimBefore.claimant_user_id,
          claimId,
          reviewerUserId: auth.user.id,
        })
      : null;
  const [, review] = await env.DB.batch([
    canonicalMutationIntentStatement(env.DB, {
      id: mutationId, actorUserId: auth.user.id, action: `claim.${parsed.data.decision}`, entityType: "horse_claim", entityId: claimId,
      before, requested: parsed.data, requestId: reqId, searchStatus: "not_applicable",
    }),
    env.DB.prepare(CLAIM_DECISION_SQL)
      .bind(parsed.data.decision, auth.user.id, parsed.data.note ?? null, claimId),
    ...(applyOwnerLink ? [applyOwnerLink] : []),
    ...(queueReindex ? [queueReindex] : []),
    ...(mintGrant ? [mintGrant] : []),
  ]);
  if (Number(review?.meta.changes ?? 0) !== 1) {
    try { await abortCanonicalMutation(env.DB, mutationId, "claim review state changed concurrently"); } catch {}
    throw new HttpError(409, "claim_closed", "This claim has already been decided");
  }
  const after = await env.DB.prepare("SELECT * FROM horse_claims WHERE id=?").bind(claimId).first();
  await settleWorkflowMutation(env.DB, mutationId, claimId, auth.user.id, `claim.${parsed.data.decision}`, "horse_claim", before, after, reqId);
  // canonicalApplied reports the ACTUAL committed effect, not the intent.
  const ownerLinkLive = applyOwnerLink && claimBefore
    ? await env.DB.prepare("SELECT 1 FROM horse_people WHERE horse_id=? AND person_id=? AND role='owner' AND is_current=1")
        .bind(claimBefore.horse_id, claimBefore.person_id).first()
    : null;
  // Master-Ai T10: report the minted grant honestly too — approval confers the
  // PERMISSION (grant) even when the claim carried no person record (no legal
  // owner link), and the two are deliberately separate facts.
  const grantLive = mintGrant && claimBefore
    ? await env.DB.prepare("SELECT 1 FROM horse_access_grants WHERE horse_id=? AND grantee_user_id=? AND basis_ref=? AND revoked_at IS NULL")
        .bind(claimBefore.horse_id, claimBefore.claimant_user_id, claimId).first()
    : null;
  return json({
    claim: after,
    workflowEffect: parsed.data.decision === "approved" ? "canonical_owner_link" : "review_only",
    canonicalApplied: Boolean(ownerLinkLive),
    accessGranted: Boolean(grantLive),
  });
}


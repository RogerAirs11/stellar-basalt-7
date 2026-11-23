/**
 * R98-N08 — credential evidence and expiry workflow HTTP surface.
 *
 * Reviewer queue (never the claimant's own evidence), holder-submitted
 * renewal evidence with reviewer application, pre-expiry reminders with
 * dedup, and the honest public badge (what was checked, by whom, against
 * which evidence, at what time). The current-qualification filter is the
 * ONE predicate: only within_recorded_dates counts.
 */
import { z } from "zod";
import { HttpError, json } from "../http";
import { requireAuth, requireCsrf, requirePermission } from "../../auth/guards";
import type { D1Database } from "@cloudflare/workers-types";

type Env = { DB: D1Database; SESSION_COOKIE_NAME: string };
import {
  credentialReviewQueue, submitCredentialRenewal, reviewCredentialRenewal,
  scanExpiryReminders, credentialBadge, CREDENTIAL_WORKFLOW_POLICY_NOTE,
  type CredentialSubject,
} from "../../directory/credentialWorkflows";

function parseSubject(value: string): CredentialSubject {
  if (value === "person" || value === "organization") return value;
  throw new HttpError(400, "invalid_subject", "Subject must be 'person' or 'organization'");
}

/** GET /api/admin/directory/credentials/queue — the platform evidence queue. */
export async function getCredentialReviewQueue(request: Request, env: Env): Promise<Response> {
  const auth = await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "claim.review");
  const queue = await credentialReviewQueue(env.DB, auth.user.id, 100);
  return json({ queue, policy: CREDENTIAL_WORKFLOW_POLICY_NOTE }, { headers: { "Cache-Control": "private, no-store" } });
}

/** GET /api/directory/credentials/:subject/:id/badge — the honest badge. */
export async function getCredentialBadge(_request: Request, env: Env, subject: string, credentialId: number): Promise<Response> {
  const badge = await credentialBadge(env.DB, parseSubject(subject), credentialId);
  if (!badge) throw new HttpError(404, "not_found", "Credential not found");
  return json(badge);
}

const RenewalSchema = z.object({
  evidence_note: z.string().trim().min(10).max(1000),
  evidence_media_id: z.string().trim().max(64).nullable().optional(),
  proposed_issued_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD required").nullable().optional(),
  proposed_expires_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD required").nullable().optional(),
});

/** POST /api/directory/credentials/:subject/:id/renewal — holder submits renewal evidence. */
export async function submitRenewal(request: Request, env: Env, subject: string, credentialId: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  const parsed = RenewalSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw new HttpError(400, "invalid_renewal", "Renewal failed validation", parsed.error.flatten());
  const id = await submitCredentialRenewal(env.DB, {
    actorId: auth.user.id, subject: parseSubject(subject), credentialId,
    evidenceNote: parsed.data.evidence_note, evidenceId: parsed.data.evidence_media_id ?? null,
    proposedIssuedAt: parsed.data.proposed_issued_at ?? null, proposedExpiresAt: parsed.data.proposed_expires_at ?? null,
  });
  if (!id) throw new HttpError(409, "renewal_conflict", "You must represent the credential holder; the credential must be unrevoked; only one pending renewal per credential");
  const renewal = await env.DB.prepare("SELECT id,subject_type,subject_key,status,proposed_issued_at,proposed_expires_at,created_at FROM credential_renewal_submissions WHERE id=?").bind(id).first();
  return json({ renewal, note: "Renewal evidence is reviewed by the platform; approval applies the proposed dates, rejection keeps the current recorded dates." }, { status: 201 });
}

const RenewalReviewSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  review_note: z.string().trim().min(3).max(500),
  expected_version: z.number().int().positive().optional(),
});

/** POST /api/admin/directory/credentials/renewals/:id/review — reviewer applies or rejects. */
export async function reviewRenewal(request: Request, env: Env, renewalId: number): Promise<Response> {
  const auth = await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "claim.review");
  requireCsrf(request, auth);
  const parsed = RenewalReviewSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw new HttpError(400, "invalid_review", "Review failed validation", parsed.error.flatten());
  const renewal = await env.DB.prepare("SELECT id,row_version,status,submitted_by_user_id FROM credential_renewal_submissions WHERE id=?").bind(renewalId)
    .first<{ id: number; row_version: number; status: string; submitted_by_user_id: string }>();
  if (!renewal) throw new HttpError(404, "not_found", "Renewal submission not found");
  if (renewal.submitted_by_user_id === auth.user.id)
    throw new HttpError(403, "self_review_forbidden", "A claimant cannot review their own evidence");
  const outcome = await reviewCredentialRenewal(env.DB, {
    actorId: auth.user.id, renewalId, expectedVersion: parsed.data.expected_version ?? renewal.row_version,
    decision: parsed.data.decision, note: parsed.data.review_note,
  });
  if (!outcome.applied) throw new HttpError(409, "renewal_conflict", "The renewal changed before the review applied; re-read and retry");
  const after = await env.DB.prepare("SELECT id,subject_type,subject_key,status,reviewed_at,review_note,row_version FROM credential_renewal_submissions WHERE id=?").bind(renewalId).first();
  return json({ renewal: after });
}

/** POST /api/admin/directory/credentials/expiry-scan — record due reminders (idempotent per window). */
export async function runExpiryScan(request: Request, env: Env): Promise<Response> {
  const auth = await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "claim.review");
  requireCsrf(request, auth);
  const fresh = await scanExpiryReminders(env.DB);
  return json({ recorded: fresh.length, reminders: fresh, policy: "Reminders are notifications, never qualification changes. Revoked credentials and credentials without a recorded expiry are never reminded." });
}

/** GET /api/directory/credentials/expiring/mine — the caller's expiring credentials and reminders. */
export async function myExpiringCredentials(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  const personRows = await env.DB.prepare(`
    SELECT 'person' AS subject_type, c.id AS credential_id, c.role, c.issuer_name, c.identifier, c.expires_at, c.revoked_at
    FROM person_credentials c JOIN people p ON p.id=c.person_id
    WHERE p.deleted_at IS NULL AND c.revoked_at IS NULL AND c.expires_at IS NOT NULL
      AND EXISTS(SELECT 1 FROM user_person_links l WHERE l.person_id=p.id AND l.user_id=? AND l.status='verified')
      AND date(c.expires_at) BETWEEN date('now') AND date('now','+60 days')
    ORDER BY c.expires_at ASC LIMIT 50`).bind(auth.user.id).all<Record<string, unknown>>();
  const orgRows = await env.DB.prepare(`
    SELECT 'organization' AS subject_type, c.id AS credential_id, c.role, c.issuer_name, c.identifier, c.expires_at, c.revoked_at
    FROM organization_credentials c JOIN organizations o ON o.id=c.organization_id
    JOIN organization_memberships m ON m.organization_id=o.id
    WHERE o.status='active' AND c.revoked_at IS NULL AND c.expires_at IS NOT NULL AND m.user_id=? AND m.status='active' AND m.revoked_at IS NULL
      AND (m.valid_until IS NULL OR datetime(m.valid_until)>datetime('now'))
      AND date(c.expires_at) BETWEEN date('now') AND date('now','+60 days')
    ORDER BY c.expires_at ASC LIMIT 50`).bind(auth.user.id).all<Record<string, unknown>>();
  const reminders = await env.DB.prepare(`SELECT subject_type,person_credential_id,organization_credential_id,days_before_expiry,reminded_at
    FROM credential_expiry_reminders WHERE holder_user_id=? ORDER BY reminded_at DESC LIMIT 50`).bind(auth.user.id).all<Record<string, unknown>>();
  return json({
    expiring: [...(personRows.results ?? []), ...(orgRows.results ?? [])],
    reminders: reminders.results ?? [],
    policy: CREDENTIAL_WORKFLOW_POLICY_NOTE,
  }, { headers: { "Cache-Control": "private, no-store" } });
}

async function readJsonBody(request: Request): Promise<unknown> {
  const { readJson } = await import("../http");
  return readJson<unknown>(request, 8 * 1024);
}

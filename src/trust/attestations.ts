import { grantMembership, revokeMembership, normalizeTrustExpiry } from "./membershipCommands";
import { issueStoredAttestation, revokeStoredAttestation, publicHorseAttestations, activeAttestationCount, effectiveAttestationStatus, PUBLIC_ATTESTATION_TARGET_SQL } from "./attestationStore";
import {
  SCOPE_RECORD_KINDS, SCOPE_ACTIONS, grantIssuerScope, transitionIssuerScope, transitionIssuerStatus,
  trustOperatorQueue, type ScopeRecordKind, type ScopeAction,
} from "./scopes";
import {
  readCurrentRowsForVerification, compareRowDigests,
  parseRowVersions, snapshotBytesMatchDigest,
} from "./snapshotSerializer";
import { z } from "zod";
import { HttpError, json, readJson } from "../api/http";
import { requireCsrf, requirePermission } from "../auth/guards";
import { capabilitiesForRole } from "../auth/capabilities";
import { canAttest, isSelfReview, membershipValidity, VERIFICATION_LEVELS, type MembershipRow } from "./policy";
import type { D1Database } from "@cloudflare/workers-types";
import { geneticActionPredicate } from "../access/geneticAccess";
import { privateEvidenceSessionPredicate } from "../access/privateEvidence";

// Master-Ai plan T05: issuer attestations. Platform editorial review and
// external issuer attestation are separate concepts with separate machinery:
// an issuer attestation requires a valid membership in THAT issuer, is bound
// to a concrete record (and optionally specific fields), must reference
// evidence the attester did not produce themselves, and every lifecycle
// change is recorded in an append-only event log with actor and reason.

export const ATTESTABLE_RECORD_KINDS = ["genetic_test", "media", "competition_result", "horse_identity"] as const;
export type AttestableRecordKind = (typeof ATTESTABLE_RECORD_KINDS)[number];

const TrustExpirySchema = z.string().refine((value) => {
  try { normalizeTrustExpiry(value); return true; } catch { return false; }
}, "A real future date or timezone-qualified instant is required");

export const IssuerSchema = z.object({
  slug: z.string().trim().min(2).max(60).regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().trim().min(2).max(200),
  name_native: z.string().trim().max(200).nullable().optional(),
  kind: z.enum(["organization", "laboratory", "federation", "clinic", "government"]).default("organization"),
  // R98-N04: documentary evidence establishing the issuer's authority is
  // recorded at registration (a federation title in a profile, an editorial
  // role or a paid plan never establishes delegated authority). The creating
  // manager attests they reviewed this evidence.
  registration_evidence: z.string().trim().min(10).max(4000),
});

export const MembershipGrantSchema = z.object({
  user_id: z.string().min(1).max(64),
  role: z.enum(["owner", "attester"]).default("attester"),
  valid_until: TrustExpirySchema.nullable().optional(),
});

export const AttestationCreateSchema = z.object({
  record_kind: z.enum(ATTESTABLE_RECORD_KINDS),
  record_id: z.string().trim().min(1).max(64),
  horse_id: z.number().int().positive().nullable().optional(),
  field_scope: z.array(z.string().trim().min(1).max(60)).max(20).nullable().optional(),
  statement: z.string().trim().max(2000).nullable().optional(),
  evidence_media_id: z.string().trim().max(64).nullable().optional(),
  // R98-N05: accepted for backward compatibility and DELIBERATELY IGNORED —
  // the stored source_version is always server-derived from the immutable
  // snapshot. A caller can never attach a made-up version to any record.
  source_version: z.string().trim().max(120).nullable().optional(),
  expires_at: TrustExpirySchema.nullable().optional(),
});

export const AttestationRevokeSchema = z.object({
  reason: z.string().trim().min(3).max(1000),
});

export const AttestationSupersedeSchema = AttestationRevokeSchema.extend({
  replacement: AttestationCreateSchema,
});

function hasPlatformManage(role: string): boolean {
  return capabilitiesForRole(role as never).includes("content.manage");
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// Issuers.

export async function createIssuer(request: Request, env: { DB: D1Database; SESSION_COOKIE_NAME: string }): Promise<Response> {
  const auth = await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "content.manage");
  requireCsrf(request, auth);
  const parsed = IssuerSchema.safeParse(await readJson<unknown>(request, 16 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_issuer", "Issuer failed validation", parsed.error.flatten());
  const d = parsed.data;
  const existing = await env.DB.prepare("SELECT id FROM issuers WHERE slug=?").bind(d.slug).first();
  if (existing) throw new HttpError(409, "duplicate_issuer_slug", "An issuer with this slug already exists");
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO issuers(id,slug,name,name_native,kind,status,created_by_user_id,registration_evidence,registration_reviewed_at,registration_reviewed_by_user_id) VALUES(?,?,?,?,?,'active',?,?,?,?)",
  ).bind(id, d.slug, d.name, d.name_native ?? null, d.kind, auth.user.id, d.registration_evidence, new Date().toISOString(), auth.user.id).run();
  return json({ issuer: { id, slug: d.slug, name: d.name, kind: d.kind, status: "active", registration_evidence_recorded: true } }, { status: 201 });
}

export async function listIssuers(db: D1Database): Promise<Response> {
  const rows = await db.prepare(
    "SELECT id,slug,name,name_native,kind,status,created_at FROM issuers WHERE status='active' ORDER BY name",
  ).all();
  return json({ issuers: rows.results ?? [] });
}

// ---------------------------------------------------------------------------
// Memberships.

export async function grantIssuerMembership(
  request: Request,
  env: { DB: D1Database; SESSION_COOKIE_NAME: string },
  issuerId: string,
): Promise<Response> {
  const auth = await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "horse.read");
  requireCsrf(request, auth);
  const issuer = await env.DB.prepare("SELECT id,status FROM issuers WHERE id=?").bind(issuerId).first<{ id: string; status: string }>();
  if (!issuer) throw new HttpError(404, "not_found", "Issuer not found");
  // Only platform content managers or an ACTIVE issuer OWNER can grant memberships.
  const callerMembership = await env.DB
    .prepare("SELECT * FROM issuer_memberships WHERE issuer_id=? AND user_id=? ORDER BY created_at DESC LIMIT 1")
    .bind(issuerId, auth.user.id)
    .first<MembershipRow & { id: string }>();
  const isIssuerOwner = callerMembership?.role === "owner" && membershipValidity(callerMembership) === "active";
  if (!hasPlatformManage(auth.user.role) && !isIssuerOwner) {
    throw new HttpError(403, "forbidden", "Only platform content managers or the issuer's owner can grant memberships");
  }
  const parsed = MembershipGrantSchema.safeParse(await readJson<unknown>(request, 8 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_membership", "Membership failed validation", parsed.error.flatten());
  const d = parsed.data;
  const user = await env.DB.prepare("SELECT id FROM users WHERE id=? AND is_active=1").bind(d.user_id).first();
  if (!user) throw new HttpError(404, "not_found", "User not found");
  const membershipId = await grantMembership(env.DB, { actorId: auth.user.id, issuerId,
    targetId: d.user_id, role: d.role, validUntil: d.valid_until });
  if (!membershipId) throw new HttpError(409, "membership_conflict", "Issuer, account or membership authority changed");
  return json({ granted: true, membership_id: membershipId, issuer_id: issuerId, user_id: d.user_id, role: d.role }, { status: 201 });
}

export async function revokeIssuerMembership(
  request: Request,
  env: { DB: D1Database; SESSION_COOKIE_NAME: string },
  membershipId: string,
): Promise<Response> {
  const auth = await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "horse.read");
  requireCsrf(request, auth);
  const membership = await env.DB
    .prepare("SELECT id,issuer_id,user_id,role,status FROM issuer_memberships WHERE id=?")
    .bind(membershipId)
    .first<{ id: string; issuer_id: string; user_id: string; role: string; status: string }>();
  if (!membership) throw new HttpError(404, "not_found", "Membership not found");
  const callerMembership = await env.DB
    .prepare("SELECT * FROM issuer_memberships WHERE issuer_id=? AND user_id=? ORDER BY created_at DESC LIMIT 1")
    .bind(membership.issuer_id, auth.user.id)
    .first<MembershipRow & { id: string }>();
  const isIssuerOwner = callerMembership?.role === "owner" && membershipValidity(callerMembership) === "active";
  if (!hasPlatformManage(auth.user.role) && !isIssuerOwner) {
    throw new HttpError(403, "forbidden", "Only platform content managers or the issuer's owner can revoke memberships");
  }
  const parsed = AttestationRevokeSchema.safeParse(await readJson<unknown>(request, 8 * 1024));
  if (!parsed.success) throw new HttpError(400, "reason_required", "A reason is required to revoke a membership", parsed.error.flatten());
  const applied = await revokeMembership(env.DB, { actorId: auth.user.id, membershipId, reason: parsed.data.reason });
  if (!applied) throw new HttpError(409, "membership_conflict", "Membership was already changed or authority is no longer current");
  return json({ revoked: membershipId, reason: parsed.data.reason });
}

// ---------------------------------------------------------------------------
// Attestation core.

interface RecordProbe {
  horse_id: number | null;
  uploader_user_id: string | null;
}

async function probeRecord(db: D1Database, kind: AttestableRecordKind, recordId: string): Promise<RecordProbe | null> {
  switch (kind) {
    case "genetic_test": {
      const row = await db.prepare("SELECT id,horse_id,created_by_user_id FROM genetic_tests WHERE id=?").bind(Number(recordId))
        .first<{ id: number; horse_id: number; created_by_user_id: string | null }>();
      return row ? { horse_id: row.horse_id, uploader_user_id: row.created_by_user_id } : null;
    }
    case "media": {
      const row = await db.prepare("SELECT id,horse_id,uploaded_by_user_id FROM horse_media WHERE id=?").bind(recordId).first<{ id: string; horse_id: number; uploaded_by_user_id: string | null }>();
      return row ? { horse_id: row.horse_id, uploader_user_id: row.uploaded_by_user_id } : null;
    }
    case "competition_result": {
      const row = await db.prepare("SELECT id,horse_id FROM competition_results WHERE id=?").bind(Number(recordId)).first<{ id: number; horse_id: number }>();
      return row ? { horse_id: row.horse_id, uploader_user_id: null } : null;
    }
    case "horse_identity": {
      const row = await db.prepare("SELECT id FROM horses WHERE id=? AND deleted_at IS NULL").bind(Number(recordId)).first<{ id: number }>();
      return row ? { horse_id: row.id, uploader_user_id: null } : null;
    }
  }
}

export interface IssueAttestationInput {
  record_kind: AttestableRecordKind;
  record_id: string;
  horse_id?: number | null;
  field_scope?: string[] | null;
  statement?: string | null;
  evidence_media_id?: string | null;
  source_version?: string | null;
  expires_at?: string | null;
}

export interface IssuedAttestation {
  id: string;
  issuer_id: string;
  horse_id: number | null;
  record_kind: AttestableRecordKind;
  record_id: string;
  field_scope: string[] | null;
  statement: string | null;
  evidence_media_id: string | null;
  source_version: string | null;
  issued_at: string;
  expires_at: string | null;
  status: "active";
}

/**
 * Core issuance path, shared by the HTTP handler and supersession. Authorization
 * comes from issuer MEMBERSHIP state only — a platform role by itself can
 * never mint an attestation (plan T05 step 4).
 */
export async function issueAttestation(
  db: D1Database,
  actor: { userId: string },
  issuerId: string,
  input: IssueAttestationInput,
): Promise<IssuedAttestation> {
  const issuer = await db.prepare("SELECT id,status FROM issuers WHERE id=?").bind(issuerId).first<{ id: string; status: string }>();
  if (!issuer) throw new HttpError(404, "not_found", "Issuer not found");
  const membership = await db
    .prepare("SELECT * FROM issuer_memberships WHERE issuer_id=? AND user_id=? ORDER BY created_at DESC LIMIT 1")
    .bind(issuerId, actor.userId)
    .first<MembershipRow>();
  const check = canAttest({ issuerId, issuerStatus: issuer.status, membership });
  if (!check.ok) {
    throw new HttpError(403, check.reason ?? "forbidden", "You cannot attest under this issuer with the current membership");
  }
  // R98-N04: fail fast with a precise reason when the issuer has no approved
  // structured scope for this record kind. The commit-time predicate in
  // attestationStore remains the actual enforcement (TOCTOU-safe).
  const scopeAllowed = await db.prepare(`SELECT 1 FROM issuer_scopes s JOIN issuer_scope_actions sa ON sa.scope_id=s.id
    WHERE s.issuer_id=? AND s.record_kind=? AND s.status='approved' AND sa.action='attest'
      AND s.valid_from IS NOT NULL AND datetime(s.valid_from)<=datetime('now')
      AND (s.valid_until IS NULL OR (datetime(s.valid_until)>datetime('now') AND datetime(s.valid_until)>datetime(s.valid_from)))
    LIMIT 1`).bind(issuerId, input.record_kind).first();
  if (!scopeAllowed) {
    throw new HttpError(403, "issuer_scope_required", "The issuer has no currently approved scope for this record kind");
  }

  const record = await probeRecord(db, input.record_kind, input.record_id);
  if (!record) throw new HttpError(404, "not_found", "The attested record was not found");
  // The horse binding is derived from the RECORD, never trusted from the caller.
  const horseId = record.horse_id;

  // Self-review protection: the attester must not have produced the evidence
  // themselves — either the target media or the referenced evidence media.
  if ((input.record_kind === "media" || input.record_kind === "genetic_test") && isSelfReview({ attesterUserId: actor.userId, evidenceUploaderId: record.uploader_user_id })) {
    throw new HttpError(403, "self_review_forbidden", "You cannot attest evidence you submitted yourself");
  }
  if (input.evidence_media_id) {
    const evidence = await db.prepare("SELECT id,uploaded_by_user_id FROM horse_media WHERE id=?").bind(input.evidence_media_id).first<{ id: string; uploaded_by_user_id: string | null }>();
    if (!evidence) throw new HttpError(404, "not_found", "Evidence media not found");
    if (isSelfReview({ attesterUserId: actor.userId, evidenceUploaderId: evidence.uploaded_by_user_id })) {
      throw new HttpError(403, "self_review_forbidden", "You cannot use your own upload as attestation evidence");
    }
  }
  if (input.horse_id != null && input.horse_id !== horseId) {
    throw new HttpError(400, "scope_mismatch", "The record does not belong to the supplied horse");
  }

  const id = await issueStoredAttestation(db, actor.userId, issuerId, input);
  if (!id) throw new HttpError(409, "attestation_conflict", "Issuer, membership, record or evidence changed before issuance");
  return loadIssuedAttestation(db, id);

}

async function loadIssuedAttestation(db: D1Database, id: string): Promise<IssuedAttestation> {
  const row = await db.prepare("SELECT id,issuer_id,horse_id,record_kind,record_id,field_scope,statement,evidence_media_id,source_version,issued_at,expires_at,status FROM attestations WHERE id=?")
    .bind(id).first<Omit<IssuedAttestation, "field_scope"> & { field_scope: string | null }>();
  if (!row) throw new HttpError(409, "attestation_conflict", "The attestation is no longer available");
  return { ...row, field_scope: parseScope(row.field_scope) };
}

export async function createAttestation(
  request: Request,
  env: { DB: D1Database; SESSION_COOKIE_NAME: string },
  issuerId: string,
): Promise<Response> {
  // Any signed-in user may reach this handler; the real gate is issuer
  // membership inside issueAttestation. Platform staff without a membership
  // are rejected there — staff cannot impersonate an outside issuer.
  const auth = await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "horse.read");
  requireCsrf(request, auth);
  const parsed = AttestationCreateSchema.safeParse(await readJson<unknown>(request, 16 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_attestation", "Attestation failed validation", parsed.error.flatten());
  const attestation = await issueAttestation(env.DB, { userId: auth.user.id }, issuerId, parsed.data);
  return json({ attestation }, { status: 201 });
}

async function loadAttestation(db: D1Database, attestationId: string) {
  return db.prepare("SELECT * FROM attestations WHERE id=?").bind(attestationId).first<{
    id: string; issuer_id: string; status: string; record_kind: AttestableRecordKind; record_id: string; row_version: number;
  }>();
}

/** Revocation/supersession authorization: issuer owner or platform content manager. */
async function canManageAttestation(db: D1Database, userId: string, platformRole: string, issuerId: string): Promise<boolean> {
  if (hasPlatformManage(platformRole)) return true;
  const membership = await db
    .prepare("SELECT * FROM issuer_memberships WHERE issuer_id=? AND user_id=? ORDER BY created_at DESC LIMIT 1")
    .bind(issuerId, userId)
    .first<MembershipRow>();
  return membership?.role === "owner" && membershipValidity(membership) === "active" && membership.issuer_id === issuerId;
}

export async function revokeAttestation(
  request: Request,
  env: { DB: D1Database; SESSION_COOKIE_NAME: string },
  attestationId: string,
): Promise<Response> {
  const auth = await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "horse.read");
  requireCsrf(request, auth);
  const attestation = await loadAttestation(env.DB, attestationId);
  if (!attestation) throw new HttpError(404, "not_found", "Attestation not found");
  if (!(await canManageAttestation(env.DB, auth.user.id, auth.user.role, attestation.issuer_id))) {
    throw new HttpError(403, "forbidden", "Only the issuer's owner or platform content managers can revoke attestations");
  }
  if (attestation.status !== "active") throw new HttpError(409, "not_active", `Attestation is already ${attestation.status}`);
  const parsed = AttestationRevokeSchema.safeParse(await readJson<unknown>(request, 8 * 1024));
  if (!parsed.success) throw new HttpError(400, "reason_required", "A reason is required to revoke an attestation", parsed.error.flatten());
  const applied = await revokeStoredAttestation(env.DB, { actorId: auth.user.id, id: attestationId,
    expectedVersion: attestation.row_version, reason: parsed.data.reason });
  if (!applied) throw new HttpError(409, "attestation_conflict", "Attestation or authority changed before revocation");
  return json({ revoked: attestationId, reason: parsed.data.reason });
}

export async function supersedeAttestation(
  request: Request,
  env: { DB: D1Database; SESSION_COOKIE_NAME: string },
  attestationId: string,
): Promise<Response> {
  const auth = await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "horse.read");
  requireCsrf(request, auth);
  const attestation = await loadAttestation(env.DB, attestationId);
  if (!attestation) throw new HttpError(404, "not_found", "Attestation not found");
  if (!(await canManageAttestation(env.DB, auth.user.id, auth.user.role, attestation.issuer_id))) {
    throw new HttpError(403, "forbidden", "Only the issuer's owner or platform content managers can supersede attestations");
  }
  if (attestation.status !== "active") throw new HttpError(409, "not_active", `Attestation is already ${attestation.status}`);
  // R98-N04: an issuer suspension takes effect on supersession commands too,
  // with an honest reason instead of a generic conflict.
  const issuer = await env.DB.prepare("SELECT status FROM issuers WHERE id=?").bind(attestation.issuer_id).first<{ status: string }>();
  if (issuer && issuer.status !== "active") {
    throw new HttpError(403, issuer.status === "suspended" ? "issuer_suspended" : "issuer_retired", `The issuer is ${issuer.status}; supersession is refused while history is preserved`);
  }
  const parsed = AttestationSupersedeSchema.safeParse(await readJson<unknown>(request, 16 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_supersession", "Supersession failed validation", parsed.error.flatten());
  if (parsed.data.replacement.record_kind !== attestation.record_kind || parsed.data.replacement.record_id !== attestation.record_id) {
    throw new HttpError(400, "scope_mismatch", "A replacement must concern the exact same record as the superseded attestation");
  }
  const id = await issueStoredAttestation(env.DB, auth.user.id, attestation.issuer_id, parsed.data.replacement,
    { id: attestationId, expectedVersion: attestation.row_version, reason: parsed.data.reason });
  if (!id) throw new HttpError(409, "attestation_conflict", "The original, issuer, authority or evidence changed; no replacement was issued");
  return json({ superseded: attestationId, reason: parsed.data.reason, replacement: await loadIssuedAttestation(env.DB, id) });
}

// ---------------------------------------------------------------------------
// Public read paths.

function parseScope(value: string | null): string[] | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : null;
  } catch {
    return null;
  }
}

/** Public per-horse attestation view: who checked what, when, in which scope. */
export async function listHorseAttestations(db: D1Database, horseId: number): Promise<Response> {
  const horse = await db.prepare("SELECT id FROM horses WHERE id=? AND deleted_at IS NULL").bind(horseId).first();
  if (!horse) throw new HttpError(404, "not_found", "Horse not found");
  const result = await publicHorseAttestations(db, horseId);
  return json({ horse_id: horseId, truncated: result.truncated,
    attestations: result.attestations.map((row) => ({ ...row, limitations: VERIFICATION_LEVELS.issuer_attested })) });
}

export async function countActiveAttestations(db: D1Database, recordKind: AttestableRecordKind, recordId: string): Promise<number> {
  return activeAttestationCount(db, recordKind, recordId);
}

// ---------------------------------------------------------------------------
// R98-N04: structured issuer scopes — HTTP surface.

const ScopeGrantSchema = z.object({
  record_kind: z.enum(SCOPE_RECORD_KINDS),
  actions: z.array(z.enum(SCOPE_ACTIONS)).min(1).max(2),
  valid_from: z.string().trim().max(60).nullable().optional(),
  valid_until: TrustExpirySchema.nullable().optional(),
  evidence_note: z.string().trim().min(10).max(2000),
});

export async function grantIssuerScopeHandler(
  request: Request,
  env: { DB: D1Database; SESSION_COOKIE_NAME: string },
  issuerId: string,
): Promise<Response> {
  // Scope approval is a PLATFORM responsibility: only content managers may
  // approve what an issuer may attest, and only after registration evidence
  // exists. The issuer's own owner cannot self-approve authority.
  const auth = await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "content.manage");
  requireCsrf(request, auth);
  const parsed = ScopeGrantSchema.safeParse(await readJson<unknown>(request, 8 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_scope", "Scope grant failed validation", parsed.error.flatten());
  const d = parsed.data;
  const issuer = await env.DB.prepare("SELECT id,status,registration_evidence FROM issuers WHERE id=?").bind(issuerId)
    .first<{ id: string; status: string; registration_evidence: string | null }>();
  if (!issuer) throw new HttpError(404, "not_found", "Issuer not found");
  if (issuer.status !== "active") throw new HttpError(409, "issuer_not_active", "Scopes can only be approved for an active issuer");
  if (!issuer.registration_evidence || issuer.registration_evidence.length === 0) {
    throw new HttpError(422, "issuer_evidence_required", "This legacy issuer has no recorded registration evidence; record and review the documentary evidence before approving any scope");
  }
  let scopeId: string | null = null;
  try {
    scopeId = await grantIssuerScope(env.DB, { actorId: auth.user.id, issuerId,
      recordKind: d.record_kind as ScopeRecordKind, actions: d.actions as ScopeAction[],
      validFrom: d.valid_from ?? null, validUntil: d.valid_until ?? null, evidenceNote: d.evidence_note });
  } catch (error) {
    throw new HttpError(400, "invalid_scope", (error as Error).message);
  }
  if (!scopeId) throw new HttpError(409, "scope_conflict", "Issuer, evidence or authority changed before the scope could be approved");
  return json({ granted: true, scope_id: scopeId, issuer_id: issuerId, record_kind: d.record_kind, actions: [...new Set(d.actions)].sort(), superseded_previous_live_version: true }, { status: 201 });
}

const ScopeTransitionSchema = z.object({ reason: z.string().trim().min(3).max(1000) });

export async function suspendIssuerScopeHandler(request: Request, env: { DB: D1Database; SESSION_COOKIE_NAME: string }, scopeId: string): Promise<Response> {
  return scopeTransition(request, env, scopeId, "suspended");
}

export async function resumeIssuerScopeHandler(request: Request, env: { DB: D1Database; SESSION_COOKIE_NAME: string }, scopeId: string): Promise<Response> {
  return scopeTransition(request, env, scopeId, "approved");
}

export async function revokeIssuerScopeHandler(request: Request, env: { DB: D1Database; SESSION_COOKIE_NAME: string }, scopeId: string): Promise<Response> {
  return scopeTransition(request, env, scopeId, "revoked");
}

async function scopeTransition(request: Request, env: { DB: D1Database; SESSION_COOKIE_NAME: string }, scopeId: string, to: "suspended" | "approved" | "revoked"): Promise<Response> {
  const auth = await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "content.manage");
  requireCsrf(request, auth);
  const parsed = ScopeTransitionSchema.safeParse(await readJson<unknown>(request, 8 * 1024));
  if (!parsed.success) throw new HttpError(400, "reason_required", "A reason is required", parsed.error.flatten());
  const scope = await env.DB.prepare("SELECT id,issuer_id,record_kind,status FROM issuer_scopes WHERE id=?").bind(scopeId)
    .first<{ id: string; issuer_id: string; record_kind: string; status: string }>();
  if (!scope) throw new HttpError(404, "not_found", "Scope not found");
  const applied = await transitionIssuerScope(env.DB, { actorId: auth.user.id, scopeId, to, reason: parsed.data.reason });
  if (!applied) throw new HttpError(409, "scope_state_changed", "The scope was already changed or authority is no longer current");
  return json({ scope_id: scopeId, status: to, reason: parsed.data.reason });
}

const IssuerStatusSchema = z.object({
  status: z.enum(["active", "suspended", "retired"]),
  reason: z.string().trim().min(3).max(1000),
});

export async function transitionIssuerStatusHandler(
  request: Request,
  env: { DB: D1Database; SESSION_COOKIE_NAME: string },
  issuerId: string,
): Promise<Response> {
  const auth = await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "content.manage");
  requireCsrf(request, auth);
  const parsed = IssuerStatusSchema.safeParse(await readJson<unknown>(request, 8 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_status", "A status and reason are required", parsed.error.flatten());
  const issuer = await env.DB.prepare("SELECT id,status FROM issuers WHERE id=?").bind(issuerId).first<{ id: string; status: string }>();
  if (!issuer) throw new HttpError(404, "not_found", "Issuer not found");
  const applied = await transitionIssuerStatus(env.DB, { actorId: auth.user.id, issuerId, to: parsed.data.status, reason: parsed.data.reason });
  if (!applied) throw new HttpError(409, "issuer_state_changed", "The issuer is already in that state or authority changed");
  return json({ issuer_id: issuerId, status: parsed.data.status, reason: parsed.data.reason });
}

/** Private operator queue: expiring memberships/scopes, invalid dates,
 * suspended issuers, unevidenced legacy issuers. Non-private metadata only. */
export async function trustQueueHandler(request: Request, env: { DB: D1Database; SESSION_COOKIE_NAME: string }): Promise<Response> {
  await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "content.manage");
  return json(await trustOperatorQueue(env.DB));
}

// ---------------------------------------------------------------------------
// R98-N04 step 5: plain-language public trust labels.

export async function trustLabelsHandler(): Promise<Response> {
  return json({
    verification_levels: VERIFICATION_LEVELS,
    issuer_authority: {
      en: "An issuer attestation is issued by a member of the named organization within an explicitly approved scope and validity interval. Issuer metadata does not certify every field on a horse profile: each attestation names the exact record, its scope and its limitations.",
      fa: "تأیید مرجع توسط عضو سازمان مشخص و در محدوده و بازه اعتبار تأییدشده صادر می‌شود. اطلاعات مرجع هیچ‌گاه همهٔ فیلدهای پروفایل اسب را گواهی نمی‌کند؛ هر تأیید رکورد مشخص، محدوده و محدودیت‌های خود را نام می‌برد.",
    },
    review_roles: {
      attester: "An issuer member who attests a specific record within an approved scope (membership + scope re-checked at commit time).",
      issuer_manager: "The issuer's owner who manages memberships under that issuer; cannot approve the issuer's own authority scopes.",
      platform_reviewer: "Platform staff who review registration evidence and approve scopes; editorial review only — a platform role alone can never mint an issuer attestation.",
    },
    documents: {
      registry_extract: "A Registry Information Extract is an informational snapshot, not an official certificate, passport or registration document.",
      attestation_snapshot: "Public verification shows the digest and per-row version markers of the immutable server-derived evidence snapshot; the snapshot bytes and private fields stay private.",
    },
  });
}

// ---------------------------------------------------------------------------
// R98-N05: public verification of an attestation against its immutable snapshot.

export type AttestationVerificationState =
  | "current" | "source_changed" | "superseded" | "revoked"
  | "snapshot_tampered" | "unbound_legacy" | "expired" | "not_yet_valid"
  | "invalid_dates" | "issuer_suspended" | "issuer_retired" | "issuer_inactive";

export async function verifyAttestationHandler(db: D1Database, attestationId: string): Promise<Response> {
  const row = await db.prepare(`SELECT a.id,a.issuer_id,a.horse_id,a.record_kind,a.record_id,a.evidence_media_id,a.issued_at,a.expires_at,a.status,a.source_version,
    i.slug AS issuer_slug,i.name AS issuer_name,i.kind AS issuer_kind,i.status AS issuer_status
    FROM attestations a JOIN issuers i ON i.id=a.issuer_id JOIN horses h ON h.id=a.horse_id WHERE a.id=? AND ${PUBLIC_ATTESTATION_TARGET_SQL}`).bind(attestationId)
    .first<{ id: string; issuer_id: string; horse_id: number | null; record_kind: AttestableRecordKind; record_id: string; evidence_media_id: string | null; issued_at: string; expires_at: string | null; status: string; source_version: string | null; issuer_slug: string; issuer_name: string; issuer_kind: string; issuer_status: string }>();
  if (!row) throw new HttpError(404, "not_found", "Attestation not found");
  const snapshot = await db.prepare("SELECT schema_version,canonical_json,content_digest,source_row_versions,issuer_scope_snapshot,created_at FROM attestation_snapshots WHERE attestation_id=?")
    .bind(attestationId).first<{ schema_version: number; canonical_json: string; content_digest: string; source_row_versions: string; issuer_scope_snapshot: string; created_at: string }>();
  const effective = effectiveAttestationStatus(row);
  let state: AttestationVerificationState;
  let source_detail: { changed_tables?: string[]; removed_tables?: string[] } | null = null;
  if (row.status === "revoked") state = "revoked";
  else if (row.status === "superseded") state = "superseded";
  else if (!snapshot) state = "unbound_legacy";
  else {
    const bytesOk = await snapshotBytesMatchDigest(snapshot.canonical_json, snapshot.content_digest);
    if (!bytesOk) state = "snapshot_tampered";
    else {
      const observed = parseRowVersions(snapshot.source_row_versions);
      const current = await readCurrentRowsForVerification(db, row.record_kind, row.record_id, row.evidence_media_id);
      const comparison = await compareRowDigests(observed, current, row.record_kind);
      if (!comparison.matches) {
        state = "source_changed";
        source_detail = { changed_tables: comparison.changed_tables, removed_tables: comparison.removed_tables };
      } else if (effective === "expired" || effective === "not_yet_valid" || effective === "invalid_dates") state = effective;
      else if (effective === "issuer_suspended" || effective === "issuer_retired" || effective === "issuer_inactive") state = effective;
      else state = "current";
    }
  }
  // Minimal public verification metadata only: digest + markers. The
  // canonical bytes, statement, field scope and evidence identity stay private.
  return json({
    attestation_id: row.id,
    issuer: { slug: row.issuer_slug, name: row.issuer_name, kind: row.issuer_kind, status: row.issuer_status },
    record_kind: row.record_kind,
    record_id: row.record_id,
    horse_id: row.horse_id,
    issued_at: row.issued_at,
    expires_at: row.expires_at,
    status: row.status,
    effective_status: effective,
    verification_state: state,
    source_detail: source_detail,
    snapshot: snapshot ? {
      schema_version: snapshot.schema_version,
      content_digest: snapshot.content_digest,
      source_row_versions: parseRowVersions(snapshot.source_row_versions),
      scope_authority: JSON.parse(snapshot.issuer_scope_snapshot) as Record<string, unknown>,
      captured_at: snapshot.created_at,
      is_private: true,
    } : null,
    server_derived_source_version: row.source_version,
    limitations: VERIFICATION_LEVELS.issuer_attested,
    note: "The snapshot bytes and private fields are never disclosed. A source_changed state means the underlying record was modified after issuance; the attested historical snapshot is preserved unchanged.",
  });
}

/** Private canonical snapshot export. Genetic reports require current scoped
 * evidence-read authority; other kinds retain current manager/issuer-owner
 * eligibility. Every path also requires the live bearer and MFA assurance. */
export async function attestationSnapshotHandler(
  request: Request,
  env: { DB: D1Database; SESSION_COOKIE_NAME: string },
  attestationId: string,
): Promise<Response> {
  const auth = await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "horse.read");
  requireCsrf(request, auth);
  const live = privateEvidenceSessionPredicate(auth);
  const genetics = geneticActionPredicate(auth, { column: "g.horse_id" }, ["genetic_evidence_read"]);
  // Canonical genetic snapshots contain accession and interpretation text.
  // A generic content-management or issuer-owner role cannot export them.
  // The same SELECT checks current session/MFA/grant and reads the bytes.
  const snapshot = await env.DB.prepare(`SELECT s.* FROM attestation_snapshots s
    JOIN attestations a ON a.id=s.attestation_id
    LEFT JOIN genetic_tests g ON a.record_kind='genetic_test' AND CAST(g.id AS TEXT)=a.record_id
    WHERE a.id=? AND (
      (a.record_kind='genetic_test' AND (${genetics.sql}))
      OR (a.record_kind<>'genetic_test' AND (${live.sql}) AND (
        EXISTS(SELECT 1 FROM users u WHERE u.id=? AND u.is_active=1 AND u.role IN ('admin','super_admin'))
        OR EXISTS(SELECT 1 FROM issuer_memberships im JOIN issuers issuer ON issuer.id=im.issuer_id AND issuer.status='active'
          WHERE im.issuer_id=a.issuer_id AND im.user_id=? AND im.role='owner' AND im.status='active'
            AND im.revoked_at IS NULL AND datetime(im.valid_from)<=CURRENT_TIMESTAMP
            AND (im.valid_until IS NULL OR datetime(im.valid_until)>CURRENT_TIMESTAMP))
      ))
    )`).bind(attestationId,...genetics.bindings,...live.bindings,auth.user.id,auth.user.id).first();
  if (!snapshot) throw new HttpError(403, "snapshot_permission_required", "Current evidence permission is required to review this snapshot");
  return json({ attestation_id: attestationId, snapshot });
}

export { sha256Hex };

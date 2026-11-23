import { z } from "zod";
import { HttpError, json, readJson } from "../http";
import { requireAuth, requireCsrf } from "../../auth/guards";
import { isValidProvinceCode, isServiceCategoryId, PROVINCE_CODE_SCHEME } from "../../directory/vocabulary";
import { createServiceStatements, transitionServiceStatements } from "../../services/commands";
import {
  ORGANIZATION_SERVICE_LEADS,
  SERVICE_TERMINAL_STATES,
  isServiceProviderManager,
  requesterHasHorseMandate,
  resolveLegacyServiceReceipt,
  serviceActorsPermitting,
  serviceReceiptKey,
  serviceRouteTransitions,
  serviceTransitionAllowed,
  type LegacyServiceReceipt,
  type ServiceActor,
} from "../../services/policy";
import {
  ABUSE_STANDING_REFUSAL,
  DUPLICATE_WINDOW_HOURS,
  MAX_NEW_PER_CATEGORY_PER_DAY,
  MAX_NEW_REQUESTS_PER_DAY,
  PRIVACY_DECISION_TABLE,
  PROVIDER_BLOCK_REFUSAL,
  RETENTION_DAYS,
  computeProviderResponseMetrics,
  METRICS_WINDOW_DAYS,
  METRICS_MAX_ROWS_SCAN,
  placeServiceRequestHoldStatements,
  releaseServiceRequestHoldStatements,
  fileProviderBlockComplaintStatements,
  BLOCK_COMPLAINT_MAX_CHARS,
  consentWithdrawalStatements,
  preflightServiceCreate,
  providerBlockStatements,
  requesterBlockStatements,
  redactNoteStatements,
  type MetricsInputRow,
} from "../../services/privacy";
import {
  RETENTION_POLICY_CATEGORIES,
  SUBJECT_REDACTION_CATEGORIES,
  SUBJECT_REDACTION_GRANT_HOLD_GUARD_SQL,
  FULFILLMENT_PRE_READ_SQL,
  approveRetentionPolicyStatements,
  buildFulfillmentStatements,
  decideSubjectRedactionRequestStatements,
  fulfillmentNoteEvidence,
  getEffectiveRetentionPolicy,
  subjectRedactionFulfillment,
  subjectRedactionRequestStatements,
} from "../../services/privacyPolicy";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * R88 agent plan P12 — the consented service request inbox; R95-N11: the
 * route derives every transition fact from the ONE matrix in
 * src/services/policy.ts (no local copy, no "anyone" metadata).
 *
 * Doctrine:
 *  - A service request is a LEAD. It is never a confirmed appointment and
 *    NEVER displays paid or booked — those states do not exist in the
 *    machine (the CHECK constraint is the proof).
 *  - The public lead form is MINIMIZED: provider, category, coarse location,
 *    optional horse and a short note. No medical details are solicited; the
 *    note is never exposed publicly.
 *  - Contact visibility is consent-gated AND re-authorized at EVERY read:
 *    only the requester and the CURRENT authorized provider manager see the
 *    requester's contact route, and only when share_contact=1. A revoked
 *    manager loses access on the very next request.
 *  - Idempotent create: the Idempotency-Key claims a receipt in the same
 *    batch as the request (same discipline as P03 marketplace commands) — a
 *    retry replays the stored response, never creates a second request.
 *  - Repeated targeting is bounded: at most 3 open requests from one
 *    requester to the same provider.
 *  - Demo requests never reach production APIs: a provider must be a REAL
 *    registry person with a PUBLISHED directory profile — synthetic demo
 *    persons have none and can never be targeted.
 *  - A horse may be referenced only under a CURRENT horse mandate; the
 *    transaction re-checks it (N11), so a late revocation prevents commit.
 */

type Env = { DB: D1Database; SESSION_COOKIE_NAME: string };

const MAX_OPEN_PER_PROVIDER = 3;
const NOTE_MAX = 500;

/**
 * The explicit role transition metadata, DERIVED from the single matrix
 * (R95-N11). `by` lists exactly the actors permitted to move the request —
 * the old broad "anyone" claim is gone.
 */
export const SERVICE_REQUEST_TRANSITIONS = serviceRouteTransitions();
export const SERVICE_REQUEST_TERMINAL_STATES = SERVICE_TERMINAL_STATES;

const CreateSchema = z.object({
  provider_person_id: z.number().int().positive(),
  provider_organization_id: z.number().int().positive().nullable().optional(),
  category: z.string().trim().min(2).max(40),
  province_code: z.string().trim().max(8).nullable().optional(),
  province_code_scheme: z.string().max(80).optional(),
  city: z.string().trim().max(120).nullable().optional(),
  horse_id: z.number().int().positive().nullable().optional(),
  note: z.string().trim().min(10).max(NOTE_MAX),
  share_contact: z.boolean().default(false),
});

async function digestPayload(value: unknown): Promise<string> {
  const bits = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value ?? null)));
  return [...new Uint8Array(bits)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createServiceRequest(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  const parsed = CreateSchema.safeParse(await readJson<unknown>(request, 16 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_service_request", "Service request failed validation", parsed.error.flatten());
  const d = parsed.data;
  if (d.provider_organization_id != null) {
    // Derived from the policy: organization affiliation mandates do not exist
    // yet, and ordinary organization membership is NOT provider authority.
    const refusal = ORGANIZATION_SERVICE_LEADS.refusal;
    throw new HttpError(refusal.status, refusal.code, refusal.message);
  }
  if (!isServiceCategoryId(d.category)) throw new HttpError(400, "invalid_service_request", "Category must be from the reviewed service vocabulary");
  if (d.province_code != null && d.province_code !== "" && !isValidProvinceCode(d.province_code)) {
    throw new HttpError(400, "invalid_service_request", "Province must be an approved ISO 3166-2:IR code");
  }
  if (d.province_code && d.province_code_scheme !== PROVINCE_CODE_SCHEME) {
    throw new HttpError(400, "province_scheme_required", "Select the province again using the current reference dataset");
  }
  // A horse may be referenced only under a CURRENT mandate (the transaction
  // re-checks this; the preflight exists for the honest early error).
  if (d.horse_id != null && !(await requesterHasHorseMandate(env.DB, auth.user.id, d.horse_id, new Date().toISOString()))) {
    throw new HttpError(403, "horse_mandate_required", "A service lead may reference a horse you currently hold a mandate on (an approved claim or an explicit grant)");
  }

  // Idempotency: same actor + same Idempotency-Key reclaims the receipt.
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey || idempotencyKey.trim().length < 8 || idempotencyKey.length > 128) {
    throw new HttpError(400, "idempotency_key_required", "Provide an Idempotency-Key header (8-128 chars) so retries never duplicate a request");
  }
  const digest = await digestPayload(d);
  const receiptKey = await serviceReceiptKey(auth.user.id,idempotencyKey.trim());
  const existing = await env.DB.prepare("SELECT id,response_json,request_digest,request_id,created_at FROM service_request_receipts WHERE actor_user_id=? AND id IN (?,?) ORDER BY created_at DESC LIMIT 1")
    .bind(auth.user.id,receiptKey,idempotencyKey.trim()).first<LegacyServiceReceipt>();
  if (existing) {
    if (existing.request_digest !== digest) throw new HttpError(409, "idempotency_conflict", "This key was used with different request content");
    if (!existing.request_id) {
      // Legacy receipt (pre-0054, no durable request link): DETERMINISTIC
      // resolution — claim the single matching request or refuse honestly.
      // Never creates a duplicate lead (R95-N11).
      const resolution = await resolveLegacyServiceReceipt(env.DB, auth.user.id, existing);
      if (resolution.kind === "unresolved") {
        throw new HttpError(409, "legacy_receipt_unresolved", "A previous request exists but its older receipt cannot be tied to exactly one request. Use a new Idempotency-Key; no duplicate request was created.");
      }
      return replayServiceReceipt({ ...existing, request_id: resolution.requestId }, digest);
    }
    return replayServiceReceipt(existing, digest);
  }

  // The provider must be a REAL registry person with a PUBLISHED directory
  // profile — demo/synthetic persons have none and can never be targeted.
  const provider = await env.DB.prepare(`
    SELECT p.id FROM people p
    JOIN directory_profiles dp ON dp.person_id = p.id AND dp.publication_consent=1
    WHERE p.id=? AND p.deleted_at IS NULL
  `).bind(d.provider_person_id).first();
  if (!provider) throw new HttpError(404, "not_found", "Provider not found in the published directory");

  // Blocking: a requester who blocked this provider cannot target them again.
  const blocked = await env.DB.prepare("SELECT id FROM service_request_blocks WHERE blocker_user_id=? AND blocked_person_id=?")
    .bind(auth.user.id, d.provider_person_id).first();
  if (blocked) throw new HttpError(403, "provider_blocked", "You blocked this provider; withdraw the block before sending a new request");

  // R95-N12 anti-abuse preflight — AFTER the receipt replay, so an idempotent
  // retry of an ALREADY-CREATED request is never mistaken for abuse. Each
  // bound is re-checked INSIDE the create transaction; the preflight exists
  // for the honest early error. Every check is about the ACTING account — no
  // other requester is examined or revealed.
  const preflight = await preflightServiceCreate(env.DB, auth.user.id, d.provider_person_id, d.category, d.note, new Date().toISOString());
  if (preflight.kind === "provider_blocked") {
    // Neutral refusal: the private block reason is never disclosed.
    throw new HttpError(PROVIDER_BLOCK_REFUSAL.status, PROVIDER_BLOCK_REFUSAL.code, PROVIDER_BLOCK_REFUSAL.message);
  }
  if (preflight.kind === "standing") {
    throw new HttpError(ABUSE_STANDING_REFUSAL.status, ABUSE_STANDING_REFUSAL.code, ABUSE_STANDING_REFUSAL.message);
  }
  if (preflight.kind === "rate_limited_daily") {
    throw new HttpError(429, "rate_limited_daily", `You may send at most ${MAX_NEW_REQUESTS_PER_DAY} service requests per rolling 24 hours`);
  }
  if (preflight.kind === "rate_limited_category") {
    throw new HttpError(429, "rate_limited_category", `You may send at most ${MAX_NEW_PER_CATEGORY_PER_DAY} service requests per rolling 24 hours in one category`);
  }
  if (preflight.kind === "duplicate") {
    throw new HttpError(409, "duplicate_lead", `You already sent this provider the same note in category ${d.category} within the last ${DUPLICATE_WINDOW_HOURS} hours. Send a different note or wait for a reply.`);
  }

  // Repeated-targeting bound: at most MAX_OPEN_PER_PROVIDER open requests.
  const open = await env.DB.prepare(`
    SELECT COUNT(*) AS n FROM service_requests
    WHERE requester_user_id=? AND provider_person_id=? AND status IN ('new','acknowledged','discussing')
  `).bind(auth.user.id, d.provider_person_id).first<{ n: number }>();
  if (Number(open?.n ?? 0) >= MAX_OPEN_PER_PROVIDER) {
    throw new HttpError(429, "too_many_open_requests", `You already have ${MAX_OPEN_PER_PROVIDER} open requests to this provider`);
  }

  if (await isServiceProviderManager(env.DB,auth.user.id,d.provider_person_id)) throw new HttpError(400,"self_request","Provider accounts cannot create leads to themselves");
  const shareContact = d.share_contact ? 1 : 0;
  const operationId=crypto.randomUUID();
  const response={created:true,request:{provider_person_id:d.provider_person_id,category:d.category,status:"new",share_contact:shareContact===1},request_digest:digest,
    note:"This is a lead, not a confirmed appointment. Notification is queued only for linked provider accounts; delivery is not guaranteed."};
  await env.DB.batch(createServiceStatements(env.DB,{operationId,receiptKey,digest,actorUserId:auth.user.id,providerPersonId:d.provider_person_id,
    category:d.category,province:d.province_code || null,city:d.city ?? null,horseId:d.horse_id ?? null,note:d.note,shareContact:d.share_contact,responseJson:JSON.stringify(response)}));
  const stored=await env.DB.prepare("SELECT id,response_json,request_digest,request_id,operation_id FROM service_request_receipts WHERE id=? AND actor_user_id=?")
    .bind(receiptKey,auth.user.id).first<LegacyServiceReceipt & {operation_id:string}>();
  if (!stored) throw new HttpError(409,"request_not_recorded","Provider publication, category, horse mandate, blocking or the open-request limit changed; reload before retrying");
  return replayServiceReceipt(stored,digest,stored.operation_id===operationId);
}

function replayServiceReceipt(receipt:LegacyServiceReceipt,digest:string,createdNow=false):Response {
  if (receipt.request_digest!==digest) throw new HttpError(409,"idempotency_conflict","This key was used with different request content");
  if (!receipt.request_id) throw new HttpError(409,"legacy_receipt_unresolved","A previous request exists but its older receipt has no durable request link. Use a new Idempotency-Key; no duplicate request was created.");
  const saved=JSON.parse(receipt.response_json) as {request?:Record<string,unknown>};
  return json({...saved,request:{...saved.request,id:receipt.request_id},idempotent_replay:!createdNow},{status:createdNow?201:200});
}

interface ServiceRequestRow {
  id: number;
  requester_user_id: string;
  provider_person_id: number;
  provider_organization_id: number | null;
  category: string;
  province_code: string | null;
  city: string | null;
  horse_id: number | null;
  note: string;
  share_contact: number;
  status: string;
  row_version: number;
  created_at: string;
  updated_at: string;
}

/** Contact visibility: consent + CURRENT manager authorization, re-checked at read. */
async function projectRequest(db: D1Database, row: ServiceRequestRow, reader: { userId: string; role: string }) {
  const isRequester = row.requester_user_id === reader.userId;
  const isManager = isRequester ? false : await isServiceProviderManager(db, reader.userId, row.provider_person_id);
  if (!isRequester && !isManager) throw new HttpError(404,"not_found","Service request not found");
  const maySeeContact = (isRequester || isManager) && Number(row.share_contact) === 1;
  const requester = isRequester || isManager
    ? await db.prepare("SELECT u.email, u.display_name FROM users u WHERE u.id=?").bind(row.requester_user_id).first<{ email: string; display_name: string }>()
    : null;
  return {
    id: row.id,
    provider_person_id: row.provider_person_id,
    category: row.category,
    province_code: row.province_code,
    city: row.city,
    horse_id: row.horse_id,
    status: row.status,
    row_version: row.row_version,
    created_at: row.created_at,
    updated_at: row.updated_at,
    is_requester_view: isRequester,
    contact: maySeeContact && requester ? { display_name: requester.display_name, email: requester.email, via: "consented" } : null,
    contact_note: maySeeContact ? "Shared with this provider manager by explicit consent." : "Contact is not shared with this reader.",
    // The note stays between requester and provider — never public.
    note: isRequester || isManager ? row.note : undefined,
    appointment_warning: "A service request is not a confirmed appointment.",
  };
}

/**
 * R108-05 — the uncertain-write RECONCILIATION read. After a timeout or a
 * reload, a client holding a durable intent key asks the server what became
 * of that exact command key — BEFORE composing a new intent. The answer is
 * scoped to the asking actor: another account's key learns nothing (the
 * lookup is actor_user_id=? on both the modern hash key and the raw legacy
 * key, exactly like the create replay path).
 *
 *  - confirmed: the receipt exists and carries its durable request link —
 *    the response is the SAME stored response the create returned, so a
 *    reload shows one record and one receipt, never a duplicate.
 *  - unresolved: a legacy receipt (pre-0054) exists but cannot be tied to
 *    exactly one request — the client must NOT retry the key; a fresh
 *    explicit intent with a new key is the honest path (no duplicate was
 *    created either way).
 *  - unknown: no receipt exists for this actor+key — the write never
 *    reached the server (or is still in flight elsewhere). The client keeps
 *    an honest unknown state; it may recheck or discard and start a NEW
 *    intent. Nothing is fabricated.
 */
export async function reconcileServiceIntent(request: Request, env: Env, key: string): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  const trimmed = key.trim();
  if (trimmed.length < 8 || trimmed.length > 128) {
    throw new HttpError(400, "invalid_intent_key", "The intent key must be 8-128 characters");
  }
  const receiptKey = await serviceReceiptKey(auth.user.id, trimmed);
  const receipt = await env.DB.prepare(
    "SELECT id,response_json,request_digest,request_id,created_at FROM service_request_receipts WHERE actor_user_id=? AND id IN (?,?) ORDER BY created_at DESC LIMIT 1",
  ).bind(auth.user.id, receiptKey, trimmed).first<LegacyServiceReceipt>();
  if (!receipt) {
    return json({
      state: "unknown",
      note: "No record of this attempt exists on the server. The write never reached the platform, or it is still in flight. Recheck, or discard the intent and compose a fresh inquiry.",
    });
  }
  if (!receipt.request_id) {
    return json({
      state: "unresolved",
      note: "An older receipt exists but cannot be tied to exactly one request. Do not retry this key; discard the intent and compose a fresh inquiry. No duplicate request was created.",
    });
  }
  const saved = JSON.parse(receipt.response_json) as { request?: Record<string, unknown> };
  return json({
    state: "confirmed",
    request_id: receipt.request_id,
    response: { ...saved, request: { ...saved.request, id: receipt.request_id } },
    created_at: receipt.created_at,
    note: "The inquiry was recorded. This is the same receipt the original attempt produced; no duplicate exists.",
  });
}

export async function myServiceRequests(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  const rows = await env.DB.prepare("SELECT * FROM service_requests WHERE requester_user_id=? ORDER BY id DESC LIMIT 100").bind(auth.user.id)
    .all<ServiceRequestRow>();
  const projected = await Promise.all((rows.results ?? []).map((row) => projectRequest(env.DB, row, { userId: auth.user.id, role: auth.user.role })));
  return json({ requests: projected });
}

export async function providerServiceRequests(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  const result=await env.DB.prepare(`SELECT r.* FROM service_requests r WHERE EXISTS(
    SELECT 1 FROM user_person_links l JOIN people p ON p.id=l.person_id AND p.deleted_at IS NULL
    WHERE l.user_id=? AND l.person_id=r.provider_person_id AND l.status='verified') ORDER BY r.id DESC LIMIT 100`)
    .bind(auth.user.id).all<ServiceRequestRow>();
  const rows=result.results ?? [];
  const projected = await Promise.all(rows.map((row) => projectRequest(env.DB, row, { userId: auth.user.id, role: auth.user.role })));
  return json({ requests: projected, inbox: "provider" });
}

export async function serviceRequestDetail(request: Request, env: Env, id: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  const row = await env.DB.prepare("SELECT * FROM service_requests WHERE id=?").bind(id).first<ServiceRequestRow>();
  if (!row) throw new HttpError(404, "not_found", "Service request not found");
  const isRequester = row.requester_user_id === auth.user.id;
  const isManager = await isServiceProviderManager(env.DB, auth.user.id, row.provider_person_id);
  if (!isRequester && !isManager) throw new HttpError(404, "not_found", "Service request not found");
  return json({ request: await projectRequest(env.DB, row, { userId: auth.user.id, role: auth.user.role }) });
}

const TransitionSchema = z.object({
  status: z.enum(["new", "acknowledged", "discussing", "closed", "withdrawn", "spam"]),
  expected_version: z.number().int().positive(),
});

export async function transitionServiceRequest(request: Request, env: Env, id: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  const parsed = TransitionSchema.safeParse(await readJson<unknown>(request, 8 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_transition", "Transition failed validation", parsed.error.flatten());
  const row = await env.DB.prepare("SELECT * FROM service_requests WHERE id=?").bind(id).first<ServiceRequestRow>();
  if (!row) throw new HttpError(404, "not_found", "Service request not found");
  const isRequester = row.requester_user_id === auth.user.id;
  const isManager = await isServiceProviderManager(env.DB, auth.user.id, row.provider_person_id);
  if (!isRequester && !isManager) throw new HttpError(404, "not_found", "Service request not found");

  if (SERVICE_TERMINAL_STATES.includes(row.status as (typeof SERVICE_TERMINAL_STATES)[number])) {
    throw new HttpError(409, "terminal_state", `This request is ${row.status} (terminal) — stale edits are rejected`);
  }
  // The acting role is resolved from live authorization, then the ONE matrix
  // decides (route and command derive from the same table — R95-N11).
  const actor: ServiceActor = isRequester && !isManager ? "requester" : "provider";
  if (!serviceTransitionAllowed(row.status, parsed.data.status, actor)) {
    const permittedActors = serviceActorsPermitting(row.status, parsed.data.status);
    if (permittedActors.length === 0) {
      const allowed = SERVICE_REQUEST_TRANSITIONS[row.status as keyof typeof SERVICE_REQUEST_TRANSITIONS]?.to ?? [];
      throw new HttpError(409, "invalid_transition", `Cannot move from ${row.status} to ${parsed.data.status}. Allowed: ${allowed.join(", ")}`);
    }
    if (parsed.data.status === "withdrawn") {
      throw new HttpError(403, "only_requester", "Only the requester can withdraw a service request");
    }
    throw new HttpError(403, "party_transition_forbidden", `Only the ${permittedActors.join("/")} may move a request to ${parsed.data.status}. The requester may close or withdraw.`);
  }
  const [update]=await env.DB.batch(transitionServiceStatements(env.DB,{requestId:id,expectedVersion:parsed.data.expected_version,
    from:row.status,to:parsed.data.status,actorUserId:auth.user.id,actor,operationId:crypto.randomUUID()}));
  if (Number(update?.meta.changes ?? 0) !== 1) {
    throw new HttpError(409, "stale_version", "The request changed before your edit landed; reload and retry with the current row_version");
  }
  const after = await env.DB.prepare("SELECT * FROM service_requests WHERE id=?").bind(id).first<ServiceRequestRow>();
  return json({
    request: await projectRequest(env.DB, after!, { userId: auth.user.id, role: auth.user.role }),
    notification: {
      recorded: true,
      outbox_status: "queued",
      note: "The status change is recorded. The other party's notification is queued for delivery — queuing is not provider notification, and provider acceptance is not delivery confirmation.",
    },
  });
}

export async function blockProvider(request: Request, env: Env, id: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  const row = await env.DB.prepare("SELECT id,provider_person_id FROM service_requests WHERE id=? AND requester_user_id=?").bind(id, auth.user.id).first<{ id: number; provider_person_id: number }>();
  if (!row) throw new HttpError(404, "not_found", "Service request not found");
  const [written] = await env.DB.batch(requesterBlockStatements(env.DB, {
    requestId:id,requesterUserId:auth.user.id,providerPersonId:row.provider_person_id,
  }));
  if (Number(written?.meta.changes ?? 0) === 0) {
    const existing = await env.DB.prepare(`SELECT b.id FROM service_request_blocks b
      JOIN users u ON u.id=b.blocker_user_id AND u.is_active=1
      JOIN service_requests r ON r.requester_user_id=b.blocker_user_id AND r.provider_person_id=b.blocked_person_id
      WHERE b.blocker_user_id=? AND b.blocked_person_id=? AND r.id=?`)
      .bind(auth.user.id,row.provider_person_id,id).first();
    if (!existing) throw new HttpError(409,"request_changed","The request or account changed; reload before retrying");
  }
  return json({ blocked: true, provider_person_id: row.provider_person_id, note: "The note stays private; the provider can no longer receive new requests from you." });
}

export async function reportServiceRequest(request: Request, env: Env, id: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  const parsed = z.object({ reason: z.string().trim().min(5).max(500) }).safeParse(await readJson<unknown>(request, 4 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_report", "Report failed validation", parsed.error.flatten());
  // Targets derive from the STORED record (requester/provider of the lead),
  // never from submitted identity claims; only an active participant may report.
  const row = await env.DB.prepare("SELECT id,requester_user_id,provider_person_id FROM service_requests WHERE id=?").bind(id).first<{id:number;requester_user_id:string;provider_person_id:number}>();
  if (!row || (row.requester_user_id!==auth.user.id && !(await isServiceProviderManager(env.DB,auth.user.id,row.provider_person_id)))) throw new HttpError(404, "not_found", "Service request not found");
  // R96-N08: dedup + rate limit live INSIDE the insert — a retry can never
  // append a second report (unique pair) and one account cannot flood the
  // queue (daily bound on its own reports).
  const [insert] = await env.DB.batch([
    env.DB.prepare(`INSERT INTO service_request_reports(service_request_id,reporter_user_id,reason)
      SELECT ?,?,? WHERE NOT EXISTS(SELECT 1 FROM service_request_reports r
          WHERE r.service_request_id=? AND r.reporter_user_id=?)
        AND (SELECT COUNT(*) FROM service_request_reports r2
          WHERE r2.reporter_user_id=? AND datetime(r2.created_at)>=datetime('now','-1 day')) < 20`)
      .bind(id, auth.user.id, parsed.data.reason, id, auth.user.id, auth.user.id),
  ]);
  if (Number(insert?.meta.changes ?? 0) !== 1) {
    const duplicate = await env.DB.prepare("SELECT 1 FROM service_request_reports WHERE service_request_id=? AND reporter_user_id=?")
      .bind(id, auth.user.id).first();
    if (duplicate) throw new HttpError(409, "duplicate_report", "You already reported this request; the existing report is retained and retries append nothing");
    throw new HttpError(429, "report_rate_limited", "Too many reports in the last 24 hours; try again later");
  }
  return json({ reported: true, report_id: Number(insert?.meta.last_row_id ?? 0) }, { status: 201 });
}

/**
 * Provider response-time statistics (R95-N12 honesty rules) — a defined
 * measurement window, a disclosed denominator, a minimum cohort and a
 * per-requester sample cap (limited influence, not fraud prevention). Below
 * the minimum cohort the response is insufficient data — a synthetic
 * star/rating never exists. Computed ONLY from real eligible requests (exact
 * first_response_at captured at the acknowledgement transition).
 */
export async function providerResponseStats(db: D1Database, personId: number): Promise<Response> {
  const provider = await db.prepare(`
    SELECT p.id FROM people p
    JOIN directory_profiles dp ON dp.person_id = p.id AND dp.publication_consent=1
    WHERE p.id=? AND p.deleted_at IS NULL
  `).bind(personId).first();
  if (!provider) throw new HttpError(404, "not_found", "Provider not found in the published directory");

  // R96-N08: the aggregation is bounded AT SQL LEVEL — the indexed
  // (provider_person_id, created_at) window with a hard scan cap; a
  // high-volume profile never forces an unbounded history read. Truncation
  // is disclosed, never silent.
  const rows = await db.prepare(`
    SELECT requester_user_id, status, created_at, first_response_at FROM service_requests
    WHERE provider_person_id=? AND datetime(created_at)>=datetime('now','-${METRICS_WINDOW_DAYS} days')
    ORDER BY created_at LIMIT ${METRICS_MAX_ROWS_SCAN + 1}
  `).bind(personId).all<MetricsInputRow>();
  const scanned = rows.results ?? [];
  const scanCapApplied = scanned.length > METRICS_MAX_ROWS_SCAN;
  const metrics = computeProviderResponseMetrics(scanCapApplied ? scanned.slice(0, METRICS_MAX_ROWS_SCAN) : scanned, new Date().toISOString());
  return json({
    provider_person_id: personId,
    ...metrics,
    scan_cap: METRICS_MAX_ROWS_SCAN,
    scan_cap_applied: scanCapApplied,
    unacknowledged_requests: metrics.exclusions.never_acknowledged,
    unknown_state_requests: metrics.exclusions.withdrawn_before_acknowledgement,
    insufficient_data_note: metrics.insufficient_data
      ? "Not enough eligible responses yet — no rating is shown. A provider's biography never contains a synthetic or imported reputation."
      : undefined,
    aggregation_note: `Aggregation is restricted at SQL level to an indexed ${METRICS_WINDOW_DAYS}-day window with a ${METRICS_MAX_ROWS_SCAN}-row scan cap. Response-time is a speed measure only — never satisfaction, completion or quality; no review stars exist.`,
  });
}

// ---------------------------------------------------------------------------
// R95-N12 — consent withdrawal, provider-side block, redaction, export and
// the public privacy decision table.
// ---------------------------------------------------------------------------

/**
 * POST /api/service-requests/:id/consent — the requester withdraws contact
 * consent. ONE-WAY: future reads disclose nothing (re-authorized at every
 * read), pending optional notices about this request are suppressed, and the
 * narrow dispute/audit record (status history, timestamps) is preserved.
 * Re-consenting means sending a new request.
 */
export async function withdrawContactConsent(request: Request, env: Env, id: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  const row = await env.DB.prepare("SELECT id,share_contact,requester_user_id FROM service_requests WHERE id=?")
    .bind(id).first<{ id: number; share_contact: number; requester_user_id: string }>();
  if (!row || row.requester_user_id !== auth.user.id) throw new HttpError(404, "not_found", "Service request not found");
  if (Number(row.share_contact) === 0) {
    throw new HttpError(409, "already_withdrawn", "Contact consent is already withdrawn for this request; re-consent means sending a new request");
  }
  const [update] = await env.DB.batch(consentWithdrawalStatements(env.DB, { requestId: id, requesterUserId: auth.user.id, operationId: crypto.randomUUID() }));
  if (Number(update?.meta.changes ?? 0) !== 1) {
    throw new HttpError(409, "consent_race", "Consent changed before your withdrawal landed; reload and retry");
  }
  const after = await env.DB.prepare("SELECT share_contact,consent_updated_at FROM service_requests WHERE id=?")
    .bind(id).first<{ share_contact: number; consent_updated_at: string | null }>();
  return json({
    withdrawn: true,
    request_id: id,
    share_contact: false,
    consent_updated_at: after?.consent_updated_at ?? null,
    effects: {
      future_contact_disclosure: "none — the contact route is no longer shown to any provider manager",
      pending_optional_notices: "suppressed (essential security notices are never suppressed)",
      dispute_record: "preserved (status history + timestamps) per the published retention rationale",
      reversibility: "one-way — re-consent means sending a new request",
    },
  });
}

/**
 * POST /api/service-requests/:id/provider-block — the CURRENT verified
 * provider manager blocks the requester of this lead. New leads from that
 * account are refused with a NEUTRAL error (the private reason is never
 * disclosed) and pending optional notices from them are suppressed.
 */
export async function providerBlockRequester(request: Request, env: Env, id: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  const parsed = z.object({ reason: z.string().trim().min(5).max(500).nullable().optional() })
    .safeParse(await readJson<unknown>(request, 4 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_block", "Block failed validation", parsed.error.flatten());
  const row = await env.DB.prepare("SELECT id,provider_person_id,requester_user_id FROM service_requests WHERE id=?")
    .bind(id).first<{ id: number; provider_person_id: number; requester_user_id: string }>();
  if (!row) throw new HttpError(404, "not_found", "Service request not found");
  if (!(await isServiceProviderManager(env.DB, auth.user.id, row.provider_person_id))) {
    // Not the provider of this lead: honest 404, never an existence oracle.
    throw new HttpError(404, "not_found", "Service request not found");
  }
  if (row.requester_user_id === auth.user.id) throw new HttpError(400, "self_block", "You cannot block your own account");
  const [written] = await env.DB.batch(providerBlockStatements(env.DB, {
    providerPersonId: row.provider_person_id, blockedRequesterUserId: row.requester_user_id,
    actorUserId: auth.user.id, reason: parsed.data.reason ?? null, operationId: crypto.randomUUID(),
  }));
  if (Number(written?.meta.changes ?? 0)!==1) {
    const exists=await env.DB.prepare("SELECT id FROM service_provider_blocks WHERE provider_person_id=? AND blocked_requester_user_id=?")
      .bind(row.provider_person_id,row.requester_user_id).first();
    if (!exists || !(await isServiceProviderManager(env.DB,auth.user.id,row.provider_person_id))) {
      throw new HttpError(409,"block_not_recorded","The provider mandate or request changed; reload before retrying");
    }
  }
  return json({
    blocked: true,
    requester_account: "blocked",
    effects: {
      new_leads: "refused with a neutral error — the reason and the block are never disclosed to the blocked account",
      pending_optional_notices: "suppressed",
      existing_lead: "unchanged — close or mark it through the normal transitions",
    },
  });
}

/**
 * POST /api/service-requests/:id/redact — the requester replaces their note
 * body with a marker. The SHA-256 of the original bytes is preserved as
 * a comparison digest (not proof of authorship and not recoverable evidence by itself); the body itself is
 * gone for both readers.
 */
export async function redactMyNote(request: Request, env: Env, id: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  const row = await env.DB.prepare("SELECT id,note,note_redacted_at,requester_user_id,row_version FROM service_requests WHERE id=?")
    .bind(id).first<{ id: number; note: string; note_redacted_at: string | null; requester_user_id: string; row_version: number }>();
  if (!row || row.requester_user_id !== auth.user.id) throw new HttpError(404, "not_found", "Service request not found");
  if (row.note_redacted_at) throw new HttpError(409, "already_redacted", "This note is already redacted");
  const digestBits = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(row.note));
  const noteDigest = [...new Uint8Array(digestBits)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const [update] = await env.DB.batch(redactNoteStatements(env.DB, { requestId: id, requesterUserId: auth.user.id, noteDigest, expectedNote: row.note, expectedVersion: row.row_version, operationId: crypto.randomUUID() }));
  if (Number(update?.meta.changes ?? 0) !== 1) {
    throw new HttpError(409, "redact_race", "The note changed before your redaction landed; reload and retry");
  }
  return json({
    redacted: true,
    request_id: id,
    note_now: "[redacted by requester]",
    evidence: "The SHA-256 of your original note bytes is preserved for dispute resolution; the content itself is deleted.",
  });
}

/**
 * GET /api/service-requests/export — the requester's own service-request
 * data: their leads, their blocks, their reports and their moderation
 * standing. Nothing about OTHER requesters is ever included (provider notes
 * and internal staff notes do not exist on this object).
 */
export async function exportMyServiceData(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  const leads = await env.DB.prepare(`
    SELECT id, provider_person_id, category, province_code, city, horse_id, note, share_contact,
           status, created_at, updated_at, closed_at, consent_updated_at, note_redacted_at
    FROM service_requests WHERE requester_user_id=? ORDER BY id DESC LIMIT 500
  `).bind(auth.user.id).all();
  const blocks = await env.DB.prepare(`
    SELECT blocked_person_id, created_at FROM service_request_blocks WHERE blocker_user_id=?
  `).bind(auth.user.id).all();
  const reports = await env.DB.prepare(`
    SELECT r.service_request_id, r.reason, r.created_at FROM service_request_reports r
    WHERE r.reporter_user_id=? ORDER BY r.id DESC LIMIT 200
  `).bind(auth.user.id).all();
  const standing = await env.DB.prepare("SELECT standing, reason, updated_at FROM service_abuse_standing WHERE user_id=?")
    .bind(auth.user.id).first<{ standing: string; reason: string | null; updated_at: string }>();
  return json({
    exported_for: auth.user.id,
    generated_at: new Date().toISOString(),
    service_requests: leads.results ?? [],
    requester_blocks: blocks.results ?? [],
    abuse_reports_filed: reports.results ?? [],
    moderation_standing: standing ?? { standing: "normal", reason: null, updated_at: null },
    retention: {
      note: `Note bodies of terminal requests older than 365 days are minimized automatically (digest preserved); status history and timestamps are preserved as the dispute/audit record.`,
      policy: "/api/service-requests/privacy-policy",
    },
  });
}

/** GET /api/service-requests/privacy-policy — the public decision table. */
export async function servicePrivacyPolicy(): Promise<Response> {
  return json({
    policy_version: "r95-n12",
    decision_table: PRIVACY_DECISION_TABLE,
    ui_flow: {
      requester: [
        "Create: provider + category + coarse location + optional horse + minimized note + explicit contact-consent checkbox",
        "After sending: withdraw the whole lead (status), withdraw ONLY contact consent (/consent, one-way), redact the note body (/redact), or block the provider (/block)",
        "Export: /export returns every lead, block, report and your moderation standing",
      ],
      provider: [
        "Inbox: only leads for persons with your VERIFIED link; the requester contact route appears only while consent stands",
        "Transitions: acknowledge / discuss / close / mark spam via the ONE matrix",
        "Anti-abuse: /provider-block refuses future leads from an account with a neutral error; the reason stays private",
      ],
    },
  });
}


// ---------------------------------------------------------------------------
// R96-N08 — dispute/legal holds + the block-complaint support queue.
// ---------------------------------------------------------------------------

/** Admin-only: place a dispute/legal hold that blocks retention minimization. */
export async function adminPlaceServiceRequestHold(request: Request, env: Env, id: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "admin");
  requireCsrf(request, auth);
  const parsed = z.object({
    hold_kind: z.enum(["dispute", "legal_hold"]),
    reason: z.string().trim().min(10).max(2000),
  }).safeParse(await readJson<unknown>(request, 4 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_hold", "hold_kind (dispute|legal_hold) and a substantive reason (10-2000 chars) are required", parsed.error.flatten());
  const row = await env.DB.prepare("SELECT id FROM service_requests WHERE id=?").bind(id).first<{ id: number }>();
  if (!row) throw new HttpError(404, "not_found", "Service request not found");
  const results = await env.DB.batch(placeServiceRequestHoldStatements(env.DB, {
    requestId: id, operatorUserId: auth.user.id, holdKind: parsed.data.hold_kind, reason: parsed.data.reason,
  }));
  if (Number(results[1]?.meta.changes ?? 0) !== 1) {
    throw new HttpError(409, "hold_exists", "An active hold already exists for this request; release it before placing a new one");
  }
  return json({ hold_placed: true, service_request_id: id, hold_kind: parsed.data.hold_kind,
    note: "The request is exempt from retention minimization until an authorized release. The hold reason is audited; the request's private note text never enters any log." }, { status: 201 });
}

/** Admin-only: release a hold (minimization resumes on its normal schedule). */
export async function adminReleaseServiceRequestHold(request: Request, env: Env, id: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "admin");
  requireCsrf(request, auth);
  const parsed = z.object({ release_reason: z.string().trim().min(10).max(2000) })
    .safeParse(await readJson<unknown>(request, 4 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_release", "A substantive release reason (10-2000 chars) is required", parsed.error.flatten());
  const results = await env.DB.batch(releaseServiceRequestHoldStatements(env.DB, {
    requestId: id, operatorUserId: auth.user.id, releaseReason: parsed.data.release_reason,
  }));
  if (Number(results[1]?.meta.changes ?? 0) !== 1) {
    throw new HttpError(409, "no_active_hold", "No active hold exists for this request");
  }
  return json({ hold_released: true, service_request_id: id,
    note: "Retention minimization may now proceed on its normal schedule for this request." });
}

/** A blocked (or any) user files ONE complaint per provider pair. The PRIVATE
 * block reason is never shown here — the complaint is the user's own text. */
export async function fileBlockComplaint(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  const parsed = z.object({
    provider_person_id: z.number().int().positive(),
    complaint: z.string().trim().min(20).max(BLOCK_COMPLAINT_MAX_CHARS),
  }).safeParse(await readJson<unknown>(request, 4 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_complaint", "provider_person_id and a complaint (20-2000 chars) are required", parsed.error.flatten());
  const [insert] = await env.DB.batch(fileProviderBlockComplaintStatements(env.DB, {
    complainantUserId: auth.user.id, providerPersonId: parsed.data.provider_person_id, complaint: parsed.data.complaint,
  }));
  if (Number(insert?.meta.changes ?? 0) !== 1) {
    return json({ complaint: "existing", note: "You already filed a complaint about this provider; it is in the support queue and retries append nothing." });
  }
  return json({ complaint: "filed", note: "Your complaint is in the operator support queue. Block reasons are private and are never shared with complainants; a mistaken block is reviewed from the operator side." }, { status: 201 });
}

/** Admin-only: the support queue (open complaints; bounded, newest first). */
export async function adminBlockComplaintQueue(request: Request, env: Env): Promise<Response> {
  await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "admin");
  const rows = await env.DB.prepare(`
    SELECT c.id, c.complainant_user_id, c.provider_person_id, c.complaint, c.status, c.created_at,
           (SELECT u.display_name FROM users u WHERE u.id=c.complainant_user_id) AS complainant_name,
           (SELECT p.name_latin FROM people p WHERE p.id=c.provider_person_id) AS provider_name
    FROM provider_block_complaints c ORDER BY c.id DESC LIMIT 200
  `).all();
  const open = await env.DB.prepare("SELECT COUNT(*) AS n FROM provider_block_complaints WHERE status='open'").first<{ n: number }>();
  return json({
    complaints: rows.results ?? [],
    open_count: Number(open?.n ?? 0),
    note: "Operator support queue. Block reasons are private and are never exposed to complainants; resolutions are recorded here, not in public profiles.",
  });
}

/** Admin-only: resolve a complaint with an audited note. */
export async function adminResolveBlockComplaint(request: Request, env: Env, id: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "admin");
  requireCsrf(request, auth);
  const parsed = z.object({ resolution_note: z.string().trim().min(10).max(2000) })
    .safeParse(await readJson<unknown>(request, 4 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_resolution", "A substantive resolution note (10-2000 chars) is required", parsed.error.flatten());
  const [update] = await env.DB.batch([
    env.DB.prepare(`UPDATE provider_block_complaints SET status='resolved', resolution_note=?, resolved_by_user_id=?, resolved_at=CURRENT_TIMESTAMP
      WHERE id=? AND status='open'
        AND EXISTS(SELECT 1 FROM users WHERE id=? AND is_active=1 AND role IN ('admin','super_admin'))`)
      .bind(parsed.data.resolution_note, auth.user.id, id, auth.user.id),
  ]);
  if (Number(update?.meta.changes ?? 0) !== 1) {
    throw new HttpError(409, "not_resolvable", "The complaint is not open (or the operator is not active); nothing changed");
  }
  return json({ resolved: true, complaint_id: id, note: "Resolution recorded in the support queue. The private block reason and the complainant's data stay within operator surfaces." });
}

// ---------------------------------------------------------------------------
// R98-N09 — operator-approved retention policy + subject redaction requests.
// ---------------------------------------------------------------------------

/** Admin-only: current + historical retention policies per data category, with
 * the effective inherited default made explicit when no approval exists. */
export async function adminListRetentionPolicies(request: Request, env: Env): Promise<Response> {
  await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "admin");
  const rows = await env.DB.prepare(`
    SELECT p.id, p.data_category, p.retention_days, p.consent_withdrawal_behavior, p.hold_authority,
           p.release_requirements, p.status, p.policy_version, p.approved_at, p.retired_at, p.supersedes_policy_id,
           (SELECT u.display_name FROM users u WHERE u.id=p.approved_by_user_id) AS approved_by_name
    FROM privacy_retention_policies p ORDER BY p.data_category, p.policy_version DESC LIMIT 200
  `).all();
  const effective = await getEffectiveRetentionPolicy(env.DB, "service_request_terminal", RETENTION_DAYS);
  return json({
    policies: (rows.results ?? []).map(row => ({ ...row,
      enforcement_status: row.data_category === "service_request_terminal" ? "terminal_retention_sweep" : "not_implemented",
    })),
    effective_service_request_terminal: {
      retention_days: effective.retention_days,
      source: effective.source,
      policy_version: effective.policy_version,
    },
    categories: RETENTION_POLICY_CATEGORIES,
    note: "The terminal service-request sweep uses the approved interval or the documented inherited default. Audit/dispute-record policies are recorded for review; no audit-record purge executor is implemented. Approvals are versioned and retiring preserves history.",
  });
}

/** Admin-only: approve (or replace) the retention policy for one category. */
export async function adminApproveRetentionPolicy(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "admin");
  requireCsrf(request, auth);
  const parsed = z.object({
    data_category: z.enum(RETENTION_POLICY_CATEGORIES),
    retention_days: z.number().int().min(1).max(3650),
    consent_withdrawal_behavior: z.string().trim().min(10).max(2000),
    hold_authority: z.string().trim().min(10).max(2000),
    release_requirements: z.string().trim().min(10).max(2000),
  }).safeParse(await readJson<unknown>(request, 8 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_policy", "data_category, retention_days (1-3650), consent_withdrawal_behavior, hold_authority and release_requirements are required", parsed.error.flatten());
  const [, , retire, promote, , receipt] = await env.DB.batch<{ id: string; policy_version: number; supersedes_policy_id: string | null }>(approveRetentionPolicyStatements(env.DB, {
    operatorUserId: auth.user.id, dataCategory: parsed.data.data_category, retentionDays: parsed.data.retention_days,
    consentWithdrawalBehavior: parsed.data.consent_withdrawal_behavior, holdAuthority: parsed.data.hold_authority,
    releaseRequirements: parsed.data.release_requirements,
  }));
  if (Number(promote?.meta.changes ?? 0) !== 1) {
    await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "admin");
    throw new HttpError(409, "policy_approval_conflict", "The policy changed before this approval could commit. Refresh the policy history before deciding again.");
  }
  const approved = receipt?.results?.[0];
  if (!approved) throw new HttpError(503, "policy_receipt_unavailable", "The approval receipt is unavailable. Review policy history to determine the outcome before retrying.");
  return json({
    policy_approved: true, data_category: parsed.data.data_category, retention_days: parsed.data.retention_days,
    policy_id: approved.id, policy_version: Number(approved.policy_version), supersedes_policy_id: approved.supersedes_policy_id,
    previous_policy_retired: Number(retire?.meta.changes ?? 0),
    enforcement_status: parsed.data.data_category === "service_request_terminal" ? "terminal_retention_sweep" : "not_implemented",
    note: parsed.data.data_category === "service_request_terminal"
      ? "This version was approved. The terminal retention sweep resolves the currently approved interval on each run; previous policy history is preserved. This approval does not execute any subject redaction request."
      : "This policy decision is recorded and versioned. No audit/dispute-record purge executor is implemented; approval does not delete or minimize retained evidence.",
  }, { status: 201 });
}

/** A data subject files a redaction request for their own service-request data.
 * Against a request under an ACTIVE hold the request is recorded and DEFERRED. */
export async function fileSubjectRedactionRequest(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  const parsed = z.object({
    data_category: z.enum(SUBJECT_REDACTION_CATEGORIES),
    request_note: z.string().trim().min(10).max(2000),
    service_request_id: z.number().int().positive().nullable().optional(),
  }).safeParse(await readJson<unknown>(request, 8 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_redaction_request", "data_category and a request_note (10-2000 chars) are required; service_request_id must be your own request when given", parsed.error.flatten());
  const statements = await subjectRedactionRequestStatements(env.DB, {
    subjectUserId: auth.user.id, serviceRequestId: parsed.data.service_request_id ?? null,
    dataCategory: parsed.data.data_category, requestNote: parsed.data.request_note,
  });
  const [, , insert, , receipt] = await env.DB.batch<{ id: number; status: string; hold_interaction: string | null }>(statements);
  if (Number(insert?.meta.changes ?? 0) !== 1) {
    await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
    if (parsed.data.service_request_id != null) {
      const owned = await env.DB.prepare("SELECT id FROM service_requests WHERE id=? AND requester_user_id=?")
        .bind(parsed.data.service_request_id, auth.user.id).first();
      if (!owned) throw new HttpError(403, "not_data_subject", "A redaction request may only reference your own service request");
    }
    throw new HttpError(409, "redaction_request_not_filed", "The request could not be filed with your current authority; no new request was recorded.");
  }
  const inserted = receipt?.results?.[0];
  if (!inserted) throw new HttpError(503, "redaction_receipt_unavailable", "The filing receipt is unavailable. The outcome must be checked before another request is submitted.");
  const deferred = inserted.status === "deferred_active_hold";
  return json({
    redaction_request: "filed", request_id: Number(inserted.id), status: inserted.status,
    ...subjectRedactionFulfillment(inserted.status),
    note: deferred
      ? "Your request is recorded and DEFERRED because an active hold preserves the referenced evidence. It remains in the operator queue for review after an authorized hold release. Filing and hold release do not execute redaction."
      : "Your request is recorded for operator review. Filing does not delete or minimize data; execution happens only through the separate audited fulfillment operation after an operator grant.",
  }, { status: 201 });
}

/** Admin-only: the redaction-request queue (bounded; statuses are visible so
 * deferred requests cannot silently disappear after a hold release). R114-01:
 * the queue now also surfaces the SEPARATE execution state — a grant stays a
 * decision; only the executor's own receipt reports completion. */
export async function adminRedactionRequestQueue(request: Request, env: Env): Promise<Response> {
  await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "admin");
  const rows = await env.DB.prepare(`
    SELECT r.id, r.subject_user_id, r.service_request_id, r.data_category, r.request_note, r.status,
           r.hold_interaction, r.decided_at, r.decision_note, r.created_at,
           r.execution_status, r.executed_at, r.execution_receipt_json,
           (SELECT u.display_name FROM users u WHERE u.id=r.subject_user_id) AS subject_name,
           EXISTS(SELECT 1 FROM service_request_holds h WHERE h.service_request_id=r.service_request_id AND h.released_at IS NULL) AS request_under_active_hold
    FROM subject_redaction_requests r ORDER BY r.id DESC LIMIT 200
  `).all();
  const counts = await env.DB.prepare(`
    SELECT SUM(CASE WHEN status='received' THEN 1 ELSE 0 END) AS received,
           SUM(CASE WHEN status='deferred_active_hold' THEN 1 ELSE 0 END) AS deferred,
           SUM(CASE WHEN status='granted' THEN 1 ELSE 0 END) AS granted,
           SUM(CASE WHEN status='refused' THEN 1 ELSE 0 END) AS refused,
           SUM(CASE WHEN execution_status='completed' THEN 1 ELSE 0 END) AS executed
    FROM subject_redaction_requests
  `).first<{ received: number; deferred: number; granted: number; refused: number; executed: number }>();
  return json({
    requests: (rows.results ?? []).map(row => ({
      ...row,
      // R117-18: the operator UI contract carries booleans — SQLite EXISTS
      // returns 0/1, so coerce the raw hold flag here (the computed
      // blocked_by_hold below already coerced its copy).
      request_under_active_hold: Boolean(row.request_under_active_hold),
      ...subjectRedactionFulfillment(String(row.status), {
        execution_status: (row.execution_status as string | null | undefined) ?? null,
        blocked_by_hold: Boolean(row.request_under_active_hold),
      }),
    })), counts: {
      received: Number(counts?.received ?? 0), deferred_active_hold: Number(counts?.deferred ?? 0),
      granted: Number(counts?.granted ?? 0), refused: Number(counts?.refused ?? 0),
      executed: Number(counts?.executed ?? 0),
    },
    note: "Granted means the operator approved the request; it does not by itself mean redaction was executed. Fulfillment is the separate audited executor POST /api/admin/privacy/redaction-requests/:id/fulfill; only its own receipt reports completion. Deferred requests remain visible for review after authorized hold release, and execution never bypasses an active hold. Untargeted requests need a resolved scope before approval.",
  });
}

/** Admin-only: decide a redaction request. A grant for a request under an
 * ACTIVE hold is refused — the operator must release the hold first. */
export async function adminDecideRedactionRequest(request: Request, env: Env, id: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "admin");
  requireCsrf(request, auth);
  const parsed = z.object({
    decision: z.enum(["grant", "refuse"]),
    decision_note: z.string().trim().min(10).max(2000),
  }).safeParse(await readJson<unknown>(request, 4 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_decision", "decision (grant|refuse) and a substantive decision_note (10-2000 chars) are required", parsed.error.flatten());
  const checkGrantScope = async () => {
    const scope = await env.DB.prepare(SUBJECT_REDACTION_GRANT_HOLD_GUARD_SQL).bind(id)
      .first<{ service_request_id: number | null; exact_subject_scope: number; held: number | null }>();
    if (scope && (scope.service_request_id === null || Number(scope.exact_subject_scope) !== 1)) {
      throw new HttpError(409, "redaction_scope_unresolved", "The exact service request belonging to this subject must be resolved before approval. No account-wide erasure scope is implied.");
    }
    if (scope && Number(scope.held) === 1) {
      throw new HttpError(409, "grant_blocked_by_hold", "This request references a service request under an ACTIVE hold. Release the hold through its own audited path first — a grant never bypasses a hold.");
    }
  };
  if (parsed.data.decision === "grant") await checkGrantScope();
  const [, , update] = await env.DB.batch(decideSubjectRedactionRequestStatements(env.DB, {
    operatorUserId: auth.user.id, redactionRequestId: id,
    decision: parsed.data.decision, decisionNote: parsed.data.decision_note,
  }));
  if (Number(update?.meta.changes ?? 0) !== 1) {
    await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "admin");
    if (parsed.data.decision === "grant") await checkGrantScope();
    throw new HttpError(409, "not_decidable", "The request is not in a decidable state (received/deferred_active_hold); nothing changed");
  }
  return json({
    decided: true, request_id: id, decision: parsed.data.decision,
    ...subjectRedactionFulfillment(parsed.data.decision === "grant" ? "granted" : "refused"),
    note: parsed.data.decision === "grant"
      ? "Approval recorded. Redaction has not been executed: a grant is a decision, not an execution. Fulfill it through the separate audited executor; this decision preserves the covered evidence and does not bypass retention holds."
      : "Refused with a recorded reason; the subject's request and this decision remain in the queue history.",
  });
}

/** R114-01 — the subject-request FULFILLMENT executor. Separate from the
 * decision: one operation-scoped completion receipt is written only after the
 * intended fields are actually minimized in the same transaction. A blocked
 * hold, a lost grant, a revoked admin or a concurrent completion writes
 * NOTHING (no data change, no success audit). A retry after completion reads
 * the stored receipt and never claims a second completion. */
export async function adminFulfillRedactionRequest(request: Request, env: Env, id: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "admin");
  requireCsrf(request, auth);
  const raw = await readJson<unknown>(request, 4 * 1024).catch(() => null);
  const parsed = z.object({
    execution_note: z.string().trim().min(10).max(1500).optional(),
  }).safeParse(raw ?? {});
  if (!parsed.success) throw new HttpError(400, "invalid_execution", "An optional execution_note (10-1500 chars) may accompany the fulfillment", parsed.error.flatten());

  const readState = async () => env.DB.prepare(FULFILLMENT_PRE_READ_SQL).bind(id)
    .first<{
      request_id: number; status: string;
      data_category: "service_request_notes" | "service_request_contact_location";
      service_request_id: number | null; execution_status: string | null;
      sr_id: number | null; sr_row_version: number | null;
      note: string | null; note_digest: string | null; note_redacted_at: string | null; note_digest_status: string | null;
      share_contact: number | null; province_code: string | null; city: string | null;
      subject_user_id: string; active_holds: number; exact_subject_scope: number;
    }>();
  let pre = await readState();
  if (!pre) throw new HttpError(404, "redaction_request_not_found", "No redaction request with this id");
  if (pre.execution_status === "completed") {
    const stored = await env.DB.prepare(`
        SELECT id,status,data_category,service_request_id,execution_status,executed_at,
          execution_receipt_operation_id,execution_receipt_json
        FROM subject_redaction_requests WHERE id=? AND execution_status='completed'`) .bind(id)
      .first<Record<string, unknown>>();
    return json({
      fulfilled: true, already_fulfilled: true, request_id: id,
      execution_receipt: stored, redaction_completed: true, fulfillment_status: "completed",
      note: "This request was already fulfilled. The stored completion receipt is returned; no second completion was claimed and nothing changed.",
    });
  }
  const scopeRefusal = () => {
    if (pre!.status !== "granted") {
      throw new HttpError(409, "not_granted", "Only a granted request can be fulfilled; a decision alone never executes anything");
    }
    if (pre!.service_request_id === null || Number(pre!.exact_subject_scope) !== 1 || pre!.sr_id === null) {
      throw new HttpError(409, "redaction_scope_unresolved", "The exact service request belonging to this subject must be resolved before fulfillment. No account-wide erasure scope is implied.");
    }
    if (Number(pre!.active_holds) > 0) {
      throw new HttpError(409, "execution_blocked_by_hold", "An active hold preserves this evidence. Release the hold through its own audited path first; execution never bypasses a hold.");
    }
  };
  scopeRefusal();
  if (pre.data_category === "service_request_notes" && !pre.note_redacted_at) {
    const evidence = await fulfillmentNoteEvidence(pre);
    if (!evidence.digest) {
      throw new HttpError(409, "execution_scope_unresolved", "The original note bytes are unavailable and no recorded digest exists; the fields cannot be minimized safely. Refusing rather than guessing.");
    }
  }
  const plan = await buildFulfillmentStatements(env.DB, {
    operatorUserId: auth.user.id, redactionRequestId: id,
    executionNote: parsed.data.execution_note,
  }, pre as never);
  const results = await env.DB.batch(plan.statements);
  const complete = results[results.length - 3];
  if (Number(complete?.meta.changes ?? 0) !== 1) {
    pre = (await readState()) ?? pre;
    if (pre.execution_status === "completed") {
      // A competing execution won the race; this attempt claims nothing.
      const stored = await env.DB.prepare(`
          SELECT id,status,data_category,service_request_id,execution_status,executed_at,
            execution_receipt_operation_id,execution_receipt_json
          FROM subject_redaction_requests WHERE id=? AND execution_status='completed'`).bind(id)
        .first<Record<string, unknown>>();
      return json({
        fulfilled: true, already_fulfilled: true, request_id: id,
        execution_receipt: stored, redaction_completed: true, fulfillment_status: "completed",
        note: "A concurrent fulfillment completed first; the stored completion receipt is returned and this attempt claimed no second completion.",
      });
    }
    scopeRefusal();
    throw new HttpError(409, "execution_conflict", "The fulfillment could not commit with current authority and state; nothing changed and no completion was claimed.");
  }
  const receipt = results[results.length - 1]?.results?.[0] as Record<string, unknown> | undefined;
  if (!receipt) throw new HttpError(503, "execution_receipt_unavailable", "The completion receipt is unavailable; inspect the queue before retrying.");
  return json({
    fulfilled: true, request_id: id, category: plan.category,
    already_minimized: plan.alreadyMinimized,
    execution_receipt: receipt, redaction_completed: true, fulfillment_status: "completed",
    note: plan.alreadyMinimized
      ? "Completion recorded: the approved fields were already minimized by an earlier authorized path, so this execution changed no further bytes and never fabricated a digest."
      : "Completion recorded: the intended fields were actually minimized in this transaction. The receipt is the proof of execution, distinct from the earlier grant decision.",
  }, { status: 201 });
}

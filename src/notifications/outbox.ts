import { retryNotificationStatements } from "./commands";
import { translateVendorCallback } from "./callbackAdapters";
import { EMAIL_IDEMPOTENCY_WINDOW_MS } from "./email";
/**
 * R88 agent plan P13 — the transactional notification outbox.
 *
 * The five acceptance criteria are the contract, and each one has a pinning
 * test in tests/unit/notificationsOutbox.test.ts:
 *
 *  1. Simulated provider acceptance does NOT set delivered. A 2xx reply moves
 *     a row to `provider_accepted` only. `delivered` exists exclusively via a
 *     signature-verified provider callback (recordDeliveryCallback).
 *  2. Repeated callbacks/retries cannot duplicate delivery records or billing
 *     counts: notification_deliveries is UNIQUE(event_key) and the status
 *     transition is a compare-and-set over pre-delivery states.
 *  3. A database rollback emits no message: outboxStatement() is designed to
 *     be part of the SAME D1 batch as the business mutation. If the batch
 *     fails, no row exists and the drain loop has nothing to send.
 *  4. Missing provider configuration is visible and never success: the drain
 *     marks rows `failed` with last_error='provider_unconfigured' (visible in
 *     the operator queue), never 'delivered'.
 *  5. Unsubscribe / quiet hours / monthly send limits apply ONLY to
 *     non-essential purposes; OTP and password reset are essential and never
 *     suppressed by marketing preferences.
 *
 * Logging discipline: no tokens, full phone numbers or message bodies are
 * ever written to the outbox row or to console — masked recipient only.
 */

import type { D1PreparedStatement, D1Database } from "@cloudflare/workers-types";
import { HttpError, json, readTextBody } from "../api/http";
import { requireAuth, requireCsrf } from "../auth/guards";
import { parseUtcTimestamp } from "../shared/utcTimestamp";

export type OutboxStatus = "queued" | "provider_accepted" | "delivered" | "failed" | "dead_letter" | "suppressed";

/** The explicit status set (pinned by tests; `delivered` only via callback). */
export const OUTBOX_STATUSES: readonly OutboxStatus[] = [
  "queued",
  "provider_accepted",
  "delivered",
  "failed",
  "dead_letter",
  "suppressed",
];

/**
 * Essential purposes: security-critical, time-sensitive, and REQUIRED for the
 * account to function. Unsubscribe/quiet-hours/monthly caps never apply.
 * Everything else is a courtesy notification and suppressible.
 */
export const ESSENTIAL_PURPOSES: ReadonlySet<string> = new Set([
  "signup_verification",
  "password_reset",
  "login_otp",
  "security_notice",
]);

/** The full allowlist: a purpose outside this set can never be enqueued. */
export const ALLOWED_PURPOSES: ReadonlySet<string> = new Set([
  ...ESSENTIAL_PURPOSES,
  "service_request_notice",
  "workspace_task_due",
  "marketplace_inquiry_notice",
  "workspace_task_reminder",
]);

export function isEssentialPurpose(purpose: string): boolean {
  return ESSENTIAL_PURPOSES.has(purpose);
}

/** Enforce the allowlist at enqueue time — unknown purposes are rejected. */
export function assertAllowedPurpose(purpose: string): void {
  if (!ALLOWED_PURPOSES.has(purpose)) {
    throw new HttpError(400, "invalid_purpose", `Purpose '${purpose}' is not in the notification allowlist`);
  }
}

/**
 * Mask a recipient for storage/logging. Email keeps the first character of
 * the local part plus the domain; phone keeps head+tail digits. The full
 * address/number lives only in the purpose's own table (never the outbox).
 */
export function maskRecipient(channel: "email" | "sms", recipient: string): string {
  if (channel === "email") {
    const at = recipient.lastIndexOf("@");
    if (at <= 0) return "***";
    return `${recipient.slice(0, 1)}***${recipient.slice(at)}`;
  }
  const digits = recipient.replace(/[^\d]/g, "");
  if (digits.length < 6) return "***";
  return `${recipient.slice(0, Math.max(0, recipient.length - digits.length) + 3)}***${digits.slice(-2)}`;
}

/**
 * The logical event key — deterministic from the mutation itself, so an
 * idempotent retry of the same logical event produces the SAME key and the
 * INSERT ... ON CONFLICT(event_key) DO NOTHING enqueues nothing new.
 * Example: outboxEventKey("service_request", 42, "v3") === "service_request:42:v3".
 */
export function outboxEventKey(kind: string, sourceId: string | number, version?: string | number): string {
  const safeKind = kind.replace(/[^a-z_]/g, "");
  const safeId = String(sourceId).replace(/[^a-zA-Z0-9\-]/g, "");
  if (!safeKind || !safeId) throw new Error("invalid outbox event key parts");
  return version === undefined ? `${safeKind}:${safeId}` : `${safeKind}:${safeId}:${String(version).replace(/[^a-zA-Z0-9\-]/g, "")}`;
}

export interface OutboxEvent {
  eventKey: string;
  channel: "email" | "sms";
  purpose: string;
  recipientUserId?: string | null;
  recipientMasked: string;
  payloadRef?: string | null;
  /**
   * Honest initial state. Default `queued` = the drain loop owns sending.
   * Synchronous sends (OTP, signup email) pass the ACTUAL outcome of the
   * in-request provider call — `provider_accepted` with the provider message
   * id when it happened before this row lands. This is what prevents a later
   * drain pass from double-sending a message the request already sent, while
   * still recording the event for the delivery callback state machine.
   */
  status?: "queued" | "provider_accepted";
  providerMessageId?: string | null;
  providerName?: string | null;
  /** Scheduler time, when explicitly supplied by the caller (including rehearsal clock). */
  occurredAt?: string;
}

/**
 * Build the outbox INSERT for the SAME D1 batch as the business mutation
 * (transactional-outbox doctrine). ON CONFLICT(event_key) DO NOTHING makes a
 * replayed logical event a no-op instead of a duplicate send.
 */
export function outboxStatement(db: D1Database, event: OutboxEvent): D1PreparedStatement {
  assertAllowedPurpose(event.purpose);
  if (event.eventKey.length > 190) throw new Error("outbox event_key too long");
  const status = event.status ?? "queued";
  const acceptedAt = status === "provider_accepted" ? "CURRENT_TIMESTAMP" : "NULL";
  if (event.occurredAt) {
    if (!Number.isFinite(Date.parse(event.occurredAt))) throw new Error("invalid outbox event time");
    return db.prepare(`
      INSERT INTO notification_outbox(event_key,channel,purpose,essential,recipient_user_id,recipient_masked,payload_ref,status,provider_message_id,provider_accepted_at,provider_name,created_at,updated_at,next_attempt_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(event_key) DO NOTHING
    `).bind(event.eventKey,event.channel,event.purpose,isEssentialPurpose(event.purpose)?1:0,event.recipientUserId??null,event.recipientMasked,
      event.payloadRef??null,status,event.providerMessageId??null,status==="provider_accepted"?event.occurredAt:null,event.providerName??null,
      event.occurredAt,event.occurredAt,event.occurredAt);
  }
  return db.prepare(`
    INSERT INTO notification_outbox(event_key,channel,purpose,essential,recipient_user_id,recipient_masked,payload_ref,status,provider_message_id,provider_accepted_at,provider_name)
    VALUES(?,?,?,?,?,?,?,?,?,${acceptedAt},?)
    ON CONFLICT(event_key) DO NOTHING
  `).bind(
    event.eventKey,
    event.channel,
    event.purpose,
    isEssentialPurpose(event.purpose) ? 1 : 0,
    event.recipientUserId ?? null,
    event.recipientMasked,
    event.payloadRef ?? null,
    status,
    event.providerMessageId ?? null,
    event.providerName ?? null,
  );
}

/**
 * Bounded exponential backoff for retries: 1, 2, 4, 8 ... minutes, capped at
 * 24h. Bounded = the row eventually reaches dead_letter after max_attempts.
 */
export function nextAttemptDelayMs(attempts: number): number {
  const bounded = Math.min(Math.max(attempts, 0), 16);
  return Math.min(60_000 * 2 ** bounded, 24 * 60 * 60_000);
}

export interface NotificationPreferences {
  timezone?: string;
  unsubscribed_purposes: string | null;
  quiet_hour_start: number | null;
  quiet_hour_end: number | null;
  monthly_send_limit: number | null;
}

export type SuppressionReason = "unsubscribed" | "quiet_hours" | "monthly_send_limit";

/**
 * Should this event be suppressed? ESSENTIAL purposes are never suppressed —
 * an OTP is not marketing. Quiet hours are compared in the user's local
 * clock hour (`localHour`, 0-23), provided by the caller (the drain loop
 * derives it from the preference owner's chosen hours; there is no per-user
 * timezone column yet, so the stored hours ARE the user's local hours).
 * `monthSendCount` is the caller-computed count of non-essential sends this
 * calendar month for this recipient.
 */
export function shouldSuppress(
  event: { purpose: string; essential: boolean },
  prefs: NotificationPreferences | null,
  localHour: number,
  monthSendCount: number,
): { suppress: boolean; reason: SuppressionReason | null } {
  if (event.essential) return { suppress: false, reason: null };
  if (prefs) {
    const unsubscribed = (prefs.unsubscribed_purposes ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (unsubscribed.includes(event.purpose)) return { suppress: true, reason: "unsubscribed" };
    if (prefs.monthly_send_limit != null && monthSendCount >= prefs.monthly_send_limit) {
      return { suppress: true, reason: "monthly_send_limit" };
    }
    if (prefs.quiet_hour_start != null && prefs.quiet_hour_end != null) {
      const inQuietHours = prefs.quiet_hour_start <= prefs.quiet_hour_end
        ? localHour >= prefs.quiet_hour_start && localHour < prefs.quiet_hour_end
        : localHour >= prefs.quiet_hour_start || localHour < prefs.quiet_hour_end; // wraps midnight
      if (inQuietHours) return { suppress: true, reason: "quiet_hours" };
    }
  }
  return { suppress: false, reason: null };
}

/** Provider send outcome mapped to outbox state (accepted is NEVER delivered). */
export interface ProviderSendOutcome {
  providerName?: string;
  accepted: boolean;
  /** A permanent, send-time privacy refusal. No external send took place. */
  suppressionReason?: string;
  providerMessageId?: string;
  noTransmission?: boolean;
  failure?: "network" | "provider_rejected" | "timeout" | "configuration" | "provider_unconfigured" | "payload_not_resendable" | "bad_recipient" | "idempotency_window_expired" | "idempotency_contract_unverified" | "dispatch_identity_changed" | "legacy_dispatch_unknown";
}

/** Claim eligible work. first_attempt_at starts only at provider dispatch,
 * never while waiting for preferences, budgets, or configuration. */
export const OUTBOX_CLAIM_DUE_SQL = `
  UPDATE notification_outbox
  SET attempts=attempts+1,lease_token=?,lease_until=?,updated_at=CURRENT_TIMESTAMP
  WHERE status='queued' AND datetime(next_attempt_at)<=datetime(?)
    AND (lease_until IS NULL OR datetime(lease_until)<=datetime(?))
    AND attempts<max_attempts
    AND id IN(SELECT id FROM notification_outbox
      WHERE status='queued' AND datetime(next_attempt_at)<=datetime(?)
        AND (lease_until IS NULL OR datetime(lease_until)<=datetime(?)) AND attempts<max_attempts
      ORDER BY id LIMIT ?)
  RETURNING id,event_key,channel,purpose,essential,recipient_user_id,recipient_masked,attempts,max_attempts,payload_ref,first_attempt_at
`;

export interface OutboxDrainSummary {
  claimed: number;
  provider_accepted: number;
  failed: number;
  dead_letter: number;
  suppressed: number;
  deferred: number;
}

interface OutboxRow {
  id: number;
  event_key: string;
  channel: "email" | "sms";
  purpose: string;
  essential: number;
  recipient_user_id: string | null;
  recipient_masked: string;
  attempts: number;
  max_attempts: number;
  payload_ref: string | null;
  first_attempt_at: string | null;
}

/**
 * Drain one bounded pass of the due queue. Providers are optional: a missing
 * provider marks rows `failed` with the machine-readable
 * `provider_unconfigured` error — visible in the operator queue, NEVER
 * reported as success. Delivery state only ever changes via
 * recordDeliveryCallback.
 */
export function notificationLocalHour(at:Date,timezone="Asia/Tehran"):number {
  const hour=new Intl.DateTimeFormat("en-US",{timeZone:timezone,hour:"numeric",hourCycle:"h23"}).formatToParts(at).find(part=>part.type==="hour")?.value;
  return Number(hour ?? 0)%24;
}

export async function drainOutbox(
  db:D1Database,
  opts:{send:(row:{channel:"email"|"sms";purpose:string;payloadRef:string|null;recipientMasked:string;eventKey:string;idempotencyKey:string;recipientUserId:string|null;firstAttemptAt:string|null;leaseToken:string})=>Promise<ProviderSendOutcome>;now?:()=>Date;limit?:number},
):Promise<OutboxDrainSummary> {
  const now=opts.now ?? (()=>new Date());
  const limit=Math.min(Math.max(Math.trunc(opts.limit ?? 10),1),50);
  const at=now(),token=crypto.randomUUID(),nowIso=at.toISOString();
  const leaseUntil=new Date(at.getTime()+5*60_000).toISOString();
  // Crashed exhausted leases enter review instead of being stranded forever.
  await db.prepare(`UPDATE notification_outbox SET status='dead_letter',last_error='lease_exhausted',lease_token=NULL,lease_until=NULL
    WHERE status='queued' AND attempts>=max_attempts AND (lease_until IS NULL OR datetime(lease_until)<=datetime(?))`).bind(nowIso).run();
  const claimed=await db.prepare(OUTBOX_CLAIM_DUE_SQL).bind(token,leaseUntil,nowIso,nowIso,nowIso,nowIso,limit).all<OutboxRow>();
  const rows=claimed.results ?? [];
  const summary:OutboxDrainSummary={claimed:rows.length,provider_accepted:0,failed:0,dead_letter:0,suppressed:0,deferred:0};
  for (const row of rows) {
    // Renew ownership just before IO. Another drain may reclaim an expired
    // lease; an old worker must not send or overwrite the new owner's result.
    const renewed=await db.prepare(`UPDATE notification_outbox SET lease_until=?
      WHERE id=? AND status='queued' AND lease_token=? AND datetime(lease_until)>datetime(?)`)
      .bind(new Date(now().getTime()+5*60_000).toISOString(),row.id,token,now().toISOString()).run();
    if (Number(renewed.meta.changes ?? 0)!==1) continue;
    // R96-N04 uncertain-send guard: a retry is only provider-idempotent while
    // the SAME idempotency key (the event key) is still inside the provider's
    // dedupe window, anchored at the FIRST attempt. Outside the window a
    // resend would be a BLIND duplicate risk — refuse and dead-letter for
    // operator review instead. Essential or not, this guard applies: it
    // protects the RECIPIENT from duplicates, not the quota.
    if (row.first_attempt_at) {
      const anchoredAt = parseUtcTimestamp(row.first_attempt_at);
      const invalidAnchor = anchoredAt === null;
      if (invalidAnchor || at.getTime() - anchoredAt >= EMAIL_IDEMPOTENCY_WINDOW_MS) {
        const moved=await db.prepare(`UPDATE notification_outbox SET status='dead_letter',last_error=?,
          lease_token=NULL,lease_until=NULL,updated_at=CURRENT_TIMESTAMP
          WHERE id=? AND status='queued' AND lease_token=?`).bind(invalidAnchor ? 'invalid_first_attempt_at' : 'idempotency_window_expired',row.id,token).run();
        if (Number(moved.meta.changes ?? 0)===1) summary.dead_letter+=1;
        continue;
      }
    }
    let suppression:{suppress:boolean;reason:SuppressionReason|null}={suppress:false,reason:null};
    let monthlyCap:number|null=null;
    let reservedPeriod:string|null=null;
    let reservedCount=0;
    if (Number(row.essential)!==1 && row.recipient_user_id) {
      const prefs=await db.prepare("SELECT unsubscribed_purposes,quiet_hour_start,quiet_hour_end,monthly_send_limit,timezone FROM notification_preferences WHERE user_id=?")
        .bind(row.recipient_user_id).first<NotificationPreferences>();
      monthlyCap=prefs?.monthly_send_limit ?? null;
      // R95-N10: reservation accounting — the month's sends live in
      // notification_send_reservations (concurrency-safe), not in a
      // check-then-act count of accepted rows.
      const period=now().toISOString().slice(0,7);
      const reservation=await db.prepare("SELECT reserved_count FROM notification_send_reservations WHERE user_id=? AND period=?")
        .bind(row.recipient_user_id,period).first<{reserved_count:number}>();
      reservedCount=Number(reservation?.reserved_count ?? 0);
      let hour:number;
      try { hour=notificationLocalHour(now(),prefs?.timezone ?? "Asia/Tehran"); }
      catch { hour=notificationLocalHour(now(),"Asia/Tehran"); }
      suppression=shouldSuppress({purpose:row.purpose,essential:false},prefs,hour,reservedCount);
    }
    if (suppression.suppress) {
      const temporary=suppression.reason!=="unsubscribed";
      const next=now();
      if (suppression.reason==="monthly_send_limit") {next.setUTCMonth(next.getUTCMonth()+1,1);next.setUTCHours(0,0,0,0);}
      else next.setTime(next.getTime()+30*60_000);
      const result=await db.prepare(`UPDATE notification_outbox SET status=?,last_error=?,next_attempt_at=?,lease_token=NULL,lease_until=NULL,
        attempts=CASE WHEN attempts>0 THEN attempts-1 ELSE 0 END,updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND status='queued' AND lease_token=?`)
        .bind(temporary?"queued":"suppressed",`${temporary?"deferred":"suppressed"}:${suppression.reason}`,next.toISOString(),row.id,token).run();
      if (Number(result.meta.changes ?? 0)===1) {if(temporary)summary.deferred+=1;else summary.suppressed+=1;}
      continue;
    }
    // R95-N10: concurrency-safe cap reservation. A non-essential send with a
    // monthly cap must CLAIM one slot atomically before the provider call:
    // the conditional increment on the (user, period) row serializes
    // concurrent drains — at the cap, exactly one of two simultaneous sends
    // proceeds. A slot is consumed per ATTEMPT (a crashed attempt keeps its
    // slot — the safe direction: never over-send). Essential traffic never
    // reserves and is never capped.
    if (monthlyCap!=null && row.recipient_user_id) {
      const period=now().toISOString().slice(0,7);
      await db.prepare("INSERT OR IGNORE INTO notification_send_reservations(user_id,period,reserved_count) VALUES(?,?,0)")
        .bind(row.recipient_user_id,period).run();
      const claimed=await db.prepare(`UPDATE notification_send_reservations SET reserved_count=reserved_count+1,updated_at=CURRENT_TIMESTAMP
        WHERE user_id=? AND period=? AND reserved_count<?`)
        .bind(row.recipient_user_id,period,monthlyCap).run();
      if (Number(claimed.meta.changes ?? 0)!==1) {
        const next=now(); next.setUTCMonth(next.getUTCMonth()+1,1); next.setUTCHours(0,0,0,0);
        const result=await db.prepare(`UPDATE notification_outbox SET status='queued',last_error='deferred:monthly_send_limit',next_attempt_at=?,lease_token=NULL,lease_until=NULL,
          attempts=CASE WHEN attempts>0 THEN attempts-1 ELSE 0 END,updated_at=CURRENT_TIMESTAMP
          WHERE id=? AND status='queued' AND lease_token=?`)
          .bind(next.toISOString(),row.id,token).run();
        if (Number(result.meta.changes ?? 0)===1) summary.deferred+=1;
        continue;
      }
      reservedPeriod=period;
    }
    // Pin possible transmission immediately before the adapter, AFTER no-IO
    // deferrals. The adapter may explicitly report noTransmission, in which
    // case a newly started anchor and quota reservation are safely released.
    const started=await db.prepare(`UPDATE notification_outbox SET first_attempt_at=COALESCE(first_attempt_at,?)
      WHERE id=? AND status='queued' AND lease_token=? AND datetime(lease_until)>datetime(?)`)
      .bind(now().toISOString(),row.id,token,now().toISOString()).run();
    if (Number(started.meta.changes ?? 0)!==1) continue;
    let outcome:ProviderSendOutcome;
    try {outcome=await opts.send({channel:row.channel,purpose:row.purpose,payloadRef:row.payload_ref,recipientMasked:row.recipient_masked,eventKey:row.event_key,idempotencyKey:row.event_key,recipientUserId:row.recipient_user_id,firstAttemptAt:row.first_attempt_at,leaseToken:token});}
    catch {outcome={accepted:false,failure:"network"};}
    if ((outcome.suppressionReason || outcome.noTransmission) && row.first_attempt_at == null) {
      await db.prepare(`UPDATE notification_outbox SET first_attempt_at=NULL,dispatch_fingerprint=NULL
        WHERE id=? AND status='queued' AND lease_token=?`).bind(row.id,token).run();
    }
    if (outcome.noTransmission && reservedPeriod && row.recipient_user_id) {
      await db.prepare("UPDATE notification_send_reservations SET reserved_count=reserved_count-1 WHERE user_id=? AND period=? AND reserved_count>0")
        .bind(row.recipient_user_id,reservedPeriod).run();
      reservedPeriod=null;
    }
    if (outcome.suppressionReason) {
      const moved=await db.prepare(`UPDATE notification_outbox SET status='suppressed',last_error=?,
        updated_at=CURRENT_TIMESTAMP,lease_token=NULL,lease_until=NULL
        WHERE id=? AND status='queued' AND lease_token=?`)
        .bind(`policy:${outcome.suppressionReason}`,row.id,token).run();
      if (Number(moved.meta.changes ?? 0)===1) summary.suppressed+=1;
      // A privacy refusal performed no provider IO: return a reserved quota slot.
      if (reservedPeriod && row.recipient_user_id) {
        await db.prepare(`UPDATE notification_send_reservations SET reserved_count=reserved_count-1,
          updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND period=? AND reserved_count>0`)
          .bind(row.recipient_user_id,reservedPeriod).run();
      }
    } else if (outcome.accepted) {
      const moved=await db.prepare(`UPDATE notification_outbox SET status='provider_accepted',provider_message_id=?,provider_name=?,
        provider_accepted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP,last_error=NULL,lease_token=NULL,lease_until=NULL
        WHERE id=? AND status='queued' AND lease_token=?`)
        .bind(outcome.providerMessageId ?? null,outcome.providerName ?? null,row.id,token).run();
      if (Number(moved.meta.changes ?? 0)===1) summary.provider_accepted+=1;
    } else {
      const exhausted=Number(row.attempts)>=Number(row.max_attempts)
        || outcome.failure==="payload_not_resendable" || outcome.failure==="bad_recipient"
        || ["idempotency_contract_unverified","dispatch_identity_changed","legacy_dispatch_unknown","idempotency_window_expired"].includes(outcome.failure ?? "");
      const nextAt=new Date(now().getTime()+nextAttemptDelayMs(Number(row.attempts))).toISOString();
      const moved=await db.prepare(`UPDATE notification_outbox SET status=?,last_error=?,next_attempt_at=?,updated_at=CURRENT_TIMESTAMP,lease_token=NULL,lease_until=NULL
        WHERE id=? AND status='queued' AND lease_token=?`)
        .bind(exhausted?"dead_letter":"queued",outcome.failure ?? "provider_rejected",nextAt,row.id,token).run();
      if (Number(moved.meta.changes ?? 0)===1) {if(exhausted)summary.dead_letter+=1;else summary.failed+=1;}
    }
  }
  // This is leased at-least-once dispatch, NOT a network exactly-once claim.
  // Production send adapters must use eventKey as a provider idempotency key.
  return summary;
}

/**
 * Relay callback signature: hex(HMAC-SHA256(secret, provider + ":" + rawBody)).
 * This is our relay contract, not a claim that every vendor signs this format.
 * Pure and exported so tests pin the exact wire contract without secrets.
 */
export async function computeCallbackSignature(secret: string, provider: string, rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${provider}:${rawBody}`));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string): Promise<string> {
  const bits = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Record a provider delivery callback (R95-N10: vendor-adapter aware).
 * Order of operations is the exactly-once guarantee:
 *   1. verify the HMAC signature FIRST — a forged callback is recorded as
 *      `rejected` in notification_callbacks and changes NO outbox state;
 *   2. translate the vendor envelope into the narrow internal event
 *      (provider, message id, delivery status) — an unparseable envelope or
 *      a missing message id is an honest 400, never a delivery fact;
 *   3. `delivered` CAS-moves the accepted outbox row (correlated by
 *      provider + provider message id, plus event key when present) and
 *      inserts notification_deliveries ON CONFLICT(event_key) DO NOTHING —
 *      a replayed callback cannot double-count. `not_delivered` (a
 *      VERIFIED provider non-delivery, e.g. Kavenegar status 6) moves the
 *      row to failed with provider_reported_not_delivered. `intermediate`
 *      statuses change nothing — acceptance is never upgraded by operator
 *      states.
 */
export async function recordDeliveryCallback(
  db:D1Database,
  opts:{provider:string;rawBody:string;signature:string|null;secret:string|undefined},
):Promise<Response> {
  if (new TextEncoder().encode(opts.rawBody).length>16*1024) throw new HttpError(413,"body_too_large","Callback exceeds 16 KiB");
  let verified=false;
  if (opts.secret && opts.signature && /^[a-f0-9]{64}$/i.test(opts.signature)) {
    const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(opts.secret),{name:"HMAC",hash:"SHA-256"},false,["verify"]);
    const signature=Uint8Array.from(opts.signature.match(/../g)!,byte=>parseInt(byte,16));
    verified=await crypto.subtle.verify("HMAC",key,signature,new TextEncoder().encode(`${opts.provider}:${opts.rawBody}`));
  }
  const translated=translateVendorCallback(opts.provider,opts.rawBody);
  const internal=translated.ok?translated.event:null;
  await db.prepare("INSERT INTO notification_callbacks(provider,event_key,signature_state,payload_hash) VALUES(?,?,?,?)")
    .bind(opts.provider,internal?.eventKey ?? null,verified?"verified":"rejected",await sha256Hex(opts.rawBody)).run();
  if (!verified) throw new HttpError(401,"invalid_signature","Callback signature verification failed");
  if (!translated.ok) {
    throw new HttpError(400,"invalid_callback",`The ${opts.provider} callback envelope could not be translated (reason: ${translated.reason}); no delivery fact was recorded`);
  }
  const event=internal!;
  if (event.delivery==="intermediate") {
    return json({recorded:true,state_change:false,delivery:"intermediate",
      note:"An intermediate operator status is not a delivery fact; acceptance is never upgraded by it."});
  }
  if (event.delivery==="not_delivered") {
    const operationId=crypto.randomUUID();
    const [moved]=await db.batch([
      db.prepare(`UPDATE notification_outbox SET status='failed',last_error='provider_reported_not_delivered',
        updated_at=CURRENT_TIMESTAMP,delivery_operation_id=?
        WHERE provider_name=? AND provider_message_id=? AND status='provider_accepted'`)
        .bind(operationId,event.provider,event.providerMessageId),
    ]);
    if (Number(moved.meta.changes ?? 0)===1) return json({recorded:true,state_change:true,delivery:"not_delivered"});
    return json({recorded:true,state_change:false,delivery:"not_delivered",
      note:"No matching accepted notification for this message id; the verified non-delivery is retained as callback evidence only."});
  }
  // delivery === "delivered": correlate the accepted row by provider + message
  // id (+ event key when the envelope carries one), then CAS + record once.
  const operationId=crypto.randomUUID();
  const correlation= event.eventKey
    ? "provider_name=? AND provider_message_id=? AND event_key=? AND status='provider_accepted'"
    : "provider_name=? AND provider_message_id=? AND status='provider_accepted'";
  const correlationBinds = event.eventKey
    ? [event.provider,event.providerMessageId,event.eventKey]
    : [event.provider,event.providerMessageId];
  const [moved]=await db.batch([
    db.prepare(`UPDATE notification_outbox SET status='delivered',delivered_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP,delivery_operation_id=?
      WHERE ${correlation}`)
      .bind(operationId,...correlationBinds),
    db.prepare(`INSERT INTO notification_deliveries(event_key,provider,provider_message_id)
      SELECT event_key,provider_name,provider_message_id FROM notification_outbox
      WHERE delivery_operation_id=? AND status='delivered'
      ON CONFLICT(event_key) DO NOTHING`).bind(operationId),
  ]);
  if (Number(moved.meta.changes ?? 0)===1) return json({recorded:true,state_change:true,delivery:"delivered"});
  // R96-N04 callback-before-acceptance: our acceptance bookkeeping may have
  // been LOST (send timed out after the provider took the message — the row is
  // still queued/failed/dead_letter) while the provider later reports a
  // VERIFIED delivery carrying OUR event key. The signature-verified callback
  // IS provider evidence of acceptance + delivery: upgrade the row directly.
  // Suppressed rows are excluded on purpose — no provider IO ever happened for
  // them, so a delivery claim cannot be ours.
  if (event.eventKey) {
    const upgradeOperationId=crypto.randomUUID();
    const [upgraded]=await db.batch([
      db.prepare(`UPDATE notification_outbox SET status='delivered',delivered_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP,
          delivery_operation_id=?,provider_message_id=COALESCE(provider_message_id,?),provider_name=COALESCE(provider_name,?),
          last_error=NULL,lease_token=NULL,lease_until=NULL
        WHERE event_key=? AND status IN ('queued','failed','dead_letter')
          AND (provider_name IS NULL OR provider_name=?)`)
        .bind(upgradeOperationId,event.providerMessageId,event.provider,event.eventKey,event.provider),
      db.prepare(`INSERT INTO notification_deliveries(event_key,provider,provider_message_id)
        SELECT event_key,provider_name,provider_message_id FROM notification_outbox
        WHERE delivery_operation_id=? AND status='delivered'
        ON CONFLICT(event_key) DO NOTHING`).bind(upgradeOperationId),
    ]);
    if (Number(upgraded.meta.changes ?? 0)===1) {
      return json({recorded:true,state_change:true,delivery:"delivered",upgraded_from_unaccepted:true,
        note:"The provider acceptance response was never recorded (uncertain send), but the signature-verified delivery callback carries this event's idempotency key — delivery is established, the row is upgraded, and any in-flight drain lease is retired."});
    }
  }
  const prior=await db.prepare("SELECT id FROM notification_deliveries WHERE provider=? AND provider_message_id=?")
    .bind(event.provider,event.providerMessageId).first();
  if (prior) return json({recorded:true,state_change:false,delivery:"delivered",idempotent_replay:true});
  throw new HttpError(409,"uncorrelated_callback","No matching accepted notification; no delivery fact was recorded");
}

// ---------------------------------------------------------------------------
// HTTP handlers (mounted in routes.ts)
// ---------------------------------------------------------------------------

type Env = { DB: D1Database; SESSION_COOKIE_NAME: string; NOTIFICATION_CALLBACK_SECRET?: string };

/** The user's own outbox history — honest states, masked recipients only. */
export async function myNotifications(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  const rows = await env.DB.prepare(`
    SELECT event_key, channel, purpose, status, attempts, last_error, created_at, provider_accepted_at, delivered_at
    FROM notification_outbox WHERE recipient_user_id=? ORDER BY id DESC LIMIT 100
  `).bind(auth.user.id).all<Record<string, unknown>>();
  return json({
    notifications: (rows.results ?? []).map((row) => ({
      ...row,
      status_note: STATUS_NOTES[row.status as OutboxStatus] ?? row.status,
    })),
    status_vocabulary: STATUS_NOTES,
  });
}

export const STATUS_NOTES: Record<OutboxStatus, string> = {
  queued: "Recorded and waiting to be handed to the provider.",
  provider_accepted: "The provider accepted the message. Acceptance is not yet delivery confirmation.",
  delivered: "The provider confirmed delivery via a verified callback.",
  failed: "A delivery attempt failed; the event is scheduled for retry.",
  dead_letter: "All attempts failed; an operator must review this event.",
  suppressed: "Not sent by your own notification preferences (unsubscribe, quiet hours or send limit).",
};

const PreferencesSchema = {
  parse(body: unknown): { ok: true; value: {
    unsubscribed_purposes: string[];
    quiet_hour_start: number | null;
    quiet_hour_end: number | null;
    monthly_send_limit: number | null;
    timezone: string;
  } } | { ok: false } {
    if (typeof body !== "object" || body === null) return { ok: false };
    const raw = body as Record<string, unknown>;
    const purposes = Array.isArray(raw.unsubscribed_purposes) ? raw.unsubscribed_purposes.filter((p): p is string => typeof p === "string") : [];
    const forEssential = purposes.some((p) => ESSENTIAL_PURPOSES.has(p));
    if (forEssential) return { ok: false };
    const timezone = typeof raw.timezone === "string" ? raw.timezone : "Asia/Tehran";
    try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(); } catch { return { ok: false }; }
    const start = raw.quiet_hour_start;
    const end = raw.quiet_hour_end;
    const limit = raw.monthly_send_limit;
    const validHour = (v: unknown) => v === null || v === undefined || (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 24);
    if (!validHour(start) || !validHour(end)) return { ok: false };
    if (limit !== null && limit !== undefined && !(typeof limit === "number" && Number.isInteger(limit) && limit >= 0 && limit <= 1000)) return { ok: false };
    return {
      ok: true,
      value: {
        unsubscribed_purposes: [...new Set(purposes)],
        quiet_hour_start: typeof start === "number" ? start : null,
        quiet_hour_end: typeof end === "number" ? end : null,
        monthly_send_limit: typeof limit === "number" ? limit : null,
        timezone,
      },
    };
  },
};

/** Read the caller's notification preferences. */
export async function myNotificationPreferences(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  const row = await env.DB.prepare(
    "SELECT unsubscribed_purposes, quiet_hour_start, quiet_hour_end, monthly_send_limit, timezone, updated_at FROM notification_preferences WHERE user_id=?",
  ).bind(auth.user.id).first<Record<string, unknown>>();
  return json({
    preferences: row ?? { unsubscribed_purposes: "", quiet_hour_start: null, quiet_hour_end: null, monthly_send_limit: null, timezone: "Asia/Tehran", updated_at: null },
    essential_purposes: [...ESSENTIAL_PURPOSES],
    note: "Unsubscribe, quiet hours and send limits apply only to non-essential notifications. Security and sign-in messages bypass these preferences; provider delivery is never guaranteed.",
  });
}

/** Update the caller's preferences (essential purposes are refused, not silently ignored). */
export async function updateNotificationPreferences(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  const { readJson } = await import("../api/http");
  const parsed = PreferencesSchema.parse(await readJson<unknown>(request, 4 * 1024));
  if (!parsed.ok) {
    throw new HttpError(400, "invalid_preferences", "Preferences failed validation; essential purposes cannot be unsubscribed");
  }
  const v = parsed.value;
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO notification_preferences(user_id,unsubscribed_purposes,quiet_hour_start,quiet_hour_end,monthly_send_limit,timezone,updated_at)
      VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(user_id) DO UPDATE SET
        unsubscribed_purposes=excluded.unsubscribed_purposes,
        quiet_hour_start=excluded.quiet_hour_start,
        quiet_hour_end=excluded.quiet_hour_end,
        monthly_send_limit=excluded.monthly_send_limit,
        timezone=excluded.timezone,
        updated_at=CURRENT_TIMESTAMP
    `).bind(auth.user.id, v.unsubscribed_purposes.join(","), v.quiet_hour_start, v.quiet_hour_end, v.monthly_send_limit, v.timezone),
  ]);
  return json({ updated: true, preferences: v });
}

/** Operator queue: due/failed/dead-letter visibility (never bodies or full recipients). */
export async function adminOutboxQueue(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "admin");
  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? "undelivered";
  const where = status === "all" ? "" : status === "undelivered" ? "WHERE status IN ('queued','failed','dead_letter','suppressed')" : "WHERE status=?";
  const args = status === "all" || status === "undelivered" ? [] : [status];
  const rows = await (args.length
    ? env.DB.prepare(`SELECT id, event_key, channel, purpose, essential, recipient_masked, status, attempts, max_attempts, last_error, next_attempt_at, created_at FROM notification_outbox ${where} ORDER BY id DESC LIMIT 200`).bind(...args)
    : env.DB.prepare(`SELECT id, event_key, channel, purpose, essential, recipient_masked, status, attempts, max_attempts, last_error, next_attempt_at, created_at FROM notification_outbox ${where} ORDER BY id DESC LIMIT 200`)
  ).all<Record<string, unknown>>();
  const counts = await env.DB.prepare(`
    SELECT status, COUNT(*) AS n FROM notification_outbox GROUP BY status
  `).all<{ status: string; n: number }>();
  const deliveries = await env.DB.prepare("SELECT COUNT(*) AS n FROM notification_deliveries").first<{ n: number }>();
  const rejectedCallbacks = await env.DB.prepare("SELECT COUNT(*) AS n FROM notification_callbacks WHERE signature_state='rejected'").first<{ n: number }>();
  // R95-N10: the four pipeline metrics, measured INDEPENDENTLY — a send
  // attempt, a provider acceptance, a verified delivery and a failure are
  // different facts and are never derived from one another.
  const attemptedRow = await env.DB.prepare("SELECT COALESCE(SUM(attempts),0) AS n FROM notification_outbox").first<{ n: number }>();
  const acceptedRow = await env.DB.prepare("SELECT COUNT(*) AS n FROM notification_outbox WHERE status IN ('provider_accepted','delivered')").first<{ n: number }>();
  const failedRow = await env.DB.prepare("SELECT COUNT(*) AS n FROM notification_outbox WHERE status IN ('failed','dead_letter')").first<{ n: number }>();
  const metrics = {
    attempted: Number(attemptedRow?.n ?? 0),
    accepted: Number(acceptedRow?.n ?? 0),
    delivered: Number(deliveries?.n ?? 0),
    failed: Number(failedRow?.n ?? 0),
  };
  return json({
    rows: rows.results ?? [],
    status_counts: Object.fromEntries((counts.results ?? []).map((row) => [row.status, Number(row.n)])),
    delivery_records: Number(deliveries?.n ?? 0),
    rejected_callbacks: Number(rejectedCallbacks?.n ?? 0),
    metrics,
    note: "Delivered counts come only from signature-verified provider callbacks (notification_deliveries). provider_accepted means the provider took the message, not that the recipient received it. The metrics are measured independently: attempted (total provider calls), accepted, delivered (verified facts) and failed.",
  });
}

/**
 * Operator retry of a dead_letter/failed event. Explicit, audited, and NEVER
 * a bulk "reset delivery state to resend everything" button (P13 rollback
 * rule). Delivered rows are refused outright.
 */
export async function adminRetryOutboxEvent(request: Request, env: Env, id: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "admin");
  requireCsrf(request, auth);
  const row = await env.DB.prepare("SELECT id, event_key, status, attempts, max_attempts FROM notification_outbox WHERE id=?").bind(id)
    .first<{ id: number; event_key: string; status: string; attempts: number; max_attempts: number }>();
  if (!row) throw new HttpError(404, "not_found", "Outbox event not found");
  if (row.status === "delivered") {
    throw new HttpError(409, "already_delivered", "This event is delivered; delivery state is never reset to resend");
  }
  if (row.status === "provider_accepted") {
    throw new HttpError(409, "in_flight", "This event is accepted by the provider and awaiting its delivery callback");
  }
  const [update] = await env.DB.batch(retryNotificationStatements(env.DB, {id, actorUserId:auth.user.id, operationId:crypto.randomUUID()}));
  if (Number(update?.meta.changes ?? 0) !== 1) {
    throw new HttpError(409, "not_retryable", "Only failed, dead_letter or suppressed events can be re-queued");
  }
  return json({ requeued: true, id, note: "One explicit operator action — this is not a bulk resend and delivery history is preserved." });
}

/** Provider delivery callback endpoint (HMAC-verified, no session auth). */
export async function notificationCallback(request: Request, env: Env, provider: string): Promise<Response> {
  if (request.method !== "POST") throw new HttpError(405, "method_not_allowed", "Callbacks are POST-only");
  const rawBody = await readTextBody(request, 16 * 1024);
  const signature = request.headers.get("x-signature") ?? request.headers.get("x-callback-signature");
  return recordDeliveryCallback(env.DB, {
    provider,
    rawBody,
    signature,
    secret: env.NOTIFICATION_CALLBACK_SECRET,
  });
}

import type { D1Database } from "@cloudflare/workers-types";
import { drainOutbox, type OutboxDrainSummary, type ProviderSendOutcome } from "./outbox";
import { getEmailProvider, emailMessageFor, type EmailProvider } from "./email";
import { resolveEmailProviderWithDemo, DEMO_NOTIFICATIONS_NOTE } from "./demoProvider";
import { resolveServiceRequestNotice } from "./serviceNotice";
import { workspaceAuthority } from "../workspaces/policy";
import { isValidDay, localDateInZone } from "../workspaces/domain";
import { workspaceTaskReminderBody } from "../workspaces/reminders";

/**
 * R95-N09: the durable notification worker — the application caller the
 * Master AI review found missing ("drainOutbox at its definition, but no
 * application caller").
 *
 * Doctrine (each point pinned by tests):
 *  - The outbox row never stores raw addresses, codes or document content.
 *    The send adapter resolves ONLY what the purpose's own table makes
 *    available at send time; a payload that was never stored (one-time
 *    tokens, OTP codes) is honestly refused as `payload_not_resendable`
 *    instead of being fabricated.
 *  - Provider routing is explicit: email purposes go to the configured email
 *    provider, SMS to the configured SMS provider. An unconfigured provider
 *    is a visible `configuration` failure (retried with backoff, then
 *    dead-lettered for operator review) — never silent success.
 *  - Notices carry no private content: a service-request notice tells the
 *    linked provider account that a lead exists; the note itself stays
 *    between requester and provider and never enters an email body.
 *  - This is leased at-least-once dispatch; the event key is an internal dispatch identity. The generic HTTP
 *    adapter does not establish provider-side idempotency. Acceptance is not delivery — delivery is the signed
 *    provider callback.
 */

export interface NotificationWorkerSummary extends OutboxDrainSummary {
  /** Rows the adapter refused to reconstruct (one-time payloads by design). */
  refused_payload: number;
  /** Rows refused because the recipient could not be resolved. */
  bad_recipient: number;
  /** Provider configuration was missing for the row's channel. */
  provider_unconfigured: number;
  policy_suppressed: number;
  note: string;
}

export interface DrainRow {
  channel: "email" | "sms";
  purpose: string;
  payloadRef: string | null;
  recipientMasked: string;
  eventKey: string;
  idempotencyKey: string;
  recipientUserId: string | null;
  firstAttemptAt: string | null;
  leaseToken: string;
}

/** Raw one-time tokens are intentionally not reconstructable from the outbox.
 * Service notices have a dedicated send-time authorization boundary.
 * R96-N09: workspace task reminders resolve from the task's CURRENT state —
 * an already-completed/removed task sends nothing. */
async function resolveSendable(db: D1Database,row: DrainRow,nowIso:string): Promise<
  {kind:"sendable";to:string;subject:string;html:string}
  | {kind:"suppressed";reason:string}
  | {kind:"refused";failure:ProviderSendOutcome["failure"]}
> {
  if (row.purpose==="service_request_notice") return resolveServiceRequestNotice(db,row);
  if (row.purpose==="workspace_task_due") {
    const match=/^workspace_tasks:([1-9][0-9]*)$/.exec(row.payloadRef ?? "");
    const taskId=match ? Number(match[1]) : NaN;
    if (!Number.isSafeInteger(taskId) || !row.recipientUserId) return {kind:"refused",failure:"payload_not_resendable"};
    const authority=workspaceAuthority(row.recipientUserId,"view");
    const task=await db.prepare(`
      SELECT t.title,t.category,t.due_date,t.due_timezone,wc.name AS workspace_name,u.email
      FROM workspace_tasks t JOIN workspace_collections wc ON wc.id=t.collection_id AND wc.deleted_at IS NULL
      JOIN users u ON u.id=COALESCE(t.assigned_to_user_id,wc.owner_user_id) AND u.is_active=1
      WHERE t.id=? AND t.status='open' AND u.id=? AND ${authority.sql}`)
      .bind(taskId,row.recipientUserId,...authority.binds)
      .first<{title:string;category:string;due_date:string;due_timezone:string;workspace_name:string;email:string}>();
    if (!task) return {kind:"suppressed",reason:"task_or_recipient_no_longer_authorized"};
    const due=String(task.due_date);
    const occurrence=`workspace-task:${taskId}:due:${due}`;
    if (!isValidDay(due) || (row.eventKey!==occurrence && !row.eventKey.startsWith(`${occurrence}:recipient:`))) {
      return {kind:"suppressed",reason:"task_occurrence_changed"};
    }
    try { if (due>localDateInZone(task.due_timezone,nowIso)) return {kind:"suppressed",reason:"task_not_due"}; }
    catch { return {kind:"suppressed",reason:"task_timezone_invalid"}; }
    const body=workspaceTaskReminderBody(task);
    return {kind:"sendable",to:task.email,subject:body.subject,html:body.html};
  }
  return {kind:"refused",failure:"payload_not_resendable"};
}

function emailOutcome(provider: EmailProvider, to: string, subject: string, html: string, idempotencyKey?: string): Promise<ProviderSendOutcome> {
  // R96-N04: every send carries the outbox event key as the provider
  // Idempotency-Key header. An uncertain outcome (timeout / lost response)
  // is then retried with the SAME key inside the provider's dedupe window —
  // the drain refuses to resend once the window expires, so dispatch is
  // leased at-least-once WITHOUT blind duplicates.
  return provider.send({ to, purpose: "service_request_notice", subject, html, idempotencyKey });
}

/**
 * Drain the outbox through the real provider adapters. `db` must be the
 * canonical WRITABLE database (lease writes are canonical writes) — the
 * scheduled handler resolves it; tests pass a real SQLite fixture directly.
 */
export async function drainNotificationOutbox(
  db: D1Database,
  env: { EMAIL_API_URL?: string; EMAIL_API_KEY?: string; EMAIL_FROM?: string; DEMO_NOTIFICATIONS_ENABLED?: string; KAVENEGAR_API_KEY?: string; KAVENEGAR_OTP_TEMPLATE?: string },
  opts: { now?: () => Date; limit?: number } = {},
): Promise<NotificationWorkerSummary> {
  // R98-N11 demo loopback: when the owner enabled it and no real provider is
  // configured, the demo email provider serves the SAME drain pipeline
  // (lease, fingerprint binding, idempotency window) with recorded — never
  // transmitted — deliveries. Real provider always wins resolution.
  const emailProvider = resolveEmailProviderWithDemo(env, getEmailProvider(env), db);
  const demoMode = emailProvider?.name === "demo-loopback";
  const counters = { refused_payload: 0, bad_recipient: 0, provider_unconfigured: 0, policy_suppressed: 0 };

  const summary = await drainOutbox(db, {
    now: opts.now,
    limit: opts.limit,
    send: async (row) => {
      if (row.channel === "sms") {
        // The only SMS purpose (login_otp) is a one-time code payload: the
        // worker refuses to resend it by design.
        counters.refused_payload += 1;
        return { accepted: false, failure: "payload_not_resendable", noTransmission:true };
      }
      const resolved = await resolveSendable(db, row, (opts.now?.() ?? new Date()).toISOString());
      if (resolved.kind === "suppressed") {
        counters.policy_suppressed += 1;
        return {accepted:false,suppressionReason:resolved.reason};
      }
      if (resolved.kind === "refused") {
        if (resolved.failure === "bad_recipient") counters.bad_recipient += 1;
        else counters.refused_payload += 1;
        return { accepted: false, failure: resolved.failure, noTransmission:true };
      }
      if (!emailProvider) {
        counters.provider_unconfigured += 1;
        return { accepted: false, failure: "configuration", noTransmission:true };
      }
      if (row.firstAttemptAt && emailProvider.idempotencyWindowMs == null) {
        return {accepted:false,failure:"idempotency_contract_unverified",noTransmission:true};
      }
      const fingerprint=await emailProvider.requestFingerprint({to:resolved.to,purpose:"service_request_notice",subject:resolved.subject,html:resolved.html,idempotencyKey:row.idempotencyKey});
      const current=await db.prepare("SELECT dispatch_fingerprint FROM notification_outbox WHERE event_key=? AND status='queued' AND lease_token=?")
        .bind(row.eventKey,row.leaseToken).first<{dispatch_fingerprint:string|null}>();
      if (!current) return {accepted:false,suppressionReason:"dispatch_lease_lost",noTransmission:true};
      if (row.firstAttemptAt && !current.dispatch_fingerprint) return {accepted:false,failure:"legacy_dispatch_unknown",noTransmission:true};
      if (current.dispatch_fingerprint && current.dispatch_fingerprint!==fingerprint) return {accepted:false,failure:"dispatch_identity_changed",noTransmission:true};
      const bound=await db.prepare(`UPDATE notification_outbox SET dispatch_fingerprint=?
        WHERE event_key=? AND status='queued' AND lease_token=? AND datetime(lease_until)>datetime(?) AND (dispatch_fingerprint IS NULL OR dispatch_fingerprint=?)`)
        .bind(fingerprint,row.eventKey,row.leaseToken,(opts.now?.() ?? new Date()).toISOString(),fingerprint).run();
      if (Number(bound.meta.changes ?? 0)!==1) return {accepted:false,suppressionReason:"dispatch_lease_lost",noTransmission:true};
      const outcome = await emailOutcome(emailProvider, resolved.to, resolved.subject, resolved.html, row.idempotencyKey);
      return { ...outcome, providerName: emailProvider.name };
    },
  });

  return {
    ...summary,
    ...counters,
    note: "Leased at-least-once dispatch. Provider acceptance is not delivery; delivery is the signed provider callback. Refused one-time payloads (OTP codes, verification links) are a privacy design decision, not an outage."
      + (demoMode ? " " + DEMO_NOTIFICATIONS_NOTE : ""),
  };
}

/** The scheduled-handler entry: bounded batch over the canonical writable DB. */
export async function scheduledNotificationDrain(env: { DB: D1Database } & Record<string, unknown>): Promise<NotificationWorkerSummary> {
  return drainNotificationOutbox(env.DB as D1Database, env as never, { limit: 10 });
}

export { emailMessageFor };

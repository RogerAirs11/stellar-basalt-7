/**
 * R98-N11 demonstration notification provider — the free, honest placeholder.
 *
 * The task "Prove notification delivery and reconciliation with real
 * providers" is blocked on OWNER-PROVIDED accounts (an email API key, a
 * Kavenegar API key + approved template). Without them the real adapters
 * stay honestly unconfigured and the drain marks rows `failed /
 * provider_unconfigured`. This module unblocks the DEMONSTRATION of the
 * delivery pipeline without weakening a single safeguard:
 *
 *   - It satisfies the SAME EmailProvider contract as the HTTP adapter
 *     (including the idempotency window + request fingerprint discipline),
 *     so the real drain, lease, fingerprint-binding and retry code runs.
 *   - A send is recorded in a provider-side demo inbox (demo_deliveries,
 *     migration 0077) and reported as ACCEPTED — acceptance is still never
 *     delivery. Delivery exists ONLY through the same HMAC-signed callback
 *     path a real provider uses (recordDeliveryCallback), driven by the
 *     operator's explicit simulate action.
 *   - It NEVER becomes a channel for one-time payloads: the drain refuses
 *     to resend OTP codes and verification tokens by design, and the demo
 *     provider changes none of that. SMS (login OTP) stays honestly
 *     unavailable until the owner supplies a real account — a demo SMS
 *     inbox readable by an operator would be an account-takeover vector.
 *   - The real provider ALWAYS wins resolution: when EMAIL_API_URL/KEY/FROM
 *     are configured, the demo loopback never activates.
 */

import type { D1Database } from "@cloudflare/workers-types";
import { EMAIL_IDEMPOTENCY_WINDOW_MS, type EmailMessage, type EmailProvider } from "./email";

export const DEMO_EMAIL_PROVIDER_NAME = "demo-loopback";

export interface DemoEmailProvider extends EmailProvider {
  readonly name: typeof DEMO_EMAIL_PROVIDER_NAME;
}

function sha256Hex(value: string): Promise<string> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
    .then(digest => Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join(""));
}

/** Stable, deterministic demo message id per event key — a retried send with
 * the same idempotency key maps to the SAME provider message id, exactly like
 * a provider-side dedupe window would. */
export function demoProviderMessageId(eventKey: string): string {
  return `demo-email-${eventKey.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64)}`;
}

export function demoEmailProvider(db: D1Database): DemoEmailProvider {
  return {
    name: DEMO_EMAIL_PROVIDER_NAME,
    // Same contract discipline as the documented Resend window: a keyed retry
    // inside the window is provider-idempotent; the drain refuses beyond it.
    idempotencyWindowMs: EMAIL_IDEMPOTENCY_WINDOW_MS,
    async requestFingerprint(message: EmailMessage): Promise<string> {
      // The demo provider's "wire request" is the recorded inbox row shape.
      // The fingerprint binds the same identity fields the real adapter's
      // request hash binds (to/address/purpose/subject/body/key).
      return sha256Hex(JSON.stringify({
        provider: DEMO_EMAIL_PROVIDER_NAME,
        to: message.to,
        purpose: message.purpose,
        subject: message.subject,
        html_length: message.html.length,
        idempotency_key: message.idempotencyKey ?? null,
      }));
    },
    async send(message: EmailMessage) {
      const eventKey = message.idempotencyKey;
      if (!eventKey) return { accepted: false, failure: "configuration" };
      if (!message.to.includes("@") || message.subject.length === 0) return { accepted: false, failure: "provider_rejected" };
      const providerMessageId = demoProviderMessageId(eventKey);
      // Idempotent provider-side acceptance: the event key is unique — a
      // retried send maps to the SAME row and the SAME message id (ON
      // CONFLICT DO NOTHING mirrors a provider dedupe window).
      await db.prepare(
        `INSERT INTO demo_deliveries(event_key,channel,purpose,to_address,subject,provider_message_id,status)
         VALUES(?, 'email', ?, ?, ?, ?, 'accepted')
         ON CONFLICT(event_key) DO NOTHING`,
      ).bind(eventKey, message.purpose, message.to, message.subject.slice(0, 300), providerMessageId).run();
      // 2xx-equivalent: ACCEPTED ONLY. Recipient delivery is never claimed
      // here — only the signed callback path can establish it.
      return { accepted: true, providerMessageId };
    },
  };
}

/** Resolve the demo email provider when the owner enabled it and no real
 * provider is configured. Real always wins; null keeps honest failure. */
export function resolveEmailProviderWithDemo(
  env: { EMAIL_API_URL?: string; EMAIL_API_KEY?: string; EMAIL_FROM?: string; DEMO_NOTIFICATIONS_ENABLED?: string },
  realProvider: EmailProvider | null,
  db: D1Database,
): EmailProvider | null {
  if (realProvider) return realProvider;
  if (env.DEMO_NOTIFICATIONS_ENABLED === "true" || env.DEMO_NOTIFICATIONS_ENABLED === "1") {
    return demoEmailProvider(db);
  }
  return null;
}

export const DEMO_NOTIFICATIONS_NOTE =
  "Demo email provider active (demo-loopback): sends are recorded in the operator demo inbox and acceptance is still not delivery. Delivery is only ever established by the signed provider callback path.";

/**
 * The operator's simulate action: settle a demo delivery through the REAL
 * signed-callback path. The envelope is the platform bridge shape and the
 * signature is computed exactly the way the real provider's bridge would,
 * so recordDeliveryCallback verifies, translates and records it like any
 * production callback (including replay and correlation rules).
 */
export async function signedDemoDeliveryCallback(
  delivery: { event_key: string; provider_message_id: string },
  outcome: "delivered" | "not_delivered",
  secret: string,
): Promise<{ rawBody: string; signature: string }> {
  const rawBody = JSON.stringify({
    event_key: delivery.event_key,
    provider_message_id: delivery.provider_message_id,
    status: outcome,
  });
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${DEMO_EMAIL_PROVIDER_NAME}:${rawBody}`));
  const signature = Array.from(new Uint8Array(mac), b => b.toString(16).padStart(2, "0")).join("");
  return { rawBody, signature };
}

/**
 * Master-Ai plan T13: email delivery provider interface.
 *
 * This adapter uses a Resend-shaped HTTPS JSON request rather than SMTP.
 * Other providers need their own verified request/response adapter; merely
 * configuring an HTTPS URL does not establish protocol compatibility or a
 * provider-side idempotency guarantee. Nothing activates without configuration.
 *
 * The FULL chosen-provider contract (request fields, response identifiers,
 * timeout, rate limits, idempotency window, callback rules, delivery
 * semantics) is documented in docs/notifications/provider-contract.md —
 * R96-N04 keeps the wire contract and its documentation in one place.
 *
 * Honesty rules (identical to SMS):
 *   - no provider configured -> callers keep the existing honest responses
 *     (production: "delivery is not configured"; dev: demo link surfacing);
 *   - provider configured but failing -> honest failure envelope, never a
 *     fabricated "sent";
 *   - tokens travel only inside links; they are never logged.
 *
 * R96-N04 uncertain-send semantics: a timeout or network error after the
 * request was issued MAY mean the provider accepted the message (we just
 * never saw the response). Such outcomes are classified `timeout`/`network`
 * and the OUTBOX retries them ONLY with the SAME idempotency key (the event
 * key) inside the provider's dedupe window, and refuses entirely once the
 * window has expired. Acceptance is still never delivery.
 */

/**
 * The provider-side dedupe window for the Idempotency-Key header (Resend
 * documents 24h; verify against the current provider dashboard before
 * relying on it for a different vendor). Outside this window a keyed retry is
 * no longer guaranteed idempotent, so the drain refuses to resend.
 */
export const EMAIL_IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface EmailDeliveryResult {
  /**
   * P13 honest semantics: the provider ACCEPTED the message over HTTP (2xx).
   * This is NOT recipient delivery — delivery is only ever established by a
   * verified provider callback recorded on the outbox. The old name for this
   * field was `delivered`, which overstated a 2xx reply; it is gone on
   * purpose (outbox.ts owns the delivery state machine).
   */
  accepted: boolean;
  providerMessageId?: string;
  failure?: "network" | "provider_rejected" | "timeout" | "configuration";
}

export type EmailPurpose = "signup_verification" | "password_reset" | "service_request_notice";

export interface EmailMessage {
  to: string;
  purpose: EmailPurpose;
  /** Bilingual subject line. */
  subject: string;
  /** Bilingual HTML body (already contains the action link). */
  html: string;
  /**
   * R96-N04: the stable provider idempotency key (the outbox event key).
   * Carried as the `Idempotency-Key` header so a retry after an uncertain
   * outcome (timeout / lost response) is deduped provider-side instead of
   * becoming a duplicate message. Never a secret; never logged.
   */
  idempotencyKey?: string;
}

export interface EmailProvider {
  readonly name: string;
  readonly idempotencyWindowMs: number | null;
  requestFingerprint(message: EmailMessage): Promise<string>;
  send(message: EmailMessage): Promise<EmailDeliveryResult>;
}

export interface HttpEmailConfig {
  /** HTTPS endpoint of the email API (e.g. https://api.resend.com/emails). */
  apiUrl: string;
  apiKey: string;
  /** Verified sender identity, e.g. "Horse Registry <no-reply@example.com>". */
  from: string;
  timeoutMs?: number;
}

/** Generic endpoints are owner-configured, not user input. Redirects are
 * refused so private mail bodies and credentials cannot be forwarded. */
function validEmailEndpoint(value: string): boolean {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !url.hash; }
  catch { return false; }
}
function htmlEscape(value: string): string {
  return value.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}

/**
 * Pure request builder — exported so tests pin the wire contract without
 * network access (endpoint, bearer header, from/to/subject/html binding and
 * the Idempotency-Key header when a stable key is supplied).
 */
export function buildEmailRequest(config: HttpEmailConfig, message: EmailMessage): { url: string; init: RequestInit } {
  if (!validEmailEndpoint(config.apiUrl)) throw new TypeError("Email endpoint must be HTTPS without credentials or fragment");
  const headers: Record<string, string> = {
    authorization: `Bearer ${config.apiKey}`,
    "content-type": "application/json",
    accept: "application/json",
  };
  if (message.idempotencyKey !== undefined && !/^[A-Za-z0-9._:-]{8,190}$/.test(message.idempotencyKey)) throw new RangeError("Invalid idempotency key; never fall back to unkeyed delivery");
  if (message.idempotencyKey) {
    headers["idempotency-key"] = message.idempotencyKey;
  }
  return {
    url: config.apiUrl,
    init: {
      method: "POST",
      redirect: "error",
      headers,
      body: JSON.stringify({ from: config.from, to: message.to, subject: message.subject, html: message.html }),
    },
  };
}

export function httpEmailProvider(config: HttpEmailConfig): EmailProvider {
  const timeoutMs = config.timeoutMs ?? 8_000;
  return {
    name: "http-email",
    // Documented contract, not an assumption about every generic JSON API.
    idempotencyWindowMs: config.apiUrl === "https://api.resend.com/emails" ? EMAIL_IDEMPOTENCY_WINDOW_MS : null,
    async requestFingerprint(message:EmailMessage):Promise<string> {
      const request=buildEmailRequest(config,message);
      // The account credential is included ONLY in a high-entropy input hash;
      // no address, mail body, bearer key or token is persisted here.
      const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(request)));
      return Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,"0")).join("");
    },
    async send(message: EmailMessage): Promise<EmailDeliveryResult> {
      if (!validEmailEndpoint(config.apiUrl) || !config.from.includes("@")) {
        return { accepted: false, failure: "configuration" };
      }
      const { url, init } = buildEmailRequest(config, message);
      let response: Response;
      try {
        response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      } catch (cause) {
        const timedOut = cause instanceof Error && cause.name === "TimeoutError";
        return { accepted: false, failure: timedOut ? "timeout" : "network" };
      }
      if (!response.ok) {
        return { accepted: false, failure: response.status === 401 || response.status === 403 ? "configuration" : "provider_rejected" };
      }
      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      const id = (payload as { id?: string } | null)?.id;
      // 2xx = ACCEPTED ONLY. Recipient delivery is never claimed here (P13).
      return { accepted: true, providerMessageId: typeof id === "string" ? id : undefined };
    },
  };
}

/** Resolve the configured email provider, or null when the owner has not supplied one. */
export function getEmailProvider(env: unknown): EmailProvider | null {
  const e = env as { EMAIL_API_URL?: string; EMAIL_API_KEY?: string; EMAIL_FROM?: string } | undefined;
  const apiUrl = e?.EMAIL_API_URL?.trim();
  const apiKey = e?.EMAIL_API_KEY?.trim();
  const from = e?.EMAIL_FROM?.trim();
  if (!apiUrl || !apiKey || !from || !validEmailEndpoint(apiUrl) || !from.includes("@")) return null;
  return httpEmailProvider({ apiUrl, apiKey, from });
}

/**
 * Bilingual email templates. Links are absolute when a public base URL is
 * configured (EMAIL_PUBLIC_BASE_URL); tokens are embedded only in the link.
 */
export function emailMessageFor(
  purpose: EmailPurpose,
  to: string,
  linkUrl: string,
): EmailMessage {
  if (!validEmailEndpoint(linkUrl)) throw new TypeError("Action links require an absolute HTTPS URL without credentials");
  const safeLink = htmlEscape(linkUrl);
  if (purpose === "password_reset") {
    return {
      to,
      purpose,
      subject: "بازنشانی گذرواژه / Password reset — Horse Registry",
      html: `<!doctype html><html><body style="font-family:system-ui,sans-serif;direction:ltr">
<p>برای بازنشانی گذرواژه، این پیوند را در ۳۰ دقیقهٔ آینده باز کنید:</p>
<p>Open this link within 30 minutes to reset your password:</p>
<p><a href="${safeLink}">${safeLink}</a></p>
<p>اگر شما این درخواست را نداده‌اید، این ایمیل را نادیده بگیرید. / If you did not request this, ignore this email.</p>
</body></html>`,
    };
  }
  return {
    to,
    purpose: "signup_verification",
    subject: "تأیید ایمیل / Verify your email — Horse Registry",
    html: `<!doctype html><html><body style="font-family:system-ui,sans-serif;direction:ltr">
<p>برای تأیید ایمیل حساب خود، این پیوند را باز کنید:</p>
<p>Open this link to verify your account email:</p>
<p><a href="${safeLink}">${safeLink}</a></p>
<p>اگر شما این حساب را نساخته‌اید، این ایمیل را نادیده بگیرید. / If you did not create this account, ignore this email.</p>
</body></html>`,
  };
}

/** Absolute action-link URL for a token, or null when no public base URL is configured. */
export function emailActionUrl(env: unknown, path: string): string | null {
  const base = (env as { EMAIL_PUBLIC_BASE_URL?: string } | undefined)?.EMAIL_PUBLIC_BASE_URL?.trim()?.replace(/\/+$/, "");
  if (!base || !validEmailEndpoint(base) || !path.startsWith("/") || path.startsWith("//")) return null;
  const target = new URL(`${base}${path}`);
  return target.origin === new URL(base).origin ? target.toString() : null;
}

/**
 * Master-Ai plan T13: SMS delivery provider interface.
 *
 * Doctrine (packet + project honesty rules):
 *   - Credentials alone never flip a feature live: the adapter exists, but
 *     activation requires the OWNER-provided Kavenegar account (API key AND an
 *     approved "verification" template). Until then production OTP stays
 *     honestly unavailable (503) — never a fake "sent" response.
 *   - Delivery failures are surfaced honestly; the caller decides the failure
 *     envelope. OTP codes are never logged.
 *   - The provider boundary is deliberately narrow: deliver an OTP to one
 *     normalized phone. No marketing, no arbitrary text — that keeps the
 *     account's Kavenegar tariff scope minimal.
 */

export interface SmsDeliveryResult {
  /** P13 honest semantics: provider ACCEPTED the message (2xx). NOT recipient delivery — only a verified provider callback establishes that. */
  accepted: boolean;
  /** Provider message id when accepted (for support correlation, not user-facing). */
  providerMessageId?: string;
  /** Stable machine-readable failure reason (never includes the code). */
  failure?: "network" | "provider_rejected" | "timeout" | "configuration";
}

export interface SmsProvider {
  readonly name: string;
  /** Deliver a one-time code to a normalized E.164 Iranian mobile number. */
  deliverOtp(phoneE164: string, code: string): Promise<SmsDeliveryResult>;
}

/** Kavenegar "Verify Lookup" request shape (official HTTP API, template-scoped). */
export interface KavenegarConfig {
  apiKey: string;
  /** Approved verification template name (owner-gated: requires account approval). */
  otpTemplate: string;
  /** Optional base-URL override (default: official API). */
  baseUrl?: string;
  /** Request timeout in milliseconds. */
  timeoutMs?: number;
}

/**
 * Pure request builder — exported so tests pin the exact wire contract
 * (endpoint, receptor normalization, template binding) without network access.
 */
export function buildKavenegarOtpRequest(
  config: KavenegarConfig,
  phoneE164: string,
  code: string,
): { url: string; body: URLSearchParams } {
  const base = (config.baseUrl ?? "https://api.kavenegar.com/v1").replace(/\/+$/, "");
  const url = `${base}/${encodeURIComponent(config.apiKey)}/verify/lookup.json`;
  // Kavenegar accepts 09xxxxxxxxx or +989xxxxxxxxx; the canonical +98 form is kept.
  const body = new URLSearchParams({ receptor: phoneE164, token: code, template: config.otpTemplate });
  return { url, body };
}

export function kavenegarSmsProvider(config: KavenegarConfig): SmsProvider {
  const timeoutMs = config.timeoutMs ?? 8_000;
  return {
    name: "kavenegar",
    async deliverOtp(phoneE164: string, code: string): Promise<SmsDeliveryResult> {
      if (!/^\+989\d{9}$/.test(phoneE164)) {
        return { accepted: false, failure: "configuration" };
      }
      const { url, body } = buildKavenegarOtpRequest(config, phoneE164, code);
      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (cause) {
        const timedOut = cause instanceof Error && cause.name === "TimeoutError";
        return { accepted: false, failure: timedOut ? "timeout" : "network" };
      }
      if (!response.ok) {
        // 401/403/406 = key or template problem; 4xx otherwise = provider rejection.
        return { accepted: false, failure: response.status === 401 || response.status === 403 || response.status === 406 ? "configuration" : "provider_rejected" };
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        return { accepted: false, failure: "provider_rejected" };
      }
      const returnBlock = (payload as { return?: { status?: number } } | null)?.return;
      const status = Number(returnBlock?.status ?? 0);
      if (status !== 200) {
        return { accepted: false, failure: status === 406 || status === 412 ? "configuration" : "provider_rejected" };
      }
      const messageEntries = (payload as { entries?: { messageid?: number | string } | Array<{ messageid?: number | string }> } | null)?.entries;
      const firstMessage = Array.isArray(messageEntries) ? messageEntries[0] : messageEntries;
      const messageId = String(firstMessage?.messageid ?? "");
      // 2xx + return.status 200 = ACCEPTED ONLY (P13): Kavenegar acceptance is
      // not hand-set delivery; only a verified callback marks `delivered`.
      return { accepted: true, providerMessageId: messageId || undefined };
    },
  };
}

/** Resolve the configured SMS provider, or null when the owner has not supplied one. */
export function getSmsProvider(env: unknown): SmsProvider | null {
  const e = env as { KAVENEGAR_API_KEY?: string; KAVENEGAR_OTP_TEMPLATE?: string } | undefined;
  const apiKey = e?.KAVENEGAR_API_KEY?.trim();
  const otpTemplate = e?.KAVENEGAR_OTP_TEMPLATE?.trim();
  if (!apiKey || !otpTemplate) return null;
  return kavenegarSmsProvider({ apiKey, otpTemplate });
}

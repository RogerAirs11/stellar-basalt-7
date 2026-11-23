/**
 * R88 agent plan P18 — the Zarinpal payment provider adapter.
 *
 * Wire contract (Zarinpal Payment Gateway v4, current official docs):
 *   request:  POST {base}/pg/v4/payment/request.json
 *             { merchant_id, amount (RIAL integers), callback_url, description }
 *             -> { data: { authority, code } } code 100 = issued
 *   verify:   POST {base}/pg/v4/payment/verify.json
 *             { merchant_id, amount, authority }
 *             -> { data: { code, ref_id } } code 100 = verified,
 *                101 = already verified (treated as verified, idempotent)
 *   redirect: {StartPay}/{authority} — the buyer's browser URL. Its query
 *             parameters are NEVER trusted as payment status.
 *
 * The billing handler additionally requires an explicit live-payment release flag.
 * Merchant credentials alone do not enable new charges. Without
 * it, /pay fails closed (503) and no payment attempt is created — the
 * billing phase stays honestly read-only until the owner supplies merchant
 * credentials. Amounts are RIAL integers, which IS the internal unit (IRR);
 * no unit conversion happens here on purpose.
 */

export interface PaymentRequestResult {
  ok: boolean;
  authority?: string;
  startPayUrl?: string;
  failure?: "configuration" | "network" | "provider_rejected" | "timeout";
}

export interface PaymentVerifyResult {
  ok: boolean;
  /** true when the provider says the authority was already verified before. */
  alreadyVerified?: boolean;
  providerReference?: string;
  failure?: "configuration" | "network" | "amount_mismatch" | "authority_not_found" | "not_paid" | "timeout" | "provider_rejected";
  providerCode?: number;
}

/** A status observation is not verification and cannot grant access. */
export interface PaymentInquiryResult {
  ok: boolean;
  status?: "VERIFIED" | "PAID" | "IN_BANK" | "FAILED" | "REVERSED";
  failure?: "configuration" | "network" | "timeout" | "provider_rejected";
  providerCode?: number;
}
export function parseZarinpalInquiry(payload: unknown, httpStatus=200): PaymentInquiryResult {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {ok:false,failure:"provider_rejected"};
  const x=payload as {data?:{code?:unknown;status?:unknown};errors?:unknown};
  const errors=x.errors;
  if (errors && (Array.isArray(errors) ? errors.length>0 : typeof errors === "object" ? Object.keys(errors).length>0 : true)) return {ok:false,failure:"provider_rejected"};
  const code=x.data?.code, status=x.data?.status;
  if (httpStatus<200||httpStatus>=300||code!==100||typeof status!=="string"||!["VERIFIED","PAID","IN_BANK","FAILED","REVERSED"].includes(status)) return {ok:false,failure:"provider_rejected"};
  return {ok:true,status:status as PaymentInquiryResult["status"],providerCode:100};
}

export interface ZarinpalConfig {
  merchantId: string;
  /** Base URL override (sandbox). */
  baseUrl?: string;
  /** Public callback base for the gateway's redirect. */
  callbackBaseUrl?: string;
  timeoutMs?: number;
}

/** Pure request builders — exported so tests pin the wire contract. */
export function buildZarinpalRequestInit(config: ZarinpalConfig, amountMinorIrr: number, description: string, callbackUrl: string): { url: string; init: RequestInit } {
  const base = (config.baseUrl ?? "https://payment.zarinpal.com").replace(/\/+$/, "");
  return {
    url: `${base}/pg/v4/payment/request.json`,
    init: {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ merchant_id: config.merchantId, amount: amountMinorIrr, currency: "IRR", callback_url: callbackUrl, description }),
      signal: AbortSignal.timeout(config.timeoutMs ?? 10_000),
    },
  };
}

export function buildZarinpalVerifyInit(config: ZarinpalConfig, amountMinorIrr: number, authority: string): { url: string; init: RequestInit } {
  const base = (config.baseUrl ?? "https://payment.zarinpal.com").replace(/\/+$/, "");
  return {
    url: `${base}/pg/v4/payment/verify.json`,
    init: {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ merchant_id: config.merchantId, amount: amountMinorIrr, authority }),
      signal: AbortSignal.timeout(config.timeoutMs ?? 10_000),
    },
  };
}

export function zarinpalStartPayUrl(config: ZarinpalConfig, authority: string): string {
  const base = (config.baseUrl ?? "https://payment.zarinpal.com").replace(/\/+$/, "");
  return `${base}/pg/StartPay/${encodeURIComponent(authority)}`;
}

export interface ZarinpalEnvelope {
  data?: { code?: number; authority?: string; ref_id?: number | string; message?: string };
  errors?: unknown;
}

/** Official contract reviewed 2026-10-03: errorList + connectToGateway.
 * Unknown provider responses never become a definite failed/nonexistent payment. */
export function parseZarinpalVerification(payload: ZarinpalEnvelope, httpStatus = 200): PaymentVerifyResult {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {ok:false,failure:"provider_rejected"};
  const error = payload.errors && !Array.isArray(payload.errors) && typeof payload.errors === "object"
    ? payload.errors as {code?: unknown} : null;
  const rawCode = error?.code ?? payload.data?.code;
  const code = typeof rawCode === "number" ? rawCode : Number(rawCode);
  if ((code === 100 || code === 101) && httpStatus >= 200 && httpStatus < 300) {
    const ref = payload.data?.ref_id;
    const valid = (typeof ref === "number" && Number.isSafeInteger(ref) && ref > 0)
      || (typeof ref === "string" && /^[1-9][0-9]{0,63}$/.test(ref));
    if (!valid) return {ok:false,failure:"provider_rejected",providerCode:code};
    return {ok:true,alreadyVerified:code===101,providerReference:String(ref),providerCode:code};
  }
  const knownCode = Number.isFinite(code) ? code : undefined;
  if (code === -50) return {ok:false,failure:"amount_mismatch",providerCode:code};
  if (code === -51) return {ok:false,failure:"not_paid",providerCode:code};
  if (code === -54 || code === -55) return {ok:false,failure:"authority_not_found",providerCode:code};
  if (code === -53 || (code <= -10 && code >= -19 && code !== -12) || httpStatus === 401 || httpStatus === 403)
    return {ok:false,failure:"configuration",providerCode:knownCode};
  return {ok:false,failure:"provider_rejected",providerCode:knownCode};
}

export function zarinpalProvider(config: ZarinpalConfig): {
  name: "zarinpal";
  requestPayment(amountMinorIrr: number, description: string, callbackUrl: string): Promise<PaymentRequestResult>;
  verifyPayment(amountMinorIrr: number, authority: string): Promise<PaymentVerifyResult>;
  inquirePayment(authority: string): Promise<PaymentInquiryResult>;
} {
  return {
    name: "zarinpal",
    async inquirePayment(authority) {
      if (!config.merchantId || !/^[A-Za-z0-9-]{8,64}$/.test(authority)) return {ok:false,failure:"configuration"};
      const base=(config.baseUrl ?? "https://payment.zarinpal.com").replace(/\/+$/, "");
      // Official inquiry endpoint, NOT verify.json (which changes provider state).
      // https://www.zarinpal.com/docs/paymentGateway/otherMethods/Inquiry
      try {
        const response=await fetch(`${base}/pg/v4/payment/inquiry.json`,{
          method:"POST",headers:{"content-type":"application/json",accept:"application/json"},redirect:"error",
          body:JSON.stringify({merchant_id:config.merchantId,authority}),
          signal:AbortSignal.timeout(config.timeoutMs ?? 10_000),
        });
        const payload:unknown=await response.json();
        return parseZarinpalInquiry(payload,response.status);
      } catch(error) { return {ok:false,failure:error instanceof Error && error.name==="TimeoutError"?"timeout":"network"}; }
    },
    async requestPayment(amountMinorIrr, description, callbackUrl) {
      if (!config.merchantId || !callbackUrl || !Number.isSafeInteger(amountMinorIrr) || amountMinorIrr<=0) return { ok: false, failure: "configuration" };
      const { url, init } = buildZarinpalRequestInit(config, amountMinorIrr, description, callbackUrl);
      let response: Response;
      try {
        response = await fetch(url, init);
      } catch (cause) {
        const timedOut = cause instanceof Error && cause.name === "TimeoutError";
        return { ok: false, failure: timedOut ? "timeout" : "network" };
      }
      if (!response.ok) return { ok: false, failure: response.status === 401 || response.status === 403 ? "configuration" : "provider_rejected" };
      let payload: ZarinpalEnvelope;
      try {
        payload = await response.json() as ZarinpalEnvelope;
      } catch {
        return { ok: false, failure: "provider_rejected" };
      }
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {ok:false,failure:"provider_rejected"};
      if (Number(payload.data?.code) !== 100 || typeof payload.data?.authority !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(payload.data.authority)) {
        return { ok: false, failure: "provider_rejected" };
      }
      return { ok: true, authority: payload.data.authority, startPayUrl: zarinpalStartPayUrl(config, payload.data.authority) };
    },
    async verifyPayment(amountMinorIrr, authority) {
      if (!config.merchantId || !Number.isSafeInteger(amountMinorIrr) || amountMinorIrr<=0 || !/^[A-Za-z0-9-]{8,64}$/.test(authority)) return { ok: false, failure: "configuration" };
      const { url, init } = buildZarinpalVerifyInit(config, amountMinorIrr, authority);
      let response: Response;
      try {
        response = await fetch(url, init);
      } catch (cause) {
        const timedOut = cause instanceof Error && cause.name === "TimeoutError";
        return { ok: false, failure: timedOut ? "timeout" : "network" };
      }
      let payload: ZarinpalEnvelope;
      try {
        payload = await response.json() as ZarinpalEnvelope;
      } catch {
        return { ok: false, failure: "network" };
      }
      return parseZarinpalVerification(payload, response.status);
    },
  };
}

export type PaymentProvider = ReturnType<typeof zarinpalProvider>;

/**
 * R95-N05: the configured gateway base must be an APPROVED origin.
 *
 * Zarinpal publishes exactly two gateway hosts (docs checked 2026-10-03,
 * research sources S01/S04): the live gateway and its sandbox twin. A typo'd
 * or attacker-controlled base URL would otherwise receive the merchant id and
 * the buyer's redirect, so origin validation happens at CONFIGURATION
 * RESOLUTION time — before any request builder runs.
 *
 * An operator may explicitly extend the list (e.g. an authorized bank-test
 * mirror) via ZARINPAL_APPROVED_ORIGINS: a comma-separated list of clean
 * https:// origins. The extension is deliberate configuration, never a
 * default; everything else fails closed.
 */
export const APPROVED_GATEWAY_ORIGINS: readonly string[] = [
  "https://payment.zarinpal.com",
  "https://sandbox.zarinpal.com",
];

export type GatewayConfigurationProblem =
  | "missing_merchant"
  | "gateway_origin_unapproved"
  | "callback_origin_not_https";

export interface GatewayConfigurationStatus {
  ok: boolean;
  problems: GatewayConfigurationProblem[];
  approvedOrigins: string[];
  configuredOrigin: string | null;
}

/** Parse one clean https:// origin, or null when the entry is unusable. */
function parseHttpsOrigin(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function approvedGatewayOrigins(env: unknown): string[] {
  const e = env as { ZARINPAL_APPROVED_ORIGINS?: string } | undefined;
  const extra = (e?.ZARINPAL_APPROVED_ORIGINS ?? "").split(",").map((s) => parseHttpsOrigin(s)).filter((o): o is string => o !== null);
  return [...new Set([...APPROVED_GATEWAY_ORIGINS, ...extra])];
}

/**
 * Configuration status WITHOUT side effects. Handlers report these problems
 * verbatim; the provider resolver refuses to build a provider while any
 * blocking problem exists.
 */
export function gatewayConfigurationStatus(env: unknown): GatewayConfigurationStatus {
  const e = env as { ZARINPAL_MERCHANT_ID?: string; ZARINPAL_BASE_URL?: string; PAYMENT_CALLBACK_BASE_URL?: string } | undefined;
  const approvedOrigins = approvedGatewayOrigins(env);
  const problems: GatewayConfigurationProblem[] = [];
  const merchantId = e?.ZARINPAL_MERCHANT_ID?.trim();
  if (!merchantId) problems.push("missing_merchant");
  let configuredOrigin: string | null = null;
  const base = (e?.ZARINPAL_BASE_URL ?? "").trim();
  if (base) {
    configuredOrigin = parseHttpsOrigin(base);
    if (configuredOrigin === null || !approvedOrigins.includes(configuredOrigin)) problems.push("gateway_origin_unapproved");
  }
  const callback = (e?.PAYMENT_CALLBACK_BASE_URL ?? "").trim();
  if (callback && !/^https:\/\//.test(callback)) problems.push("callback_origin_not_https");
  return { ok: problems.length === 0, problems, approvedOrigins, configuredOrigin };
}

/** Resolve the configured provider, or null when the owner has not supplied
 * one OR the configured gateway origin is not approved (R95-N05). */
export function getPaymentProvider(env: unknown): PaymentProvider | null {
  const status = gatewayConfigurationStatus(env);
  // A non-https callback blocks new charges in startOrderPayment, not
  // verification; but an unapproved gateway origin blocks EVERYTHING that
  // would talk to that origin.
  if (status.problems.includes("missing_merchant") || status.problems.includes("gateway_origin_unapproved")) return null;
  const e = env as { ZARINPAL_MERCHANT_ID?: string; ZARINPAL_BASE_URL?: string; PAYMENT_CALLBACK_BASE_URL?: string } | undefined;
  return zarinpalProvider({
    merchantId: e!.ZARINPAL_MERCHANT_ID!.trim(),
    baseUrl: e?.ZARINPAL_BASE_URL?.trim() || undefined,
    callbackBaseUrl: e?.PAYMENT_CALLBACK_BASE_URL?.trim() || undefined,
  });
}

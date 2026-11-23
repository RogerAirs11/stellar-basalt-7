/**
 * R98-N10 demonstration payment gateway — the free, honest placeholder.
 *
 * The task "Complete one genuinely paid stable-workspace journey" is blocked
 * on an OWNER-PROVIDED merchant account: without merchant credentials the
 * real Zarinpal adapter fails closed (by design) and no end-to-end journey
 * can be demonstrated. This module unblocks the DEMONSTRATION without
 * weakening a single production safeguard:
 *
 *   - It speaks the SAME provider contract as the Zarinpal adapter
 *     (issue authority -> hosted pay page -> server-side verify), so the
 *     entire order -> payment -> entitlement -> workspace -> renewal ->
 *     expiry pipeline runs its REAL code, not a simulation of it.
 *   - Settlement happens INSIDE this application's database
 *     (demo_payment_sessions, migration 0077). No external account exists,
 *     no network IO occurs and no real money can move.
 *   - Every attempt is stored provider='demo'. Demo and real charges can
 *     never be confused, and the demo gateway NEVER activates while a real
 *     merchant is configured (resolvePaymentProvider prefers the real
 *     provider unconditionally).
 *   - The real gateway's fail-closed behavior is untouched: without
 *     DEMO_PAYMENTS_ENABLED the resolver returns null and /pay keeps its
 *     honest 503. The terminal-release policy for real charges is a
 *     separate owner gate this module does not consult and cannot relax.
 *
 * Honesty rules mirrored from the real adapter:
 *   - The redirect's status parameter is NEVER trusted (the existing
 *     /api/billing/payments/callback already ignores it).
 *   - verifyPayment reports only what the demo session table actually
 *     records: an unpaid session is `not_paid`, never a guessed failure.
 */

import type { D1Database } from "@cloudflare/workers-types";
import type { PaymentRequestResult, PaymentVerifyResult, PaymentInquiryResult } from "./zarinpal";

/** Structural supertype of the Zarinpal provider — name widened so a demo
 * provider can satisfy the same call sites without touching the real type. */
export interface PaymentProviderLike {
  readonly name: string;
  requestPayment(amountMinorIrr: number, description: string, callbackUrl: string): Promise<PaymentRequestResult>;
  verifyPayment(amountMinorIrr: number, authority: string): Promise<PaymentVerifyResult>;
  inquirePayment(authority: string): Promise<PaymentInquiryResult>;
}

export interface DemoGatewayConfig {
  /** The canonical request-scoped database (settlement table lives there). */
  db: D1Database;
  /** Public origin of the hosted demo pay page (the callback base). */
  baseUrl: string;
  /** How long an issued demo session stays completable. */
  sessionTtlMinutes?: number;
  /** Injectable clock for tests. */
  now?: () => Date;
}

export interface DemoGatewayProvider extends PaymentProviderLike {
  readonly name: "demo";
}

/** Demo authorities are recognizable and shape-compatible with the real ones. */
export function newDemoAuthority(): string {
  return `demo-${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

function isoPlusMinutes(now: Date, minutes: number): string {
  return new Date(now.getTime() + minutes * 60_000).toISOString();
}

/** The hosted demo gateway page (a static asset; CSP-clean, no inline JS). */
export function demoStartPayUrl(baseUrl: string, authority: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}/demo-pay/?authority=${encodeURIComponent(authority)}`;
}

export function demoGatewayProvider(config: DemoGatewayConfig): DemoGatewayProvider {
  const ttl = config.sessionTtlMinutes ?? 30;
  const now = config.now ?? (() => new Date());
  return {
    name: "demo",
    async requestPayment(amountMinorIrr: number, description: string, callbackUrl: string): Promise<PaymentRequestResult> {
      if (!Number.isSafeInteger(amountMinorIrr) || amountMinorIrr <= 0) return { ok: false, failure: "configuration" };
      if (!callbackUrl || !/^https?:\/\//.test(callbackUrl)) return { ok: false, failure: "configuration" };
      if (!description || description.length > 200) return { ok: false, failure: "configuration" };
      const authority = newDemoAuthority();
      const callback = new URL(callbackUrl);
      callback.searchParams.set("Authority", authority);
      await config.db.prepare(
        `INSERT INTO demo_payment_sessions(authority,amount_minor,currency,callback_url,status,description,expires_at)
         VALUES(?,?, 'IRR', ?, 'issued', ?, ?)`,
      ).bind(authority, amountMinorIrr, callback.href, description.slice(0, 200), isoPlusMinutes(now(), ttl)).run();
      return { ok: true, authority, startPayUrl: demoStartPayUrl(config.baseUrl, authority) };
    },
    async verifyPayment(amountMinorIrr: number, authority: string): Promise<PaymentVerifyResult> {
      if (!/^[A-Za-z0-9-]{8,64}$/.test(authority)) return { ok: false, failure: "authority_not_found" };
      const session = await config.db.prepare(
        "SELECT authority,amount_minor,status,provider_ref,expires_at,failure_reason FROM demo_payment_sessions WHERE authority=?",
      ).bind(authority).first<{ authority: string; amount_minor: number; status: string; provider_ref: string | null; expires_at: string; failure_reason: string | null }>();
      if (!session) return { ok: false, failure: "authority_not_found" };
      if (!Number.isSafeInteger(amountMinorIrr) || amountMinorIrr !== Number(session.amount_minor)) {
        return { ok: false, failure: "amount_mismatch", providerCode: -50 };
      }
      if (session.status === "paid" && session.provider_ref) {
        return { ok: true, providerReference: session.provider_ref, providerCode: 100 };
      }
      if (session.failure_reason === "simulated_decline") return { ok: false, failure: "provider_rejected", providerCode: -52 };
      // issued / cancelled / expired: the honest answer is "not paid" — the
      // session table records no settlement, so no settlement is reported.
      return { ok: false, failure: "not_paid", providerCode: -51 };
    },
    async inquirePayment(authority: string): Promise<PaymentInquiryResult> {
      if (!/^[A-Za-z0-9-]{8,64}$/.test(authority)) return { ok: false, failure: "provider_rejected" };
      const session = await config.db.prepare(
        "SELECT status,amount_minor FROM demo_payment_sessions WHERE authority=?",
      ).bind(authority).first<{ status: string; amount_minor: number }>();
      if (!session) return { ok: false, failure: "provider_rejected" };
      if (session.status === "paid") return { ok: true, status: "VERIFIED", providerCode: 100 };
      if (session.status === "cancelled" || session.status === "expired") return { ok: true, status: "FAILED", providerCode: -51 };
      // issued: no terminal provider fact exists yet — the inquiry reports
      // nothing rather than guessing a settlement state.
      return { ok: false, failure: "provider_rejected", providerCode: -51 };
    },
  };
}

export interface PaymentProviderResolution {
  provider: PaymentProviderLike;
  mode: "live" | "demo";
}

export interface PaymentProviderEnv {
  DB: D1Database;
  ZARINPAL_MERCHANT_ID?: string;
  ZARINPAL_BASE_URL?: string;
  ZARINPAL_APPROVED_ORIGINS?: string;
  PAYMENT_CALLBACK_BASE_URL?: string;
  DEMO_PAYMENTS_ENABLED?: string;
  APP_ENV?: string;
  ISOLATED_DEMO_MODE?: string;
  REGISTRY_DATASET_KIND?: string;
}

/**
 * Demo settlement is a local synthetic-data capability, not a fallback
 * payment provider.  Keep this predicate deliberately stricter than a feature
 * flag so a production deployment cannot accidentally mint paid capability by
 * enabling DEMO_PAYMENTS_ENABLED.
 *
 * ISOLATED_DEMO_MODE is the runtime contract that the local launcher has
 * bound the request to its dedicated disposable demo database.  Requiring the
 * synthetic dataset marker as an independent check prevents a copied flag
 * from being sufficient on its own.
 */
export function isIsolatedDemoPaymentEnvironment(env: Omit<PaymentProviderEnv, "DB">): boolean {
  return env.APP_ENV === "local"
    && env.ISOLATED_DEMO_MODE === "1"
    && env.REGISTRY_DATASET_KIND === "synthetic";
}

export function isDemoPaymentsEnabled(env: Omit<PaymentProviderEnv, "DB">): boolean {
  return env.DEMO_PAYMENTS_ENABLED === "true" || env.DEMO_PAYMENTS_ENABLED === "1";
}

/** A loopback HTTP exception belongs only to the marked local synthetic
 * environment. Live merchant routing always requires the trusted HTTPS origin. */
export function configuredPaymentCallbackOrigin(env: Omit<PaymentProviderEnv, "DB">, mode: "live" | "demo"): URL | null {
  let base: URL;
  try { base = new URL(env.PAYMENT_CALLBACK_BASE_URL ?? ""); } catch { return null; }
  if (base.username || base.password || base.search || base.hash || base.pathname !== "/") return null;
  if (base.protocol === "https:") return base;
  if (mode === "demo" && isIsolatedDemoPaymentEnvironment(env)
      && base.origin === "http://127.0.0.1:3000") return base;
  return null;
}

/**
 * Resolve the ACTIVE payment provider with real-first precedence:
 *
 *   1. A configured real gateway (Zarinpal merchant present) ALWAYS wins —
 *      the demo gateway can never intercept or shadow a real charge path.
 *   2. Otherwise, when the owner has enabled DEMO_PAYMENTS_ENABLED, the
 *      demonstration gateway serves the full journey with provider='demo'.
 *   3. Otherwise null — callers keep their existing honest fail-closed 503.
 */
export function resolvePaymentProvider(
  env: PaymentProviderEnv,
  getRealProvider: (env: unknown) => PaymentProviderLike | null,
): PaymentProviderResolution | null {
  const real = getRealProvider(env);
  if (real) return { provider: real, mode: "live" };
  if (isDemoPaymentsEnabled(env) && isIsolatedDemoPaymentEnvironment(env)) {
    const base = configuredPaymentCallbackOrigin(env, "demo");
    if (!base) return null; // invalid/missing callback origin -> still fail closed
    return { provider: demoGatewayProvider({ db: env.DB, baseUrl: base.origin }), mode: "demo" };
  }
  return null;
}

/** Truthful note attached to every demo-mode billing response. */
export const DEMO_PAYMENTS_NOTE =
  "DEMO gateway active: this is a simulated settlement inside the application database (provider 'demo'). No real charge can occur, and the entitlement granted after server-side verification is demonstration-only.";

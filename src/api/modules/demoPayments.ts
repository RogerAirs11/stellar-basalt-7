/**
 * R98-N10 demo gateway endpoints — the hosted "gateway" surface.
 *
 * The demo payment gateway mimics a real payment provider's HOSTED page
 * contract: the buyer's browser leaves the application to the gateway's pay
 * page, chooses an outcome there, and is redirected back to the server
 * callback with an untrusted status parameter. Three properties matter:
 *
 *   - NO AUTHENTICATION is required here — exactly like a real gateway,
 *     whoever holds the authority URL can settle it. Nothing is at risk:
 *     the stored amounts are server-side, the settlement is simulated, and
 *     entitlements go to the ORDER'S BUYER, never to whoever pressed the
 *     button. Server-side verification remains the only source of truth.
 *   - Completion is a CAS transition (issued -> terminal). A replayed or
 *     concurrent completion returns the recorded state without inventing a
 *     second settlement reference.
 *   - The public status endpoint exposes ONLY non-sensitive session facts
 *     (amount, currency, description, status, expiry) — never the buyer,
 *     the order id or any account data.
 */

import { z } from "zod";
import { HttpError, json, readJson } from "../http";
import { getAuth } from "../../auth/session";
import { isDemoPaymentsEnabled, isIsolatedDemoPaymentEnvironment } from "../../commerce/payments/demoGateway";
import type { D1Database } from "@cloudflare/workers-types";
import { parseUtcTimestamp } from "../../shared/utcTimestamp";

type DemoPaymentsEnv = {
  DB: D1Database;
  DEMO_PAYMENTS_ENABLED?: string;
  SESSION_COOKIE_NAME?: string;
  APP_ENV?: string;
  ISOLATED_DEMO_MODE?: string;
  REGISTRY_DATASET_KIND?: string;
};

export interface DemoPaymentSessionRow {
  authority: string;
  amount_minor: number;
  currency: string;
  callback_url: string;
  status: string;
  provider_ref: string | null;
  description: string;
  issued_at: string;
  expires_at: string;
  completed_at: string | null;
  failure_reason: string | null;
}

function requireDemoGatewayEnabled(env: DemoPaymentsEnv): void {
  if (!isDemoPaymentsEnabled(env)) {
    throw new HttpError(503, "demo_gateway_disabled", "The demonstration payment gateway is not enabled. No payment, real or simulated, can be made through it.");
  }
  if (!isIsolatedDemoPaymentEnvironment(env)) {
    throw new HttpError(503, "demo_gateway_isolation_required", "Demonstration settlement is available only in the explicitly isolated local synthetic-data environment.");
  }
}

async function loadSession(env: DemoPaymentsEnv, authority: string): Promise<DemoPaymentSessionRow | null> {
  if (!/^[A-Za-z0-9-]{8,64}$/.test(authority)) throw new HttpError(400, "invalid_authority", "Unrecognizable demo authority");
  return env.DB.prepare("SELECT * FROM demo_payment_sessions WHERE authority=?").bind(authority).first<DemoPaymentSessionRow>();
}

/** Public, non-sensitive session facts for the hosted demo pay page. */
export async function demoPaymentSessionStatus(request: Request, env: DemoPaymentsEnv, authorityFromRoute?: string): Promise<Response> {
  requireDemoGatewayEnabled(env);
  const authority = authorityFromRoute ?? new URL(request.url).searchParams.get("authority") ?? "";
  const session = await loadSession(env, authority);
  if (!session) throw new HttpError(404, "not_found", "No demo payment session matches this authority");
  const expiresAtMs = parseUtcTimestamp(session.expires_at);
  const invalidExpiry = expiresAtMs === null;
  const expired = session.status === "issued" && (invalidExpiry || expiresAtMs <= Date.now());
  const auth = env.SESSION_COOKIE_NAME ? await getAuth(env.DB, request, env.SESSION_COOKIE_NAME) : null;
  const verification = auth ? await env.DB.prepare(
    "SELECT a.id AS attempt_id,a.state FROM payment_attempts a JOIN orders o ON o.id=a.order_id WHERE a.authority=? AND a.provider='demo' AND o.buyer_user_id=?",
  ).bind(authority, auth.user.id).first<{attempt_id:number;state:string}>() : null;
  return json({
    demo: true,
    authority: session.authority,
    amount_minor: session.amount_minor,
    amount_toman: session.amount_minor / 10,
    currency: session.currency,
    description: session.description,
    status: expired ? "expired" : session.failure_reason ? "failed" : session.status,
    failure_reason: invalidExpiry ? "invalid_expiry_timestamp" : session.failure_reason,
    expires_at: session.expires_at,
    // The private attempt is disclosed only to the order buyer, never to
    // somebody who merely possesses a gateway authority link.
    verification,
    note: "Demonstration gateway: this settlement is simulated inside the application database. No real money moves, no card or bank data is collected, and the resulting entitlement is demonstration-only.",
  });
}

/**
 * The hosted gateway's "settle" action: marks the session paid or cancelled
 * and returns the gateway redirect back to the server callback (whose status
 * parameter the callback deliberately ignores — verification is server-side).
 */
export async function completeDemoPayment(request: Request, env: DemoPaymentsEnv, authority: string): Promise<Response> {
  requireDemoGatewayEnabled(env);
  if (request.method !== "POST") throw new HttpError(405, "method_not_allowed", "Use POST to settle a demo session");
  const parsed = z.object({ outcome: z.enum(["paid", "cancelled", "failed"]) }).safeParse(await readJson<unknown>(request, 2 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_outcome", "outcome must be 'paid', 'cancelled' or 'failed'");
  const session = await loadSession(env, authority);
  if (!session) throw new HttpError(404, "not_found", "No demo payment session matches this authority");

  if (session.status !== "issued") {
    // Idempotent replay of a settled session: report the recorded terminal
    // state — never invent a second settlement or a new reference.
    return json({ demo: true, authority: session.authority, status: session.failure_reason ? "failed" : session.status, failure_reason: session.failure_reason, settled: true,
      callback_url: session.callback_url, note: "This demo session is already settled; the recorded outcome is returned unchanged." });
  }
  const expiresAtMs = parseUtcTimestamp(session.expires_at);
  if (expiresAtMs === null || expiresAtMs <= Date.now()) {
    const failureReason = expiresAtMs === null ? "invalid_expiry_timestamp" : null;
    await env.DB.prepare("UPDATE demo_payment_sessions SET status='expired',failure_reason=COALESCE(?,failure_reason),completed_at=CURRENT_TIMESTAMP WHERE authority=? AND status='issued'")
      .bind(failureReason, authority).run();
    throw new HttpError(410, "session_expired", expiresAtMs === null
      ? "This demo payment session has an invalid expiry timestamp and was quarantined; start a new payment from the order"
      : "This demo payment session expired before it was settled; start a new payment from the order");
  }

  if (parsed.data.outcome === "cancelled" || parsed.data.outcome === "failed") {
    const failure = parsed.data.outcome === "failed" ? "simulated_decline" : null;
    const cancelled = await env.DB.prepare(
      "UPDATE demo_payment_sessions SET status='cancelled',failure_reason=?,completed_at=CURRENT_TIMESTAMP WHERE authority=? AND status='issued'",
    ).bind(failure, authority).run();
    if (Number(cancelled.meta.changes ?? 0) !== 1) {
      return json({ demo: true, authority, status: "already_settled", settled: true, note: "The session was settled concurrently; no second outcome was recorded." });
    }
    return json({ demo: true, authority, status: parsed.data.outcome, failure_reason: failure, settled: true,
      callback_url: session.callback_url,
      note: failure ? "Simulated provider decline recorded. No real provider was contacted and no entitlement is granted." : "Demo cancellation recorded. The gateway redirect status is untrusted by design; the order stays unpaid until server-side verification succeeds." });
  }

  const providerRef = `DEMO-${Array.from(crypto.getRandomValues(new Uint32Array(2))).map(n => String(n % 1_000_000_000).padStart(9, "0")).join("")}`;
  const paid = await env.DB.prepare(
    "UPDATE demo_payment_sessions SET status='paid',provider_ref=?,completed_at=CURRENT_TIMESTAMP WHERE authority=? AND status='issued'",
  ).bind(providerRef, authority).run();
  if (Number(paid.meta.changes ?? 0) !== 1) {
    return json({ demo: true, authority, status: "already_settled", settled: true, note: "The session was settled concurrently; no second outcome was recorded." });
  }
  return json({ demo: true, authority, status: "paid", settled: true, provider_ref: providerRef,
    callback_url: session.callback_url,
    note: "Demo settlement recorded. The redirect's status parameter is never trusted: the buyer's application must run server-side verification before any entitlement is granted." });
}

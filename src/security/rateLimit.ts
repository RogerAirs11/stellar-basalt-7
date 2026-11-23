import { safeErrorCategory } from "./logging";
import { HttpError, readJson } from "../api/http";

import { normalizeIranianPhone, isProductionAuth } from "../auth/publicAuthPolicy";

/**
 * Rate limiting has TWO layers (R88 agent plan P05, live-verification finding):
 *
 *  1. The Cloudflare Workers rate-limiting BINDING (env.*_RATE_LIMITER) —
 *     the platform-integrated first check. On 2026-10-03 a controlled live
 *     probe (minimal worker, limit 3/60s) proved the binding currently admits
 *     EVERY request on this account (7/7 successes) — a no-op far beyond its
 *     documented eventual consistency. The binding stays wired: it costs one
 *     call, and it begins enforcing if/when the account gains that capability.
 *
 *  2. The D1 fixed-window counter (rate_limit_counters, migration 0040) —
 *     the actual ENFORCEMENT layer for the abuse-critical classes (auth,
 *     write, expensive, per-account). One atomic upsert per request both
 *     records and returns the usage. Public reads stay on the binding only
 *     (they are cheap, cache-friendly and never state-changing).
 *
 * Fail-closed doctrine (F18) applies to BOTH layers for the AUTH class and to
 * the bindings everywhere: production without a binding = honest 503, and a
 * broken counter must never open the credential surface.
 *
 * R156 availability amendment: the counter lives on D1, but D1 is only the
 * FAILOVER database — the canonical primary and write target is Supabase
 * (DB_PROVIDER_MODE=supabase_full). When the D1 counter write fails (e.g. the
 * free-tier daily row-write limit, error 7500), a platform-wide 503 used to
 * take down EVERY mutation and expensive read even though the real database
 * was healthy. So for the non-auth classes the counter failure now admits the
 * request (warn-logged): the binding limiter still throttles at the edge, and
 * mutations simply proceed to the healthy primary. Auth keeps the honest 503.
 */

/** Per-class per-minute budgets (mirrors the binding configuration). */
export const D1_RATE_LIMITS = {
  auth: 10,
  write: 30,
  expensive: 12,
  accountLogin: 5,
  accountOtp: 5,
} as const;

/**
 * Atomic fixed-window counter: one statement records this request and returns
 * the usage inside the current window. D1/SQLite serializes writes, so two
 * concurrent requests can never both read the same count (the python replay
 * suite executes this exact statement on a real engine).
 */
export const RATE_LIMIT_UPSERT_SQL = `INSERT INTO rate_limit_counters(key,window_start,count) VALUES(?,?,1)
ON CONFLICT(key) DO UPDATE SET
  count=CASE WHEN rate_limit_counters.window_start=excluded.window_start THEN rate_limit_counters.count+1 ELSE 1 END,
  window_start=excluded.window_start
RETURNING count`;

function currentWindowStart(): string {
  // Fixed one-minute windows, UTC — the same granularity the binding uses.
  return new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();
}

async function enforceD1Window(db: D1Database, env: Env, key: string, limit: number, kind: "auth" | "expensive" | "write"): Promise<void> {
  let count: number;
  try {
    const row = await db.prepare(RATE_LIMIT_UPSERT_SQL).bind(key, currentWindowStart()).first<{ count: number }>();
    const raw = row?.count;
    if (typeof raw !== "number" && typeof raw !== "bigint" && typeof raw !== "string") {
      throw new Error("Invalid rate-limit counter result");
    }
    count = Number(raw);
    if (!Number.isSafeInteger(count) || count < 1) throw new Error("Invalid rate-limit counter result");
  } catch (cause) {
    // F18: the credential surface stays fail-closed in production.
    if (isProductionAuth(env) && kind === "auth") {
      throw new HttpError(503, "rate_limiter_unavailable", "The service is temporarily unavailable; please try again shortly.");
    }
    // R156 availability amendment: D1 is the FAILOVER database while the
    // canonical primary/write target is Supabase — a D1-side outage (free-tier
    // daily row-write quota, error 7500, ...) must not 503 the whole platform.
    // Admit and warn; the binding limiter still applies at the edge.
    if (isProductionAuth(env)) {
      console.warn("D1 rate-limit counter unavailable — admitting (binding limiter still active)", { kind, errorType: safeErrorCategory(cause) });
      return;
    }
    console.warn("D1 rate-limit counter failed (non-production: admitting request)", { errorType: safeErrorCategory(cause) });
    return;
  }
  if (count > limit) {
    throw new HttpError(429, "rate_limited", "Too many requests. Try again shortly.");
  }
}

export async function enforceRateLimit(request: Request, env: Env, kind: "public" | "auth" | "expensive" | "write"): Promise<void> {
  const limiter = kind === "auth" ? env.AUTH_RATE_LIMITER
    : kind === "expensive" ? env.EXPENSIVE_RATE_LIMITER
    : kind === "write" ? env.WRITE_RATE_LIMITER
    : env.PUBLIC_RATE_LIMITER;
  if (!limiter) {
    // T13 / packet finding F18: a missing binding must never silently disable
    // rate limiting in production — that is fail-open abuse. Production and
    // unrecognized environments fail CLOSED with an honest 503; only explicit
    // local/development/test environments may omit the bindings.
    if (isProductionAuth(env)) {
      throw new HttpError(503, "rate_limiter_unavailable", "The service is temporarily unavailable; please try again shortly.");
    }
    return;
  }

  const url = new URL(request.url);
  const actor = request.headers.get("cf-connecting-ip") || request.headers.get("cf-ray") || "anonymous";
  const bucket = kind === "auth" ? "auth"
    : kind === "expensive" ? `expensive:${routeBucket(url.pathname)}`
    : kind === "write" ? "write"
    : routeBucket(url.pathname);
  const key = `${bucket}:${actor}`;
  const { success } = await limiter.limit({ key });
  if (!success) throw new HttpError(429, "rate_limited", "Too many requests. Try again shortly.");

  // Enforcement layer (P05 live finding): the binding currently admits
  // everything on this account, so the D1 counter is what actually throttles
  // the abuse-critical classes. Public reads stay binding-only.
  if (kind !== "public") {
    const limit = kind === "auth" ? D1_RATE_LIMITS.auth
      : kind === "write" ? D1_RATE_LIMITS.write
      : D1_RATE_LIMITS.expensive;
    // env.DB is still the D1 binding here: the worker enforces rate limits
    // BEFORE resolveDatabaseForRequest swaps DB for the request's provider.
    await enforceD1Window(env.DB, env, `d1:${key}`, limit, kind);
  }
}

/**
 * Per-account login limiter (D10): additive to the 10/min/IP auth limiter so distributed
 * password attempts against one account are throttled at 5 attempts/minute/account.
 *
 * The normalized email is SHA-256 hashed before it becomes the limiter bucket key, so raw
 * email addresses never appear in bucket keys, limiter metrics or log output. The rejection
 * uses the same generic 429 envelope as the IP limiter. A durable database
 * counter is also written; its key contains a hash, never the raw identity.
 */
export async function enforceAccountLoginLimit(request: Request, env: Env): Promise<void> {
  const limiter = env.ACCOUNT_RATE_LIMITER;
  if (!limiter) {
    // Same fail-closed doctrine as enforceRateLimit (F18): production without
    // the binding must not run unthrottled distributed password attempts.
    if (isProductionAuth(env)) {
      throw new HttpError(503, "rate_limiter_unavailable", "The service is temporarily unavailable; please try again shortly.");
    }
    return;
  }

  let identity: string | null = null;
  let accountKind = "login-account";
  try {
    const probe = request.clone();
    // Full-project typecheck (workers-types): request.clone() carries the incoming
    // Cf-instantiated Request type, while readJson accepts the base Request shape.
    // Cast locally so this probe stays decoupled from the shared transport signature.
    const body = await readJson<{ email?: unknown; phone?: unknown }>(probe as unknown as Request, 8 * 1024);
    if (new URL(request.url).pathname.startsWith("/api/auth/otp/") && typeof body?.phone === "string") {
      identity = normalizeIranianPhone(body.phone);
      accountKind = "otp-account";
    } else if (typeof body?.email === "string") identity = body.email;
  } catch (cause) {
    if (cause instanceof HttpError && cause.status === 413) throw cause;
    return; // Malformed bodies are rejected by the login schema with the generic 400.
  }
  if (!identity?.trim()) return;
  const hashed = await accountLimiterKey(identity);
  const { success } = await limiter.limit({ key: `${accountKind}:${hashed}` });
  if (!success) throw new HttpError(429, "rate_limited", "Too many requests. Try again shortly.");

  // Enforcement layer (P05 live finding): the account binding also currently
  // no-ops on this account, so the same D1 window guards each identity.
  await enforceD1Window(env.DB, env, `d1:${accountKind}:${hashed}`, accountKind === "otp-account" ? D1_RATE_LIMITS.accountOtp : D1_RATE_LIMITS.accountLogin, "auth");
}

/** Normalize an email (trim + lowercase) and hash it; the raw address never leaves this function. */
export async function accountLimiterKey(email: string): Promise<string> {
  const normalized = email.trim().toLowerCase();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function routeBucket(path: string): string {
  if (path.startsWith("/api/ai/")) return "ai";
  if (path === "/api/search") return "search";
  if (path.includes("/pedigree") || path === "/api/relationship") return "pedigree";
  if (path.startsWith("/api/breeding/")) return "breeding";
  return "public-api";
}

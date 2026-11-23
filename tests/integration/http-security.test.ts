import { describe, expect, it } from "vitest";
import workerDefault from "../../src/worker";
import { hashPassword } from "../../src/auth/password";
import { accountLimiterKey } from "../../src/security/rateLimit";
import { normalizeIranianPhone } from "../../src/auth/publicAuthPolicy";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * R88 agent plan P05 — ACTUAL HTTP security and abuse tests.
 *
 * Every fixture drives the REAL Worker entrypoint (src/worker.ts default
 * export — the same module Cloudflare deploys) over Request/Response objects,
 * through the real rate-limit classification, the real origin/CSRF guards,
 * the real session store and the real security-header pipeline. The only
 * substituted boundary is the D1 binding (a scripted fake) and the Cloudflare
 * rate-limiter bindings (counting fakes), because those are external services.
 *
 * Covered acceptance criteria from the ticket:
 *  - SAMEORIGIN/frame-ancestors 'self' ONLY for /classic-registry and its
 *    descendants; every other page (and every path-prefix lookalike) is DENY.
 *  - Cross-origin form/fetch mutations fail; permitted same-origin calls pass
 *    the guard; Origin-less scripted requests are admitted past the origin
 *    check but remain bounded by the write limiter.
 *  - Repeated inquiry/login/OTP requests are bounded without account
 *    enumeration (identical 401/429 envelopes, Retry-After on throttles,
 *    per-account buckets keyed by hash, never raw identity).
 *  - Session rotation on every login, logout revocation, CSRF on logout,
 *    body limits, HSTS only at HTTPS+production, CSP without unsafe scripts,
 *    no open-redirect proxy (allowlisted media proxy rejects off-list hosts).
 */

const worker = workerDefault as unknown as {
  fetch(request: Request, env: unknown): Promise<Response>;
};

const ORIGIN_HTTPS = "https://registry.example";
const TEST_IP = "203.0.113.7";

// ---------------------------------------------------------------------------
// Scripted D1 fake (marketplaceCommands.test.ts pattern): first() answers by
// SQL shape, every write is recorded so tests can pin session rotation and
// revocation side effects. all() returns empty results — read handlers that
// reach the database see an honest empty registry.
// ---------------------------------------------------------------------------

interface ScriptedDb {
  user?: Record<string, unknown> | null;
  session?: Record<string, unknown> | null;
  listing?: Record<string, unknown> | null;
  /** Pre-seeded D1 rate-limit counter values (key -> count) for the R91 enforcement layer. */
  rateCounts?: Map<string, number>;
  /** When set, D1 counter queries throw (fail-closed fixture). */
  rateCounterError?: unknown;
}

interface Recorded {
  sql: string;
  args: unknown[];
}

function makeDb(script: ScriptedDb = {}) {
  const writes: Recorded[] = [];
  const reads: Recorded[] = [];
  const answerFirst = (sql: string): unknown => {
    if (sql.includes("FROM users WHERE email")) return script.user === undefined ? null : script.user;
    if (sql.includes("FROM sessions s JOIN users u")) {
      // The real query enforces `datetime(expires_at) > CURRENT_TIMESTAMP` in
      // SQL; the fake honors the same condition so expiry fixtures stay honest.
      if (!script.session) return null;
      const expiresAt = Date.parse(String(script.session.expires_at));
      return Number.isFinite(expiresAt) && expiresAt > Date.now() ? script.session : null;
    }
    if (sql.includes("FROM sales_listings l")) return script.listing === undefined ? null : script.listing;
    return null;
  };
  interface Builder {
    sql: string;
    args: unknown[];
    bind: (...nextArgs: unknown[]) => Builder;
    first: () => Promise<unknown>;
    all: () => Promise<{ results: unknown[] }>;
    run: () => Promise<{ meta: { changes: number } }>;
  }
  const makeBuilder = (sql: string, args: unknown[]): Builder => ({
    sql,
    args,
    bind: (...nextArgs: unknown[]) => makeBuilder(sql, nextArgs),
    first: async () => {
      if (sql.includes("rate_limit_counters")) {
        if (script.rateCounterError) throw script.rateCounterError;
        const key = String(args[0]);
        const next = (script.rateCounts?.get(key) ?? 0) + 1;
        script.rateCounts?.set(key, next);
        return { count: next };
      }
      reads.push({ sql, args });
      return answerFirst(sql);
    },
    all: async () => ({ results: [] }),
    run: async () => {
      writes.push({ sql, args });
      return { meta: { changes: 1 } };
    },
  });
  const db = {
    prepare: (sql: string) => makeBuilder(sql, []),
    batch: async (statements: Array<{ sql: string; args: unknown[] }>) => {
      for (const statement of statements) writes.push({ sql: statement.sql, args: statement.args });
      // Batched SELECTs see an honest empty registry; batched writes report one
      // change (the marketplace command layer asserts on changes counts).
      return statements.map((statement) => ({
        results: [],
        success: true,
        meta: { changes: /\b(SELECT|WITH)\b/i.test(statement.sql) ? 0 : 1 },
      }));
    },
  };
  return Object.assign(db as unknown as D1Database, { __writes: writes, __reads: reads });
}

function makeLimiter(max = Number.POSITIVE_INFINITY) {
  const calls: string[] = [];
  let used = 0;
  return {
    calls,
    limit: async ({ key }: { key: string }) => {
      calls.push(key);
      used += 1;
      return { success: used <= max };
    },
  };
}

interface TestEnvOptions {
  appEnv?: string;
  db?: ReturnType<typeof makeDb>;
  withLimiters?: boolean;
  authMax?: number;
  accountMax?: number;
  writeMax?: number;
  assetsStatus?: number;
}

function makeEnv(options: TestEnvOptions = {}) {
  const env: Record<string, unknown> = {
    APP_ENV: options.appEnv ?? "production",
    DB_PROVIDER_MODE: "d1_only", // R102: these tests exercise the D1 test binding explicitly; implicit default is now supabase_full
    SESSION_COOKIE_NAME: "hr_session",
    DB: options.db ?? makeDb(),
    ASSETS: {
      fetch: async () =>
        new Response("<!doctype html><html><body>Registry</body></html>", {
          status: options.assetsStatus ?? 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
    },
  };
  if (options.withLimiters !== false) {
    env.PUBLIC_RATE_LIMITER = makeLimiter();
    env.AUTH_RATE_LIMITER = makeLimiter(options.authMax);
    env.EXPENSIVE_RATE_LIMITER = makeLimiter();
    env.WRITE_RATE_LIMITER = makeLimiter(options.writeMax);
    env.ACCOUNT_RATE_LIMITER = makeLimiter(options.accountMax);
  }
  return {
    env: env as unknown as Env,
    limiters: {
      public: env.PUBLIC_RATE_LIMITER as ReturnType<typeof makeLimiter>,
      auth: env.AUTH_RATE_LIMITER as ReturnType<typeof makeLimiter>,
      expensive: env.EXPENSIVE_RATE_LIMITER as ReturnType<typeof makeLimiter>,
      write: env.WRITE_RATE_LIMITER as ReturnType<typeof makeLimiter>,
      account: env.ACCOUNT_RATE_LIMITER as ReturnType<typeof makeLimiter>,
    },
  };
}

function call(env: unknown, path: string, init: RequestInit = {}, origin = ORIGIN_HTTPS): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("cf-connecting-ip")) headers.set("cf-connecting-ip", TEST_IP);
  const request = new Request(`${origin}${path}`, { ...init, headers });
  return worker.fetch(request, env);
}

function jsonInit(body: unknown, headers: Record<string, string> = {}): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
}

// ---------------------------------------------------------------------------
// A. Frame policy, CSP, HSTS and the static security-header pipeline.
// ---------------------------------------------------------------------------

describe("P05 frame policy over HTTP", () => {
  it("permits same-origin embedding only for /classic-registry and descendants", async () => {
    const { env } = makeEnv();
    for (const path of ["/classic-registry", "/classic-registry/", "/classic-registry/app.js", "/classic-registry/nested/page.js"]) {
      const response = await call(env, path);
      expect(response.status).toBe(200);
      expect(response.headers.get("x-frame-options")).toBe("SAMEORIGIN");
      expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'self'");
    }
  });

  it("keeps every other application page unframeable", async () => {
    const { env } = makeEnv();
    for (const path of ["/", "/heritage/desk", "/f/heritage/desk/submit", "/api/horses", "/admin"]) {
      const response = await call(env, path);
      expect(response.headers.get("x-frame-options")).toBe("DENY");
      expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    }
  });

  it("gives path-prefix lookalikes no Classic exception", async () => {
    const { env } = makeEnv();
    const lookalikes = [
      "/classic-registryX",
      "/classic-registryx/app.js",
      "/CLASSIC-REGISTRY/app.js",
      "/classic-registry../evil",
      "/classic-registry%2Fapp.js",
      "/classic-registry%2f..%2Fevil",
      "/foo/classic-registry",
      "//classic-registry",
      "/classic_registry/app.js",
    ];
    for (const path of lookalikes) {
      const response = await call(env, path);
      expect(response.headers.get("x-frame-options"), path).toBe("DENY");
      expect(response.headers.get("content-security-policy"), path).toContain("frame-ancestors 'none'");
    }
  });

  it("scopes the Classic exception by pathname, not by query string", async () => {
    const { env } = makeEnv();
    const allowed = await call(env, "/classic-registry?lang=fa");
    expect(allowed.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    const denied = await call(env, "/?embed=classic-registry");
    expect(denied.headers.get("x-frame-options")).toBe("DENY");
  });
});

describe("P05 content security policy and transport security", () => {
  it("ships a production CSP without unsafe script or eval allowances", async () => {
    const { env } = makeEnv({ appEnv: "production" });
    const response = await call(env, "/");
    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("script-src 'self';");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toContain("script-src 'unsafe-inline'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });

  it("keeps the documented development-only style relaxation out of production", async () => {
    const prod = await call(makeEnv({ appEnv: "production" }).env, "/");
    const dev = await call(makeEnv({ appEnv: "development" }).env, "/");
    const prodCsp = prod.headers.get("content-security-policy") ?? "";
    const devCsp = dev.headers.get("content-security-policy") ?? "";
    expect(prodCsp).not.toContain("style-src 'self' 'unsafe-inline'");
    expect(devCsp).toContain("style-src 'self' 'unsafe-inline'");
    // Both retain the same structural protections.
    for (const csp of [prodCsp, devCsp]) {
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("base-uri 'self'");
      expect(csp).toContain("form-action 'self'");
    }
  });

  it("sets HSTS only at the production HTTPS ingress", async () => {
    const https = await call(makeEnv({ appEnv: "production" }).env, "/");
    expect(https.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
    const http = await call(makeEnv({ appEnv: "production" }).env, "/", {}, "http://registry.example");
    expect(http.headers.get("strict-transport-security")).toBeNull();
    const devHttps = await call(makeEnv({ appEnv: "development" }).env, "/");
    expect(devHttps.headers.get("strict-transport-security")).toBeNull();
  });

  it("applies the full defensive header set to static and API responses", async () => {
    const { env } = makeEnv();
    for (const path of ["/", "/api/horses"]) {
      const response = await call(env, path);
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("referrer-policy")).toBe(path.startsWith("/api/") ? "no-referrer" : "strict-origin-when-cross-origin");
      expect(response.headers.get("cross-origin-opener-policy")).toBe("same-origin");
      expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
      expect(response.headers.get("permissions-policy")).toBe("camera=(), microphone=(), geolocation=(), payment=(), usb=()");
    }
  });

  it("marks API, admin and synthetic pages as noindex", async () => {
    const { env } = makeEnv();
    for (const path of ["/api/horses", "/admin", "/demo-workbench", "/demo-workbench/page", "/business-model", "/business-model/page"]) {
      const response = await call(env, path);
      expect(response.headers.get("x-robots-tag"), path).toBe("noindex, nofollow, noarchive");
    }
    const publicPage = await call(env, "/heritage/desk");
    expect(publicPage.headers.get("x-robots-tag")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// B. Origin / Fetch-Metadata / CSRF on mutations.
// ---------------------------------------------------------------------------

const INQUIRY_PATH = "/api/market/listings/11111111-1111-4111-8111-111111111111/inquiries";
const INQUIRY_BODY = { buyer_name: "Test Buyer", buyer_contact: "buyer@example.com" };

describe("P05 origin and CSRF enforcement on mutations", () => {
  it("rejects a cross-origin anonymous inquiry before touching the database", async () => {
    const db = makeDb();
    const { env } = makeEnv({ db });
    const response = await call(env, INQUIRY_PATH, jsonInit(INQUIRY_BODY, { origin: "https://evil.example" }));
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("origin_failed");
    expect(db.__writes).toHaveLength(0);
  });

  it("rejects a sec-fetch-site: cross-site scripted inquiry", async () => {
    const { env } = makeEnv();
    const response = await call(env, INQUIRY_PATH, jsonInit(INQUIRY_BODY, { "sec-fetch-site": "cross-site" }));
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("origin_failed");
  });

  it("admits a same-origin inquiry past the guard (fails later on the missing listing, not on origin)", async () => {
    const { env } = makeEnv();
    const sameOrigin = await call(env, INQUIRY_PATH, jsonInit(INQUIRY_BODY, { origin: ORIGIN_HTTPS, "sec-fetch-site": "same-origin" }));
    expect(sameOrigin.status).toBe(404);
    const body = (await sameOrigin.json()) as { error: { code: string } };
    expect(body.error.code).toBe("not_found");

    // Origin-less scripted request (curl-like): the origin guard cannot apply,
    // so the write limiter is the bound — asserted in section C.
    const originless = await call(env, INQUIRY_PATH, jsonInit(INQUIRY_BODY));
    expect(originless.status).toBe(404);
  });

  it("requires the CSRF token on authenticated logout and rejects cross-origin use of a valid token", async () => {
    const db = makeDb({ session: futureSession() });
    const { env } = makeEnv({ db });
    const cookie = { cookie: "hr_session=some-session-token" };

    const missing = await call(env, "/api/auth/logout", jsonInit({}, cookie));
    expect(missing.status).toBe(403);
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe("csrf_failed");
    expect(db.__writes.filter((w) => w.sql.includes("DELETE FROM sessions"))).toHaveLength(0);

    const crossOrigin = await call(env, "/api/auth/logout", jsonInit({}, { ...cookie, "x-csrf-token": "csrf-abc", origin: "https://evil.example" }));
    expect(crossOrigin.status).toBe(403);
    expect(((await crossOrigin.json()) as { error: { code: string } }).error.code).toBe("origin_failed");

    const valid = await call(env, "/api/auth/logout", jsonInit({}, { ...cookie, "x-csrf-token": "csrf-abc", origin: ORIGIN_HTTPS }));
    expect(valid.status).toBe(200);
    expect(db.__writes.filter((w) => w.sql.includes("DELETE FROM sessions WHERE id=?"))).toHaveLength(1);
    expect(valid.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});

function futureSession(): Record<string, unknown> {
  return {
    session_id: "s-1",
    csrf_token: "csrf-abc",
    expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
    last_seen_at: new Date().toISOString(),
    id: "u-1",
    email: "owner@example.com",
    display_name: "Owner",
    role: "owner",
    is_active: 1,
  };
}

// ---------------------------------------------------------------------------
// C. Rate limiting through the real Worker classification path.
// ---------------------------------------------------------------------------

describe("P05 abuse throttling over HTTP", () => {
  it("classifies an anonymous public read into the public bucket", async () => {
    const { env, limiters } = makeEnv();
    await call(env, "/api/public-probe");
    expect(limiters.public.calls).toEqual([`public-api:${TEST_IP}`]);
    expect(limiters.auth.calls).toHaveLength(0);
    expect(limiters.write.calls).toHaveLength(0);
  });

  it("classifies an anonymous inquiry into the write bucket and consults no other limiter class", async () => {
    const { env, limiters } = makeEnv();
    await call(env, INQUIRY_PATH, jsonInit(INQUIRY_BODY));
    expect(limiters.write.calls).toEqual([`write:${TEST_IP}`]);
    expect(limiters.auth.calls).toHaveLength(0);
    expect(limiters.public.calls).toHaveLength(0);
  });

  it("classifies expensive routes into the expensive bucket", async () => {
    const { env, limiters } = makeEnv();
    await call(env, "/api/breeding/probe");
    expect(limiters.expensive.calls).toEqual([`expensive:breeding:${TEST_IP}`]);
    await call(env, "/api/relationship");
    expect(limiters.expensive.calls).toContain(`expensive:pedigree:${TEST_IP}`);
  });

  it("protects login with BOTH the per-IP auth limiter and the per-account limiter", async () => {
    const { env, limiters } = makeEnv();
    const response = await call(env, "/api/auth/login", jsonInit({ email: "someone@example.com", password: "whatever-password" }));
    expect(response.status).toBe(401); // scripted registry has no such user
    expect(limiters.auth.calls).toEqual([`auth:${TEST_IP}`]);
    expect(limiters.account.calls).toHaveLength(1);
    expect(limiters.account.calls[0]).toMatch(/^login-account:[0-9a-f]{64}$/);
    expect(limiters.account.calls[0]).not.toContain("someone@example.com");
    expect(limiters.account.calls[0]).toBe(`login-account:${await accountLimiterKey("someone@example.com")}`);
  });

  it("keys the OTP account bucket by the normalized hashed phone, never the raw number", async () => {
    const { env, limiters } = makeEnv();
    await call(env, "/api/auth/otp/request", jsonInit({ phone: "09123456789" }));
    expect(limiters.account.calls).toHaveLength(1);
    const normalized = normalizeIranianPhone("09123456789");
    if (normalized === null) throw new Error("09123456789 must normalize");
    expect(normalized).toBe("+989123456789");
    expect(limiters.account.calls[0]).toBe(`otp-account:${await accountLimiterKey(normalized)}`);
    expect(limiters.account.calls[0]).not.toContain("09123456789");
  });

  it("returns a throttled 429 with Retry-After and a generic envelope when the IP auth budget is exhausted", async () => {
    const { env, limiters } = makeEnv({ authMax: 1 });
    const first = await call(env, "/api/auth/login", jsonInit({ email: "someone@example.com", password: "whatever-password" }));
    expect(first.status).toBe(401);
    const second = await call(env, "/api/auth/login", jsonInit({ email: "someone@example.com", password: "whatever-password" }));
    expect(second.status).toBe(429);
    expect(second.headers.get("retry-after")).toBe("60");
    const body = (await second.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("rate_limited");
    expect(body.error.message).toBe("Too many requests. Try again shortly.");
    expect(JSON.stringify(body)).not.toContain("someone@example.com");
    expect(limiters.account.calls).toHaveLength(1); // the IP budget ran out first; account budget consulted once
  });

  it("throttles on the per-account budget independently of the IP budget", async () => {
    const { env, limiters } = makeEnv({ accountMax: 1 });
    const first = await call(env, "/api/auth/login", jsonInit({ email: "someone@example.com", password: "whatever-password" }));
    expect(first.status).toBe(401);
    const second = await call(env, "/api/auth/login", jsonInit({ email: "someone@example.com", password: "whatever-password" }));
    expect(second.status).toBe(429);
    expect(second.headers.get("retry-after")).toBe("60");
    expect(((await second.json()) as { error: { code: string } }).error.code).toBe("rate_limited");
    expect(limiters.auth.calls).toHaveLength(2); // IP budget never exhausted
  });

  it("bounds repeated anonymous inquiries with the same generic 429 envelope", async () => {
    const { env } = makeEnv({ writeMax: 2 });
    const statuses: number[] = [];
    const bodies: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const response = await call(env, INQUIRY_PATH, jsonInit(INQUIRY_BODY));
      statuses.push(response.status);
      bodies.push(await response.text());
    }
    expect(statuses).toEqual([404, 404, 429]);
    expect(bodies[2]).toContain("rate_limited");
    expect(bodies[2]).toContain("Too many requests");
  });

  it("fails CLOSED with an honest 503 when production lacks limiter bindings", async () => {
    const { env } = makeEnv({ appEnv: "production", withLimiters: false });
    const api = await call(env, "/api/horses");
    expect(api.status).toBe(503);
    expect(((await api.json()) as { error: { code: string } }).error.code).toBe("rate_limiter_unavailable");
    // Static pages are served without a limiter and stay available.
    const page = await call(env, "/");
    expect(page.status).toBe(200);
  });

  it("allows explicit development environments to omit limiter bindings", async () => {
    const { env } = makeEnv({ appEnv: "development", withLimiters: false });
    const response = await call(env, "/api/public-probe");
    expect(response.status).toBe(404); // reached routing, not a 503 limiter failure
  });
});

// ---------------------------------------------------------------------------
// D. Request body limits.
// ---------------------------------------------------------------------------

describe("P05 request body limits over HTTP", () => {
  it("rejects an oversized login body even when Content-Length is absent or dishonest", async () => {
    const { env } = makeEnv();
    const response = await call(env, "/api/auth/login", jsonInit(JSON.stringify({ email: "a@example.com", password: "x".repeat(8192) })));
    expect(response.status).toBe(413);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("body_too_large");
  });

  it("rejects an oversized inquiry body within the route budget", async () => {
    const { env } = makeEnv();
    const response = await call(env, INQUIRY_PATH, jsonInit({ buyer_name: "Test Buyer", buyer_contact: "buyer@example.com", message: "x".repeat(16 * 1024) }));
    expect(response.status).toBe(413);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("body_too_large");
  });
});

// ---------------------------------------------------------------------------
// E. Session lifecycle: rotation on login, revocation on logout, expiry.
// ---------------------------------------------------------------------------

async function userWithPassword(password: string): Promise<Record<string, unknown>> {
  return {
    id: "u-1",
    email: "owner@example.com",
    display_name: "Owner",
    role: "owner",
    is_active: 1,
    password_hash: await hashPassword(password),
  };
}

describe("P05 session lifecycle over HTTP", () => {
  it("mints a fresh session (rotated token AND csrf) on every login", async () => {
    const db = makeDb({ user: await userWithPassword("correct-horse-battery") });
    const { env } = makeEnv({ db });
    const credentials = { email: "owner@example.com", password: "correct-horse-battery" };

    const first = await call(env, "/api/auth/login", jsonInit(credentials, { origin: ORIGIN_HTTPS }));
    expect(first.status).toBe(200);
    const cookie = first.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("hr_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Secure"); // HTTPS ingress

    const second = await call(env, "/api/auth/login", jsonInit(credentials, { origin: ORIGIN_HTTPS }));
    expect(second.status).toBe(200);

    const inserts = db.__writes.filter((w) => w.sql.includes("INSERT INTO sessions"));
    expect(inserts).toHaveLength(2);
    const [firstInsert, secondInsert] = inserts;
    expect(firstInsert?.args[2]).not.toBe(secondInsert?.args[2]); // token_hash rotated
    expect(firstInsert?.args[3]).not.toBe(secondInsert?.args[3]); // csrf rotated
  });

  it("never echoes the password hash or the session token in the login response", async () => {
    const db = makeDb({ user: await userWithPassword("correct-horse-battery") });
    const { env } = makeEnv({ db });
    const response = await call(env, "/api/auth/login", jsonInit({ email: "owner@example.com", password: "correct-horse-battery" }));
    const body = await response.text();
    expect(body).not.toContain("pbkdf2");
    const sessionInsert = db.__writes.find((w) => w.sql.includes("INSERT INTO sessions"));
    expect(body).not.toContain(String(sessionInsert?.args[2])); // hashed token
  });

  it("rejects an expired session cookie", async () => {
    const expired = futureSession();
    expired.expires_at = new Date(Date.now() - 60_000).toISOString();
    const { env } = makeEnv({ db: makeDb({ session: expired }) });
    const response = await call(env, "/api/auth/me", { headers: { cookie: "hr_session=expired-token" } });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { user: unknown };
    expect(body.user).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// F. Account-existence privacy (no enumeration).
// ---------------------------------------------------------------------------

describe("P05 no account enumeration over HTTP", () => {
  it("returns a byte-identical 401 for a nonexistent account and a wrong password", async () => {
    const db = makeDb({ user: await userWithPassword("correct-horse-battery") });
    const { env } = makeEnv({ db });
    const ghost = await call(env, "/api/auth/login", jsonInit({ email: "ghost@example.com", password: "whatever-password" }));
    const wrong = await call(env, "/api/auth/login", jsonInit({ email: "owner@example.com", password: "wrong-password-123" }));
    expect(ghost.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(ghost.headers.get("content-type")).toBe(wrong.headers.get("content-type"));
    expect(await ghost.text()).toBe(await wrong.text());
  });

  it("answers password recovery with the same envelope whether or not the account exists", async () => {
    const db = makeDb({ user: await userWithPassword("correct-horse-battery") });
    const { env } = makeEnv({ db });
    const ghost = await call(env, "/api/auth/recover/request", jsonInit({ email: "ghost@example.com" }));
    const known = await call(env, "/api/auth/recover/request", jsonInit({ email: "owner@example.com" }));
    expect(ghost.status).toBe(known.status);
    const ghostText = await ghost.text();
    const knownText = await known.text();
    expect(ghostText).toBe(knownText);
    const body = JSON.parse(knownText) as { requested: boolean; demoTokenUrl?: string };
    expect(body.requested).toBe(true);
    expect(body.demoTokenUrl).toBeUndefined(); // never leaked in production
  });
});

// ---------------------------------------------------------------------------
// G. Egress safety: the media proxy is allowlist-bounded, no open redirects.
// ---------------------------------------------------------------------------

describe("P05 egress safety over HTTP", () => {
  it("refuses to proxy off-allowlist image hosts", async () => {
    const { env } = makeEnv();
    const offList = await call(env, "/api/media/proxy?u=https%3A%2F%2Fevil.example%2Fx.png");
    expect(offList.status).toBe(400);
    expect(((await offList.json()) as { error: { code: string } }).error.code).toBe("media_proxy_invalid_url");
  });

  it("requires the u parameter and rejects non-https schemes", async () => {
    const { env } = makeEnv();
    const missing = await call(env, "/api/media/proxy");
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe("media_proxy_invalid_url");
    const httpScheme = await call(env, "/api/media/proxy?u=http%3A%2F%2Fupload.wikimedia.org%2Fx.png");
    expect(httpScheme.status).toBe(400);
  });

  it("never issues an HTTP redirect for API paths", async () => {
    const { env } = makeEnv();
    for (const [path, init] of [
      ["/api/horses", {}],
      ["/api/public-probe", {}],
      [INQUIRY_PATH, jsonInit(INQUIRY_BODY, { origin: ORIGIN_HTTPS })],
      ["/api/media/proxy?u=https%3A%2F%2Fevil.example%2Fx.png", {}],
    ] as Array<[string, RequestInit]>) {
      const response = await call(env, path, init);
      expect(Math.floor(response.status / 100), path).not.toBe(3); // never a redirect
      expect(response.headers.get("location"), path).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// H. R91 D1 enforcement layer — the live P05 finding.
//
// A controlled live probe (2026-10-03) proved the Cloudflare rate-limiting
// BINDING admits every request on this account (limit 3/60s returned success
// 7/7 times). The D1 fixed-window counter (migration 0040) is therefore the
// actual enforcement for the abuse-critical classes; these fixtures drive it
// through the real Worker.
// ---------------------------------------------------------------------------

describe("P05 D1 enforcement layer over HTTP", () => {
  it("throttles when the binding admits everything (the live no-op condition)", async () => {
    const rateCounts = new Map<string, number>([["d1:auth:203.0.113.7", 10]]); // IP already at the 10/min budget
    const { env, limiters } = makeEnv({ db: makeDb({ rateCounts, user: null }) });
    const response = await call(env, "/api/auth/login", jsonInit({ email: "someone@example.com", password: "whatever-password" }));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("rate_limited");
    // The binding layer was consulted and admitted — the D1 layer throttled.
    expect(limiters.auth.calls.length).toBeGreaterThan(0);
    expect(rateCounts.get("d1:auth:203.0.113.7")).toBe(11);
  });

  it("throttles the per-account login budget independently of the IP budget", async () => {
    const rateCounts = new Map<string, number>();
    const db = makeDb({ user: null, rateCounts });
    const { env } = makeEnv({ db });
    const credentials = { email: "victim@example.com", password: "wrong-password-1" };
    // The IP budget is 10/min and the account budget 5/min: the 6th attempt
    // against ONE account from a fresh IP must 429 before the IP budget ends.
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const response = await call(env, "/api/auth/login", jsonInit(credentials));
      statuses.push(response.status);
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
    const throttled = statuses.filter((status) => status === 429).length;
    expect(throttled).toBe(1);
  });

  it("throttles write-class mutations through the D1 window", async () => {
    const rateCounts = new Map<string, number>([["d1:write:203.0.113.7", 30]]);
    const { env } = makeEnv({ db: makeDb({ rateCounts }) });
    const response = await call(env, INQUIRY_PATH, jsonInit(INQUIRY_BODY));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
  });

  it("fails CLOSED with an honest 503 when the D1 counter fails in production", async () => {
    const { env } = makeEnv({ db: makeDb({ rateCounterError: new Error("d1 quota exhausted") }) });
    const response = await call(env, "/api/auth/login", jsonInit({ email: "x@example.com", password: "whatever-password" }));
    expect(response.status).toBe(503);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("rate_limiter_unavailable");
  });

  it("admits requests when the D1 counter fails in an explicit development environment", async () => {
    const { env } = makeEnv({ appEnv: "development", db: makeDb({ rateCounterError: new Error("no local d1") }) });
    const response = await call(env, "/api/public-probe");
    expect(response.status).toBe(404); // reached routing — no throttle, no 503
  });

  it("public reads never touch the D1 counter (binding-only, cheap and cache-friendly)", async () => {
    const rateCounts = new Map<string, number>();
    const db = makeDb({ rateCounts });
    const { env } = makeEnv({ db });
    await call(env, "/api/public-probe");
    expect(rateCounts.size).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import workerDefault from "../../src/worker";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * R88 agent plan P01 — fail-closed startup/provider checks, over HTTP.
 *
 * "Fail startup on unsupported provider/capability combinations. Document
 * deliberately unsupported adapters instead of silently falling back to mock or
 * a different source of truth."
 *
 * Every fixture drives the REAL Worker entrypoint. The provider resolution
 * (src/db/provider.ts) runs before any route handler, so these responses prove
 * that an unsupported mode or a missing external binding can NEVER degrade
 * into an unconfigured database silently serving traffic — the request fails
 * with an honest, specific error instead.
 */

const worker = workerDefault as unknown as {
  fetch(request: Request, env: unknown): Promise<Response>;
};

const ORIGIN = "https://registry.example";

function makeDb(): D1Database {
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
    // R104 fail-closed limiter contract: the D1 enforcement counter must return
    // a valid positive integer; null/invalid fails closed with 503 in production.
    // Script a valid count so these fixtures exercise provider policy, not the limiter.
    first: async () => (sql.includes("rate_limit_counters") ? { count: 1 } : null),
    all: async () => ({ results: [] }),
    run: async () => ({ meta: { changes: 1 } }),
  });
  return {
    prepare: (sql: string) => makeBuilder(sql, []),
    batch: async (statements: Array<{ sql: string; args: unknown[] }>) =>
      statements.map(() => ({ results: [], success: true, meta: { changes: 1 } })),
  } as unknown as D1Database;
}

function makeEnv(providerMode?: string): Env {
  const limiter = { limit: async () => ({ success: true }) };
  const env: Record<string, unknown> = {
    APP_ENV: "production",
    SESSION_COOKIE_NAME: "hr_session",
    DB: makeDb(),
    ASSETS: { fetch: async () => new Response("<html>", { headers: { "content-type": "text/html" } }) },
    PUBLIC_RATE_LIMITER: limiter,
    AUTH_RATE_LIMITER: limiter,
    EXPENSIVE_RATE_LIMITER: limiter,
    WRITE_RATE_LIMITER: limiter,
    ACCOUNT_RATE_LIMITER: limiter,
  };
  if (providerMode !== undefined) env.DB_PROVIDER_MODE = providerMode;
  // NOTE: no SUPABASE_HYPERDRIVE / SUPABASE_DATABASE_URL / TURSO_* bindings —
  // exactly the "binding missing at startup" condition under test.
  return env as unknown as Env;
}

function call(env: unknown, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("cf-connecting-ip", "203.0.113.7");
  return worker.fetch(new Request(`${ORIGIN}${path}`, { ...init, headers }), env);
}

async function errorBody(response: Response): Promise<{ code: string; message: string }> {
  return ((await response.json()) as { error: { code: string; message: string } }).error;
}

describe("P01 fail-closed database provider checks over HTTP", () => {
  it("rejects an unsupported provider mode with a specific 500 instead of guessing", async () => {
    const response = await call(makeEnv("bogus_mode"), "/api/horses");
    expect(response.status).toBe(500);
    expect((await errorBody(response)).code).toBe("invalid_database_provider_mode");
  });

  it("fails closed when a supabase mode has no binding or connection string", async () => {
    // supabase_full is the canonical mode: every request hits the binding check.
    {
      const response = await call(makeEnv("supabase_full"), "/api/horses");
      expect(response.status).toBe(503);
      expect((await errorBody(response)).code).toBe("supabase_not_configured");
    }
    // R98: supabase_only is a PUBLIC SNAPSHOT mode — a request outside the
    // narrow anonymous public allowlist is denied before the binding is even
    // consulted (never a silent broad read).
    {
      const response = await call(makeEnv("supabase_only"), "/api/horses");
      expect(response.status).toBe(503);
      expect((await errorBody(response)).code).toBe("snapshot_provider_private_read_denied");
    }
    // An allowlisted anonymous public read (GET /api/search) reaches the
    // binding check and fails closed with the specific missing-binding error.
    {
      const response = await call(makeEnv("supabase_only"), "/api/search");
      expect(response.status).toBe(503);
      expect((await errorBody(response)).code).toBe("supabase_not_configured");
    }
    // Dual-provider supabase failover: /api/horses is not public-snapshot
    // eligible, so it is denied as a snapshot-private request.
    {
      const response = await call(makeEnv("supabase_with_d1_read_failover"), "/api/horses");
      expect(response.status).toBe(503);
      expect((await errorBody(response)).code).toBe("snapshot_provider_private_read_denied");
    }
    // The split mode probes supabase for allowlisted public reads; with no
    // binding and an unconfigured turso fallback the composed failure is
    // still fail-closed — never a silent fallback.
    {
      const response = await call(makeEnv("supabase_read_with_d1_write"), "/api/search");
      expect(response.status).toBe(503);
      expect((await errorBody(response)).code).toBe("database_unavailable");
    }
  });

  it("fails closed when a turso mode has no credentials", async () => {
    const response = await call(makeEnv("turso_only"), "/api/horses");
    expect(response.status).toBe(503);
    expect((await errorBody(response)).code).toBe("turso_not_configured");
    // R98: /api/horses is not public-snapshot eligible, so the failover mode
    // surfaces the specific missing-binding error (no fallback is attempted
    // for a non-allowlisted read).
    const ineligible = await call(makeEnv("turso_with_d1_read_failover"), "/api/horses");
    expect(ineligible.status).toBe(503);
    expect((await errorBody(ineligible)).code).toBe("turso_not_configured");
    // An allowlisted public read probes turso first, then evaluates the d1
    // fallback — the composed database_unavailable error (details carry the
    // underlying cause) — still fail-closed.
    const failover = await call(makeEnv("turso_with_d1_read_failover"), "/api/search");
    expect(failover.status).toBe(503);
    expect((await errorBody(failover)).code).toBe("database_unavailable"); // probe path, composed cause
  });

  it("keeps dual-provider failover modes read-only for canonical writes", async () => {
    for (const mode of ["d1_with_turso_read_failover", "d1_with_supabase_read_failover"]) {
      const response = await call(makeEnv(mode), "/api/horses", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      expect(response.status, mode).toBe(503);
      expect((await errorBody(response)).code, mode).toBe("database_failover_mode_read_only");
    }
  });

  it("keeps the supabase read-with-d1-write split honest (R98: private reads use canonical D1; only allowlisted anonymous public reads touch supabase)", async () => {
    const env = makeEnv("supabase_read_with_d1_write");
    // A read outside the anonymous public allowlist is routed to the
    // canonical WRITE authority (D1) — the R98 stale-snapshot privacy
    // boundary — and succeeds without ever consulting supabase.
    const read = await call(env, "/api/horses");
    expect(read.status).toBe(200);
    // An allowlisted anonymous public read must come from the supabase
    // snapshot provider; with no binding it fails closed (no silent D1
    // substitution for the reviewed public snapshot surface).
    const publicRead = await call(env, "/api/search");
    expect(publicRead.status).toBe(503);
    expect((await errorBody(publicRead)).code).toBe("database_unavailable");
    // The write intent routes to D1 (the configured binding) — it reaches the
    // route handler and fails on AUTH, not on provider resolution.
    const write = await call(env, "/api/horses", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(write.status).toBe(401);
    expect((await errorBody(write)).code).toBe("authentication_required");
  });

  it("explicit d1_only serves traffic when D1 is bound; an unconfigured environment resolves supabase_full and fails closed", async () => {
    // R102: the implicit default changed from d1_only to supabase_full (audited
    // change — production always sets DB_PROVIDER_MODE explicitly, and local
    // SQLite development selects its D1-compatible mode in the Vite plugin).
    // With only D1 bound, the resolved supabase_full posture has no Supabase
    // authority, so it must fail closed rather than silently serving from D1.
    const explicit = await call(makeEnv("d1_only"), "/api/horses");
    expect(explicit.status, "d1_only").toBe(200);
    const unconfigured = await call(makeEnv(undefined), "/api/horses");
    expect(unconfigured.status, "undefined").toBe(503);
    expect((await errorBody(unconfigured)).code).toBe("supabase_not_configured");
  });

  it("never silently substitutes a mock or a different source of truth", async () => {
    // Every unsupported combination above failed with a SPECIFIC error code.
    // This fixture pins that none of them can ever answer 200 from a fallback:
    // a request that cannot be served by the CONFIGURED provider must fail.
    const responses = await Promise.all([
      call(makeEnv("bogus"), "/api/horses"),
      call(makeEnv("supabase_only"), "/api/horses"),
      call(makeEnv("turso_only"), "/api/horses"),
      call(makeEnv("d1_with_turso_read_failover"), "/api/horses", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
    ]);
    for (const response of responses) {
      expect(response.status).toBeGreaterThanOrEqual(500);
    }
  });
});

import { describe, expect, it } from "vitest";
import workerDefault from "../../src/worker";
import { hashPassword } from "../../src/auth/password";
import { createPlatformClient } from "../../src/frontend-kit/platformClient";
import { PlatformClientError } from "../../src/frontend-kit/errors";
import type { PlatformUser, PlatformPermission } from "../../src/frontend-kit";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * R108-03 PART B — two tabs against the REAL Worker (src/worker.ts default
 * export — the same module Cloudflare deploys) with REAL cookies and a
 * STATEFUL scripted D1: real users (real password hashes verified by the
 * production verifier), real session INSERT/DELETE semantics, real
 * Set-Cookie round trips through two independent cookie jars. /me after
 * logout genuinely misses because the session row is gone, not because a
 * fixture said so. Same discipline as tests/integration/http-security.test.ts;
 * the only substituted boundary is the D1 binding itself.
 *
 * This file runs in the NODE environment (not happy-dom): the browser
 * environment hides Set-Cookie behind the fetch spec's forbidden-header
 * rule, which would make the real cookie round trip untestable.
 */
const worker = workerDefault as unknown as {
  fetch(request: Request, env: unknown): Promise<Response>;
};
const ORIGIN = "https://registry.example";

function makeStatefulSessionDb(users: Array<{ id: string; email: string; role: "user" | "owner"; password: string }>) {
  interface SessionRow { sessionId: string; userId: string; tokenHash: string; csrfToken: string; expiresAt: string }
  const sessions = new Map<string, SessionRow>(); // by session id
  const writes: Array<{ sql: string; args: unknown[] }> = [];
  const rateCounts = new Map<string, number>(); // real fixed-window counters
  const userRows = new Map(users.map((u) => [u.email, u]));
  const byEmail = (email: string) => {
    for (const row of userRows.values()) if (row.email.toLowerCase() === email.toLowerCase()) return row;
    return null;
  };
  interface Builder {
    sql: string; args: unknown[];
    bind: (...next: unknown[]) => Builder;
    first: () => Promise<unknown>;
    all: () => Promise<{ results: unknown[] }>;
    run: () => Promise<{ meta: { changes: number } }>;
  }
  const makeBuilder = (sql: string, args: unknown[]): Builder => ({
    sql, args,
    bind: (...next: unknown[]) => makeBuilder(sql, next),
    first: async () => {
      if (sql.includes("rate_limit_counters")) {
        // RATE_LIMIT_UPSERT_SQL ... RETURNING count — a real fixed window.
        const key = String(args[0]);
        const next = (rateCounts.get(key) ?? 0) + 1;
        rateCounts.set(key, next);
        return { count: next };
      }
      if (sql.includes("FROM users WHERE email")) {
        const found = byEmail(String(args[0]));
        if (!found) return null;
        return { id: found.id, email: found.email, display_name: found.id, role: found.role, password_hash: passwordHashes.get(found.id)!, is_active: 1, created_at: "2026-01-01", updated_at: "2026-01-01", last_login_at: null };
      }
      if (sql.includes("FROM sessions s JOIN users u")) {
        const tokenHash = String(args[0]);
        for (const row of sessions.values()) {
          if (row.tokenHash !== tokenHash) continue;
          if (Date.parse(row.expiresAt) <= Date.now()) return null;
          const user = users.find((u) => u.id === row.userId)!;
          return { session_id: row.sessionId, csrf_token: row.csrfToken, expires_at: row.expiresAt, last_seen_at: new Date().toISOString(), id: user.id, email: user.email, display_name: user.id, role: user.role, is_active: 1 };
        }
        return null;
      }
      return null;
    },
    all: async () => ({ results: [] }),
    run: async () => {
      writes.push({ sql, args });
      if (sql.includes("INSERT INTO sessions(")) {
        const [id, userId, tokenHash, csrfToken, expiresAt] = args as [string, string, string, string, string];
        sessions.set(String(id), { sessionId: String(id), userId: String(userId), tokenHash: String(tokenHash), csrfToken: String(csrfToken), expiresAt: String(expiresAt) });
        return { meta: { changes: 1 } };
      }
      if (sql.includes("DELETE FROM sessions WHERE id=?")) {
        const before = sessions.size;
        sessions.delete(String(args[0]));
        return { meta: { changes: before - sessions.size } };
      }
      return { meta: { changes: 0 } };
    },
  });
  const db = {
    prepare: (sql: string) => makeBuilder(sql, []),
    batch: async (statements: Array<{ sql: string; args: unknown[] }>) => {
      for (const s of statements) writes.push({ sql: s.sql, args: s.args });
      return statements.map((s) => ({ results: [], success: true, meta: { changes: 0 } }));
    },
  };
  const passwordHashes = new Map<string, string>();
  const prime = async () => { for (const u of users) passwordHashes.set(u.id, await hashPassword(u.password)); };
  return Object.assign(db as unknown as D1Database, { __writes: writes, __sessions: sessions, prime });
}

/** A browser tab: its own cookie jar + its own platform client (real host wiring). */
function makeTab(db: D1Database) {
  const env = {
    APP_ENV: "production",
    DB_PROVIDER_MODE: "d1_only",
    SESSION_COOKIE_NAME: "hr_session",
    DB: db,
    ASSETS: { fetch: async () => new Response("ok") },
    PUBLIC_RATE_LIMITER: { limit: async () => ({ success: true }) },
    AUTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
    WRITE_RATE_LIMITER: { limit: async () => ({ success: true }) },
    EXPENSIVE_RATE_LIMITER: { limit: async () => ({ success: true }) },
    ACCOUNT_RATE_LIMITER: { limit: async () => ({ success: true }) },
  };
  let cookie: string | null = null;
  const state: { user: PlatformUser | null; permissions: PlatformPermission[]; csrf: string | null } = { user: null, permissions: [], csrf: null };
  const client = createPlatformClient({
    transport: async <T,>(url: string, init?: RequestInit): Promise<T> => {
      const headers = new Headers(init?.headers as HeadersInit | undefined);
      headers.set("origin", ORIGIN);
      if (cookie) headers.set("cookie", `hr_session=${cookie}`);
      const response = await worker.fetch(new Request(`${ORIGIN}${url}`, { method: (init?.method as string) ?? "GET", headers, body: init?.body }), env);
      const setCookie = response.headers.get("set-cookie") ?? "";
      const cleared = /hr_session=;/.test(setCookie);
      const matched = /hr_session=([^;]+)/.exec(setCookie);
      if (matched && !cleared) cookie = matched[1];
      if (cleared) cookie = null;
      // Same non-2xx discipline as the real createFetchPlatformTransport:
      // the server's error envelope code is surfaced, never swallowed into
      // an invalid_session_response.
      const data = await response.json().catch(() => undefined) as { error?: { code?: string; message?: string } } | undefined;
      if (!response.ok) {
        throw new PlatformClientError(response.status, data?.error?.code ?? "invalid_error_response", data?.error?.message ?? "Request failed");
      }
      return data as T;
    },
    csrfToken: () => state.csrf,
    onSessionChange: (session) => {
      state.user = session.user;
      state.permissions = [...session.permissions];
      state.csrf = session.csrfToken;
    },
  });
  return { client, state, readCookie: () => cookie };
}

describe("R108-03 B. two tabs against the real Worker (real cookies, stateful sessions)", () => {
  it("two simultaneous principals stay isolated; one tab's logout cannot touch the other", async () => {
    const db = makeStatefulSessionDb([
      { id: "user-a", email: "a@example.com", role: "owner", password: "correct-horse-a" },
      { id: "user-b", email: "b@example.com", role: "user", password: "correct-horse-b" },
    ]);
    await db.prime();
    const tabA = makeTab(db as unknown as D1Database);
    const tabB = makeTab(db as unknown as D1Database);

    // Tab A signs in as the owner; tab B as a plain user — REAL password
    // verification, REAL session inserts, REAL Set-Cookie round trips.
    const loginA = await tabA.client.auth.login({ email: "a@example.com", password: "correct-horse-a" });
    expect(loginA.user?.id).toBe("user-a");
    expect(tabA.state.user?.id).toBe("user-a");
    expect(tabA.state.permissions).toContain("claim.create");
    expect(tabA.readCookie()).toBeTruthy();

    const loginB = await tabB.client.auth.login({ email: "b@example.com", password: "correct-horse-b" });
    expect(loginB.user?.id).toBe("user-b");
    expect(tabB.state.permissions).not.toContain("claim.create");
    expect(tabB.readCookie()).toBeTruthy();
    expect(tabB.readCookie()).not.toBe(tabA.readCookie());

    // Both tabs read their OWN principal through the real session store.
    await tabA.client.auth.me();
    expect(tabA.state.user?.id).toBe("user-a");
    await tabB.client.auth.me();
    expect(tabB.state.user?.id).toBe("user-b");

    // A WRONG password never authenticates (no fixture bypass of auth).
    const impostor = makeTab(db as unknown as D1Database);
    const badLogin = await impostor.client.auth.login({ email: "a@example.com", password: "wrong-password" }).catch((error: { code?: string }) => error);
    expect((badLogin as { code?: string })?.code).toBe("invalid_credentials");
    expect(impostor.state.user).toBeNull();
    expect(impostor.readCookie()).toBeNull();

    // Tab A signs out: ONLY A's session row is deleted; tab B keeps its own.
    await tabA.client.auth.logout();
    expect(tabA.state.user).toBeNull();
    expect(tabA.readCookie()).toBeNull();
    await tabB.client.auth.me();
    expect(tabB.state.user?.id).toBe("user-b");
    expect(tabB.state.permissions).toHaveLength(4);

    // Tab A's cookie is gone and its client state is honestly anonymous.
    expect(tabA.state.user).toBeNull();
    expect(tabA.state.permissions).toHaveLength(0);
    // The stateful store proves exactly one session remains: tab B's.
    expect(db.__sessions.size).toBe(1);
    // And tab A's subsequent /me (no cookie) is honestly anonymous through
    // the real worker path.
    const meAfterLogout = await tabA.client.auth.me();
    expect(meAfterLogout.user).toBeNull();
    expect(tabA.state.user).toBeNull();
  });
});

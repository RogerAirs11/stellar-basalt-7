import { describe, expect, it } from "vitest";
import workerDefault from "../../src/worker";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * R88 agent plan P04 — HTTP-level role matrix for the marketplace command
 * layer (org member / revoked member / unrelated user / staff), through the
 * REAL Worker entrypoint.
 *
 * Division of proof: the SQL semantics of the in-write authority predicate
 * (direct grant, organization-mediated grant, membership revocation, staff
 * branch) are proven by real-SQL replay on both engines — tests/python
 * test_p03_marketplace_commands.py + test_p01_execution_parity.py. These
 * fixtures pin the HTTP WIRING: the route resolves the acting identity,
 * enforces CSRF, feeds actor + isStaff + expected_version into the guarded
 * statement, and maps the outcomes (authority failure -> 403, stale version
 * -> 409 with current_version, success -> 200) to the documented responses.
 */

const worker = workerDefault as unknown as {
  fetch(request: Request, env: unknown): Promise<Response>;
};

const ORIGIN = "https://registry.example";
const LISTING_ID = "11111111-1111-4111-8111-111111111111";
const STATUS_PATH = `/api/market/listings/${LISTING_ID}/status`;

interface Scripted {
  session?: Record<string, unknown> | null;
  listing?: Record<string, unknown> | null;
  grant?: Record<string, unknown> | null;
}

interface Recorded {
  sql: string;
  args: unknown[];
}

function makeDb(script: Scripted) {
  const writes: Recorded[] = [];
  const answerFirst = (sql: string): unknown => {
    // R104 fail-closed limiter contract: the D1 enforcement counter must return
    // a valid positive integer; null/invalid fails closed with 503 in
    // production. Script a valid count so these fixtures exercise the
    // marketplace role matrix, not the limiter.
    if (sql.includes("rate_limit_counters")) return { count: 1 };
    // This HTTP wiring fixture models an unenrolled account under optional
    // MFA. Real factor/session/replay SQL is exercised by r148-mfa.test.ts;
    // do not treat this scripted branch as evidence of MFA enforcement.
    if (sql.includes("auth_mfa_session_assurance")) return { allowed: 1 };
    if (sql.includes("FROM sessions s JOIN users u")) return script.session ?? null;
    if (sql.includes("FROM sales_listings WHERE id=?")) return script.listing ?? null;
    if (sql.includes("FROM horse_access_grants g")) return script.grant ?? null;
    if (sql.includes("FROM command_receipts")) return null;
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
    first: async () => answerFirst(sql),
    all: async () => ({ results: script.grant ? [script.grant] : [] }),
    run: async () => { writes.push({ sql, args }); return { meta: { changes: 1 } }; },
  });
  const db = {
    prepare: (sql: string) => makeBuilder(sql, []),
    batch: async (statements: Array<{ sql: string; args: unknown[] }>) => {
      for (const statement of statements) writes.push({ sql: statement.sql, args: statement.args });
      return statements.map(() => ({ results: [], success: true, meta: { changes: 1 } }));
    },
  };
  return Object.assign(db as unknown as D1Database, { __writes: writes });
}

function sessionFor(userId: string, role: string): Record<string, unknown> {
  return {
    session_id: `s-${userId}`,
    csrf_token: `csrf-${userId}`,
    expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
    last_seen_at: new Date().toISOString(),
    id: userId,
    email: `${userId}@example.com`,
    display_name: userId,
    role,
    is_active: 1,
  };
}

function listingFor(sellerUserId: string, rowVersion = 1): Record<string, unknown> {
  return {
    id: LISTING_ID,
    horse_id: 5,
    seller_user_id: sellerUserId,
    status: "active",
    expires_at: null,
    row_version: rowVersion,
  };
}

/** An active organization-mediated seller grant (the org-member authority). */
const ORG_GRANT = {
  id: "g-org-5",
  horse_id: 5,
  grantee_user_id: null,
  grantee_organization_id: 1,
  relationship: "seller",
  actions: "create_listing,manage_inquiries",
  basis: "parity",
  basis_ref: null,
  valid_from: "2026-01-01T00:00:00.000Z",
  valid_until: null,
  revoked_at: null,
};

function makeEnv(db: ReturnType<typeof makeDb>): Env {
  const limiter = { limit: async () => ({ success: true }) };
  return {
    APP_ENV: "production",
    DB_PROVIDER_MODE: "d1_only", // R102: these tests exercise the D1 test binding explicitly; implicit default is now supabase_full
    SESSION_COOKIE_NAME: "hr_session",
    DB: db,
    ASSETS: { fetch: async () => new Response("<html>") },
    PUBLIC_RATE_LIMITER: limiter,
    AUTH_RATE_LIMITER: limiter,
    EXPENSIVE_RATE_LIMITER: limiter,
    WRITE_RATE_LIMITER: limiter,
    ACCOUNT_RATE_LIMITER: limiter,
  } as unknown as Env;
}

async function postStatus(env: unknown, sessionUserId: string, body: unknown, extraHeaders: Record<string, string> = {}): Promise<Response> {
  const request = new Request(`${ORIGIN}${STATUS_PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": "203.0.113.7",
      cookie: `hr_session=token-${sessionUserId}`,
      "x-csrf-token": `csrf-${sessionUserId}`,
      origin: ORIGIN,
      "sec-fetch-site": "same-origin",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
  return worker.fetch(request, env);
}

describe("P04 marketplace command role matrix over HTTP", () => {
  it("an organization member with a live grant executes the versioned status command", async () => {
    const db = makeDb({ session: sessionFor("orgmate", "user"), listing: listingFor("orgmate"), grant: ORG_GRANT });
    const response = await postStatus(makeEnv(db), "orgmate", { status: "pending_sale", expected_version: 1 }, { "idempotency-key": "key-org-1" });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { id: string; status: string; row_version: number };
    expect(body).toEqual({ id: LISTING_ID, status: "pending_sale", row_version: 2 });

    // The guarded statement carries the ACTING identity and the live-grant
    // predicate binds — the in-write authority the SQL replay proves.
    const statusWrite = db.__writes.find((w) => w.sql.includes("UPDATE sales_listings"));
    expect(statusWrite).toBeTruthy();
    expect(statusWrite?.args).toContain("orgmate");
    expect(statusWrite?.args).toContain("create_listing");
    // R97: the authority arm is the LIVE database account (active user whose
    // role/editorial branch OR seller identity + live grant authorizes the
    // write) — the legacy route-level isStaff 0/1 flag no longer binds at all.
    expect(statusWrite?.sql).toContain("command_actor.is_active=1");
    expect(statusWrite?.sql).not.toContain("? = 1 OR");
    // The idempotency receipt landed in the same batch.
    expect(db.__writes.some((w) => w.sql.includes("INSERT INTO command_receipts"))).toBe(true);
  });

  it("a member whose grant/membership is gone receives horse_access_required, and nothing is written", async () => {
    const db = makeDb({ session: sessionFor("orgmate", "user"), listing: listingFor("orgmate"), grant: null });
    const response = await postStatus(makeEnv(db), "orgmate", { status: "pending_sale", expected_version: 1 });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("horse_access_required");
    expect(db.__writes).toHaveLength(0);
  });

  it("an unrelated user is refused before any grant evaluation", async () => {
    const db = makeDb({ session: sessionFor("stranger", "user"), listing: listingFor("orgmate"), grant: ORG_GRANT });
    const response = await postStatus(makeEnv(db), "stranger", { status: "pending_sale", expected_version: 1 });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("forbidden");
    expect(body.error.message).toContain("Only the seller or staff");
    expect(db.__writes).toHaveLength(0);
  });

  it("a stale expected_version is a 409 carrying the current version", async () => {
    const db = makeDb({ session: sessionFor("orgmate", "user"), listing: listingFor("orgmate", 2), grant: ORG_GRANT });
    const response = await postStatus(makeEnv(db), "orgmate", { status: "pending_sale", expected_version: 1 });
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string; details: { current_version: number } } };
    expect(body.error.code).toBe("listing_version_conflict");
    expect(body.error.details.current_version).toBe(2);
    expect(db.__writes).toHaveLength(0);
  });

  it("staff act through the explicit bounded branch, never through a grant", async () => {
    const db = makeDb({ session: sessionFor("admin", "admin"), listing: listingFor("someone-else"), grant: null });
    const response = await postStatus(makeEnv(db), "admin", { status: "pending_sale", expected_version: 1 });
    expect(response.status).toBe(200);
    const statusWrite = db.__writes.find((w) => w.sql.includes("UPDATE sales_listings"));
    expect(statusWrite?.args).toContain(1); // isStaff bound branch
    expect(statusWrite?.args).toContain("admin");
  });

  it("a missing CSRF token is refused before the command layer", async () => {
    const db = makeDb({ session: sessionFor("orgmate", "user"), listing: listingFor("orgmate"), grant: ORG_GRANT });
    const env = makeEnv(db);
    const response = await postStatus(env, "orgmate", { status: "pending_sale", expected_version: 1 }, { "x-csrf-token": "wrong" });
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("csrf_failed");
    expect(db.__writes).toHaveLength(0);
  });
});

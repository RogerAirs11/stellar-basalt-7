import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { D1Database } from "@cloudflare/workers-types";

/** Minimal bound-statement shape used by the fake D1 below. */
type BoundStatement = { sql: string; args: unknown[]; bind: (...args: unknown[]) => BoundStatement; first: () => Promise<unknown>; all: () => Promise<{ results: unknown[] }>; run: () => Promise<{ meta: { changes: number } }> };
import {
  requestPasswordReset,
  confirmPasswordReset,
  changePassword,
  revokeOtherSessions,
  CLAIM_PASSWORD_RESET_SQL,
  VOID_PRIOR_RESET_TOKENS_SQL,
  RESET_OTHER_SESSIONS_SQL,
  PASSWORD_RESET_MINUTES,
} from "../../src/auth/recovery";
import { CLAIM_EMAIL_VERIFICATION_SQL } from "../../src/api/modules/authExt";
import { enforceRateLimit, enforceAccountLoginLimit } from "../../src/security/rateLimit";
import { getSmsProvider, buildKavenegarOtpRequest, kavenegarSmsProvider } from "../../src/notifications/sms";
import { getEmailProvider, buildEmailRequest, emailMessageFor, emailActionUrl, httpEmailProvider } from "../../src/notifications/email";
import { hashPassword, verifyPassword } from "../../src/auth/password";
import type { AuthContext } from "../../src/auth/session";

/**
 * Master-Ai plan T13: real authentication delivery and recovery (engineering half).
 *
 * These fixtures pin:
 *   - F17: compare-and-set email-token consumption (one conditional UPDATE +
 *     RETURNING; replay/double-click cannot win twice);
 *   - F18: missing rate-limiter bindings fail CLOSED in production, stay
 *     permissive only in explicit local/development/test environments;
 *   - anti-enumeration password recovery: identical envelope whether or not
 *     the account exists; single-use hashed 30-minute tokens; reset revokes
 *     ALL sessions; change-password verifies the current password and revokes
 *     every OTHER session;
 *   - provider interfaces: Kavenegar SMS + generic HTTPS email adapters are
 *     null until the OWNER supplies credentials — nothing activates itself,
 *     nothing fabricates delivery;
 *   - wiring locks: routes/classifier/inventory/API docs all carry the family.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative: string) => readFileSync(join(repoRoot, relative), "utf8");

// ---------- shared fake D1 ----------

interface FakeDbPlan {
  /** Row returned for the user-lookup SELECT (users by email / by id). */
  lookupUser?: { id: string; email?: string; password_hash?: string } | null;
  /** Row returned for a CAS claim statement (UPDATE ... RETURNING). */
  claimRow?: { user_id: string } | null;
  /** Rows written by the last .run() (meta.changes). */
  runChanges?: number;
  /** Per-statement transactional batch change counts. */
  batchChanges?: number[];
}

function makeDb(plan: FakeDbPlan = {}) {
  const batchStatements: Array<{ sql: string; args: unknown[] }> = [];
  const runStatements: Array<{ sql: string; args: unknown[] }> = [];
  const makeBuilder = (sql: string, args: unknown[]): BoundStatement => ({
    sql,
    args,
    bind: (...nextArgs: unknown[]) => makeBuilder(sql, nextArgs),
    first: async () => {
      if (sql.includes("FROM users WHERE email=")) return plan.lookupUser ?? undefined;
      if (sql.includes("FROM users WHERE id=?")) {
        return plan.lookupUser ? { id: plan.lookupUser.id, password_hash: plan.lookupUser.password_hash ?? "x" } : undefined;
      }
      if (sql.trimStart().startsWith("UPDATE") && sql.includes("RETURNING user_id")) return plan.claimRow ?? undefined;
      return undefined;
    },
    all: async () => ({ results: [] }),
    run: async () => {
      runStatements.push({ sql, args });
      return { meta: { changes: plan.runChanges ?? 1 } };
    },
  });
  const db = {
    prepare: (sql: string) => makeBuilder(sql, []),
    batch: async (statements: BoundStatement[]) => {
      for (const statement of statements) batchStatements.push({ sql: statement.sql, args: (statement as unknown as { args: unknown[] }).args ?? [] });
      return statements.map((_, index) => ({ meta: { changes: plan.batchChanges?.[index] ?? 1 } }));
    },
    _batchStatements: batchStatements,
    _runStatements: runStatements,
  };
  return { db: db as unknown as D1Database, batchStatements, runStatements };
}

const authContext = (sessionId = "sess-1"): AuthContext => ({
  sessionId,
  csrfToken: "csrf",
  user: { id: "user-1", email: "user@example.com", display_name: "User", role: "user" },
});

function postRequest(path: string, body: unknown): Request {
  return new Request(`https://registry.example${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---------- F17: CAS email verification token ----------

describe("F17: compare-and-set email token consumption", () => {
  it("consumes via ONE conditional UPDATE ... RETURNING (no SELECT-then-UPDATE window)", () => {
    expect(CLAIM_EMAIL_VERIFICATION_SQL).toContain("UPDATE email_verifications");
    expect(CLAIM_EMAIL_VERIFICATION_SQL).toContain("SET consumed_at=CURRENT_TIMESTAMP");
    expect(CLAIM_EMAIL_VERIFICATION_SQL).toContain("consumed_at IS NULL");
    expect(CLAIM_EMAIL_VERIFICATION_SQL).toContain("datetime(expires_at)>datetime('now')");
    expect(CLAIM_EMAIL_VERIFICATION_SQL).toContain("RETURNING user_id");
    expect(CLAIM_EMAIL_VERIFICATION_SQL).toContain("purpose='signup'");
    // The old racy shape (SELECT the id first, then unconditional UPDATE by id) is gone.
    expect(CLAIM_EMAIL_VERIFICATION_SQL).not.toContain("SELECT id,user_id");
  });

  it("the authExt source no longer contains the racy SELECT-then-UPDATE consume", () => {
    const source = read("src/api/modules/authExt.ts");
    expect(source).not.toMatch(/SELECT id,user_id FROM email_verifications/);
  });

  it("password-reset tokens are NOT consumable through signup verification (purpose scoping)", () => {
    // The signup claim is scoped to purpose='signup'; the reset endpoint has its
    // own claim scoped to purpose='password_reset' — cross-purpose replay is dead.
    expect(CLAIM_EMAIL_VERIFICATION_SQL).toContain("purpose='signup'");
    expect(CLAIM_PASSWORD_RESET_SQL).toContain("purpose='password_reset'");
  });
});

// ---------- recovery: request (anti-enumeration) ----------

describe("T13 password recovery request", () => {
  it("production: identical envelope whether the account exists or not", async () => {
    const existing = makeDb({ lookupUser: { id: "user-1", email: "owner@example.com" } });
    const unknown = makeDb({ lookupUser: null });
    const env = { APP_ENV: "production" };
    const a = await requestPasswordReset(existing.db, env, postRequest("/api/auth/recover/request", { email: "owner@example.com" }));
    const b = await requestPasswordReset(unknown.db, env, postRequest("/api/auth/recover/request", { email: "zz@zz.zz" }));
    const bodyA = await a.json();
    const bodyB = await b.json();
    expect(a.status).toBe(b.status);
    expect(bodyA).toEqual(bodyB);
    expect(JSON.stringify(bodyA)).not.toContain("token");
  });

  it("dev: existing account surfaces the demo link; unknown account never does", async () => {
    const existing = makeDb({ lookupUser: { id: "user-1", email: "owner@example.com" } });
    const unknown = makeDb({ lookupUser: null });
    const env = { APP_ENV: "development" };
    const a = await requestPasswordReset(existing.db, env, postRequest("/api/auth/recover/request", { email: "owner@example.com" }));
    const b = await requestPasswordReset(unknown.db, env, postRequest("/api/auth/recover/request", { email: "zz@zz.zz" }));
    expect(((await a.json()) as { demoTokenUrl?: string }).demoTokenUrl).toMatch(/^\/api\/auth\/recover\/confirm\?token=/);
    expect(((await b.json()) as { demoTokenUrl?: string }).demoTokenUrl).toBeUndefined();
  });

  it("voids prior outstanding tokens before issuing exactly one fresh token", async () => {
    const { db, batchStatements } = makeDb({ lookupUser: { id: "user-1", email: "owner@example.com" } });
    await requestPasswordReset(db, { APP_ENV: "development" }, postRequest("/api/auth/recover/request", { email: "owner@example.com" }));
    expect(batchStatements.map((s) => s.sql.trim())).toEqual([VOID_PRIOR_RESET_TOKENS_SQL.trim(), expect.stringContaining("INSERT INTO email_verifications")]);
    expect(batchStatements[1]!.sql).toContain("'password_reset'");
  });

  it("issues single-use hashed tokens with a 30-minute expiry", () => {
    expect(PASSWORD_RESET_MINUTES).toBe(30);
    expect(INSERT_RESET_TOKEN_STATEMENT()).toContain("token_hash");
    expect(INSERT_RESET_TOKEN_STATEMENT()).not.toContain("token'");
  });

  function INSERT_RESET_TOKEN_STATEMENT(): string {
    return read("src/auth/recovery.ts");
  }

  it("rejects a malformed email with 400 before any database work", async () => {
    const { db } = makeDb({});
    await expect(
      requestPasswordReset(db, { APP_ENV: "production" }, postRequest("/api/auth/recover/request", { email: "not-an-email" })),
    ).rejects.toMatchObject({ status: 400, code: "invalid_request" });
  });
});

// ---------- recovery: confirm (CAS + rotation + revocation) ----------

describe("T13 password reset confirmation", () => {
  it("claims the token with ONE conditional UPDATE; loser of a race gets the generic 400", async () => {
    expect(CLAIM_PASSWORD_RESET_SQL).toContain("UPDATE email_verifications");
    expect(CLAIM_PASSWORD_RESET_SQL).toContain("consumed_at IS NULL");
    expect(CLAIM_PASSWORD_RESET_SQL).toContain("RETURNING user_id");
    const { db } = makeDb({ batchChanges: [0, 0, 0] });
    await expect(
      confirmPasswordReset(db, {}, postRequest("/api/auth/recover/confirm", { token: "t".repeat(40), new_password: "new-password-1" })),
    ).rejects.toMatchObject({ status: 400, code: "invalid_token" });
  });

  it("rotates the password and revokes ALL sessions in one batch", async () => {
    const { db, batchStatements } = makeDb({ batchChanges: [1, 1, 3] });
    const response = await confirmPasswordReset(db, {}, postRequest("/api/auth/recover/confirm", { token: "t".repeat(40), new_password: "new-password-1" }));
    expect(await response.json()).toMatchObject({ reset: true });
    expect(batchStatements.map((s) => s.sql.trim())).toEqual([
      expect.stringContaining("UPDATE email_verifications"),
      // Newline-formatted statement (remediation): UPDATE users\nSET password_hash=? …
      expect.stringMatching(/^UPDATE users\s+SET password_hash=\?/),
      expect.stringContaining("DELETE FROM sessions"),
    ]);
    // ALL sessions die — a stolen session must not survive a reset.
    expect(batchStatements[2]!.sql).not.toContain("id<>");
    // Every downstream effect is bound to the same operation marker as the
    // winning token claim; there is no free-standing user-id update.
    expect(batchStatements[1]!.sql).toContain("consumed_operation_id=?");
    expect(batchStatements[2]!.sql).toContain("consumed_operation_id=?");
  });

  it("the new password round-trips through hashPassword/verifyPassword", async () => {
    const encoded = await hashPassword("round-trip-password");
    expect(encoded.startsWith("pbkdf2-sha256$100000$")).toBe(true);
    expect(await verifyPassword("round-trip-password", encoded)).toBe(true);
    expect(await verifyPassword("wrong", encoded)).toBe(false);
  });
});

// ---------- change password + session revocation ----------

describe("T13 change password + other-session revocation", () => {
  it("refuses without the correct current password (generic 403)", async () => {
    const encoded = await hashPassword("correct-horse");
    const { db } = makeDb({ lookupUser: { id: "user-1", password_hash: encoded } });
    await expect(
      changePassword(db, postRequest("/api/auth/change-password", { current_password: "wrong", new_password: "different-1" }), authContext()),
    ).rejects.toMatchObject({ status: 403, code: "invalid_credentials" });
  });

  it("refuses an unchanged password with 422", async () => {
    const encoded = await hashPassword("correct-horse");
    const { db } = makeDb({ lookupUser: { id: "user-1", password_hash: encoded } });
    await expect(
      changePassword(db, postRequest("/api/auth/change-password", { current_password: "correct-horse", new_password: "correct-horse" }), authContext()),
    ).rejects.toMatchObject({ status: 422, code: "unchanged_password" });
  });

  it("rotates and revokes every OTHER session, keeping the current one", async () => {
    const encoded = await hashPassword("correct-horse");
    const { db, batchStatements } = makeDb({ lookupUser: { id: "user-1", password_hash: encoded } });
    const response = await changePassword(db, postRequest("/api/auth/change-password", { current_password: "correct-horse", new_password: "new-password-1" }), authContext("keep-me"));
    expect(await response.json()).toMatchObject({ changed: true, otherSessionsRevoked: true });
    expect(batchStatements[1]!.sql).toBe(RESET_OTHER_SESSIONS_SQL.trim());
    expect(batchStatements[1]!.sql).toContain("id<>");
    expect(batchStatements[1]!.args).toEqual(["user-1", "keep-me"]);
  });

  it("revokeOtherSessions reports the number of killed sessions", async () => {
    const { db, runStatements } = makeDb({ runChanges: 3 });
    const response = await revokeOtherSessions(db, authContext());
    expect(await response.json()).toMatchObject({ revoked: 3 });
    expect(runStatements[0]!.sql).toBe(RESET_OTHER_SESSIONS_SQL.trim());
  });
});

// ---------- F18: fail-closed rate limiting ----------

describe("F18: missing rate-limiter bindings fail closed in production", () => {
  const request = new Request("https://registry.example/api/auth/login", { method: "POST" });

  it("production + missing binding -> honest 503 (not silent unthrottled access)", async () => {
    const env = { APP_ENV: "production" } as unknown as Env;
    await expect(enforceRateLimit(request, env, "auth")).rejects.toMatchObject({ status: 503, code: "rate_limiter_unavailable" });
    await expect(enforceAccountLoginLimit(request, env)).rejects.toMatchObject({ status: 503, code: "rate_limiter_unavailable" });
  });

  it("unknown/unset environment also fails closed", async () => {
    const env = {} as unknown as Env;
    await expect(enforceRateLimit(request, env, "public")).rejects.toMatchObject({ status: 503 });
  });

  it("explicit local development and test environments may omit bindings", async () => {
    for (const APP_ENV of ["development", "test", "local"] as const) {
      const env = { APP_ENV } as unknown as Env;
      await expect(enforceRateLimit(request, env, "auth")).resolves.toBeUndefined();
      await expect(enforceAccountLoginLimit(request, env)).resolves.toBeUndefined();
    }
  });

  // R156 availability amendment: D1 is only the FAILOVER database (canonical
  // primary + write target is Supabase). When the D1 counter write fails in
  // production (free-tier daily row-write quota, error 7500, ...), the auth
  // class keeps the honest 503, but the expensive/write classes must admit —
  // the binding limiter still applies at the edge and mutations proceed to the
  // healthy primary instead of the whole platform 503ing off a failover DB.
  describe("R156: D1 counter failure with bindings present", () => {
    const limiterEnv = () => ({
      APP_ENV: "production",
      PUBLIC_RATE_LIMITER: { limit: () => ({ success: true }) },
      AUTH_RATE_LIMITER: { limit: () => ({ success: true }) },
      EXPENSIVE_RATE_LIMITER: { limit: () => ({ success: true }) },
      WRITE_RATE_LIMITER: { limit: () => ({ success: true }) },
      // env.DB intentionally missing → every counter write throws
    }) as unknown as Env;

    it("auth class stays fail-closed (503)", async () => {
      await expect(enforceRateLimit(new Request("https://registry.example/api/auth/login", { method: "POST" }), limiterEnv(), "auth"))
        .rejects.toMatchObject({ status: 503, code: "rate_limiter_unavailable" });
    });

    it("expensive class admits so pedigree/relationship reads survive a D1 outage", async () => {
      await expect(enforceRateLimit(new Request("https://registry.example/api/horses/1/pedigree"), limiterEnv(), "expensive"))
        .resolves.toBeUndefined();
    });

    it("write class admits so mutations route to the healthy canonical primary", async () => {
      await expect(enforceRateLimit(new Request("https://registry.example/api/horses", { method: "POST" }), limiterEnv(), "write"))
        .resolves.toBeUndefined();
    });
  });
});

// ---------- provider interfaces (owner-gated activation) ----------

describe("T13 SMS provider (Kavenegar adapter)", () => {
  it("is null until the OWNER supplies both API key and approved template", () => {
    expect(getSmsProvider({})).toBeNull();
    expect(getSmsProvider({ KAVENEGAR_API_KEY: "k" })).toBeNull();
    expect(getSmsProvider({ KAVENEGAR_OTP_TEMPLATE: "t" })).toBeNull();
    const provider = getSmsProvider({ KAVENEGAR_API_KEY: "k", KAVENEGAR_OTP_TEMPLATE: "registry-otp" });
    expect(provider?.name).toBe("kavenegar");
  });

  it("builds the official verify/lookup wire contract", () => {
    const { url, body } = buildKavenegarOtpRequest({ apiKey: "KEY", otpTemplate: "registry-otp" }, "+989121234567", "123456");
    expect(url).toBe("https://api.kavenegar.com/v1/KEY/verify/lookup.json");
    expect(body.get("receptor")).toBe("+989121234567");
    expect(body.get("token")).toBe("123456");
    expect(body.get("template")).toBe("registry-otp");
  });

  it("refuses to deliver to a non-Iranian-mobile number (configuration failure, no network)", async () => {
    const provider = kavenegarSmsProvider({ apiKey: "KEY", otpTemplate: "t" });
    const result = await provider.deliverOtp("+441234567890", "123456");
    expect(result).toEqual({ accepted: false, failure: "configuration" });
    // P13: acceptance semantics — a 2xx would be `accepted`, never `delivered`
  });
});

describe("T13 email provider (generic HTTPS adapter)", () => {
  it("is null until the OWNER supplies endpoint, key and sender", () => {
    expect(getEmailProvider({})).toBeNull();
    expect(getEmailProvider({ EMAIL_API_URL: "https://api.example/emails" })).toBeNull();
    expect(getEmailProvider({ EMAIL_API_URL: "https://api.example/emails", EMAIL_API_KEY: "k" })).toBeNull();
    expect(getEmailProvider({ EMAIL_API_URL: "https://api.example/emails", EMAIL_API_KEY: "k", EMAIL_FROM: "reg <n@example.com>" })?.name).toBe("http-email");
  });

  it("builds the bearer-authenticated JSON request with from/to/subject/html", () => {
    const config = { apiUrl: "https://api.example/emails", apiKey: "k", from: "reg <n@example.com>" };
    const { url, init } = buildEmailRequest(config, emailMessageFor("password_reset", "u@example.com", "https://registry.example/reset?t=1"));
    expect(url).toBe(config.apiUrl);
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer k");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ from: config.from, to: "u@example.com" });
    expect(body.subject).toContain("Password reset");
    expect(body.html).toContain("https://registry.example/reset?t=1");
  });

  it("bilingual templates embed the action link and an ignore notice", () => {
    for (const purpose of ["signup_verification", "password_reset"] as const) {
      const message = emailMessageFor(purpose, "u@example.com", "https://x/y");
      expect(message.html).toContain("https://x/y");
      expect(message.html).toContain("ignore this email");
    }
  });

  it("action links need a configured public base URL; none configured = none fabricated", () => {
    expect(emailActionUrl({}, "/api/auth/verify-email?token=abc")).toBeNull();
    expect(emailActionUrl({ EMAIL_PUBLIC_BASE_URL: "https://registry.example/" }, "/api/auth/verify-email?token=abc")).toBe("https://registry.example/api/auth/verify-email?token=abc");
  });

  it("refuses a non-HTTPS endpoint (configuration failure, no network)", async () => {
    const provider = httpEmailProvider({ apiUrl: "http://insecure.example/emails", apiKey: "k", from: "a <b@c.com>" });
    const result = await provider.send(emailMessageFor("password_reset", "u@example.com", "https://x/y"));
    expect(result).toEqual({ accepted: false, failure: "configuration" });
    // P13: acceptance semantics — a 2xx would be `accepted`, never `delivered`
  });
});

// ---------- OTP production honesty ----------

describe("T13 OTP delivery honesty (requestOtp/verifyOtp wiring)", () => {
  const source = read("src/api/modules/authExt.ts");

  it("production without a provider keeps the honest 503; the provider path is the only other branch", () => {
    expect(source).toContain("if (!smsProvider) requireDemoOtpEnvironment(env);");
    expect(source).toContain('throw new HttpError(503, "sms_delivery_failed"');
  });

  it("a demo code can never appear in a production response", () => {
    expect(source).toContain("!isProduction && delivery === \"demo\" ? { demoCode: code } : {}");
  });

  it("verifyOtp is gated symmetrically with requestOtp", () => {
    expect(source).toContain("if (!getSmsProvider(env)) requireDemoOtpEnvironment(env);");
  });
});

// ---------- wiring locks ----------

describe("T13 wiring (routes, classifier, env, docs)", () => {
  it("routes.ts exposes the four new endpoints", () => {
    const routes = read("src/api/routes.ts");
    expect(routes).toContain('"/api/auth/recover/request"');
    expect(routes).toContain('"/api/auth/recover/confirm"');
    expect(routes).toContain('"/api/auth/change-password"');
    expect(routes).toContain('"/api/auth/sessions/revoke"');
  });

  it("authenticated endpoints require session + CSRF", () => {
    const routes = read("src/api/routes.ts");
    const changePasswordBlock = routes.slice(routes.indexOf("/api/auth/change-password"), routes.indexOf("/api/auth/change-password") + 400);
    expect(changePasswordBlock).toContain("requireAuth");
    expect(changePasswordBlock).toContain("requireCsrf");
  });

  it("the classifier puts the whole recovery family in the strict auth class", () => {
    const classify = read("src/security/classify.ts");
    for (const route of ["/api/auth/recover/request", "/api/auth/recover/confirm", "/api/auth/change-password", "/api/auth/sessions/revoke"]) {
      expect(classify).toContain(route);
    }
  });

  it("worker env declares the owner-gated provider credentials", () => {
    const env = read("src/types/cloudflare-env.d.ts");
    for (const key of ["KAVENEGAR_API_KEY", "KAVENEGAR_OTP_TEMPLATE", "EMAIL_API_URL", "EMAIL_API_KEY", "EMAIL_FROM", "EMAIL_PUBLIC_BASE_URL"]) {
      expect(env).toContain(`${key}?: string`);
    }
  });

  it("migration 0029 allows password_reset and 0093 adds the atomic claim marker", () => {
    const migration = read("migrations/0029_public_auth.sql");
    expect(migration).toContain("'signup','password_reset'");
    const atomicMigration = read("migrations/0093_password_reset_atomic_claim.sql");
    expect(atomicMigration).toContain("consumed_operation_id");
  });

  it("route inventory documents the four endpoints", () => {
    const inventory = read("docs/RUNTIME_ROUTE_BUDGET_INVENTORY.md");
    for (const route of ["/api/auth/recover/request", "/api/auth/recover/confirm", "/api/auth/change-password", "/api/auth/sessions/revoke"]) {
      expect(inventory).toContain(route);
    }
  });

  it("API.md documents the recovery workflow", () => {
    const api = read("docs/API.md");
    expect(api).toContain("/api/auth/recover/request");
    expect(api).toContain("/api/auth/recover/confirm");
  });
});

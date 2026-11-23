import { describe, expect, it } from "vitest";
import { classifyApiRateLimit } from "../../src/security/classify";
import { accountLimiterKey, enforceAccountLoginLimit, enforceRateLimit } from "../../src/security/rateLimit";
import { error } from "../../src/api/http";
import { HttpError } from "../../src/api/http";

interface FakeLimiterCall { key: string }

/** Scripted D1 for the R91 enforcement layer: counts per key, always admits. */
function counterDb(counts = new Map<string, number>()) {
  return {
    prepare: (sql: string) => ({
      bind: (key: string) => ({
        first: async () => {
          if (!sql.includes("rate_limit_counters")) return null;
          const next = (counts.get(key) ?? 0) + 1;
          counts.set(key, next);
          return { count: next };
        },
      }),
    }),
    __counts: counts,
  };
}

function fakeEnv(calls: FakeLimiterCall[], allow: boolean) {
  const makeLimiter = () => ({
    limit: async (options: { key: string }) => {
      calls.push({ key: options.key });
      return { success: allow };
    },
  });
  return {
    APP_ENV: "test",
    DB: counterDb(),
    PUBLIC_RATE_LIMITER: makeLimiter(),
    AUTH_RATE_LIMITER: makeLimiter(),
    EXPENSIVE_RATE_LIMITER: makeLimiter(),
    WRITE_RATE_LIMITER: makeLimiter(),
    ACCOUNT_RATE_LIMITER: makeLimiter(),
  };
}

describe("D08 rate-limit classification precedence", () => {
  it("classifies login as auth, expensive routes as expensive, other mutations as write, GETs as public", () => {
    expect(classifyApiRateLimit("/api/auth/login", "POST")).toBe("auth");
    expect(classifyApiRateLimit("/api/breeding/optimizer", "POST")).toBe("expensive");
    expect(classifyApiRateLimit("/api/breeding/pairing-analysis", "GET")).toBe("expensive");
    expect(classifyApiRateLimit("/api/relationship", "GET")).toBe("expensive");
    expect(classifyApiRateLimit("/api/horses/12/pedigree", "GET")).toBe("expensive");
    expect(classifyApiRateLimit("/api/claims", "POST")).toBe("write");
    expect(classifyApiRateLimit("/api/change-requests", "POST")).toBe("write");
    expect(classifyApiRateLimit("/api/horses/12", "DELETE")).toBe("write");
    expect(classifyApiRateLimit("/api/admin/maintenance/reindex", "POST")).toBe("write");
    expect(classifyApiRateLimit("/api/auth/logout", "POST")).toBe("write");
    expect(classifyApiRateLimit("/api/horses", "GET")).toBe("public");
    expect(classifyApiRateLimit("/api/registry/export", "GET")).toBe("public");
  });

  it("routes state-changing requests through the dedicated write limiter namespace, not the public budget", async () => {
    const calls: FakeLimiterCall[] = [];
    const request = new Request("https://example.test/api/claims", { method: "POST", headers: { "cf-connecting-ip": "203.0.113.9" } });
    await enforceRateLimit(request, fakeEnv(calls, true) as never, "write");
    expect(calls).toHaveLength(1);
    expect(calls[0].key).toBe("write:203.0.113.9");
  });

  it("keeps public read buckets separate from the write bucket", async () => {
    const calls: FakeLimiterCall[] = [];
    const get = new Request("https://example.test/api/horses", { headers: { "cf-connecting-ip": "203.0.113.9" } });
    await enforceRateLimit(get, fakeEnv(calls, true) as never, "public");
    expect(calls[0].key).not.toContain("write");
  });

  it("throws a controlled 429 when the write limiter rejects", async () => {
    const request = new Request("https://example.test/api/claims", { method: "POST", headers: { "cf-connecting-ip": "203.0.113.9" } });
    await expect(enforceRateLimit(request, fakeEnv([], false) as never, "write")).rejects.toMatchObject({ status: 429, code: "rate_limited" });
  });
});

describe("D09 Retry-After policy", () => {
  it("attaches Retry-After: 60 to 429 error envelopes centrally", () => {
    const response = error(429, "rate_limited", "Too many requests. Try again shortly.");
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
  });

  it("does not attach Retry-After to non-429 error envelopes", () => {
    const response = error(400, "invalid_claim", "Claim data failed validation");
    expect(response.headers.get("retry-after")).toBeNull();
  });
});

describe("D10 per-account login limiter", () => {
  it("hashes the normalized email into the bucket key; raw addresses never appear", async () => {
    const keyA = await accountLimiterKey("  Rider@Example.COM ");
    const keyB = await accountLimiterKey("rider@example.com");
    expect(keyA).toBe(keyB); // normalization (trim + case-fold) collapses to one bucket
    expect(keyA).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex
    expect(keyA).not.toContain("rider");
    expect(keyA).not.toContain("@");
  });

  it("limits 5/min/account via the ACCOUNT_RATE_LIMITER binding and throws the generic 429", async () => {
    const calls: FakeLimiterCall[] = [];
    const env = fakeEnv(calls, false) as never;
    const request = new Request("https://example.test/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "198.51.100.7" },
      body: JSON.stringify({ email: "Rider@Example.com", password: "correct-horse-battery" }),
    });
    await expect(enforceAccountLoginLimit(request, env)).rejects.toMatchObject({ status: 429, code: "rate_limited" });
    expect(calls).toHaveLength(1);
    expect(calls[0].key.startsWith("login-account:")).toBe(true);
    expect(calls[0].key).not.toContain("@");
  });

  it("allows the attempt when the account limiter is under the ceiling", async () => {
    const env = fakeEnv([], true) as never;
    const request = new Request("https://example.test/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "rider@example.com", password: "correct-horse-battery" }),
    });
    await expect(enforceAccountLoginLimit(request, env)).resolves.toBeUndefined();
  });

  it("skips account limiting for malformed bodies (schema rejects them later with the generic 400)", async () => {
    const calls: FakeLimiterCall[] = [];
    const env = fakeEnv(calls, true) as never;
    const badBody = new Request("https://example.test/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: "not-json" });
    await expect(enforceAccountLoginLimit(badBody, env)).resolves.toBeUndefined();
    const missingEmail = new Request("https://example.test/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "x".repeat(12) }) });
    await expect(enforceAccountLoginLimit(missingEmail, env)).resolves.toBeUndefined();
    expect(calls).toHaveLength(0);
  });
});

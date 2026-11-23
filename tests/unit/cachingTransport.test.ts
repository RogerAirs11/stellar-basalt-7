import { describe, expect, it, vi } from "vitest";
import { createCachingTransport, createCachedFetchTransport, isClientCacheableGetUrl } from "../../src/frontend-kit/cachingTransport";
import type { PlatformTransport } from "../../src/frontend-kit/platformClient";

/** Deterministic fake base transport: counts calls, returns canned payloads,
 * and can be told to fail a specific call. */
function makeBase(options: { failOnCall?: number } = {}) {
  const state = { calls: 0, failures: 0 };
  const base = (async (url: string) => {
    state.calls += 1;
    if (options.failOnCall === state.calls) {
      state.failures += 1;
      throw new Error("network down");
    }
    return { url, calls: state.calls };
  }) as PlatformTransport;
  return { base, state };
}

describe("isClientCacheableGetUrl", () => {
  it("allows only explicit public newsroom routes, with public query parameters", () => {
    expect(isClientCacheableGetUrl("/api/content/posts?limit=50")).toBe(true);
    expect(isClientCacheableGetUrl("/api/content/posts/a-published-article")).toBe(true);
    for (const url of ["/api/horses?limit=50", "/api/horses/12", "/api/horses/12/pedigree?depth=4",
      "/api/analytics/registry", "/api/platform/meta", "/api/search/meta", "/api/care/clinical?horse_id=12",
      "/api/registry/metadata", "/api/change-requests/x/evidence", "/api/new-private-capability",
      "/api/content/posts?preview=1", "/api/content/posts/x/../../auth/me", "/api/content/posts/%2fprivate"]) {
      expect(isClientCacheableGetUrl(url), url).toBe(false);
    }
  });

  it("never caches session, staff, AI or viewer-scoped surfaces", () => {
    expect(isClientCacheableGetUrl("/api/auth/me")).toBe(false);
    expect(isClientCacheableGetUrl("/api/admin/horses")).toBe(false);
    expect(isClientCacheableGetUrl("/api/ai/conversations")).toBe(false);
    expect(isClientCacheableGetUrl("/api/market/listings")).toBe(false);
    expect(isClientCacheableGetUrl("/api/workspaces/mine")).toBe(false);
    expect(isClientCacheableGetUrl("/api/directory/claims/mine")).toBe(false);
    expect(isClientCacheableGetUrl("/api/people/4")).toBe(false);
    expect(isClientCacheableGetUrl("/not-api/thing")).toBe(false);
  });
});

describe("createCachingTransport", () => {
  it("serves the fresh window without network", async () => {
    const { base, state } = makeBase();
    const { transport } = createCachingTransport(base, { freshMs: 60_000, staleMs: 120_000 });
    const first = await transport<{ url: string }>("/api/content/posts");
    const second = await transport<{ url: string }>("/api/content/posts");
    expect(state.calls).toBe(1);
    expect(second).toBe(first);
  });

  it("revalidates quietly after the fresh window (stale-while-revalidate)", async () => {
    vi.useFakeTimers();
    try {
      const { base, state } = makeBase();
      const { transport } = createCachingTransport(base, { freshMs: 1_000, staleMs: 60_000 });
      await transport("/api/content/posts");
      expect(state.calls).toBe(1);
      vi.advanceTimersByTime(5_000);
      // Stale read returns instantly with the cached value...
      const stale = await transport<{ url: string; calls: number }>("/api/content/posts");
      expect(stale.calls).toBe(1);
      // ...while the background revalidation completes.
      await vi.advanceTimersByTimeAsync(10);
      await Promise.resolve();
      await Promise.resolve();
      expect(state.calls).toBe(2);
      // A later read is fresh again.
      const fresh = await transport<{ calls: number }>("/api/content/posts");
      expect(fresh.calls).toBe(2);
      expect(state.calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("goes back to the network past the stale window", async () => {
    vi.useFakeTimers();
    try {
      const { base, state } = makeBase();
      const { transport } = createCachingTransport(base, { freshMs: 1_000, staleMs: 2_000 });
      await transport("/api/content/posts");
      vi.advanceTimersByTime(10_000);
      const refetched = await transport<{ calls: number }>("/api/content/posts");
      expect(refetched.calls).toBe(2);
      expect(state.calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("deduplicates concurrent identical GETs", async () => {
    const { base, state } = makeBase();
    const { transport } = createCachingTransport(base);
    const [a, b] = await Promise.all([
      transport<{ url: string }>("/api/content/posts?category=registry"),
      transport<{ url: string }>("/api/content/posts?category=registry"),
    ]);
    expect(state.calls).toBe(1);
    expect(a).toBe(b);
  });

  it("clears every cached GET after a successful mutation", async () => {
    const { base, state } = makeBase();
    const { transport } = createCachingTransport(base);
    await transport("/api/content/posts");
    expect(state.calls).toBe(1);
    await transport("/api/horses/1", { method: "POST", body: "{}" });
    await transport("/api/content/posts");
    expect(state.calls).toBe(3);
  });

  it("invalidates even when a mutation acknowledgement fails", async () => {
    const { base, state } = makeBase({ failOnCall: 2 });
    const { transport } = createCachingTransport(base);
    const first = await transport("/api/content/posts");
    expect(state.calls).toBe(1);
    await expect(transport("/api/content/comments", { method: "POST", body: "{}" })).rejects.toThrow("network down");
    const second = await transport<{ calls: number }>("/api/content/posts");
    expect(second).not.toBe(first);
    // A failed acknowledgement does not prove the server did not commit.
    expect(state.calls).toBe(3);
  });

  it("does not cache errors", async () => {
    const { base, state } = makeBase({ failOnCall: 1 });
    const { transport } = createCachingTransport(base);
    await expect(transport("/api/content/posts")).rejects.toThrow("network down");
    const recovered = await transport<{ calls: number }>("/api/content/posts");
    expect(recovered.calls).toBe(2);
  });

  it("bypasses the cache for non-cacheable URLs", async () => {
    const { base, state } = makeBase();
    const { transport } = createCachingTransport(base);
    await transport("/api/auth/me");
    await transport("/api/auth/me");
    expect(state.calls).toBe(2);
  });

  it("prefetch warms the cache and never throws", async () => {
    const { base, state } = makeBase();
    const { transport, prefetch } = createCachingTransport(base);
    prefetch("/api/content/posts?limit=5");
    await Promise.resolve();
    await Promise.resolve();
    const value = await transport<{ calls: number }>("/api/content/posts?limit=5");
    expect(value.calls).toBe(1);
    expect(state.calls).toBe(1);
  });

  it("clear() invalidates everything (session change)", async () => {
    const { base, state } = makeBase();
    const { transport, clear } = createCachingTransport(base);
    await transport("/api/content/posts");
    clear();
    await transport("/api/content/posts");
    expect(state.calls).toBe(2);
  });
});

describe("R147 withdrawal-aware browser transport", () => {
  it.each([
    "/api/horses/12", "/api/horses/12/genetics", "/api/analytics/registry",
    "/api/directory/persons/4", "/api/competitions/1", "/api/care/clinical?horse_id=12",
    "/api/registry/metadata", "/api/change-requests/private/evidence",
  ])("refetches %s and never falls back to an earlier disclosed result", async url => {
    let reads = 0;
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.cache).toBe("no-store");
      reads++;
      return reads === 1
        ? Response.json({ disclosed: "only before withdrawal" }, { headers: { "cache-control": "public, max-age=300" } })
        : Response.json({ error: "withdrawn" }, { status: 404 });
    }) as unknown as typeof fetch;
    const cached = createCachedFetchTransport(fetcher);
    cached.prefetch(url);
    expect(reads).toBe(0);
    expect(await cached.transport(url)).toEqual({ disclosed: "only before withdrawal" });
    await expect(cached.transport(url)).rejects.toMatchObject({ status: 404 });
    expect(reads).toBe(2);
  });

  it.each(["no-store", "private, max-age=300", "no-cache, max-age=300", "public, max-age=0", ""])(
    "honors restrictive or absent HTTP cache policy: %s", async policy => {
      let calls = 0;
      const fetcher = vi.fn(async () => Response.json({ calls: ++calls }, { headers: { "cache-control": policy } })) as unknown as typeof fetch;
      const { transport } = createCachedFetchTransport(fetcher);
      expect(await transport("/api/content/posts")).toEqual({ calls: 1 });
      expect(await transport("/api/content/posts")).toEqual({ calls: 2 });
    },
  );

  it("never extends server max-age after an aged public response", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const fetcher = vi.fn(async () => Response.json({ calls: ++calls }, {
        headers: { "cache-control": "public, max-age=10, must-revalidate", age: "9" },
      })) as unknown as typeof fetch;
      const { transport } = createCachedFetchTransport(fetcher);
      await transport("/api/content/posts");
      expect(await transport("/api/content/posts")).toEqual({ calls: 1 });
      vi.advanceTimersByTime(1001);
      expect(await transport("/api/content/posts")).toEqual({ calls: 2 });
    } finally { vi.useRealTimers(); }
  });

  it("does not reuse responses that vary by session", async () => {
    let calls = 0;
    const fetcher = vi.fn(async () => Response.json({ calls: ++calls }, {
      headers: { "cache-control": "public, max-age=300", vary: "Accept-Encoding, Cookie" },
    })) as unknown as typeof fetch;
    const { transport } = createCachedFetchTransport(fetcher);
    await transport("/api/content/posts");
    await transport("/api/content/posts");
    expect(calls).toBe(2);
  });

  it("a pre-clear request cannot fill or be joined by the new cache generation", async () => {
    let complete!: (value: unknown) => void;
    let calls = 0;
    const base = (async () => {
      if (++calls === 1) return new Promise<unknown>(resolve => { complete = resolve; });
      return { current: true };
    }) as PlatformTransport;
    const { transport, clear } = createCachingTransport(base);
    const previous = transport("/api/content/posts");
    clear();
    expect(await transport("/api/content/posts")).toEqual({ current: true });
    complete({ old: true });
    await previous;
    expect(await transport("/api/content/posts")).toEqual({ current: true });
    expect(calls).toBe(2);
  });

  it("preserves HEAD/custom headers and refuses an aborted cached read", async () => {
    const calls: RequestInit[] = [];
    const base = (async (_url: string, init?: RequestInit) => { calls.push(init ?? {}); return { call: calls.length }; }) as PlatformTransport;
    const { transport } = createCachingTransport(base);
    await transport("/api/content/posts", { method: "HEAD" });
    await transport("/api/content/posts", { headers: { authorization: "test-only" } });
    await transport("/api/content/posts");
    expect(calls).toHaveLength(3);
    expect(calls[0]).toMatchObject({ method: "HEAD", cache: "no-store" });
    expect(calls[1]).toMatchObject({ headers: { authorization: "test-only" }, cache: "no-store" });
    const controller = new AbortController(); controller.abort();
    await expect(transport("/api/content/posts", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  });
});

import { platformResponseError, throwIfRequestAborted } from "./transportErrors";
import { PlatformClientError } from "./errors";
import type { PlatformTransport } from "./platformClient";

/**
 * R132 PERFORMANCE: stale-while-revalidate + in-flight deduplication for the
 * host platform transport.
 *
 * WHY: every SPA navigation re-fetched its data from scratch, and the
 * measured uncached API latency floor is one full Worker→Hyperdrive→
 * Supabase round trip per request (~0.5-1.5s). Moving between tabs the user
 * had just visited paid the whole round trip again. This layer keeps a
 * short-lived in-memory copy of successful GET results:
 *
 *  - fresh window (default 30s): served instantly, no network at all;
 *  - stale window (default 5min): served INSTANTLY, then revalidated in the
 *    background so the next visit is fresh again;
 *  - beyond that: normal fetch, and in-flight identical GETs share one
 *    network request (dedup).
 *
 * CORRECTNESS RULES:
 *  - Only same-origin /api/ GETs without a request body are considered.
 *  - Only explicitly approved public newsroom URLs can enter this cache.
 *    Revocable registry/private records always use a fresh network request.
 *  - Mutations clear before AND after the request, including an ambiguous
 *    network failure after commit. Earlier requests cannot refill the cache.
 *  - Cache entries live only in memory for the page session — nothing is
 *    persisted across tabs, devices or reloads.
 *  - Errors are never cached.
 */

export interface CachingTransportOptions {
  /** Serve purely from cache with no background revalidation. */
  freshMs?: number;
  /** Serve from cache while quietly revalidating. Beyond it: network. */
  staleMs?: number;
  /** Hard cap on cached entries (recency-evicted). */
  maxEntries?: number;
  /** Transport adapter's response policy, rechecked before every read/write.
   * A parsed-only custom transport must apply its own HTTP response policy. */
  canCacheUrl?: (url: string) => boolean;
  /** Upper lifetime from HTTP max-age minus Age; never extend HTTP freshness. */
  maxAgeMsForUrl?: (url: string) => number;
}

const DEFAULT_FRESH_MS = 30_000;
const DEFAULT_STALE_MS = 300_000;
const DEFAULT_MAX_ENTRIES = 240;

export function isClientCacheableGetUrl(url: string): boolean {
  // An allowlist keeps newly introduced private endpoints uncached by default.
  // Do not normalize encoded/traversal paths into a broader cache permission.
  if (!/^\/api\/content\/posts(?:\/[A-Za-z0-9_-]+)?\/?(?:\?[^#]*)?$/.test(url)) return false;
  const parsed = new URL(url, "https://registry.invalid");
  const publicQueryKeys = new Set(["limit", "offset", "lang", "locale", "category", "q"]);
  return [...parsed.searchParams.keys()].every(key => publicQueryKeys.has(key));
}

interface CacheEntry {
  at: number;
  value: unknown;
}

export interface CachingTransport {
  transport: PlatformTransport;
  /** Warm the cache for a URL the user is likely to visit next (hover/idle
   * prefetch). Failures are swallowed — prefetch must never surface errors. */
  prefetch: (url: string) => void;
  /** Drop every cached GET (used after mutations and session changes). */
  clear: () => void;
}

export function createCachingTransport(
  base: PlatformTransport,
  options: CachingTransportOptions = {},
): CachingTransport {
  const freshMs = Math.max(0, options.freshMs ?? DEFAULT_FRESH_MS);
  const staleMs = Math.max(freshMs, options.staleMs ?? DEFAULT_STALE_MS);
  const maxEntries = Math.max(16, options.maxEntries ?? DEFAULT_MAX_ENTRIES);

  const cache = new Map<string, CacheEntry>();
  const inflight = new Map<string, Promise<unknown>>();
  const refreshing = new Set<string>();
  let generation = 0;
  const mayCache = (url: string) => isClientCacheableGetUrl(url) && (options.canCacheUrl?.(url) ?? true);
  const lifetime = (url: string) => Math.max(0, options.maxAgeMsForUrl?.(url) ?? staleMs);

  const touch = (key: string, entry: CacheEntry, startedGeneration: number) => {
    if (generation !== startedGeneration || !mayCache(key)) return;
    cache.delete(key);
    cache.set(key, entry);
    if (cache.size > maxEntries) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
  };

  const clear = () => {
    generation += 1;
    cache.clear();
    inflight.clear();
    refreshing.clear();
  };

  const runFetch = (url: string): Promise<unknown> => base<unknown>(url, { credentials: "same-origin" });

  /** Network fetch with dedup for signal-free callers. */
  const fetchDeduped = (url: string): Promise<unknown> => {
    const existing = inflight.get(url);
    if (existing) return existing as Promise<unknown>;
    const pending = runFetch(url)
      .catch((cause: unknown) => {
        // Signal-bearing callers joined an existing in-flight request only
        // when they passed no signal of their own, so an abort never
        // propagates between consumers here.
        throw cause;
      })
      .finally(() => {
        if (inflight.get(url) === pending) inflight.delete(url);
      });
    inflight.set(url, pending);
    return pending;
  };

  const transport: PlatformTransport = async <T,>(url: string, init?: RequestInit): Promise<T> => {
    throwIfRequestAborted(init?.signal);
    const method = (init?.method ?? "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      clear();
      try { return await base<T>(url, init); }
      finally { clear(); }
    }
    if (method !== "GET" || init?.body != null || init?.headers != null ||
        (init?.credentials != null && init.credentials !== "same-origin") ||
        (init?.cache != null && init.cache !== "default") || !mayCache(url)) {
      // Also bypass pre-release browser HTTP cache entries for records whose
      // old responses had a positive max-age. Server no-store alone cannot do it.
      return base<T>(url, { ...init, cache: "no-store" });
    }

    const startedGeneration = generation;
    const hasOwnSignal = Boolean(init?.signal);
    const cached = cache.get(url);
    const now = Date.now();

    if (cached) {
      const age = now - cached.at;
      if (age < Math.min(freshMs, lifetime(url))) {
        return cached.value as T;
      }
      if (age < Math.min(staleMs, lifetime(url))) {
        // Serve the stale copy instantly; refresh quietly for next time.
        if (!refreshing.has(url) && !inflight.has(url)) {
          refreshing.add(url);
          void runFetch(url)
            .then((value) => {
              touch(url, { at: Date.now(), value }, startedGeneration);
            })
            .catch(() => {
              /* keep serving the stale value */
            })
            .finally(() => {
              if (generation === startedGeneration) refreshing.delete(url);
            });
        }
        return cached.value as T;
      }
    }

    const promise = hasOwnSignal
      ? base<T>(url, init)
      : (fetchDeduped(url) as Promise<T>);
    if (!hasOwnSignal) {
      // fetchDeduped resolves the shared payload; cache on success.
      return promise.then((value) => {
        touch(url, { at: Date.now(), value }, startedGeneration);
        return value;
      });
    }
    throwIfRequestAborted(init?.signal);
    return promise.then((value) => {
      throwIfRequestAborted(init?.signal);
      touch(url, { at: Date.now(), value }, startedGeneration);
      return value;
    });
  };

  const prefetch = (url: string) => {
    if (!mayCache(url)) return;
    const startedGeneration = generation;
    const cached = cache.get(url);
    const now = Date.now();
    if (cached && now - cached.at < Math.min(staleMs, lifetime(url))) return;
    if (inflight.has(url) || refreshing.has(url)) return;
    refreshing.add(url);
    void runFetch(url)
      .then((value) => {
        touch(url, { at: Date.now(), value }, startedGeneration);
      })
      .catch(() => {
        /* prefetch is best-effort */
      })
      .finally(() => {
        if (generation === startedGeneration) refreshing.delete(url);
      });
  };

  return { transport, prefetch, clear };
}

/** Convenience: like createFetchPlatformTransport but with the R132 cache. */
export function createCachedFetchTransport(fetcher: typeof fetch = fetch): CachingTransport {
  // A restrictive response permanently opts this URL out for this page
  // session, including late responses from an earlier cache generation.
  const denied = new Set<string>();
  const lifetimes = new Map<string, number>();
  const base = fetchTransport(fetcher, (url, response) => {
    const policy = response.headers.get("cache-control") ?? "";
    const maxAge = /(?:^|,)\s*max-age\s*=\s*(\d+)/i.exec(policy);
    const age = Number(response.headers.get("age") ?? 0);
    const remainingMs = Math.max(0, (Number(maxAge?.[1] ?? 0) - (Number.isFinite(age) ? age : Infinity)) * 1000);
    lifetimes.set(url, remainingMs);
    if (!maxAge || Number(maxAge[1]) <= 0 ||
        /(?:^|,)\s*(?:no-store|no-cache|private)(?:\s|,|=|$)/i.test(policy) ||
        /(?:^|,)\s*(?:\*|cookie|authorization)\s*(?:,|$)/i.test(response.headers.get("vary") ?? "")) denied.add(url);
  });
  return createCachingTransport(base, {
    canCacheUrl: url => !denied.has(url),
    maxAgeMsForUrl: url => lifetimes.get(url) ?? 0,
  });
}

function fetchTransport(fetcher: typeof fetch, observe: (url: string, response: Response) => void): PlatformTransport {
  return async <T>(url: string, init?: RequestInit): Promise<T> => {
    throwIfRequestAborted(init?.signal);
    const response = await fetcher(url, { credentials: "same-origin", ...init });
    observe(url, response);
    let data: unknown;
    try {
      data = await response.json();
    } catch (cause) {
      throwIfRequestAborted(init?.signal, cause);
      if (!response.ok) throw platformResponseError(response, undefined, "invalid_error_response");
      throw new PlatformClientError(response.status, "invalid_json_response", "Platform returned an invalid JSON response");
    }
    throwIfRequestAborted(init?.signal);
    if (!response.ok) throw platformResponseError(response, data);
    return data as T;
  };
}

/** R132 (moved to frontend-kit in R133 so host UI passes the raw-/api/ audit):
 * route -> data URLs the destination page requests on mount. Used by the
 * hover/idle prefetch layer; the URLs mirror the pages' initial fetches
 * exactly so a prefetched entry is the one the navigation consumes. */
export function dataUrlsForRoute(pathname: string, locale: string): string[] {
  const horseMatch = /^\/horse\/(\d+)$/.exec(pathname);
  if (horseMatch) {
    const id = horseMatch[1]!;
    return [`/api/horses/${id}`, `/api/horses/${id}/pedigree?depth=4`];
  }
  const personMatch = /^\/person\/(\d+)$/.exec(pathname);
  if (personMatch) return [`/api/people/${personMatch[1]}`];
  const directoryPersonMatch = /^\/directory\/(\d+)$/.exec(pathname);
  if (directoryPersonMatch) return [`/api/directory/persons/${directoryPersonMatch[1]}`];
  if (pathname.startsWith("/newsroom")) return ["/api/content/posts?limit=50"];
  if (pathname.startsWith("/stats")) return ["/api/analytics/registry", "/api/quality/summary", "/api/horses?sort=id&dir=desc&limit=8"];
  if (pathname.startsWith("/competitions")) return ["/api/competitions?limit=8&offset=0"];
  if (pathname.startsWith("/directory")) return ["/api/directory/persons"];
  if (pathname.startsWith("/browse")) return [`/api/horses?sort=name&dir=asc&lang=${locale}&limit=50&offset=0`];
  return [];
}

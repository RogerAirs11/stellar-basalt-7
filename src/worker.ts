import { safeErrorCategory } from "./security/logging";
import { withSecurityHeaders } from "./security/responseHeaders";
import { routeApi } from "./api/routes";
import { error, HttpError } from "./api/http";
import { enforceAccountLoginLimit, enforceRateLimit } from "./security/rateLimit";
import { classifyApiRateLimit } from "./security/classify";
import { releaseDatabaseForRequest, resolveDatabaseForRequest, resolveReadFallbackAfterFailure } from "./db/provider";
import { scheduledNotificationDrain } from "./notifications/worker";
import { enqueueDueTaskReminders } from "./workspaces/reminders";
import { serviceRetentionSweep } from "./services/privacy";

// Durable Object registered by wrangler.jsonc (durable_objects.migrations).
// Must be exported from the entrypoint module; see src/ai/providers/gemini/relay.ts
// for why the Gemini relay exists (deterministic US-East egress).
export { GeminiRelay } from "./ai/providers/gemini/relay";

export default {
  async fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/")) {
        // Only the explicit editorial/static allowlist below can read the
        // shared cache, and only for anonymous GETs. Registry records, facets,
        // consented content and private projections bypass existing copies
        // so a visibility withdrawal takes effect on the next request.
        // Eligible paths can use a bounded stale copy during revalidation.
        const cacheTtl = edgeCacheTtl(url.pathname);
        const cache = cacheTtl !== null && request.method === "GET"
          && !request.headers.has("cookie") && !request.headers.has("authorization")
          ? cachesDefault() : null;
        if (cache) {
          const hit = await cache.match(request);
          if (hit) {
            // turn-33 (merge addendum): the stored copy is served to the
            // BROWSER as `private, max-age=<ttl>`. Observed live: the
            // zone-level cache intercepts any `public` API response and
            // rewrites it to the zone's 4-hour Browser Cache TTL (curl-
            // verified max-age=120 -> 14400), so visitors kept stale API
            // payloads for hours. `private` keeps the browser benefit
            // (repeat views within the TTL are instant) while the zone never
            // stores or rewrites API data; the zone Cache Rule created in
            // turn-33 bypasses /api/* anyway (belt + suspenders).
            const served = new Response(hit.body, hit);
            served.headers.set("cache-control", `private, max-age=${cacheTtl}`);
            return served;
          }
          const stale = staleEligible(url.pathname) ? await cache.match(edgeStaleKey(request)) : null;
          if (stale) {
            if (ctx) ctx.waitUntil(revalidateEdgeCache(request, env, cache, cacheTtl!));
            const servedStale = restampStaleResponse(stale, cacheTtl!);
            servedStale.headers.set("cache-control", `private, max-age=${cacheTtl}`);
            return servedStale;
          }
        }
        const kind = classifyApiRateLimit(url.pathname, request.method);
        if (kind === "auth") {
          await enforceRateLimit(request, env, "auth");
          await enforceAccountLoginLimit(request, env);
        } else {
          await enforceRateLimit(request, env, kind);
        }
        let databaseEnv: Env | undefined;
        let fallbackEnv: Env | undefined;
        try {
          databaseEnv = await resolveDatabaseForRequest(request, env);
          let response: Response;
          let responseEnv = databaseEnv;
          try {
            response = await routeApi(request, databaseEnv);
          } catch (cause) {
            // Only non-HTTP failures on canonical GET/HEAD reads are eligible for
            // a same-request retry. Hybrid AI turns are never replayed because AI
            // state/provider side effects may already have occurred.
            if (cause instanceof HttpError) throw cause;
            const resolvedFallback = await resolveReadFallbackAfterFailure(request, env, databaseEnv);
            if (!resolvedFallback) throw cause;
            fallbackEnv = resolvedFallback;
            responseEnv = fallbackEnv;
            console.warn("Retrying public read against eligible database fallback", {
              primary: databaseEnv.DB_RUNTIME?.active,
              fallback: fallbackEnv.DB_RUNTIME?.active,
              errorType: safeErrorCategory(cause),
            });
            response = await routeApi(request, fallbackEnv);
          }
          const secured = withSecurityHeaders(response, request, responseEnv);
          if (cache && secured.status === 200 && secured.body) {
            // clone() tees the stream: the caller keeps its reader, the cache
            // gets its own branch. Re-wrapping secured.body directly would
            // disturb the single-use stream and break the client response.
            // R142-B02: storeEdgeCopies is awaited inside the waitUntil — the
            // writes are now guaranteed to run instead of being dropped.
            ctx?.waitUntil(storeEdgeCopies(request, cache, secured.clone(), cacheTtl!));
          }
          // Do not close request-scoped Postgres/Supabase resources merely because
          // an SSE Response object was created. The AI may execute registry tools
          // later while that body is still streaming. Cleanup follows body EOF,
          // error, or cancellation instead.
          return responseWithDatabaseLifetime(secured, [fallbackEnv, databaseEnv]);
        } catch (cause) {
          if (fallbackEnv?.DB !== databaseEnv?.DB) await releaseDatabaseForRequest(fallbackEnv);
          await releaseDatabaseForRequest(databaseEnv);
          throw cause;
        }
      }
      const response = await env.ASSETS.fetch(request);
      return withSecurityHeaders(response, request, env);
    } catch (cause) {
      if (cause instanceof HttpError) return withSecurityHeaders(error(cause.status, cause.code, cause.message, cause.details), request, env);
      // R146 ops: the category alone made production scan debugging blind —
      // include the error message (DB deadline errors name the statement head
      // and attempt count; workers tail is staff-only infrastructure logging).
      console.error("Unhandled request error", { errorType: safeErrorCategory(cause), errorMessage: cause instanceof Error ? cause.message.slice(0, 300) : String(cause).slice(0, 300) });
      return withSecurityHeaders(error(500, "internal_error", "Unexpected server error"), request, env);
    }
  },
  /**
   * R95-N09: the durable notification worker. A cron trigger (wrangler.jsonc
   * triggers.crons) drains the outbox over the canonical WRITABLE database
   * with bounded batches, renewable leases and honest provider routing. The
   * 5-minute cadence is the slowest bounded batch; it is not a delivery SLA.
   * R95-N12: the same scheduled run executes the service-request retention
   * sweep. Terminal leads older than the configured 365-day threshold are
   * minimized in bounded batches. Original note bytes are hashed when still
   * available; missing historic evidence is explicitly unavailable, not
   * reconstructed. Consent is zeroed and queued optional notices suppressed.
   * This product policy is not a legal retention/hold determination.
   */
  async scheduled(event: ScheduledController, env: Env, ctx?: ExecutionContext): Promise<void> {
    // QUOTA GUARD: this handler runs every 5 minutes, so anything it touches
    // costs 288x a day. Retention sweep + reminder enqueue + notification drain
    // are idempotent, so they are complete once an hour instead of every run.
    // At */5 that is 1/12th of the database work for the same end result.
    const minute = Number(new Date(event.scheduledTime).getUTCMinutes());
    const hourly = minute < 5;
    // Warm only paths on the current editorial/static allowlist. Registry
    // reads intentionally remain uncached and would add unnecessary DB work.
    if (env.CACHE_WARM_DISABLED !== "1") {
      const origin = env.SITE_ORIGIN ?? "https://iraho.ir";
      const warmUrls = [
        "/api/content/posts?limit=50",
        "/api/ai/status",
        "/api/search/meta",
      ];
      ctx?.waitUntil((async () => {
        for (const path of warmUrls) {
          try {
            const warmed = await fetch(new Request(origin + path, { method: "GET", redirect: "manual" }), {
              cf: { cacheTtl: 0, cacheEverything: false },
            });
            // Drain the body so the runtime does not keep the stream open.
            await warmed.arrayBuffer().catch(() => undefined);
          } catch { /* warming is best-effort; the request path self-heals */ }
        }
      })().catch(() => undefined));
    }
    if (!hourly) return;
    // Lease writes are canonical writes: resolve the write primary the same
    // way a mutation request does (a synthetic canonical-write request), so
    // the worker never drains a stale replica.
    const synthetic = new Request("https://registry.internal/api/notifications/drain", { method: "POST" });
    const resolved = await resolveDatabaseForRequest(synthetic, env);
    try {
      const dbEnv = resolved as unknown as { DB: D1Database };
      // Privacy minimization precedes dispatch; the send adapter independently
      // rechecks current authority for every queued service notice.
      const retention = await serviceRetentionSweep(dbEnv.DB, new Date().toISOString());
      if (retention.minimized_requests) console.log("service retention sweep", retention);
      // R96-N09: timezone-aware task reminders enqueue BEFORE the drain —
      // one bounded, idempotent pass per (task, due date).
      const dueTasks = await enqueueDueTaskReminders(dbEnv.DB, new Date().toISOString());
      if (dueTasks.enqueued) console.log("workspace task reminders enqueued", dueTasks);
      const summary = await scheduledNotificationDrain(dbEnv as never);
      console.log("notification worker drain", summary);
    } finally {
      await releaseDatabaseForRequest(resolved);
    }
  },
} satisfies ExportedHandler<Env>;

/** Explicit editorial/static allowlist. All other routes bypass both fresh
 * and stale copies, including copies created by an older deployment.
 * A same-colo purge cannot establish global revocation of registry facts,
 * consented media or disclosures; those responses remain uncached until
 * revision/permission-aware caching is proven. */
function edgeCacheTtl(pathname: string): number | null {
  // Published editorial content retains its bounded editorial cache window.
  if (/^\/api\/content\/posts\/?$/.test(pathname)) return 300;
  if (/^\/api\/content\/posts\/[^/]+\/?$/.test(pathname)) return 300;
  if (/^\/api\/content\/comments\/?$/.test(pathname)) return 20;
  // Anonymous model availability contains no horse or private user data.
  if (/^\/api\/ai\/status\/?$/.test(pathname)) return 60;
  // searchMeta() returns literal syntax/field definitions, not live facets.
  if (/^\/api\/search\/meta\/?$/.test(pathname)) return 120;
  // R159 note: /api/platform/meta was evaluated for a 60s aggregate cache and
  // deliberately REJECTED — the R156 visibility contract requires its response
  // to stay no-store so a new restriction can never be bypassed by an old
  // edge copy (backend-hardening test pins this). Search speed comes from the
  // R159 parallel discovery pass inside searchHorses instead.
  return null;
}

/** R134 edge stale-while-revalidate support.
 *
 * Two colo copies per whitelisted URL:
 *  - FRESH under the request URL itself, max-age = edgeCacheTtl(pathname);
 *  - STALE under a marker query key, max-age = ttl + EDGE_STALE_EXTRA_SECONDS.
 *
 * A fresh miss falls back to the stale copy: the visitor gets the expired
 * payload in one colo round trip while `revalidateEdgeCache` rebuilds a new
 * response in the background and replaces both copies. Revalidation is
 * strictly a read pipeline (no rate limiting — it can only be triggered by a
 * prior successful anonymous response, never directly attacked) and failures
 * keep the stale copy in place, so the next request simply retries.
 */
const EDGE_STALE_EXTRA_SECONDS = 1800;

/** Stale storage and retrieval use the same current allowlist as fresh reads;
 * a removed path must never fall back to a copy from an older deployment. */
function staleEligible(pathname: string): boolean {
  return edgeCacheTtl(pathname) !== null;
}

function edgeStaleKey(request: Request): Request {
  const url = new URL(request.url);
  url.searchParams.set("__edge_stale", "1");
  return new Request(url.toString(), request);
}

async function storeEdgeCopies(request: Request, cache: Cache, secured: Response, cacheTtl: number): Promise<void> {
  const forFresh = new Response(secured.clone().body, secured);
  forFresh.headers.set("Cache-Control", `public, max-age=${cacheTtl}`);
  // R132: the stored anonymous copy must never be reused by the
  // BROWSER after the visitor signs in — Vary: Cookie splits the
  // local HTTP cache by cookie presence (the colo cache itself is
  // keyed by our fingerprint-free rule and unaffected).
  forFresh.headers.set("Vary", "Cookie");
  const forStale = new Response(secured.body, secured);
  forStale.headers.set("Cache-Control", `public, max-age=${cacheTtl + EDGE_STALE_EXTRA_SECONDS}`);
  forStale.headers.set("Vary", "Cookie");
  const staleOk = staleEligible(new URL(request.url).pathname);
  // R142-B02 (Master-AI): the writes are now an AWAITED operation returned to
  // the caller. The old signature scheduled both puts behind `ctx?.waitUntil`
  // INSIDE this function, so the revalidation path (which has no execution
  // context) performed an origin read and ZERO cache writes — refreshed data
  // never replaced the copies, and withdrawn content kept serving. The fresh
  // request path wraps this awaitable in its own ctx.waitUntil, preserving
  // the non-blocking visitor response while guaranteeing the writes run.
  await Promise.all([
    cache.put(request, forFresh).catch(() => undefined),
    ...(staleOk ? [cache.put(edgeStaleKey(request), forStale).catch(() => undefined)] : []),
  ]);
}

/** Serve the stale copy with fresh-hit browser semantics: the visitor's HTTP
 * cache may reuse it for the endpoint's normal TTL, exactly like a fresh colo
 * hit would — never for the extended stale window. */
function restampStaleResponse(stale: Response, cacheTtl: number): Response {
  const served = new Response(stale.body, stale);
  served.headers.set("Cache-Control", `public, max-age=${cacheTtl}`);
  return served;
}

async function revalidateEdgeCache(request: Request, env: Env, cache: Cache, cacheTtl: number): Promise<void> {
  try {
    let databaseEnv: Env | undefined;
    try {
      databaseEnv = await resolveDatabaseForRequest(request, env);
      const response = await routeApi(request, databaseEnv);
      const secured = withSecurityHeaders(response, request, databaseEnv);
      if (secured.status === 200 && secured.body) {
        // R142-B02: awaited — this is the call site Master AI reproduced: the
        // background refresh used to read fresh origin data and write NOTHING
        // back, because the put operations were scheduled behind an execution
        // context this path never had.
        await storeEdgeCopies(request, cache, secured.clone(), cacheTtl);
      }
      await releaseDatabaseForRequest(databaseEnv);
    } catch (cause) {
      await releaseDatabaseForRequest(databaseEnv);
      throw cause;
    }
  } catch {
    // Keep serving the stale copy; the next request retries the refresh.
  }
}

/** The Workers runtime exposes the colo cache as CacheStorage.default; the
 *  generated types only model the standard DOM surface, so the access is
 *  typed once here instead of cast at every use. Runtimes without the Cache
 *  API (unit/test environments) simply disable the edge-cache layer. */
function cachesDefault(): Cache | null {
  try {
    return (caches as unknown as { default?: Cache } | undefined)?.default ?? null;
  } catch {
    return null;
  }
}



function responseWithDatabaseLifetime(response: Response, envs: Array<Env | undefined>): Response {
  const unique = envs.filter((value, index, all): value is Env =>
    Boolean(value) && all.findIndex((candidate) => candidate?.DB === value?.DB) === index,
  );
  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    for (const resolved of unique) await releaseDatabaseForRequest(resolved);
  };

  if (!response.body) {
    void release();
    return response;
  }

  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await reader.read();
        if (done) {
          await release();
          controller.close();
          return;
        }
        if (value) controller.enqueue(value);
      } catch (cause) {
        await release();
        controller.error(cause);
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        await release();
      }
    },
  });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

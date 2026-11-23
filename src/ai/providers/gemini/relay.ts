/**
 * Gemini Durable Object relay with a best-effort Eastern North America hint.
 *
 * A location hint is not a region guarantee and does not establish eligibility
 * to use a provider. Operators must verify applicable account, regional and
 * data-use terms independently; provider availability can still fail.
 *
 * Transport shape: the provider talks to https://gemini-relay.internal/v1beta/...
 * (a synthetic origin that never leaves the Cloudflare network). The relay
 * forwards requests to https://generativelanguage.googleapis.com.
 */
import { isVertexExpressKey } from "./vertexExpress";

/** Synthetic origin understood by {@link makeGeminiRelayFetch} and {@link GeminiRelay}. */
export const GEMINI_RELAY_ORIGIN = "https://gemini-relay.internal";
/** Drop-in base replacing GEMINI_BASE_URL while the relay is active. */
export const GEMINI_RELAY_BASE = `${GEMINI_RELAY_ORIGIN}/v1beta`;

/** Trace fields we report for egress verification (operator diagnostics). */
export interface RelayEgressInfo { colo: string | null; loc: string | null; ip: string | null }

export function parseCloudflareTrace(trace: string): RelayEgressInfo {
  const fields = new Map<string, string>();
  for (const line of String(trace ?? "").split("\n")) {
    const index = line.indexOf("=");
    if (index > 0) fields.set(line.slice(0, index).trim(), line.slice(index + 1).trim());
  }
  return { colo: fields.get("colo") ?? null, loc: fields.get("loc") ?? null, ip: fields.get("ip") ?? null };
}

/** True when the deployment should activate the Durable-Object relay. */
export function geminiRelayActive(env: Pick<Env, "GEMINI_RELAY" | "GEMINI_RELAY_ENABLED">): boolean {
  return Boolean(env.GEMINI_RELAY) && env.GEMINI_RELAY_ENABLED !== "0";
}

/**
 * Build a fetch implementation that routes relay-origin requests through the
 * Durable Object and passes every other URL (Vertex, DeepSeek, …) through
 * untouched. Non-relay URLs always use the global fetch.
 */
export function makeGeminiRelayFetch(ns: DurableObjectNamespace): typeof fetch {
  // Cloudflare considers this best-effort hint only at initial placement.
  // It does not guarantee a country, future placement, or provider eligibility.
  const stub = ns.get(ns.idFromName("primary"), { locationHint: "enam" });
  const relayFetch: typeof fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith(GEMINI_RELAY_ORIGIN)) return stub.fetch(input as RequestInfo, init);
    return fetch(input as RequestInfo, init);
  };
  return relayFetch;
}

/**
 * The Durable Object itself. Deployment notes:
 *   - declared in wrangler.jsonc (durable_objects binding GEMINI_RELAY, SQLite
 *     class so it is available on the Workers free plan — no storage is used),
 *   - exported from src/worker.ts so wrangler can register the class,
 *   - the singleton name "primary" shares one object across these requests;
 *     its location hint must not be represented as guaranteed US placement.
 */
export class GeminiRelay implements DurableObject {
  async fetch(request: Request): Promise<Response> {
    const incoming = new URL(request.url);
    // Operator probe: report this relay's own egress (colo/region/IP) so the
    // diagnostics endpoint can prove the US-East pinning is in effect.
    if (request.method === "GET" && incoming.pathname === "/__location") {
      const trace = await fetch("https://www.cloudflare.com/cdn-cgi/trace", { signal: AbortSignal.timeout(10_000) })
        .then(response => response.text())
        .catch(() => "");
      return Response.json({ egress: parseCloudflareTrace(trace) });
    }
    // Forward everything else to the classic Gemini API 1:1. Passing the Request
    // as the init argument preserves method, headers, body, and abort signal;
    // only the origin is rewritten.
    const target = `https://generativelanguage.googleapis.com${incoming.pathname}${incoming.search}`;
    return fetch(target, request);
  }
}

/** Operator-facing kind label for a raw Gemini key ("AIza…" = AI Studio, "AQ…" = Vertex Express). */
export function geminiKeyKind(key: string): "ai-studio" | "vertex-express" {
  return isVertexExpressKey(key) ? "vertex-express" : "ai-studio";
}

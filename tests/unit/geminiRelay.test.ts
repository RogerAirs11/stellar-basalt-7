import { afterEach, describe, expect, it, vi } from "vitest";
import { GeminiKeyRing } from "../../src/ai/core/keyRing";
import { geminiEnvKeys, loadAiConfig } from "../../src/ai/runtime/config";
import { GEMINI_RELAY_BASE, GEMINI_RELAY_ORIGIN, GeminiRelay, makeGeminiRelayFetch, parseCloudflareTrace } from "../../src/ai/providers/gemini/relay";
import { GeminiProvider } from "../../src/ai/providers/gemini/client";

/**
 * R55: the owner declines to enable Google's Agent Platform API for the Vertex
 * Express keys, so the assistant must work with plain AI Studio keys from any
 * visitor region. The GeminiRelay Durable Object (locationHint "enam") gives a
 * deterministic US egress; "AQ." keys are gated out of the ring unless the
 * operator opts in; and one chat turn may rotate through up to four keys.
 */

// Deliberately SHORT fake keys: tools/validate-ai-assistant.mjs rejects any
// source-tree string matching /AIza[0-9A-Za-z_-]{20,}/, so test fixtures must
// stay below that length while still being non-"AQ." (AI Studio style) keys.
const AIZA = "AIzaSyTestKey";
const AQ = "AQ.testVertexExpressKey";

function makeNamespace(capture: { getArgs?: unknown[]; calls?: Array<{ url: unknown; init?: unknown }> } = {}) {
  const stub = {
    fetch: vi.fn(async (input: unknown, init?: { method?: string }) => {
      capture.calls?.push({ url: input, init });
      const url = typeof input === "string" ? input : (input as URL).toString();
      if (url.includes("/__location")) return Response.json({ egress: { colo: "EWR", loc: "US", ip: "203.0.113.9" } });
      const method = init?.method ?? (typeof input === "object" && input && "method" in input ? String((input as Request).method) : "GET");
      if (method.toUpperCase() === "POST") {
        return Response.json({ interaction: { id: "i-1", steps: [], usage: {} } }, { status: 200 });
      }
      return Response.json({ models: [] }, { status: 200 });
    }),
  };
  return {
    ns: {
      idFromName: vi.fn(() => "relay-id-1"),
      get: vi.fn((id: string, opts?: unknown) => { capture.getArgs = [id, opts]; return stub; }),
    } as unknown as DurableObjectNamespace,
    stub,
  };
}

describe("GeminiRelay fetch interception", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("pins the singleton stub to Eastern North America", () => {
    const capture: { getArgs?: unknown[] } = {};
    const { ns } = makeNamespace(capture);
    makeGeminiRelayFetch(ns);
    expect(capture.getArgs).toEqual(["relay-id-1", { locationHint: "enam" }]);
  });

  it("routes relay-origin URLs through the Durable Object and leaves everything else on global fetch", async () => {
    const capture: { calls?: Array<{ url: unknown; init?: unknown }> } = { calls: [] };
    const { ns } = makeNamespace(capture);
    const globalFetch = vi.fn(async () => new Response("direct-ok", { status: 200 }));
    vi.stubGlobal("fetch", globalFetch);
    const relayFetch = makeGeminiRelayFetch(ns);

    const relayed = await relayFetch(`${GEMINI_RELAY_BASE}/models`, { headers: { "x-goog-api-key": AIZA } });
    expect(relayed.status).toBe(200);
    expect(await relayed.json()).toEqual({ models: [] });
    expect(capture.calls?.length).toBe(1);

    const direct = await relayFetch("https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-3.5-flash-lite:generateContent", { method: "POST" });
    expect(await direct.text()).toBe("direct-ok");
    expect(globalFetch).toHaveBeenCalledOnce();
    expect(capture.calls?.length).toBe(1);
  });

  it("GeminiProvider sends classic requests to the relay base through the injected fetch", async () => {
    const capture: { calls?: Array<{ url: unknown; init?: unknown }> } = { calls: [] };
    const { ns } = makeNamespace(capture);
    const relayFetch = makeGeminiRelayFetch(ns);
    const provider = new GeminiProvider(AIZA, { baseUrl: GEMINI_RELAY_BASE, fetchImpl: relayFetch });
    await provider.createTurn({
      model: "gemini-3.5-flash-lite",
      systemInstruction: "You are a test.",
      conversation: [],
      latestUserText: "hello",
      tools: [],
      toolChoice: undefined,
      maxOutputTokens: 32,
      thinkingLevel: "off",
      providerState: null,
      abortSignal: undefined,
    } as Parameters<GeminiProvider["createTurn"]>[0]);
    expect(capture.calls?.[0]?.url).toBe(`${GEMINI_RELAY_BASE}/interactions`);
  });
});

describe("GeminiRelay Durable Object", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("forwards path, query, method, and headers to generativelanguage.googleapis.com", async () => {
    const seen: Array<{ target: string; request: Request }> = [];
    vi.stubGlobal("fetch", vi.fn(async (target: any, request: any) => {
      seen.push({ target, request });
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }));
    const relay = new GeminiRelay();
    const response = await relay.fetch(new Request(`${GEMINI_RELAY_ORIGIN}/v1beta/interactions?alt=sse`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": AIZA },
      body: JSON.stringify({ model: "gemini-3.5-flash-lite" }),
    }));
    expect(response.status).toBe(200);
    expect(seen[0].target).toBe("https://generativelanguage.googleapis.com/v1beta/interactions?alt=sse");
    expect(seen[0].request.method).toBe("POST");
    expect(seen[0].request.headers.get("x-goog-api-key")).toBe(AIZA);
  });

  it("reports its own egress for the /__location operator probe", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("colo=EWR\nloc=US\nip=203.0.113.9\nwarp=off\n", { status: 200 })));
    const relay = new GeminiRelay();
    const response = await relay.fetch(new Request(`${GEMINI_RELAY_ORIGIN}/__location`));
    const payload = await response.json() as { egress: { colo: string; loc: string; ip: string } };
    expect(payload.egress).toEqual({ colo: "EWR", loc: "US", ip: "203.0.113.9" });
  });

  it("parses Cloudflare trace output defensively", () => {
    expect(parseCloudflareTrace("")).toEqual({ colo: null, loc: null, ip: null });
    expect(parseCloudflareTrace("colo=HKG\nloc=HK")).toEqual({ colo: "HKG", loc: "HK", ip: null });
  });
});

describe("Vertex Express gating (AI_VERTEX_EXPRESS_ENABLED)", () => {
  it("drops AQ keys from env lists by default and admits them when enabled", () => {
    const env = { GEMINI_API_KEY: AIZA, GEMINI_API_KEYS: `${AQ}, ${AIZA}suffix` };
    expect(geminiEnvKeys(env as Env)).toEqual([AIZA, `${AIZA}suffix`]);
    expect(geminiEnvKeys({ ...env, AI_VERTEX_EXPRESS_ENABLED: "1" } as Env)).toEqual([AIZA, AQ, `${AIZA}suffix`]);
  });

  it("the key ring holds back AQ keys until opted in", () => {
    const gated = GeminiKeyRing.fromEnv({ GEMINI_API_KEY: AIZA, GEMINI_API_KEYS: AQ });
    expect(gated.size).toBe(1);
    expect(gated.vertexExpressKey()).toBeNull();
    const optedIn = GeminiKeyRing.fromEnv({ GEMINI_API_KEY: AIZA, GEMINI_API_KEYS: AQ, AI_VERTEX_EXPRESS_ENABLED: "1" });
    expect(optedIn.size).toBe(2);
    expect(optedIn.vertexExpressKey()?.key).toBe(AQ);
  });

  it("admin database AQ keys are filtered the same way", () => {
    const ring = GeminiKeyRing.fromEnv({ GEMINI_API_KEY: AIZA });
    ring.setDatabaseKeys([{ id: "1", api_key: AQ }, { id: "2", api_key: `${AIZA}-db` }]);
    expect(ring.describeEntries().map(e => e.kind)).toEqual(["ai-studio", "ai-studio"]);
    const optedIn = GeminiKeyRing.fromEnv({ AI_VERTEX_EXPRESS_ENABLED: "1" });
    optedIn.setDatabaseKeys([{ id: "1", api_key: AQ }]);
    expect(optedIn.describeEntries().map(e => e.kind)).toEqual(["vertex-express"]);
  });

  it("loadAiConfig activates the relay only when the binding exists and honors the kill switch", () => {
    const ns = makeNamespace().ns;
    const env = { AI_ASSISTANT_ENABLED: "1", GEMINI_API_KEY: AIZA, GEMINI_BASE_URL: "https://gateway.ai.cloudflare.com/v1/acct/gw/google-ai-studio/v1beta", GEMINI_RELAY: ns } as unknown as Env;
    const active = loadAiConfig(env);
    expect(active.gemini.relay.active).toBe(true);
    expect(active.gemini.baseUrl).toBe(GEMINI_RELAY_BASE);
    expect(active.gemini.relay.fetchImpl).toBeTypeOf("function");

    const killed = loadAiConfig({ ...env, GEMINI_RELAY_ENABLED: "0" } as Env);
    expect(killed.gemini.relay.active).toBe(false);
    expect(killed.gemini.baseUrl).toBe("https://gateway.ai.cloudflare.com/v1/acct/gw/google-ai-studio/v1beta");

    const noBinding = loadAiConfig({ AI_ASSISTANT_ENABLED: "1", GEMINI_API_KEY: AIZA, GEMINI_BASE_URL: "https://gateway.ai.cloudflare.com/v1/acct/gw/google-ai-studio/v1beta" } as Env);
    expect(noBinding.gemini.relay.active).toBe(false);
    expect(noBinding.gemini.relay.fetchImpl).toBeNull();
  });
});

describe("Key rotation skipping", () => {
  it("pickSkipping never returns an already-attempted key", () => {
    const ring = GeminiKeyRing.fromEnv({ GEMINI_API_KEYS: [`${AIZA}1`, `${AIZA}2`, `${AIZA}3`].join(",") });
    const first = ring.pick()!;
    const second = ring.pickSkipping(new Set([first.id]))!;
    const third = ring.pickSkipping(new Set([first.id, second.id]))!;
    expect(new Set([first.id, second.id, third.id]).size).toBe(3);
    expect(ring.pickSkipping(new Set([first.id, second.id, third.id]))).toBeNull();
  });

  it("active cooldowns are never bypassed when nothing is available", () => {
    const ring = GeminiKeyRing.fromEnv({ GEMINI_API_KEYS: [`${AIZA}1`, `${AIZA}2`].join(",") });
    const [first, second] = ring.describeEntries();
    // One cooling key: the other available key wins.
    ring.markRateLimited(first.id, 60_000);
    expect(ring.pickSkipping(new Set(["does-not-exist"]))?.id).toBe(second.id);
    // R109: all cooling means wait; never ignore the provider minimum delay.
    ring.markRateLimited(second.id, 60_000);
    expect(ring.pickSkipping(new Set([second.id]))).toBeNull();
  });
});

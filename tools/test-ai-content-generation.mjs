import assert from "node:assert/strict";
import { compileTsRuntime } from "./ts-runtime-loader.mjs";

/**
 * R32 content-generation resilience harness.
 * Verifies the self-correcting Gemini editorial generator: correct Interactions
 * API payload shape, grounding behavior + degradation, classic-endpoint transport
 * fallback, multi-key rotation on 429, JSON self-repair, model fallback, and the
 * key ring primitives.
 */
const rt = compileTsRuntime(
  ["src/api/http.ts", "src/content/gemini.ts", "src/content/aiShared.ts", "src/content/deepseek.ts", "src/content/generate.ts", "src/ai/core/keyRing.ts", "src/ai/runtime/config.ts", "src/ai/core/modelCatalog.ts", "src/ai/core/types.ts"],
  { linkNodeModules: true },
);
const makeInput = (over = {}) => ({ model: "gemini-3.8-flash", grounding: false, kind: "article", ...over });

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

function validContent() {
  return {
    kind: "article",
    title_en: "Understanding Arabian Pedigree Lines",
    title_fa: "درک خطوط تبارنامه اسب عرب",
    summary_en: "A professional summary of Arabian pedigree line preservation practices for modern studbooks.",
    summary_fa: "خلاصه‌ای حرفه‌ای از شیوه‌های حفظ خطوط تبارنامه در استادبوک‌های امروزی.",
    body_en: "## Introduction\nThe Arabian horse registry depends on disciplined pedigree keeping.\n\n## Line preservation\nBreeders preserve bloodlines through careful pairing decisions and record integrity.\n\n## Closing notes\nReliable lineage records protect the breed for future generations.",
    body_fa: "## مقدمه\nثبت تبارنامه اسب عرب به نظم کتابخانه‌های تبارنامه وابسته است.\n\n## حفظ خطوط\nپرورش‌دهندگان با انتخاب جفت‌های دقیق خطوط خونی را حفظ می‌کنند.\n\n## جمع‌بندی\nسوابق معتبر تبار، نژاد را برای نسل‌های آینده محافظت می‌کند.",
    tags: ["pedigree", "studbook", "arabian"],
  };
}

// Explicit accounting double: records admission/completion, not a live provider DB.
const emptyDb = () => ({
  prepare(sql) {
    return {
      bind() { return this; },
      first: async () => ({ count: 0, tokens: 0 }),
      all: async () => ({ results: [] }),
      run: async () => ({ success: true, meta: { changes: 1 } }),
    };
  },
});


try {
  const gemini = rt.load("src/content/gemini.ts");
  const { GeminiKeyRing, maskKey } = rt.load("src/ai/core/keyRing.ts");

  await testKeyRingPrimitives(GeminiKeyRing, maskKey);
  await testHappyPathInteractions(gemini, makeInput);
  await testGroundingShapeAndCitations(gemini, makeInput);
  await testGroundingGracefullyDegraded(gemini, makeInput);
  await testTransportFallbackToClassic(gemini, makeInput);
  await testKeyRotationOn429(gemini, makeInput);
  await testJsonSelfRepair(gemini, makeInput);
  await testModelFallback(gemini, makeInput);

  console.log("R32 content-generation harness passed: Interactions payload shape, grounding + citations + degradation, classic transport fallback, key rotation on 429, JSON self-repair, and model fallback are coherent.");
} finally {
  rt.cleanup();
}

async function testKeyRingPrimitives(GeminiKeyRing, maskKey) {
  const ring = GeminiKeyRing.fromEnv({ AI_GEMINI_38_FLASH_RPM_LIMIT: "5", AI_GEMINI_38_FLASH_INPUT_TPM_LIMIT: "100000", AI_GEMINI_38_FLASH_RPD_LIMIT: "20", GEMINI_API_KEY: "AIzaAAAA_first", GEMINI_API_KEYS: "AIzaBBBB_second, AIzaAAAA_first\nAQ.CCCC_third" });
  assert.equal(ring.size, 2, "env keys parse comma+newline separated, deduped against GEMINI_API_KEY; AQ keys are held back while Vertex Express is disabled");
  const first = ring.pick();
  assert.equal(first.key, "AIzaAAAA_first");
  ring.markRateLimited(first.id, 1000);
  assert.equal(ring.pick().key, "AIzaBBBB_second", "rate-limited key is skipped");
  assert.equal(ring.available(), 1);
  assert.equal(ring.pickExcept("env-2"), null, "pickExcept never bypasses a cooling credential");
  ring.markRateLimited("env-2", null);
  assert.equal(ring.pick(), null, "all cooling -> no available key");
  const cooldownRing = GeminiKeyRing.fromEnv({ AI_GEMINI_38_FLASH_RPM_LIMIT: "5", AI_GEMINI_38_FLASH_INPUT_TPM_LIMIT: "100000", AI_GEMINI_38_FLASH_RPD_LIMIT: "20", GEMINI_API_KEY: "AIzaAAAA_first" });
  cooldownRing.markRateLimited("env-1", 1000, "gemini-3.8-flash");
  assert.equal(cooldownRing.pickForModel("gemini-3.8-flash"), null, "the only key is cooling for the exhausted model");
  assert.equal(cooldownRing.pickForModel("gemini-2.5-flash")?.key, "AIzaAAAA_first", "the same credential stays eligible for a model with independent quota");
  assert.equal(cooldownRing.pick()?.key, "AIzaAAAA_first", "a model-scoped cooldown never applies a global cooldown");
  assert.equal(ring.forced().key, "AIzaAAAA_first", "forced still returns the first entry as last resort");
  const snap = ring.snapshot();
  assert.equal(snap.totalKeys, 2);
  assert.equal(snap.coolingKeys, 2);
  assert.equal(snap.keys[0].masked.includes("•"), true, "keys are masked in snapshots");
  assert.ok(/^sh[•]+$/.test(maskKey("short")), "short keys masked safely");

  const vertexRing = GeminiKeyRing.fromEnv({ AI_GEMINI_38_FLASH_RPM_LIMIT: "5", AI_GEMINI_38_FLASH_INPUT_TPM_LIMIT: "100000", AI_GEMINI_38_FLASH_RPD_LIMIT: "20", GEMINI_API_KEY: "AIzaAAAA_first", GEMINI_API_KEYS: "AIzaBBBB_second, AQ.CCCC_third", AI_VERTEX_EXPRESS_ENABLED: "1" });
  assert.equal(vertexRing.size, 3, "AQ keys join the ring when the operator opts in");
  assert.equal(vertexRing.vertexExpressKey()?.key, "AQ.CCCC_third", "vertexExpressKey() resolves only when opted in");

  const dbRing = new GeminiKeyRing();
  dbRing.addEnvKey("AIzaAAAA_first");
  dbRing.setDatabaseKeys([
    { id: "db-k1", api_key: "AIzaDB_key_one", label: "Laptop key" },
    { id: "db-k2", api_key: "AIzaAAAA_first", label: "duplicate" },
  ]);
  assert.equal(dbRing.size, 2, "database keys dedupe against env keys");
  assert.equal(dbRing.pick().key, "AIzaAAAA_first");
}

async function testHappyPathInteractions(gemini, input) {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body), key: init.headers["x-goog-api-key"] });
    return jsonResponse({ interaction: { steps: [{ type: "model_output", content: [{ type: "text", text: JSON.stringify(validContent()) }] }], status: "completed" } });
  };
  try {
    const result = await gemini.generateGeminiBilingualContent(input(), { AI_GEMINI_38_FLASH_RPM_LIMIT: "5", AI_GEMINI_38_FLASH_INPUT_TPM_LIMIT: "100000", AI_GEMINI_38_FLASH_RPD_LIMIT: "20", GEMINI_API_KEY: "AIzaTEST_key", DB: emptyDb() });
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.endsWith("/v1beta/interactions"), "default transport is the Interactions API");
    const body = calls[0].body;
    assert.equal(body.model, "gemini-3.8-flash");
    assert.equal(body.input[0].type, "user_input");
    assert.equal(body.store, false, "content generation never persists interactions");
    assert.equal(body.response_format.mime_type, "application/json", "structured output via response_format");
    assert.equal(body.response_format.schema.required.length, 8);
    assert.equal(body.generation_config.max_output_tokens > 0, true);
    assert.equal(result.draft.status, "draft");
    assert.equal(result.draft.title_en, "Understanding Arabian Pedigree Lines");
    assert.equal(result.draft.ai_model, "gemini-3.8-flash");
    assert.deepEqual(result.attempts, [], "no resilience measures needed on the happy path");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testGroundingShapeAndCitations(gemini, input) {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return jsonResponse({
      interaction: {
        steps: [
          { type: "google_search_call", arguments: { queries: ["WAHO registry"] } },
          { type: "model_output", content: [{ type: "text", text: JSON.stringify(validContent()), annotations: [
            { type: "url_citation", url: "https://waho.org/example", title: "waho.org" },
            { type: "url_citation", url: "https://waho.org/example", title: "waho.org duplicate" },
            { type: "url_citation", url: "https://example.org/second", title: "example.org" },
          ] }] },
        ],
      },
    });
  };
  try {
    const result = await gemini.generateGeminiBilingualContent(input({ grounding: true }), { AI_GEMINI_38_FLASH_RPM_LIMIT: "5", AI_GEMINI_38_FLASH_INPUT_TPM_LIMIT: "100000", AI_GEMINI_38_FLASH_RPD_LIMIT: "20", GEMINI_API_KEY: "AIzaTEST_key", AI_GEMINI_WEB_GROUNDING_ENABLED: "1", DB: emptyDb() });
    const body = calls[0].body;
    assert.deepEqual(body.tools, [{ type: "google_search" }], "grounding uses the Interactions google_search tool");
    assert.equal(body.response_format, undefined, "grounding must not combine response_format (documented incompatibility)");
    assert.equal(result.sources.length, 2, "citation annotations become deduped sources");
    assert.equal(result.sources[0].url, "https://waho.org/example");
    assert.equal(result.sources[1].url, "https://example.org/second");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testGroundingGracefullyDegraded(gemini, input) {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return jsonResponse({ interaction: { steps: [{ type: "model_output", content: [{ type: "text", text: JSON.stringify(validContent()) }] }] } });
  };
  try {
    const result = await gemini.generateGeminiBilingualContent(input({ grounding: true }), { AI_GEMINI_38_FLASH_RPM_LIMIT: "5", AI_GEMINI_38_FLASH_INPUT_TPM_LIMIT: "100000", AI_GEMINI_38_FLASH_RPD_LIMIT: "20", GEMINI_API_KEY: "AIzaTEST_key", DB: emptyDb() });
    assert.equal(calls[0].body.tools, undefined, "grounding is skipped when the operator flag is off");
    assert.equal(calls[0].body.response_format.mime_type, "application/json");
    assert.ok(result.warnings.some(w => /grounding was skipped/i.test(w)), "a warning explains the skipped grounding");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testTransportFallbackToClassic(gemini, input) {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    if (String(url).endsWith("/interactions")) {
      return jsonResponse({ error: { message: "This API is not available in your current location. See https://ai.google.dev/gemini-api/docs/available-regions.", code: "invalid_request" } }, 400);
    }
    return jsonResponse({ candidates: [{ content: { parts: [{ text: JSON.stringify(validContent()) }] }, groundingMetadata: { groundingChunks: [{ web: { uri: "https://classic.example/x", title: "Classic" } }] } }] });
  };
  try {
    const result = await gemini.generateGeminiBilingualContent(input({ grounding: true }), { AI_GEMINI_38_FLASH_RPM_LIMIT: "5", AI_GEMINI_38_FLASH_INPUT_TPM_LIMIT: "100000", AI_GEMINI_38_FLASH_RPD_LIMIT: "20", GEMINI_API_KEY: "AIzaTEST_key", AI_GEMINI_WEB_GROUNDING_ENABLED: "1", DB: emptyDb() });
    assert.equal(calls.length, 2);
    assert.ok(calls[1].url.includes(":generateContent"), "falls back to the classic endpoint");
    const gc = calls[1].body.generationConfig;
    assert.deepEqual(calls[1].body.tools, [{ googleSearch: {} }], "classic grounding uses googleSearch");
    assert.equal(gc.responseSchema, undefined, "grounded classic requests must not combine responseSchema (incompatible)");
    assert.equal(result.sources[0].url, "https://classic.example/x", "groundingChunks become sources");
    assert.ok(result.attempts.some(a => /classic Gemini endpoint/i.test(a)));
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testKeyRotationOn429(gemini, input) {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), key: init.headers["x-goog-api-key"] });
    if (calls.length === 1) {
      return jsonResponse({ error: { message: "You exceeded your current quota", code: "too_many_requests" } }, 429);
    }
    return jsonResponse({ interaction: { steps: [{ type: "model_output", content: [{ type: "text", text: JSON.stringify(validContent()) }] }] } });
  };
  // Same explicit accounting double as emptyDb: chainable statement whose
  // reservations admit (changes:1) — exercise rotation, not quota refusal.
  const dbWithKeys = () => ({
    prepare(sql) {
      return {
        bind() { return this; },
        first: async () => ({ count: 0, tokens: 0 }),
        all: async () => ({ results: [
          { id: "k1", api_key: "AIzaADMIN_one", label: "Admin 1", last_used_at: null, last_status: null },
          { id: "k2", api_key: "AIzaADMIN_two", label: "Admin 2", last_used_at: null, last_status: null },
        ] }),
        run: async () => ({ success: true, meta: { changes: 1 } }),
      };
    },
  });
  try {
    const result = await gemini.generateGeminiBilingualContent(input(), { AI_GEMINI_38_FLASH_RPM_LIMIT: "5", AI_GEMINI_38_FLASH_INPUT_TPM_LIMIT: "100000", AI_GEMINI_38_FLASH_RPD_LIMIT: "20", GEMINI_API_KEY: "AIzaENV_key", APP_ENV: `rotation-${Date.now()}`, DB: dbWithKeys() });
    assert.equal(calls.length, 2, "exactly one rotation after a 429");
    assert.equal(calls[0].key, "AIzaENV_key", "env key is tried first");
    assert.equal(calls[1].key, "AIzaADMIN_one", "rotation advances to the first admin key");
    assert.ok(result.attempts.some(a => /Rotated to the next configured API key/i.test(a)), "rotation is reported");
    assert.equal(result.draft.title_en, "Understanding Arabian Pedigree Lines");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testJsonSelfRepair(gemini, input) {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    if (calls.length === 1) {
      return jsonResponse({ interaction: { steps: [{ type: "model_output", content: [{ type: "text", text: "Sure! Here is your article:\n```json\n" + JSON.stringify({ ...validContent(), body_en: "too short" }) + "\n```" }] }] } });
    }
    return jsonResponse({ candidates: [{ content: { parts: [{ text: JSON.stringify(validContent()) }] } }] });
  };
  try {
    const result = await gemini.generateGeminiBilingualContent(input(), { AI_GEMINI_38_FLASH_RPM_LIMIT: "5", AI_GEMINI_38_FLASH_INPUT_TPM_LIMIT: "100000", AI_GEMINI_38_FLASH_RPD_LIMIT: "20", GEMINI_API_KEY: "AIzaTEST_key", DB: emptyDb() });
    assert.equal(calls.length, 2, "one repair round");
    assert.match(calls[1].body.contents[0].parts[0].text, /corrected, complete JSON/i, "repair prompt asks for corrected JSON");
    assert.equal(calls[1].body.generationConfig.responseMimeType, "application/json");
    assert.equal(result.draft.title_en, "Understanding Arabian Pedigree Lines");
    assert.ok(result.attempts.some(a => /self-correction/i.test(a)), "self-correction is reported");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testModelFallback(gemini, input) {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    if (JSON.parse(init.body).model === "gemini-3.8-flash") {
      return jsonResponse({ error: { message: "Resource has been exhausted", code: "too_many_requests" } }, 429);
    }
    return jsonResponse({ interaction: { steps: [{ type: "model_output", content: [{ type: "text", text: JSON.stringify(validContent()) }] }] } });
  };
  try {
    const result = await gemini.generateGeminiBilingualContent(input(), { AI_GEMINI_38_FLASH_RPM_LIMIT: "5", AI_GEMINI_38_FLASH_INPUT_TPM_LIMIT: "100000", AI_GEMINI_38_FLASH_RPD_LIMIT: "20", GEMINI_API_KEY: "AIzaTEST_key", APP_ENV: `modelfallback-${Date.now()}`, DB: emptyDb() });
    const models = calls.map(c => JSON.parse(JSON.stringify(c.body)).model || calls[0].body.model);
    assert.ok(models.includes("gemini-2.5-flash"), "falls back to the faster 2.5 model");
    assert.ok(result.attempts.some(a => /Fell back to gemini-2\.5-flash/.test(a)), "model fallback is reported");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

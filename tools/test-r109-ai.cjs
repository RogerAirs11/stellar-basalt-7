'use strict';
// Real TypeScript modules with explicit in-memory DB/HTTP doubles. No provider calls.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./lib/r104-isolated-module.cjs');
const repository = () => load('src/ai/conversation/repository.ts');
const keyModule = () => load('src/ai/core/keyRing.ts');
const budgetDb = ({ error, total = 0.1, changes = 1 } = {}) => ({
  prepare(sql) { return { bind() { return this; }, async run() {
    if (error) throw error;
    return { success: true, meta: { changes } };
  }, async first() { return total === null ? null : { cost: total }; } }; }
});

test('R109 paid AI: storage write quota must refuse an untracked paid call', async () => {
  await assert.rejects(() => repository().reserveProviderCost(budgetDb({ error: new Error('D1_ERROR: daily row write limit exceeded') }), 'ledger', 'deepseek', .02, 1), e => e.code === 'paid_reservation_unavailable');
});
for (const total of [null, NaN, Infinity, -1, 'not-a-number']) test(`R109 paid AI: invalid total ${String(total)} cannot authorize spending`, async () => {
  await assert.rejects(() => repository().reserveProviderCost(budgetDb({ total }), 'ledger', 'deepseek', .02, 1));
});
// R109-D1 paid admission: the daily ceiling is evaluated INSIDE the conditional
// reservation insert. changes=0 means the ceiling would be exceeded — a
// cost_limit refusal with ZERO rows written and no release needed. This is the
// atomic admission pattern that keeps concurrent bursts from over-refusing on
// engines without a transaction wrapper (D1) while never over-admitting.
test('R109 paid AI: conditional insert changes=0 is a daily-cost-limit refusal, never an unverified write', async () => {
  const inserts = [];
  const db = {
    prepare(sql) {
      return {
        bind(...values) {
          if (/^INSERT INTO ai_cost_reservations/m.test(sql)) inserts.push({ sql, values });
          return this;
        },
        async run() { return { success: true, meta: { changes: 0 } }; },
        async first() { throw new Error('no read expected on a refused admission'); },
      };
    },
  };
  await assert.rejects(
    () => repository().reserveProviderCost(db, 'ledger', 'deepseek', .02, 1),
    e => e.category === 'cost_limit' && e.code === 'daily_cost_limit',
  );
  assert.equal(inserts.length, 1, 'exactly one conditional admission statement');
  assert.match(inserts[0].sql, /WHERE \(SELECT COALESCE\(SUM\(/, 'the ceiling predicate lives inside the admission write');
});

for (const [cost, limit] of [[NaN,1],[Infinity,1],[-1,1],[.1,NaN],[.1,Infinity],[.1,0]]) test(`R109 paid AI: invalid reservation inputs ${cost}/${limit} rejected before SQL`, async () => {
  let touched = false;
  const db = { prepare() { touched = true; throw new Error('unexpected SQL'); } };
  await assert.rejects(() => repository().reserveProviderCost(db, 'ledger', 'deepseek', cost, limit));
  assert.equal(touched, false);
});
for (const changes of [undefined, null, NaN, -1, 0, 2]) test(`R109 paid AI: malformed reservation receipt ${String(changes)} is not acceptance`, async () => {
  const db = budgetDb({ changes });
  if (changes === undefined) db.prepare = () => ({ bind() { return this; }, async run() { return { meta: {} }; }, async first() { return { cost: .1 }; } });
  await assert.rejects(() => repository().reserveProviderCost(db, 'ledger', 'deepseek', .02, 1));
});
test('R109 paid AI: valid conservative reservation remains available', async () => {
  const r = await repository().reserveProviderCost(budgetDb(), 'ledger', 'deepseek', .02, 1);
  assert.equal(r.dailyReservedUsd, .1); assert.notEqual(r.reservationId, 'degraded-quota');
});
for (const value of [NaN, Infinity, -1]) test(`R109 paid AI: invalid settlement ${value} never lowers a reservation`, async () => {
  let writes = 0;
  const db = { prepare() { writes++; throw new Error('unexpected write'); } };
  await assert.rejects(() => repository().reconcileProviderEstimatedCost(db, 'reservation', value));
  assert.equal(writes, 0);
});

const ringDb = (rows = []) => ({ prepare() { return { async all() { return { results: rows }; } }; } });
test('R109 Gemini: separate databases with the same APP_ENV cannot share keys', async () => {
  const { loadGeminiKeyRing } = keyModule();
  const a = await loadGeminiKeyRing({ APP_ENV: 'production', GEMINI_API_KEY: 'key-A' }, ringDb());
  const b = await loadGeminiKeyRing({ APP_ENV: 'production', GEMINI_API_KEY: 'key-B' }, ringDb());
  assert.equal(a.pick().key, 'key-A'); assert.equal(b.pick().key, 'key-B'); assert.notEqual(a,b);
});
test('R109 Gemini: changed environment credentials invalidate the cached ring', async () => {
  const { loadGeminiKeyRing } = keyModule(); const db = ringDb();
  const env = { APP_ENV: 'production', GEMINI_API_KEY: 'key-A' };
  await loadGeminiKeyRing(env,db); env.GEMINI_API_KEY = 'key-B';
  assert.equal((await loadGeminiKeyRing(env,db)).pick().key,'key-B');
});
test('R109 Gemini: concurrent first loads share one authoritative key query', async () => {
  const { loadGeminiKeyRing } = keyModule(); let queries = 0; let release;
  const db = { prepare() { queries++; return { all: () => new Promise(resolve => { release = () => resolve({ results: [] }); }) }; } };
  const env = { APP_ENV: 'production', GEMINI_API_KEY: 'key-A' };
  const a = loadGeminiKeyRing(env,db), b = loadGeminiKeyRing(env,db);
  await Promise.resolve(); assert.equal(queries,1); release(); assert.equal(await a,await b);
});
test('R109 Gemini: rate cooldown survives the 20-second database refresh', async t => {
  const { loadGeminiKeyRing } = keyModule(); const db = ringDb(); const env = { APP_ENV: 'production', GEMINI_API_KEY: 'key-A' };
  const original = Date.now; let now = 100000; Date.now = () => now; t.after(() => { Date.now = original; });
  const a = await loadGeminiKeyRing(env,db); a.markRateLimited('env-1',60000); now += 21000;
  const b = await loadGeminiKeyRing(env,db); assert.equal(b.pick(),null); assert.equal(b.cooldownRemainingMs('env-1'),39000);
});
test('R109 Gemini: model restrictions belong to the credential, not generic env-1', () => {
  const { GeminiKeyRing } = keyModule();
  const a = GeminiKeyRing.fromEnv({ GEMINI_API_KEY:'key-A', GEMINI_API_KEYS:'key-A2' });
  const b = GeminiKeyRing.fromEnv({ GEMINI_API_KEY:'key-B', GEMINI_API_KEYS:'key-B2' });
  a.markModelUnsupported('env-1','gemini-2.5-flash');
  assert.equal(a.pickForModel('gemini-2.5-flash').key,'key-A2');
  assert.equal(b.pickForModel('gemini-2.5-flash').key,'key-B');
});
test('R109 Gemini: model-aware selection cannot knowingly retry an unsupported key', () => {
  const { GeminiKeyRing } = keyModule(); const ring = GeminiKeyRing.fromEnv({ GEMINI_API_KEY:'key-A' });
  ring.markModelUnsupported('env-1','gemini-2.5-flash'); assert.equal(ring.pickForModel('gemini-2.5-flash'),null);
});
test('R109 Gemini: rotation never bypasses an active provider cooldown', () => {
  const { GeminiKeyRing } = keyModule(); const ring = GeminiKeyRing.fromEnv({ GEMINI_API_KEY:'key-A' });
  ring.markRateLimited('env-1',60000); assert.equal(ring.pickSkipping(new Set()),null);
});

const providerInput = { model:'deepseek-flash', systemInstruction:'Canonical evidence only', conversation:[{role:'user',text:'Find horse 1'}], latestUserText:'Find horse 1', tools:[], thinkingLevel:'off', maxOutputTokens:1024, toolChoice:'none' };
const sse = text => new Response(text,{headers:{'content-type':'text/event-stream'}});
const consume = async iterable => { const events=[]; for await(const e of iterable) events.push(e); return events; };
for (const [name,body] of [
 ['truncated draft','data: {"choices":[{"delta":{"content":"partial"},"finish_reason":null}]}\n\n'],
 ['malformed JSON','data: {broken}\n\ndata: [DONE]\n\n'],
 ['in-band error','data: {"error":{"message":"upstream unavailable"}}\n\ndata: [DONE]\n\n'],
 ['empty stream','data: [DONE]\n\n'],
]) test(`R109 DeepSeek: ${name} is never committed as a successful terminal result`,async()=>{
  const { DeepSeekProvider }=load('src/ai/providers/deepseek/client.ts');
  const provider=new DeepSeekProvider('fake',false,async()=>sse(body));
  await assert.rejects(()=>consume(provider.streamTurn(providerInput)));
});
test('R109 DeepSeek: cache usage aliases preserve actual input cost',async()=>{
 const { DeepSeekProvider }=load('src/ai/providers/deepseek/client.ts');
 const provider=new DeepSeekProvider('fake',false,async()=>Response.json({choices:[{message:{content:'answer'},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:10,total_tokens:110,prompt_tokens_details:{cached_tokens:40}}}));
 const r=await provider.createTurn(providerInput); assert.equal(r.usage.cacheHitTokens,40);assert.equal(r.usage.cacheMissTokens,60);
});
for(const usage of [undefined,{}, {prompt_tokens:-1,completion_tokens:2}, {prompt_tokens:'bad',completion_tokens:2}]) test(`R109 DeepSeek: missing/malformed usage cannot settle paid cost as zero (${JSON.stringify(usage)})`,async()=>{
 const { DeepSeekProvider }=load('src/ai/providers/deepseek/client.ts');
 const provider=new DeepSeekProvider('fake',false,async()=>Response.json({choices:[{message:{content:'answer'},finish_reason:'stop'}],usage}));
 await assert.rejects(()=>provider.createTurn(providerInput));
});

// ---------------------------------------------------------------------------
// R109-33: the operator diagnostics generation probe is a REAL generation
// network attempt — it must go through canonical admission (reserveGeminiAttempt,
// request_kind "diagnostic") and a refused admission must mean NO network call.
// ---------------------------------------------------------------------------
test('R109-33 diagnostics: &generate=1 probe admits through the ledger before any network attempt', async () => {
  const diagnostics = load('src/ai/application/diagnostics.ts');
  const ledgerWrites = [];
  let fetchCalls = 0;
  const admissions = [];
  const db = {
    prepare(sql) {
      return {
        bind(...values) { ledgerWrites.push({ sql: sql.slice(0, 60), values }); return this; },
        async run() {
          // The conditional admission INSERT admits (changes=1) and the
          // ledger completion UPDATE succeeds.
          if (/^INSERT INTO ai_request_ledger/m.test(sql)) { admissions.push(1); return { success: true, meta: { changes: 1 } }; }
          return { success: true, meta: { changes: 1 } };
        },
        async first() { return { count: 0, tokens: 0 }; },
        async all() { return { results: [] }; },
      };
    },
  };
  const globalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    fetchCalls += 1;
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('/interactions')) return Response.json({ interaction: { steps: [] } });
    if (url.includes('/models')) return Response.json({});
    if (url.includes('cdn-cgi/trace')) return new Response('colo=SJC\nloc=US\nip=203.0.113.9', { headers: { 'content-type': 'text/plain' } });
    return Response.json({});
  };
  try {
    const env = { AI_DIAG_TOKEN: 'diag-token', GEMINI_API_KEY: 'AIzaDIAG_probe', APP_ENV: 'r109-diag-admit', DB: db };
    const response = await diagnostics.aiDiagnostics(new Request('https://app.test/api/ai/diagnostics?token=diag-token&generate=1'), env);
    const body = await response.json();
    assert.equal(admissions.length, 1, 'exactly one ledger admission for the generation probe');
    assert.equal(fetchCalls >= 1, true, 'the probe made network calls only after admission');
    const generateProbe = JSON.stringify(body.keys?.[0]?.probes ?? {});
    assert.match(generateProbe, /"direct:generate"/, 'the active-transport generation probe ran');
  } finally {
    globalThis.fetch = globalFetch;
  }
});

test('R109-33 diagnostics: a refused admission sends NO generation probe and reports quota_refused', async () => {
  const diagnostics = load('src/ai/application/diagnostics.ts');
  let interactionsCalls = 0;
  const db = {
    prepare(sql) {
      return {
        bind() { return this; },
        async run() {
          if (/^INSERT INTO ai_request_ledger/m.test(sql)) return { success: true, meta: { changes: 0 } };
          return { success: true, meta: { changes: 0 } };
        },
        // Saturated counters: the refusal reason resolves to rpm_reserve_reached.
        async first() { return { count: 999999, tokens: 999999 }; },
        async all() { return { results: [] }; },
      };
    },
  };
  const globalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('/interactions')) { interactionsCalls += 1; return Response.json({ interaction: { steps: [] } }); }
    if (url.includes('/models')) return Response.json({});
    if (url.includes('cdn-cgi/trace')) return new Response('colo=SJC\nloc=US\nip=203.0.113.9', { headers: { 'content-type': 'text/plain' } });
    return Response.json({});
  };
  try {
    const env = { AI_DIAG_TOKEN: 'diag-token', GEMINI_API_KEY: 'AIzaDIAG_probe', APP_ENV: 'r109-diag-refuse', DB: db };
    const response = await diagnostics.aiDiagnostics(new Request('https://app.test/api/ai/diagnostics?token=diag-token&generate=1'), env);
    const body = await response.json();
    assert.equal(interactionsCalls, 0, 'a refused admission must mean ZERO generation network attempts');
    const generateProbe = JSON.stringify(body.keys?.[0]?.probes ?? {});
    assert.match(generateProbe, /quota_refused/, 'the refusal itself is the honest diagnostic');
    assert.match(generateProbe, /generation probe not sent/, 'the operator sees that the probe was not sent');
  } finally {
    globalThis.fetch = globalFetch;
  }
});

test('R109-33 diagnostics: unset AI_DIAG_TOKEN keeps the route 404 and never probes', async () => {
  const diagnostics = load('src/ai/application/diagnostics.ts');
  let fetchCalls = 0;
  const globalFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetchCalls += 1; return Response.json({}); };
  try {
    const response = await diagnostics.aiDiagnostics(new Request('https://app.test/api/ai/diagnostics'), {});
    assert.equal(response.status, 404, 'route hidden when the token secret is unset');
    assert.equal(fetchCalls, 0, 'no network probe of any kind may run');
  } finally {
    globalThis.fetch = globalFetch;
  }
});

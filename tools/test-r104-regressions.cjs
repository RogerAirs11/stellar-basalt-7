'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, root } = require('./lib/r104-isolated-module.cjs');
const path = require('node:path');
const fs = require('node:fs');
const transport = load('src/frontend-kit/platformClient.ts');
const { PlatformClientError } = require(path.join(root, 'src/frontend-kit/errors.ts'));
const tick = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((a,b)=>{resolve=a;reject=b;}); return {promise,resolve,reject}; };
const done = {type:'done',message:{id:'synthetic',role:'assistant',text:'complete',createdAt:'2026-10-14T00:00:00Z'}};
const frame = value => `data: ${JSON.stringify(value)}\n\n`;
const encoded = text => new TextEncoder().encode(text);
const streamResponse = (chunks, onCancel=()=>{}) => new Response(new ReadableStream({
  start(controller) { for(const chunk of chunks) controller.enqueue(typeof chunk==='string'?encoded(chunk):chunk); controller.close(); },
  cancel: onCancel,
}), {headers:{'content-type':'text/event-stream; charset=utf-8'}});
const collect = async iterable => { const values=[]; for await(const value of iterable) values.push(value); return values; };

for (const status of [401,403,429,503]) test(`R104 HTTP ${status} preserves typed error and retry hint`,async()=>{
  const fetcher=async()=>new Response(JSON.stringify({error:{code:'synthetic_refusal',message:'Refused',details:{current_version:9}}}),{status,headers:{'retry-after':'60'}});
  await assert.rejects(transport.createFetchPlatformTransport(fetcher)('/api/test'),e=>e.code==='synthetic_refusal'&&e.details.retry_after_seconds===60&&e.details.current_version===9);
});
test('R104 malformed error fields cannot become object messages/codes',async()=>{
  await assert.rejects(transport.createFetchPlatformTransport(async()=>new Response('{"error":{"code":{},"message":[]}}',{status:503}))('/api/test'),e=>e.code==='request_failed'&&typeof e.message==='string');
});
test('R104 non-JSON errors retain Retry-After',async()=>{
  await assert.rejects(transport.createFetchPlatformTransport(async()=>new Response('edge unavailable',{status:503,headers:{'retry-after':'9'}}))('/api/test'),e=>e.code==='invalid_error_response'&&e.details.retry_after_seconds===9);
});
test('R104 body AbortError is not reclassified as invalid JSON',async()=>{
  const aborted=new DOMException('Cancelled','AbortError');
  await assert.rejects(transport.createFetchPlatformTransport(async()=>({ok:true,status:200,json:async()=>{throw aborted;}}))('/api/test'),e=>e===aborted);
});
test('R104 pre-aborted calls perform no fetch',async()=>{
  const c=new AbortController();c.abort();let calls=0;
  await assert.rejects(transport.createFetchPlatformTransport(async()=>{calls++;})('/api/test',{signal:c.signal}),e=>e.name==='AbortError');assert.equal(calls,0);
});
test('R104 retry dates use seconds and invalid hints stay absent',()=>{
  const {parseRetryAfter}=load('src/frontend-kit/transportErrors.ts');
  assert.equal(parseRetryAfter('Wed, 14 Oct 2026 00:00:12 GMT',Date.parse('2026-10-14T00:00:00.001Z')),12);
  for(const value of ['-1','1.5','tomorrow','Infinity','9999999999999999999']) assert.equal(parseRetryAfter(value),undefined);
  assert.equal(parseRetryAfter('0'),0);
});
for(const separator of ['\n','\r','\r\n']) test(`R104 SSE delimiter ${JSON.stringify(separator)} across byte boundaries`,async()=>{
  const source=(`: heartbeat\n\ndata: {"type":"text_delta","text":"\u0627\u0633\u0628"}\n\n`+frame(done)).replaceAll('\n',separator);
  const bytes=encoded(source);const chunks=Array.from(bytes,b=>Uint8Array.of(b));
  const events=await collect(transport.createFetchAiStreamTransport(async()=>streamResponse(chunks))('/api/ai'));
  assert.equal(events[0].text,'\u0627\u0633\u0628');assert.equal(events.at(-1).type,'done');
});
test('R104 SSE supports multiline data and unknown additive events',async()=>{
  const text='data: {"type":"text_delta",\ndata: "text":"first"}\n\n'+frame({type:'future_optional_event'})+frame(done);
  const events=await collect(transport.createFetchAiStreamTransport(async()=>streamResponse([text]))('/api/ai'));
  assert.equal(events.length,2);assert.equal(events[0].text,'first');
});
for(const [label,text,code] of [
  ['invalid JSON','data: {oops}\n\n','ai_stream_invalid_event'],
  ['wrong shape',frame({type:'evidence',evidence:null,entityRefs:[]}),'ai_stream_invalid_event'],
  ['truncated final frame',frame({type:'text_delta',text:'partial'})+'data: {"type":"done"','ai_stream_incomplete'],
  ['empty body','','ai_stream_incomplete'],
  ['no terminal',frame({type:'text_delta',text:'partial'}),'ai_stream_incomplete'],
]) test(`R104 SSE ${label} fails visibly`,async()=>{
  await assert.rejects(collect(transport.createFetchAiStreamTransport(async()=>streamResponse([text]))('/api/ai')),e=>e.code===code);
});
test('R104 SSE error event is a legitimate terminal state',async()=>{
  const event={type:'error',code:'provider_unavailable',message:'Unavailable'};
  assert.deepEqual(await collect(transport.createFetchAiStreamTransport(async()=>streamResponse([frame(event)]))('/api/ai')),[event]);
});
test('R104 SSE malformed UTF-8 fails rather than altering data',async()=>{
  await assert.rejects(collect(transport.createFetchAiStreamTransport(async()=>streamResponse([Uint8Array.of(0xc3,0x28)]))('/api/ai')),e=>e.code==='ai_stream_invalid_encoding');
});
test('R104 SSE oversized unterminated event is bounded',async()=>{
  const {MAX_AI_SSE_EVENT_CHARS}=load('src/frontend-kit/aiStream.ts');
  await assert.rejects(collect(transport.createFetchAiStreamTransport(async()=>streamResponse(['data: '+'x'.repeat(MAX_AI_SSE_EVENT_CHARS)]))('/api/ai')),e=>e.code==='ai_stream_event_too_large');
});
test('R104 leaving AI iteration cancels the response reader',async()=>{
  let cancelled=0;
  const response=new Response(new ReadableStream({start(c){c.enqueue(encoded(frame({type:'text_delta',text:'first'})));},cancel(){cancelled++;}}),{headers:{'content-type':'text/event-stream'}});
  for await(const event of transport.createFetchAiStreamTransport(async()=>response)('/api/ai')){assert.equal(event.type,'text_delta');break;}
  assert.equal(cancelled,1);assert.equal(response.body.locked,false);
});
test('R104 an HTML success response is not mistaken for an AI stream',async()=>{
  await assert.rejects(collect(transport.createFetchAiStreamTransport(async()=>new Response('<html>'))('/api/ai')),e=>e.code==='ai_stream_invalid_content_type');
});
test('R104 AI HTTP refusals preserve server code and backoff',async()=>{
  await assert.rejects(collect(transport.createFetchAiStreamTransport(async()=>new Response('{"error":{"code":"busy","message":"Busy"}}',{status:429,headers:{'retry-after':'8'}}))('/api/ai')),e=>e.code==='busy'&&e.details.retry_after_seconds===8);
});

test('R104 security middleware preserves stricter API privacy',()=>{
  const {withSecurityHeaders}=load('src/security/responseHeaders.ts');
  const env={APP_ENV:'production'};
  const secured=withSecurityHeaders(new Response('{}',{headers:{'referrer-policy':'no-referrer','cache-control':'private, no-store'}}),new Request('https://example.test/api/horses'),env);
  assert.equal(secured.headers.get('referrer-policy'),'no-referrer');assert.equal(secured.headers.get('cache-control'),'private, no-store');
  assert.match(secured.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  const page=withSecurityHeaders(new Response('page'),new Request('https://example.test/'),env);
  assert.equal(page.headers.get('referrer-policy'),'strict-origin-when-cross-origin');
});

test('R104 local run and all retain SELECT/RETURNING rows and write counts',async()=>{
  const {openLocalSqlite}=load('src/db/localSqlite.ts');const db=openLocalSqlite(':memory:');
  await db.exec('CREATE TABLE x(id INTEGER PRIMARY KEY, value TEXT)');
  let result=await db.prepare('SELECT 7 AS value').run();assert.equal(result.results[0].value,7);assert.equal(result.meta.changes,0);
  result=await db.prepare('INSERT INTO x(value) VALUES (?) RETURNING id').bind('a').run();assert.equal(result.results[0].id,1);assert.equal(result.meta.changes,1);
  result=await db.prepare('UPDATE x SET value=? RETURNING id').bind('b').all();assert.equal(result.meta.changes,1);assert.equal(result.results[0].id,1);
  await assert.rejects(db.batch([db.prepare('INSERT INTO x VALUES(2,?)').bind('c'),db.prepare('INSERT INTO x VALUES(1,?)').bind('duplicate')]));
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM x').first('n'),1);
});
function tursoHarness(overrides={}){
  const calls=[];let closed=0;
  const driver={execute:async(sql)=>{calls.push(['execute',sql]);return {rows:[{value:7}],columns:['value'],rowsAffected:0};},
    batch:async(statements,mode)=>{calls.push(['batch',mode,statements]);return [{rows:[{id:4}],columns:['id'],rowsAffected:1,lastInsertRowid:4},{rows:[{__last_row_id:4}],columns:['__last_row_id']}];},
    executeMultiple:async()=>{},close:()=>{closed++;},...overrides};
  const mod=load('src/db/tursoCompat.ts',{'@tursodatabase/serverless/compat':{createClient:()=>driver}});
  return {db:mod.createTursoD1Database('https://synthetic.invalid','not-a-secret'),mod,calls,get closed(){return closed;}};
}
test('R104 Turso run retains returning rows',async()=>{
  const {db}=tursoHarness();const result=await db.prepare('INSERT INTO x(value) VALUES(?) RETURNING id').bind('a').run();assert.equal(result.results[0].id,4);assert.equal(result.meta.changes,1);
});
test('R104 Turso run SELECT never opens a write transaction',async()=>{
  const {db,calls}=tursoHarness();const result=await db.prepare('SELECT 7 AS value').run();assert.equal(result.results[0].value,7);assert.equal(calls.length,1);assert.equal(calls[0][0],'execute');
});
test('R104 Turso preserves real length and numeric column aliases',async()=>{
  const {db}=tursoHarness({execute:async()=>({rows:[{length:8,'0':'zero',name:'n'}],columns:['length','0','name']})});
  assert.deepEqual(await db.prepare('SELECT 1').first(),{length:8,'0':'zero',name:'n'});
});
test('R104 Turso rejects missing read batch results',async()=>{
  const {db}=tursoHarness({batch:async()=>[]});await assert.rejects(db.batch([db.prepare('SELECT 1')]),/result count mismatch/);
});
test('R104 Turso does not assign final rowid to every INSERT',async()=>{
  const {db}=tursoHarness({batch:async()=>[{rows:[],rowsAffected:1},{rows:[],rowsAffected:1},{rows:[{__last_row_id:99}],columns:['__last_row_id']}]});
  const rows=await db.batch([db.prepare('INSERT INTO x DEFAULT VALUES'),db.prepare('INSERT INTO x DEFAULT VALUES')]);
  assert.equal(rows[0].meta.last_row_id,0);assert.equal(rows[1].meta.last_row_id,0);
});
test('R104 Turso cleanup is idempotent',async()=>{
  const h=tursoHarness();await h.mod.closeTursoD1Database(h.db);await h.mod.closeTursoD1Database(h.db);assert.equal(h.closed,1);
});
function postgresHarness(mode='full'){
  const calls=[];
  const unsafe=async(sql)=>{calls.push(['sql',sql]);const rows=sql.startsWith('SELECT')?[{value:7}]:[{id:4}];rows.count=sql.startsWith('SELECT')?8:1;rows.columns=[];return rows;};
  const client={unsafe,begin:async(...args)=>{calls.push(['begin',typeof args[0]==='string'?args[0]:'default']);return args.at(-1)({unsafe});},end:async()=>{calls.push(['end']);}};
  const mod=load('src/db/supabaseCompat.ts',{postgres:()=>client});
  return {db:mod.createSupabaseD1Database('postgres://synthetic.invalid/test',{mode}),calls,mod};
}
test('R104 Postgres run SELECT has no write count',async()=>{
  const {db}=postgresHarness();const row=await db.prepare('SELECT 7 AS value').run();assert.equal(row.meta.changes,0);assert.equal(row.meta.changed_db,false);assert.equal(row.results[0].value,7);
});
test('R104 Postgres all reports actual write metadata',async()=>{
  const {db}=postgresHarness();const row=await db.prepare('UPDATE x SET value=1 RETURNING id').all();assert.equal(row.meta.changes,1);assert.equal(row.results[0].id,4);
});
test('R104 Postgres read batch uses one ordered repeatable-read transaction',async()=>{
  const {db,calls}=postgresHarness('read');await db.batch([db.prepare('SELECT 1'),db.prepare('SELECT 2')]);
  assert.deepEqual(calls.map(c=>c[0]),['begin','sql','sql']);assert.equal(calls[0][1],'isolation level repeatable read read only');
});
test('R104 Postgres read adapter still rejects write batches',async()=>{
  const {db,calls}=postgresHarness('read');await assert.rejects(db.batch([db.prepare('DELETE FROM x')]),/read-only/);assert.equal(calls.length,0);
});

// This is an explicitly synthetic serving generation. Pin its requirements
// through the supported environment configuration instead of depending on
// historical production defaults, which change independently of these tests.
const syntheticAnalytics='sha256:'+'a'.repeat(64);
const healthy={horse_count:17,source_sha256:'b'.repeat(64),import_status:'complete',filter_counts:412,canonical_revision:7,analytics_stale:0,analytics_source_revision:syntheticAnalytics,registry_snapshot_revision:syntheticAnalytics,filter_revision_min:syntheticAnalytics,filter_revision_max:syntheticAnalytics};
function providerHarness(){
  const allocated=[];
  const makeDb=(name,row=healthy)=>({name,probes:0,closed:0,prepare(){return {first:async()=>{this.probes++;if(row instanceof Error)throw row;return row;}};},batch:async()=>[]});
  const factory=(name)=>{const db=makeDb(name,name.includes('bad')?new Error('synthetic driver failure'):healthy);allocated.push(db);return db;};
  const mod=load('src/db/provider.ts',{'./tursoCompat':{createTursoD1Database:url=>factory('turso:'+url),closeTursoD1Database:async db=>{if(db.name?.startsWith('turso:'))db.closed++;}},'./supabaseCompat':{createSupabaseD1Database:url=>factory('supabase:'+url),closeSupabaseD1Database:async db=>{if(db.name?.startsWith('supabase:'))db.closed++;}}});
  const env=(mode)=>({DB:makeDb('d1'),AUTH_DB:makeDb('legacy-auth'),AI_DB:makeDb('legacy-ai'),DB_PROVIDER_MODE:mode,TURSO_DATABASE_URL:'valid',TURSO_AUTH_TOKEN:'synthetic',SUPABASE_DATABASE_URL:'valid',
    DB_FAILOVER_REQUIRED_HORSE_COUNT:String(healthy.horse_count),DB_FAILOVER_REQUIRED_SOURCE_SHA256:healthy.source_sha256,
    DB_FAILOVER_REQUIRED_CANONICAL_REVISION:String(healthy.canonical_revision),DB_FAILOVER_REQUIRED_ANALYTICS_SOURCE_REVISION:syntheticAnalytics,DB_HEALTH_CACHE_MS:'30000'});
  return {mod,env,makeDb,allocated};
}
for(const mode of ['d1_full','turso_full','supabase_full'])for(const [method,url] of [['GET','/api/search'],['GET','/api/auth/me'],['POST','/api/registry'],['GET','/api/ai/status'],['POST','/api/ai/conversations'],['POST','/api/ai/conversations/x/messages']])test(`R104 ${mode} ${method} ${url} has one authority`,async()=>{
  const {mod,env}=providerHarness();const selected=await mod.resolveDatabaseForRequest(new Request('https://example.test'+url,{method}),env(mode));
  assert.equal(selected.DB,selected.AUTH_DB);assert.equal(selected.DB,selected.AI_DB);assert.equal(selected.DB_RUNTIME.failoverUsed,false);assert.equal(selected.DB_RUNTIME.fallback,undefined);
});
test('R104 missing D1 is a typed configuration failure',async()=>{
  const {mod,env}=providerHarness();const e=env('d1_only');delete e.DB;
  await assert.rejects(mod.resolveDatabaseForRequest(new Request('https://example.test/api/search'),e),error=>error.code==='d1_not_configured');
});
test('R104 health cache cannot cross independent database environments',async()=>{
  const {mod,env,makeDb}=providerHarness();const request=new Request('https://example.test/api/search');
  const first=env('d1_with_turso_read_failover');
  assert.equal((await mod.resolveDatabaseForRequest(request,first)).DB_RUNTIME.reason,'primary');
  assert.equal((await mod.resolveDatabaseForRequest(request,first)).DB_RUNTIME.reason,'primary_cached_healthy');
  assert.equal(first.DB.probes,1);
  const second=env('d1_with_turso_read_failover');second.DB=makeDb('broken',new Error('unavailable'));
  const selected=await mod.resolveDatabaseForRequest(request,second);assert.equal(second.DB.probes,1);assert.equal(selected.DB_RUNTIME.failoverUsed,true);assert.equal(selected.DB_RUNTIME.active,'turso');
});
test('R104 changed generation pins invalidate cached health in the same environment',async()=>{
  for(const [key,value] of [
    ['DB_FAILOVER_REQUIRED_HORSE_COUNT',String(healthy.horse_count+1)],
    ['DB_FAILOVER_REQUIRED_SOURCE_SHA256','c'.repeat(64)],
    ['DB_FAILOVER_REQUIRED_CANONICAL_REVISION',String(healthy.canonical_revision+1)],
    ['DB_FAILOVER_REQUIRED_ANALYTICS_SOURCE_REVISION','sha256:'+'c'.repeat(64)],
  ]){
    const {mod,env,allocated}=providerHarness();const e=env('d1_with_turso_read_failover');const request=new Request('https://example.test/api/search');
    assert.equal((await mod.resolveDatabaseForRequest(request,e)).DB_RUNTIME.reason,'primary');
    assert.equal((await mod.resolveDatabaseForRequest(request,e)).DB_RUNTIME.reason,'primary_cached_healthy');
    assert.equal(e.DB.probes,1,key);e[key]=value;
    await assert.rejects(mod.resolveDatabaseForRequest(request,e),error=>error.code==='database_unavailable');
    assert.equal(e.DB.probes,2,key);assert.equal(allocated.length,1,key);assert.equal(allocated[0].closed,1,key);
  }
});
test('R104 rejected health probes release allocated adapters',async()=>{
  const {mod,env,allocated}=providerHarness();const e=env('supabase_with_d1_read_failover');e.SUPABASE_DATABASE_URL='bad';
  const selected=await mod.resolveDatabaseForRequest(new Request('https://example.test/api/search'),e);assert.equal(selected.DB_RUNTIME.active,'d1');assert.equal(selected.DB_RUNTIME.failoverUsed,true);
  assert.equal(allocated.length,1);assert.equal(allocated[0].probes,1);assert.equal(allocated[0].closed,1);assert.equal(e.DB.probes,1);
});
test('R104 fallback failures never return raw driver cause',async()=>{
  const {mod,env}=providerHarness();const e=env('supabase_with_turso_read_failover');e.SUPABASE_DATABASE_URL='bad';e.TURSO_DATABASE_URL='bad';
  await assert.rejects(mod.resolveDatabaseForRequest(new Request('https://example.test/api/search'),e),error=>error.code==='database_unavailable'&&!JSON.stringify(error.details).includes('synthetic driver failure'));
});
test('R104 private reads never fail over',async()=>{
  const {mod,env}=providerHarness();const e=env('supabase_with_d1_read_failover');
  await assert.rejects(mod.resolveDatabaseForRequest(new Request('https://example.test/api/search',{headers:{cookie:'session=synthetic'}}),e),error=>error.code==='snapshot_provider_private_read_denied');
});
test('R104 canonical writes remain disabled in automatic fallback modes',async()=>{
  const {mod,env}=providerHarness();await assert.rejects(mod.resolveDatabaseForRequest(new Request('https://example.test/api/registry',{method:'POST'}),env('d1_with_turso_read_failover')),e=>e.code==='database_failover_mode_read_only');
});

test('R104 server cancellation waits for producer finally before resolving',async()=>{
  const {createAiEventStream}=load('src/ai/application/eventStream.ts');const cleanup=deferred();let aborted=false,cleaned=false,cancelled=false;
  const stream=createAiEventStream(async function*(signal){try{yield {type:'meta'};await new Promise(resolve=>{signal.addEventListener('abort',()=>{aborted=true;resolve();},{once:true});});}finally{await cleanup.promise;cleaned=true;}},()=>({code:'synthetic',message:'synthetic'}));
  const reader=stream.getReader();await reader.read();const promise=reader.cancel('navigate').then(()=>{cancelled=true;});await tick();
  assert.equal(aborted,true);assert.equal(cleaned,false);assert.equal(cancelled,false);cleanup.resolve();await promise;assert.equal(cleaned,true);
});
test('R104 server streams one normalized error and closes',async()=>{
  const {createAiEventStream}=load('src/ai/application/eventStream.ts');const stream=createAiEventStream(async function*(){throw new Error('private');},()=>({code:'safe',message:'Unavailable'}));
  const body=await new Response(stream).text();assert.match(body,/"code":"safe"/);assert.ok(!body.includes('private'));
});
test('R104 already-aborted server stream never starts a producer',async()=>{
  const {createAiEventStream}=load('src/ai/application/eventStream.ts');const c=new AbortController();c.abort();let called=false;
  const stream=createAiEventStream(async function*(){called=true;yield {type:'meta'};},()=>({code:'safe',message:'safe'}),c.signal);await new Response(stream).text();assert.equal(called,false);
});

// Deterministic hooks lifecycle double; not a claim of React DOM verification.
function hookHarness(){
  const slots=[];let cursor=0;const pending=[];
  const equal=(a,b)=>a&&a.length===b.length&&a.every((x,i)=>Object.is(x,b[i]));
  const react={useRef(value){const i=cursor++;return slots[i]??(slots[i]={current:value});},
    useMemo(fn,deps){const i=cursor++;if(!slots[i]||!equal(slots[i].deps,deps))slots[i]={deps:[...deps],value:fn()};return slots[i].value;},
    useState(initial){const i=cursor++;if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial};return [slots[i].value,value=>{slots[i].value=typeof value==='function'?value(slots[i].value):value;}];},
    useEffect(fn,deps){const i=cursor++;if(!slots[i]||!equal(slots[i].deps,deps)){const prior=slots[i];slots[i]={deps:[...deps],cleanup:prior?.cleanup};pending.push(()=>{prior?.cleanup?.();slots[i].cleanup=fn();});}}};
  const {useLatestAsyncValue}=load('src/frontend-kit/useLatestAsyncValue.ts',{react});
  return {render(load,deps,enabled=true){cursor=0;return useLatestAsyncValue(load,deps,enabled);},flush(){while(pending.length)pending.shift()();},dispose(){for(const slot of slots)slot?.cleanup?.();}};
}
test('R104 changed identity is masked before effects and late results are ignored',async()=>{
  const h=hookHarness();const first=deferred(),second=deferred();let firstSignal;
  const load1=signal=>{firstSignal=signal;return first.promise;};
  h.render(load1,[1]);h.flush();first.resolve({horse:1});await tick();assert.equal(h.render(load1,[1]).data.horse,1);
  let state=h.render(()=>second.promise,[2]);assert.equal(state.status,'loading');assert.equal(state.data,null);h.flush();assert.equal(firstSignal.aborted,true);
  second.resolve({horse:2});await tick();state=h.render(()=>second.promise,[2]);assert.equal(state.data.horse,2);h.dispose();
});
test('R104 disabling a legacy resource hides private data immediately',async()=>{
  const h=hookHarness();const loader=async()=>({private:'synthetic'});h.render(loader,['principal']);h.flush();await tick();assert.equal(h.render(loader,['principal']).status,'ready');
  assert.deepEqual(h.render(loader,['principal'],false),{status:'idle',data:null,error:null});h.flush();h.dispose();
});
test('R104 synchronous loader errors are visible without unhandled effects',()=>{
  const h=hookHarness();const loader=()=>{throw new Error('synthetic failure');};h.render(loader,[1]);h.flush();assert.equal(h.render(loader,[1]).error,'synthetic failure');h.dispose();
});
test('R104 unmounted legacy resource cannot publish a late result',async()=>{
  const h=hookHarness();const pending=deferred();let signal;const loader=s=>{signal=s;return pending.promise;};h.render(loader,[1]);h.flush();h.dispose();pending.resolve({old:true});await tick();assert.equal(signal.aborted,true);assert.equal(h.render(loader,[1]).data,null);
});
for(const frontend of ['equidata-elite','fei-classic'])test(`R104 ${frontend} consumes shared loading semantics`,()=>{
  const source=fs.readFileSync(path.join(root,`src/web/frontends/${frontend}/hooks.ts`),'utf8');assert.match(source,/useLatestAsyncValue\(/);assert.ok(!source.includes('previous.data')&&!source.includes('prev.data'));
});

for (const file of ['src/web/heritage/Navigation.tsx', 'src/web/frontends/equidata-elite/Navigation.tsx', 'src/web/frontends/fei-classic/Navigation.tsx']) test(`R104 ${file} owns keyboard-reversible search`, () => {
  const source = fs.readFileSync(path.join(root,file),'utf8');
  assert.match(source,/NAVIGATION_LABELS\.clearSearch\[locale\]/);
  assert.match(source,/event\.key !== "Escape"/);
  // R112: the drawer's open state determines whether its visible trigger
  // receives focus. The previous DOM-size probe no longer owns that decision.
  assert.match(source,/if \(mobileOpen\)[\s\S]*?setMobileOpen\(false\);[\s\S]*?toggleRef\.current\?\.focus\(\)/);
  assert.match(source,/aria-expanded=\{mobileOpen\}/);
  assert.match(source,/ref=\{toggleRef\}/);
  assert.match(source,/disabled=\{!query\}/);
});
test('R104 all maintained skins retain local navigation styling', () => {
  for (const file of ['src/web/heritage/Navigation.css','src/web/frontends/equidata-elite/Navigation.css','src/web/frontends/fei-classic/Navigation.css','src/web/frontends/retro-astra/transplant/styles/hierarchical-navigation.css','standalone-frontends/classic-v1.4/public/ui/hierarchical-navigation.css']) {
    const source=fs.readFileSync(path.join(root,file),'utf8'); assert.match(source,/search-controls/); assert.match(source,/:disabled/);
  }
});

for (const value of [undefined, null, 0, -1, NaN, Infinity, 1.2, 'bad', '', true, Number.MAX_SAFE_INTEGER + 1]) test(`R104 production limiter rejects invalid counter ${String(value)}`, async () => {
  const {enforceRateLimit}=load('src/security/rateLimit.ts');
  const binding={limit:async()=>({success:true})};
  const env={APP_ENV:'production',AUTH_RATE_LIMITER:binding,WRITE_RATE_LIMITER:binding,EXPENSIVE_RATE_LIMITER:binding,
    DB:{prepare:()=>({bind:()=>({first:async()=>value===undefined?null:{count:value}})})}};
  await assert.rejects(()=>enforceRateLimit(new Request('https://test/api/auth/login'),env,'auth'),error=>error.code==='rate_limiter_unavailable'&&error.status===503);
});
for (const value of [1, '1', 1n, 10]) test(`R104 production limiter accepts valid count ${String(value)} (${typeof value})`, async () => {
  const {enforceRateLimit}=load('src/security/rateLimit.ts');
  const env={APP_ENV:'production',AUTH_RATE_LIMITER:{limit:async()=>({success:true})},DB:{prepare:()=>({bind:()=>({first:async()=>({count:value})})})}};
  await enforceRateLimit(new Request('https://test/api/auth/login'),env,'auth');
});
test('R104 production limiter still enforces over-budget counts', async () => {
  const {enforceRateLimit}=load('src/security/rateLimit.ts');
  const env={APP_ENV:'production',AUTH_RATE_LIMITER:{limit:async()=>({success:true})},DB:{prepare:()=>({bind:()=>({first:async()=>({count:11})})})}};
  await assert.rejects(()=>enforceRateLimit(new Request('https://test/api/auth/login'),env,'auth'),error=>error.code==='rate_limited'&&error.status===429);
});
for (const method of ['all','first']) test(`R104 Turso ${method} writes retain FK-enabled transaction setup`, async () => {
  const calls=[];
  const {createTursoD1Database}=load('src/db/tursoCompat.ts',{'@tursodatabase/serverless/compat':{createClient:()=>({
    execute:async sql=>{calls.push(sql);return {};},
    batch:async statements=>{calls.push(statements);return [{columns:['id'],rows:[[7]],rowsAffected:1,lastInsertRowid:7},{columns:['__last_row_id'],rows:[[7]]}];},close(){}
  })}});
  const db=createTursoD1Database('libsql://test','test-only');
  const result=await db.prepare('INSERT INTO items(id) VALUES(7) RETURNING id')[method]();
  assert.equal(calls[0],'PRAGMA foreign_keys=ON'); assert.equal(calls[1].length,2);
  assert.deepEqual(method==='first'?result:result.results[0],{id:7});
});

test('R104 Turso array rows preserve length and reordered numeric aliases', async () => {
  const {db}=tursoHarness({execute:async()=>({rows:[[8,'zero','n']],columns:['length','0','name']})});
  assert.deepEqual(await db.prepare('SELECT 1').first(),{length:8,'0':'zero',name:'n'});
});

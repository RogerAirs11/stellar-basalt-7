'use strict';
// Explicit driver/HTTP doubles test the real source boundaries; not engine certification.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./lib/r104-isolated-module.cjs');
const collect = async iterable => { const items=[]; for await (const value of iterable) items.push(value); return items; };
const response = text => new Response(text);
const { parseSse } = load('src/ai/providers/sse.ts');
for (const ending of ['\n','\r','\r\n']) test(`R109 SSE: legal line ending ${JSON.stringify(ending)}`, async()=>{
 assert.deepEqual(await collect(parseSse(response(`event: message${ending}data:  preserve${ending}data: second${ending}${ending}`))),[{event:'message',data:' preserve\nsecond'}]);
});
test('R109 SSE: split CRLF and UTF-8 survive arbitrary byte chunks',async()=>{
 const text='data: '+String.fromCodePoint(0x1f40e)+'\r\n\r\n';const bytes=new TextEncoder().encode(text);
 const stream=new ReadableStream({start(c){for(const b of bytes)c.enqueue(new Uint8Array([b]));c.close();}});
 assert.equal((await collect(parseSse(new Response(stream))))[0].data,String.fromCodePoint(0x1f40e));
});
for(const text of ['data: partial','data: partial\n'])test(`R109 SSE: reject unterminated frame ${JSON.stringify(text)}`,async()=>assert.rejects(()=>collect(parseSse(response(text)))));
test('R109 SSE: reject malformed UTF-8 rather than replacing evidence',async()=>{
 await assert.rejects(()=>collect(parseSse(new Response(new Uint8Array([100,97,116,97,58,32,255,10,10])))));
});
test('R109 SSE: size ceilings stop an unbounded event',async()=>{
 await assert.rejects(()=>collect(parseSse(response('data: '+ 'x'.repeat(100)),{maxEventCharacters:32,maxStreamCharacters:64})),/size limit/);
});
test('R109 SSE: total ceiling applies across individually valid frames',async()=>{
 await assert.rejects(()=>collect(parseSse(response('data: x\n\n'.repeat(20)),{maxEventCharacters:32,maxStreamCharacters:64})),/size limit/);
});
test('R109 SSE: early terminal consumer cancels the transport',async()=>{
 let cancelled=false;const stream=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));},cancel(){cancelled=true;}});
 for await(const event of parseSse(new Response(stream))){assert.equal(event.data,'[DONE]');break;}
 assert.equal(cancelled,true);
});
const retry=load('src/ai/runtime/retryPolicy.ts');
for(const [requested,maximum,fallback,expected] of [[60000,3000,250,null],[1000,3000,250,1000],[undefined,3000,250,250],[NaN,3000,250,250],[0,3000,250,0],[1,-1,250,null]])test(`R109 retry: preserve provider minimum ${requested}/${maximum}`,()=>assert.equal(retry.boundedProviderRetryDelay(requested,maximum,fallback),expected));
test('R109 retry: normal completion unregisters abort listener',async()=>{
 const ac=new AbortController();let count=0;const add=ac.signal.addEventListener.bind(ac.signal),remove=ac.signal.removeEventListener.bind(ac.signal);
 ac.signal.addEventListener=(...args)=>{count++;return add(...args);};ac.signal.removeEventListener=(...args)=>{count--;return remove(...args);};
 await retry.abortableRetryDelay(ac.signal,1);assert.equal(count,0);
});
test('R109 retry: pre-aborted and in-flight waits stop promptly',async()=>{
 const ac=new AbortController();ac.abort();await assert.rejects(()=>retry.abortableRetryDelay(ac.signal,1000),e=>e.name==='AbortError');
 const next=new AbortController();const work=retry.abortableRetryDelay(next.signal,60000);next.abort();await assert.rejects(()=>work,e=>e.name==='AbortError');
});
test('R109 config: empty numeric environment values retain conservative defaults',()=>{
 const {loadAiConfig}=load('src/ai/runtime/config.ts');const config=loadAiConfig({AI_DEEPSEEK_CACHE_MISS_PER_MILLION_USD:'',AI_DEEPSEEK_OUTPUT_PER_MILLION_USD:' ',AI_CONTEXT_SAFETY_FRACTION:''});
 assert.equal(config.deepseek.price.cacheMissInputPerMillionUsd,.3);assert.equal(config.deepseek.price.outputPerMillionUsd,1.2);assert.equal(config.contextSafetyFraction,.9);
});
function pg(mode='full'){
 const calls=[];const tx={async unsafe(sql,values){calls.push(['tx',sql,values]);return [{answer:1}];}};
 const client={async unsafe(){throw new Error('reservation escaped transaction');},async begin(options,work){calls.push(['begin',options]);try{const value=await work(tx);calls.push(['commit']);return value;}catch(error){calls.push(['rollback']);throw error;}},async end(){calls.push(['end']);}};
 const {createSupabaseD1Database}=load('src/db/supabaseCompat.ts',{postgres:()=>client});
 return {db:createSupabaseD1Database('postgres://fixture.invalid/db',{mode}),calls};
}
test('R109 PostgreSQL: AI admission takes a separate transaction lock before its fresh statement',async()=>{
 const {db,calls}=pg();const answer=await db.__horseDbWithAiReservation(async transaction=>{
  assert.equal(transaction.__horseDbWithAiReservation,undefined);return transaction.prepare('SELECT 1 AS answer').first();
 });
 assert.equal(answer.answer,1);assert.deepEqual(calls.map(c=>c[0]),['begin','tx','tx','commit']);
 assert.equal(calls[0][1],'isolation level read committed');assert.match(calls[1][1],/pg_advisory_xact_lock/);assert.equal(calls[2][1],'SELECT 1 AS answer');
});
test('R109 PostgreSQL: admission exceptions roll back and never close parent connection',async()=>{
 const {db,calls}=pg();await assert.rejects(()=>db.__horseDbWithAiReservation(async tx=>{await tx.__horseDbClose();}),/parent database/);
 assert.equal(calls.at(-1)[0],'rollback');assert.equal(calls.some(c=>c[0]==='end'),false);
});
test('R109 PostgreSQL: public read adapter cannot acquire write authority',async()=>{
 const {db,calls}=pg('read');await assert.rejects(()=>db.__horseDbWithAiReservation(async()=>1),/writable/);assert.equal(calls.length,0);
});
test('R109 AI authority: optional lock capability is actually used',async()=>{
 const {withAiReservation}=load('src/db/aiReservation.ts');const tx={};let invoked=0;
 const db={async __horseDbWithAiReservation(work){invoked++;return work(tx);}};
 assert.equal(await withAiReservation(db,async value=>value),tx);assert.equal(invoked,1);
});
const offline=load('src/ai/providers/offline/client.ts');
const offlineInput=text=>({model:'offline-sandbox',systemInstruction:'',conversation:[{role:'user',text}],latestUserText:text,tools:[],thinkingLevel:'off',maxOutputTokens:1024});
test('R109 offline science: no universal safe COI thresholds or measured-DNA claims',async()=>{
 const output=await new offline.OfflineProvider().createTurn(offlineInput('Explain COI'));
 assert.match(output.text,/founder assumptions/);assert.match(output.text,/not universal safe/);assert.doesNotMatch(output.text,/essentially unrelated|keeping risk moderate|maximum new genetic variation/);
});
test('R109 offline science: AVK is distinct from completeness',async()=>{
 const output=await new offline.OfflineProvider().createTurn(offlineInput('Explain AVK'));
 assert.match(output.text,/Report completeness separately/);assert.match(output.text,/62 positions/);
});
test('R109 offline science: Persian domain questions reach the actual localized explanation',async()=>{
 const output=await new offline.OfflineProvider().createTurn(offlineInput('\u0647\u0645\u200c\u062e\u0648\u0646\u06cc'));
 assert.match(output.text,/COI/);assert.match(output.text,/DNA/);
});
test('R109 recovery copy: unknown, expiry and clear never promise absence of a duplicate',()=>{
 const {mutationIntentCopy}=load('src/frontend-kit/domain/mutationIntentCopy.ts');
 for(const key of ['expired','no_receipt_on_server','legacy_receipt_unresolved','dispatch_unknown','unknown','clearWarning']){
  assert.doesNotMatch(mutationIntentCopy(key,'en'),/no duplicate was created|never sent/i);
  assert.match(mutationIntentCopy(key,'fa'),/[\u0600-\u06ff]/);
 }
 assert.match(mutationIntentCopy('clearWarning','en'),/does not cancel/);
});

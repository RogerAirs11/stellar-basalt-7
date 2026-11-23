'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {load}=require('./lib/r104-isolated-module.cjs');
const accounting=()=>load('src/content/providerAccounting.ts');
function database({deny=false,cost=.1}={}){
 const calls=[];
 return {calls,prepare(sql){calls.push(sql);return{bind(){return this;},async run(){if(deny)throw new Error('D1_ERROR: daily row write limit exceeded');return{success:true,meta:{changes:1}};},async first(){return sql.includes('cost')?{cost}:{count:1,tokens:512};}};}};
}
const geminiEnv=db=>({DB:db,AI_GEMINI_38_FLASH_RPM_LIMIT:"5",AI_GEMINI_38_FLASH_INPUT_TPM_LIMIT:"100000",AI_GEMINI_38_FLASH_RPD_LIMIT:"20"});
const init=body=>({method:'POST',body:JSON.stringify(body)});
for(const [label,url,body] of [
 ['interactions','https://generativelanguage.googleapis.com/v1beta/interactions',{model:'gemini-3.8-flash',input:'draft'}],
 ['classic','https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',{contents:[]}],
 ['vertex','https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-2.5-flash:generateContent',{contents:[]}],
])test(`R109 editorial Gemini: ${label} reserves before every provider attempt`,async()=>{
 const db=database();let calls=0;const send=accounting().accountedGeminiEditorialFetch(geminiEnv(db),async()=>{assert.ok(db.calls.some(q=>q.includes('INSERT INTO ai_request_ledger')));calls++;return Response.json({ok:true});});
 await send(url,init(body));await send(url,init(body));assert.equal(calls,2);assert.equal(db.calls.filter(q=>q.includes('INSERT INTO ai_request_ledger')).length,2);
});
test('R109 editorial Gemini: unavailable durable usage storage prevents all network calls',async()=>{
 let calls=0;const send=accounting().accountedGeminiEditorialFetch(geminiEnv(database({deny:true})),async()=>{calls++;return Response.json({});});
 await assert.rejects(()=>send('https://example.test/interactions',init({model:'gemini-3.8-flash'})),e=>e.code==='gemini_reservation_unavailable');assert.equal(calls,0);
});
for(const body of [undefined,'not json','x'.repeat(262145),JSON.stringify({model:'unconfigured'})])test(`R109 editorial Gemini: unaccountable request is blocked (${body?.length??'absent'})`,async()=>{
 let calls=0;const send=accounting().accountedGeminiEditorialFetch({DB:database()},async()=>{calls++;return Response.json({});});
 await assert.rejects(()=>send('https://example.test/interactions',{method:'POST',body}));assert.equal(calls,0);
});
const input={model:'deepseek-flash',systemInstruction:'Return JSON only',conversation:[{role:'user',text:'Synthetic horse overview'}],latestUserText:'Synthetic horse overview',tools:[],thinkingLevel:'off',responseFormat:'json_object',toolChoice:'none',maxOutputTokens:1024};
function fakeFetch(t,fn){const original=globalThis.fetch;globalThis.fetch=fn;t.after(()=>globalThis.fetch=original);}
test('R109 paid editorial: no paid HTTP after reservation storage fails',async t=>{
 let calls=0;fakeFetch(t,async()=>{calls++;return Response.json({});});
 await assert.rejects(()=>accounting().runPaidEditorialTurn({DB:database({deny:true}),DEEPSEEK_API_KEY:'test-key'},input),e=>e.code==='paid_reservation_unavailable');assert.equal(calls,0);
});
test('R109 paid editorial: daily budget refusal cannot send a paid request',async t=>{
 let calls=0;fakeFetch(t,async()=>{calls++;return Response.json({});});
 await assert.rejects(()=>accounting().runPaidEditorialTurn({DB:database({cost:5}),DEEPSEEK_API_KEY:'test-key'},input),e=>e.status===429);assert.equal(calls,0);
});
test('R109 paid editorial: canonical client sends JSON mode, reserves, validates and settles real usage fields',async t=>{
 const db=database();let calls=0;fakeFetch(t,async(url,init)=>{
  assert.ok(db.calls.some(q=>q.includes('INSERT INTO ai_cost_reservations')));const body=JSON.parse(init.body);assert.deepEqual(body.response_format,{type:'json_object'});assert.deepEqual(body.thinking,{type:'disabled'});calls++;
  return Response.json({choices:[{message:{content:'{"title":"Synthetic"}'},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120,prompt_tokens_details:{cached_tokens:40}}});
 });
 const output=await accounting().runPaidEditorialTurn({DB:db,DEEPSEEK_API_KEY:'test-key'},input);assert.equal(output.usage.cacheMissTokens,60);assert.equal(calls,1);assert.ok(db.calls.some(q=>q.includes('UPDATE ai_cost_reservations')));
});
test('R109 paid editorial: malformed usage retains reservation and never auto-retries',async t=>{
 const db=database();let calls=0;fakeFetch(t,async()=>{calls++;return Response.json({choices:[{message:{content:'{}'},finish_reason:'stop'}]});});
 await assert.rejects(()=>accounting().runPaidEditorialTurn({DB:db,DEEPSEEK_API_KEY:'test-key'},input));assert.equal(calls,1);assert.equal(db.calls.some(q=>q.includes('UPDATE ai_cost_reservations')),false);
});
test('R109 editorial errors: do not expose driver URLs or provider details',()=>{
 const {contentAccountingError}=accounting();assert.equal(JSON.stringify(contentAccountingError(new Error('secret connection string'))).includes('secret'),false);
});

test('R109 editorial model: missing 3.8 quota cannot borrow chat 3.5 limits',async()=>{
 let calls=0;const send=accounting().accountedGeminiEditorialFetch({DB:database()},async()=>{calls++;return Response.json({});});
 await assert.rejects(()=>send('https://example.test/interactions',init({model:'gemini-3.8-flash'})),e=>e.code==='gemini_quota_unconfigured');assert.equal(calls,0);
});

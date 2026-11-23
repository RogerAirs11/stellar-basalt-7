import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const common={
  systemInstruction:"Horse DB policy",conversation:[],latestUserText:"Find horse",tools:[{name:"registry_research",description:"Read registry",parameters:{type:"object",properties:{q:{type:"string"}},required:["q"]}}],thinkingLevel:"low",maxOutputTokens:4096,toolChoice:"validated",toolResults:undefined,providerState:null,previousInteractionId:null,userId:"anon-test",
};
const root=process.cwd(), out=mkdtempSync(join(tmpdir(),"horse-r31-ai-provider-"));
try{
  execFileSync(process.platform==="win32"?"tsc.cmd":"tsc",["--module","commonjs","--moduleResolution","node","--target","es2022","--lib","es2023,dom","--skipLibCheck","--outDir",out,"src/ai/core/types.ts","src/ai/core/provider.ts","src/ai/core/errors.ts","src/ai/core/modelCatalog.ts","src/ai/providers/sse.ts","src/ai/providers/gemini/client.ts","src/ai/providers/deepseek/client.ts"],{cwd:root,stdio:"pipe"});
  const require=createRequire(import.meta.url),{GeminiProvider}=require(join(out,"providers/gemini/client.js")),{DeepSeekProvider}=require(join(out,"providers/deepseek/client.js"));
  await testGemini(GeminiProvider); await testGeminiStreaming(GeminiProvider); await testGeminiRateLimit(GeminiProvider); await testDeepSeek(DeepSeekProvider); await testDeepSeekStreaming(DeepSeekProvider);
  console.log("R31 provider protocol harness passed: Gemini Interactions state/call pairing + fragmented streaming/countTokens and DeepSeek reasoning/cache/vision + fragmented streaming are coherent.");
}finally{rmSync(out,{recursive:true,force:true})}

async function testGemini(GeminiProvider){
  const bodies=[];let n=0;
  const mock=async(url,init)=>{bodies.push({url:String(url),body:JSON.parse(init.body)});if(String(url).includes(":countTokens"))return json({totalTokens:321});n++;if(n===1)return json({id:"int_1",steps:[{type:"function_call",id:"call_1",name:"registry_research",arguments:{q:"CHABOCK"},signature:"signed-call-1"}],usage:{total_input_tokens:120,total_output_tokens:10,total_thought_tokens:5,total_cached_tokens:0,total_tool_use_tokens:12,total_tokens:147},status:"requires_action"});return json({id:"int_2",steps:[{type:"model_output",content:[{type:"text",text:"Found it."}]}],usage:{total_input_tokens:250,total_output_tokens:4,total_thought_tokens:0,total_cached_tokens:100,total_tool_use_tokens:0,total_tokens:254},status:"completed"})};
  const p=new GeminiProvider("test-key",{fetchImpl:mock});
  const first=await p.createTurn({...common,model:"gemini-3.5-flash-lite",latestAttachments:[{kind:"image",url:"https://example.test/horse.webp",mimeType:"image/webp"}]});
  assert.equal(first.toolCalls[0].id,"call_1");assert.equal(first.toolCalls[0].name,"registry_research");
  const firstBody=bodies[0].body;assert.equal(firstBody.model,"gemini-3.5-flash-lite");assert.equal(firstBody.generation_config.thinking_level,"low");assert.equal(firstBody.generation_config.tool_choice,"validated");
  const firstInput=Array.isArray(firstBody.input)?firstBody.input[0]:firstBody.input;assert.equal(firstInput.type,"user_input");assert.equal(firstInput.content.some(part=>part.type==="image"&&part.uri==="https://example.test/horse.webp"),true);
  const second=await p.continueTurn({...common,model:"gemini-3.5-flash-lite",previousInteractionId:"int_1",providerState:first.providerState,toolResults:[{callId:"call_1",name:"registry_research",output:{name:"CHABOCK",id:1}}]});
  const secondBody=bodies[1].body;assert.equal(secondBody.previous_interaction_id,"int_1");assert.deepEqual(secondBody.input,[{type:"function_result",name:"registry_research",call_id:"call_1",result:'{"name":"CHABOCK","id":1}'}]);assert.equal(second.text,"Found it.");assert.equal(second.usage.cachedTokens,100);
  // Simulate server-side interaction expiry: no previous_interaction_id, but the
  // opaque provider state must replay exact native steps/signatures, not flatten
  // them into a transcript.
  await p.createTurn({...common,model:"gemini-3.5-flash-lite",providerState:second.providerState,previousInteractionId:null,latestUserText:"Show it again"});
  const replayBody=bodies[2].body;assert.equal(replayBody.previous_interaction_id,undefined);assert.equal(replayBody.input.some(x=>x.type==="function_call"&&x.id==="call_1"&&x.signature==="signed-call-1"),true,"exact Gemini function-call signature must survive stateless replay");assert.equal(replayBody.input.some(x=>x.type==="function_result"&&x.call_id==="call_1"),true);assert.equal(replayBody.input.at(-1).type,"user_input");
  const compacted=await p.createTurn({...common,model:"gemini-3.5-flash-lite",providerState:second.providerState,previousInteractionId:null,latestUserText:"Budgeted replay",providerReplayTokenBudget:1});
  assert.equal(Array.isArray(compacted.providerState?.replaySteps),false,"opaque Gemini replay must be dropped when its token-aware retention budget is exhausted");
  assert.ok(Number(compacted.providerState?.replayEstimatedTokens??0)>1,"provider state should retain replay token telemetry even after opaque steps are dropped");
  const counted=await p.countTokens({model:"gemini-3.5-flash-lite",systemInstruction:"policy",conversationText:"hello",tools:common.tools});assert.equal(counted,321);const countBody=bodies.at(-1).body;assert.equal(countBody.generateContentRequest.system_instruction.parts[0].text,"policy");assert.equal(countBody.generateContentRequest.tools[0].function_declarations[0].name,"registry_research");
}
async function testGeminiRateLimit(GeminiProvider){
  const p=new GeminiProvider("test-key",{fetchImpl:async()=>new Response(JSON.stringify({error:{message:"Rate limit exceeded"}}),{status:429,headers:{"content-type":"application/json","retry-after":"2"}})});
  await assert.rejects(()=>p.createTurn({...common,model:"gemini-3.5-flash-lite"}),error=>{assert.equal(error.category,"rate_limit");assert.equal(error.code,"rate_or_quota");assert.equal(error.retryable,true);assert.equal(error.details?.retryAfterMs,2000);return true});
  const daily=new GeminiProvider("test-key",{fetchImpl:async()=>new Response("Requests per day quota exceeded",{status:429})});
  await assert.rejects(()=>daily.createTurn({...common,model:"gemini-3.5-flash-lite"}),error=>{assert.equal(error.category,"quota");assert.equal(error.code,"gemini_provider_daily_quota");return true});
}
async function testGeminiStreaming(GeminiProvider){
  const events=[
    {event:"interaction.created",data:{type:"interaction.created",interaction:{id:"int_stream"}}},
    {event:"step.delta",data:{type:"step.delta",step_id:"call_stream",delta:{type:"arguments_delta",name:"registry_research",arguments_delta:'{"q":"CHA'} }},
    {event:"step.delta",data:{type:"step.delta",step_id:"call_stream",delta:{type:"arguments_delta",arguments_delta:'BOCK"}'}}},
    {event:"step.stop",data:{type:"step.stop",step:{type:"function_call",id:"call_stream",name:"registry_research",arguments:{q:"CHABOCK"}}}},
    {event:"interaction.completed",data:{type:"interaction.completed",interaction:{id:"int_stream",status:"requires_action",usage:{total_input_tokens:80,total_output_tokens:10,total_thought_tokens:2,total_cached_tokens:0,total_tool_use_tokens:5,total_tokens:97}}}},
  ];
  const p=new GeminiProvider("test-key",{fetchImpl:async()=>sse(events)}); const seen=[]; for await(const e of p.streamTurn({...common,model:"gemini-3.5-flash-lite"}))seen.push(e);
  const call=seen.find(e=>e.type==="tool_call")?.call;assert.equal(call.id,"call_stream");assert.deepEqual(call.arguments,{q:"CHABOCK"});assert.equal(seen.filter(e=>e.type==="tool_call_delta").length,2);assert.equal(seen.at(-1).type,"done");
}
async function testDeepSeek(DeepSeekProvider){
  const bodies=[];let n=0;const mock=async(_url,init)=>{bodies.push(JSON.parse(init.body));n++;if(n===1)return json({choices:[{message:{content:null,reasoning_content:"private-reasoning",tool_calls:[{id:"ds_call_1",type:"function",function:{name:"registry_research",arguments:'{"q":"CHABOCK"'}}]},finish_reason:"tool_calls"}],usage:{prompt_tokens:300,completion_tokens:40,total_tokens:340,prompt_tokens_details:{prompt_cache_hit_tokens:200,prompt_cache_miss_tokens:100},completion_tokens_details:{reasoning_tokens:35}}});return json({choices:[{message:{content:"Found it.",reasoning_content:"private-continued"},finish_reason:"stop"}],usage:{prompt_tokens:420,completion_tokens:20,total_tokens:440,prompt_tokens_details:{prompt_cache_hit_tokens:390,prompt_cache_miss_tokens:30},completion_tokens_details:{reasoning_tokens:15}}})};
  const p=new DeepSeekProvider("test-key",true,mock);const first=await p.createTurn({...common,model:"deepseek-flash",latestAttachments:[{kind:"image",url:"https://example.test/horse.webp"}]});
  assert.equal(bodies[0].thinking.type,"enabled");assert.equal(bodies[0].reasoning_effort,"low");assert.equal(bodies[0].messages.at(-1).content[1].type,"image_url");assert.equal(first.usage.cacheHitTokens,200);assert.equal(first.usage.cacheMissTokens,100);assert.match(JSON.stringify(first.providerState),/private-reasoning/);
  const second=await p.continueTurn({...common,model:"deepseek-flash",providerState:first.providerState,toolResults:[{callId:"ds_call_1",name:"registry_research",output:{id:1}}]});const assistant=bodies[1].messages.find(m=>m.role==="assistant"&&m.reasoning_content);assert.equal(assistant.reasoning_content,"private-reasoning");assert.equal(bodies[1].messages.at(-1).tool_call_id,"ds_call_1");assert.equal(second.text,"Found it.");assert.equal(second.usage.cacheHitTokens,390);
  assert.equal(bodies[1].messages[0].content,bodies[0].messages[0].content,"DeepSeek continuation must keep the cache-critical root system prefix byte-stable");
}
async function testDeepSeekStreaming(DeepSeekProvider){
  const chunks=[
    {choices:[{delta:{reasoning_content:"private-"},finish_reason:null}]},
    {choices:[{delta:{reasoning_content:"reasoning",tool_calls:[{index:0,id:"call_s",function:{name:"registry_research",arguments:'{"q":"CHA'}}]},finish_reason:null}]},
    {choices:[{delta:{tool_calls:[{index:0,function:{arguments:'BOCK"}'}}]},finish_reason:"tool_calls"}],usage:{prompt_tokens:100,completion_tokens:15,total_tokens:115,prompt_tokens_details:{prompt_cache_hit_tokens:80,prompt_cache_miss_tokens:20},completion_tokens_details:{reasoning_tokens:10}}},
  ];
  const p=new DeepSeekProvider("test-key",false,async()=>sse(chunks.map(data=>({data}))));const seen=[];for await(const e of p.streamTurn({...common,model:"deepseek-flash"}))seen.push(e);const call=seen.find(e=>e.type==="tool_call")?.call;assert.deepEqual(call.arguments,{q:"CHABOCK"});assert.equal(seen.some(e=>e.type==="text_delta"&&String(e.text).includes("private")),false,"hidden reasoning must never stream as visible text");const done=seen.at(-1).output;assert.match(JSON.stringify(done.providerState),/private-reasoning/);assert.equal(done.usage.cacheHitTokens,80);
}
function json(value){return new Response(JSON.stringify(value),{status:200,headers:{"content-type":"application/json"}})}
function sse(events){const text=events.map(({event,data})=>`${event?`event: ${event}\n`:""}data: ${JSON.stringify(data)}\n\n`).join("")+"data: [DONE]\n\n";return new Response(text,{status:200,headers:{"content-type":"text/event-stream"}})}

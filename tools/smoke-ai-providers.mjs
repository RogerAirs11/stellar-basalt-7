import assert from "node:assert/strict";
import { compileTsRuntime } from "./ts-runtime-loader.mjs";

const runGemini=process.env.AI_SMOKE_GEMINI==="1";
const runDeepSeek=process.env.AI_SMOKE_DEEPSEEK==="1";
const runVision=process.env.AI_SMOKE_DEEPSEEK_VISION==="1";
if(!runGemini&&!runDeepSeek&&!runVision){console.log("R31 AI live smoke: NOT_RUN (set AI_SMOKE_GEMINI=1 and/or AI_SMOKE_DEEPSEEK=1; vision additionally requires AI_SMOKE_DEEPSEEK_VISION=1). Zero provider requests were made.");process.exit(0)}

const tool={name:"registry_research",description:"Test-only read tool. For this smoke, call it with {operations:[{op:'search',query:'CHABOCK',limit:1}]}",parameters:{type:"object",properties:{operations:{type:"array",items:{type:"object",properties:{op:{const:"search"},query:{type:"string"},limit:{type:"integer"}},required:["op","query"]}}},required:["operations"]}};
const base={systemInstruction:"This is an API protocol smoke test. Do not invent registry facts. You must call registry_research exactly once before answering.",conversation:[],latestUserText:"Use registry_research to find CHABOCK, then wait for the tool result before answering.",tools:[tool],thinkingLevel:"low",maxOutputTokens:1024,toolChoice:"validated",userId:"r31-smoke"};
const rt=compileTsRuntime(["src/ai/providers/gemini/client.ts","src/ai/providers/deepseek/client.ts","src/ai/providers/sse.ts","src/ai/core/types.ts","src/ai/core/provider.ts","src/ai/core/errors.ts","src/ai/core/modelCatalog.ts"]);
try{
 const {GeminiProvider}=rt.load("src/ai/providers/gemini/client.ts");
 const {DeepSeekProvider}=rt.load("src/ai/providers/deepseek/client.ts");
 if(runGemini)await smokeGemini(GeminiProvider);
 if(runDeepSeek)await smokeDeepSeek(DeepSeekProvider,false);
 if(runVision)await smokeDeepSeek(DeepSeekProvider,true);
 console.log("R31 AI live provider smoke completed successfully.");
}finally{rt.cleanup()}

async function smokeGemini(GeminiProvider){
 const key=required("GEMINI_API_KEY");const p=new GeminiProvider(key);
 const first=await p.createTurn({...base,model:process.env.AI_SMOKE_GEMINI_MODEL||"gemini-3.5-flash-lite"});
 assert.equal(first.toolCalls.length,1,"Gemini smoke did not produce exactly one tool call");
 const call=first.toolCalls[0]; assert.equal(call.name,"registry_research");
 const second=await p.continueTurn({...base,model:process.env.AI_SMOKE_GEMINI_MODEL||"gemini-3.5-flash-lite",previousInteractionId:first.interactionId,toolResults:[{callId:call.id,name:call.name,output:{ok:true,items:[{id:1,name_latin:"CHABOCK"}]}}]});
 assert.match(second.text,/CHABOCK|1/i); console.log(`Gemini smoke PASS model=${second.model} input=${second.usage.inputTokens} output=${second.usage.outputTokens}`);
}
async function smokeDeepSeek(DeepSeekProvider,vision){
 const key=required("DEEPSEEK_API_KEY");const p=new DeepSeekProvider(key,vision);
 const image=vision?required("AI_SMOKE_IMAGE_URL"):null;
 const first=await p.createTurn({...base,model:"deepseek-flash",thinkingLevel:"off",latestUserText:vision?"Inspect the attached image only as context, then use registry_research to look up CHABOCK before answering.":base.latestUserText,latestAttachments:vision?[{kind:"image",url:image}]:undefined});
 assert.equal(first.toolCalls.length,1,`DeepSeek${vision?" vision":""} smoke did not produce exactly one tool call`);
 const call=first.toolCalls[0]; assert.equal(call.name,"registry_research");
 const second=await p.continueTurn({...base,model:"deepseek-flash",thinkingLevel:"off",providerState:first.providerState,toolResults:[{callId:call.id,name:call.name,output:{ok:true,items:[{id:1,name_latin:"CHABOCK"}]}}]});
 assert.match(second.text,/CHABOCK|1/i); console.log(`DeepSeek${vision?" vision":""} smoke PASS input=${second.usage.inputTokens} output=${second.usage.outputTokens} cacheHit=${second.usage.cacheHitTokens??0} cacheMiss=${second.usage.cacheMissTokens??0}`);
}
function required(name){const v=process.env[name]?.trim();if(!v)throw new Error(`${name} is required for the selected live smoke`);return v}

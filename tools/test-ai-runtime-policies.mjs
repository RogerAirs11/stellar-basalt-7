import assert from "node:assert/strict";
import { compileTsRuntime } from "./ts-runtime-loader.mjs";

const rt=compileTsRuntime(["src/ai/runtime/contextGovernor.ts","src/ai/runtime/costGovernor.ts","src/ai/core/types.ts"]);
try{
  const ctx=rt.load("src/ai/runtime/contextGovernor.ts");
  const cost=rt.load("src/ai/runtime/costGovernor.ts");
  const messages=Array.from({length:100},(_,i)=>({id:String(i),role:i%2?"assistant":"user",text:`turn ${i} concise registry discussion`,createdAt:new Date(2026,0,1,0,0,i).toISOString()}));
  const spacious=ctx.buildWorkingConversation(messages,100_000);
  assert.equal(spacious.compacted,false,"useful long conversation must remain intact when it fits");
  assert.equal(spacious.turns.length,100);
  const tight=ctx.buildWorkingConversation(messages,500);
  assert.equal(tight.compacted,true,"working context must compact under actual token pressure");
  assert.ok(tight.omittedMessages>0);
  assert.match(tight.turns[0].text,/APPLICATION-GENERATED EARLIER CONVERSATION MEMORY/);
  assert.equal(tight.turns.at(-1).text,messages.at(-1).text,"latest turn must remain verbatim");

  const decision=ctx.decideContextBudget({messages,currentProviderContextTokens:190_000,estimatedNewUserTokens:1000,estimatedToolSchemaTokens:1000,expectedOutputTokens:4000,capabilities:{contextWindow:1_048_576,maxOutputTokens:65_536,supportsThinking:true,supportedThinkingLevels:["minimal"],supportsTools:true,supportsParallelTools:true,supportsStructuredOutput:true,supportsVision:true,supportsStreaming:true,supportsStatefulConversation:true,supportsImplicitCaching:"unknown"},contextSafetyFraction:.9,configuredInputTpmLimit:250_000,configuredInputTpmUsed:80_000,visibleConversationTokens:40_000});
  assert.equal(decision.shouldRebaseProviderState,true,"recoverable provider execution bulk should rebase before semantic memory");

  const price={cacheHitInputPerMillionUsd:.006,cacheMissInputPerMillionUsd:.30,outputPerMillionUsd:1.20,perRequestWorstCaseUsd:.01,dailyWorstCaseUsd:1};
  const large=cost.estimateDeepSeekWorstCase(100_000,8_000,price);
  assert.equal(large.allowed,false,"large DeepSeek resend must be rejected when a zero-cache miss exceeds policy");
  const estimated=cost.estimateDeepSeekBilledCost({inputTokens:100_000,outputTokens:10_000,thoughtTokens:8_000,cachedTokens:0,toolTokens:0,totalTokens:118_000,cacheHitTokens:90_000,cacheMissTokens:10_000},price);
  const expected=90_000/1e6*.006+10_000/1e6*.30+10_000/1e6*1.20;
  assert.ok(Math.abs(estimated-expected)<1e-12,"reasoning tokens are a completion breakdown and must not be double charged");
  console.log("R31 AI runtime policy harness passed: dynamic long-memory retention/compaction, provider-state rebasing, and zero-cache DeepSeek cost safety are coherent.");
}finally{rt.cleanup()}

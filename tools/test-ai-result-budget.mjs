import assert from "node:assert/strict";
import { compileTsRuntime } from "./ts-runtime-loader.mjs";
const rt=compileTsRuntime(["src/ai/runtime/resultBudget.ts"]);
try{
  const {compactToolResult}=rt.load("src/ai/runtime/resultBudget.ts");
  const results=Array.from({length:6},(_,i)=>({op:`op-${i+1}`,ok:true,items:Array.from({length:40},(_,j)=>({id:j,label:`horse-${i}-${j}-${"x".repeat(60)}`})),evidenceId:`ev-${i+1}`}));
  const original={ok:true,results};
  const compacted=compactToolResult(original,1200);
  assert.equal(compacted.truncated,true);
  assert.ok(JSON.stringify(compacted.output).length<=1200,"compacted output must respect active context budget");
  assert.equal(compacted.output.results.length,6,"every successful operation must remain represented");
  assert.deepEqual(compacted.output.results.map(x=>x.op),results.map(x=>x.op));
  assert.doesNotMatch(JSON.stringify(compacted.output),/result_too_large/);
  console.log("R31.9 AI result-budget harness passed: oversized batched research compacts per operation without discarding the successful batch.");
}finally{rt.cleanup()}

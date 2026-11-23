import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compileTsRuntime } from "./ts-runtime-loader.mjs";

const rt=compileTsRuntime(["src/ai/conversation/repository.ts","src/ai/core/errors.ts","src/ai/core/types.ts"]);
const dir=mkdtempSync(join(tmpdir(),"horse-r31-ai-storage-"));
try{
  const repo=rt.load("src/ai/conversation/repository.ts");
  const sqlite=new DatabaseSync(join(dir,"ai.sqlite")); sqlite.exec("PRAGMA foreign_keys=ON");
  for(const n of [16,17,18,19,20,21,22]) sqlite.exec(readFileSync(`migrations/${String(n).padStart(4,"0")}_${migrationName(n)}.sql`,"utf8"));
  const db=d1(sqlite);
  assert.equal(await repo.aiStorageReady(db),true);
  // Column-only migrations are release-critical too; table presence alone must
  // never make a partially migrated deployment advertise the assistant.
  const partialSqlite=new DatabaseSync(join(dir,"ai-partial.sqlite")); partialSqlite.exec("PRAGMA foreign_keys=ON");
  for(const n of [16,17,19,21,22]) partialSqlite.exec(readFileSync(`migrations/${String(n).padStart(4,"0")}_${migrationName(n)}.sql`,"utf8"));
  const partialDb=d1(partialSqlite);
  assert.equal(await repo.aiStorageReady(partialDb),false,"missing lease/idempotency columns must fail storage readiness");
  partialSqlite.close();
  const owner="test-owner";
  const c=await repo.createConversation(db,owner,{mode:"auto",locale:"en",provider:"deepseek",model:"deepseek-flash"});
  assert.ok(c.id);
  assert.equal(c.preferredProvider,"deepseek");
  await repo.updateConversationPreferences(db,{conversationId:c.id,ownerKey:owner,mode:"research",provider:null,model:null});
  const resetPrefs=await repo.getConversation(db,c.id,owner);
  assert.equal(resetPrefs.executionMode,"research","execution-mode preference should persist");
  assert.equal(resetPrefs.preferredProvider,null,"explicit Auto must clear a saved provider preference");
  assert.equal(resetPrefs.preferredModel,null,"explicit Auto must clear a saved model preference");
  assert.equal(await repo.acquireTurnLease(db,c.id,owner,"turn-1"),true);
  assert.equal(await repo.deleteConversation(db,c.id,owner),false,"busy conversation deletion must be non-destructive");
  assert.ok(await repo.getConversation(db,c.id,owner),"busy delete must leave transcript/conversation intact");
  await repo.releaseTurnLease(db,c.id,"turn-1");

  const first=await repo.ensureUserMessage(db,{conversationId:c.id,ownerKey:owner,clientMessageId:"client-1",text:"Find CHABOCK",attachments:[{kind:"image",url:"https://example.test/horse.webp"}]});
  assert.equal(first.inserted,true); assert.equal(first.user.attachments.length,1);
  const retry=await repo.ensureUserMessage(db,{conversationId:c.id,ownerKey:owner,clientMessageId:"client-1",text:"Find CHABOCK"});
  assert.equal(retry.inserted,false,"same logical retry must converge on one user message");
  await assert.rejects(()=>repo.ensureUserMessage(db,{conversationId:c.id,ownerKey:owner,clientMessageId:"client-1",text:"different text"}),/same clientMessageId/i);

  const usage={inputTokens:100,outputTokens:20,thoughtTokens:5,cachedTokens:50,toolTokens:4,totalTokens:129};
  const answer=await repo.commitAssistantTurn(db,{conversationId:c.id,ownerKey:owner,clientMessageId:"client-1",text:"Found it.",provider:"gemini",model:"gemini-3.5-flash-lite",evidence:[],entityRefs:[],providerInteractionId:"int-1",providerState:{interactionId:"int-1"},usage,effectiveContextTokens:129,titleIfEmpty:"CHABOCK"});
  assert.equal(answer.text,"Found it.");
  const replay=await repo.findIdempotentTurn(db,{conversationId:c.id,ownerKey:owner,clientMessageId:"client-1"});
  assert.equal(replay.existingAssistant.text,"Found it.","completed logical retry must reuse persisted answer");
  const state=await repo.getConversationProviderState(db,c.id,owner); assert.equal(state.interactionId,"int-1","assistant reply and provider continuation must commit together");

  const requestId=crypto.randomUUID();
  await repo.recordRequestAttempt(db,{id:requestId,conversationId:c.id,provider:"deepseek",model:"deepseek-flash",estimatedInputTokens:10_000,estimatedCostUsd:.01});
  const reservation=await repo.reserveProviderCost(db,requestId,"deepseek",.01,.05); assert.ok(reservation.reservationId);
  await repo.reconcileProviderEstimatedCost(db,reservation.reservationId,.003);
  await repo.completeRequestLedger(db,{id:requestId,status:"success",usage,estimatedBilledCostUsd:.003});
  assert.equal(await repo.deleteConversation(db,c.id,owner),true);
  assert.equal(await repo.getConversation(db,c.id,owner),null);
  const ledger=sqlite.prepare("SELECT conversation_id,status,estimated_billed_cost_usd FROM ai_request_ledger WHERE id=?").get(requestId);
  assert.equal(ledger.conversation_id,null,"deleting chat must retain detached quota/cost telemetry"); assert.equal(ledger.status,"success");
  console.log("R31 AI storage harness passed: readiness, lease-safe deletion, message idempotency, persistent/resettable model preferences, attachment persistence, atomic assistant/provider state, and paid telemetry retention are coherent.");
}finally{rt.cleanup();rmSync(dir,{recursive:true,force:true})}

function migrationName(n){return ({16:"ai_assistant",17:"ai_request_ledger",18:"ai_turn_lease",19:"ai_message_attachments",20:"ai_message_idempotency",21:"ai_deepseek_cost_reservations",22:"ai_cost_semantics"})[n]}
function d1(sqlite){
  class Stmt{constructor(sql,values=[]){this.sql=sql;this.values=values}bind(...v){return new Stmt(this.sql,v)}async first(column){const r=sqlite.prepare(this.sql).get(...this.values);if(!r)return null;return column?r[column]:r}async all(){const rows=sqlite.prepare(this.sql).all(...this.values);return{success:true,results:rows,meta:{changes:0,rows_read:rows.length}}}async run(){const r=sqlite.prepare(this.sql).run(...this.values);return{success:true,results:[],meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid??0)}}}sync(){const stmt=sqlite.prepare(this.sql);if(stmt.columns().length){const rows=stmt.all(...this.values);return{success:true,results:rows,meta:{changes:0}}}const r=stmt.run(...this.values);return{success:true,results:[],meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid??0)}}}}
  return{prepare(sql){return new Stmt(sql)},async batch(stmts){sqlite.exec("BEGIN");try{const r=stmts.map(s=>s.sync());sqlite.exec("COMMIT");return r}catch(e){try{sqlite.exec("ROLLBACK")}catch{}throw e}},async exec(sql){sqlite.exec(sql);return{count:0,duration:0}},async dump(){throw new Error("not needed")}};
}

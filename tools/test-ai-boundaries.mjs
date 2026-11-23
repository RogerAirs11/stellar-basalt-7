import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compileTsRuntime } from "./ts-runtime-loader.mjs";

const rt=compileTsRuntime(["src/ai/runtime/orchestrator.ts","src/ai/conversation/repository.ts","src/ai/domain/types.ts"]);
const dir=mkdtempSync(join(tmpdir(),"horse-r319-ai-boundary-"));
try{
  const repo=rt.load("src/ai/conversation/repository.ts");
  const runtime=rt.load("src/ai/runtime/orchestrator.ts");
  const stateSqlite=new DatabaseSync(join(dir,"state.sqlite"));stateSqlite.exec("PRAGMA foreign_keys=ON");
  for(const n of [16,17,18,19,20,21,22])stateSqlite.exec(readFileSync(`migrations/${String(n).padStart(4,"0")}_${migrationName(n)}.sql`,"utf8"));
  const registrySqlite=new DatabaseSync(join(dir,"registry.sqlite"));
  registrySqlite.exec("CREATE TABLE horses(id INTEGER PRIMARY KEY,name_latin TEXT); INSERT INTO horses(id,name_latin) VALUES(4242,'BOUNDARY HORSE');");
  const stateDb=d1(stateSqlite),registryDb=d1(registrySqlite);
  assert.throws(()=>stateSqlite.prepare("SELECT * FROM horses LIMIT 1").get(),/no such table/i);
  assert.throws(()=>registrySqlite.prepare("SELECT * FROM ai_conversations LIMIT 1").get(),/no such table/i);

  const owner="boundary-owner";
  const conversation=await repo.createConversation(stateDb,owner,{mode:"auto",locale:"en",provider:null,model:null});
  const domain={
    id:"boundary-test",
    buildSystemPolicy(){return "test"},
    toolDefinitions(){return[]},
    async executeTool(){throw new Error("not expected")},
    async tryLocalResolve(text){
      const m=text.match(/#(\d+)/);if(!m)return null;
      const row=await registryDb.prepare("SELECT id,name_latin FROM horses WHERE id=?").bind(Number(m[1])).first();
      if(!row)return null;
      return{text:`Found ${row.name_latin}.`,title:row.name_latin,evidence:[{id:"ev-1",kind:"registry_record",title:row.name_latin,sourceRef:`horse:${row.id}`}],entityRefs:[{kind:"horse",id:String(row.id),label:row.name_latin,href:`/horses/${row.id}`}]};
    },
    toolStatus(){return"researching"},toolFailureMessage(){return"failed"},
  };
  const events=[];
  for await(const event of runtime.runAssistantTurn({config:{},stateDb,domain,ownerKey:owner,conversationId:conversation.id,clientMessageId:"11111111-1111-4111-8111-111111111111",text:"Open horse #4242"}))events.push(event);
  const done=events.find(x=>x.type==="done");
  assert.equal(done?.message?.text,"Found BOUNDARY HORSE.");
  const count=stateSqlite.prepare("SELECT COUNT(*) AS n FROM ai_messages").get().n;
  assert.equal(count,2,"user and assistant messages must persist only in state DB");

  const providerSource=readFileSync("src/db/provider.ts","utf8");
  assert.match(providerSource,/ai_state_write_canonical_read/);
  assert.match(providerSource,/AI_DB: env\.AI_DB \?\? env\.DB/);
  assert.match(providerSource,/classifyDatabaseRequestIntent\(request\) !== "canonical_read"/);
  const workerSource=readFileSync("src/worker.ts","utf8");
  assert.match(workerSource,/responseWithDatabaseLifetime/);
  assert.match(workerSource,/body EOF/);
  console.log("R31.9 AI boundary harness passed: physically separate state/registry databases, hybrid request intent, non-replay semantics, and stream-lifetime cleanup are structurally enforced.");
  stateSqlite.close();registrySqlite.close();
}finally{rt.cleanup();rmSync(dir,{recursive:true,force:true})}

function migrationName(n){return({16:"ai_assistant",17:"ai_request_ledger",18:"ai_turn_lease",19:"ai_message_attachments",20:"ai_message_idempotency",21:"ai_deepseek_cost_reservations",22:"ai_cost_semantics"})[n]}
function d1(sqlite){class Stmt{constructor(sql,values=[]){this.sql=sql;this.values=values}bind(...v){return new Stmt(this.sql,v)}async first(column){const r=sqlite.prepare(this.sql).get(...this.values);if(!r)return null;return column?r[column]:r}async all(){const rows=sqlite.prepare(this.sql).all(...this.values);return{success:true,results:rows,meta:{changes:0,rows_read:rows.length}}}async run(){const r=sqlite.prepare(this.sql).run(...this.values);return{success:true,results:[],meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid??0)}}}sync(){const stmt=sqlite.prepare(this.sql);if(stmt.columns().length){const rows=stmt.all(...this.values);return{success:true,results:rows,meta:{changes:0}}}const r=stmt.run(...this.values);return{success:true,results:[],meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid??0)}}}}return{prepare(sql){return new Stmt(sql)},async batch(stmts){sqlite.exec("BEGIN");try{const r=stmts.map(s=>s.sync());sqlite.exec("COMMIT");return r}catch(e){try{sqlite.exec("ROLLBACK")}catch{}throw e}},async exec(sql){sqlite.exec(sql);return{count:0,duration:0}},async dump(){throw new Error("not needed")}}}

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openLocalSqlite } from "../src/db/localSqlite";
import { buildHorseRegistryAiTools } from "../src/ai/domain/horseRegistry/broker";
import { tryResolveLocalAssistantTurn } from "../src/ai/runtime/localResolver";

const authority=process.env.AI_REALDATA_DB;
const run=authority?describe:describe.skip;
run("R31 AI broker against canonical real data",()=>{
  const dir=mkdtempSync(join(tmpdir(),"horse-r31-ai-realdata-"));
  const copy=join(dir,"horse-registry-r31-test.sqlite");
  let db:D1Database; let tools:ReturnType<typeof buildHorseRegistryAiTools>;
  beforeAll(async()=>{
    copyFileSync(authority!,copy);
    db=openLocalSqlite(copy);
    for(const n of [14,15,16,17,18,19,20,21]){
      const name=({14:"content_posts",15:"newsroom_seed_images",16:"ai_assistant",17:"ai_request_ledger",18:"ai_turn_lease",19:"ai_message_attachments",20:"ai_message_idempotency",21:"ai_deepseek_cost_reservations"} as Record<number,string>)[n]!;
      await db.exec(readFileSync(`migrations/${String(n).padStart(4,"0")}_${name}.sql`,"utf8"));
    }
    tools=buildHorseRegistryAiTools();
  });
  afterAll(()=>rmSync(dir,{recursive:true,force:true}));
  const ctx=()=>({registryDb:db,db,maxResultCharacters:120_000});

  test("identity search resolves English, Persian and registration evidence",async()=>{
    const out=await tools.execute("registry_research",{operations:[
      {op:"search",query:"CHABOCK",limit:5},
      {op:"search",query:"چابك",limit:5},
      {op:"search",query:"IR3311775",limit:5},
    ]},ctx());
    const r=(out.output as any).results;
    expect(r[0].items[0].id).toBe(1); expect(r[1].items[0].id).toBe(1); expect(r[2].items[0].id).toBe(1);
  });

  test("structured registry browse is bounded, exact-counted and cursor-aware",async()=>{
    const horse=await db.prepare("SELECT sex_desc FROM horses WHERE id=1").first<{sex_desc:string|null}>();
    expect(horse?.sex_desc).toBeTruthy();
    const out=await tools.execute("registry_research",{operations:[{op:"browse",filters:{sex:horse!.sex_desc},sort:"id",dir:"asc",limit:5}]},ctx());
    const r=(out.output as any).results[0];
    expect(r.op).toBe("browse"); expect(r.total).toBeGreaterThan(5); expect(r.items.length).toBe(5); expect(r.hasMore).toBe(true); expect(r.cursor).toBe("5");
  });

  test("people research returns compact ranked identity and paged public profile",async()=>{
    const p=await db.prepare("SELECT id,name_latin,name_native FROM people WHERE deleted_at IS NULL AND COALESCE(name_latin,name_native) IS NOT NULL ORDER BY id LIMIT 1").first<any>();
    expect(p).toBeTruthy();
    const query=String(p.name_latin??p.name_native).slice(0,24);
    const out=await tools.execute("registry_research",{operations:[{op:"people_search",query,limit:8},{op:"person",personId:p.id,limit:10}]},ctx());
    const r=(out.output as any).results;
    expect(r[0].items.some((x:any)=>x.id===p.id)).toBe(true); expect(r[1].found).toBe(true); expect(r[1].person.id).toBe(p.id); expect(r[1].horses.length).toBeLessThanOrEqual(10);
  });

  test("pedigree research stays bounded for a prolific parent",async()=>{
    const sire=await db.prepare("SELECT father_id AS id,COUNT(*) AS c FROM horses WHERE deleted_at IS NULL AND father_id IS NOT NULL GROUP BY father_id ORDER BY c DESC LIMIT 1").first<any>();
    expect(sire.c).toBeGreaterThan(80);
    const out=await tools.execute("pedigree_research",{operations:[{op:"descendants",horseId:sire.id,depth:2,maxNodes:80}]},ctx());
    const r=(out.output as any).results[0]; expect(r.result).toBeTruthy(); expect(JSON.stringify(r.result).length).toBeLessThan(120_000);
  });

  test("registry analytics performs exact filtered counts and bounded decade distributions",async()=>{
    const horse=await db.prepare("SELECT sex_desc FROM horses WHERE id=1").first<{sex_desc:string|null}>();
    expect(horse?.sex_desc).toBeTruthy();
    const direct=await db.prepare("SELECT COUNT(*) AS count FROM horses WHERE deleted_at IS NULL AND sex_desc=? COLLATE NOCASE").bind(horse!.sex_desc).first<{count:number}>();
    const out=await tools.execute("registry_analysis",{operations:[
      {op:"count",filters:{}},
      {op:"count",filters:{sex:horse!.sex_desc}},
      {op:"group_count",filters:{sex:horse!.sex_desc},field:"birth_decade",limit:12},
    ]},ctx());
    const r=(out.output as any).results;
    expect(r[0].count).toBe(78089);
    expect(r[1].count).toBe(Number(direct?.count??0));
    expect(r[2].populationExamined).toBe(Number(direct?.count??0));
    expect(r[2].groupedPopulation).toBeLessThanOrEqual(r[2].populationExamined);
    expect(r[2].items.length).toBeGreaterThan(0);
    expect(r[2].items.length).toBeLessThanOrEqual(12);
  });

  test("exact horse navigation can resolve locally without a model call",async()=>{
    const out=await tryResolveLocalAssistantTurn(db,"open horse #1","en");
    expect(out).toBeTruthy();
    expect(out!.entityRefs[0]?.kind).toBe("horse");
    expect(out!.entityRefs[0]?.id).toBe("1");
    expect(await tryResolveLocalAssistantTurn(db,"compare horse #1 with its sire","en")).toBeNull();
  });

  test("published content search uses migrated R31 content authority",async()=>{
    const out=await tools.execute("content_research",{op:"search",query:"Arabian",limit:5},ctx());
    expect((out.output as any).ok).toBe(true); expect((out.output as any).items.length).toBeGreaterThan(0);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { OfflineProvider } from "../../src/ai/providers/offline/client";
import { loadAiConfig } from "../../src/ai/runtime/config";
import { createHorseRegistryAiDomainAdapter } from "../../src/ai/domain/horseRegistry/adapter";
import { createConversation, getConversation } from "../../src/ai/conversation/repository";
import { runAssistantTurn } from "../../src/ai/runtime/orchestrator";
import { getAiAssistantStatus } from "../../src/ai/application/assistantService";
import type { AiClientStreamEvent, ProviderTurnInput } from "../../src/ai/core/types";
import { openRealDatabase } from "../helpers/realDatabase";

const local = { APP_ENV:"local", ISOLATED_DEMO_MODE:"1", REGISTRY_DATASET_KIND:"synthetic", AI_ASSISTANT_ENABLED:"1", AI_OFFLINE_SANDBOX:"1", AI_DEMO_REGISTRY_RESEARCH:"1", AI_GEMINI_ENABLED:"0", AI_DEEPSEEK_ENABLED:"0" };
const turn = (latestUserText: string): ProviderTurnInput => ({ model:"offline-sandbox", systemInstruction:"Synthetic local research", conversation:[], latestUserText, tools:[], thinkingLevel:"off", maxOutputTokens:4096, toolChoice:"validated" });
afterEach(() => vi.unstubAllGlobals());

describe("R111 deterministic local registry research", () => {
  it("requires every independent synthetic isolation flag", () => {
    expect(loadAiConfig(local as never).offline.registryResearch).toBe(true);
    for (const overrides of [{APP_ENV:"production"},{APP_ENV:"preview"},{ISOLATED_DEMO_MODE:"0"},{REGISTRY_DATASET_KIND:"client"},{AI_ASSISTANT_ENABLED:"0"},{AI_OFFLINE_SANDBOX:"0"},{AI_DEMO_REGISTRY_RESEARCH:"0"}]) {
      expect(loadAiConfig({...local,...overrides} as never).offline.registryResearch).toBe(false);
    }
  });

  it("keeps the original static offline provider static unless explicitly configured", async () => {
    const provider = new OfflineProvider();
    expect(provider.capabilities("offline-sandbox").supportsTools).toBe(false);
    const result = await provider.createTurn({...turn("Find DEMO"),tools:[{name:"registry_research",description:"read",parameters:{}}]});
    expect(result.toolCalls).toEqual([]);
    expect(result.text).toContain("static demonstration only");
  });

  it("announces unsupported requests without invented tools or external IO", async () => {
    const fetch = vi.fn(() => { throw new Error("External IO forbidden"); }); vi.stubGlobal("fetch",fetch);
    const provider = new OfflineProvider({registryResearch:true});
    for (const text of ["Predict the best foal", "Browse https://example.com", "delete horses", "hello"]) {
      const result = await provider.createTurn(turn(text));
      expect(result.toolCalls).toEqual([]);
      expect(result.text).toContain("Supported commands");
      expect(result.text).toContain("unavailable");
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses actual current SQLite count and profile evidence, preserving unknown and empty results", async () => {
    const fetch = vi.fn(() => { throw new Error("External IO forbidden"); }); vi.stubGlobal("fetch",fetch);
    const db = await openRealDatabase();
    await db.prepare("INSERT INTO horses(id,name_latin,birth_year) VALUES(741,'FICTIONAL local research horse',NULL)").run();
    await db.prepare("UPDATE registry_runtime_counters SET active_horse_count=(SELECT COUNT(*) FROM horses WHERE deleted_at IS NULL) WHERE id=1").run();
    const domain = createHorseRegistryAiDomainAdapter(db as never);
    const provider = new OfflineProvider({registryResearch:true});
    for (const question of ["Count horses", "Horse 741", "Horse 742", "اسب ۷۴۱"]) {
      const input = {...turn(question),tools:domain.toolDefinitions()};
      const initial = await provider.createTurn(input);
      expect(initial.toolCalls).toHaveLength(1);
      const call = initial.toolCalls[0];
      const tool = await domain.executeTool(call.name,call.arguments,40_000);
      const final = await provider.continueTurn({...input,toolResults:[{callId:call.id,name:call.name,output:tool.output}]});
      expect(final.toolCalls).toEqual([]);
      if (question === "Horse 742") {
        expect(final.text).toContain("No public horse profile");
        expect(tool.evidence).toEqual([]);
      } else {
        expect(tool.evidence).toHaveLength(1);
        expect(final.text).toContain(tool.evidence[0].id);
        if (question === "Count horses") expect(final.text).toContain("**1**");
        else {
          expect(final.text).toContain("741");
          expect(tool.evidence[0].entityRefs).toContainEqual(expect.objectContaining({kind:"horse",id:"741",href:"/horse/741"}));
          expect(final.text).toContain(question === "Horse 741" ? "unknown" : "نامشخص");
        }
      }
    }
    expect(await db.prepare("SELECT COUNT(*) AS n FROM horses").first("n")).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("persists an actual tool-backed conversation with raw commands despite page context", async () => {
    const fetch = vi.fn(() => { throw new Error("External IO forbidden"); }); vi.stubGlobal("fetch",fetch);
    const db = await openRealDatabase();
    await db.prepare("INSERT INTO horses(id,name_latin) VALUES(741,'FICTIONAL A'),(742,'FICTIONAL B')").run();
    await db.prepare("UPDATE registry_runtime_counters SET active_horse_count=(SELECT COUNT(*) FROM horses WHERE deleted_at IS NULL) WHERE id=1").run();
    const env = {...local,DB:db} as never;
    const status = await getAiAssistantStatus(env);
    expect(status.available).toBe(true);
    expect(status.models.filter(model=>model.available).map(model=>model.provider)).toEqual(["offline"]);
    expect(status.models[0].label).toContain("fictional data");
    expect(status.visionAvailable).toBe(false);
    const conversation = await createConversation(db as never,"anon:research-a",{mode:"auto",locale:"en"});
    const clientMessageId = crypto.randomUUID();
    const input = {config:loadAiConfig(env),stateDb:db as never,domain:createHorseRegistryAiDomainAdapter(db as never),ownerKey:"anon:research-a",conversationId:conversation.id,clientMessageId,text:"Count horses",pageContext:{route:"/database",horseId:741}};
    const events:AiClientStreamEvent[]=[];
    for await (const event of runAssistantTurn(input)) events.push(event);
    const done = events.find(event=>event.type==="done");
    expect(done?.type).toBe("done");
    if (done?.type === "done") {
      expect(done.message.text).toContain("**2**");
      expect(done.message.provider).toBe("offline");
      expect(done.message.evidence).toContainEqual(expect.objectContaining({sourceRef:"analytics:count:{}"}));
    }
    expect(events.some(event=>event.type==="trace"&&event.phase==="tools_completed")).toBe(true);
    const saved = await getConversation(db as never,conversation.id,"anon:research-a");
    expect(saved?.messages.filter(message=>message.role==="assistant")).toHaveLength(1);
    expect(await getConversation(db as never,conversation.id,"anon:research-b")).toBeNull();
    const replay:AiClientStreamEvent[]=[];
    for await (const event of runAssistantTurn(input)) replay.push(event);
    expect(replay).toHaveLength(1); expect(replay[0].type).toBe("done");
    expect(fetch).not.toHaveBeenCalled();
  });
});

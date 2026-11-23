import { aiStorageReady,aiOperationalSnapshot } from "../conversation/repository";
import { publicModelCatalog } from "../core/modelCatalog";
import type { AiAssistantStatus } from "../core/types";
import { geminiQuotaForModel,loadAiConfig,resolveAiStateDatabase } from "../runtime/config";
import { geminiQuotaSnapshot } from "../runtime/quotaGovernor";
import { loadGeminiKeyRing } from "../core/keyRing";
import { effectiveDefaultChatModel,readAdminAiSettings } from "../core/settingsStore";

export async function getAiAssistantStatus(env:Env):Promise<AiAssistantStatus>{
 const config=loadAiConfig(env);const stateDb=resolveAiStateDatabase(env);let storageReady=false;try{storageReady=await aiStorageReady(stateDb)}catch{}
 // Admin-managed database keys extend the environment keys; either source can enable Gemini.
 let ringKeys=0;if(config.enabled&&env.AI_GEMINI_ENABLED!=="0"){try{ringKeys=(await loadGeminiKeyRing(env,stateDb)).size}catch{}}
 const geminiEnabled=config.gemini.enabled||ringKeys>0;
 const models=publicModelCatalog({geminiEnabled,deepseekEnabled:config.deepseek.enabled,deepseekVisionEnabled:config.deepseek.visionEnabled,offlineEnabled:config.offline.enabled,offlineRegistryResearch:config.offline.registryResearch});
 const available=config.enabled&&storageReady&&models.some(m=>m.available);
 // R33: the reported default model reflects the admin-selected override.
 const adminSettings=await readAdminAiSettings(stateDb).catch(()=>({defaultChatModel:null,defaultExecutionMode:null}));
 const defaultModel=available?effectiveDefaultChatModel(adminSettings.defaultChatModel,{geminiEnabled,deepseekEnabled:config.deepseek.enabled,offlineEnabled:config.offline.enabled}):null;
 return{available,defaultModel,models,visionAvailable:models.some(m=>m.available&&m.vision),storageReady,reason:available?null:!config.enabled?"assistant_disabled":!storageReady?"storage_not_ready":"no_provider_configured"};
}
export async function getAiAdminDiagnostics(env:Env):Promise<Record<string,unknown>>{const config=loadAiConfig(env);const status=await getAiAssistantStatus(env);const stateDb=resolveAiStateDatabase(env);const operations=await aiOperationalSnapshot(stateDb);const defaultQuota=geminiQuotaForModel(config.gemini,config.gemini.defaultModel);const gemini=config.gemini.enabled?await geminiQuotaSnapshot(stateDb,config.gemini.defaultModel,defaultQuota):null;
 let keyRing:Record<string,unknown>|null=null;try{keyRing=(await loadGeminiKeyRing(env,stateDb)).snapshot() as unknown as Record<string,unknown>}catch{keyRing=null}
 return{status,operations,gemini,keyRing,policies:{gemini:{quota:{...defaultQuota},quotasByModel:config.gemini.quotasByModel,webGroundingEnabled:config.gemini.webGroundingEnabled,envKeyCount:config.gemini.apiKeys.length},deepseek:{visionEnabled:config.deepseek.visionEnabled,price:{...config.deepseek.price}},contextSafetyFraction:config.contextSafetyFraction,outputTokens:config.outputTokens,maxToolCalls:config.maxToolCalls,maxToolRounds:config.maxToolRounds}}}

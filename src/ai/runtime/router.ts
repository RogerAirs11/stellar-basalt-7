import { DEEPSEEK_FLASH, GEMINI_25_FLASH, GEMINI_25_FLASH_LITE, GEMINI_CHAT_MODELS, GEMINI_FLASH, GEMINI_FLASH_LITE, OFFLINE_SANDBOX } from "../core/modelCatalog";
import { providerForChatModel } from "../core/settingsStore";
import type { AiExecutionMode, AiProviderId } from "../core/types";
import type { AiRuntimeConfig } from "./config";

export interface RouteChoice{provider:AiProviderId;model:string;explicit:boolean}

export function chooseInitialRoute(config:AiRuntimeConfig,input:{mode:AiExecutionMode;provider?:AiProviderId|null;model?:string|null;hasImages?:boolean;adminDefaultModel?:string|null}):RouteChoice{
  const explicit=Boolean(input.provider||input.model);
  const modelProvider = input.model ? providerForChatModel(input.model) : null;
  if(input.model && !modelProvider) throw new Error(`Unsupported AI model: ${input.model}`);
  if(input.provider && modelProvider && input.provider!==modelProvider) throw new Error(`Model ${input.model} does not belong to provider ${input.provider}`);

  const provider=input.provider??modelProvider;
  if(provider==="offline"){
    if(!config.offline.enabled)throw new Error("Offline sandbox assistant is not enabled");
    if(input.model&&input.model!==OFFLINE_SANDBOX)throw new Error(`Unsupported offline model: ${input.model}`);
    // The offline assistant has no vision.
    if(input.hasImages)throw new Error("The offline sandbox assistant cannot accept images");
    return{provider:"offline",model:OFFLINE_SANDBOX,explicit};
  }
  if(provider==="deepseek"){
    if(!config.deepseek.enabled)throw new Error("DeepSeek is not configured");
    if(input.hasImages&&!config.deepseek.visionEnabled)throw new Error("DeepSeek vision has not passed the deployment capability gate");
    if(input.model&&input.model!==DEEPSEEK_FLASH)throw new Error(`Unsupported DeepSeek model: ${input.model}`);
    return{provider:"deepseek",model:DEEPSEEK_FLASH,explicit};
  }
  if(provider==="gemini"){
    if(!config.gemini.enabled)throw new Error("Gemini is not configured");
    const model=input.model??GEMINI_25_FLASH;
    if(!(GEMINI_CHAT_MODELS as readonly string[]).includes(model))throw new Error(`Unsupported Gemini model: ${model}`);
    return{provider:"gemini",model,explicit};
  }

  // No explicit provider/model: honor the admin-selected default when its
  // provider is enabled, then fall back to Gemini Flash-Lite.
  const adminDefault=input.adminDefaultModel&&providerForChatModel(input.adminDefaultModel)?input.adminDefaultModel:null;
  if(adminDefault){
    const adminProvider=providerForChatModel(adminDefault)!;
    if(adminProvider==="offline"&&config.offline.enabled&&!input.hasImages)return{provider:"offline",model:OFFLINE_SANDBOX,explicit:false};
    if(adminProvider==="gemini"&&config.gemini.enabled)return{provider:"gemini",model:adminDefault,explicit:false};
    if(adminProvider==="deepseek"&&config.deepseek.enabled&&(!input.hasImages||config.deepseek.visionEnabled))return{provider:"deepseek",model:adminDefault,explicit:false};
  }
  if(input.hasImages){
    // Images require a vision-capable provider; the offline assistant has none.
    if(config.gemini.enabled)return{provider:"gemini",model:GEMINI_25_FLASH,explicit:false};
    if(config.deepseek.enabled&&config.deepseek.visionEnabled)return{provider:"deepseek",model:DEEPSEEK_FLASH,explicit:false};
  }
  if(config.offline.enabled)return{provider:"offline",model:OFFLINE_SANDBOX,explicit:false};
  if(config.gemini.enabled)return{provider:"gemini",model:GEMINI_25_FLASH,explicit:false};
  if(config.deepseek.enabled&&(!input.hasImages||config.deepseek.visionEnabled))return{provider:"deepseek",model:DEEPSEEK_FLASH,explicit:false};
  throw new Error("No AI provider is available");
}

/** R56 model fallback chains. Two distinct failure classes:
 *  - CAPACITY (503 "high demand" admissions, model-quota exhaustion): try the
 *    same-generation sibling tier first (separate free-tier pool, same speed),
 *    then the next generation down.
 *  - AVAILABILITY (404 "this model is no longer available to new users" —
 *    Google retires 2.5-generation models for newer accounts): walk strictly
 *    DOWN the availability chain; an account that cannot use 2.5-flash almost
 *    certainly cannot use 2.5-flash-lite either.
 *  Every model in every chain is a catalog id with its own quota profile. */
const GEMINI_MODEL_CHAINS: Record<string, { capacity: string[]; availability: string[] }> = {
  [GEMINI_25_FLASH]: {
    capacity: [GEMINI_25_FLASH_LITE, GEMINI_FLASH_LITE],
    availability: [GEMINI_FLASH_LITE],
  },
  [GEMINI_25_FLASH_LITE]: {
    capacity: [GEMINI_25_FLASH, GEMINI_FLASH_LITE],
    availability: [GEMINI_FLASH_LITE],
  },
  [GEMINI_FLASH_LITE]: {
    capacity: [GEMINI_FLASH, GEMINI_25_FLASH_LITE],
    availability: [GEMINI_FLASH],
  },
  [GEMINI_FLASH]: {
    capacity: [GEMINI_FLASH_LITE, GEMINI_25_FLASH_LITE],
    availability: [GEMINI_25_FLASH_LITE],
  },
};

export function geminiModelFallbackChain(model: string, kind: "capacity" | "availability"): string[] {
  return GEMINI_MODEL_CHAINS[model]?.[kind] ?? [];
}

export function canAutoFallback(error:unknown,route:RouteChoice,config:AiRuntimeConfig,hasImages=false):boolean{
  if(route.explicit||!config.deepseek.enabled||(hasImages&&!config.deepseek.visionEnabled))return false;
  const category=String((error as any)?.category??"");const code=String((error as any)?.code??"");
  return ["quota","rate_limit","context_limit","unavailable"].includes(category)||/quota|rate|context|unavailable/i.test(code);
}

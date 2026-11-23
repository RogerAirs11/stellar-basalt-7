import type { AiDomainAdapter } from "../types";
import { buildHorseRegistryAiTools } from "./broker";
import { tryResolveLocalAssistantTurn } from "./localResolver";
import { buildHorseDbSystemPolicy } from "./systemPolicy";

/** Bind canonical registry reads once; generic orchestration never receives this DB handle. */
export function createHorseRegistryAiDomainAdapter(registryDb:D1Database):AiDomainAdapter{
  const tools=buildHorseRegistryAiTools();
  return{
    id:"horse-registry",
    buildSystemPolicy:buildHorseDbSystemPolicy,
    toolDefinitions:()=>tools.definitions(),
    executeTool:(name,args,maxResultCharacters)=>tools.execute(name,args,{registryDb,maxResultCharacters}),
    tryLocalResolve:(text,locale)=>tryResolveLocalAssistantTurn(registryDb,text,locale),
    toolStatus(names){
      if(names.includes("pedigree_research"))return"Checking pedigree and relationship evidence…";
      if(names.includes("registry_analysis"))return"Computing registry statistics…";
      if(names.includes("content_research"))return"Reviewing published Horse-DB content…";
      return"Searching the registry…";
    },
    toolFailureMessage(name){return`The deterministic Horse-DB operation '${name}' failed. Do not invent a result; explain the limitation or try a narrower valid request.`},
  };
}

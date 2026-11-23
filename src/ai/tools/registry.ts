import { z } from "zod";
import type { AiEvidence,AiToolDefinition } from "../core/types";

export interface ToolExecutionContext{registryDb:D1Database;maxResultCharacters:number}
export type AiToolAccess="public-read"|"authenticated-read"|"admin";
export type AiToolMutability="read-only"|"mutation";
export interface RegisteredAiTool{
  definition:AiToolDefinition;
  version:string;
  access:AiToolAccess;
  mutability:AiToolMutability;
  execute(args:unknown,ctx:ToolExecutionContext):Promise<{output:unknown;evidence:AiEvidence[]}>;
}

/**
 * Small, provider-neutral tool registry. Public R31 chat registers read-only tools only;
 * provider schema validation is an aid, never a substitute for Zod validation here.
 */
export class AiToolRegistry{
  private tools=new Map<string,RegisteredAiTool>();
  register(tool:RegisteredAiTool){if(this.tools.has(tool.definition.name))throw new Error(`Duplicate AI tool ${tool.definition.name}`);this.tools.set(tool.definition.name,tool);return this}
  definitions(){return [...this.tools.values()].map(t=>t.definition)}
  metadata(){return [...this.tools.values()].map(t=>({name:t.definition.name,version:t.version,access:t.access,mutability:t.mutability}))}
  async execute(name:string,args:unknown,ctx:ToolExecutionContext){
    const tool=this.tools.get(name);
    if(!tool)return{output:{ok:false,error:"unknown_tool",name},evidence:[] as AiEvidence[]};
    if(tool.mutability!=="read-only")throw new Error(`Public AI runtime refused mutation tool '${name}'`);
    return tool.execute(args,ctx);
  }
}

export function schemaTool<T extends z.ZodTypeAny>(
  name:string,
  description:string,
  schema:T,
  handler:(value:z.infer<T>,ctx:ToolExecutionContext)=>Promise<{output:unknown;evidence:AiEvidence[]}>,
  options:{version?:string;access?:AiToolAccess;mutability?:AiToolMutability}={},
):RegisteredAiTool{
  return{
    definition:{name,description,parameters:zodToJsonSchema(schema)},
    version:options.version??"1.0.0",
    access:options.access??"public-read",
    mutability:options.mutability??"read-only",
    async execute(args,ctx){
      const parsed=schema.safeParse(args);
      if(!parsed.success)return{output:{ok:false,error:"invalid_arguments",issues:parsed.error.issues.map(i=>({path:i.path.join("."),message:i.message}))},evidence:[]};
      return handler(parsed.data,ctx);
    },
  };
}

/** Convert the execution-authoritative Zod schema using Zod 4's public JSON-schema API. */
function zodToJsonSchema(schema:z.ZodTypeAny):Record<string,unknown>{
  const converter=(z as unknown as {toJSONSchema?:(schema:z.ZodTypeAny,options?:Record<string,unknown>)=>Record<string,unknown>}).toJSONSchema;
  if(typeof converter!=="function")throw new Error("Zod JSON-schema conversion is unavailable; R31 requires Zod 4+");
  const json=converter(schema);
  // Provider tool schemas do not need a draft declaration and some providers reject unknown top-level keywords.
  const {$schema: _draft,...parameters}=json as Record<string,unknown> & {$schema?:unknown};
  return parameters;
}

import { createAiEventStream } from "./eventStream";
import { z } from "zod";
import { error,json,readJson,HttpError } from "../../api/http";
import { requirePermission } from "../../auth/guards";
import { AiRuntimeError } from "../core/errors";
import { aiOwnerIdentity } from "./session";
import { getAiAssistantStatus,getAiAdminDiagnostics } from "./assistantService";
import { createConversation,deleteConversation,getConversation,listConversations } from "../conversation/repository";
import { loadAiConfig,resolveAiStateDatabase } from "../runtime/config";
import { loadGeminiKeyRing } from "../core/keyRing";
import { routeAiKeyAdminApi } from "./keyApi";
import { aiDiagnostics } from "./diagnostics";
import { createHorseRegistryAiDomainAdapter } from "../domain/horseRegistry/adapter";
import { runAssistantTurn } from "../runtime/orchestrator";

const ChatModelSchema=z.enum(["gemini-2.5-flash","gemini-2.5-flash-lite","gemini-3.5-flash-lite","gemini-3.5-flash","deepseek-flash","offline-sandbox"]);
const CreateSchema=z.object({mode:z.enum(["fast","auto","research"]).default("auto"),locale:z.string().max(24).default("auto"),provider:z.enum(["gemini","deepseek","offline"]).nullable().optional(),model:ChatModelSchema.nullable().optional()});
const ImageSchema=z.object({kind:z.literal("image").default("image"),url:z.string().url().max(8192).refine(v=>v.startsWith("https://"),"Only HTTPS image references are accepted"),mimeType:z.enum(["image/jpeg","image/png","image/webp","image/gif"]).nullable().optional(),altText:z.string().max(300).nullable().optional()});
const SendSchema=z.object({clientMessageId:z.string().uuid(),text:z.string().trim().min(1).max(12000),mode:z.enum(["fast","auto","research"]).optional(),attachments:z.array(ImageSchema).max(4).optional(),provider:z.enum(["gemini","deepseek","offline"]).nullable().optional(),model:ChatModelSchema.nullable().optional(),pageContext:z.object({route:z.string().max(500).optional(),horseId:z.number().int().positive().optional(),personId:z.number().int().positive().optional(),articleSlug:z.string().max(180).optional()}).optional()});

export async function routeAiApi(request:Request,env:Env,url:URL):Promise<Response|null>{const path=url.pathname,method=request.method.toUpperCase();
 if(path==="/api/ai/diagnostics"&&method==="GET")return aiDiagnostics(request,env);
 const keyAdminResponse=await routeAiKeyAdminApi(request,env,url);if(keyAdminResponse)return keyAdminResponse;
 if(path==="/api/ai/status"&&method==="GET")return json(await getAiAssistantStatus(env));
 if(path==="/api/ai/models"&&method==="GET"){const s=await getAiAssistantStatus(env);return json({models:s.models,defaultModel:s.defaultModel,visionAvailable:s.visionAvailable});}
 if(path==="/api/admin/ai/status"&&method==="GET"){await requirePermission(env.AUTH_DB ?? env.DB,request,env.SESSION_COOKIE_NAME,"content.manage");return json(await getAiAdminDiagnostics(env));}
 if(!path.startsWith("/api/ai/conversations"))return null;
 const identity=await aiOwnerIdentity(request,env);const config=loadAiConfig(env);const stateDb=resolveAiStateDatabase(env);let response:Response;
 try{
  if(path==="/api/ai/conversations"&&method==="GET")response=json({conversations:await listConversations(stateDb,identity.ownerKey,50)});
  else if(path==="/api/ai/conversations"&&method==="POST"){const body=CreateSchema.parse(await readJson(request,32_000));response=json({conversation:await createConversation(stateDb,identity.ownerKey,body)},{status:201});}
  else {
   const conversationMatch = path.match(/^\/api\/ai\/conversations\/([^/]+)$/);
   const messageMatch = path.match(/^\/api\/ai\/conversations\/([^/]+)\/messages$/);
   if(conversationMatch && method==="GET"){const id=decodeURIComponent(conversationMatch[1]);const c=await getConversation(stateDb,id,identity.ownerKey);response=c?json({conversation:c}):error(404,"not_found","Conversation not found");}
   else if(conversationMatch && method==="DELETE"){const id=decodeURIComponent(conversationMatch[1]);const ok=await deleteConversation(stateDb,id,identity.ownerKey);response=ok?json({ok:true}):error(409,"conversation_busy","Conversation is currently busy or does not exist");}
   else if(messageMatch && method==="POST"){const id=decodeURIComponent(messageMatch[1]);const body=SendSchema.parse(await readJson(request,64_000));const status=await getAiAssistantStatus(env);if(!status.available)response=error(503,"ai_unavailable","AI assistant is not available",{reason:status.reason});else return streamTurn(request,env,identity.ownerKey,id,body,identity.setCookie);}
   else return null;
  }
 }catch(e){response=aiErrorResponse(e)}
 if(identity.setCookie)response.headers.append("set-cookie",identity.setCookie);return response;
}

function streamTurn(request:Request,env:Env,ownerKey:string,conversationId:string,body:z.infer<typeof SendSchema>,cookie?:string):Response{
 const config=loadAiConfig(env);
 const stateDb=resolveAiStateDatabase(env);
 const domain=createHorseRegistryAiDomainAdapter(env.DB);
 const stream=createAiEventStream(async function* (signal) {
  const keyRing=env.AI_GEMINI_ENABLED==="0"?null:await loadGeminiKeyRing(env,stateDb).catch(()=>null);
  if(signal.aborted)return;
  yield* runAssistantTurn({config,stateDb,domain,ownerKey,conversationId,clientMessageId:body.clientMessageId,text:body.text,attachments:body.attachments,requestedProvider:body.provider,requestedModel:body.model,executionMode:body.mode,pageContext:body.pageContext,signal,keyRing:keyRing??undefined});
 },normalizeAiError,request.signal);
 const headers=new Headers({"content-type":"text/event-stream; charset=utf-8","cache-control":"no-store, no-transform","referrer-policy":"no-referrer","x-accel-buffering":"no"});
 if(cookie)headers.append("set-cookie",cookie);
 return new Response(stream,{headers});
}
/** One bounded diagnostic sanitizer for JSON and SSE error envelopes. */
function safeDiagnosticDetails(value: unknown): unknown {
  const scrub = (v: unknown, depth = 0): unknown => {
    if (depth > 4) return "[depth-limited]";
    if (typeof v === "string") return v
      .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[REDACTED_API_KEY]")
      .replace(/\bAQ\.[0-9A-Za-z._~-]{12,}/gi, "[REDACTED_API_KEY]")
      .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, "Bearer [REDACTED]")
      .replace(/([?&](?:key|api_key|access_token|token)=)[^\s&#"']+/gi, "$1[REDACTED]")
      .slice(0, 3000);
    if (Array.isArray(v)) return v.slice(0, 40).map(x => scrub(x, depth + 1));
    if (v && typeof v === "object") return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).slice(0, 60).map(([k, x]) =>
        [k, /key|secret|token/i.test(k) ? "[REDACTED]" : scrub(x, depth + 1)]),
    );
    return v;
  };
  return scrub(value);
}
function normalizeAiError(e: unknown) {
  if (e instanceof AiRuntimeError) return { code: e.code, message: String(safeDiagnosticDetails(e.message)), details: safeDiagnosticDetails(e.details) };
  if (e instanceof z.ZodError) return { code: "invalid_request", message: "Invalid AI request", details: safeDiagnosticDetails(e.issues) };
  if (e instanceof HttpError) return { code: e.code, message: String(safeDiagnosticDetails(e.message)), details: safeDiagnosticDetails(e.details) };
  return { code: "ai_error", message: e instanceof Error ? String(safeDiagnosticDetails(e.message)) : "AI request failed" };
}
function aiErrorResponse(e: unknown): Response {
  const n = normalizeAiError(e);
  if (e instanceof z.ZodError) return error(400, n.code, n.message, n.details);
  if (e instanceof HttpError) return error(e.status, n.code, n.message, n.details);
  if (e instanceof AiRuntimeError) {
    const status = e.category === "configuration" ? 503 : e.category === "quota" || e.category === "rate_limit" ? 429 : e.category === "cost_limit" ? 402 : e.category === "storage" && e.code === "conversation_not_found" ? 404 : e.category === "storage" ? 409 : 502;
    return error(status, n.code, n.message, n.details);
  }
  return error(500, "ai_error", n.message);
}

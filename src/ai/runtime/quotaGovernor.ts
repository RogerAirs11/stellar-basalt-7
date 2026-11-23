import { withAiReservation } from "../../db/aiReservation";
import { AiRuntimeError } from "../core/errors";
import type { AiQuotaSnapshot } from "../core/types";
import { isD1WriteQuotaError, markWritesDegraded } from "../conversation/storageHealth";
import type { GeminiQuotaConfig } from "./config";

export async function geminiQuotaSnapshot(db:D1Database,model:string,quota:GeminiQuotaConfig):Promise<AiQuotaSnapshot>{
 const minute=await geminiUsageSince(db,model,60),today=await geminiRequestsSinceTimestamp(db,model,pacificDayStartUtc());
 return{provider:"gemini",model,requestsLastMinute:minute.count,estimatedInputTokensLastMinute:minute.estimatedInputTokens,requestsToday:today,configuredRpmLimit:quota.rpmLimit,configuredInputTpmLimit:quota.inputTpmLimit,configuredRpdLimit:quota.rpdLimit,reserveFraction:quota.reserveFraction};
}

/** Atomically reserve one attempt; API keys do not multiply project quotas. */
type GeminiReservationInput = {id:string;conversationId:string|null;model:string;estimatedInputTokens:number;quota:GeminiQuotaConfig;requestKind?:string};
export async function reserveGeminiAttempt(db:D1Database,input:GeminiReservationInput):Promise<AiQuotaSnapshot>{
 const q=input.quota;
 if(![q.rpmLimit,q.inputTpmLimit,q.rpdLimit].every(n=>typeof n==="number"&&Number.isSafeInteger(n)&&n>0)||!Number.isFinite(q.reserveFraction)||q.reserveFraction<0||q.reserveFraction>=1||!Number.isSafeInteger(input.estimatedInputTokens)||input.estimatedInputTokens<0){
  throw new AiRuntimeError("configuration","gemini_quota_unconfigured","Gemini quota limits and estimates must be finite and valid","gemini",false);
 }
 return withAiReservation(db,authority=>reserveGeminiAttemptOnAuthority(authority,input));
}

async function reserveGeminiAttemptOnAuthority(db:D1Database,input:GeminiReservationInput):Promise<AiQuotaSnapshot>{
 const q=input.quota;
 if(!q.rpmLimit||!q.inputTpmLimit||!q.rpdLimit)throw new AiRuntimeError("configuration","gemini_quota_unconfigured","Gemini quota limits are not configured","gemini",false);
 const rpm=Math.max(1,Math.floor(q.rpmLimit*(1-q.reserveFraction))),tpm=Math.max(1,Math.floor(q.inputTpmLimit*(1-q.reserveFraction))),rpd=Math.max(1,Math.floor(q.rpdLimit*(1-q.reserveFraction))),est=Math.max(0,Math.floor(input.estimatedInputTokens)),dayStart=pacificDayStartUtc();
 // Widened so the fail-closed verification below stays a runtime check even
 // though current driver typings narrow `success` to the literal `true`.
 let result:{success:boolean;meta?:{changes?:number|null}|null}|undefined;
 try{
  result=await db.prepare(`INSERT INTO ai_request_ledger(id,conversation_id,provider,model,request_kind,estimated_input_tokens,estimated_cost_usd,status)
SELECT ?,?,'gemini',?,?,?,0,'attempted'
WHERE (SELECT COUNT(*) FROM ai_request_ledger WHERE provider='gemini' AND model=? AND status!='rejected' AND attempted_at>=datetime('now','-60 seconds')) < ?
AND (SELECT COALESCE(SUM(CASE WHEN input_tokens>0 THEN input_tokens ELSE estimated_input_tokens END),0) FROM ai_request_ledger WHERE provider='gemini' AND model=? AND status!='rejected' AND attempted_at>=datetime('now','-60 seconds')) + ? <= ?
AND (SELECT COUNT(*) FROM ai_request_ledger WHERE provider='gemini' AND model=? AND status!='rejected' AND attempted_at>=?) < ?`)
  .bind(input.id,input.conversationId,input.model,input.requestKind??"chat",est,input.model,rpm,input.model,est,tpm,input.model,dayStart,rpd).run();
 }catch(error){
  if(!isD1WriteQuotaError(error))throw error;
  // A read-only snapshot cannot count subsequent attempts. Pause only the AI
  // provider path; public registry browsing must remain available.
  markWritesDegraded();
  throw new AiRuntimeError("quota","gemini_reservation_unavailable","AI usage cannot be reserved safely; try again after quota storage recovers","gemini",true);

 }
 if(result.success===false||(result.meta?.changes!==0&&result.meta?.changes!==1)){
  throw new AiRuntimeError("quota","gemini_reservation_unavailable","AI usage reservation could not be verified","gemini",true);
 }
 if(result.meta.changes===0){
  const snap=await geminiQuotaSnapshot(db,input.model,q);
  if(snap.requestsToday>=rpd)throw new AiRuntimeError("quota","gemini_daily_reserve_reached","Gemini daily free-tier reserve has been reached","gemini",false,snap);
  if(snap.requestsLastMinute>=rpm)throw new AiRuntimeError("rate_limit","gemini_rpm_reserve_reached","Gemini request-per-minute reserve has been reached","gemini",true,snap);
  throw new AiRuntimeError("quota","gemini_tpm_reserve_reached","Gemini input-token-per-minute reserve would be exceeded","gemini",true,snap);
 }
 return geminiQuotaSnapshot(db,input.model,q);
}

export async function geminiUsageSince(db:D1Database,model:string,seconds:number):Promise<{count:number;estimatedInputTokens:number}>{
 const row=await db.prepare(`SELECT COUNT(*) AS count,COALESCE(SUM(CASE WHEN input_tokens>0 THEN input_tokens ELSE estimated_input_tokens END),0) AS tokens FROM ai_request_ledger WHERE provider='gemini' AND model=? AND status!='rejected' AND attempted_at>=datetime('now', ?)`)
  .bind(model,`-${Math.max(1,Math.floor(seconds))} seconds`).first<{count:number;tokens:number}>();
 return{count:validatedCounter(row?.count),estimatedInputTokens:validatedCounter(row?.tokens)};
}

function pacificDayStartUtc(now=new Date()):string{
 const tz="America/Los_Angeles",parts=new Intl.DateTimeFormat("en-CA",{timeZone:tz,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(now),get=(type:string)=>Number(parts.find(p=>p.type===type)?.value),y=get("year"),m=get("month"),d=get("day");
 let guess=Date.UTC(y,m-1,d,0,0,0);
 for(let i=0;i<2;i++){const p=new Intl.DateTimeFormat("en-US",{timeZone:tz,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(new Date(guess)),val=(type:string)=>Number(p.find(x=>x.type===type)?.value),wallAsUtc=Date.UTC(val("year"),val("month")-1,val("day"),val("hour"),val("minute"),val("second"));guess+=Date.UTC(y,m-1,d,0,0,0)-wallAsUtc}
 return new Date(guess).toISOString().slice(0,19).replace("T"," ");
}
async function geminiRequestsSinceTimestamp(db:D1Database,model:string,start:string):Promise<number>{const row=await db.prepare(`SELECT COUNT(*) AS count FROM ai_request_ledger WHERE provider='gemini' AND model=? AND status!='rejected' AND attempted_at>=?`).bind(model,start).first<{count:number}>();return validatedCounter(row?.count)}

/** SQL aggregates may be decimal strings, but missing/corrupt counters fail closed. */
function validatedCounter(value: unknown): number {
 const number=typeof value==="number"?value:typeof value==="string"&&value.trim()?Number(value):NaN;
 if(!Number.isSafeInteger(number)||number<0)throw new AiRuntimeError("quota","gemini_reservation_unavailable","AI usage accounting could not be verified","gemini",true);
 return number;
}

import type { D1PreparedStatement } from '@cloudflare/workers-types';
import type { CareCommand, CareReceipt } from '../contracts/equineCare';
import type { CareContext } from './access';
import type { CarePolicyCommit } from './policy';
import { runRegistryPolicyBatch } from '../registry/ruleCommit';
import { HttpError } from '../api/http';

export function canonicalCareJson(value:unknown):string {
  if(Array.isArray(value))return `[${value.map(canonicalCareJson).join(',')}]`;
  if(value!==null && typeof value==='object')return `{${Object.keys(value).sort().filter(k=>(value as Record<string,unknown>)[k]!==undefined).map(k=>`${JSON.stringify(k)}:${canonicalCareJson((value as Record<string,unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(value)??'null';
}
interface Intent {command:string;digest:string;input:CareCommand}
async function storedReceipt(context:CareContext,intent:Intent):Promise<CareReceipt|null> {
  const row=await context.db.prepare('SELECT actor_user_id,horse_id,command,request_digest,response_json FROM equine_care_operations WHERE operation_id=?').bind(intent.input.operation_id).first<{actor_user_id:string;horse_id:number;command:string;request_digest:string;response_json:string}>();
  if(!row)return null;
  if(row.actor_user_id!==context.auth.user.id || Number(row.horse_id)!==context.horseId || row.command!==intent.command || row.request_digest!==intent.digest)throw new HttpError(409,'operation_reused','This operation id was already used for a different care command');
  return JSON.parse(row.response_json) as CareReceipt;
}
export async function beginCareCommand(context:CareContext,command:string,input:CareCommand):Promise<Intent&{receipt:CareReceipt|null}> {
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalCareJson({command,horse_id:context.horseId,input})));
  const digest=[...new Uint8Array(hash)].map(n=>n.toString(16).padStart(2,'0')).join('');
  const intent={command,input,digest};return {...intent,receipt:await storedReceipt(context,intent)};
}
/** State, receipt, private history and non-sensitive audit commit together.
 * With a policy commit (R149 Gate E) the SAME transaction also carries the
 * registry policy decision: graph lock -> policy state lock -> sorted
 * participant locks -> post-lock context checks -> care mutations -> care
 * receipt (+ private history, audit) -> policy receipt + rule outcomes. The
 * participant locks already sit in the subject's policyContext, so the legacy
 * lock statements are not duplicated on the policy path. */
export async function commitCareCommand(context:CareContext,intent:Intent,receipt:CareReceipt,snapshot:unknown,mutations:D1PreparedStatement[],success:{sql:string;bindings:(string|number)[]},lockHorseIds:number[]=[context.horseId],policy?:CarePolicyCommit):Promise<CareReceipt> {
  const json=JSON.stringify(receipt),snapshotJson=JSON.stringify(snapshot);
  const operationsInsert=policy
    ? context.db.prepare(`INSERT INTO equine_care_operations(operation_id,actor_user_id,horse_id,command,request_digest,response_json,policy_revision,policy_evaluated_json) SELECT ?,?,?,?,?,?,?,? WHERE ${success.sql}`)
        .bind(intent.input.operation_id,context.auth.user.id,context.horseId,intent.command,intent.digest,json,policy.commit.outcome.policyRevision,JSON.stringify(policy.commit.outcome.evaluatedRules),...success.bindings)
    : context.db.prepare(`INSERT INTO equine_care_operations(operation_id,actor_user_id,horse_id,command,request_digest,response_json) SELECT ?,?,?,?,?,? WHERE ${success.sql}`)
        .bind(intent.input.operation_id,context.auth.user.id,context.horseId,intent.command,intent.digest,json,...success.bindings);
  const tail=[...mutations,operationsInsert,
    context.db.prepare(`INSERT INTO equine_care_history(id,horse_id,resource_type,resource_id,version,action,actor_user_id,operation_id,snapshot_json,reason) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM equine_care_operations WHERE operation_id=? AND actor_user_id=? AND request_digest=?)`)
      .bind(crypto.randomUUID(),context.horseId,receipt.resource,receipt.id,receipt.version,intent.command,context.auth.user.id,intent.input.operation_id,snapshotJson,intent.input.reason,intent.input.operation_id,context.auth.user.id,intent.digest),
    context.db.prepare(`INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,after_json,request_id) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM equine_care_operations WHERE operation_id=? AND actor_user_id=? AND request_digest=?)`)
      .bind(context.auth.user.id,`care.${intent.command}`,'equine_care',receipt.id,json,intent.input.operation_id,intent.input.operation_id,context.auth.user.id,intent.digest),
  ];
  try {
    if(policy) {
      await runRegistryPolicyBatch(context.db,tail,{...policy.commit,landed:{sql:success.sql,bindings:success.bindings}});
    } else {
      // A separate first statement locks each participant in deterministic ID
      // order. The following live-subject/grant predicates then observe a merge
      // or deletion that won the lock first on PostgreSQL READ COMMITTED. It is
      // deliberately not a snapshot-only guard in the reference INSERT itself.
      const locks=[...new Set(lockHorseIds)].sort((a,b)=>a-b).map(id=>context.db.prepare('UPDATE horses SET row_version=row_version WHERE id=?').bind(id));
      await context.db.batch([...locks,...tail]);
    }
  } catch(error) {
    // A concurrent identical request may have committed first. The failed
    // transaction was rolled back, so replay never appends history or audit.
    const replay=await storedReceipt(context,intent);if(replay)return replay;
    if(error instanceof Error && /UNIQUE constraint failed|duplicate key value/i.test(error.message))throw new HttpError(409,'care_conflict','A care record already exists with this identity or version');
    throw error;
  }
  const stored=await storedReceipt(context,intent);
  if(!stored)throw new HttpError(409,'care_state_changed','The record, session, evidence or assignment changed; reload before retrying');
  return stored;
}
export function successFor(table:string,id:string,operationId:string):{sql:string;bindings:string[]} {
  // Table names are internal literals supplied only by this service.
  return {sql:`EXISTS(SELECT 1 FROM ${table} WHERE id=? AND last_operation_id=?)`,bindings:[id,operationId]};
}
export function withoutCommand<T extends CareCommand>(input:T):Omit<T,'operation_id'|'reason'|'expected_version'|'rule_overrides'> {
  const {operation_id:_op,reason:_reason,expected_version:_version,rule_overrides:_overrides,...body}=input as T&{expected_version?:number;rule_overrides?:unknown};return body;
}

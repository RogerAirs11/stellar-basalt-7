import type { ReproductiveEpisodeInput, ReproductiveAmendInput, CareReceipt } from '../contracts/equineCare';
import { allGuards, careEvidence, careGuard, requireCarePermission, type CareContext } from './access';
import { beginCareCommand, commitCareCommand, successFor, withoutCommand } from './commands';
import { validateNotFuture } from './validation';
import { classifyBreedingSex } from '../pedigree/breeding';
import { validateParentAssignment } from '../pedigree/integrity';
import { HttpError } from '../api/http';
import { CARE_LIFECYCLE_COLUMNS,validateReproductiveLifecycles,type CareLifecycleRow } from './lifecycle';
import { prepareCarePolicy } from './policy';

async function validateParticipants(context:CareContext,input:ReproductiveEpisodeInput):Promise<Map<number,number>> {
  const ids=[...new Set([context.horseId,input.sire_id,input.recipient_dam_id,...input.offspring.map(x=>x.foal_horse_id)].filter((x):x is number=>typeof x==='number'))];
  const rows=(await context.db.prepare(`SELECT ${CARE_LIFECYCLE_COLUMNS} FROM horses WHERE id IN (${ids.map(()=>'?').join(',')}) AND deleted_at IS NULL AND is_active=1`).bind(...ids).all<CareLifecycleRow>()).results;
  if(rows.length!==ids.length)throw new HttpError(422,'invalid_participant','Each referenced participant must be an available registry horse');
  if(input.sire_id===context.horseId || input.recipient_dam_id===context.horseId || (input.sire_id && input.sire_id===input.recipient_dam_id))throw new HttpError(422,'invalid_participant','Genetic sire, genetic dam and recipient dam must be distinct horses');
  for(const row of rows){
    const sex=classifyBreedingSex(row.sex_desc);
    if((row.id===context.horseId || row.id===input.recipient_dam_id || row.id===input.sire_id) && sex==='ambiguous')throw new HttpError(422,'parent_sex_role','Conflicting sex descriptions need review before assigning reproductive roles');
    if((row.id===context.horseId || row.id===input.recipient_dam_id) && (sex==='male'||sex==='gelding'))throw new HttpError(422,'parent_sex_role','A male-role horse cannot be recorded as genetic or recipient dam');
    // A historical sire may now be a gelding. Do not confuse current fertility
    // with parentage, or prohibit a report of stored-semen use.
    if(row.id===input.sire_id && sex==='female')throw new HttpError(422,'parent_sex_role','A female-role horse cannot be recorded as genetic sire');
  }
  for(const child of input.offspring)if(child.foal_horse_id){
    if(child.foal_horse_id===input.recipient_dam_id)throw new HttpError(422,'invalid_offspring','A recipient dam cannot also be the offspring');
    const result=await validateParentAssignment(context.db,child.foal_horse_id,input.sire_id??null,context.horseId);
    if(!result.valid)throw new HttpError(422,'invalid_offspring_parentage','This reported offspring relationship is inconsistent',result.issues);
  }
  if(input.outcome!=='planned')validateNotFuture(input.covering_on,'covering_on');
  validateNotFuture(input.transfer_on,'transfer_on');validateNotFuture(input.outcome_on,'outcome_on');
  for(const material of input.stored_material??[])validateNotFuture(material.collected_on,'stored_material.collected_on');
  validateReproductiveLifecycles(rows,context.horseId,input);
  return new Map(rows.map(row=>[Number(row.id),Number(row.row_version)]));
}
export async function saveReproductiveEpisode(context:CareContext,input:ReproductiveEpisodeInput|ReproductiveAmendInput,id?:string):Promise<CareReceipt> {
  const previous=id?await context.db.prepare('SELECT version,recipient_dam_id FROM equine_reproductive_episodes WHERE id=? AND horse_id=?').bind(id,context.horseId).first<{version:number;recipient_dam_id:number|null}>():null;
  const participants=[context.horseId,...(input.recipient_dam_id?[input.recipient_dam_id]:[]),...(previous?.recipient_dam_id?[previous.recipient_dam_id]:[])];
  await requireCarePermission(context,'clinical_write',participants);
  const intent=await beginCareCommand(context,id?`reproduction.amend:${id}`:'reproduction.create',input);if(intent.receipt)return intent.receipt;
  if(id && !previous)throw new HttpError(404,'not_found','Reproductive episode not found');
  const expected='expected_version' in input?input.expected_version:0;
  if(id && previous!.version!==expected)throw new HttpError(409,'care_state_changed','The reproductive episode changed; reload before amending');
  const participantVersions=await validateParticipants(context,input);
  const linkedIds=[...new Set([...participants,...(input.sire_id?[input.sire_id]:[]),...input.offspring.flatMap(child=>child.foal_horse_id?[child.foal_horse_id]:[])])];
  // Bind the validated sex/identity snapshot to the command after its sorted
  // row locks. A canonical participant correction must force revalidation.
  const liveLinks={sql:linkedIds.map(id=>`EXISTS(SELECT 1 FROM horses WHERE id=? AND deleted_at IS NULL AND is_active=1${participantVersions.has(id)?' AND row_version=?':''})`).join(' AND '),bindings:linkedIds.flatMap(id=>participantVersions.has(id)?[id,participantVersions.get(id)!]:[id])};
  const guard=allGuards(careGuard(context,'clinical_write',participants),await careEvidence(context,input.evidence_media_id),liveLinks);
  // Gate E: same versioned policy epoch + breed/studbook care policy as the
  // canonical admission paths. Blocked failures refuse BEFORE the batch;
  // overridable failures need a per-rule reason and ride the same commit.
  const policy=await prepareCarePolicy(context,{command:id?`reproduction.amend:${id}`:'reproduction.create',method:input.method,covering_on:input.covering_on,transfer_on:input.transfer_on,offspring_count:input.offspring.length,recipient_dam_id:input.recipient_dam_id??null,sire_id:input.sire_id??null,evidence_present:!!input.evidence_media_id},linkedIds,input.rule_overrides,input.operation_id);
  const entityId=id??crypto.randomUUID(),body=withoutCommand(input),version=id?expected+1:1;
  const receipt:CareReceipt={id:entityId,resource:'reproduction',version,operation_id:input.operation_id,policy:{revision:policy.commit.outcome.policyRevision,evaluated_rules:policy.evaluated}};
  const success=successFor('equine_reproductive_episodes',entityId,input.operation_id);
  const fields=[input.sire_id??null,input.recipient_dam_id??null,input.method,input.covering_on??null,input.transfer_on??null,input.outcome_on??null,input.outcome,JSON.stringify(body),input.evidence_media_id??null];
  const statements=id?[
    context.db.prepare(`UPDATE equine_reproductive_episodes SET sire_id=?,recipient_dam_id=?,method=?,covering_on=?,transfer_on=?,outcome_on=?,outcome=?,body_json=?,evidence_media_id=?,version=version+1,last_operation_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND horse_id=? AND version=? AND ${guard.sql}`)
      .bind(...fields,input.operation_id,entityId,context.horseId,expected,...guard.bindings),
    context.db.prepare(`DELETE FROM equine_reproductive_offspring WHERE episode_id=? AND ${success.sql}`).bind(entityId,...success.bindings),
  ]:[context.db.prepare(`INSERT INTO equine_reproductive_episodes(id,horse_id,sire_id,recipient_dam_id,method,covering_on,transfer_on,outcome_on,outcome,body_json,evidence_media_id,created_by_user_id,last_operation_id) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${guard.sql}`)
    .bind(entityId,context.horseId,...fields,context.auth.user.id,input.operation_id,...guard.bindings)];
  input.offspring.forEach((child,index)=>statements.push(context.db.prepare(`INSERT INTO equine_reproductive_offspring(episode_id,ordinal,foal_horse_id,outcome,sex_at_birth,notes) SELECT ?,?,?,?,?,? WHERE ${success.sql}`)
    .bind(entityId,index+1,child.foal_horse_id??null,child.outcome,child.sex_at_birth??null,child.notes??null,...success.bindings)));
  return commitCareCommand(context,intent,receipt,body,statements,success,linkedIds,policy);
}

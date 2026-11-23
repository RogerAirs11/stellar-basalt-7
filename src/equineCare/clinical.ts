import type { ClinicalEventInput, ClinicalAmendInput, CareReceipt } from '../contracts/equineCare';
import { allGuards, careEvidence, careGuard, requireCarePermission, type CareContext } from './access';
import { beginCareCommand, commitCareCommand, successFor, withoutCommand } from './commands';
import { validateNotFuture } from './validation';
import { HttpError } from '../api/http';
import { clinicalLifecycleGuard } from './lifecycle';
import { prepareCarePolicy } from './policy';

export async function createClinicalEvent(context:CareContext,input:ClinicalEventInput):Promise<CareReceipt> {
  await requireCarePermission(context,'clinical_write');
  const intent=await beginCareCommand(context,'clinical.create',input);if(intent.receipt)return intent.receipt;
  validateNotFuture(input.occurred_on,'occurred_on');
  const guard=allGuards(careGuard(context,'clinical_write'),await careEvidence(context,input.evidence_media_id),await clinicalLifecycleGuard(context,input));
  const policy=await prepareCarePolicy(context,{command:'clinical.create',evidence_present:!!input.evidence_media_id},[context.horseId],input.rule_overrides,input.operation_id);
  const id=crypto.randomUUID(),body=withoutCommand(input);
  const receipt:CareReceipt={id,resource:'clinical',version:1,operation_id:input.operation_id,policy:{revision:policy.commit.outcome.policyRevision,evaluated_rules:policy.evaluated}};
  return commitCareCommand(context,intent,receipt,{...body,status:'recorded'},[
    context.db.prepare(`INSERT INTO equine_clinical_events(id,horse_id,event_type,occurred_on,body_json,evidence_media_id,created_by_user_id,last_operation_id) SELECT ?,?,?,?,?,?,?,? WHERE ${guard.sql}`)
      .bind(id,context.horseId,input.event_type,input.occurred_on??null,JSON.stringify(body),input.evidence_media_id??null,context.auth.user.id,input.operation_id,...guard.bindings),
  ],successFor('equine_clinical_events',id,input.operation_id),[context.horseId],policy);
}
export async function amendClinicalEvent(context:CareContext,id:string,input:ClinicalAmendInput):Promise<CareReceipt> {
  await requireCarePermission(context,'clinical_write');
  const intent=await beginCareCommand(context,`clinical.amend:${id}`,input);if(intent.receipt)return intent.receipt;
  const current=await context.db.prepare('SELECT version,status FROM equine_clinical_events WHERE id=? AND horse_id=?').bind(id,context.horseId).first<{version:number;status:string}>();
  if(!current)throw new HttpError(404,'not_found','Clinical event not found');
  if(current.version!==input.expected_version || current.status==='voided')throw new HttpError(409,'care_state_changed','Voided or newer records cannot be overwritten; create an explicitly sourced new event');
  validateNotFuture(input.occurred_on,'occurred_on');
  const guard=allGuards(careGuard(context,'clinical_write'),await careEvidence(context,input.evidence_media_id),await clinicalLifecycleGuard(context,input,input.status==='voided'));
  const policy=await prepareCarePolicy(context,{command:`clinical.amend:${id}`,evidence_present:!!input.evidence_media_id},[context.horseId],input.rule_overrides,input.operation_id);
  const body=withoutCommand(input),receipt:CareReceipt={id,resource:'clinical',version:input.expected_version+1,operation_id:input.operation_id,policy:{revision:policy.commit.outcome.policyRevision,evaluated_rules:policy.evaluated}};
  return commitCareCommand(context,intent,receipt,body,[
    context.db.prepare(`UPDATE equine_clinical_events SET event_type=?,occurred_on=?,body_json=?,evidence_media_id=?,status=?,version=version+1,last_operation_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND horse_id=? AND version=? AND status='recorded' AND ${guard.sql}`)
      .bind(input.event_type,input.occurred_on??null,JSON.stringify(body),input.evidence_media_id??null,input.status,input.operation_id,id,context.horseId,input.expected_version,...guard.bindings),
  ],successFor('equine_clinical_events',id,input.operation_id),[context.horseId],policy);
}

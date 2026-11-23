import type { SampleInput, CustodyInput, LabReportInput, LabReportReviewInput, CareReceipt } from '../contracts/equineCare';
import { allGuards, careEvidence, careGuard, requireCarePermission, type CareContext } from './access';
import { beginCareCommand, commitCareCommand, successFor, withoutCommand } from './commands';
import { validateNotFuture } from './validation';
import { normalizeIdentifierValue } from '../registry/identifiers';
import { timestampMillis } from '../security/timestamps';
import { HttpError } from '../api/http';
import { prepareCarePolicy } from './policy';

export async function createSample(context:CareContext,input:SampleInput):Promise<CareReceipt> {
  await requireCarePermission(context,'sample_submit');
  const intent=await beginCareCommand(context,'sample.create',input);if(intent.receipt)return intent.receipt;
  validateNotFuture(input.collected_on,'collected_on');
  const horse=await context.db.prepare('SELECT microchip_no,row_version FROM horses WHERE id=? AND deleted_at IS NULL').bind(context.horseId).first<{microchip_no:string|null;row_version:number}>();
  if(!horse)throw new HttpError(404,'not_found','Horse not found');
  if(input.identity_check==='microchip_matched' && (!horse.microchip_no || !input.observed_microchip || normalizeIdentifierValue(horse.microchip_no)!==normalizeIdentifierValue(input.observed_microchip)))throw new HttpError(422,'sample_identity_mismatch','A matched microchip observation must match the recorded identifier; other observations remain unconfirmed');
  const guard=allGuards(careGuard(context,'sample_submit'),await careEvidence(context,input.evidence_media_id),{sql:'EXISTS(SELECT 1 FROM horses WHERE id=? AND row_version=? AND deleted_at IS NULL)',bindings:[context.horseId,horse.row_version]});
  const policy=await prepareCarePolicy(context,{command:'sample.create',evidence_present:!!input.evidence_media_id},[context.horseId],input.rule_overrides,input.operation_id);
  const id=crypto.randomUUID(),body=withoutCommand(input),receipt:CareReceipt={id,resource:'sample',version:1,operation_id:input.operation_id,policy:{revision:policy.commit.outcome.policyRevision,evaluated_rules:policy.evaluated}};
  return commitCareCommand(context,intent,receipt,body,[context.db.prepare(`INSERT INTO equine_samples(id,horse_id,sample_ref,specimen,collected_on,identity_check,observed_microchip,body_json,evidence_media_id,created_by_user_id,last_operation_id) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE ${guard.sql}`)
    .bind(id,context.horseId,input.sample_ref,input.specimen,input.collected_on??null,input.identity_check,input.observed_microchip??null,JSON.stringify(body),input.evidence_media_id??null,context.auth.user.id,input.operation_id,...guard.bindings)],successFor('equine_samples',id,input.operation_id),[context.horseId],policy);
}
export async function appendCustodyEvent(context:CareContext,sampleId:string,input:CustodyInput):Promise<CareReceipt> {
  await requireCarePermission(context,'sample_submit');
  const intent=await beginCareCommand(context,`custody.create:${sampleId}`,input);if(intent.receipt)return intent.receipt;
  const sample=await context.db.prepare('SELECT collected_on FROM equine_samples WHERE id=? AND horse_id=?').bind(sampleId,context.horseId).first<{collected_on:string|null}>();
  if(!sample)throw new HttpError(404,'not_found','Sample not found');
  const instant=timestampMillis(input.occurred_at);
  if(instant===null || instant>Date.now() || (sample.collected_on && instant<Date.parse(`${sample.collected_on}T00:00:00Z`)))throw new HttpError(422,'invalid_custody_time','Custody observation must be after collection and not in the future');
  const guard=careGuard(context,'sample_submit');
  const policy=await prepareCarePolicy(context,{command:`custody.create:${sampleId}`,evidence_present:false},[context.horseId],input.rule_overrides,input.operation_id);
  const id=crypto.randomUUID(),body=withoutCommand(input),receipt:CareReceipt={id,resource:'custody',version:1,operation_id:input.operation_id,policy:{revision:policy.commit.outcome.policyRevision,evaluated_rules:policy.evaluated}};
  return commitCareCommand(context,intent,receipt,{sample_id:sampleId,...body},[context.db.prepare(`INSERT INTO equine_sample_custody_events(id,sample_id,event_type,occurred_at,custodian_ref,body_json,created_by_user_id,last_operation_id) SELECT ?,?,?,?,?,?,?,? WHERE ${guard.sql} AND EXISTS(SELECT 1 FROM equine_samples WHERE id=? AND horse_id=?)`)
    .bind(id,sampleId,input.event_type,new Date(instant).toISOString(),input.custodian_ref,JSON.stringify(body),context.auth.user.id,input.operation_id,...guard.bindings,sampleId,context.horseId)],successFor('equine_sample_custody_events',id,input.operation_id),[context.horseId],policy);
}
export async function createLabReport(context:CareContext,input:LabReportInput):Promise<CareReceipt> {
  await requireCarePermission(context,'sample_submit');
  const intent=await beginCareCommand(context,'report.create',input);if(intent.receipt)return intent.receipt;
  validateNotFuture(input.issued_on,'issued_on');
  const sample=await context.db.prepare('SELECT collected_on FROM equine_samples WHERE id=? AND horse_id=?').bind(input.sample_id,context.horseId).first<{collected_on:string|null}>();
  if(!sample)throw new HttpError(422,'invalid_report_sample','Report sample must belong to this horse');
  if(sample.collected_on && input.issued_on<sample.collected_on)throw new HttpError(422,'invalid_report_date','A report cannot predate collection');
  if(input.supersedes_report_id && !(await context.db.prepare('SELECT id FROM equine_lab_reports WHERE id=? AND horse_id=? AND panel_type=?').bind(input.supersedes_report_id,context.horseId,input.result.kind).first()))throw new HttpError(422,'invalid_superseded_report','The corrected report must concern this horse and result type');
  const guard=allGuards(careGuard(context,'sample_submit'),await careEvidence(context,input.evidence_media_id,input.evidence_sha256));
  const policy=await prepareCarePolicy(context,{command:'report.create',evidence_present:true},[context.horseId],input.rule_overrides,input.operation_id);
  const id=crypto.randomUUID(),body=withoutCommand(input),receipt:CareReceipt={id,resource:'report',version:1,operation_id:input.operation_id,policy:{revision:policy.commit.outcome.policyRevision,evaluated_rules:policy.evaluated}};
  return commitCareCommand(context,intent,receipt,{...body,review_state:'pending'},[context.db.prepare(`INSERT INTO equine_lab_reports(id,horse_id,sample_id,laboratory_ref,accession_ref,report_revision,issued_on,panel_type,panel_version,method,evidence_media_id,evidence_sha256,body_json,supersedes_report_id,created_by_user_id,last_operation_id) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${guard.sql} AND EXISTS(SELECT 1 FROM equine_samples WHERE id=? AND horse_id=?)`)
    .bind(id,context.horseId,input.sample_id,input.laboratory_ref,input.accession_ref,input.report_revision??'original',input.issued_on,input.result.kind,input.panel_version,input.method,input.evidence_media_id,input.evidence_sha256,JSON.stringify(body),input.supersedes_report_id??null,context.auth.user.id,input.operation_id,...guard.bindings,input.sample_id,context.horseId)],successFor('equine_lab_reports',id,input.operation_id),[context.horseId],policy);
}
export async function reviewLabReport(context:CareContext,id:string,input:LabReportReviewInput):Promise<CareReceipt> {
  await requireCarePermission(context,'evidence_review');
  const intent=await beginCareCommand(context,`report.review:${id}`,input);if(intent.receipt)return intent.receipt;
  const row=await context.db.prepare(`SELECT r.version,r.review_state,r.created_by_user_id,r.evidence_media_id,r.evidence_sha256,r.body_json,s.identity_check FROM equine_lab_reports r JOIN equine_samples s ON s.id=r.sample_id AND s.horse_id=r.horse_id WHERE r.id=? AND r.horse_id=?`)
    .bind(id,context.horseId).first<{version:number;review_state:string;created_by_user_id:string;evidence_media_id:string;evidence_sha256:string;body_json:string;identity_check:string}>();
  if(!row)throw new HttpError(404,'not_found','Lab report not found');
  if(row.created_by_user_id===context.auth.user.id && input.decision!=='withdrawn')throw new HttpError(403,'independent_review_required','The submitter cannot accept or reject their own report');
  if(row.version!==input.expected_version || !(row.review_state==='pending' && ['accepted','rejected','withdrawn'].includes(input.decision) || row.review_state==='accepted' && input.decision==='withdrawn'))throw new HttpError(409,'care_state_changed','This decision is not permitted for the current report version and state');
  if(input.decision==='accepted' && row.identity_check==='not_checked')throw new HttpError(422,'unconfirmed_sample_identity','A sample without a documented identity check cannot become accepted evidence');
  if(input.decision==='accepted')await requireCarePermission(context,'private_file_export');
  // Acceptance requires access to the evidence bytes as a distinct scope.
  // Withdrawal is always possible even after evidence quarantine.
  const evidenceGuard=input.decision==='accepted'
    ? allGuards(careGuard(context,'private_file_export'),await careEvidence(context,row.evidence_media_id,row.evidence_sha256))
    : {sql:'1=1',bindings:[]};
  const guard=allGuards(careGuard(context,'evidence_review'),evidenceGuard);
  const policy=await prepareCarePolicy(context,{command:`report.review:${id}`,evidence_present:true},[context.horseId],input.rule_overrides,input.operation_id);
  const body=withoutCommand(input),receipt:CareReceipt={id,resource:'report',version:input.expected_version+1,operation_id:input.operation_id,policy:{revision:policy.commit.outcome.policyRevision,evaluated_rules:policy.evaluated}};
  return commitCareCommand(context,intent,receipt,{report:JSON.parse(row.body_json),review:body,review_state:input.decision},[context.db.prepare(`UPDATE equine_lab_reports SET review_state=?,review_json=?,reviewed_by_user_id=?,version=version+1,last_operation_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND horse_id=? AND version=? AND review_state=? AND ${guard.sql}`)
    .bind(input.decision,JSON.stringify(body),context.auth.user.id,input.operation_id,id,context.horseId,input.expected_version,row.review_state,...guard.bindings)],successFor('equine_lab_reports',id,input.operation_id),[context.horseId],policy);
}

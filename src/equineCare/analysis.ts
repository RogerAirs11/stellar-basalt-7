import type { BaseColorCalls, LabReportInput } from '../contracts/equineCare';
import { projectBaseColor } from '../genetics/baseColor';
import { compareStrTrio, type StrProfile } from '../genetics/strParentage';
import { canonicalCareJson } from './commands';
import { careGuard, requireCarePermission, type CareContext } from './access';
import { HttpError } from '../api/http';
interface ReviewedReport {id:string;version:number;panel_version:string;body_json:string;evidence_available:number}
async function reviewedReports(context:CareContext,horseId:number,kind:'base_color'|'str_parentage'):Promise<ReviewedReport[]> {
  const subject={...context,horseId};await requireCarePermission(subject,'private_health_read');
  const guard=careGuard(subject,'private_health_read');
  const rows=(await context.db.prepare(`SELECT r.id,r.version,r.panel_version,r.body_json,CASE WHEN m.id IS NOT NULL AND m.horse_id=r.horse_id AND m.media_type='document' AND m.role='veterinary' AND m.consent_state='private' AND m.verification<>'rejected' AND m.quarantined_at IS NULL AND m.quarantine_reason IS NULL THEN 1 ELSE 0 END AS evidence_available FROM equine_lab_reports r LEFT JOIN horse_media m ON m.id=r.evidence_media_id WHERE r.horse_id=? AND r.panel_type=? AND r.review_state='accepted' AND ${guard.sql} ORDER BY r.id LIMIT 101`).bind(horseId,kind,...guard.bindings).all<ReviewedReport>()).results;
  if(!rows.length)throw new HttpError(422,'insufficient_genetic_evidence','Every participant needs accepted, supported laboratory evidence');
  if(rows.length>100 || rows.some(r=>Number(r.evidence_available)!==1))throw new HttpError(422,'evidence_review_required','Evidence is incomplete, unavailable or exceeds the review budget; review the source records before analysis');
  return rows;
}
function agree<T>(values:T[]):T {
  if(new Set(values.map(canonicalCareJson)).size!==1)throw new HttpError(409,'conflicting_genetic_evidence','Accepted reports disagree or use different panels; a reviewer must resolve the complete evidence set');
  return values[0]!;
}
export async function reviewedBaseColorProjection(context:CareContext,sireId:number,damId:number) {
  if(sireId===damId)throw new HttpError(400,'distinct_parents_required','Two distinct parent records are required');
  const sire=await reviewedReports(context,sireId,'base_color'),dam=await reviewedReports(context,damId,'base_color');
  const extract=(rows:ReviewedReport[])=>agree(rows.map(row=>{const data=JSON.parse(row.body_json) as Omit<LabReportInput,'operation_id'|'reason'>;if(data.result.kind!=='base_color')throw new HttpError(422,'invalid_stored_evidence','Stored report is inconsistent');return data.result.calls as BaseColorCalls;}));
  return {...projectBaseColor(extract(sire),extract(dam)),source_reports:{sire:sire.map(r=>({id:r.id,version:r.version})),dam:dam.map(r=>({id:r.id,version:r.version}))}};
}
export async function reviewedStrComparison(context:CareContext,childId:number,sireId:number,damId:number) {
  if(new Set([childId,sireId,damId]).size!==3)throw new HttpError(400,'distinct_trio_required','Child, sire and dam must be distinct records');
  const rows=[];for(const id of [childId,sireId,damId])rows.push(await reviewedReports(context,id,'str_parentage'));
  const extract=(reports:ReviewedReport[]):StrProfile=>agree(reports.map(row=>{const data=JSON.parse(row.body_json) as Omit<LabReportInput,'operation_id'|'reason'>;if(data.result.kind!=='str_parentage')throw new HttpError(422,'invalid_stored_evidence','Stored report is inconsistent');return {panel_version:row.panel_version,nomenclature:data.result.nomenclature,calls:data.result.calls.map(c=>({...c,marker:c.marker.toUpperCase(),alleles:[...c.alleles].sort() as [string,string]})).sort((a,b)=>a.marker.localeCompare(b.marker))};}));
  return {...compareStrTrio(extract(rows[0]!),extract(rows[1]!),extract(rows[2]!)),source_reports:{child:rows[0]!.map(r=>({id:r.id,version:r.version})),sire:rows[1]!.map(r=>({id:r.id,version:r.version})),dam:rows[2]!.map(r=>({id:r.id,version:r.version}))}};
}

import { careGuard, requireCarePermission, type CareContext } from './access';
import { HttpError } from '../api/http';

export const CARE_TABLES={clinical:'equine_clinical_events',reproduction:'equine_reproductive_episodes',samples:'equine_samples',reports:'equine_lab_reports'} as const;
export type CareCollection=keyof typeof CARE_TABLES;
interface PrivateRow {id:string;horse_id:number;version:number;body_json:string;created_at:string;status?:string;review_state?:string;review_json?:string|null;[key:string]:unknown}
async function canReadRecipient(context:CareContext,body:unknown):Promise<boolean> {
  const id=(body as {recipient_dam_id?:number|null})?.recipient_dam_id;
  if(!id)return true;
  try {await requireCarePermission(context,'private_health_read',[context.horseId,id]);return true;}
  catch(cause){if(cause instanceof HttpError && cause.status===403)return false;throw cause;}
}
function projected(row:PrivateRow) {
  const {body_json,review_json,last_operation_id:_operation,...record}=row;
  return {...record,body:JSON.parse(body_json),...(review_json?{review:JSON.parse(review_json)}:{})};
}
export async function readCareRecords(context:CareContext,collection:CareCollection,id?:string,offset=0) {
  await requireCarePermission(context,'private_health_read');
  const guard=careGuard(context,'private_health_read');
  const fields=collection==='clinical'?'id,horse_id,event_type,occurred_on,body_json,status,version,created_by_user_id,created_at,updated_at'
    :collection==='reproduction'?'id,horse_id,sire_id,recipient_dam_id,body_json,outcome,version,created_by_user_id,created_at,updated_at'
    :collection==='samples'?'id,horse_id,body_json,version,created_by_user_id,created_at'
    :'id,horse_id,body_json,review_json,review_state,version,created_by_user_id,reviewed_by_user_id,created_at,updated_at';
  const rows=(await context.db.prepare(`SELECT ${fields} FROM ${CARE_TABLES[collection]} WHERE horse_id=? ${id?'AND id=?':''} AND ${guard.sql} ORDER BY created_at DESC,id DESC LIMIT 50 OFFSET ?`).bind(context.horseId,...(id?[id]:[]),...guard.bindings,offset).all<PrivateRow>()).results;
  const records=[];
  for(const row of rows){const record=projected(row);if(collection==='reproduction' && !await canReadRecipient(context,record.body))continue;records.push(record);}
  if(id && !records.length)throw new HttpError(404,'not_found','Care record not found');
  return id?{record:records[0]}:{records,limit:50,offset,next_offset:rows.length===50?offset+50:null};
}
export async function readCareHistory(context:CareContext,collection:CareCollection,id:string) {
  await readCareRecords(context,collection,id);
  const resource=collection==='samples'?'sample':collection==='reports'?'report':collection;
  const guard=careGuard(context,'private_health_read');
  const rows=(await context.db.prepare(`SELECT version,action,actor_user_id,reason,created_at,snapshot_json FROM equine_care_history WHERE horse_id=? AND resource_type=? AND resource_id=? AND ${guard.sql} ORDER BY version DESC LIMIT 100`).bind(context.horseId,resource,id,...guard.bindings).all<{version:number;action:string;actor_user_id:string;reason:string;created_at:string;snapshot_json:string}>()).results;
  const history=[];
  for(const row of rows){
    const {snapshot_json,...record}=row,snapshot=JSON.parse(snapshot_json);
    if(collection==='reproduction' && !await canReadRecipient(context,snapshot))throw new HttpError(403,'care_permission_required','Historical recipient records require their current scoped read assignment');
    history.push({...record,snapshot});
  }
  return {history,limit:100,truncated:rows.length===100};
}
export async function readSampleCustody(context:CareContext,sampleId:string) {
  await readCareRecords(context,'samples',sampleId);
  const guard=careGuard(context,'private_health_read');
  const rows=(await context.db.prepare(`SELECT id,event_type,occurred_at,custodian_ref,body_json,created_by_user_id,created_at FROM equine_sample_custody_events WHERE sample_id=? AND ${guard.sql} ORDER BY occurred_at,id LIMIT 100`).bind(sampleId,...guard.bindings).all<{id:string;body_json:string}>()).results;
  return {events:rows.map(({body_json,...record})=>({...record,body:JSON.parse(body_json)})),limit:100,truncated:rows.length===100};
}

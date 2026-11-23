import type { D1Database } from '@cloudflare/workers-types';
import type { AuthContext } from '../auth/session';
import type { CareCapabilities, CarePermission } from '../contracts/equineCare';
import { professionalActionPredicate } from '../access/professionalAccess';
import { HttpError } from '../api/http';
import { mfaAuthorizationPredicate } from '../auth/mfaGuard';

export interface CareEnvironment {
  DB: D1Database;
  SESSION_COOKIE_NAME: string;
  APP_ENV?: string;
  EQUINE_CARE_MODE?: string;
  EQUINE_CARE_AGREEMENT_REF?: string;
  MFA_MODE?: string;
}
export interface CareContext { db:D1Database; auth:AuthContext; horseId:number }
export interface SqlGuard { sql:string; bindings:(string|number)[] }
export const CARE_LIMITATIONS = [
  'Private intake and professional record keeping only; no public publication or official certification.',
  'A local review marks evidence as reviewed within this workflow; it does not authenticate a laboratory or accredit a practitioner.',
  'Production activation requires separately reviewed agreements, access assignments, retention policy and jurisdictional approval.',
];
export function careCapability(env:CareEnvironment):Pick<CareCapabilities,'enabled'|'mode'|'official_certification'|'limitations'> {
  const local=['development','test','local','preview'].includes(env.APP_ENV??'');
  const approved=env.EQUINE_CARE_MODE==='approved_production' && env.MFA_MODE==='required' && (env.EQUINE_CARE_AGREEMENT_REF??'').trim().length>=8;
  const enabled=approved || (local && env.EQUINE_CARE_MODE==='local_review');
  return {enabled,mode:!enabled?'disabled':approved?'approved_production':'local_review',official_certification:false,limitations:CARE_LIMITATIONS};
}
export function requireCareEnabled(env:CareEnvironment):void {
  if(!careCapability(env).enabled)throw new HttpError(503,'equine_care_disabled','Private care is not activated in this environment');
}
/** Used at read AND mutation time. Generic editor/admin roles never imply care access. */
export function careGuard(context:CareContext,permission:CarePermission,horseIds:number[]=[context.horseId]):SqlGuard {
  const grants=[...new Set(horseIds)].map(horseId=>professionalActionPredicate({viewerUserId:context.auth.user.id,horseId,permission}));
  const mfa=mfaAuthorizationPredicate(context.auth);
  return {
    sql:`EXISTS(SELECT 1 FROM sessions cs JOIN users cu ON cu.id=cs.user_id WHERE cs.id=? AND cs.user_id=? AND cs.token_hash=? AND datetime(cs.expires_at)>CURRENT_TIMESTAMP AND cu.is_active=1) AND (${mfa.sql}) AND ${grants.map(g=>`(${g.sql})`).join(' AND ')}`,
    bindings:[context.auth.sessionId,context.auth.user.id,context.auth.sessionTokenHash??'',...mfa.bindings,...grants.flatMap(g=>g.bindings)],
  };
}
export function allGuards(...guards:SqlGuard[]):SqlGuard {return {sql:guards.map(g=>`(${g.sql})`).join(' AND '),bindings:guards.flatMap(g=>g.bindings)};}
/** Generic merge/reversal must pause for an explicit medical identity
 * reconciliation. Changing or archiving either subject would otherwise strand
 * private history or attach physical-sample evidence to a different identity. */
export function careIdentityMergeGuard(horseIds:number[]):SqlGuard {
  const ids=[...new Set(horseIds)];
  if(!ids.length)return {sql:'1=1',bindings:[]};
  if(ids.length>2 || ids.some(id=>!Number.isSafeInteger(id)||id<=0))throw new Error('A care identity guard needs one or two valid horse ids');
  const refs=[['equine_clinical_events','horse_id'],['equine_reproductive_episodes','horse_id'],['equine_reproductive_episodes','sire_id'],['equine_reproductive_episodes','recipient_dam_id'],['equine_reproductive_offspring','foal_horse_id'],['equine_samples','horse_id'],['equine_lab_reports','horse_id']];
  return {sql:`NOT EXISTS(${refs.map(([table,column])=>`SELECT 1 FROM ${table} WHERE ${column} IN (${ids.map(()=>'?').join(',')})`).join(' UNION ALL ')})`,bindings:refs.flatMap(()=>ids)};
}
export async function requireCarePermission(context:CareContext,permission:CarePermission,horseIds:number[]=[context.horseId]):Promise<void> {
  const guard=careGuard(context,permission,horseIds);
  const row=await context.db.prepare(`SELECT 1 AS allowed WHERE ${guard.sql}`).bind(...guard.bindings).first();
  if(!row)throw new HttpError(403,'care_permission_required','A current horse-scoped professional assignment is required for this action');
}
export async function carePermissions(context:CareContext):Promise<CarePermission[]> {
  const result:CarePermission[]=[];
  for(const permission of ['private_health_read','clinical_write','sample_submit','evidence_review','private_file_export'] as const) {
    const g=careGuard(context,permission);
    if(await context.db.prepare(`SELECT 1 AS allowed WHERE ${g.sql}`).bind(...g.bindings).first())result.push(permission);
  }
  return result;
}

/** A link never makes a private document public or grants permission to download it. */
export async function careEvidence(context:CareContext,mediaId:string|null|undefined,expectedDigest?:string):Promise<SqlGuard> {
  if(!mediaId)return {sql:'1=1',bindings:[]};
  const exportGrant=careGuard(context,'private_file_export');
  const base=`m.id=? AND m.horse_id=? AND m.media_type='document' AND m.role='veterinary' AND m.consent_state='private' AND m.verification<>'rejected' AND m.quarantined_at IS NULL AND m.quarantine_reason IS NULL AND (m.uploaded_by_user_id=? OR (${exportGrant.sql}))`;
  const bindings=[mediaId,context.horseId,context.auth.user.id,...exportGrant.bindings];
  const row=await context.db.prepare(`SELECT m.row_version,m.size_bytes FROM horse_media m WHERE ${base}`).bind(...bindings).first<{row_version:number;size_bytes:number}>();
  if(!row)throw new HttpError(422,'invalid_private_evidence','Evidence must be an accessible, private veterinary document for this horse');
  if(expectedDigest) {
    const rows=(await context.db.prepare('SELECT chunk,data FROM horse_media_blobs WHERE media_id=? ORDER BY chunk LIMIT 7').bind(mediaId).all<{chunk:number;data:ArrayBuffer|Uint8Array}>()).results;
    const parts=rows.map(r=>r.data instanceof Uint8Array?r.data:new Uint8Array(r.data));
    const total=parts.reduce((n,p)=>n+p.byteLength,0);
    if(!rows.length || rows.length>6 || total!==Number(row.size_bytes) || total>3*1024*1024 || rows.some((r,i)=>r.chunk!==i||parts[i]!.length===0||parts[i]!.length>512*1024))throw new HttpError(422,'incomplete_private_evidence','The stored evidence file is incomplete');
    const bytes=new Uint8Array(total);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
    const actual=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
    if(actual!==expectedDigest)throw new HttpError(422,'evidence_digest_mismatch','The report digest does not match the stored private evidence bytes');
  }
  return {sql:`EXISTS(SELECT 1 FROM horse_media m WHERE ${base} AND m.row_version=?)`,bindings:[...bindings,Number(row.row_version)]};
}

import { describe,it,expect } from 'vitest';
import type { D1Database,D1PreparedStatement } from '@cloudflare/workers-types';
import { openRealDatabase,seedUser,makeSession,authedRequest,countRows,type AuthedSession } from '../helpers/realDatabase';
import { routeEquineCare } from '../../src/api/modules/equineCare';
import { HttpError,error } from '../../src/api/http';
import { careIdentityMergeGuard } from '../../src/equineCare/access';

const command=()=>({operation_id:crypto.randomUUID(),reason:'Documented fictional local review fixture'});
const clinical=()=>({...command(),event_type:'examination',occurred_on:'2024-01-02',title:'Fictional examination',findings:'PRIVATE-FINDING-NEVER-IN-GLOBAL-AUDIT',source_ref:'fictional-clinician-note'});
async function grant(db:D1Database,user:string,horse:number,permissions:string[],kind='veterinarian') {
  await db.prepare(`INSERT INTO professional_access_grants(id,horse_id,grantee_user_id,professional_kind,permissions,authority_ref,assignment_ref,basis,valid_from) VALUES(?,?,?,?,?,?,?,'admin_grant','2020-01-01T00:00:00Z')`).bind(crypto.randomUUID(),horse,user,kind,permissions.join(','),'fictional-authority','fictional-assignment').run();
}
async function world() {
  const db=await openRealDatabase();
  for(const [id,role] of [['care-vet','user'],['care-reviewer','user'],['care-writer','user'],['care-editor','editor']] as const)await seedUser(db,id,role);
  await db.exec(`INSERT INTO horses(id,name_latin,sex_desc,microchip_no) VALUES(14701,'Fictional genetic dam','Mare','000123'),(14702,'Fictional recipient','Mare','000456'),(14703,'Fictional sire','Gelding','000789'),(14704,'Fictional foal one','Filly',NULL),(14705,'Fictional foal two','Colt',NULL),(14706,'Unrelated fictional mare','Mare','000999')`);
  for(const id of [14701,14702,14703,14704,14705]){
    await grant(db,'care-vet',id,['private_health_read','clinical_write','sample_submit','private_file_export']);
    await grant(db,'care-reviewer',id,['private_health_read','evidence_review','private_file_export']);
  }
  await grant(db,'care-writer',14701,['clinical_write']);
  return {db,vet:await makeSession(db,'care-vet'),reviewer:await makeSession(db,'care-reviewer'),writer:await makeSession(db,'care-writer'),editor:await makeSession(db,'care-editor')};
}
async function call(db:D1Database,path:string,body?:unknown,session?:AuthedSession,method?:string,config:Record<string,string>={}) {
  const request=authedRequest(path,body,{session,method});
  try{return (await routeEquineCare(request,{DB:db,SESSION_COOKIE_NAME:'hr_session',APP_ENV:'test',EQUINE_CARE_MODE:'local_review',...config},new URL(request.url)))!;}
  catch(cause){if(cause instanceof HttpError)return error(cause.status,cause.code,cause.message,cause.details);throw cause;}
}
const base=(horse=14701)=>`/api/horses/${horse}/care`;
async function document(db:D1Database,horse=14701) {
  const id=crypto.randomUUID(),bytes=new TextEncoder().encode('%PDF-1.4\nFictional local evidence fixture, not a clinical document\n%%EOF');
  await db.prepare(`INSERT INTO horse_media(id,horse_id,media_type,role,file_name,mime_type,size_bytes,uploaded_by_user_id,consent_state) VALUES(?,?,'document','veterinary','fictional.pdf','application/pdf',?,'care-vet','private')`).bind(id,horse,bytes.length).run();
  await db.prepare('INSERT INTO horse_media_blobs(media_id,chunk,data) VALUES(?,0,?)').bind(id,bytes).run();
  const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');return {id,digest};
}
async function sample(db:D1Database,vet:AuthedSession,horse=14701,identity='document_checked') {
  const response=await call(db,`${base(horse)}/samples`,{...command(),sample_ref:crypto.randomUUID(),specimen:'hair_root',collected_on:'2024-01-02',identity_check:identity,identity_evidence_ref:'fictional-passport-check',source_ref:'fictional-collection'},vet);
  expect(response.status).toBe(201);return ((await response.json()) as {receipt:{id:string}}).receipt.id;
}
async function report(db:D1Database,vet:AuthedSession,horse=14701,calls={MC1R:'E/e',ASIP:'A/a'},extra:Record<string,unknown>={}) {
  const sampleId=await sample(db,vet,horse),evidence=await document(db,horse);
  const input={...command(),sample_id:sampleId,laboratory_ref:'fictional-laboratory',accession_ref:crypto.randomUUID(),issued_on:'2024-01-04',panel_version:'fixture-v1',method:'fictional-assay',evidence_media_id:evidence.id,evidence_sha256:evidence.digest,result:{kind:'base_color',calls},...extra};
  const response=await call(db,`${base(horse)}/reports`,input,vet);expect(response.status).toBe(201);
  return {id:((await response.json()) as {receipt:{id:string}}).receipt.id,input,evidence};
}
const decision=(version=1,which='accepted')=>({...command(),expected_version:version,decision:which,review_ref:'fictional-independent-check',identity_checked:true,report_authenticity_checked:true,scope_checked:true});

describe('Private equine care: real sessions, routes, migrations and transactional SQL',()=>{
  it('defaults off; a production local-review flag or missing approval reference cannot activate it',async()=>{
    const {db,vet}=await world();
    expect((await call(db,`${base()}/clinical`,undefined,vet,undefined,{EQUINE_CARE_MODE:''})).status).toBe(503);
    expect((await call(db,`${base()}/clinical`,undefined,vet,undefined,{APP_ENV:'production'})).status).toBe(503);
    expect((await call(db,`${base()}/clinical`,undefined,vet,undefined,{APP_ENV:'production',EQUINE_CARE_MODE:'approved_production'})).status).toBe(503);
    expect((await call(db,`${base()}/clinical`)).status).toBe(401);
    const capability=await call(db,'/api/care/capabilities?horse_id=14701',undefined,vet);
    expect(await capability.json()).toMatchObject({enabled:true,mode:'local_review',official_certification:false});
  });
  it('keeps read/write/sample/review scopes distinct and denies an ungranted editor',async()=>{
    const {db,vet,writer,editor}=await world();
    const created=await call(db,`${base()}/clinical`,clinical(),writer);expect(created.status).toBe(201);
    expect((await call(db,`${base()}/clinical`,undefined,writer)).status).toBe(403);
    expect((await call(db,`${base()}/clinical`,undefined,editor)).status).toBe(403);
    expect((await call(db,`${base()}/samples`,{...command(),sample_ref:'fictional',specimen:'blood',identity_check:'not_checked',identity_evidence_ref:'not-checked',source_ref:'fictional'},writer)).status).toBe(403);
    const visible=await call(db,`${base()}/clinical`,undefined,vet);
    expect(visible.headers.get('cache-control')).toContain('no-store');
    expect((await visible.text())).toContain('PRIVATE-FINDING');
    const audits=await db.prepare("SELECT before_json,after_json,reason FROM audit_events WHERE action LIKE 'care.%'").all();
    expect(JSON.stringify(audits)).not.toContain('PRIVATE-FINDING');
  });
  it('binds retries to actor, horse, target and entire payload; amendments preserve history and reject stale versions',async()=>{
    const {db,vet,writer}=await world(),input=clinical();
    const response=await call(db,`${base()}/clinical`,input,vet);const original=await response.json() as {receipt:{id:string;version:number}};
    expect(response.status).toBe(201);
    expect(await (await call(db,`${base()}/clinical`,input,vet)).json()).toEqual(original);
    expect((await call(db,`${base()}/clinical`,{...input,findings:'different'},vet)).status).toBe(409);
    expect((await call(db,`${base()}/clinical`,input,writer)).status).toBe(409);
    const amend={...input,...command(),expected_version:1,status:'recorded',findings:'Amended documented observation'};
    expect((await call(db,`${base()}/clinical/${original.receipt.id}`,amend,vet,'PATCH')).status).toBe(200);
    expect((await call(db,`${base()}/clinical/${original.receipt.id}`,{...amend,...command()},vet,'PATCH')).status).toBe(409);
    expect(await countRows(db,'equine_care_history')).toBe(2);
    expect(await countRows(db,'equine_care_operations')).toBe(2);
    const history=await (await call(db,`${base()}/clinical/${original.receipt.id}/history`,undefined,vet)).json();
    expect(JSON.stringify(history)).toContain('PRIVATE-FINDING');
  });
  it('revocation between preflight and batch prevents state, receipt and history writes',async()=>{
    const {db,vet}=await world();let batches=0;
    const raced={...db,prepare:db.prepare.bind(db),batch:async(statements:D1PreparedStatement[])=>{batches++;await db.prepare("UPDATE professional_access_grants SET revoked_at=CURRENT_TIMESTAMP WHERE grantee_user_id='care-vet'").run();return db.batch(statements);}} as D1Database;
    expect((await call(raced,`${base()}/clinical`,clinical(),vet)).status).toBe(409);
    expect(batches).toBe(1);expect(await countRows(db,'equine_clinical_events')).toBe(0);
    expect(await countRows(db,'equine_care_operations')).toBe(0);expect(await countRows(db,'equine_care_history')).toBe(0);
    expect((await call(db,`${base()}/clinical`,undefined,vet)).status).toBe(403);
  });
  it('rolls the entity back if a later transaction statement fails',async()=>{
    const {db,vet}=await world();
    const faulty={...db,prepare:db.prepare.bind(db),batch:async(statements:D1PreparedStatement[])=>db.batch([...statements.slice(0,2),db.prepare('INSERT INTO nonexistent_failure_probe(value) VALUES(1)'),...statements.slice(2)])} as D1Database;
    await expect(call(faulty,`${base()}/clinical`,clinical(),vet)).rejects.toThrow();
    expect(await countRows(db,'equine_clinical_events')).toBe(0);expect(await countRows(db,'equine_care_operations')).toBe(0);
    expect(await countRows(db,'equine_care_history')).toBe(0);expect(await countRows(db,'audit_events',"action LIKE 'care.%'")).toBe(0);
  });
  it('records genetic dam, recipient and two foals without rewriting canonical pedigree, and enforces both private scopes',async()=>{
    const {db,vet,writer,reviewer}=await world();
    const input={...command(),sire_id:14703,recipient_dam_id:14702,method:'embryo_transfer',covering_on:'2023-01-01',transfer_on:'2023-01-08',outcome_on:'2023-12-01',outcome:'foaled',offspring:[{foal_horse_id:14704,outcome:'live'},{foal_horse_id:14705,outcome:'stillborn'}],source_ref:'fictional-observed-foaling'};
    expect((await call(db,`${base()}/reproduction`,input,writer)).status).toBe(403);
    const response=await call(db,`${base()}/reproduction`,input,vet);expect(response.status).toBe(201);
    const id=((await response.json()) as {receipt:{id:string}}).receipt.id;
    expect(await countRows(db,'equine_reproductive_offspring')).toBe(2);
    expect(await db.prepare('SELECT father_id,mother_id FROM horses WHERE id=14704').first()).toEqual({father_id:null,mother_id:null});
    await db.prepare("UPDATE professional_access_grants SET revoked_at=CURRENT_TIMESTAMP WHERE grantee_user_id='care-reviewer' AND horse_id=14702").run();
    expect((await call(db,`${base()}/reproduction/${id}`,undefined,reviewer)).status).toBe(404);
    const mergeGuard=careIdentityMergeGuard([14701,14706]);
    expect(await db.prepare(`SELECT 1 AS allowed WHERE ${mergeGuard.sql}`).bind(...mergeGuard.bindings).first()).toBeNull();
    expect((await call(db,`${base()}/reproduction`,{...input,...command(),transfer_on:'2022-01-01'},vet)).status).toBe(400);
  });
  it('a stale reproductive amendment cannot erase or replace offspring',async()=>{
    const {db,vet}=await world();
    const input={...command(),sire_id:14703,method:'artificial_insemination',covering_on:'2023-01-01',outcome_on:'2023-12-01',outcome:'foaled',offspring:[{foal_horse_id:14704,outcome:'live'},{foal_horse_id:14705,outcome:'live'}],source_ref:'fictional-event'};
    const r=await (await call(db,`${base()}/reproduction`,input,vet)).json() as {receipt:{id:string}};
    const amend={...input,...command(),expected_version:1,notes:'First complete revision'};
    expect((await call(db,`${base()}/reproduction/${r.receipt.id}`,amend,vet,'PATCH')).status).toBe(200);
    expect((await call(db,`${base()}/reproduction/${r.receipt.id}`,{...amend,...command(),offspring:[]},vet,'PATCH')).status).toBe(400);
    expect((await call(db,`${base()}/reproduction/${r.receipt.id}`,{...amend,...command(),offspring:[{foal_horse_id:14704,outcome:'stillborn'}]},vet,'PATCH')).status).toBe(409);
    expect(await countRows(db,'equine_reproductive_offspring')).toBe(2);
    expect(await countRows(db,'equine_care_history',"resource_type='reproduction'")).toBe(2);
  });
  it('checks sample identity, scoped custody and real dates without inventing missing dates',async()=>{
    const {db,vet}=await world();
    const input={...command(),sample_ref:'fictional-chip-sample',specimen:'blood',collected_on:'2024-01-02',identity_check:'microchip_matched',observed_microchip:'123',identity_evidence_ref:'fictional-scan',source_ref:'fictional-collection'};
    expect((await call(db,`${base()}/samples`,input,vet)).status).toBe(422);
    const made=await call(db,`${base()}/samples`,{...input,observed_microchip:'۰۰۰۱۲۳'},vet);expect(made.status).toBe(201);
    const id=((await made.json()) as {receipt:{id:string}}).receipt.id;
    const event={...command(),event_type:'received',occurred_at:'2024-01-03T12:00:00Z',custodian_ref:'fictional-lab',source_ref:'fictional-custody'};
    expect((await call(db,`${base()}/samples/${id}/custody`,event,vet)).status).toBe(201);
    expect((await call(db,`${base()}/samples/${id}/custody`,{...event,...command(),occurred_at:'2024-01-03T12:00:00'},vet)).status).toBe(400);
    expect((await call(db,`${base(14702)}/samples/${id}/custody`,{...event,...command()},vet)).status).toBe(404);
  });
  it('binds laboratory reports to actual same-horse private bytes and requires independent scoped acceptance',async()=>{
    const {db,vet,reviewer}=await world();
    const s=await sample(db,vet),doc=await document(db,14702);
    const input={...command(),sample_id:s,laboratory_ref:'fictional-lab',accession_ref:'fixture-147-acc',issued_on:'2024-01-04',panel_version:'fixture-v1',method:'fixture-assay',evidence_media_id:doc.id,evidence_sha256:doc.digest,result:{kind:'base_color',calls:{MC1R:'E/e',ASIP:'A/a'}}};
    expect((await call(db,`${base()}/reports`,input,vet)).status).toBe(422);
    const own=await document(db);expect((await call(db,`${base()}/reports`,{...input,evidence_media_id:own.id,evidence_sha256:'0'.repeat(64)},vet)).status).toBe(422);
    const r=await report(db,vet);
    await grant(db,'care-vet',14701,['evidence_review']);
    expect((await call(db,`${base()}/reports/${r.id}/review`,decision(),vet)).status).toBe(403);
    expect((await call(db,`${base()}/reports/${r.id}/review`,{...decision(),identity_checked:false},reviewer)).status).toBe(400);
    expect((await call(db,`${base()}/reports/${r.id}/review`,decision(),reviewer)).status).toBe(200);
    expect(await db.prepare('SELECT review_state,version FROM equine_lab_reports WHERE id=?').bind(r.id).first()).toEqual({review_state:'accepted',version:2});
    expect((await call(db,`${base()}/reports/${r.id}/review`,decision(1,'withdrawn'),reviewer)).status).toBe(409);
    await db.prepare("UPDATE horse_media SET quarantined_at=CURRENT_TIMESTAMP,quarantine_reason='fictional review hold' WHERE id=?").bind(r.evidence.id).run();
    expect((await call(db,`${base()}/reports/${r.id}/review`,decision(2,'withdrawn'),reviewer)).status).toBe(200);
  });
  it('requires all accepted evidence to agree and stops inference after withdrawal or quarantine',async()=>{
    const {db,vet,reviewer}=await world();
    const sire=await report(db,vet,14703,{MC1R:'e/e',ASIP:'a/a'}),dam=await report(db,vet,14701,{MC1R:'e/e',ASIP:'A/A'});
    const request={sire_id:14703,dam_id:14701};
    expect((await call(db,'/api/care/analysis/base-color',request,vet)).status).toBe(422);
    for(const [r,horse] of [[sire,14703],[dam,14701]] as const)expect((await call(db,`${base(horse)}/reports/${r.id}/review`,decision(),reviewer)).status).toBe(200);
    const projection=await call(db,'/api/care/analysis/base-color',request,vet);expect(projection.status).toBe(200);
    expect(await projection.json()).toMatchObject({base_pigment_probabilities:{chestnut:1,black:0,bay:0}});
    const conflict=await report(db,vet,14701,{MC1R:'E/E',ASIP:'A/A'});await call(db,`${base()}/reports/${conflict.id}/review`,decision(),reviewer);
    expect((await call(db,'/api/care/analysis/base-color',request,vet)).status).toBe(409);
    await call(db,`${base()}/reports/${conflict.id}/review`,decision(2,'withdrawn'),reviewer);
    await db.prepare("UPDATE horse_media SET quarantined_at=CURRENT_TIMESTAMP,quarantine_reason='fixture hold' WHERE id=?").bind(dam.evidence.id).run();
    expect((await call(db,'/api/care/analysis/base-color',request,vet)).status).toBe(422);
  });
  it('accepts an explicit revised report accession but never silently replaces accepted evidence',async()=>{
    const {db,vet,reviewer}=await world(),original=await report(db,vet);
    await call(db,`${base()}/reports/${original.id}/review`,decision(),reviewer);
    const revision={...original.input,...command(),report_revision:'corrected-1',supersedes_report_id:original.id,result:{kind:'base_color',calls:{MC1R:'E/E',ASIP:'A/A'}}};
    expect((await call(db,`${base()}/reports`,revision,vet)).status).toBe(201);
    expect(await db.prepare('SELECT review_state FROM equine_lab_reports WHERE id=?').bind(original.id).first()).toEqual({review_state:'accepted'});
  });
  it('uses reviewed STR trio evidence through the real route without issuing parentage confirmation',async()=>{
    const {db,vet,reviewer}=await world();
    const profiles:[[string,string],number][]=[[['100','102'],14704],[['100','104'],14703],[['102','106'],14701]];
    for(const [alleles,horse] of profiles){
      const result={kind:'str_parentage',nomenclature:'fictional-allele-convention',calls:Array.from({length:12},(_,i)=>({marker:`M${String(i).padStart(2,'0')}`,alleles,quality:'pass'}))};
      const r=await report(db,vet,horse,undefined,{result});
      expect((await call(db,`${base(horse)}/reports/${r.id}/review`,decision(),reviewer)).status).toBe(200);
    }
    const input={child_id:14704,sire_id:14703,dam_id:14701};
    const response=await call(db,'/api/care/analysis/str-parentage',input,vet);expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({status:'compatible_at_tested_markers',compared_markers:12,official_parentage_confirmed:false,probability_of_parentage:null});
    await db.prepare("UPDATE professional_access_grants SET revoked_at=CURRENT_TIMESTAMP WHERE grantee_user_id='care-vet' AND horse_id=14704").run();
    expect((await call(db,'/api/care/analysis/str-parentage',input,vet)).status).toBe(403);
  });
  it('rechecks every reproduction participant after locks, including a sire withheld before commit',async()=>{
    const {db,vet}=await world();
    const raced={...db,prepare:db.prepare.bind(db),batch:async(statements:D1PreparedStatement[])=>{await db.prepare('UPDATE horses SET is_active=0,row_version=row_version+1 WHERE id=14703').run();return db.batch(statements);}} as D1Database;
    const input={...command(),sire_id:14703,method:'artificial_insemination',covering_on:'2023-01-01',outcome:'covered',offspring:[],source_ref:'fictional-event'};
    expect((await call(raced,`${base()}/reproduction`,input,vet)).status).toBe(409);
    expect(await countRows(db,'equine_reproductive_episodes')).toBe(0);expect(await countRows(db,'equine_care_history')).toBe(0);
  });
  it('rejects a participant sex or pedigree correction that wins after preflight validation',async()=>{
    const {db,vet}=await world();
    const raced={...db,prepare:db.prepare.bind(db),batch:async(statements:D1PreparedStatement[])=>{await db.prepare("UPDATE horses SET sex_desc='Female',row_version=row_version+1 WHERE id=14703").run();return db.batch(statements);}} as D1Database;
    const input={...command(),sire_id:14703,method:'artificial_insemination',covering_on:'2023-01-01',outcome_on:'2023-12-01',outcome:'foaled',offspring:[{foal_horse_id:14704,outcome:'live'}],source_ref:'fictional-event'};
    expect((await call(raced,`${base()}/reproduction`,input,vet)).status).toBe(409);
    expect(await countRows(db,'equine_reproductive_episodes')).toBe(0);expect(await countRows(db,'equine_reproductive_offspring')).toBe(0);
    expect(await countRows(db,'equine_care_operations')).toBe(0);expect(await countRows(db,'equine_care_history')).toBe(0);
  });
});

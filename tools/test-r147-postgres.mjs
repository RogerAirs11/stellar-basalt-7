#!/usr/bin/env node
/**
 * R147 PostgreSQL rehearsal against an explicitly owned disposable cluster.
 * No environment database URLs are read. Pass --cluster-state=/absolute/path
 * to the 0600 receipt produced by the local, verified-runtime bootstrap.
 * Creates and drops only a new random hr_test_* schema, never public objects.
 * The production Worker, sessions, SQL translator and D1-compatible adapter
 * execute every HTTP command below; fixtures are entirely fictional.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { applyMigrationChain } from '../scripts/lib/pg-ddl.mjs';
import { createOwnedSchema, disposableSchemaName, requireDisposableLocalDatabase } from '../scripts/lib/disposable-schema.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const args=new Map(process.argv.slice(2).map(arg=>{const at=arg.indexOf('=');return [arg.slice(0,at),arg.slice(at+1)];}));
assert.ok(args.has('--cluster-state'),'An explicit owned-cluster receipt is required; no environment target is accepted');
const statePath=resolve(args.get('--cluster-state'));
assert.equal((await stat(statePath)).mode & 0o077,0,'Cluster credentials must be private to the owner');
const state=JSON.parse(await readFile(statePath,'utf8'));
assert.equal(state.owned_runtime,'r147-disposable-postgres');
assert.equal(state.host,'127.0.0.1');assert.equal(state.database,'postgres');assert.equal(state.user,'postgres');
assert.match(basename(state.base),/^hr_test_r147_pg_[a-z0-9_]+$/);
assert.equal(state.data,`${state.base}/data`);
assert.ok(Number.isSafeInteger(state.port)&&state.port>1024&&state.port<65536);
assert.ok(typeof state.password==='string'&&state.password.length>=32);
const connection=`postgres://postgres:${encodeURIComponent(state.password)}@127.0.0.1:${state.port}/postgres`;
requireDisposableLocalDatabase(connection,'yes');
const out=resolve(args.get('--report')??resolve(root,'../evidence/r147-postgres.json'));
const require=createRequire(import.meta.url);require('./lib/register-typescript.cjs');
const worker=require('../src/worker.ts').default;
const {createSupabaseD1Database,closeSupabaseD1Database}=require('../src/db/supabaseCompat.ts');
const {seedUser,makeSession,authedRequest}=require('../tests/helpers/realDatabase.ts');
const report={started_at:new Date().toISOString(),boundary:'New random schema in owned loopback PostgreSQL; actual Worker and production adapter; fictional records; no existing database URL or external service',checks:[]};
const scrub=value=>String(value).replaceAll(connection,'[owned local connection]').replaceAll(state.password,'[generated test credential]');
const pass=(id,detail)=>{report.checks.push({id,pass:true,detail});console.log(`PASS ${id}: ${detail}`);};
let admin,seed,ownedSchema,target;
const sessions={};
const limiter={limit:async()=>({success:true})};
const command=()=>({operation_id:randomUUID(),reason:'Fictional disposable PostgreSQL verification'});
const clinical=()=>({...command(),event_type:'examination',occurred_on:'2024-01-02',title:'Fictional examination',findings:'PRIVATE-PG-FINDING',source_ref:'fictional-local-clinician'});
const base=(horse=14701)=>`/api/horses/${horse}/care`;
const assertStatus=(reply,status)=>assert.equal(reply.status,status,JSON.stringify(reply.body));
const number=async(query,bindings=[])=>Number((await admin.unsafe(query,bindings))[0].n);

async function request(path,body,actor='vet',method,wrap) {
  const db=createSupabaseD1Database(target,{mode:'full'});
  try {
    // Separate fictional actors use documentation-only IPs. This keeps the
    // real fixed-window limiter enabled without collapsing the entire
    // multi-actor rehearsal into the missing-header "anonymous" bucket.
    const actorIps={vet:'192.0.2.10',reviewer:'192.0.2.11',writer:'192.0.2.12',admin:'192.0.2.13',owner:'192.0.2.14',stranger:'192.0.2.15'};
    const response=await worker.fetch(authedRequest(path,body,{session:actor?sessions[actor]:undefined,method,headers:{'cf-connecting-ip':actorIps[actor]??'192.0.2.16'}}),{
      DB:wrap?wrap(db):db,DB_PROVIDER_MODE:'d1_full',APP_ENV:'test',SESSION_COOKIE_NAME:'hr_session',
      EQUINE_CARE_MODE:'local_review',ASSETS:{fetch:async()=>new Response('unused')},
      PUBLIC_RATE_LIMITER:limiter,AUTH_RATE_LIMITER:limiter,EXPENSIVE_RATE_LIMITER:limiter,WRITE_RATE_LIMITER:limiter,ACCOUNT_RATE_LIMITER:limiter,
    });
    const text=await response.text();let responseBody;try{responseBody=JSON.parse(text);}catch{responseBody={text};}
    return {status:response.status,body:responseBody,cache_control:response.headers.get('cache-control')};
  } finally {await closeSupabaseD1Database(db);}
}
async function grant(user,horse,permissions) {
  await seed.prepare(`INSERT INTO professional_access_grants(id,horse_id,grantee_user_id,professional_kind,permissions,authority_ref,assignment_ref,basis,valid_from)
    VALUES(?,?,?,'veterinarian',?,?,?,'admin_grant','2020-01-01T00:00:00Z')`)
    .bind(randomUUID(),horse,user,permissions.join(','),'fictional-authority','fictional-assignment').run();
}
function pairBarrier() {
  let arrivals=0,release;
  const ready=new Promise(resolve=>{release=resolve;});
  return db=>({...db,async batch(statements){
    arrivals++;if(arrivals===2)release();
    let timer;try{await Promise.race([ready,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Two-request pre-batch barrier timed out')),5000);})]);}
    finally{clearTimeout(timer);}return db.batch(statements);
  }});
}
async function waitForLockWaiters(minimum=1) {
  const end=Date.now()+5000;
  while(Date.now()<end){
    const n=await number(`SELECT COUNT(*) n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()
      AND wait_event_type='Lock' AND query LIKE '%row_version=row_version%'`);
    if(n>=minimum)return n;
    await new Promise(resolve=>setTimeout(resolve,25));
  }
  throw new Error(`Expected ${minimum} real blocked PostgreSQL writer(s)`);
}
async function withBlocker(work) {
  const blocker=postgres(target,{max:1,prepare:false,fetch_types:false,onnotice:()=>{}});
  try{return await work(blocker);}finally{await blocker.unsafe('ROLLBACK').catch(()=>{});await blocker.end({timeout:1});}
}
async function document(horse) {
  const id=randomUUID(),bytes=new TextEncoder().encode('%PDF-1.4\nFictional local PostgreSQL evidence only\n%%EOF');
  await seed.prepare(`INSERT INTO horse_media(id,horse_id,media_type,role,file_name,mime_type,size_bytes,uploaded_by_user_id,consent_state)
    VALUES(?,?,'document','veterinary','fictional.pdf','application/pdf',?,'r147-pg-vet','private')`).bind(id,horse,bytes.length).run();
  await seed.prepare('INSERT INTO horse_media_blobs(media_id,chunk,data) VALUES(?,0,?)').bind(id,bytes).run();
  return {id,digest:Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex')};
}
async function reviewedReport(horse,result) {
  const sample=await request(`${base(horse)}/samples`,{...command(),sample_ref:randomUUID(),specimen:'hair_root',collected_on:'2024-01-02',identity_check:'document_checked',identity_evidence_ref:'fictional-passport',source_ref:'fictional-collection'});
  assertStatus(sample,201);const evidence=await document(horse);
  const created=await request(`${base(horse)}/reports`,{...command(),sample_id:sample.body.receipt.id,laboratory_ref:'fictional-laboratory',accession_ref:randomUUID(),issued_on:'2024-01-04',panel_version:'fictional-pg-v1',method:'fictional-assay',evidence_media_id:evidence.id,evidence_sha256:evidence.digest,result});
  assertStatus(created,201);
  const review=await request(`${base(horse)}/reports/${created.body.receipt.id}/review`,{...command(),expected_version:1,decision:'accepted',review_ref:'fictional-independent-check',identity_checked:true,report_authenticity_checked:true,scope_checked:true},'reviewer');
  assertStatus(review,200);return created.body.receipt.id;
}

try {
  admin=postgres(connection,{max:1,prepare:false,fetch_types:false,onnotice:()=>{}});
  const version=(await admin.unsafe('SELECT version() v'))[0].v;
  assert.match(version,/PostgreSQL 18\./);report.server_version=version;
  ownedSchema=await createOwnedSchema(admin,disposableSchemaName());
  await admin.unsafe(`SET search_path TO ${ownedSchema}`);
  report.migrations=await applyMigrationChain(admin);
  pass('migration-chain',`${report.migrations.applied} migrations execute on PostgreSQL; ${report.migrations.skippedFts} SQLite-only FTS declarations intentionally skipped by established mapping`);
  const parsed=new URL(connection);parsed.searchParams.set('options',`-c search_path=${ownedSchema}`);target=parsed.href;
  seed=createSupabaseD1Database(target,{mode:'full'});
  for(const [actor,role] of [['vet','user'],['reviewer','user'],['writer','user'],['admin','admin'],['owner','user'],['stranger','user']]){
    const id=`r147-pg-${actor}`;await seedUser(seed,id,role);sessions[actor]=await makeSession(seed,id);
  }
  await admin.unsafe(`INSERT INTO horses(id,name_latin,sex_desc,microchip_no) VALUES
    (14701,'Fictional PG genetic dam','Mare','000123'),(14702,'Fictional PG recipient','Mare','000456'),
    (14703,'Fictional PG historical sire','Gelding','000789'),(14704,'Fictional PG foal one','Filly',NULL),
    (14705,'Fictional PG foal two','Colt',NULL),(14706,'Fictional PG metadata subject','Mare',NULL),
    (14750,'Fictional PG ungranted foal','Colt',NULL)`);
  for(const horse of [14701,14702,14703,14704,14705]){
    await grant('r147-pg-vet',horse,['private_health_read','clinical_write','sample_submit','private_file_export']);
    await grant('r147-pg-reviewer',horse,['private_health_read','evidence_review','private_file_export']);
  }
  await grant('r147-pg-writer',14701,['clinical_write']);
  assertStatus(await request(`${base()}/clinical`,undefined,null),401);
  assertStatus(await request(`${base()}/clinical`,undefined,'writer'),403);
  assertStatus(await request(`${base()}/clinical`,undefined,'admin'),403);
  const created=await request(`${base()}/clinical`,clinical(),'writer');assertStatus(created,201);
  const visible=await request(`${base()}/clinical`);assertStatus(visible,200);assert.match(visible.cache_control,/no-store/);
  assert.ok(!JSON.stringify(await admin.unsafe("SELECT before_json,after_json,reason FROM audit_events WHERE action LIKE 'care.%'")).includes('PRIVATE-PG-FINDING'));
  pass('private-care-scopes','Real sessions separate writer, reader, reviewer and generic administrator; private route is no-store and global audit excludes findings');

  const same=clinical(),before=await number('SELECT COUNT(*) n FROM equine_clinical_events'),sameBarrier=pairBarrier();
  const sameReplies=await Promise.all([request(`${base()}/clinical`,same,'vet',undefined,sameBarrier),request(`${base()}/clinical`,same,'vet',undefined,sameBarrier)]);
  sameReplies.forEach(reply=>assertStatus(reply,201));assert.deepEqual(sameReplies[0].body,sameReplies[1].body);
  assert.equal(await number('SELECT COUNT(*) n FROM equine_clinical_events'),before+1);
  assert.equal(await number('SELECT COUNT(*) n FROM equine_care_operations WHERE operation_id=$1',[same.operation_id]),1);
  assert.equal(await number('SELECT COUNT(*) n FROM equine_care_history WHERE operation_id=$1',[same.operation_id]),1);
  assertStatus(await request(`${base()}/clinical`,{...same,findings:'Changed payload'}),409);
  pass('same-operation-two-connections','Both actual requests pass preflight together; exactly one entity, receipt and history commit, and both receive the same receipt');

  const clinicalId=sameReplies[0].body.receipt.id,amendBarrier=pairBarrier();
  const amendment={...clinical(),expected_version:1,status:'recorded'};
  const amendments=await Promise.all([request(`${base()}/clinical/${clinicalId}`,amendment,'vet','PATCH',amendBarrier),request(`${base()}/clinical/${clinicalId}`,{...amendment,...command(),findings:'Competing revision'},'vet','PATCH',amendBarrier)]);
  assert.deepEqual(amendments.map(x=>x.status).sort(),[200,409]);
  assert.equal(await number('SELECT COUNT(*) n FROM equine_care_history WHERE resource_id=$1',[clinicalId]),2);
  pass('clinical-cas-two-connections','Two edits of the same version yield one 200 and one 409; history preserves exactly the original and winning amendment');

  const rollbackInput=clinical(),rollbackBefore=await number('SELECT COUNT(*) n FROM equine_clinical_events');
  const faulty=db=>({...db,batch:statements=>db.batch([...statements.slice(0,2),db.prepare('INSERT INTO missing_r147_failure_probe(value) VALUES(1)'),...statements.slice(2)])});
  assertStatus(await request(`${base()}/clinical`,rollbackInput,'vet',undefined,faulty),500);
  assert.equal(await number('SELECT COUNT(*) n FROM equine_clinical_events'),rollbackBefore);
  assert.equal(await number('SELECT COUNT(*) n FROM equine_care_operations WHERE operation_id=$1',[rollbackInput.operation_id]),0);
  assert.equal(await number('SELECT COUNT(*) n FROM equine_care_history WHERE operation_id=$1',[rollbackInput.operation_id]),0);
  pass('care-transaction-rollback','Injected later SQL failure rolls back the earlier clinical insert and leaves no receipt or private history');

  const reproInput={...command(),sire_id:14703,recipient_dam_id:14702,method:'embryo_transfer',covering_on:'2023-01-01',transfer_on:'2023-01-08',outcome_on:'2023-12-01',outcome:'foaled',offspring:[{foal_horse_id:14704,outcome:'live'},{foal_horse_id:14705,outcome:'stillborn'}],source_ref:'fictional-observed-foaling'};
  const repro=await request(`${base()}/reproduction`,reproInput);assertStatus(repro,201);
  assert.equal(await number('SELECT COUNT(*) n FROM equine_reproductive_offspring WHERE episode_id=$1',[repro.body.receipt.id]),2);
  assert.deepEqual((await admin.unsafe('SELECT father_id,mother_id FROM horses WHERE id=14704'))[0],{father_id:null,mother_id:null});
  pass('reproduction-and-offspring','Genetic dam, recipient, historical gelded sire and two offspring persist together without changing canonical parent links');

  await admin.unsafe("UPDATE horses SET death_date_value='2020-01-01',death_date_precision='day',death_date_calendar='gregorian',is_dead=1,life_status='dead',row_version=row_version+1 WHERE id=14701");
  assertStatus(await request(`${base()}/clinical`,{...clinical(),event_type:'vaccination'}),422);
  assertStatus(await request(`${base()}/reproduction`,{...reproInput,...command(),recipient_dam_id:null,method:'natural_cover',transfer_on:null}),422);
  assertStatus(await request(`${base()}/clinical`,{...clinical(),event_type:'diagnosis',lifecycle_context:{kind:'postmortem',evidence_ref:'fictional-necropsy-record',justification:'Fictional sourced postmortem investigation'}}),201);
  await admin.unsafe("UPDATE horses SET death_date_value=NULL,death_date_precision=NULL,death_date_calendar=NULL,is_dead=0,life_status='unknown',row_version=row_version+1 WHERE id=14701");
  await admin.unsafe("UPDATE horses SET death_date_value='2020-01-01',death_date_precision='day',death_date_calendar='gregorian',is_dead=1,life_status='dead',row_version=row_version+1 WHERE id=14703");
  const storedSemen={...reproInput,...command(),recipient_dam_id:null,method:'artificial_insemination',transfer_on:null};
  assertStatus(await request(`${base()}/reproduction`,storedSemen),422);
  assertStatus(await request(`${base()}/reproduction`,{...storedSemen,...command(),stored_material:[{donor_horse_id:14703,material:'semen',collected_on:'2019-01-01',evidence_ref:'fictional-semen-storage-record',justification:'Fictional sourced stored semen used after donor death'}]}),201);
  await admin.unsafe("UPDATE horses SET death_date_value=NULL,death_date_precision=NULL,death_date_calendar=NULL,is_dead=0,life_status='unknown',row_version=row_version+1 WHERE id=14703");
  const lifecycleDrift=clinical();
  await withBlocker(async blocker=>{
    await blocker.unsafe('BEGIN');await blocker.unsafe("UPDATE horses SET death_date_value='2020-01-01',death_date_precision='day',death_date_calendar='gregorian',is_dead=1,life_status='dead',row_version=row_version+1 WHERE id=14701");
    const pending=request(`${base()}/clinical`,lifecycleDrift);
    try{await waitForLockWaiters();await blocker.unsafe('COMMIT');assertStatus(await pending,409);}
    finally{await blocker.unsafe('ROLLBACK').catch(()=>{});await pending;}
  });
  assert.equal(await number('SELECT COUNT(*) n FROM equine_care_operations WHERE operation_id=$1',[lifecycleDrift.operation_id]),0);
  await admin.unsafe("UPDATE horses SET death_date_value=NULL,death_date_precision=NULL,death_date_calendar=NULL,row_version=row_version+1 WHERE id=14701");
  assertStatus(await request(`${base()}/reproduction`,{...reproInput,...command(),recipient_dam_id:null,method:'natural_cover',transfer_on:null,covering_on:new Date(Date.now()+86400000*30).toISOString().slice(0,10),outcome_on:null,outcome:'planned',offspring:[]}),422);
  await admin.unsafe("UPDATE horses SET death_date_value=NULL,death_date_precision=NULL,death_date_calendar=NULL,is_dead=0,life_status='unknown',row_version=row_version+1 WHERE id=14701");
  pass('typed-lifecycle-and-stored-material','Postdeath vaccination/foaling and future physical covering of an undated deceased horse fail; explicit postmortem diagnosis and sourced compatible stored semen succeed; canonical death changing behind a real row-lock wait prevents the stale clinical write');

  const drift={...reproInput,...command()};
  await withBlocker(async blocker=>{
    await blocker.unsafe('BEGIN');await blocker.unsafe("UPDATE horses SET sex_desc='Female',row_version=row_version+1 WHERE id=14703");
    const pending=request(`${base()}/reproduction`,drift);
    try{await waitForLockWaiters();await blocker.unsafe('COMMIT');assertStatus(await pending,409);}
    finally{await blocker.unsafe('ROLLBACK').catch(()=>{});await pending;}
  });
  assert.equal(await number('SELECT COUNT(*) n FROM equine_care_operations WHERE operation_id=$1',[drift.operation_id]),0);
  await admin.unsafe("UPDATE horses SET sex_desc='Gelding',row_version=row_version+1 WHERE id=14703");
  pass('participant-drift-after-real-lock-wait','A second connection changes sire sex/version while holding its row lock; the waiting actual care request rejects the stale participant snapshot after commit');

  await reviewedReport(14701,{kind:'base_color',calls:{MC1R:'E/e',ASIP:'A/a'}});
  await reviewedReport(14703,{kind:'base_color',calls:{MC1R:'E/e',ASIP:'A/a'}});
  const color=await request('/api/care/analysis/base-color',{sire_id:14703,dam_id:14701});assertStatus(color,200);
  assert.deepEqual(color.body.base_pigment_probabilities,{chestnut:0.25,black:0.1875,bay:0.5625});
  for(const [horse,alleles] of [[14704,['100','102']],[14703,['100','104']],[14701,['102','106']]]){
    await reviewedReport(horse,{kind:'str_parentage',nomenclature:'fictional-pg-allele-convention',calls:Array.from({length:12},(_,index)=>({marker:`M${String(index).padStart(2,'0')}`,alleles,quality:'pass'}))});
  }
  const str=await request('/api/care/analysis/str-parentage',{child_id:14704,sire_id:14703,dam_id:14701});assertStatus(str,200);
  assert.equal(str.body.status,'compatible_at_tested_markers');assert.equal(str.body.official_parentage_confirmed,false);assert.equal(str.body.probability_of_parentage,null);
  pass('sample-report-review-and-bounded-science','Actual private bytea evidence, hash verification, sample intake and independent review feed expected Mendelian base pigment and bounded STR compatibility results');

  const fieldKey='extra_pg_discipline',definition={type:'select',label:{en:'Fictional training discipline'},visibility:'public',filter_enabled:true,options:[{value:'dressage',label:{en:'Dressage'}},{value:'jumping',label:{en:'Jumping'}}]};
  assertStatus(await request('/api/admin/metadata/fields',{...command(),key:fieldKey,definition},'admin'),201);
  assertStatus(await request(`/api/admin/metadata/fields/${fieldKey}/activate`,{...command(),expected_revision:1,version:1},'admin'),200);
  const value={...command(),expected_version:0,definition_version:1,value:'dressage',source_ref:'fictional-reviewed-source'};
  assertStatus(await request(`/api/admin/horses/14706/supplementary/${fieldKey}`,value,'admin','PUT'),200);
  const metadataBarrier=pairBarrier();
  const valueReplies=await Promise.all(['dressage','jumping'].map(next=>request(`/api/admin/horses/14706/supplementary/${fieldKey}`,{...value,...command(),expected_version:1,value:next},'admin','PUT',metadataBarrier)));
  assert.deepEqual(valueReplies.map(x=>x.status).sort(),[200,409]);
  await withBlocker(async blocker=>{
    await blocker.unsafe('BEGIN');await blocker.unsafe('UPDATE registry_metadata_fields SET active_version=NULL,revision=revision+1 WHERE field_key=$1',[fieldKey]);
    const pending=request(`/api/admin/horses/14706/supplementary/${fieldKey}`,{...value,...command(),expected_version:2},'admin','PUT');
    try{
      const end=Date.now()+5000;let blocked=false;
      while(Date.now()<end){blocked=await number("SELECT COUNT(*) n FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%UPDATE registry_metadata_fields SET revision=revision%'")>0;if(blocked)break;await new Promise(resolve=>setTimeout(resolve,25));}
      assert.equal(blocked,true,'Metadata writer waited for the real definition row lock');
      await blocker.unsafe('COMMIT');assertStatus(await pending,409);
    }finally{await blocker.unsafe('ROLLBACK').catch(()=>{});await pending;}
  });
  assertStatus(await request('/api/horses/14706',{},'admin','DELETE'),409);
  pass('metadata-cas-activation-and-archive','Real concurrent value edits yield one winner; an activation change held on another connection prevents a stale value write; retained values block generic archive');

  const submission={name_latin:'Fictional PostgreSQL registration',birth_name:'Fictional first name',previous_names:['Fictional former name'],passport_no:'۰۰۷',passport_issuer:'Fictional Studbook',uel_no:'PG00123',life_number:'PG00555',passport_issue_date:{value:'2024-04',precision:'month',calendar:'gregorian'},passport_expiry:{value:'2035',precision:'year',calendar:'gregorian'},height_cm:154.5,markings:'Fictional white star',life_status:'alive'};
  const draft=await request('/api/change-requests',{request_type:'create_horse',submit:false,submission},'owner');assertStatus(draft,201);
  const requestId=draft.body.request.id;
  const evidence={role:'passport',file_name:'fictional-passport.pdf',mime_type:'application/pdf',data_base64:btoa('%PDF-1.4\nFictional PostgreSQL evidence\n%%EOF'),operation_id:randomUUID()};
  const firstEvidence=await request(`/api/change-requests/${requestId}/evidence`,evidence,'owner');assertStatus(firstEvidence,201);
  assertStatus(await request(`/api/change-requests/${requestId}/evidence`,{...evidence,operation_id:randomUUID()},'owner'),201);
  assertStatus(await request(`/api/change-requests/${requestId}/evidence`,undefined,'stranger'),404);
  const evidenceBarrier=pairBarrier();
  const deletes=await Promise.all([request(`/api/change-requests/${requestId}/evidence/${firstEvidence.body.evidence.id}`,{},'owner','DELETE',evidenceBarrier),request(`/api/change-requests/${requestId}/evidence/${firstEvidence.body.evidence.id}`,{},'owner','DELETE',evidenceBarrier)]);
  assert.deepEqual(deletes.map(x=>x.status).sort(),[200,409]);
  assert.equal(await number('SELECT evidence_file_count n FROM change_requests WHERE id=$1',[requestId]),1);
  assert.equal(await number('SELECT COUNT(*) n FROM request_evidence WHERE request_id=$1 AND deleted_at IS NULL',[requestId]),1);
  assertStatus(await request(`/api/change-requests/${requestId}/submit`,{},'owner'),200);
  const approval=await request(`/api/admin/change-requests/${requestId}/review`,{decision:'approved',note:'Fictional PostgreSQL reviewer'},'admin');assertStatus(approval,200);
  const registered=Number(approval.body.canonical_horse_id);
  assert.equal(await number("SELECT COUNT(*) n FROM horse_identifiers WHERE horse_id=$1 AND kind='passport_no' AND normalized_value='007'",[registered]),1);
  assert.equal(await number('SELECT COUNT(*) n FROM horse_aliases WHERE horse_id=$1',[registered]),2);
  pass('registration-private-evidence-and-delete-race','Real draft upload and unrelated-reader denial; two simultaneous deletes decrement once, retain the other file, and reviewed registration creates scoped passport identity plus aliases');

  const contestedRepro={...reproInput,...command(),recipient_dam_id:null,method:'artificial_insemination',transfer_on:null,offspring:[{foal_horse_id:14750,outcome:'live'}]};
  await withBlocker(async blocker=>{
    await blocker.unsafe('BEGIN');await blocker.unsafe('UPDATE horses SET row_version=row_version WHERE id=14750');
    const care=request(`${base()}/reproduction`,contestedRepro);let archive;
    try{
      await waitForLockWaiters();archive=request('/api/horses/14750',{},'admin','DELETE');
      await waitForLockWaiters(2);await blocker.unsafe('COMMIT');
      const results=await Promise.all([care,archive]);
      assert.ok((results[0].status===201&&results[1].status===409)||(results[0].status===409&&results[1].status===200),JSON.stringify(results));
      report.identity_race_statuses={care:results[0].status,archive:results[1].status};
    }finally{await blocker.unsafe('ROLLBACK').catch(()=>{});await Promise.allSettled([care,...(archive?[archive]:[])]);}
  });
  const identity=await admin.unsafe(`SELECT h.deleted_at,(SELECT COUNT(*) FROM equine_reproductive_offspring o WHERE o.foal_horse_id=h.id) AS references FROM horses h WHERE h.id=14750`);
  assert.ok(identity[0].deleted_at===null||Number(identity[0].references)===0,'An archived horse cannot acquire the racing care reference');
  pass('archive-versus-new-care-reference-two-connections','Both real Worker commands reach PostgreSQL while an independent connection holds the foal row; only one succeeds and no archived subject receives a care reference');
  report.success=true;
} catch(error) {
  report.success=false;report.failure={name:error.name,message:scrub(error.message)};process.exitCode=1;
  console.error(scrub(error.stack));
} finally {
  if(seed)await closeSupabaseD1Database(seed).catch(()=>{});
  if(admin){if(ownedSchema)await admin.unsafe(`DROP SCHEMA ${ownedSchema} CASCADE`).catch(error=>{report.cleanup_error=scrub(error.message);process.exitCode=1;});await admin.end({timeout:1});}
  report.finished_at=new Date().toISOString();report.owned_schema_removed=Boolean(ownedSchema&&!report.cleanup_error);
  await mkdir(dirname(out),{recursive:true});await writeFile(out,JSON.stringify(report,null,2)+'\n');
  console.log(`Evidence: ${out}`);
}

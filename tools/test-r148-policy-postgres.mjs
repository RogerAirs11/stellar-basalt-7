#!/usr/bin/env node
/** Actual Worker + production PostgreSQL adapter, real two-connection locks.
 * Requires an explicit 0600 receipt for this task's owned loopback cluster.
 * Never reads an environment database URL or modifies an existing schema. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { applyMigrationChain } from '../scripts/lib/pg-ddl.mjs';
import { createOwnedSchema, disposableSchemaName, requireDisposableLocalDatabase } from '../scripts/lib/disposable-schema.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Map(process.argv.slice(2).map(arg => { const at=arg.indexOf('='); return [arg.slice(0,at),arg.slice(at+1)]; }));
assert.ok(args.has('--cluster-state'), 'An explicit owned local cluster receipt is required');
const statePath=resolve(args.get('--cluster-state'));
assert.equal((await stat(statePath)).mode & 0o077,0);
const state=JSON.parse(await readFile(statePath,'utf8'));
assert.equal(state.owned_runtime,'r148-disposable-postgres');
assert.equal(state.host,'127.0.0.1'); assert.equal(state.database,'postgres'); assert.equal(state.user,'postgres');
assert.match(basename(state.base),/^hr_test_r148_pg_[a-z0-9_]+$/); assert.equal(state.data,`${state.base}/data`);
assert.ok(Number.isSafeInteger(state.port)&&state.port>1024&&state.port<65536); assert.ok(state.password.length>=32);
const connection=`postgres://postgres:${encodeURIComponent(state.password)}@127.0.0.1:${state.port}/postgres`;
requireDisposableLocalDatabase(connection,'yes');
const output=resolve(args.get('--report')??resolve(root,'../evidence/r148-policy-postgres.json'));
const require=createRequire(import.meta.url); require('./lib/register-typescript.cjs');
const worker=require('../src/worker.ts').default;
const {createSupabaseD1Database,closeSupabaseD1Database}=require('../src/db/supabaseCompat.ts');
const {seedUser,makeSession,authedRequest}=require('../tests/helpers/realDatabase.ts');
const {recordFieldClaims}=require('../src/api/modules/fieldClaims.ts');
const report={started_at:new Date().toISOString(),boundary:'Owned loopback cluster, newly created random schema, actual Worker/production adapter, independent real PostgreSQL connections, fictional fixtures only',checks:[]};
const scrub=value=>String(value).replaceAll(connection,'[owned local connection]').replaceAll(state.password,'[generated test credential]');
const pass=(id,detail)=>{report.checks.push({id,pass:true,detail}); console.log(`PASS ${id}: ${detail}`);};
const limiter={limit:async()=>({success:true})};
let admin,seed,ownedSchema,target;
const sessions={};
const status=(reply,expected)=>assert.equal(reply.status,expected,JSON.stringify(reply.body));
const number=async(sql,bindings=[])=>Number((await admin.unsafe(sql,bindings))[0].n);
async function request(path,body,actor='editor',method) {
  const db=createSupabaseD1Database(target,{mode:'full'});
  try {
    const response=await worker.fetch(authedRequest(path,body,{session:sessions[actor],method,headers:{'cf-connecting-ip':actor==='admin'?'192.0.2.51':'192.0.2.52'}}),{
      DB:db,DB_PROVIDER_MODE:'d1_full',APP_ENV:'test',SESSION_COOKIE_NAME:'hr_session',ASSETS:{fetch:async()=>new Response('unused')},
      PUBLIC_RATE_LIMITER:limiter,AUTH_RATE_LIMITER:limiter,EXPENSIVE_RATE_LIMITER:limiter,WRITE_RATE_LIMITER:limiter,ACCOUNT_RATE_LIMITER:limiter,
    });
    const text=await response.text();let bodyResult;try{bodyResult=JSON.parse(text);}catch{bodyResult={text};}
    return {status:response.status,body:bodyResult};
  } finally {await closeSupabaseD1Database(db);}
}
async function snapshot() {
  const tables=['horses','horse_identifiers','registry_policy_receipts','registry_rule_outcomes','canonical_mutation_log','audit_events','field_claim_decisions'];
  return {counts:await Promise.all(tables.map(table=>number(`SELECT COUNT(*) n FROM ${table}`))),
    horse:(await admin.unsafe('SELECT name_latin,birth_year,row_version,last_mutation_id FROM horses WHERE id=14801'))[0],
    state:(await admin.unsafe('SELECT canonical_revision,analytics_stale FROM registry_state WHERE id=1'))[0]};
}
async function waitForBlocked(queryPart) {
  const until=Date.now()+4500;
  while(Date.now()<until){
    const rows=await admin.unsafe(`SELECT a.pid FROM pg_stat_activity a WHERE a.datname=current_database()
      AND a.wait_event_type='Lock' AND a.query ILIKE $1 AND a.pid<>pg_backend_pid()`,[`%${queryPart}%`]);
    if(rows.length){
      // MFA wraps the mutation batch. Its prefix must preserve the adapter's
      // first graph marker, or this held advisory lock would be absent.
      const graph=await admin.unsafe("SELECT COUNT(*) n FROM pg_locks WHERE pid=$1 AND locktype='advisory' AND granted",[rows[0].pid]);
      assert.ok(Number(graph[0].n)>=1,'Waiting canonical writer must already hold the real graph advisory lock');
      return;
    }
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  throw new Error(`A real PostgreSQL writer did not block on ${queryPart}`);
}
async function barrier(change,attempt,queryPart) {
  const blocker=postgres(target,{max:1,prepare:false,fetch_types:false,onnotice:()=>{}}); let pending;
  try {
    await blocker.unsafe('BEGIN'); await change(blocker);
    pending=attempt(); await waitForBlocked(queryPart); await blocker.unsafe('COMMIT');
    const reply=await pending; status(reply,409); assert.equal(reply.body.error.code,'registry_policy_context_changed');
  } finally {await blocker.unsafe('ROLLBACK').catch(()=>{}); if(pending)await pending; await blocker.end({timeout:1});}
}
async function retireAll() {
  for(const row of await admin.unsafe("SELECT id,version FROM registry_rules WHERE state='active' ORDER BY id")) {
    status(await request(`/api/admin/registry-rules/${row.id}`,{expected_version:Number(row.version),state:'retired'},'admin'),200);
  }
}
async function draftRule(id,severity='blocker',spec={require_document:true},ruleType='required_evidence') {
  status(await request('/api/admin/registry-rules',{id,rule_type:ruleType,title:`Fictional policy ${id}`,severity,spec},'admin'),201);
}
async function activeRule(id,severity='blocker',spec={require_document:true},ruleType='required_evidence') {
  await draftRule(id,severity,spec,ruleType);
  for(const [expected_version,state] of [[1,'report_only'],[2,'active']]) status(await request(`/api/admin/registry-rules/${id}`,{expected_version,state},'admin'),200);
}
/** The independent control transaction holds the SAME singleton lock and
 * applies the ordered draft/report-only/active history, before committing.
 * The actual Worker can read the old committed empty set then has to wait. */
async function activateLocked(blocker,id) {
  await blocker.unsafe('UPDATE registry_policy_state SET revision=revision WHERE id=1');
  for(const [version,state] of [[2,'report_only'],[3,'active']]) {
    await blocker.unsafe('UPDATE registry_rules SET state=$1,version=$2,last_policy_operation_id=$3 WHERE id=$4',[state,version,randomUUID(),id]);
    await blocker.unsafe(`INSERT INTO registry_rule_versions(rule_id,version,state,title,severity,applicability_json,spec_json,changed_by,change_note)
      SELECT id,version,state,title,severity,applicability_json,spec_json,'r148-policy-admin','Independent controlled lock transaction' FROM registry_rules WHERE id=$1`,[id]);
    await blocker.unsafe('UPDATE registry_policy_state SET revision=revision+1 WHERE id=1');
  }
}
async function stage(name) {
  const source=(await admin.unsafe("INSERT INTO import_sources(name,issuer_namespace,scope_note,redistribution_allowed) VALUES($1,$2,'Fictional disposable fixture',1) RETURNING id",[name,name]))[0].id;
  const response=await request('/api/admin/imports/stage',{source_id:Number(source),file_name:'fixture.json',mapping_version:'v1',rows:[{external_id:'row-one',name_latin:name,register_no:name}]});status(response,201);return response.body.batch;
}
async function claim() { return (await recordFieldClaims(seed,14801,[{field_name:'birth_year',claimed_value:2012,source_type:'owner_statement',source_ref:randomUUID()}]))[0].claim_id; }

try {
  admin=postgres(connection,{max:1,prepare:false,fetch_types:false,onnotice:()=>{}});
  report.server_version=(await admin.unsafe('SELECT version() v'))[0].v; assert.match(report.server_version,/PostgreSQL 18\./);
  ownedSchema=await createOwnedSchema(admin,disposableSchemaName());await admin.unsafe(`SET search_path TO ${ownedSchema}`);
  report.migrations=await applyMigrationChain(admin);pass('migration-chain',`${report.migrations.applied} migrations executed through the production translator`);
  const parsed=new URL(connection);parsed.searchParams.set('options',`-c search_path=${ownedSchema}`);target=parsed.href;
  seed=createSupabaseD1Database(target,{mode:'full'});
  for(const [actor,role] of [['editor','editor'],['admin','admin']]) {const id=`r148-policy-${actor}`;await seedUser(seed,id,role);sessions[actor]=await makeSession(seed,id);}
  await admin.unsafe("INSERT INTO horses(id,name_latin,birth_year,sex_desc) VALUES(14801,'Fictional Policy Mare',2015,'Mare'),(14802,'Fictional Policy Sire',2000,'Stallion')");

  for(const kind of ['create','update','review','import','claim','reversal']) {
    await retireAll();let attempt;
    if(kind==='create') attempt=()=>request('/api/horses',{id:14803,name_latin:'First policy create',birth_year:2020});
    else if(kind==='update') attempt=()=>request('/api/horses/14801',{expected_row_version:1,changes:{name_latin:'Stale update'}},'editor','PATCH');
    else if(kind==='review') {
      const created=await request('/api/change-requests',{horse_id:14801,request_type:'update_horse',submit:false,summary:'Fictional reviewed correction',items:[{field_name:'name_latin',old_value:'Fictional Policy Mare',proposed_value:'Stale reviewed name'}]});status(created,201);
      attempt=()=>request(`/api/admin/change-requests/${created.body.request.id}/review`,{decision:'approved'},'admin');
    } else if(kind==='import') {const batch=await stage('PolicyImportFirst');attempt=()=>request(`/api/admin/imports/batches/${batch.id}/apply`,{});}
    else {
      const id=await claim();
      if(kind==='claim') attempt=()=>request(`/api/admin/horses/14801/field-claims/${id}/select`,{reason:'Fictional source selection'});
      else {
        status(await request(`/api/admin/horses/14801/field-claims/${id}/select`,{reason:'Fictional source selection'}),200);
        const decision=(await admin.unsafe("SELECT id FROM field_claim_decisions WHERE claim_id=$1 AND decision='select_claim'",[id]))[0].id;
        attempt=()=>request(`/api/admin/horses/14801/field-claims/decisions/${decision}/revert`,{reason:'Fictional correction reversal'});
      }
    }
    const id=`policy.first.${kind}`;await draftRule(id);const before=await snapshot();
    await barrier(blocker=>activateLocked(blocker,id),attempt,'UPDATE registry_policy_state');
    assert.deepEqual(await snapshot(),before);pass(`empty-to-active-${kind}`,'Actual Worker read the empty set, waited on an independent policy transaction, then returned409 with no canonical, journal, audit or rule-receipt residue; graph lock preserved through MFA wrapper');
  }

  await retireAll();await activeRule('policy.parent','blocker',{min_parent_age_gap_years:4},'chronology');const beforeParent=await snapshot();
  await barrier(blocker=>blocker.unsafe('UPDATE horses SET birth_year=2019,row_version=row_version+1 WHERE id=14802'),
    ()=>request('/api/horses',{id:14804,name_latin:'Stale child context',birth_year:2020,father_id:14802}),'UPDATE horses SET row_version=row_version');
  assert.deepEqual(await snapshot(),beforeParent);pass('parent-row-lock','A changed parent version/birth context behind a real PostgreSQL row-lock wait cannot be accepted');
  await retireAll();await activeRule('policy.photo','blocker',{require_photo:true});
  await seed.prepare("INSERT INTO horse_media(id,horse_id,media_type,file_name,mime_type,size_bytes,verification) VALUES('policy-photo',14801,'photo','fixture.png','image/png',4,'owner_submitted')").run();
  await seed.prepare("INSERT INTO horse_media_blobs(media_id,chunk,data) VALUES('policy-photo',0,?)").bind(new Uint8Array([1,2,3,4])).run();
  const version=Number((await admin.unsafe('SELECT row_version FROM horses WHERE id=14801'))[0].row_version),beforeMedia=await snapshot();
  await barrier(blocker=>blocker.unsafe("UPDATE horse_media SET verification='rejected',row_version=row_version+1 WHERE id='policy-photo'"),
    ()=>request('/api/horses/14801',{expected_row_version:version,changes:{name_latin:'Stale evidence update'}},'editor','PATCH'),'UPDATE horse_media SET verification=verification');
  assert.deepEqual(await snapshot(),beforeMedia);pass('evidence-row-lock','Rejected evidence behind a real media-row lock invalidates acceptance without changing the horse version');

  await retireAll();await activeRule('policy.receipt','warning');
  const override={rule_overrides:[{rule_id:'policy.receipt',reason:'Reviewed fictional local fixture exception'}]};
  const beforeReceipt=await snapshot();
  await admin.unsafe("CREATE FUNCTION fail_policy_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced policy receipt failure'; END $$");
  await admin.unsafe('CREATE TRIGGER fail_policy_receipt BEFORE INSERT ON registry_rule_outcomes FOR EACH ROW EXECUTE FUNCTION fail_policy_receipt()');
  status(await request('/api/horses',{id:14805,name_latin:'Atomic receipt fixture',microchip_no:'001481805',...override}),500);
  assert.deepEqual(await snapshot(),beforeReceipt);pass('receipt-storage-rollback','Actual PostgreSQL trigger failure rolls back horse, identifier, canonical revision, intent and acceptance/override receipts together');
  await admin.unsafe('DROP TRIGGER fail_policy_receipt ON registry_rule_outcomes');
  status(await request('/api/horses',{id:14805,name_latin:'Atomic receipt fixture',microchip_no:'001481805',...override}),201);
  assert.equal(await number("SELECT COUNT(*) n FROM registry_rule_outcomes WHERE rule_id='policy.receipt' AND outcome='override'"),1);
  pass('receipt-retry','After storage recovers, one canonical create and one version-linked override receipt commit');

  const sourceBatch=await stage('PolicySourceRace'),beforeSource=await snapshot();
  await barrier(blocker=>blocker.unsafe("UPDATE import_sources SET license_note='Changed licence context' WHERE id=$1",[sourceBatch.source_id]),
    ()=>request(`/api/admin/imports/batches/${sourceBatch.id}/apply`,override),'UPDATE import_sources SET is_synthetic=is_synthetic');
  assert.deepEqual(await snapshot(),beforeSource);assert.equal((await admin.unsafe('SELECT outcome FROM import_staging_rows WHERE batch_id=$1',[sourceBatch.id]))[0].outcome,'pending');
  pass('source-agreement-row-lock','Source licence change behind a real independent source-row lock keeps the import pending with no canonical or receipt residue');

  const replayBatch=await stage('PolicyConcurrentImport');
  const replies=await Promise.all([request(`/api/admin/imports/batches/${replayBatch.id}/apply`,override),request(`/api/admin/imports/batches/${replayBatch.id}/apply`,override)]);
  replies.forEach(reply=>status(reply,200));
  assert.equal(await number("SELECT COUNT(*) n FROM horses WHERE register_no='PolicyConcurrentImport'"),1);
  const row=(await admin.unsafe('SELECT id FROM import_staging_rows WHERE batch_id=$1',[replayBatch.id]))[0];
  assert.equal(await number('SELECT COUNT(*) n FROM registry_policy_receipts WHERE subject_ref=$1',[`batch:${replayBatch.id}:row:${row.id}`]),1);
  assert.equal(await number('SELECT COUNT(*) n FROM registry_rule_outcomes WHERE subject_ref=$1',[`batch:${replayBatch.id}:row:${row.id}`]),1);
  pass('concurrent-import-replay','Two actual PostgreSQL Worker requests yield one horse, one accepted row and one override/acceptance receipt');

  await retireAll();await activeRule('policy.private-evidence');
  const evidenceVersion=Number((await admin.unsafe('SELECT row_version FROM horses WHERE id=14801'))[0].row_version);
  const evidenceEdit={expected_row_version:evidenceVersion,changes:{name_latin:'Ordinary evidence acceptance'}};
  const absentEvidence=await request('/api/horses/14801',evidenceEdit,'editor','PATCH');status(absentEvidence,422);
  for(const [id,role] of [['private-veterinary-file','veterinary'],['private-bound-file','passport']]) {
    await seed.prepare("INSERT INTO horse_media(id,horse_id,media_type,role,file_name,mime_type,size_bytes,verification) VALUES(?,14801,'document',?,'fictional.pdf','application/pdf',4,'owner_submitted')").bind(id,role).run();
    await seed.prepare('INSERT INTO horse_media_blobs(media_id,chunk,data) VALUES(?,0,?)').bind(id,new Uint8Array([1,2,3,4])).run();
  }
  await admin.unsafe("INSERT INTO genetic_tests(horse_id,test_type,result,certificate_media_id) VALUES(14801,'SCID','private-fixture','private-bound-file')");
  const privateEvidence=await request('/api/horses/14801',evidenceEdit,'editor','PATCH');status(privateEvidence,422);
  assert.deepEqual(privateEvidence.body,absentEvidence.body);
  await seed.prepare("INSERT INTO horse_media(id,horse_id,media_type,role,file_name,mime_type,size_bytes,verification) VALUES('ordinary-document',14801,'document','passport','fictional.pdf','application/pdf',4,'owner_submitted')").run();
  await seed.prepare("INSERT INTO horse_media_blobs(media_id,chunk,data) VALUES('ordinary-document',0,?)").bind(new Uint8Array([1,2,3,4])).run();
  status(await request('/api/horses/14801',evidenceEdit,'editor','PATCH'),200);
  const evidenceContext=(await admin.unsafe('SELECT r.context_json FROM registry_policy_receipts r JOIN horses h ON h.last_mutation_id=r.operation_id WHERE h.id=14801'))[0].context_json;
  assert.equal(JSON.parse(evidenceContext).record.evidence_document_count,1);assert.match(evidenceContext,/ordinary-document/);assert.doesNotMatch(evidenceContext,/private-veterinary-file|private-bound-file/);
  pass('private-evidence-exclusion','Veterinary and legacy genetic-bound media leave generic admission responses identical to no evidence; ordinary registration documents still pass and only eligible file IDs reach receipts');
  const beforeBinding=await snapshot();
  await barrier(async blocker=>{
    await blocker.unsafe('UPDATE horses SET row_version=row_version WHERE id=14801');
    await blocker.unsafe("INSERT INTO equine_clinical_events(id,horse_id,event_type,body_json,evidence_media_id,created_by_user_id,last_operation_id) VALUES('private-clinical-binding',14801,'examination','{}','ordinary-document','r148-policy-admin','private-clinical-binding-operation')");
  },()=>request('/api/horses/14801',{expected_row_version:evidenceVersion+1,changes:{name_latin:'Stale evidence classification'}},'editor','PATCH'),'UPDATE horses SET row_version=row_version');
  assert.deepEqual(await snapshot(),beforeBinding);
  pass('clinical-binding-row-lock','A real independent clinical evidence binding commits behind the shared subject lock; stale ordinary-admission context returns409 with no canonical or receipt residue');
  report.ok=true;
} catch(error) {report.ok=false;report.error=scrub(error?.stack??error);console.error(report.error);process.exitCode=1;}
finally {
  if(seed)await closeSupabaseD1Database(seed);
  if(admin&&ownedSchema){try{await admin.unsafe(`DROP SCHEMA ${ownedSchema} CASCADE`);report.cleaned_owned_schema=true;}catch(error){report.cleanup_error=scrub(error);process.exitCode=1;}}
  if(admin)await admin.end({timeout:1});report.finished_at=new Date().toISOString();
  await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2));console.log(`Evidence: ${output}`);
}

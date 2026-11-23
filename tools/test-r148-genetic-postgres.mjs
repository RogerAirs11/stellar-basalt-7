#!/usr/bin/env node
/** Actual Worker/production adapter rehearsal in one newly owned PostgreSQL
 * schema. No environment URLs, external services or real records are used. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname,resolve,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import postgres from 'postgres';
import {applyMigrationChain} from '../scripts/lib/pg-ddl.mjs';
import {createOwnedSchema,disposableSchemaName,requireDisposableLocalDatabase} from '../scripts/lib/disposable-schema.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const args=new Map(process.argv.slice(2).map(arg=>{const at=arg.indexOf('=');return[arg.slice(0,at),arg.slice(at+1)];}));
assert.ok(args.has('--cluster-state'),'Explicit owned local cluster receipt required');
const receiptPath=resolve(args.get('--cluster-state'));assert.equal((await stat(receiptPath)).mode&0o077,0);
const state=JSON.parse(await readFile(receiptPath,'utf8'));
assert.equal(state.owned_runtime,'r148-disposable-postgres');assert.equal(state.host,'127.0.0.1');assert.equal(state.database,'postgres');assert.equal(state.user,'postgres');
assert.match(basename(state.base),/^hr_test_r148_pg_[a-z0-9_]+$/);assert.equal(state.data,`${state.base}/data`);
assert.ok(Number.isSafeInteger(state.port)&&state.port>1024&&state.port<65536);assert.ok(typeof state.password==='string'&&state.password.length>=32);
const connection=`postgres://postgres:${encodeURIComponent(state.password)}@127.0.0.1:${state.port}/postgres`;requireDisposableLocalDatabase(connection,'yes');
const out=resolve(args.get('--report')??resolve(root,'../evidence/r148-genetic-postgres.json'));
const require=createRequire(import.meta.url);require('./lib/register-typescript.cjs');
const worker=require('../src/worker.ts').default;
const {createSupabaseD1Database,closeSupabaseD1Database}=require('../src/db/supabaseCompat.ts');
const {seedUser,makeSession,authedRequest}=require('../tests/helpers/realDatabase.ts');
const report={started_at:new Date().toISOString(),boundary:'New random disposable schema; actual Worker HTTP, production PostgreSQL adapter, real concurrent connections; synthetic records only',checks:[]};
const scrub=value=>String(value).replaceAll(connection,'[owned local connection]').replaceAll(state.password,'[generated test credential]');
const pass=(id,detail)=>{report.checks.push({id,pass:true,detail});console.log(`PASS ${id}: ${detail}`);};
let admin,seed,target,ownedSchema;const sessions={};const limiter={limit:async()=>({success:true})};
const signingSecret='synthetic-local-private-file-signing-secret';
async function http(path,body,actor='reviewer',wrap){
  const db=createSupabaseD1Database(target,{mode:'full'});
  try{
    const actorIps={reviewer:'192.0.2.41',reviewer2:'192.0.2.42',author:'192.0.2.43',reader:'192.0.2.44',publisher:'192.0.2.45',admin:'192.0.2.46'};
    const response=await worker.fetch(authedRequest(path,body,{session:actor?sessions[actor]:undefined,headers:{'cf-connecting-ip':actorIps[actor]??'192.0.2.47'}}),{
      DB:wrap?wrap(db):db,APP_ENV:'test',DB_PROVIDER_MODE:'d1_full',SESSION_COOKIE_NAME:'hr_session',MFA_MODE:'optional',MEDIA_ACCESS_TOKEN_SECRET:signingSecret,
      ASSETS:{fetch:async()=>new Response('unused')},PUBLIC_RATE_LIMITER:limiter,AUTH_RATE_LIMITER:limiter,EXPENSIVE_RATE_LIMITER:limiter,WRITE_RATE_LIMITER:limiter,ACCOUNT_RATE_LIMITER:limiter,
    });
    const text=await response.text();let responseBody;try{responseBody=JSON.parse(text);}catch{responseBody={text};}return{status:response.status,body:responseBody};
  }finally{await closeSupabaseD1Database(db);}
}
const status=(response,wanted)=>assert.equal(response.status,wanted,JSON.stringify(response.body));
const count=async(sql,binds=[])=>Number((await admin.unsafe(sql,binds))[0].n);
async function grant(actor,horse,permissions){const id=randomUUID();await seed.prepare(`INSERT INTO professional_access_grants(id,horse_id,grantee_user_id,professional_kind,permissions,authority_ref,assignment_ref,basis,granted_by_user_id,valid_from)
  VALUES(?,?,?,'veterinarian',?,'SYNTHETIC-AUTHORITY','SYNTHETIC-ASSIGNMENT','admin_grant','gp-admin','2020-01-01')`).bind(id,horse,`gp-${actor}`,permissions.join(',')).run();return id;}
const intake=()=>({operation_id:randomUUID(),test_type:'SCID',test_category:'disease',result:'N/SCID',lab_accession:'PRIVATE-PG-ACCESSION',notes:'PRIVATE-PG-NOTE'});
const review=(extra={})=>({operation_id:randomUUID(),expected_version:1,result_status:'carrier',verification:'confirm_record',evidence_ref:'SYNTHETIC-REPORT',legacy_origin_acknowledged:true,reason:'Synthetic independent PostgreSQL report review',note:'PRIVATE-PG-REVIEW',...extra});
const publish=(extra={})=>({public_disclosed:true,expected_decision_version:0,basis:'owner_consent',purpose:'Synthetic publication scope',evidence_ref:'SYNTHETIC-CONSENT',reason:'PRIVATE-PG-PUBLICATION-REASON',...extra});
function barrier(){let arrived=0,release;const ready=new Promise(resolve=>{release=resolve;});return db=>({...db,async batch(statements){arrived++;if(arrived===2)release();let timer;try{await Promise.race([ready,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Concurrent request barrier timed out')),5000);})]);}finally{clearTimeout(timer);}return db.batch(statements);}});}
async function waitForGeneticLock(){const until=Date.now()+5000;while(Date.now()<until){const n=await count("SELECT COUNT(*) n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%UPDATE genetic_tests SET row_version=row_version%'");if(n)return;await new Promise(resolve=>setTimeout(resolve,25));}throw new Error('No actual PostgreSQL genetic writer lock wait was observed');}
async function blockedReviewThenRevoke(testId,grantId){
  const blocker=postgres(target,{max:1,prepare:false,fetch_types:false,onnotice:()=>{}});let pending;
  try{await blocker.unsafe('BEGIN');await blocker.unsafe('UPDATE genetic_tests SET row_version=row_version WHERE id=$1',[testId]);
    const input=review();pending=http(`/api/admin/genetic-tests/${testId}/interpretation`,input);
    await waitForGeneticLock();await admin.unsafe('UPDATE professional_access_grants SET revoked_at=CURRENT_TIMESTAMP WHERE id=$1',[grantId]);
    await blocker.unsafe('COMMIT');const result=await pending;status(result,403);
    assert.equal(await count('SELECT row_version n FROM genetic_tests WHERE id=$1',[testId]),1);
    assert.equal(await count('SELECT COUNT(*) n FROM genetic_evidence_operations WHERE operation_id=$1',[input.operation_id]),0);
  }finally{await blocker.unsafe('ROLLBACK').catch(()=>{});if(pending)await pending.catch(()=>{});await blocker.end({timeout:1});}
}
try{
  admin=postgres(connection,{max:1,prepare:false,fetch_types:false,onnotice:()=>{}});
  report.server_version=(await admin.unsafe('SELECT version() v'))[0].v;assert.match(report.server_version,/PostgreSQL 18\./);
  ownedSchema=await createOwnedSchema(admin,disposableSchemaName());await admin.unsafe(`SET search_path TO ${ownedSchema}`);report.migrations=await applyMigrationChain(admin);
  const parsed=new URL(connection);parsed.searchParams.set('options',`-c search_path=${ownedSchema}`);target=parsed.href;
  seed=createSupabaseD1Database(target,{mode:'full'});
  for(const actor of ['author','reviewer','reviewer2','reader','publisher','admin']){await seedUser(seed,`gp-${actor}`,actor==='admin'?'admin':'user');sessions[actor]=await makeSession(seed,`gp-${actor}`);}
  await admin.unsafe(`INSERT INTO horses(id,name_latin,sex_desc) VALUES(14801,'Synthetic PG sire','Stallion'),(14802,'Synthetic PG dam','Mare');
    INSERT INTO genetic_tests(id,horse_id,test_type,test_category,result,verified,lab_accession,notes,created_by_user_id) VALUES
      (148001,14801,'SCID','disease','N/SCID',1,'PRIVATE-PG-ACCESSION','PRIVATE-PG-NOTE','gp-author'),
      (148002,14802,'SCID','disease','N/N',1,'PRIVATE-DAM-ACCESSION','PRIVATE-DAM-NOTE','gp-author');
    INSERT INTO genetic_pairing_reviews(test_id,assay_key,result_snapshot,test_type_snapshot,reviewed_by_user_id,last_operation_id,review_note) VALUES
      (148001,'SCID','N/SCID','SCID','gp-reviewer','seed-sire','Synthetic review'),(148002,'SCID','N/N','SCID','gp-reviewer','seed-dam','Synthetic review');`);
  await grant('author',14801,['genetic_intake']);const reviewerGrant=await grant('reviewer',14801,['genetic_evidence_read','genetic_review']);
  await grant('reviewer2',14801,['genetic_evidence_read','genetic_review']);await grant('reader',14801,['private_health_read','private_file_export']);await grant('publisher',14801,['genetic_publish']);
  pass('migration-chain',`${report.migrations.applied} migrations executed in owned PostgreSQL schema`);
  const ordinary=await http('/api/horses/14801/genetics',undefined,'admin');status(ordinary,200);assert.deepEqual(ordinary.body.tests,[]);
  const read=await http('/api/horses/14801/genetics',undefined,'reader');status(read,200);assert.equal(read.body.tests.length,1);assert.equal(read.body.tests[0].lab_accession,null);
  const evidence=await http('/api/horses/14801/genetics');status(evidence,200);assert.equal(evidence.body.tests[0].lab_accession,'PRIVATE-PG-ACCESSION');
  status(await http('/api/admin/genetic-tests/148001/disclosure',publish()),403);
  pass('scoped-read-matrix','Generic admin cannot read private tests; result reader cannot read accession; evidence reviewer cannot publish');
  const pairPath='/api/breeding/pairing-evidence?sire=14801&dam=14802';assert.equal((await http(pairPath,undefined,'reader')).body.calculableVariants,0);
  const damGrant=await grant('reader',14802,['private_health_read']);assert.equal((await http(pairPath,undefined,'reader')).body.calculableVariants,1);
  await admin.unsafe('UPDATE professional_access_grants SET revoked_at=CURRENT_TIMESTAMP WHERE id=$1',[damGrant]);assert.equal((await http(pairPath,undefined,'reader')).body.calculableVariants,0);
  pass('mixed-parent-pairing','Each parent has independent current authority; revoking only the dam removes calculability without leaking hidden counts');
  const same=intake(),sameBarrier=barrier();const created=await Promise.all([http('/api/horses/14801/genetics',same,'author',sameBarrier),http('/api/horses/14801/genetics',same,'author',sameBarrier)]);
  assert.deepEqual(created.map(value=>value.status).sort(),[200,201]);assert.deepEqual(created[0].body.test,created[1].body.test);
  assert.equal(await count('SELECT COUNT(*) n FROM genetic_tests WHERE intake_operation_id=$1',[same.operation_id]),1);
  const id=created[0].body.test.id;assert.ok(!JSON.stringify(created).includes('PRIVATE-PG-'));
  pass('intake-idempotency-two-connections','Simultaneous same-intent intake creates one unverified/private report and returns payload-free identical receipts');
  const concurrent=barrier();const decisions=await Promise.all([http(`/api/admin/genetic-tests/${id}/interpretation`,review(),'reviewer',concurrent),http(`/api/admin/genetic-tests/${id}/interpretation`,review(),'reviewer2',concurrent)]);
  assert.deepEqual(decisions.map(value=>value.status).sort(),[200,409]);assert.equal(await count('SELECT row_version n FROM genetic_tests WHERE id=$1',[id]),2);
  assert.equal(await count("SELECT COUNT(*) n FROM genetic_evidence_operations WHERE test_id=$1 AND action='interpretation'",[id]),1);
  assert.equal((await admin.unsafe('SELECT result,public_disclosed FROM genetic_tests WHERE id=$1',[id]))[0].result,'N/SCID');
  assert.equal(Number((await admin.unsafe('SELECT public_disclosed FROM genetic_tests WHERE id=$1',[id]))[0].public_disclosed),0);
  pass('independent-review-cas-two-connections','Two real reviewers race one report version; exactly one succeeds and source result stays intact/unpublished');
  const confirm=review({expected_version:2,verification:'unchanged'}),replayBarrier=barrier();const replays=await Promise.all([http(`/api/admin/genetic-tests/${id}/interpretation`,confirm,'reviewer',replayBarrier),http(`/api/admin/genetic-tests/${id}/interpretation`,confirm,'reviewer',replayBarrier)]);
  replays.forEach(value=>status(value,200));assert.deepEqual(replays[0].body.review,replays[1].body.review);
  assert.equal(await count('SELECT COUNT(*) n FROM genetic_evidence_operations WHERE operation_id=$1',[confirm.operation_id]),1);
  pass('review-replay-two-connections','Concurrent same-operation review retries return one immutable receipt and do not append duplicate audit/history');
  const publication=await http(`/api/admin/genetic-tests/${id}/disclosure`,publish(),'publisher');status(publication,200);
  const withdrawal=await http(`/api/admin/genetic-tests/${id}/interpretation`,review({expected_version:3,verification:'withdraw'}));status(withdrawal,200);assert.equal(withdrawal.body.review.publication_withdrawn,true);
  assert.equal(await count('SELECT public_disclosed n FROM genetic_tests WHERE id=$1',[id]),0);
  assert.equal(await count("SELECT COUNT(*) n FROM publication_decisions WHERE record_id=$1",[String(id)]),2);
  const hist=await http(`/api/admin/genetic-tests/${id}/interpretation`);status(hist,200);assert.match(JSON.stringify(hist.body),/PRIVATE-PG-REVIEW/);
  assert.ok(!JSON.stringify(await admin.unsafe("SELECT before_json,after_json,reason FROM audit_events WHERE entity_type='genetic_test'")).includes('PRIVATE-PG-'));
  pass('publication-and-private-history','Scoped publisher is separate; review withdrawal removes exposure atomically and generic audit contains no report/review/private reason');
  const mapping=await http('/api/admin/genetic-tests/148001/pairing-review',{operation_id:randomUUID(),assay_key:'SCID',expected_version:1,expected_test_version:1,expected_test_type:'SCID',expected_result:'N/SCID',state:'accepted',reason:'Synthetic exact variant mapping review'});status(mapping,200);
  pass('pairing-review-portability','Versioned private assay mapping receipt executes through the PostgreSQL SQL translator');
  const fresh=await http('/api/horses/14801/genetics',intake(),'author');status(fresh,201);await blockedReviewThenRevoke(fresh.body.test.id,reviewerGrant);
  pass('grant-revocation-real-lock-race','Writer is observed blocked on an actual PostgreSQL row lock; another connection revokes its grant before release; no review, receipt or version change commits');
  const mediaId=randomUUID(),bytes=new TextEncoder().encode('%PDF-1.4\nPRIVATE-PG-DOCUMENT\n%%EOF');
  await seed.prepare(`INSERT INTO horse_media(id,horse_id,media_type,role,file_name,mime_type,size_bytes,uploaded_by_user_id,consent_state) VALUES(?,14801,'document','veterinary','private.pdf','application/pdf',?,'gp-admin','private')`).bind(mediaId,bytes.length).run();
  await seed.prepare('INSERT INTO horse_media_blobs(media_id,chunk,data) VALUES(?,0,?)').bind(mediaId,bytes).run();
  const link=await http(`/api/media/${mediaId}/access`,{},'reader');status(link,201);status(await http(link.body.url,undefined,null),404);status(await http(link.body.url,undefined,'reader'),200);
  await admin.unsafe('UPDATE media_access_grants SET revoked_at=CURRENT_TIMESTAMP WHERE token_binding=$1',[link.body.grant_id]);status(await http(link.body.url,undefined,'reader'),404);
  pass('private-media-session-link','Private byte selection and session/token-bound mint/delivery work on PostgreSQL; anonymous use and revoked link fail');
  report.success=true;
}catch(error){report.success=false;report.failure={name:error.name,message:scrub(error.message)};process.exitCode=1;console.error(scrub(error.stack));}
finally{if(seed)await closeSupabaseD1Database(seed).catch(()=>{});if(admin){if(ownedSchema)await admin.unsafe(`DROP SCHEMA ${ownedSchema} CASCADE`).catch(error=>{report.cleanup_error=scrub(error.message);process.exitCode=1;});await admin.end({timeout:1});}report.finished_at=new Date().toISOString();report.owned_schema_removed=Boolean(ownedSchema&&!report.cleanup_error);await mkdir(dirname(out),{recursive:true});await writeFile(out,JSON.stringify(report,null,2)+'\n');console.log(`Evidence: ${out}`);}

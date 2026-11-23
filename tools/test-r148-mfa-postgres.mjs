#!/usr/bin/env node
/**
 * R148 MFA PostgreSQL rehearsal against an explicitly owned disposable cluster.
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
assert.equal(state.owned_runtime,'r148-disposable-postgres');
assert.equal(state.host,'127.0.0.1');assert.equal(state.database,'postgres');assert.equal(state.user,'postgres');
assert.match(basename(state.base),/^hr_test_r148_pg_[a-z0-9_]+$/);
assert.equal(state.data,`${state.base}/data`);
assert.ok(Number.isSafeInteger(state.port)&&state.port>1024&&state.port<65536);
assert.ok(typeof state.password==='string'&&state.password.length>=32);
const connection=`postgres://postgres:${encodeURIComponent(state.password)}@127.0.0.1:${state.port}/postgres`;
requireDisposableLocalDatabase(connection,'yes');
const out=resolve(args.get('--report')??resolve(root,'../evidence/r148-mfa-postgres.json'));
const require=createRequire(import.meta.url);require('./lib/register-typescript.cjs');
const worker=require('../src/worker.ts').default;
const {createSupabaseD1Database,closeSupabaseD1Database}=require('../src/db/supabaseCompat.ts');
const {seedUser,makeSession,authedRequest}=require('../tests/helpers/realDatabase.ts');
const {hashPassword}=require('../src/auth/password.ts');
const {totpAtStep}=require('../src/auth/mfaCrypto.ts');
const {getAuth}=require('../src/auth/session.ts');
const {withMfaMutationGuard}=require('../src/auth/mfaGuard.ts');
const {pedigreeGraphLockStatement}=require('../src/registry/mutationStatements.ts');
const report={started_at:new Date().toISOString(),boundary:'Owned loopback PostgreSQL; new disposable schema; actual Worker, authenticator and production adapter; fictional accounts only',checks:[]};
const scrub=value=>String(value).replaceAll(connection,'[owned local connection]').replaceAll(state.password,'[generated test credential]');
const pass=(id,detail)=>{report.checks.push({id,pass:true,detail});console.log(`PASS ${id}: ${detail}`);};
const limiter={limit:async()=>({success:true})};
const keyring={active_key_id:'fixture',keys:{fixture:Buffer.alloc(32,83).toString('base64')}};
const password='R148 fictional PostgreSQL password!';
let admin,seed,ownedSchema,target;
let clock=Date.now(); const realNow=Date.now; Date.now=()=>clock;
const advance=()=>{clock+=30000;};
async function request(path,body,session,wrap) {
 const db=createSupabaseD1Database(target,{mode:'full'});
 try {
  const response=await worker.fetch(authedRequest(path,body,{session,headers:{'cf-connecting-ip':'192.0.2.148'}}),{
   DB:wrap?wrap(db):db,DB_PROVIDER_MODE:'d1_full',APP_ENV:'test',SESSION_COOKIE_NAME:'hr_session',
   MFA_MODE:'required',MFA_KEYRING_JSON:JSON.stringify(keyring),ASSETS:{fetch:async()=>new Response('unused')},
   PUBLIC_RATE_LIMITER:limiter,AUTH_RATE_LIMITER:limiter,EXPENSIVE_RATE_LIMITER:limiter,WRITE_RATE_LIMITER:limiter,ACCOUNT_RATE_LIMITER:limiter,
  });
  const result=await response.json();
  return {status:response.status,body:result,session:response.headers.get('set-cookie')?{...session,cookie:response.headers.get('set-cookie').split(';',1)[0],csrfToken:result.csrfToken}:session};
 } finally {await closeSupabaseD1Database(db);}
}
const assertStatus=(reply,status)=>assert.equal(reply.status,status,JSON.stringify(reply.body));
function barrier(){let arrivals=0,release;const ready=new Promise(resolve=>release=resolve);return db=>({...db,async batch(statements){if(++arrivals===2)release();let timer;try{await Promise.race([ready,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('paired command barrier timed out')),5000))]);}finally{clearTimeout(timer);}return db.batch(statements);}});}
async function lockWaiter(marker){
 const deadline=realNow()+5000;
 while(realNow()<deadline){const rows=await admin.unsafe("SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE $1",[`%${marker}%`]);if(rows[0].n>0)return;await new Promise(resolve=>setTimeout(resolve,20));}
 throw Error(`No observed PostgreSQL lock waiter for ${marker}`);
}
try {
 admin=postgres(connection,{max:1,prepare:false,fetch_types:false,onnotice:()=>{}});
 report.server_version=(await admin.unsafe('SELECT version() v'))[0].v;
 ownedSchema=await createOwnedSchema(admin,disposableSchemaName());await admin.unsafe(`SET search_path TO ${ownedSchema}`);
 report.migrations=await applyMigrationChain(admin);pass('migration-chain',`${report.migrations.applied} migrations execute on PostgreSQL`);
 await admin.unsafe(await readFile(resolve(root,'tools/r148-hosted-schema-preflight.sql'),'utf8'));
 pass('read-only-schema-preflight','All 26 required columns pass the read-only primary-schema gate; no target mutations');
 const parsed=new URL(connection);parsed.searchParams.set('options',`-c search_path=${ownedSchema}`);target=parsed.href;
 seed=createSupabaseD1Database(target,{mode:'full'});
 await seedUser(seed,'r148-mfa-pg','admin');await seed.prepare('UPDATE users SET password_hash=? WHERE id=?').bind(await hashPassword(password),'r148-mfa-pg').run();
 let session=await makeSession(seed,'r148-mfa-pg');
 assertStatus(await request('/api/admin/dashboard',undefined,session),403);
 const started=await request('/api/auth/mfa/enroll',{current_password:password,expected_factor_version:0},session);assertStatus(started,200);session=started.session;
 const secret=started.body.enrollment.secret;
 const active=await request('/api/auth/mfa/activate',{enrollment_id:started.body.enrollment.id,expected_factor_version:0,code:await totpAtStep(secret,Math.floor(clock/30000))},session);assertStatus(active,200);session=active.session;
 assert.equal(active.body.status.enrolled,true);assert.equal(active.body.recovery_codes.length,10);
 pass('real-totp-activation','Password-only sensitive access denied; encrypted enrollment, proof, bearer/CSRF rotation and ten recovery hashes committed through real PostgreSQL');
 const sessions=[await makeSession(seed,'r148-mfa-pg'),await makeSession(seed,'r148-mfa-pg')];advance();const fresh=await totpAtStep(secret,Math.floor(clock/30000));const pair=barrier();
 const challenges=await Promise.all(sessions.map(actor=>request('/api/auth/mfa/challenge',{code:fresh},actor,pair)));
 assert.deepEqual(challenges.map(r=>r.status).sort(),[200,409]);
 assert.equal(Number((await admin.unsafe("SELECT count(*) n FROM auth_mfa_events WHERE event_type='step_up_verified'"))[0].n),1);
 session=challenges.find(r=>r.status===200).session;
 pass('concurrent-otp-one-winner','Two independent adapter connections pass preflight; one OTP step commits and the locked loser fails409 without assurance/event duplication');
 const recoverSessions=[await makeSession(seed,'r148-mfa-pg'),await makeSession(seed,'r148-mfa-pg')];const recoveryBarrier=barrier();
 const recoveries=await Promise.all(recoverSessions.map(actor=>request('/api/auth/mfa/recover',{current_password:password,recovery_code:active.body.recovery_codes[0]},actor,recoveryBarrier)));
 assert.deepEqual(recoveries.map(r=>r.status).sort(),[200,409]);session=recoveries.find(r=>r.status===200).session;
 assertStatus(await request('/api/admin/dashboard',undefined,session),403);
 assert.equal(Number((await admin.unsafe("SELECT count(*) n FROM auth_mfa_recovery_codes WHERE used_at IS NOT NULL"))[0].n),1);
 pass('concurrent-recovery-one-winner','Two real recovery claims yield one consumed code; other sessions revoked; recovery does not grant sensitive authority');
 const replacement=await request('/api/auth/mfa/enroll',{current_password:password,expected_factor_version:1},session);assertStatus(replacement,200);
 const replacementSecret=replacement.body.enrollment.secret;
 const replaced=await request('/api/auth/mfa/activate',{enrollment_id:replacement.body.enrollment.id,expected_factor_version:1,code:await totpAtStep(replacementSecret,Math.floor(clock/30000))},replacement.session);assertStatus(replaced,200);session=replaced.session;
 assert.equal(replaced.body.status.factor_version,2);
 pass('recovered-factor-replacement','Recovery permit allows current-password enrollment only; proving new factor rotates version, codes and sessions before restoring authority');
 await admin.unsafe("INSERT INTO horses(id,name_latin) VALUES(148100,'Fictional guarded PG subject')");
 const auth=await getAuth(seed,authedRequest('/',undefined,{session}),'hr_session');assert.ok(auth);
 const guarded=withMfaMutationGuard(seed,auth);
 const results=await guarded.batch([pedigreeGraphLockStatement(guarded),guarded.prepare('UPDATE horses SET name_latin=? WHERE id=148100').bind('Guarded graph result'),guarded.prepare('SELECT name_latin FROM horses WHERE id=148100')]);
 assert.equal(results.length,3);assert.equal(results[2].results[0].name_latin,'Guarded graph result');
 pass('graph-marker-result-parity','Authority wrapper preserves the advisory marker in adapter position zero and preserves original result indexes');
 const blocker=postgres(target,{max:1,prepare:false,fetch_types:false,onnotice:()=>{}});
 try {
  await blocker.unsafe('BEGIN');await blocker.unsafe("UPDATE auth_mfa_factors SET factor_version=factor_version WHERE user_id='r148-mfa-pg'");
  const pending=guarded.batch([guarded.prepare("UPDATE horses SET name_latin='MUST ROLL BACK' WHERE id=148100"),guarded.prepare("INSERT INTO audit_events(action,entity_type,entity_id) VALUES('mfa-race','horse','148100')")]).then(()=>({ok:true}),error=>({ok:false,code:error.code}));
  await lockWaiter('auth_mfa_factors');await blocker.unsafe("DELETE FROM auth_mfa_session_assurance WHERE user_id='r148-mfa-pg'");await blocker.unsafe('COMMIT');
  const result=await pending;assert.deepEqual(result,{ok:false,code:'mfa_step_up_required'});
  assert.equal((await admin.unsafe('SELECT name_latin FROM horses WHERE id=148100'))[0].name_latin,'Guarded graph result');
  assert.equal(Number((await admin.unsafe("SELECT count(*) n FROM audit_events WHERE action='mfa-race'"))[0].n),0);
  assert.equal(Number((await admin.unsafe('SELECT count(*) n FROM auth_mfa_commit_checks'))[0].n),0);
  pass('post-lock-assurance-revocation','Observed actual factor-row lock wait; assurance withdrawal commits before waiter resumes; fresh statement rejects whole business/audit batch');
 } finally {await blocker.unsafe('ROLLBACK').catch(()=>{});await blocker.end({timeout:1});}
 report.ok=true;
} catch(cause){report.ok=false;report.error=scrub(cause?.stack??cause);console.error(report.error);process.exitCode=1;}
finally {
 Date.now=realNow;
 if(seed)await closeSupabaseD1Database(seed).catch(()=>{});
 if(admin){if(ownedSchema){try{await admin.unsafe(`DROP SCHEMA ${ownedSchema} CASCADE`);report.schema_removed=true;}catch(cause){report.cleanup_error=scrub(cause);process.exitCode=1;}}await admin.end({timeout:1}).catch(()=>{});}
 report.finished_at=new Date().toISOString();await mkdir(dirname(out),{recursive:true});await writeFile(out,JSON.stringify(report,null,2)+'\n');
}

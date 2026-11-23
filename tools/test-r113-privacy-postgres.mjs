#!/usr/bin/env node
/**
 * R113 D43 disposable PostgreSQL privacy-policy regression rehearsal.
 *
 * Install the pinned tool OUTSIDE the application, then run:
 *   npm install --prefix /path/to/pg-tools embedded-postgres@18.4.0-beta.17
 *   R113_EMBEDDED_POSTGRES_ROOT=/path/to/pg-tools node tools/test-r113-privacy-postgres.mjs
 *
 * Creates its own loopback cluster, database and isolated hr_test_* schema.
 * Never accepts an existing database URL. All objects and credentials are
 * ephemeral. When running as root, it uses existing nobody uid/gid 65534;
 * it never creates a system account or changes existing directory permissions.
 * Uses the production Worker, SQL translator, sessions and PostgreSQL adapter.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, cp, mkdir, chmod, chown, writeFile, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { applyMigrationChain } from '../scripts/lib/pg-ddl.mjs';
import { createOwnedSchema, disposableSchemaName, requireDisposableLocalDatabase } from '../scripts/lib/disposable-schema.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
require('./lib/register-typescript.cjs');
const worker = require('../src/worker.ts').default;
const { createSupabaseD1Database, closeSupabaseD1Database } = require('../src/db/supabaseCompat.ts');
const { seedUser, makeSession, authedRequest } = require('../tests/helpers/realDatabase.ts');

const { placeServiceRequestHoldStatements } = require('../src/services/privacy.ts');
const output = join(root, 'review-r113/evidence/postgres-privacy-policy');
const report = { started_at: new Date().toISOString(), boundary: 'Disposable loopback PostgreSQL, actual Worker and production adapter; no existing database URL accepted', checks: [] };
await mkdir(output, {recursive:true});
let temporary, child, admin, seedDb, ownedSchema;
let childLogs = '';

function pass(id, detail) {
  report.checks.push({ id, pass: true, detail });
  console.log(`PASS ${id}: ${detail}`);
}

async function freePort() {
  const server = createServer();
  await new Promise((res, rej) => server.listen(0, '127.0.0.1', res).once('error', rej));
  const port = server.address().port;
  await new Promise((res, rej) => server.close(error => error ? rej(error) : res()));
  return port;
}

async function startCluster() {
  const installation = process.env.R113_EMBEDDED_POSTGRES_ROOT;
  if (!installation) throw new Error('R113_EMBEDDED_POSTGRES_ROOT must name an external pinned embedded-postgres installation.');
  const manifest = JSON.parse(await readFile(join(installation, 'node_modules/embedded-postgres/package.json'), 'utf8'));
  assert.equal(manifest.version, '18.4.0-beta.17', 'Use the documented pinned rehearsal runtime');
  report.embedded_postgres = manifest.version;
  temporary = await mkdtemp(join(process.env.R113_PG_TEMP_ROOT || tmpdir(), 'hr_test_r113_privacy_'));
  // A copy permits the existing unprivileged child to traverse the binaries
  // even when the developer's workspace parents are private to root.
  await chmod(temporary, 0o755);
  await cp(join(installation, 'node_modules'), join(temporary, 'node_modules'), { recursive: true, verbatimSymlinks: true });
  const data = join(temporary, 'data');
  const files = join(temporary, 'tmp');
  await mkdir(data, { mode: 0o700 });
  await mkdir(files, { mode: 0o700 });
  const dropRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  if (dropRoot) { await chown(data, 65534, 65534); await chown(files, 65534, 65534); }
  const password = randomBytes(24).toString('hex');
  const port = await freePort();
  const database = `hr_test_r113_privacy_${randomBytes(8).toString('hex')}`;
  const bootFile = join(temporary, 'boot.mjs');
  await writeFile(bootFile, `
import EmbeddedPostgres from './node_modules/embedded-postgres/dist/index.js';
const pg = new EmbeddedPostgres({databaseDir:process.env.R113_PG_DATA, user:'postgres', password:process.env.R113_PG_PASSWORD,
  port:Number(process.env.R113_PG_PORT), persistent:false, createPostgresUser:false,
  initdbFlags:['--encoding=UTF8','--locale=C.utf8'],
  postgresFlags:['-c','listen_addresses=127.0.0.1','-c','unix_socket_directories='+process.env.R113_PG_DATA],
  onLog:()=>{}, onError:error=>process.stderr.write(String(error)+'\\n')});
let stopping=false;
async function stop(){if(stopping)return;stopping=true;try{await pg.stop();}finally{process.exit(0);}}
process.on('message',message=>{if(message==='stop')void stop();});
process.on('disconnect',()=>void stop());
process.on('SIGTERM',()=>void stop());
try{await pg.initialise();await pg.start();await pg.createDatabase(process.env.R113_PG_DATABASE);process.send({ready:true});}
catch(error){process.stderr.write(String(error)+'\\n');await pg.stop().catch(()=>{});process.exit(1);}
`, { mode: 0o644 });
  child = spawn(process.execPath, [bootFile], { cwd: temporary, ...(dropRoot ? { uid: 65534, gid: 65534 } : {}),
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { PATH: process.env.PATH, TMPDIR: files,
      R113_PG_DATA: data, R113_PG_PASSWORD: password, R113_PG_PORT: String(port), R113_PG_DATABASE: database } });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { childLogs = (childLogs + String(chunk)).slice(-20_000); });
  await new Promise((res, rej) => {
    const timeout = setTimeout(() => rej(new Error('Disposable PostgreSQL startup exceeded 45 seconds')), 45_000);
    const exited = code => { clearTimeout(timeout); rej(new Error(`Disposable PostgreSQL startup exited ${code}: ${childLogs}`)); };
    child.once('exit', exited);
    child.once('error', error => { clearTimeout(timeout); rej(error); });
    child.on('message', message => { if (message?.ready) { clearTimeout(timeout); child.off('exit', exited); res(); } });
  });
  const url = `postgres://postgres:${password}@127.0.0.1:${port}/${database}`;
  requireDisposableLocalDatabase(url, 'yes');
  assert.match(database, /^hr_test_[a-z0-9_]+$/);
  report.cluster = { host: '127.0.0.1', disposable_database_prefix: 'hr_test_', process_uid: dropRoot ? 65534 : process.getuid?.() };
  return url;
}

try {
  const connection = await startCluster();
  admin = postgres(connection, {max:1,connect_timeout:8,onnotice:()=>{}});
  report.postgres_version = (await admin.unsafe('SELECT version()'))[0].version;
  report.database_locale = (await admin.unsafe("SELECT pg_encoding_to_char(encoding) AS encoding,datctype AS ctype,datcollate AS collate FROM pg_database WHERE datname=current_database()"))[0];
  assert.equal(report.database_locale.encoding,'UTF8');
  ownedSchema = await createOwnedSchema(admin, disposableSchemaName());
  await admin.unsafe(`SET search_path TO ${ownedSchema}`);
  report.migrations = await applyMigrationChain(admin);
  pass('migrations', `${report.migrations.applied} migrations through the production translator`);
  const target = `${connection}?options=${encodeURIComponent(`-c search_path=${ownedSchema}`)}`;
  seedDb = createSupabaseD1Database(target, {mode:'full'});
  const sessions = {};
  for (const [key,role] of [['a','admin'],['b','admin'],['subject','user'],['other','user']]) {
    const id=`r113-privacy-${key}`;
    await seedUser(seedDb,id,role); sessions[key]=await makeSession(seedDb,id);
  }
  await admin.unsafe("INSERT INTO people(id,name_latin) VALUES(1,'Fictional D43 provider')");
  for (let id=1;id<=8;id++) await seedDb.prepare(`INSERT INTO service_requests
    (id,requester_user_id,provider_person_id,category,note,share_contact,status,city)
    VALUES(?, ?,1,'trainer',?,1,'new','Fictional private city')`)
    .bind(id,id===2?'r113-privacy-other':'r113-privacy-subject',`Original private evidence ${id}`).run();
  const number = async (query, values=[]) => Number((await admin.unsafe(query,values))[0].n);
  const audits = action => number('SELECT COUNT(*) n FROM audit_events WHERE action=$1',[action]);
  async function request(path,body,actor='a',wrap) {
    const db=createSupabaseD1Database(target,{mode:'full'});
    try {
      function traceStatement(sql,statement) {
        return new Proxy(statement,{get(target,property,receiver) {
          if(property==='bind')return (...values)=>traceStatement(sql,statement.bind(...values));
          if(['first','all','run'].includes(property))return async(...args)=>{
            try{return await statement[property](...args);}
            catch(error){(report.database_errors??=[]).push({code:error.code??null,message:error.message,sql});throw error;}
          };
          return Reflect.get(target,property,receiver);
        }});
      }
      const traced={...db,prepare(sql){return traceStatement(sql,db.prepare(sql));},async batch(statements) {
        try{return await db.batch(statements);}
        catch(error){(report.database_errors??=[]).push({code:error.code??null,constraint:error.constraint??error.constraint_name??null,message:error.message});throw error;}
      }};
      const response=await worker.fetch(authedRequest(path,body,{session:sessions[actor]}),{
        DB:wrap?wrap(traced):traced,APP_ENV:'test',DB_PROVIDER_MODE:'d1_full',SESSION_COOKIE_NAME:'hr_session',
      });
      return {status:response.status,body:await response.json()};
    }finally{await closeSupabaseD1Database(db);}
  }
  const assertStatus=(response,status)=>assert.equal(response.status,status,JSON.stringify(response.body));
  const policy=(days=30,category='service_request_terminal')=>({data_category:category,retention_days:days,
    consent_withdrawal_behavior:'Withdrawal prevents further optional disclosure immediately.',
    hold_authority:'Active administrators with substantive reasons may preserve this evidence.',
    release_requirements:'An active administrator must record a substantive release reason.'});
  const approve=(days=30,actor='a',wrap,category)=>request('/api/admin/privacy/retention-policies',policy(days,category),actor,wrap);
  const file=(serviceId=1,wrap,note='Please review redaction of my specific service request.')=>request('/api/privacy/redaction-requests',{
    data_category:'service_request_notes',service_request_id:serviceId,request_note:note,
  },'subject',wrap);
  const decide=(id,decision='grant',actor='a',wrap)=>request(`/api/admin/privacy/redaction-requests/${id}/decide`,{
    decision,decision_note:'The operator reviewed the specific request and recorded the decision.',
  },actor,wrap);
  function interpose(before,after) {
    return db=>({...db,async batch(statements){await before?.();const result=await db.batch(statements);await after?.();return result;}});
  }
  const hold=id=>seedDb.batch(placeServiceRequestHoldStatements(seedDb,{
    requestId:id,operatorUserId:'r113-privacy-b',holdKind:'dispute',
    reason:'Fictional dispute preserves the referenced service request as evidence.',
  }));

  const filed=await file();assertStatus(filed,201);
  assert.equal(filed.body.redaction_completed,false);assert.equal(filed.body.fulfillment_status,'not_executed');
  const granted=await decide(filed.body.request_id);assertStatus(granted,200);
  assert.equal(granted.body.redaction_completed,false);assert.equal(granted.body.fulfillment_status,'not_executed');
  assert.deepEqual((await admin.unsafe('SELECT note,share_contact,retention_minimized_at FROM service_requests WHERE id IN(1,2) ORDER BY id')).map(row=>({...row,share_contact:Number(row.share_contact)})),[
    {note:'Original private evidence 1',share_contact:1,retention_minimized_at:null},
    {note:'Original private evidence 2',share_contact:1,retention_minimized_at:null},
  ]);
  const queue=await request('/api/admin/privacy/redaction-requests');assertStatus(queue,200);
  assert.equal(queue.body.requests[0].fulfillment_status,'not_executed');
  assertStatus(await decide(filed.body.request_id,'refuse'),409);
  assert.equal(await audits('privacy.subject_redaction_decided'),1);
  pass('honest-grant-and-single-audit','Actual grant and queue say unexecuted; private and unrelated evidence stay intact; replay409 adds no decision audit');

  const unscoped=await file(null);assertStatus(unscoped,201);
  const unresolved=await decide(unscoped.body.request_id);assertStatus(unresolved,409);
  assert.equal(unresolved.body.error.code,'redaction_scope_unresolved');
  assertStatus(await decide(unscoped.body.request_id,'refuse'),200);
  pass('typed-null-unresolved-scope','Nullable intake works through the PostgreSQL translator; an untargeted grant remains unresolved while a reasoned refusal is valid');

  const policyA=await approve();assertStatus(policyA,201);assert.equal(policyA.body.policy_version,1);
  const policyB=await approve(60,'b');assertStatus(policyB,201);assert.equal(policyB.body.policy_version,2);
  assert.equal(policyB.body.supersedes_policy_id,policyA.body.policy_id);
  assert.equal(await number("SELECT COUNT(*) n FROM privacy_retention_policies WHERE status='approved'"),1);
  pass('policy-predecessor','Version2 links exactly to version1; only one current policy and both audited history rows remain');

  // Both actual INSERT SELECTs must evaluate their next version before either
  // is allowed to insert. The test-only trigger blocks at the row boundary;
  // production code still executes through the unmodified D1 adapter.
  const gate=postgres(connection,{max:1,onnotice:()=>{}});
  const lockKey=11343001;
  let attempts=[];
  try {
    await admin.unsafe(`CREATE FUNCTION privacy_policy_test_gate() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN PERFORM pg_advisory_xact_lock(${lockKey}); RETURN NEW; END $$`);
    await admin.unsafe('CREATE TRIGGER privacy_policy_test_gate BEFORE INSERT ON privacy_retention_policies FOR EACH ROW EXECUTE FUNCTION privacy_policy_test_gate()');
    await gate.unsafe('SELECT pg_advisory_lock($1)',[lockKey]);
    attempts=[approve(90,'a'),approve(120,'b')];
    let waiting=0;
    for(let spin=0;spin<200;spin++) {
      waiting=await number("SELECT COUNT(*) n FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory' AND query LIKE 'INSERT INTO privacy_retention_policies%'");
      if(waiting===2)break;
      await new Promise(resolveWait=>setTimeout(resolveWait,20));
    }
    assert.equal(waiting,2,'both inserts reached the same pre-insertion barrier');
    await gate.unsafe('SELECT pg_advisory_unlock($1)',[lockKey]);
    const replies=await Promise.all(attempts);
    assert.deepEqual(replies.map(reply=>reply.status).sort(),[201,409],JSON.stringify(replies));
    const winner=replies.find(reply=>reply.status===201);
    assert.equal(winner.body.policy_version,3);assert.equal(winner.body.supersedes_policy_id,policyB.body.policy_id);
    assert.equal(await number('SELECT COUNT(*) n FROM privacy_retention_policies'),3);
    assert.equal(await number("SELECT COUNT(*) n FROM privacy_retention_policies WHERE status='approved'"),1);
    assert.equal(await audits('privacy.retention_policy_approved'),3);
  }finally{
    await gate.unsafe('SELECT pg_advisory_unlock_all()').catch(()=>{});
    await Promise.allSettled(attempts);
    await gate.end({timeout:2});
    await admin.unsafe('DROP TRIGGER IF EXISTS privacy_policy_test_gate ON privacy_retention_policies');
    await admin.unsafe('DROP FUNCTION IF EXISTS privacy_policy_test_gate()');
  }
  pass('concurrent-policy-collision','Two administrators forced onto the same next version yield exactly one201 and one409, with correct predecessor, one approved row and no losing audit/orphan');

  const beforeHistory=(await admin.unsafe('SELECT * FROM privacy_retention_policies ORDER BY policy_version')).map(row=>({...row}));
  await admin.unsafe(`CREATE FUNCTION privacy_policy_test_fault() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.action='privacy.retention_policy_approved' THEN RAISE EXCEPTION 'injected privacy approval fault'; END IF; RETURN NEW; END $$`);
  await admin.unsafe('CREATE TRIGGER privacy_policy_test_fault BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION privacy_policy_test_fault()');
  try {
    assertStatus(await approve(150),500);
    assert.deepEqual((await admin.unsafe('SELECT * FROM privacy_retention_policies ORDER BY policy_version')).map(row=>({...row})),beforeHistory);
    assert.equal(await audits('privacy.retention_policy_approved'),3);
  }finally{
    await admin.unsafe('DROP TRIGGER privacy_policy_test_fault ON audit_events');
    await admin.unsafe('DROP FUNCTION privacy_policy_test_fault()');
  }
  pass('approval-fault-rollback','Injected audit fault rolls back candidate, predecessor retirement and promotion as one transaction');

  const demote=()=>admin.unsafe("UPDATE users SET role='user' WHERE id='r113-privacy-a'");
  const restore=()=>admin.unsafe("UPDATE users SET role='admin' WHERE id='r113-privacy-a'");
  assertStatus(await approve(180,'a',interpose(demote)),403);await restore();
  const pending=await file(3);assertStatus(pending,201);
  const beforeDecisions=await audits('privacy.subject_redaction_decided');
  assertStatus(await decide(pending.body.request_id,'refuse','a',interpose(demote)),403);await restore();
  assert.equal(await audits('privacy.subject_redaction_decided'),beforeDecisions);
  assert.equal(await number('SELECT COUNT(*) n FROM privacy_retention_policies'),3);
  pass('current-admin-guards','Demotion committed after successful handler preflight prevents policy and decision writes and success audits');

  const lateHeld=await decide(pending.body.request_id,'grant','a',interpose(()=>hold(3)));assertStatus(lateHeld,409);
  assert.equal(lateHeld.body.error.code,'grant_blocked_by_hold');
  assert.equal(await audits('privacy.subject_redaction_decided'),beforeDecisions);
  assert.equal((await admin.unsafe('SELECT note FROM service_requests WHERE id=3'))[0].note,'Original private evidence 3');
  const lateIntake=await file(4,interpose(()=>hold(4)));assertStatus(lateIntake,201);
  assert.equal(lateIntake.body.status,'deferred_active_hold');
  const intakeAudit=(await admin.unsafe("SELECT after_json FROM audit_events WHERE action='privacy.subject_redaction_requested' AND entity_id=$1",[String(lateIntake.body.request_id)]))[0];
  assert.equal(JSON.parse(intakeAudit.after_json).status,'deferred_active_hold');
  pass('late-hold-interleavings','A hold arriving after preflight prevents grant and determines deferred intake/audit status inside the parent-row transaction');

  const priorFilings=await number('SELECT COUNT(*) n FROM subject_redaction_requests');
  assertStatus(await file(5,interpose(()=>admin.unsafe("UPDATE users SET is_active=0 WHERE id='r113-privacy-subject'"))),401);
  await admin.unsafe("UPDATE users SET is_active=1 WHERE id='r113-privacy-subject'");
  const changedOwner=await file(5,interpose(()=>admin.unsafe("UPDATE service_requests SET requester_user_id='r113-privacy-other' WHERE id=5")));
  assertStatus(changedOwner,403);assert.equal(changedOwner.body.error.code,'not_data_subject');
  assert.equal(await number('SELECT COUNT(*) n FROM subject_redaction_requests'),priorFilings);
  pass('intake-current-authority','A deactivated subject or changed request owner cannot file or receive a fabricated receipt for a prior request');

  let secondFiling;
  const firstFiling=await file(6,interpose(undefined,async()=>{secondFiling=await file(6,undefined,'Distinct second subject redaction request.');}),'Distinct first subject redaction request.');
  assertStatus(firstFiling,201);assertStatus(secondFiling,201);assert.notEqual(firstFiling.body.request_id,secondFiling.body.request_id);
  const ownFiling=(await admin.unsafe('SELECT request_note FROM subject_redaction_requests WHERE id=$1',[firstFiling.body.request_id]))[0];
  assert.equal(ownFiling.request_note,'Distinct first subject redaction request.');
  let secondApproval;
  const firstApproval=await approve(180,'a',interpose(undefined,async()=>{secondApproval=await approve(210,'b');}));
  assertStatus(firstApproval,201);assertStatus(secondApproval,201);
  assert.equal(firstApproval.body.policy_version,4);assert.equal(secondApproval.body.policy_version,5);
  assert.equal(secondApproval.body.supersedes_policy_id,firstApproval.body.policy_id);
  pass('transaction-local-receipts','Later filings and policy approvals committed before response delivery never replace the current command receipt');

  const auditPolicy=await approve(240,'a',undefined,'audit_dispute_record');assertStatus(auditPolicy,201);
  assert.equal(auditPolicy.body.enforcement_status,'not_implemented');
  pass('unimplemented-executor-disclosure','Audit/dispute policy is recorded honestly without claiming a purge executor or deleting retained history');

  const finalQueue=await request('/api/admin/privacy/redaction-requests');assertStatus(finalQueue,200);
  const expectedCounts={received:0,deferred_active_hold:0,granted:0,refused:0};
  for(const row of await admin.unsafe('SELECT status,COUNT(*) n FROM subject_redaction_requests GROUP BY status')) expectedCounts[row.status]=Number(row.n);
  assert.deepEqual(finalQueue.body.counts,expectedCounts);
  assert.ok(Object.values(expectedCounts).every(count=>count>0));
  pass('portable-queue-counts','Actual PostgreSQL queue counts all four statuses through portable conditional aggregation; no sum(boolean) failure');

  for(const serviceId of [2_147_483_648,Number.MAX_SAFE_INTEGER]) {
    await seedDb.prepare(`INSERT INTO service_requests(id,requester_user_id,provider_person_id,category,note,share_contact,status)
      VALUES(?,'r113-privacy-subject',1,'trainer','Private high-ID subject evidence',1,'new')`).bind(serviceId).run();
    const highFiling=await file(serviceId);assertStatus(highFiling,201);
    const saved=await seedDb.prepare('SELECT service_request_id,subject_user_id FROM subject_redaction_requests WHERE id=?')
      .bind(highFiling.body.request_id).first();
    assert.equal(saved.service_request_id,serviceId);assert.equal(saved.subject_user_id,'r113-privacy-subject');
    const highGrant=await decide(highFiling.body.request_id);assertStatus(highGrant,200);
    assert.equal(highGrant.body.redaction_completed,false);
    assert.equal((await seedDb.prepare('SELECT note FROM service_requests WHERE id=?').bind(serviceId).first()).note,'Private high-ID subject evidence');
  }
  pass('non-narrowing-optional-request-id','Owned service IDs2147483648 and9007199254740991 file and receive exact receipts through actual Worker/PostgreSQL paths; the null check preserves bigint range');
  report.pass=true;
} catch (error) {
  report.pass = false;
  report.error = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { message: String(error) };
  console.error(`FAIL R113 PostgreSQL: ${report.error.message}`);
  process.exitCode = 1;
} finally {
  if (seedDb) await closeSupabaseD1Database(seedDb).catch(() => {});
  if (admin) {
    if (ownedSchema) await admin.unsafe(`DROP SCHEMA ${ownedSchema} CASCADE`).catch(error => { report.cleanup_error = String(error); process.exitCode = 1; });
    await admin.end({ timeout: 2 }).catch(() => {});
  }
  if (child && child.exitCode === null) {
    await new Promise(resolveStop => {
      const timer = setTimeout(() => { child.kill('SIGTERM'); resolveStop(); }, 10_000);
      child.once('exit', () => { clearTimeout(timer); resolveStop(); });
      if (child.connected) child.send('stop'); else child.kill('SIGTERM');
    });
  }
  if (temporary) await rm(temporary, { recursive: true, force: true });
  report.finished_at = new Date().toISOString();
  report.cleanup = { owned_schema_dropped: !report.cleanup_error, temporary_cluster_removed: Boolean(temporary), child_exit: child?.exitCode };
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  if (!report.pass && childLogs) await writeFile(join(output, 'startup-error.txt'), childLogs);
  else if (report.pass) await rm(join(output, 'startup-error.txt'), { force: true });
  console.log(`${report.checks.length} PostgreSQL checks completed; report: review-r113/evidence/postgres-privacy-policy/report.json`);
}

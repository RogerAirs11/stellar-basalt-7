#!/usr/bin/env node
/**
 * R113 disposable PostgreSQL regression rehearsal.
 *
 * Install the pinned tool OUTSIDE the application, then run:
 *   npm install --prefix /path/to/pg-tools embedded-postgres@18.4.0-beta.17
 *   R113_EMBEDDED_POSTGRES_ROOT=/path/to/pg-tools node tools/test-r113-backend-postgres.mjs
 * Optional existing-test rehearsal on 70,001 explicitly fictional rows:
 *   R113_RUN_GATED_ADAPTER_VITEST=1 runs the unchanged adapter test file;
 *   R113_RUN_GATED_ADAPTER_VITEST=full then runs the complete Vitest suite.
 *
 * Creates its own loopback cluster, database and isolated hr_test_* schema.
 * Never accepts an existing database URL. All objects and credentials are
 * ephemeral. When running as root, it uses existing nobody uid/gid 65534;
 * it never creates a system account or changes existing directory permissions.
 * Uses the production Worker, SQL translator, sessions and PostgreSQL adapter.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
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
const { createSupabaseD1Database, closeSupabaseD1Database, sqliteSqlToPostgres } = require('../src/db/supabaseCompat.ts');
const { seedUser, makeSession, authedRequest } = require('../tests/helpers/realDatabase.ts');

const { refreshHorseSearch } = require('../src/search/refresh.ts');
const { searchHorses } = require('../src/search/service.ts');
const gatedAdapterMode = process.env.R113_RUN_GATED_ADAPTER_VITEST || '';
if (!['', '1', 'full'].includes(gatedAdapterMode)) throw new Error('R113_RUN_GATED_ADAPTER_VITEST must be omitted, 1 or full');
const reportDirectory = gatedAdapterMode ? 'postgres-gated-adapter' : 'postgres-backend';
const output = join(root, 'review-r113/evidence', reportDirectory);
const report = { started_at: new Date().toISOString(), boundary: gatedAdapterMode
  ? 'Disposable loopback PostgreSQL, unchanged existing Vitest adapter tests on generated data; no existing database URL accepted'
  : 'Disposable loopback PostgreSQL, actual Worker and production adapter; no existing database URL accepted', checks: [] };
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
  temporary = await mkdtemp(join(process.env.R113_PG_TEMP_ROOT || tmpdir(), 'hr_test_r113_'));
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
  const database = `hr_test_r113_${randomBytes(8).toString('hex')}`;
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

async function runGatedAdapterVitest(target) {
  // This target is generated above, never read from a user/hosted URL. Verify
  // the exact isolated schema again before a test with unqualified DDL runs.
  requireDisposableLocalDatabase(target, 'yes');
  const parsedTarget = new URL(target);
  assert.equal(parsedTarget.searchParams.get('options'), `-c search_path=${ownedSchema}`);
  await checkCatalogVisibility(target);
  const beforeRows = Number((await admin.unsafe('SELECT COUNT(*) n FROM horses'))[0].n);
  assert.equal(beforeRows, 0, 'gated adapter mode starts with no horse data');
  await admin.unsafe(`INSERT INTO horses(id,name_latin,register_no,raw_json)
    SELECT 810000000+n,'Fictional adapter horse '||n,'SYNTH:R113:ADAPTER:'||n,
      '{"is_demo":true,"namespace":"synthetic:r113:adapter"}'
    FROM generate_series(1,70001) AS generated(n)`);
  const liveRows = Number((await admin.unsafe('SELECT COUNT(*) n FROM horses WHERE deleted_at IS NULL'))[0].n);
  assert.equal(liveRows, 70001);
  report.generated_fixture = { namespace: 'synthetic:r113:adapter', horse_rows: liveRows,
    qualification: 'Fictional rows satisfy the unchanged adapter count assertion only. No canonical-data correctness, real archive or production-performance qualification.' };
  pass('generated-adapter-fixture', `${liveRows} fictional live horses in the freshly migrated owned schema; no existing data`);

  const testPath = 'tests/unit/supabaseSqlTranslation.test.ts';
  const sourceHash = async () => createHash('sha256').update(await readFile(join(root, testPath))).digest('hex');
  const beforeHash = await sourceHash();
  const vitestTmp = join(temporary, 'vitest-tmp');
  await mkdir(vitestTmp, {mode:0o700});
  const sensitive = [target, parsedTarget.href, parsedTarget.href.split('?')[0], parsedTarget.password];
  const scrub = value => sensitive.filter(Boolean).reduce((text, token) => text.replaceAll(token, '[redacted ephemeral connection]'), String(value));
  async function runOne(full) {
    const stem = full ? 'vitest-with-local-postgres' : 'vitest-gated-adapter';
    const reportFile = join(root, 'review-r113/evidence', `${stem}.json`);
    const logFile = join(root, 'review-r113/evidence', `${stem}.txt`);
    // Never let a stale success report stand in for a child that wrote none.
    await rm(reportFile, {force:true});
    const args = [join(root,'node_modules/vitest/vitest.mjs'),'run',...(full?[]:[testPath]),
      '--pool=threads','--maxWorkers=1','--no-file-parallelism','--teardownTimeout=1000',
      '--reporter=json',`--outputFile=${reportFile}`];
    const began = Date.now();
    let log = '', timedOut = false, hardKill;
    const testChild = spawn(process.execPath, args, {cwd:root,stdio:['ignore','pipe','pipe'],
      // Only this generated URL reaches the unchanged test. No host database
      // credentials or other environment secrets are inherited by the child.
      env:{PATH:process.env.PATH,TMPDIR:vitestTmp,CI:'1',TZ:'UTC',LANG:'C.UTF-8',SUPABASE_DATABASE_URL:target}});
    for(const stream of [testChild.stdout,testChild.stderr])stream.on('data',data=>{log+=String(data);});
    const timer=setTimeout(()=>{timedOut=true;testChild.kill('SIGTERM');hardKill=setTimeout(()=>testChild.kill('SIGKILL'),5000);},600_000);
    let outcome;
    try {
      outcome=await new Promise((resolveExit,rejectExit)=>{
        testChild.once('error',rejectExit);testChild.once('close',(code,signal)=>resolveExit({code,signal}));
      });
    }finally{clearTimeout(timer);if(hardKill)clearTimeout(hardKill);}
    await writeFile(logFile,scrub(log));
    let results;
    try {
      const text=await readFile(reportFile,'utf8');
      // A failed database connection can include a URL in diagnostics; retain
      // the exact report structure while removing only our ephemeral secrets.
      const clean=scrub(text);await writeFile(reportFile,clean);results=JSON.parse(clean);
    }catch(error){throw new Error(`${stem}: JSON report unavailable (${error.name}); process exit ${outcome?.code}`);}
    const assertions=results.testResults.flatMap(file=>file.assertionResults);
    const gated=assertions.filter(result=>result.fullName.includes('supabase full-mode adapter (live Postgres)'));
    const summary={file:full?'complete suite':testPath,exit_code:outcome.code,signal:outcome.signal,timed_out:timedOut,
      duration_ms:Date.now()-began,total:results.numTotalTests,passed:results.numPassedTests,failed:results.numFailedTests,
      pending:results.numPendingTests,success:results.success,gated_tests:gated.map(result=>({name:result.fullName,status:result.status})),
      skipped_tests:assertions.filter(result=>result.status==='pending'||result.status==='skipped').map(result=>result.fullName),
      json:`review-r113/evidence/${stem}.json`,log:`review-r113/evidence/${stem}.txt`};
    report[full?'full_vitest':'adapter_vitest']=summary;
    assert.equal(timedOut,false,`${stem} exceeded its bounded execution time`);
    assert.equal(outcome.code,0,`${stem} exited ${outcome.code}; inspect the retained redacted report`);
    assert.equal(results.success,true,`${stem} reported a failure`);
    assert.equal(gated.length,3,'all three existing database-gated tests were discovered');
    assert.ok(gated.every(result=>result.status==='passed'),'all three existing database-gated tests executed and passed');
    pass(full?'full-vitest-with-disposable-postgres':'unchanged-gated-adapter-tests',
      `${results.numPassedTests} passed, ${results.numFailedTests} failed, ${results.numPendingTests} pending; all 3 existing PostgreSQL cases passed`);
  }
  try {
    await runOne(false);
    if(gatedAdapterMode==='full')await runOne(true);
  }finally{
    const afterHash=await sourceHash();
    report.unchanged_test={path:testPath,before_sha256:beforeHash,after_sha256:afterHash,unchanged:beforeHash===afterHash};
    assert.equal(afterHash,beforeHash,'existing gated test file must remain unchanged');
  }
}

async function checkCatalogVisibility(target) {
  // Every schema/role below is newly created inside this already guarded
  // disposable cluster. CREATE without IF NOT EXISTS establishes ownership.
  let otherSchema, reader, readDb;
  const oddName = "r113? O'Hara FROM sqlite_master";
  try {
    otherSchema = await createOwnedSchema(admin, disposableSchemaName());
    const requestedReader = `hr_test_catalog_${randomBytes(8).toString('hex')}`;
    await admin.unsafe(`CREATE ROLE ${requestedReader} NOLOGIN`);
    reader = requestedReader;
    await admin.unsafe(`CREATE TABLE ${otherSchema}.horses (id bigint)`);
    await admin.unsafe(`CREATE TABLE ${otherSchema}.r113_other_schema_only (id bigint)`);
    await admin.unsafe(`CREATE TABLE "${oddName}" (id bigint)`);
    await admin.unsafe('CREATE TABLE r113_catalog_hidden (id bigint)');
    await admin.unsafe('CREATE VIEW r113_catalog_view AS SELECT 1 AS id');
    const scope = new URL(target);
    scope.searchParams.set('options', `-c search_path=${ownedSchema},${otherSchema}`);
    readDb = createSupabaseD1Database(scope.href, {mode:'read'});

    assert.deepEqual(await readDb.prepare("SELECT * FROM sqlite_master WHERE type='table' AND name=?").bind(oddName).first(),
      {type:'table',name:oddName,tbl_name:oddName,rootpage:null,sql:null});
    assert.deepEqual(await readDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='r113? O''Hara FROM sqlite_master'").first(),
      {name:oddName});
    assert.deepEqual(await readDb.prepare("/* FROM sqlite_master ? */ SELECT name FROM /* ? */sqlite_master WHERE type='table' AND name=/* ? */?; -- ?")
      .bind('horses').first(), {name:'horses'});
    assert.deepEqual(await readDb.prepare("SELECT 'FROM sqlite_master ?' AS note, ? AS value").bind('literal-safe').first(),
      {note:'FROM sqlite_master ?',value:'literal-safe'});
    assert.deepEqual((await readDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN (?2,?1,?3,?2)")
      .bind('r113_other_schema_only','horses','r113_catalog_view').all()).results, [{name:'horses'}]);
    await assert.rejects(readDb.prepare("SELECT sql FROM sqlite_master WHERE name='r113_catalog_hidden'").first(), /Unsupported sqlite_master query/);
    await assert.rejects(readDb.prepare("UPDATE horses SET name_latin='forbidden' WHERE id=1").run(), /read-only/);
    pass('catalog-presence-lexical-parity', 'Actual read-mode adapter preserves bound/literal names, comments and numbered binds; no fabricated SQLite DDL/rootpage; writes and unsupported catalog shapes remain refused');

    await admin.unsafe(`GRANT USAGE ON SCHEMA ${ownedSchema},${otherSchema} TO ${reader}`);
    await admin.unsafe(`GRANT SELECT ON ${ownedSchema}.horses,${otherSchema}.horses,${otherSchema}.r113_other_schema_only TO ${reader}`);
    const query = "SELECT name FROM sqlite_master WHERE type='table' AND name IN (?,?,?)";
    const names = ['horses','r113_catalog_hidden','r113_other_schema_only'];
    // The hidden table exists in the selected schema, so its later absence is
    // an actual privilege check rather than a missing-fixture false positive.
    const ownerRows = await admin.unsafe(sqliteSqlToPostgres(query), names);
    assert.deepEqual(ownerRows.map(row=>row.name).sort(), ['horses','r113_catalog_hidden']);
    const readerRows = await admin.begin(async transaction => {
      await transaction.unsafe(`SET LOCAL search_path TO ${ownedSchema},${otherSchema}`);
      await transaction.unsafe(`SET LOCAL ROLE ${reader}`);
      return transaction.unsafe(sqliteSqlToPostgres(query), names);
    });
    assert.deepEqual(readerRows.map(row=>row.name), ['horses']);
    pass('catalog-schema-role-visibility', 'Same-name table in a second search_path schema is not duplicated; an accessible other-schema-only table and a current-schema table denied to a fresh NOLOGIN role are absent');
  } finally {
    if (readDb) await closeSupabaseD1Database(readDb);
    if (reader) {
      await admin.unsafe(`DROP OWNED BY ${reader}`);
      await admin.unsafe(`DROP ROLE ${reader}`);
    }
    if (otherSchema) await admin.unsafe(`DROP SCHEMA ${otherSchema} CASCADE`);
    report.catalog_controls_cleanup = {fresh_role_dropped:Boolean(reader),fresh_other_schema_dropped:Boolean(otherSchema)};
  }
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
  if (gatedAdapterMode) {
    await runGatedAdapterVitest(target);
  } else {
  const sessions = {};
  for (const [key,id] of Object.entries({a:'r113-pg-editor-a',b:'r113-pg-editor-b'})) {
    await seedUser(seedDb,id,'editor'); sessions[key] = await makeSession(seedDb,id);
  }
  await admin.unsafe("INSERT INTO import_sources(id,name,issuer_namespace,scope_note,is_synthetic) VALUES(1,'Disposable R113 audit','registry:r113','Fictional in-memory source equivalent',0)");
  const number = async (query, values=[]) => Number((await admin.unsafe(query,values))[0].n);
  async function request(path,body,actor='a',wrap) {
    const db = createSupabaseD1Database(target,{mode:'full'});
    try {
      const traced = {...db, async batch(statements) {
        try { return await db.batch(statements); }
        catch(error) {
          (report.database_errors ??= []).push({code:error.code ?? null,constraint:error.constraint ?? error.constraint_name ?? null,message:error.message});
          throw error;
        }
      }};
      const reply = await worker.fetch(authedRequest(path,body,{session:sessions[actor]}),{
        DB:wrap?wrap(traced):traced,APP_ENV:'test',DB_PROVIDER_MODE:'d1_full',SESSION_COOKIE_NAME:'hr_session',
      });
      return {status:reply.status,body:await reply.json()};
    } finally { await closeSupabaseD1Database(db); }
  }
  const payload = (key,extra={}) => ({source_id:1,file_name:`r113-${key}.json`,mapping_version:'v1',rows:[{external_id:key,register_no:`R113-${key}`,name_latin:`Audit ${key}`,...extra}]});
  const stage = (body,actor='a',wrap) => request('/api/admin/imports/stage',body,actor,wrap);
  const apply = (id,actor='a',wrap) => request(`/api/admin/imports/batches/${id}/apply`,{},actor,wrap);
  function assertStatus(reply,status) { assert.equal(reply.status,status,JSON.stringify(reply.body)); }
  function barrier() {
    let count=0,release;
    const ready=new Promise(resolve=>{release=resolve;});
    return async ()=>{if(++count===2)release();await ready;};
  }
  function afterRead(match,callback) {
    return db=>({...db,prepare(sql){
      function wrap(statement){return new Proxy(statement,{get(target,key){
        if(key==='bind')return(...args)=>wrap(target.bind(...args));
        if(key==='first'||key==='all')return async(...args)=>{const result=await target[key](...args);await callback();return result;};
        const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
      }});}
      const statement=db.prepare(sql);return match(sql)?wrap(statement):statement;
    }});
  }
  const pendingRead=sql=>/^\s*SELECT id,external_id/.test(sql)&&sql.includes("outcome='pending'");

  // Real PostgreSQL statement failure, not a mocked result: header and first
  // staging row must roll back when the second row violates this test constraint.
  await admin.unsafe("ALTER TABLE import_staging_rows ADD CONSTRAINT r113_fault CHECK(external_id <> 'fault')");
  const fault={...payload('first'),rows:[...payload('first').rows,...payload('fault').rows]};
  const failedStage=await stage(fault);assert(failedStage.status>=400);
  assert.equal(await number('SELECT COUNT(*) n FROM import_batches'),0);
  assert.equal(await number('SELECT COUNT(*) n FROM import_staging_rows'),0);
  await admin.unsafe('ALTER TABLE import_staging_rows DROP CONSTRAINT r113_fault');
  const retriedStage=await stage(fault);assertStatus(retriedStage,201);
  assert.equal(await number('SELECT COUNT(*) n FROM import_staging_rows'),2);
  pass('atomic-stage-failure-retry','Injected second-row constraint failure rolls back header and all rows; same-file retry stages both rows');

  const same=payload('same');
  const stageBarrier=afterRead(sql=>sql.includes('FROM import_batches WHERE source_id=? AND file_sha256=?'),barrier());
  const simultaneous=await Promise.all([stage(same,'a',stageBarrier),stage({...same,rows:[{...same.rows[0],external_id:'equivalent-external-id'}]},'b',stageBarrier)]);
  for(const result of simultaneous)assert([200,201].includes(result.status),JSON.stringify(result.body));
  const batchId=Number(simultaneous[0].body.batch.id);
  assert.equal(batchId,Number(simultaneous[1].body.batch.id));
  assert.equal(await number('SELECT COUNT(*) n FROM import_staging_rows WHERE batch_id=$1',[batchId]),1);
  pass('concurrent-stage','Two connections with equivalent normalized content and different external IDs return one complete batch without appending rows');

  const applyBarrier=afterRead(pendingRead,barrier());
  const applied=await Promise.all([apply(batchId,'a',applyBarrier),apply(batchId,'b',applyBarrier)]);
  for(const result of applied)assertStatus(result,200);
  const receipt=(await admin.unsafe('SELECT outcome,outcome_detail FROM import_staging_rows WHERE batch_id=$1',[batchId]))[0];
  assert.equal(receipt.outcome,'applied_create');assert.equal(receipt.outcome_detail,null);
  assert.equal(await number("SELECT COUNT(*) n FROM horses WHERE register_no='R113-same'"),1);
  assert.equal(await number("SELECT COUNT(*) n FROM audit_events WHERE action='import.horse.created'"),1);
  assert.equal(await number('SELECT COUNT(*) n FROM horse_search_reindex_queue'),1);
  const finished=(await admin.unsafe('SELECT status,rows_created,rows_conflict FROM import_batches WHERE id=$1',[batchId]))[0];
  assert.equal(finished.status,'completed');assert.equal(Number(finished.rows_created),1);assert.equal(Number(finished.rows_conflict),0);
  pass('concurrent-apply','Two connections read the same pending row: exactly one horse, identifier, audit and reindex job; successful receipt stays successful');

  const claimA=await stage(payload('claim'));
  const claimB=await stage(payload('claim',{external_id:'other-claim',name_latin:'Conflicting assertion'}));
  assertStatus(claimA,201);assertStatus(claimB,201);
  const claimBarrier=afterRead(pendingRead,barrier());
  const claims=await Promise.all([apply(claimA.body.batch.id,'a',claimBarrier),apply(claimB.body.batch.id,'b',claimBarrier)]);
  for(const result of claims)assertStatus(result,200);
  const claimRows=await admin.unsafe('SELECT outcome FROM import_staging_rows WHERE batch_id IN ($1,$2) ORDER BY outcome',[claimA.body.batch.id,claimB.body.batch.id]);
  assert.deepEqual(claimRows.map(row=>row.outcome),['applied_create','conflict']);
  assert.equal(await number("SELECT COUNT(*) n FROM horses WHERE register_no='R113-claim'"),1);
  pass('different-batch-identifier-conflict','Distinct reviewed batches retain the real unique identifier conflict and never create an orphan horse');

  const unknown=await stage(payload('unknown'));assertStatus(unknown,201);
  const lost=await apply(unknown.body.batch.id,'a',db=>({...db,async batch(statements){await db.batch(statements);throw new Error('Injected lost acknowledgement after commit');}}));
  assertStatus(lost,503);assertStatus(await apply(unknown.body.batch.id),200);
  assert.equal(await number("SELECT COUNT(*) n FROM horses WHERE register_no='R113-unknown'"),1);
  pass('lost-apply-acknowledgement','A committed but unacknowledged apply returns uncertain failure and safely reconciles on retry without duplicates');

  const old=await stage(payload('old'));assertStatus(old,201);
  await admin.unsafe('DELETE FROM import_staging_rows WHERE batch_id=$1',[old.body.batch.id]);
  const badApply=await apply(old.body.batch.id);assertStatus(badApply,409);assert.equal(badApply.body.error.code,'incomplete_import_batch');
  assertStatus(await stage(payload('old')),409);
  pass('incomplete-legacy-stage','Incomplete older batch cannot be reported replayed or completed');

  const revoke=await stage(payload('revoke'));assertStatus(revoke,201);
  const revoked=await apply(revoke.body.batch.id,'a',db=>({...db,async batch(statements){await admin.unsafe("UPDATE users SET role='user' WHERE id='r113-pg-editor-a'");return db.batch(statements);}}));
  assertStatus(revoked,403);
  assert.equal(await number("SELECT COUNT(*) n FROM horses WHERE register_no='R113-revoke'"),0);
  assert.equal((await admin.unsafe('SELECT outcome FROM import_staging_rows WHERE batch_id=$1',[revoke.body.batch.id]))[0].outcome,'pending');
  await admin.unsafe("UPDATE users SET role='editor' WHERE id='r113-pg-editor-a'");
  pass('mutation-time-authority','Editor role revoked after preflight refuses all canonical writes and leaves the row pending');

  const fill=await stage(payload('same',{external_id:'fill-native',name_native:'نام آزمایشی'}));assertStatus(fill,201);
  assertStatus(await apply(fill.body.batch.id),200);
  assert.equal((await admin.unsafe("SELECT name_latin,name_native FROM horses WHERE register_no='R113-same'"))[0].name_native,'نام آزمایشی');
  const archived=await stage(payload('same',{external_id:'archived-target',birth_year:2020}));assertStatus(archived,201);
  await admin.unsafe("UPDATE horses SET deleted_at=CURRENT_TIMESTAMP WHERE register_no='R113-same'");
  const skipped=await apply(archived.body.batch.id);assertStatus(skipped,200);
  assert.equal(Number(skipped.body.batch.rows_updated),0);assert.equal(Number(skipped.body.batch.rows_skipped),1);
  pass('fill-once-and-archived-target','Live fill-once update persists native text; archived target yields skipped, never a fabricated applied_update');

  const event={name_native:'R113 leap event',discipline:'show_jumping',event_date:'2028-02-29',venue:'Fictional audit arena',season:1406};
  for(const extra of [{event_date:'2026-02-31'},{end_date:'2028-02-30'},{end_date:'2028-02-28'}])assertStatus(await request('/api/admin/competitions',{...event,...extra}),400);
  const competition=await request('/api/admin/competitions',{...event,end_date:event.event_date});assertStatus(competition,201);
  const cid=competition.body.competition.id;
  const liveHorse=Number((await admin.unsafe("SELECT id FROM horses WHERE register_no='R113-unknown'"))[0].id);
  const resultPath=`/api/admin/competitions/${cid}/results`;
  for(const flags of [{is_eliminated:true,is_withdrawn:true},{is_eliminated:true,placement:1},{is_withdrawn:true,placement:2}]){
    assertStatus(await request(resultPath,{results:[{horse_id:liveHorse,class_name:'Audit',...flags}]}),400);
  }
  assertStatus(await request(resultPath,{results:[{horse_id:liveHorse,class_name:'Audit',placement:1}]}),201);
  assert.equal(await number('SELECT COUNT(*) n FROM competition_results'),1);
  pass('competition-validation','Actual Worker rejects impossible/reversed dates and contradictory statuses before writes; valid leap-day event and placement persist');

  await admin.unsafe("INSERT INTO horses(id,name_latin,name_native) VALUES(9001,'Aurora Moon','ماه روشن'),(9002,'Borealis Sun','خورشید'),(9003,'Aurora Star','ستاره')");
  await admin.unsafe("INSERT INTO people(id,name_latin) VALUES(9001,'Alpha'),(9002,'Beta'),(9003,'Gamma'),(9004,'Delta')");
  await admin.unsafe("INSERT INTO horse_people(horse_id,person_id,role) VALUES(9001,9001,'owner'),(9001,9003,'breeder'),(9002,9002,'owner'),(9002,9003,'breeder'),(9003,9001,'owner'),(9003,9004,'breeder')");
  for(const id of [9001,9002,9003])await refreshHorseSearch(seedDb,id);
  for(const [query,expected] of [
    ['name:aurora name:borealis',[9001,9002,9003]],
    ['name:"aurora moon" name:"borealis sun"',[9001,9002]],
    ['owner:alpha owner:beta breeder:gamma',[9001,9002]],
    ['owner:alpha breeder:gamma',[9001]],
    ['owner:beta breeder:delta',[]],
    ['name:"ماه روشن" name:"خورشید"',[9001,9002]],
    ['id:۹۰۰۱',[9001]],
    ['id:9001 id:9002 owner:alpha',[9001]],
    ['id:9001 name:borealis',[]],
    ['id:9004',[]],
    ['AURORA MOON',[9001,9003]],
  ]){
    const found=await request('/api/search?q='+encodeURIComponent(query));assertStatus(found,200);
    assert.deepEqual(found.body.results.map(row=>Number(row.id)).sort((a,b)=>a-b),expected,query);
  }
  pass('postgres-structured-field-alternatives','Native PostgreSQL full text query returns OR alternatives within fields and AND across fields, including phrases and Persian names');
  const idStatements=[];
  const idReader={...seedDb,prepare(sql){idStatements.push(sql);return seedDb.prepare(sql);}};
  assert.deepEqual((await searchHorses(idReader,'id:9001 id:9002 owner:alpha')).map(row=>row.id),[9001]);
  assert.equal(idStatements.length,1);
  await admin.unsafe("UPDATE horses SET deleted_at=CURRENT_TIMESTAMP WHERE id=9003");
  assertStatus(await request('/api/search?q=id%3A9003'),200);
  assert.deepEqual((await request('/api/search?q=id%3A9003')).body.results,[]);
  pass('postgres-id-discovery-bound','Explicit IDs perform only the canonical hydration query; owner/native/name constraints and deleted/missing IDs retain their semantics');
  }
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
  console.log(`${report.checks.length} PostgreSQL checks completed; report: review-r113/evidence/${reportDirectory}/report.json`);
}

'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Readable, PassThrough } = require('node:stream');
const fs = require('node:fs');
const path = require('node:path');
const { load, root } = require('./lib/r104-isolated-module.cjs');
const { isDemoAdminLoginAvailable, isProductionAuth } = load('src/auth/publicAuthPolicy.ts');
const { datasetClassification } = load('src/registry/datasetProvenance.ts');
const { safeErrorCategory } = load('src/security/logging.ts');
const { requireSameOriginMutation } = load('src/security/origin.ts');
const { enforceRateLimit } = load('src/security/rateLimit.ts');
const { nodeRequest, sendNodeResponse } = load('tools/local-http-bridge.ts');
const tick = () => new Promise(resolve => setImmediate(resolve));

for (const env of [undefined, {}, {APP_ENV:'production'}, {APP_ENV:'preview'}, {APP_ENV:'staging'}, {APP_ENV:'local-sqlite'}, {APP_ENV:'LOCAL'}, {APP_ENV:''}]) {
  test(`R106 privileged demo login fails closed for ${JSON.stringify(env)}`, () => {
    assert.equal(isDemoAdminLoginAvailable(env), false);
    assert.equal(isDemoAdminLoginAvailable({...env, ENABLE_DEMO_ADMIN_LOGIN:'1'}), false);
  });
}
for (const APP_ENV of ['local','development','test']) {
  test(`R106 ${APP_ENV} demo administrator requires explicit opt-in`, () => {
    for(const flag of [undefined,'0','true','yes',' 1','1 ']) {
      assert.equal(isDemoAdminLoginAvailable({APP_ENV, ENABLE_DEMO_ADMIN_LOGIN:flag}), false);
    }
    assert.equal(isDemoAdminLoginAvailable({APP_ENV, ENABLE_DEMO_ADMIN_LOGIN:'1'}), false);
    assert.equal(isDemoAdminLoginAvailable({APP_ENV, ENABLE_DEMO_ADMIN_LOGIN:'1',ISOLATED_DEMO_MODE:'1',REGISTRY_DATASET_KIND:'synthetic'}), APP_ENV==='local');
    assert.equal(isProductionAuth({APP_ENV}), false);
  });
}
for (const origin of ['https://untrusted.invalid','null','http://localhost:9999']) {
  test(`R106 demo origin guard rejects ${origin}`, () => {
    assert.throws(() => requireSameOriginMutation(new Request('http://localhost:3000/api/auth/demo-admin', {method:'POST',headers:{origin}})), e => e.status===403);
  });
}
test('R106 same-origin demo mutation accepted, cross-site metadata denied', () => {
  requireSameOriginMutation(new Request('http://localhost:3000/api/auth/demo-admin',{method:'POST',headers:{origin:'http://localhost:3000','sec-fetch-site':'same-origin'}}));
  assert.throws(() => requireSameOriginMutation(new Request('http://localhost:3000/api/auth/demo-admin',{method:'POST',headers:{'sec-fetch-site':'cross-site'}})), e => e.status===403);
});
test('R106 route structurally gates availability and origin before administrator creation', () => {
  // Wiring assertion; the policy and origin functions are exercised above. This
  // deliberately does not claim to load the whole Worker (external deps required).
  const text=fs.readFileSync(path.join(root,'src/api/routes.ts'),'utf8');
  const start=text.indexOf('async function demoAdminLogin(');
  assert.ok(start>=0);
  const fn=text.slice(start,text.indexOf('\nasync function ',start+1));
  assert.ok(fn.indexOf('isDemoAdminLoginAvailable(env)')>=0);
  assert.ok(fn.indexOf('requireSameOriginMutation(request)')>fn.indexOf('isDemoAdminLoginAvailable(env)'));
  assert.ok(fn.indexOf('requireSameOriginMutation(request)')<fn.indexOf('env.DB.prepare('));
});
for (const kind of ['public','auth','expensive','write']) {
  test(`R106 local ${kind} API does not require unavailable Cloudflare bindings`, async () => {
    await enforceRateLimit(new Request('http://localhost/api/test'),{APP_ENV:'local'},kind);
    for(const APP_ENV of ['production','local-sqlite',undefined]) {
      await assert.rejects(enforceRateLimit(new Request('http://localhost/api/test'),{APP_ENV},kind), e => e.status===503 && e.code==='rate_limiter_unavailable');
    }
  });
}
for(const count of [1,28,49999,50000,78089]) {
  test(`R106 count ${count} never supplies synthetic provenance`, () => {
    assert.deepEqual(datasetClassification({},count),{dataMode:'client',datasetProvenance:'unspecified'});
    assert.deepEqual(datasetClassification({REGISTRY_DATASET_KIND:'client'},count),{dataMode:'client',datasetProvenance:'declared_client'});
    assert.deepEqual(datasetClassification({REGISTRY_DATASET_KIND:'synthetic'},count),{dataMode:'demo',datasetProvenance:'synthetic'});
  });
}
test('R106 empty data stays empty; provenance must be an exact declaration', () => {
  assert.deepEqual(datasetClassification({},0),{dataMode:'empty',datasetProvenance:'unspecified'});
  assert.deepEqual(datasetClassification({REGISTRY_DATASET_KIND:'synthetic'},0),{dataMode:'empty',datasetProvenance:'synthetic'});
  for(const kind of ['demo','SYNTHETIC','synthetic ',undefined]) {
    assert.deepEqual(datasetClassification({REGISTRY_DATASET_KIND:kind},1),{dataMode:'client',datasetProvenance:'unspecified'});
  }
});
test('R106 public log category never returns a driver message/name/cause', () => {
  for(const cause of [new Error('password=secret'),{name:'token=secret',message:'secret'},'secret',null,undefined]) {
    assert.doesNotMatch(safeErrorCategory(cause),/secret|password|token/);
  }
  const e=new Error('secret');e.name='secret';e.cause='secret';
  assert.equal(safeErrorCategory(e),'error');
  assert.equal(safeErrorCategory(new TypeError('secret')),'type_error');
  assert.equal(safeErrorCategory(new RangeError('secret')),'range_error');
});

class FakeResponse extends EventEmitter {
  constructor(){ super();this.headers={};this.chunks=[];this.destroyed=false;this.writableFinished=false;this.allowWrite=true;this.flushed=false; }
  setHeader(k,v){this.headers[k]=v;}
  flushHeaders(){this.flushed=true;}
  write(v){this.chunks.push(Buffer.from(v));return this.allowWrite;}
  end(){this.writableFinished=true;this.emit('finish');}
  destroy(){this.destroyed=true;this.emit('close');}
}
test('R106 local response emits first SSE frame before producer finishes', async () => {
  let controller;
  const body=new ReadableStream({start(c){controller=c;}});
  const res=new FakeResponse();const pending=sendNodeResponse(new Response(body,{headers:{'content-type':'text/event-stream'}}),res);
  controller.enqueue(new TextEncoder().encode('data: first\n\n'));await tick();
  assert.equal(res.flushed,true);assert.equal(res.writableFinished,false);
  assert.equal(Buffer.concat(res.chunks).toString(),'data: first\n\n');
  controller.enqueue(new TextEncoder().encode('data: done\n\n'));controller.close();await pending;
  assert.equal(res.writableFinished,true);assert.equal(body.locked,false);
  assert.equal(Buffer.concat(res.chunks).toString(),'data: first\n\ndata: done\n\n');
});
test('R106 local backpressure stops response writes until drain', async () => {
  let controller;const body=new ReadableStream({start(c){controller=c;}});
  const res=new FakeResponse();res.allowWrite=false;
  const pending=sendNodeResponse(new Response(body),res);
  controller.enqueue(new Uint8Array([1]));controller.enqueue(new Uint8Array([2]));controller.close();await tick();
  assert.equal(res.chunks.length,1);assert.equal(res.listenerCount('drain'),1);
  res.allowWrite=true;res.emit('drain');await pending;
  assert.equal(res.chunks.length,2);assert.equal(res.listenerCount('drain'),0);assert.equal(res.listenerCount('close'),0);
});
test('R106 local client disconnect cancels producer and awaits cleanup', async () => {
  let cancelled=false,finishCancel;
  const gate=new Promise(resolve => {finishCancel=resolve;});
  const body=new ReadableStream({cancel:async()=>{cancelled=true;await gate;}});
  const res=new FakeResponse();let finished=false;
  const pending=sendNodeResponse(new Response(body),res).then(()=>{finished=true;});
  await tick();res.destroy();await tick();
  assert.equal(cancelled,true);assert.equal(finished,false);finishCancel();await pending;
  assert.equal(body.locked,false);assert.equal(res.listenerCount('close'),0);
});
test('R106 disconnect during backpressure unblocks drain and cancels body', async () => {
  let cancelled=false;
  const body=new ReadableStream({start(c){c.enqueue(new Uint8Array([1]));},cancel(){cancelled=true;}});
  const res=new FakeResponse();res.allowWrite=false;
  const pending=sendNodeResponse(new Response(body),res);await tick();res.destroy();await pending;
  assert.equal(cancelled,true);assert.equal(res.listenerCount('drain'),0);assert.equal(res.listenerCount('error'),0);
});
test('R106 local response preserves independent session cookies', async () => {
  const headers=new Headers();headers.append('set-cookie','one=1; HttpOnly');headers.append('set-cookie','two=2; HttpOnly');
  const res=new FakeResponse();await sendNodeResponse(new Response(null,{status:204,headers}),res);
  assert.deepEqual(res.headers['set-cookie'],['one=1; HttpOnly','two=2; HttpOnly']);assert.equal(res.statusCode,204);
});
test('R106 already disconnected local response cancels without writing', async () => {
  let cancelled=0;const body=new ReadableStream({cancel(){cancelled++;}});const res=new FakeResponse();res.destroyed=true;
  await sendNodeResponse(new Response(body),res);assert.equal(cancelled,1);assert.equal(res.chunks.length,0);assert.equal(body.locked,false);
});
test('R106 request body is not buffered before the Worker receives it', async () => {
  const req=new PassThrough();req.method='POST';req.url='/api/upload';req.headers={host:'localhost:3000','content-type':'application/json'};
  const request=await nodeRequest(req);assert.equal(request.method,'POST');assert.equal(request.url,'http://localhost:3000/api/upload');
  assert.equal(req.readableEnded,false);const text=request.text();req.end('{"synthetic":true}');assert.equal(await text,'{"synthetic":true}');
});
test('R106 local request preserves abort signal and handles bodyless methods', async () => {
  for(const method of ['GET','HEAD']) {
    const req=Readable.from([]);req.method=method;req.headers={host:'localhost:3000'};req.url='/api/test';
    const controller=new AbortController();const request=await nodeRequest(req,controller.signal);
    assert.equal(request.body,null);controller.abort();assert.equal(request.signal.aborted,true);
  }
});
test('R106 local plugin declares local auth policy and disables live demo side effects', () => {
  const text=fs.readFileSync(path.join(root,'tools/local-sqlite-vite.ts'),'utf8');
  assert.match(text,/APP_ENV: "local"/);assert.doesNotMatch(text,/APP_ENV: "local-sqlite"/);
  assert.match(text,/local_demo_manifest/);assert.match(text,/BILLING_LIVE_PAYMENTS_ENABLED: "false"/);
  assert.match(text,/PAYMENT_TERMINAL_RELEASE_ENABLED: "false"/);
  assert.match(text,/AI_GEMINI_ENABLED: "0", AI_DEEPSEEK_ENABLED: "0"/);
});

test('R106 actual local Vite middleware passes a safe environment, without reading demo AI secrets', async () => {
  const os=require('node:os');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'r106-plugin-'));
  const file=path.join(dir,'demo.sqlite');fs.writeFileSync(file,'synthetic test double');
  const keys=['HORSE_REGISTRY_SQLITE','HORSE_REGISTRY_DEMO_MODE','ENABLE_DEMO_ADMIN_LOGIN'];
  const previous=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  const originalLog=console.log;
  try {
    process.env.HORSE_REGISTRY_SQLITE=file;process.env.HORSE_REGISTRY_DEMO_MODE='1';process.env.ENABLE_DEMO_ADMIN_LOGIN='1';
    console.log=()=>{};
    const db={prepare(){return {first:async()=>({namespace:'synthetic:r111'})};}};
    const {localSqliteApiPlugin}=load('tools/local-sqlite-vite.ts',{
      'vite':{loadEnv(){throw new Error('Demo must not load secrets');}},
      '../src/db/localSqlite':{openLocalSqlite:()=>db},
    });
    let handler,captured;
    localSqliteApiPlugin(dir).configureServer({middlewares:{use(fn){handler=fn;}},
      ssrLoadModule:async()=>({default:{fetch:async(request,env)=>{captured=env;return new Response('{}');}}}),
      ssrFixStacktrace(){},
    });
    for(const host of ['127.0.0.1:3000','localhost:3000','[::1]:3000','untrusted.invalid:3000']) {
      const req=Readable.from([]);req.method='GET';req.url='/api/health';req.headers={host};req.socket={remoteAddress:'127.0.0.1'};const res=new FakeResponse();
      await handler(req,res,()=>{throw new Error('Wrong middleware path');});
      if(host.startsWith('untrusted')) {assert.equal(res.statusCode,403);continue;}
      assert.equal(captured.APP_ENV,'local');assert.equal(captured.DB,db);assert.equal(captured.DB_PROVIDER_MODE,'d1_only');
      assert.equal(captured.SESSION_COOKIE_NAME,'horse_registry_isolated_demo');assert.equal(captured.REGISTRY_DATASET_KIND,'synthetic');
      assert.equal(captured.AI_ASSISTANT_ENABLED,'1');assert.equal(captured.AI_DEMO_REGISTRY_RESEARCH,'1');assert.equal(captured.AI_GEMINI_ENABLED,'0');assert.equal(captured.AI_DEEPSEEK_ENABLED,'0');assert.equal(captured.GEMINI_API_KEY,undefined);
      assert.equal(captured.BILLING_LIVE_PAYMENTS_ENABLED,'false');assert.equal(captured.PAYMENT_TERMINAL_RELEASE_ENABLED,'false');
      assert.equal(captured.ENABLE_DEMO_ADMIN_LOGIN,'1');
      assert.equal(captured.ISOLATED_DEMO_MODE,'1');assert.equal(captured.PAYMENT_CALLBACK_BASE_URL,'http://127.0.0.1:3000');
      assert.ok(captured.NOTIFICATION_CALLBACK_SECRET.length>=32);assert.ok(captured.MEDIA_ACCESS_TOKEN_SECRET.length>=32);
      assert.equal(res.writableFinished,true);assert.equal(res.listenerCount('close'),0);
    }
  } finally {
    console.log=originalLog;
    for(const key of keys) if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('R106 synthetic database executes actual directory/workspace authority and CAS commands', () => {
  // A child process owns the SQLite handle until exit; no mocks of the DB engine
  // or production commands, and no dependency on an external server/provider.
  const os=require('node:os');const {spawnSync}=require('node:child_process');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'r106-domain-'));const file=path.join(dir,'isolated.sqlite');
  try {
    const python=process.env.PYTHON||(process.platform==='win32'?'python':'python3');
    const made=spawnSync(python,[path.join(root,'tools/create-demo-database.py'),'--output',file,'--as-of','2026-10-14'],{encoding:'utf8'});
    assert.equal(made.status,0,made.stderr);
    const script=`
      const assert=require('node:assert/strict');
      require('./tools/lib/register-typescript.cjs');
      const {openLocalSqlite}=require('./src/db/localSqlite.ts');
      const {managedProfile}=require('./src/directory/profileView.ts');
      const {authorizeWorkspace}=require('./src/workspaces/access.ts');
      const {completeTaskStatements}=require('./src/workspaces/commands.ts');
      (async()=>{
        const db=openLocalSqlite(process.argv[1]);
        const profile=await managedProfile(db,'demo-admin-local',990000001);
        assert.equal(profile.profile.province_needs_review,false);
        assert.equal(profile.profile.province_code,'IR-23');
        assert.equal(profile.profile.contact_value,null);
        assert.equal(profile.permissions.private_contact,false);
        assert.equal(await managedProfile(db,'unknown-user',990000001),null);
        const access=await authorizeWorkspace(db,{userId:'demo-admin-local',role:'admin'},970000001,'tasks_manage');
        assert.equal(access.as,'staff');
        await assert.rejects(authorizeWorkspace(db,{userId:'other-user',role:'admin'},970000001,'view'),e=>e.status===404);
        const input={collectionId:970000001,taskId:970002001,actorUserId:'demo-admin-local',expectedVersion:1,operationId:'synthetic-r106-complete',nextDueDate:null};
        const first=await db.batch(completeTaskStatements(db,input));assert.equal(first[0].meta.changes,1);
        const stale=await db.batch(completeTaskStatements(db,input));assert.equal(stale[0].meta.changes,0);
        const task=await db.prepare('SELECT status,row_version FROM workspace_tasks WHERE id=?').bind(input.taskId).first();
        assert.equal(task.status,'done');assert.equal(task.row_version,2);
        await db.prepare('UPDATE users SET is_active=0 WHERE id=?').bind('demo-admin-local').run();
        await assert.rejects(authorizeWorkspace(db,{userId:'demo-admin-local',role:'admin'},970000001,'view'),e=>e.status===404);
        const denied=await db.batch(completeTaskStatements(db,{...input,taskId:970002002}));assert.equal(denied[0].meta.changes,0);
        console.log('actual SQLite directory projection, privacy, workspace authority, CAS, and revocation passed');
      })().catch(e=>{console.error(e);process.exitCode=1;});
    `;
    const result=spawnSync(process.execPath,['-e',script,file],{cwd:root,encoding:'utf8'});
    assert.equal(result.status,0,result.stderr+'\n'+result.stdout);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

// Executes the exact registration/cleanup tail; not a mounted React renderer.
test('R106 registry columns remove the same capture scroll listener on cleanup', () => {
  const source=fs.readFileSync(path.join(root,'src/web/main.tsx'),'utf8');
  const start=source.indexOf('const onScroll=()=>setColumnsOpen(false);');
  assert.ok(start>=0);
  const end=source.indexOf('},[columnsOpen]);',start);assert.ok(end>start);
  const listeners=[];const removed=[];let open=true;
  const target={addEventListener:(...args)=>listeners.push(args),removeEventListener:(...args)=>removed.push(args)};
  const cleanup=Function('window','document','setColumnsOpen','measure','onDocPointer','onKey',source.slice(start,end))(target,target,v=>open=v,()=>{},()=>{},()=>{});
  const scroll=listeners.find(([name])=>name==='scroll');assert.ok(scroll);assert.equal(scroll[2].capture,true);
  scroll[1]();assert.equal(open,false);cleanup();
  assert.ok(removed.some(([name,handler,capture])=>name==='scroll'&&handler===scroll[1]&&capture===true));
  const banner=source.split('\n').find(line=>line.includes('health && health.dataMode!=="client"&&<div className="data-state demo"'));
  assert.match(banner,/health\.dataMode==="empty"/);assert.doesNotMatch(banner,/Load the client workbook into local D1/);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {parseJsonc,verifyHyperdriveFreshness} from './verify-hyperdrive-freshness.mjs';
const id='a'.repeat(32),account='b'.repeat(32);
const config=()=>({vars:{APP_ENV:'production',DB_PROVIDER_MODE:'supabase_full',ENABLE_DEMO_ADMIN_LOGIN:'0'},hyperdrive:[{binding:'SUPABASE_HYPERDRIVE',id}]});
const env={CLOUDFLARE_ACCOUNT_ID:account,CLOUDFLARE_API_TOKEN:'synthetic-test-not-a-secret'};
const reply=(result={id,caching:{disabled:true}})=>async()=>new Response(JSON.stringify({success:true,result}));
test('R106 JSONC preserves URLs, escaped quotes and comma-like strings',()=>{
  const text=String.raw`{ // trailing line
    "url":"https://example.invalid/a//b", "sql":"select ',}'", "quote":"a\"b", /* block */ "items":[1,2,],
  }`;
  assert.deepEqual(parseJsonc(text),{url:'https://example.invalid/a//b',sql:"select ',}'",quote:'a"b',items:[1,2]});
});
test('R106 JSONC malformed/unterminated inputs fail closed',()=>{
  for(const text of ['{','{"key":','{/* not closed','{"a":1,,}']) assert.throws(()=>parseJsonc(text),/config_invalid_jsonc/);
});
test('R106 deployed root configuration is parsed as production Supabase authority',()=>{
  const c=parseJsonc(fs.readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
  assert.equal(c.vars.APP_ENV,'production');assert.equal(c.vars.DB_PROVIDER_MODE,'supabase_full');
  assert.equal(c.hyperdrive.filter(b=>b.binding==='SUPABASE_HYPERDRIVE').length,1);
});
test('R106 freshness gate uses GET only and excludes API secrets from attestation',async()=>{
  let calls=0;
  const result=await verifyHyperdriveFreshness(config(),env,async(url,init)=>{
    calls++;assert.equal(url,`https://api.cloudflare.com/client/v4/accounts/${account}/hyperdrive/configs/${id}`);
    assert.equal(init.method,'GET');assert.equal(init.redirect,'error');assert.equal(init.body,undefined);
    assert.equal(init.headers.authorization,`Bearer ${env.CLOUDFLARE_API_TOKEN}`);
    return new Response(JSON.stringify({success:true,result:{id,caching:{disabled:true},origin:{password:'NEVER_LOG',host:'PRIVATE_HOST'}}}));
  });
  assert.equal(calls,1);assert.equal(result.cachingDisabled,true);assert.equal(result.liveAuthorityRevocationTest,'still_required');
  assert.doesNotMatch(JSON.stringify(result),/NEVER_LOG|PRIVATE_HOST|synthetic-test/);
});
for(const disabled of [false,undefined,null,'true',1])test(`R106 cache disabled=${JSON.stringify(disabled)} is refused`,async()=>{
  await assert.rejects(verifyHyperdriveFreshness(config(),env,reply({id,caching:{disabled}})),/authority_query_cache_must_be_disabled/);
});
test('R106 credentials missing causes zero API calls',async()=>{
  let calls=0;await assert.rejects(verifyHyperdriveFreshness(config(),{},async()=>{calls++;}),/cloudflare_read_credentials_required/);assert.equal(calls,0);
});
test('R106 unknown or non-production release configuration is refused',async()=>{
  for(const APP_ENV of [undefined,'development','preview','local']){
    const c=config();c.vars.APP_ENV=APP_ENV;await assert.rejects(verifyHyperdriveFreshness(c,env,reply()),/production_environment_required/);
  }
  const c=config();c.vars.ENABLE_DEMO_ADMIN_LOGIN='1';await assert.rejects(verifyHyperdriveFreshness(c,env,reply()),/production_demo_administrator_forbidden/);
});
test('R106 speculative full-provider modes do not become release certified',async()=>{
  for(const mode of ['d1_full','turso_full','supabase','unknown']){
    const c=config();c.vars.DB_PROVIDER_MODE=mode;await assert.rejects(verifyHyperdriveFreshness(c,env,reply()),/provider_mode_not_release_certified/);
  }
});
test('R106 D1-only release is explicitly not applicable, never mislabeled cache-certified',async()=>{
  const c=config();c.vars.DB_PROVIDER_MODE='d1_only';let calls=0;
  const result=await verifyHyperdriveFreshness(c,{},async()=>{calls++;});assert.equal(result.status,'not_applicable');assert.equal(calls,0);
});
test('R106 missing or duplicate binding cannot bypass gate',async()=>{
  for(const bindings of [undefined,[],[...config().hyperdrive,...config().hyperdrive]]){
    const c=config();c.hyperdrive=bindings;await assert.rejects(verifyHyperdriveFreshness(c,env,reply()),/canonical_hyperdrive_binding_required/);
  }
});
test('R106 malformed IDs cannot alter API destination',async()=>{
  for(const id of ['../../anything','https://example.invalid','x'.repeat(32),'']){
    const c=config();c.hyperdrive[0].id=id;await assert.rejects(verifyHyperdriveFreshness(c,env,reply()),/hyperdrive_id_invalid/);
  }
});
test('R106 failed, malformed or wrong-identity API responses are refused safely',async()=>{
  await assert.rejects(verifyHyperdriveFreshness(config(),env,async()=>{throw new Error('UPSTREAM_SECRET');}),/hyperdrive_read_failed/);
  await assert.rejects(verifyHyperdriveFreshness(config(),env,async()=>new Response('UPSTREAM_SECRET',{status:403})),/hyperdrive_read_refused/);
  await assert.rejects(verifyHyperdriveFreshness(config(),env,async()=>new Response('UPSTREAM_SECRET')),/hyperdrive_response_invalid/);
  await assert.rejects(verifyHyperdriveFreshness(config(),env,reply({id:'c'.repeat(32),caching:{disabled:true}})),/hyperdrive_response_identity_mismatch/);
});

test('R106 Persian showcase translates labels but keeps canonical filter values',async()=>{
  const {createViews}=await import('../public/demo-workbench/views.mjs');
  const {newState}=await import('../public/demo-workbench/model.mjs');
  const data=JSON.parse(fs.readFileSync(new URL('../public/demo-workbench/data.json',import.meta.url),'utf8'));
  const original=JSON.stringify(data);
  const fa=createViews(data,newState(),'fa');
  const html=fa.horses();
  assert.ok(html.includes('value="male"'));
  assert.ok(html.includes('value="Arabian"'));
  assert.ok(html.includes('\u0646\u0631'));
  assert.ok(html.includes('\u0639\u0631\u0628'));
  assert.doesNotMatch(html,/>male<|>female<|>Arabian<|>Tehran</);
  assert.doesNotMatch(fa.horse(17),/aria-label="Ancestry coverage"/);
  assert.equal(JSON.stringify(data),original);
  assert.match(createViews(data,newState(),'en').horses(),/>male</);
});
test('R106 translated display still escapes unknown malicious labels',async()=>{
  const {createViews}=await import('../public/demo-workbench/views.mjs');
  const {newState}=await import('../public/demo-workbench/model.mjs');
  const data=JSON.parse(fs.readFileSync(new URL('../public/demo-workbench/data.json',import.meta.url),'utf8'));
  data.horses[0].breed_desc='<img src=x onerror=bad>';
  const html=createViews(data,newState(),'fa').horses();
  assert.ok(html.includes('&lt;img src=x onerror=bad&gt;'));assert.doesNotMatch(html,/<img src=x/);
});

import {validateReleaseRevision} from './release-revision-policy.mjs';
const sha='a'.repeat(40);
test('R106 release requires actual checkout HEAD, never just a supplied CI label',()=>{
  assert.throws(()=>validateReleaseRevision({head:sha,ciSha:'b'.repeat(40),approvedSha:'b'.repeat(40),status:''}),/ci_revision_does_not_match_checkout/);
  assert.throws(()=>validateReleaseRevision({head:'',ciSha:sha,approvedSha:sha,status:''}),/checkout_revision_unavailable/);
});
test('R106 exact approved SHA does not authorize changed or untracked source',()=>{
  for(const status of [' M src/worker.ts\n','?? new-api.ts\n','M  package.json\n',null,undefined]) {
    assert.throws(()=>validateReleaseRevision({head:sha,ciSha:sha,approvedSha:sha,status}),/dirty_checkout_not_approved/);
  }
});
test('R106 clean exact approval supports local and CI releases',()=>{
  for(const ciSha of ['',undefined,sha]) assert.equal(validateReleaseRevision({head:sha,ciSha,approvedSha:sha,status:''}),sha);
  assert.throws(()=>validateReleaseRevision({head:sha,status:'',approvedSha:'b'.repeat(40)}),/exact_checkout_approval_required/);
});
test('R106 actual CLI rejects dirty and spoofed disposable git checkouts',async()=>{
  const {execFileSync,spawnSync}=await import('node:child_process');
  const {tmpdir}=await import('node:os');const path=await import('node:path');
  const dir=fs.mkdtempSync(path.join(tmpdir(),'r106-approval-'));
  const gate=new URL('./require-r95-release-approval.mjs',import.meta.url);
  try {
    execFileSync('git',['init','--quiet'],{cwd:dir});fs.writeFileSync(path.join(dir,'source.txt'),'approved');
    execFileSync('git',['add','source.txt'],{cwd:dir});
    execFileSync('git',['-c','user.name=Synthetic Test','-c','user.email=synthetic@example.invalid','commit','--quiet','-m','fixture'],{cwd:dir});
    const head=execFileSync('git',['rev-parse','HEAD'],{cwd:dir,encoding:'utf8'}).trim();
    const run=(overrides={})=>spawnSync(process.execPath,[fileURLToPath(gate)],{cwd:dir,encoding:'utf8',env:{...process.env,GITHUB_SHA:head,R95_PRODUCTION_RELEASE_APPROVED_SHA:head,...overrides}});
    assert.equal(run().status,0);
    fs.writeFileSync(path.join(dir,'source.txt'),'unapproved');assert.equal(run().status,1);
    fs.writeFileSync(path.join(dir,'source.txt'),'approved');fs.writeFileSync(path.join(dir,'new.ts'),'unapproved');assert.equal(run().status,1);
    fs.unlinkSync(path.join(dir,'new.ts'));
    const other=head.slice(0,-1)+(head.endsWith('f')?'0':'f');assert.equal(run({GITHUB_SHA:other,R95_PRODUCTION_RELEASE_APPROVED_SHA:other}).status,1);
    assert.match(run().stdout,/not proof that tests ran/);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

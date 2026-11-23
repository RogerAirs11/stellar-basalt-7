'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {load}=require('./lib/r104-isolated-module.cjs');
const {createPlatformClient}=load('src/frontend-kit/platformClient.ts');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
const session=id=>({user:{id,email:`${id}@example.invalid`,display_name:id,role:'owner'},csrfToken:`csrf-${id}`,permissions:['horse.read','claim.create']});
const observe=promise=>promise.then(value=>({value}),error=>({error}));
test('R108 auth: a late me cannot restore a logged-out principal',async()=>{
 const read=deferred();const sessions=[];const client=createPlatformClient({transport:url=>url.endsWith('/me')?read.promise:Promise.resolve({ok:true}),onSessionChange:s=>sessions.push(s)});
 const pending=observe(client.auth.me());await client.auth.logout();read.resolve(session('A'));const result=await pending;
 assert.equal(sessions.at(-1).user,null);assert.equal(result.error?.code,'session_superseded');
});
test('R108 auth: out-of-order session reads do not republish the older snapshot',async()=>{
 const a=deferred(),b=deferred();let n=0;const sessions=[];const client=createPlatformClient({transport:()=>++n===1?a.promise:b.promise,onSessionChange:s=>sessions.push(s)});
 const first=observe(client.auth.me());const second=client.auth.me();b.resolve(session('B'));await second;a.resolve(session('A'));await first;
 assert.equal(sessions.at(-1).user.id,'B');assert.equal(sessions.filter(s=>s.user?.id==='A').length,0);
});
test('R108 auth: overlapping cookie-changing commands are refused before transport',async()=>{
 const gate=deferred();let calls=0;const client=createPlatformClient({transport:()=>{calls++;return gate.promise}});
 const first=observe(client.auth.login({email:'a@example.invalid',password:'fixture'}));
 const second=observe(client.auth.demoAdmin());await Promise.resolve();gate.resolve(session('A'));await first;const result=await second;
 assert.equal(calls,1);assert.equal(result.error?.code,'session_change_in_progress');
});
test('R108 auth: me cannot race an in-flight authentication mutation',async()=>{
 const gate=deferred();const calls=[];const client=createPlatformClient({transport:url=>{calls.push(url);return gate.promise}});
 const login=observe(client.auth.login({email:'a@example.invalid',password:'fixture'}));const read=observe(client.auth.me());gate.resolve(session('A'));await login;
 assert.equal((await read).error?.code,'session_change_in_progress');assert.deepEqual(calls,['/api/auth/login']);
});
test('R108 auth: logout clears private local state immediately and preserves captured CSRF',async()=>{
 const gate=deferred();let csrf='csrf-before',sent;const sessions=[];const client=createPlatformClient({csrfToken:()=>csrf,transport:(_url,init)=>{sent=init;return gate.promise},onSessionChange:s=>{csrf=s.csrfToken;sessions.push(s)}});
 const pending=observe(client.auth.logout());assert.equal(sessions.at(-1)?.user,null);assert.equal(sent.headers['x-csrf-token'],'csrf-before');gate.reject(new Error('transport unavailable'));assert.ok((await pending).error);assert.equal(csrf,null);
});
for(const [label,payload] of [
 ['missing object',null],['missing permissions',{user:null,csrfToken:null}],['anonymous privilege',{user:null,csrfToken:null,permissions:['horse.edit']}],
 ['malformed user',{...session('A'),user:{id:'A'}}],['malformed token',{...session('A'),csrfToken:{secret:true}}],
 ['malformed permission',{...session('A'),permissions:[{}]}],['unknown permission',{...session('A'),permissions:['horse.superpower']}],
]) test(`R108 auth: rejects ${label} success payload without publishing authority`,async()=>{
 const sessions=[];const client=createPlatformClient({transport:async()=>payload,onSessionChange:s=>sessions.push(s)});const result=await observe(client.auth.me());
 assert.equal(result.error?.code,'invalid_session_response');assert.ok(sessions.every(s=>s.user===null&&s.permissions.length===0));
});
test('R108 auth: register and OTP verify use the same mutation fence',async()=>{
 for(const kind of ['register','otpVerify']){
  const gate=deferred();let calls=0;const client=createPlatformClient({transport:()=>{calls++;return gate.promise}});
  const first=observe(client.modules.authExt[kind]({email:'a@example.invalid',password:'fixture',display_name:'A',phone:'+10000000000',code:'000000'}));
  const second=observe(client.auth.logout());gate.resolve(session('A'));await first;
  assert.equal((await second).error?.code,'session_change_in_progress');assert.equal(calls,1);
 }
});
test('R108 auth: aborted stale reads never publish a custom transport result',async()=>{
 const gate=deferred();const controller=new AbortController();const sessions=[];const client=createPlatformClient({transport:()=>gate.promise,onSessionChange:s=>sessions.push(s)});
 const pending=observe(client.auth.me({signal:controller.signal}));controller.abort();gate.resolve(session('A'));
 assert.equal((await pending).error?.name,'AbortError');assert.equal(sessions.length,0);
});

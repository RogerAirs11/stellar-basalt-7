'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./lib/r104-isolated-module.cjs');
const { createHookHarness } = require('./lib/r108-hook-harness.cjs');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function setup(t) {
  const values = new Map();
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const storage = { get length() { return values.size; }, key(i) { return [...values.keys()][i] ?? null; }, getItem(k) { return values.get(k) ?? null; }, setItem(k,v) { values.set(k,String(v)); }, removeItem(k) { values.delete(k); } };
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:storage});
  t.after(() => original ? Object.defineProperty(globalThis,'localStorage',original) : delete globalThis.localStorage);
  const h=createHookHarness(); t.after(()=>h.dispose());
  const principal=load('src/frontend-kit/domain/principalScope.ts',{react:h.react});
  const m=load('src/frontend-kit/domain/mutationIntent.ts',{react:h.react,'./principalScope':principal});
  let scope='user:a'; let resource='42'; let lookup=async()=>({state:'unknown'});
  const render=()=>h.render(()=>m.useMutationIntent('service-request',scope,resource,lookup));
  let api=render();h.flush();api=render();
  return { values,storage,m,h,render,api,scope(v){scope=v;},resource(v){resource=v;},lookup(v){lookup=v;} };
}
test('R109 intent: changing account masks private prior metadata before effects', t=>{
 const x=setup(t);x.api.begin({category:'farrier',note_length:10}); assert.ok(x.render().snapshot.record);
 x.scope('user:b');const b=x.render(); assert.equal(b.snapshot.record,null);assert.equal(b.snapshot.phase,'idle');
});
test('R109 intent: late reconciliation cannot confirm or clear a newer intent',async t=>{
 const x=setup(t);const gate=deferred();x.lookup(()=>gate.promise);let api=x.render();
 const old=api.begin({category:'farrier'});api.markSubmitted(old);api=x.render();const pending=api.reconcileNow();
 api.discard();const fresh=api.begin({category:'trainer'});assert.notEqual(old,fresh);
 gate.resolve({state:'confirmed',request_id:7});await pending;
 const current=x.render();assert.equal(current.snapshot.record.key,fresh);assert.notEqual(current.snapshot.phase,'confirmed');
});
test('R109 intent: old successful create receipt cannot clear a replacement intent', t=>{
 const x=setup(t);const old=x.api.begin({category:'farrier'});x.api.discard();const fresh=x.api.begin({category:'trainer'});
 x.api.confirmResult(7,old);assert.equal(x.render().snapshot.record?.key,fresh);
});
test('R109 intent: pending duplicate begin reuses key rather than losing an uncertain write', t=>{
 const x=setup(t);const first=x.api.begin({category:'farrier'});const second=x.api.begin({category:'trainer'});
 assert.equal(first,second);assert.equal(x.render().snapshot.record.summary.category,'farrier');
});
test('R109 intent: confirmed lookup requires a valid exact request receipt',async t=>{
 const x=setup(t);x.lookup(async()=>({state:'confirmed'}));let api=x.render();const key=api.begin({category:'farrier'});api.markSubmitted(key);await api.reconcileNow();
 const snap=x.render().snapshot;assert.notEqual(snap.phase,'confirmed');assert.equal(snap.record.key,key);
});
test('R109 intent: local storage may become unavailable after the initial probe',t=>{
 const x=setup(t);x.storage.setItem=()=>{throw new Error('QuotaExceededError');};
 assert.doesNotThrow(()=>x.api.begin({category:'farrier'}));const snap=x.render().snapshot;
 assert.equal(snap.durable,false);assert.ok(snap.record);
});
test('R109 intent: denied storage getters and enumeration do not crash private-state cleanup',t=>{
 const x=setup(t);Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw new Error('SecurityError');}});
 const storage=x.m.openIntentStorage();assert.doesNotThrow(()=>storage.sweepForeignScopes('anonymous'));
});
test('R109 intent: future-dated recovery records cannot remain fresh forever',t=>{
 const x=setup(t);assert.equal(x.m.isIntentExpired({createdAt:new Date(Date.now()+86400000).toISOString()}),true);
});
test('R109 intent: storage values must match the requested principal/workflow/resource',t=>{
 const x=setup(t);const key=x.api.begin({category:'farrier'});const storage=x.m.openIntentStorage();
 const name=[...x.values.keys()][0];const raw=JSON.parse(x.values.get(name));raw.scope='user:b';raw.resource='99';x.values.set(name,JSON.stringify(raw));
 assert.equal(storage.load('user:a','service-request','42'),null);
});
test('R109 intent: storage refuses corrupt and overlarge metadata',t=>{
 const x=setup(t);x.api.begin({category:'farrier'});const name=[...x.values.keys()][0];const valid=JSON.parse(x.values.get(name));
 for(const patch of [{workflow:null},{summary:['wrong']},{createdAt:'invalid'},{key:'x'.repeat(100000)},{summary:{note:'private text must not persist'}}]){
  x.values.set(name,JSON.stringify({...valid,...patch}));assert.equal(x.m.openIntentStorage().load('user:a','service-request','42'),null);
 }
});

test('R109 intent: disposed controllers cannot clear or confirm a still-live record', async t=>{
 const x=setup(t);const gate=deferred();x.lookup(()=>gate.promise);const api=x.render();
 const key=api.begin({category:'farrier'});api.markSubmitted(key);const pending=api.reconcileNow();x.h.dispose();
 assert.equal(api.confirmResult(7,key),false);api.discard();
 gate.resolve({state:'confirmed',request_id:7});await pending;
 assert.equal(x.m.openIntentStorage().load('user:a','service-request','42')?.key,key);
});
test('R109 intent: compare-and-clear preserves a newer durable record',t=>{
 const x=setup(t);const old=x.api.begin({category:'farrier'});const storage=x.m.openIntentStorage();
 const record=storage.load('user:a','service-request','42');storage.save({...record,key:'new-key'});
 storage.clear('user:a','service-request','42',old);
 assert.equal(storage.load('user:a','service-request','42').key,'new-key');
});

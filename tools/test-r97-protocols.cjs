'use strict';
require('./lib/register-typescript.cjs');
const test=require('node:test');const assert=require('node:assert/strict');
const fx=require('../tests/helpers/realDatabase.ts');
const reconciliation=require('../src/commerce/reconciliation.ts');
const terminal=require('../src/commerce/payments/terminalPolicy.ts');
const email=require('../src/notifications/email.ts');
const market=require('../src/marketplace/commands.ts');
const reminders=require('../src/workspaces/reminders.ts');
const worker=require('../src/notifications/worker.ts');
const NOW='2026-10-05T12:00:00.000Z';
const ENV={ZARINPAL_MERCHANT_ID:'synthetic-merchant',ZARINPAL_BASE_URL:'https://gateway.example.test',ZARINPAL_APPROVED_ORIGINS:'https://gateway.example.test',PAYMENT_TERMINAL_RELEASE_ENABLED:'true',PAYMENT_TERMINAL_RELEASE_APPROVAL_REF:'synthetic-approval-review-r97'};
async function world(){
 const db=await fx.openRealDatabase();await fx.seedUser(db,'admin','admin');await fx.seedUser(db,'buyer');await fx.seedBillingPrices(db);
 const order=await fx.createOrder(db,{buyer:'buyer',key:'r97-terminal-'+crypto.randomUUID()});
 const {attemptId}=await fx.reserveAttempt(db,order.id,'buyer');
 const authority='AUTH-R97-EXAMPLE';
 await db.prepare("UPDATE payment_attempts SET authority=?,state='redirected',created_at=datetime('now','-48 hours') WHERE id=?").bind(authority,attemptId).run();
 await db.prepare("INSERT INTO billing_review_cases(payment_attempt_id,reason,details_json) VALUES(?,'stale_unverified','{}')").bind(attemptId).run();
 const caseId=(await db.prepare('SELECT id FROM billing_review_cases').first()).id;
 const policy=await terminal.configuredTerminalReleasePolicy(ENV);
 const input={caseId,operatorUserId:'admin',outcome:'provider_not_paid_confirmed',resolutionNote:'Synthetic reviewed reversal evidence',newAttemptPolicy:'allow_new_attempt',terminalPolicy:policy,
 evidence:{attempt_id:attemptId,order_id:order.id,order_key:order.order_key,amount_minor:order.total_minor,currency:'IRR',authority,provider_reference:null}};
 return{db,order,attemptId,authority,caseId,policy,input};
}
async function observe(w,outcome='reversed',overrides={}){
 await w.db.batch(reconciliation.providerInquiryStatements(w.db,{attemptId:w.attemptId,operatorUserId:'admin',outcome,providerScopeHash:w.policy.providerScopeHash,observedAuthority:w.authority,...overrides}));
}
async function state(w){return(await w.db.prepare('SELECT status FROM billing_review_cases WHERE id=?').bind(w.caseId).first()).status;}
test('terminal release remains unavailable without deployment-owned approval',async()=>{
 const w=await world();await observe(w);delete w.input.terminalPolicy;
 assert.throws(()=>reconciliation.resolveReviewCaseStatements(w.db,w.input),e=>e.status===501);
 assert.equal(await state(w),'open');
 assert.equal(await terminal.configuredTerminalReleasePolicy({...ENV,PAYMENT_TERMINAL_RELEASE_ENABLED:undefined}),undefined);
});
test('FAILED observation plus elapsed time is not terminal evidence',async()=>{
 const w=await world();await observe(w,'failed_observed');await w.db.batch(reconciliation.resolveReviewCaseStatements(w.db,w.input));
 assert.equal(await state(w),'open');
});
test('fresh scoped reversal with approved policy resolves once without fulfilling',async()=>{
 const w=await world();await observe(w);await w.db.batch(reconciliation.resolveReviewCaseStatements(w.db,w.input));
 assert.equal(await state(w),'resolved');assert.equal(await fx.countRows(w.db,'entitlements'),0);
 await w.db.batch(reconciliation.resolveReviewCaseStatements(w.db,w.input));
 assert.equal(await fx.countRows(w.db,'audit_events',"action='payment.terminal_released'"),1);
});
test('stale reversal observation cannot unlock another charge',async()=>{
 const w=await world();await observe(w);await w.db.exec("UPDATE payment_events SET created_at=datetime('now','-1 hour') WHERE inquiry_outcome='reversed'");
 await w.db.batch(reconciliation.resolveReviewCaseStatements(w.db,w.input));assert.equal(await state(w),'open');
});
test('different merchant scope and changed authority both refuse release',async()=>{
 const w=await world();await observe(w,'reversed',{providerScopeHash:'a'.repeat(64)});
 await w.db.batch(reconciliation.resolveReviewCaseStatements(w.db,w.input));assert.equal(await state(w),'open');
 await observe(w);await w.db.exec("UPDATE payment_attempts SET authority='DIFFERENT-AUTHORITY'");
 await w.db.batch(reconciliation.resolveReviewCaseStatements(w.db,w.input));assert.equal(await state(w),'open');
});
test('later contradictory inquiry blocks an earlier reversal',async()=>{
 const w=await world();await observe(w);await observe(w,'in_bank');await w.db.batch(reconciliation.resolveReviewCaseStatements(w.db,w.input));assert.equal(await state(w),'open');
});
test('paid order and recorded verification cannot be released even if state was corrupted',async()=>{
 const w=await world();await observe(w);await w.db.exec("UPDATE orders SET status='paid'");
 await w.db.batch(reconciliation.resolveReviewCaseStatements(w.db,w.input));assert.equal(await state(w),'open');
 await w.db.exec("UPDATE orders SET status='awaiting_payment'");
 await w.db.prepare("INSERT INTO payment_events(payment_attempt_id,actor,from_state,to_state,payload_json) VALUES(?,'provider','redirected','verified','{}')").bind(w.attemptId).run();
 await w.db.batch(reconciliation.resolveReviewCaseStatements(w.db,w.input));assert.equal(await state(w),'open');
});
test('merchant scope changes when the configured merchant or approved origin changes',async()=>{
 const a=await terminal.gatewayScopeHash(ENV);const b=await terminal.gatewayScopeHash({...ENV,ZARINPAL_MERCHANT_ID:'another-merchant'});assert.notEqual(a,b);
 assert.equal(await terminal.gatewayScopeHash({...ENV,ZARINPAL_BASE_URL:'https://unapproved.test'}),null);
});
const message={to:'buyer@example.test',purpose:'service_request_notice',subject:'Synthetic subject',html:'<p>Test</p>',idempotencyKey:'r97-example-event'};
const config={apiUrl:'https://api.resend.com/emails',apiKey:'test-only-secret',from:'registry@example.test'};
test('email requests refuse redirects and never silently discard invalid idempotency keys',()=>{
 assert.equal(email.buildEmailRequest(config,message).init.redirect,'error');
 assert.throws(()=>email.buildEmailRequest(config,{...message,idempotencyKey:'invalid key'}));
 for(const url of ['http://example.test','https://user:pass@example.test','https://example.test/#fragment'])assert.throws(()=>email.buildEmailRequest({...config,apiUrl:url},message));
});
test('provider fingerprint changes for recipient, body, and account; generic APIs have no assumed window',async()=>{
 const provider=email.httpEmailProvider(config);const initial=await provider.requestFingerprint(message);
 for(const change of [{to:'different@example.test'},{html:'<p>changed</p>'}])assert.notEqual(await provider.requestFingerprint({...message,...change}),initial);
 assert.notEqual(await email.httpEmailProvider({...config,apiKey:'different-secret'}).requestFingerprint(message),initial);
 assert.equal(email.httpEmailProvider({...config,apiUrl:'https://generic.example.test/send'}).idempotencyWindowMs,null);
 assert.equal(provider.idempotencyWindowMs,86400000);
});
test('action links reject injected protocols and escape markup in absolute links',()=>{
 assert.throws(()=>email.emailMessageFor('password_reset','a@example.test','javascript:alert(1)'));
 const result=email.emailMessageFor('password_reset','a@example.test','https://registry.test/reset?token=a&next="x"');
 assert.ok(result.html.includes('&amp;'));assert.ok(!result.html.includes('href="https://registry.test/reset?token=a&next="x"'));
});
async function listingWorld(){
 const db=await fx.openRealDatabase();await fx.seedUser(db,'editor','editor');await fx.seedUser(db,'seller');
 await db.exec("INSERT INTO horses(id,name_latin) VALUES(1,'Synthetic sale horse');INSERT INTO sales_listings(id,horse_id,seller_user_id,seller_contact_name,status,provenance) VALUES('r97-listing',1,'seller','Synthetic seller','active','user')");return db;
}
const listingInput={listingId:'r97-listing',expectedVersion:1,currentStatus:'active',nextStatus:'pending_sale',isStaff:true,sellerUserId:'seller',horseId:1,now:new Date(NOW)};
test('stale editor flag cannot authorize a demoted or inactive marketplace account',async()=>{
 const db=await listingWorld();await db.exec("UPDATE users SET role='user' WHERE id='editor'");
 await assert.rejects(()=>market.executeListingStatus(db,{user:{id:'editor'}},listingInput,null),e=>e.status===403);
 await db.exec("UPDATE users SET role='editor',is_active=0 WHERE id='editor'");
 await assert.rejects(()=>market.executeListingStatus(db,{user:{id:'editor'}},listingInput,null),e=>e.status===403);
});
test('current database editor can manage a listing without a horse mandate',async()=>{
 const db=await listingWorld();const result=await market.executeListingStatus(db,{user:{id:'editor'}},{...listingInput,isStaff:false},null);assert.equal(result.body.status,'pending_sale');
});
async function reminderWorld(){
 const db=await fx.openRealDatabase();await fx.seedUser(db,'buyer');
 await db.exec("INSERT INTO workspace_collections(id,name,owner_user_id) VALUES(1,'Private example workspace','buyer');INSERT INTO workspace_tasks(id,collection_id,title,category,due_date,due_timezone,created_by_user_id,occurrence_key) VALUES(1,1,'Private original reminder','other','2026-10-05','Asia/Tehran','buyer','reminder-example')");
 await reminders.enqueueDueTaskReminders(db,NOW);await db.exec("UPDATE notification_outbox SET next_attempt_at='2026-01-01'");return db;
}
async function dispatch(db,url,fetcher,time=NOW){
 const previous=globalThis.fetch;globalThis.fetch=fetcher;
 try{return await worker.drainNotificationOutbox(db,{EMAIL_API_URL:url,EMAIL_API_KEY:'fixture-secret',EMAIL_FROM:'registry@example.test'},{now:()=>new Date(time)});}finally{globalThis.fetch=previous;}
}
test('generic email uncertainty is not blindly retried',async()=>{
 const db=await reminderWorld();let requests=0;
 const timeout=async()=>{requests++;throw new DOMException('uncertain','TimeoutError');};
 await dispatch(db,'https://generic.example.test/send',timeout);
 await db.exec("UPDATE notification_outbox SET next_attempt_at='2026-01-01'");
 await dispatch(db,'https://generic.example.test/send',timeout,'2026-10-05T12:02:00.000Z');
 assert.equal(requests,1);assert.equal((await db.prepare('SELECT last_error FROM notification_outbox').first()).last_error,'idempotency_contract_unverified');
});
test('documented keyed retry cannot send changed reminder content after uncertainty',async()=>{
 const db=await reminderWorld();let requests=0;
 const timeout=async()=>{requests++;throw new DOMException('uncertain','TimeoutError');};
 await dispatch(db,'https://api.resend.com/emails',timeout);
 await db.exec("UPDATE workspace_tasks SET title='Changed private content';UPDATE notification_outbox SET next_attempt_at='2026-01-01'");
 await dispatch(db,'https://api.resend.com/emails',timeout,'2026-10-05T12:02:00.000Z');
 assert.equal(requests,1);assert.equal((await db.prepare('SELECT last_error FROM notification_outbox').first()).last_error,'dispatch_identity_changed');
});
test('unchanged Resend retry reuses exactly the same key and payload inside the window',async()=>{
 const db=await reminderWorld();const seen=[];
 await dispatch(db,'https://api.resend.com/emails',async(url,init)=>{seen.push(init);throw new DOMException('uncertain','TimeoutError');});
 await db.exec("UPDATE notification_outbox SET next_attempt_at='2026-01-01'");
 await dispatch(db,'https://api.resend.com/emails',async(url,init)=>{seen.push(init);return new Response(JSON.stringify({id:'fake-accepted'}),{status:200});},'2026-10-05T12:02:00.000Z');
 assert.equal(seen.length,2);assert.equal(seen[0].body,seen[1].body);assert.equal(seen[0].headers['idempotency-key'],seen[1].headers['idempotency-key']);
 assert.equal((await db.prepare('SELECT status FROM notification_outbox').first()).status,'provider_accepted');
});

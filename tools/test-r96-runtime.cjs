/* R96: production command execution against a fully migrated SQLite database.
 * Only outbound provider HTTP is substituted. Run: node --test tools/test-r96-runtime.cjs */
require('./lib/register-typescript.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fx = require('../tests/helpers/realDatabase.ts');
const privacy = require('../src/services/privacy.ts');
const refunds = require('../src/commerce/refunds.ts');
const worker = require('../src/notifications/worker.ts');
const NOW = '2026-10-04T12:00:00.000Z';
async function fixture() {
  const db = await fx.openRealDatabase();
  for (const [id,role] of [['buyer','user'],['provider','user'],['other','user'],['owner','admin']]) await fx.seedUser(db,id,role);
  await db.exec(`INSERT INTO people(id,name_latin) VALUES(1,'Synthetic provider');
    INSERT INTO directory_profiles(person_id,service_categories,publication_consent) VALUES(1,'["trainer"]',1);
    INSERT INTO user_person_links(user_id,person_id,status) VALUES('provider',1,'verified');`);
  return db;
}
async function lead(db, id=1, overrides={}) {
  const x={status:'new',note:'Private appointment details',share:1,created:'2024-01-01 00:00:00',updated:'2024-01-01 00:00:00',...overrides};
  await db.prepare(`INSERT INTO service_requests(id,requester_user_id,provider_person_id,category,province_code,city,note,share_contact,status,created_at,updated_at)
    VALUES(?,'buyer',1,'trainer','IR-23','Synthetic city',?,?,?,?,?)`).bind(id,x.note,x.share,x.status,x.created,x.updated).run();
}
async function paid(db,key) {
  if (!(await db.prepare('SELECT id FROM billing_prices LIMIT 1').first())) await fx.seedBillingPrices(db);
  const order=await fx.createOrder(db,{buyer:'buyer',key});
  const {attemptId}=await fx.reserveAttempt(db,order.id,'buyer');
  await fx.verifyOrder(db,order,attemptId,crypto.randomUUID(),NOW);
  return {order,attemptId};
}
const policy={kind:'full_unused',sku:'farm_workspace_monthly',granted_days:30,consumed_days:0,remaining_days:30,access_action:'cancel_full_period',history_note:'Test fixture policy'};
async function requested(db,p) {
  await db.batch(refunds.requestRefundStatements(db,{orderId:p.order.id,attemptId:p.attemptId,buyerUserId:'buyer',reason:'No longer needed',generation:1},policy));
  const r=await db.prepare('SELECT id FROM refund_requests WHERE payment_attempt_id=?').bind(p.attemptId).first();
  await db.batch(refunds.approveRefundStatements(db,{refundId:r.id,operatorUserId:'owner',note:'Evidence reviewed',partialPolicyEnabled:false}));
  return r.id;
}
async function confirm(db,id,actor='owner') {
  return db.batch(refunds.recordProviderRefundOutcomeStatements(db,{refundId:id,operatorUserId:actor,kind:'full_unused',result:{outcome:'confirmed',providerReference:`REF-${id}`.replace('REF-','8880')}}));
}

test('retention preserves a real digest of original bytes, not a placeholder',async()=>{
  const db=await fixture();await lead(db,1,{status:'closed'});
  await privacy.serviceRetentionSweep(db,NOW);
  const r=await db.prepare('SELECT note,note_digest,share_contact,city,province_code FROM service_requests WHERE id=1').first();
  assert.equal(r.note_digest,createHash('sha256').update('Private appointment details').digest('hex'));
  assert.equal(r.share_contact,0);assert.equal(r.city,null);assert.equal(r.province_code,null);
});
test('retention also minimizes already-redacted terminal leads',async()=>{
  const db=await fixture();await lead(db,1,{status:'closed'});
  await db.exec("UPDATE service_requests SET note='[redacted by requester]',note_redacted_at='2024-01-02',note_digest='retention:preexisting'");
  await privacy.serviceRetentionSweep(db,NOW);
  const r=await db.prepare('SELECT share_contact,city,note_digest FROM service_requests WHERE id=1').first();
  assert.equal(r.share_contact,0);assert.equal(r.city,null);assert.equal(r.note_digest,null);
});
test('empty retention runs do not write false/no-op audit events',async()=>{
  const db=await fixture();await privacy.serviceRetentionSweep(db,NOW);await privacy.serviceRetentionSweep(db,NOW);
  assert.equal(await fx.countRows(db,'audit_events'),0);
});
test('consent retries and unauthorized zero-row commands do not write audit events',async()=>{
  const db=await fixture();await lead(db);
  await db.batch(privacy.consentWithdrawalStatements(db,{requestId:1,requesterUserId:'other',operationId:crypto.randomUUID()}));
  assert.equal(await fx.countRows(db,'audit_events'),0);
  for(let i=0;i<2;i++) await db.batch(privacy.consentWithdrawalStatements(db,{requestId:1,requesterUserId:'buyer',operationId:crypto.randomUUID()}));
  assert.equal(await fx.countRows(db,'audit_events'),1);
});
test('a revoked provider mandate cannot commit a block or an audit event',async()=>{
  const db=await fixture();await lead(db);
  await db.exec("UPDATE user_person_links SET status='revoked'");
  await db.batch(privacy.providerBlockStatements(db,{providerPersonId:1,blockedRequesterUserId:'buyer',actorUserId:'provider',reason:'Unwanted lead',operationId:crypto.randomUUID()}));
  assert.equal(await fx.countRows(db,'service_provider_blocks'),0);assert.equal(await fx.countRows(db,'audit_events'),0);
});
test('provider block suppresses transition notices and is audit-idempotent',async()=>{
  const db=await fixture();await lead(db);
  await db.exec(`INSERT INTO notification_outbox(event_key,channel,purpose,essential,recipient_user_id,recipient_masked,payload_ref)
    VALUES('service-request:1:v2:provider','email','service_request_notice',0,'provider','provider','service_requests:1')`);
  for(let i=0;i<2;i++)await db.batch(privacy.providerBlockStatements(db,{providerPersonId:1,blockedRequesterUserId:'buyer',actorUserId:'provider',reason:'Unwanted lead',operationId:crypto.randomUUID()}));
  assert.equal((await db.prepare('SELECT status FROM notification_outbox').first()).status,'suppressed');
  assert.equal(await fx.countRows(db,'audit_events'),1);
});
test('refund confirmation must not cancel an unrelated paid renewal',async()=>{
  const db=await fixture();const first=await paid(db,'r96-first-order');await paid(db,'r96-second-order');
  const id=await requested(db,first);await confirm(db,id);
  assert.equal(await fx.countRows(db,'entitlements','active=1'),1,'other purchased credit must remain active or require a non-destructive review');
});
test('replaying a completed refund must not cancel a later purchase',async()=>{
  const db=await fixture();const first=await paid(db,'r96-refunded-order');const id=await requested(db,first);await confirm(db,id);
  await paid(db,'r96-later-order');const before=await db.prepare('SELECT id,expires_at FROM entitlements WHERE active=1').first();
  await confirm(db,id);const after=await db.prepare('SELECT id,expires_at FROM entitlements WHERE active=1').first();
  assert.deepEqual(after,before);assert.equal(await fx.countRows(db,'entitlement_events',"kind='refund_reversal'"),1);
});
test('ordinary accounts cannot confirm a refund through the command boundary',async()=>{
  const db=await fixture();const first=await paid(db,'r96-actor-order');const id=await requested(db,first);await confirm(db,id,'other');
  assert.equal((await db.prepare('SELECT status FROM refund_requests WHERE id=?').bind(id).first()).status,'approved');
  assert.equal(await fx.countRows(db,'entitlements','active=1'),1);
});
async function drainCase(mutation) {
  const db=await fixture();await lead(db,1,{created:NOW,updated:NOW});
  await db.exec(`INSERT INTO notification_outbox(event_key,channel,purpose,essential,recipient_user_id,recipient_masked,payload_ref,next_attempt_at)
    VALUES('service-request:1:created:provider','email','service_request_notice',0,'provider','provider','service_requests:1','2026-01-01')`);
  if(mutation)await db.exec(mutation);
  const original=globalThis.fetch;let sends=0;
  globalThis.fetch=async()=>{sends++;return new Response(JSON.stringify({id:'r96-provider-message'}),{status:200});};
  try {await worker.drainNotificationOutbox(db,{EMAIL_API_URL:'https://email.example.test/send',EMAIL_API_KEY:'fake',EMAIL_FROM:'registry@example.test'},{now:()=>new Date(NOW)});}
  finally {globalThis.fetch=original;}
  return {db,sends};
}
test('dispatch rechecks a revoked provider mandate before external IO',async()=>{
  const {sends}=await drainCase("UPDATE user_person_links SET status='revoked'");assert.equal(sends,0);
});
test('dispatch rechecks contact withdrawal even when suppression was missed',async()=>{
  const {sends}=await drainCase("UPDATE service_requests SET share_contact=0,consent_updated_at='2026-10-04'");assert.equal(sends,0);
});
test('an authorized published provider still receives a neutral notice',async()=>{
  const {db,sends}=await drainCase(null);assert.equal(sends,1);assert.equal((await db.prepare('SELECT status FROM notification_outbox').first()).status,'provider_accepted');
});

const {parseUtcTimestamp}=require('../src/shared/utcTimestamp.ts');
const {refundPolicyFromGrants}=require('../src/commerce/refundPolicy.ts');
const {CommandFlight,classifyCommandError}=require('../src/frontend-kit/domain/commandModel.ts');
const {PlatformClientError}=require('../src/frontend-kit/errors.ts');
const {retryAfterSecondsOf}=require('../src/frontend-kit/domain/resourceState.ts');
const {DomainResourceController}=require('../src/frontend-kit/domain/domainLoader.ts');
const {authorizeWorkspace}=require('../src/workspaces/access.ts');
const reconciliation=require('../src/commerce/reconciliation.ts');
const gateway=require('../src/commerce/payments/zarinpal.ts');
for(const invalid of ['2026-02-30','2025-02-29','2026-10-04T24:00:00','2026-10-04T12:60:00','yesterday','2026-13-01','2026-00-01','2026-10-00'])test(`UTC parser rejects ${invalid}`,()=>assert.equal(parseUtcTimestamp(invalid),null));
test('SQL and offset-less ISO date-times follow database UTC convention',()=>{
  assert.equal(parseUtcTimestamp('2026-10-04 12:00:00'),Date.parse(NOW));
  assert.equal(parseUtcTimestamp('2026-10-04T12:00:00'),Date.parse(NOW));
  assert.equal(parseUtcTimestamp('2026-10-04T15:30:00+03:30'),Date.parse(NOW));
  assert.notEqual(parseUtcTimestamp('2024-02-29'),null);
});
test('refund policy reads the original payment interval, not later renewals',()=>{
  const r=refundPolicyFromGrants([{sku:'farm',granted_days:30,activated_at:'2026-08-01',expires_at:'2026-08-31'}],NOW);
  assert.equal(r.kind,'partial_consumed');assert.equal(r.consumed_days,30);assert.equal(r.remaining_days,0);
});
test('future grant has no negative consumed-day estimate',()=>{
  const r=refundPolicyFromGrants([{sku:'farm',granted_days:30,activated_at:'2026-11-01',expires_at:'2026-12-01'}],NOW);
  assert.equal(r.consumed_days,0);assert.equal(r.remaining_days,30);
});
test('missing grant interval is an explicit unknown, not fabricated unused service',()=>{
  const r=refundPolicyFromGrants([{sku:'farm',granted_days:30,activated_at:null,expires_at:null}],NOW);
  assert.equal(r.kind,'partial_consumed');assert.equal(r.consumed_days,null);assert.equal(r.remaining_days,null);assert.equal(r.access_action,'none');
});
for(const status of [500,502,503,504])test(`HTTP ${status} cannot prove a write had no effect`,()=>assert.equal(classifyCommandError(new PlatformClientError(status,'upstream','Unknown')).phase,'failed'));
test('conflict classification keeps the current version',()=>assert.equal(classifyCommandError(new PlatformClientError(409,'stale','Reload',{current_version:9})).currentVersion,9));
test('negative retry hints are rejected in both numeric and string forms',()=>{assert.equal(retryAfterSecondsOf({retry_after_seconds:'-7'}),undefined);assert.equal(retryAfterSecondsOf({retry_after_seconds:-7}),undefined);assert.equal(retryAfterSecondsOf({retry_after_seconds:'1.2'}),2);});
test('same-render double submission invokes the executor once',async()=>{
  const flight=new CommandFlight();let release,calls=0;const seen=[];
  const first=flight.execute(()=>{calls++;return new Promise(resolve=>release=resolve);},s=>seen.push(s.phase));
  assert.equal(await flight.execute(async()=>{calls++;},()=>{}),false);assert.equal(calls,1);assert.equal(flight.busy,true);
  release({idempotent_replay:true});assert.equal(await first,true);assert.equal(flight.busy,false);assert.deepEqual(seen,['submitting','accepted']);
});
test('domain loader captures synchronous loader failures',()=>{
  const c=new DomainResourceController();c.load({domain:'private',identity:'account-A',load:()=>{throw new Error('Sync fail');}});
  assert.equal(c.getState().phase,'error');c.dispose();
});
test('a late response for one account cannot replace the current account',async()=>{
  const c=new DomainResourceController();let finishA;
  c.load({domain:'mine',identity:'A',load:()=>new Promise(resolve=>finishA=resolve)});
  c.load({domain:'mine',identity:'B',load:async()=>({private:'B'})});await new Promise(setImmediate);
  finishA({private:'A'});await new Promise(setImmediate);assert.equal(c.getState().data.private,'B');c.dispose();
});
test('same-key resource retry is explicitly reloading with old data',async()=>{
  const c=new DomainResourceController();let finish;
  c.load({domain:'mine',identity:'A',load:async()=>({n:1})});await new Promise(setImmediate);
  c.load({domain:'mine',identity:'A',load:()=>new Promise(resolve=>finish=resolve)});
  assert.equal(c.getState().phase,'reloading');assert.equal(c.getState().data.n,1);finish({n:2});await new Promise(setImmediate);c.dispose();
});
test('view-only workspace staff are projected as staff, not owner',async()=>{
  const db=await fixture();await db.exec("INSERT INTO workspace_collections(id,name,owner_user_id) VALUES(1,'Synthetic stable','buyer'); INSERT INTO workspace_staff_assignments(collection_id,user_id,actions,granted_by_user_id) VALUES(1,'provider','view','buyer')");
  assert.deepEqual(await authorizeWorkspace(db,{userId:'provider',role:'user'},1,'view'),{as:'staff',actions:['view']});
  await assert.rejects(()=>authorizeWorkspace(db,{userId:'provider',role:'admin'},1,'tasks_manage'),e=>e.status===404);
});
test('retention respects the batch bound and eventually drains without duplicate audits',async()=>{
  const db=await fixture();for(let n=1;n<=7;n++)await lead(db,n,{status:'closed'});
  assert.equal((await privacy.serviceRetentionSweep(db,NOW,{limit:3})).minimized_requests,3);
  assert.equal((await privacy.serviceRetentionSweep(db,NOW,{limit:3})).minimized_requests,3);
  assert.equal((await privacy.serviceRetentionSweep(db,NOW,{limit:3})).minimized_requests,1);
  assert.equal((await privacy.serviceRetentionSweep(db,NOW,{limit:3})).minimized_requests,0);
  assert.equal(await fx.countRows(db,'audit_events'),7);
});
test('retention compare-and-set refuses a note changed after selection',async()=>{
  const db=await fixture();await lead(db,1,{status:'closed'});const batch=db.batch.bind(db);let changed=false;
  const proxy=Object.create(db);proxy.batch=async stmts=>{if(!changed){changed=true;await db.exec("UPDATE service_requests SET note='New evidence',row_version=row_version+1 WHERE id=1");}return batch(stmts);};
  assert.equal((await privacy.serviceRetentionSweep(proxy,NOW)).minimized_requests,0);
  assert.equal(await fx.countRows(db,'audit_events'),0);assert.equal((await db.prepare('SELECT note FROM service_requests').first()).note,'New evidence');
});
test('manual redaction binds the exact note and row version to its digest',async()=>{
  const db=await fixture();await lead(db);const x={requestId:1,requesterUserId:'buyer',noteDigest:createHash('sha256').update('old').digest('hex'),operationId:crypto.randomUUID(),expectedNote:'old',expectedVersion:1};
  await db.batch(privacy.redactNoteStatements(db,x));assert.equal(await fx.countRows(db,'audit_events'),0);
  x.expectedNote='Private appointment details';x.noteDigest=createHash('sha256').update(x.expectedNote).digest('hex');x.operationId=crypto.randomUUID();
  await db.batch(privacy.redactNoteStatements(db,x));assert.equal(await fx.countRows(db,'audit_events'),1);assert.equal((await db.prepare('SELECT note_digest FROM service_requests').first()).note_digest,x.noteDigest);
});
test('future-created and future-response records do not improve provider metrics',()=>{
  const rows=[{requester_user_id:'A',status:'acknowledged',created_at:'2026-10-05',first_response_at:'2026-10-05'},
    {requester_user_id:'B',status:'acknowledged',created_at:'2026-10-03',first_response_at:'2026-10-05'}];
  const r=privacy.computeProviderResponseMetrics(rows,NOW);assert.equal(r.exclusions.outside_window,1);assert.equal(r.exclusions.never_acknowledged,1);assert.equal(r.response_time_hours,null);
});
test('provider inquiry uses inquiry.json and never the verifying endpoint',async()=>{
  const original=fetch;const calls=[];globalThis.fetch=async(url,init)=>{calls.push([String(url),JSON.parse(init.body)]);return new Response(JSON.stringify({data:{code:100,status:'PAID'},errors:[]}));};
  try {const r=await gateway.zarinpalProvider({merchantId:'synthetic-merchant'}).inquirePayment('A0000000000001');assert.equal(r.status,'PAID');assert.equal(r.providerReference,undefined);}
  finally{globalThis.fetch=original;}
  assert.equal(calls.length,1);assert.ok(calls[0][0].endsWith('/inquiry.json'));assert.deepEqual(Object.keys(calls[0][1]).sort(),['authority','merchant_id']);
});
for(const status of ['VERIFIED','PAID','IN_BANK','FAILED','REVERSED'])test(`documented inquiry status ${status} is an observation, not a verify receipt`,()=>{
  const r=gateway.parseZarinpalInquiry({data:{code:100,status},errors:[]});assert.equal(r.ok,true);assert.equal(r.status,status);assert.equal(r.alreadyVerified,undefined);
});
test('inquiry parser rejects conflicting errors, unknown statuses and HTTP errors',()=>{
  for(const [x,http] of [[{data:{code:100,status:'PAID'},errors:{code:-50}},200],[{data:{code:100,status:'MAGIC'}},200],[{data:{code:100,status:'PAID'}},500]])assert.equal(gateway.parseZarinpalInquiry(x,http).ok,false);
});
test('review-case resolution rechecks the current operator and is replay safe',async()=>{
  const db=await fixture();const p=await paid(db,'r96-review-order');
  await db.prepare("INSERT INTO billing_review_cases(id,payment_attempt_id,reason,details_json) VALUES(1,?,'stale_unverified','{}')").bind(p.attemptId).run();
  const pa=await db.prepare('SELECT * FROM payment_attempts WHERE id=?').bind(p.attemptId).first();
  const input={caseId:1,operatorUserId:'other',outcome:'operator_error_dismissed',resolutionNote:'Resolved against records',evidence:{attempt_id:p.attemptId,order_id:p.order.id,order_key:p.order.order_key,amount_minor:pa.amount_minor,currency:'IRR',authority:pa.authority,provider_reference:null}};
  const before=await fx.countRows(db,'payment_events');await db.batch(reconciliation.resolveReviewCaseStatements(db,input));assert.equal((await db.prepare('SELECT status FROM billing_review_cases').first()).status,'open');assert.equal(await fx.countRows(db,'payment_events'),before);
  input.operatorUserId='owner';await db.batch(reconciliation.resolveReviewCaseStatements(db,input));await db.batch(reconciliation.resolveReviewCaseStatements(db,input));assert.equal(await fx.countRows(db,'payment_events'),before+1);
});
test('not-paid observation cannot release a still-payable gateway session',async()=>{
  const db=await fixture();assert.throws(()=>reconciliation.resolveReviewCaseStatements(db,{caseId:1,operatorUserId:'owner',outcome:'provider_not_paid_confirmed',resolutionNote:'Observed unpaid only',evidence:{attempt_id:1,order_id:1,order_key:'test',amount_minor:10000,currency:'IRR',authority:null,provider_reference:null}}),e=>e.status===501&&e.code==='terminal_payment_proof_required');
});
test('unrelated ordinary account cannot append provider-inquiry evidence',async()=>{
  const db=await fixture();const p=await paid(db,'r96-inquiry-order');const before=await fx.countRows(db,'payment_events');
  await db.batch(reconciliation.providerInquiryStatements(db,{attemptId:p.attemptId,operatorUserId:'other',outcome:'verified'}));assert.equal(await fx.countRows(db,'payment_events'),before);
});
const moderation=require('../src/moderation/commands.ts');
test('standing cannot target an unrelated account and refuses stale cross-case decisions',async()=>{
  const db=await fixture();await lead(db);
  await db.exec("INSERT INTO moderation_cases(id,target_table,target_id,reporter_user_id,reason,status) VALUES(1,'service_requests','1','provider','spam','resolved_dismissed'),(2,'service_requests','1','other','spam','resolved_hidden')");
  const base={caseId:1,accountUserId:'other',standing:'restricted',expectedStanding:'normal',reason:'Reviewed synthetic case',actorUserId:'owner',operationId:crypto.randomUUID()};
  await db.batch(moderation.setStandingStatements(db,base));assert.equal(await fx.countRows(db,'service_abuse_standing'),0);assert.equal(await fx.countRows(db,'moderation_case_events'),0);
  base.accountUserId='buyer';base.operationId=crypto.randomUUID();await db.batch(moderation.setStandingStatements(db,base));assert.equal(await fx.countRows(db,'moderation_case_events'),1);
  base.caseId=2;base.standing='suspended';base.operationId=crypto.randomUUID();await db.batch(moderation.setStandingStatements(db,base));assert.equal((await db.prepare('SELECT standing FROM service_abuse_standing').first()).standing,'restricted');assert.equal(await fx.countRows(db,'moderation_case_events'),1);
  base.expectedStanding='restricted';base.operationId=crypto.randomUUID();await db.batch(moderation.setStandingStatements(db,base));assert.equal((await db.prepare('SELECT standing FROM service_abuse_standing').first()).standing,'suspended');assert.equal(await fx.countRows(db,'moderation_case_events'),2);
});
test('malformed staff action sets are denied, not projected as valid capabilities',async()=>{
  const db=await fixture();await db.exec("INSERT INTO workspace_collections(id,name,owner_user_id) VALUES(1,'Synthetic stable','buyer'); INSERT INTO workspace_staff_assignments(collection_id,user_id,actions,granted_by_user_id) VALUES(1,'provider','view,unknown','buyer')");
  await assert.rejects(()=>authorizeWorkspace(db,{userId:'provider',role:'user'},1,'view'),e=>e.status===404);
});

test('requester blocking is transactional, suppresses notices and audits once',async()=>{
  const db=await fixture();await lead(db);
  await db.exec("INSERT INTO notification_outbox(event_key,channel,purpose,essential,recipient_user_id,recipient_masked,payload_ref) VALUES('service-request:1:v2:provider','email','service_request_notice',0,'provider','provider','service_requests:1')");
  const command={requestId:1,requesterUserId:'buyer',providerPersonId:1};
  await db.batch(privacy.requesterBlockStatements(db,command));await db.batch(privacy.requesterBlockStatements(db,command));
  assert.equal(await fx.countRows(db,'service_request_blocks'),1);assert.equal(await fx.countRows(db,'audit_events'),1);
  assert.equal((await db.prepare('SELECT status FROM notification_outbox').first()).status,'suppressed');
});
test('requester blocking refuses unrelated and inactive actors without audit',async()=>{
  const db=await fixture();await lead(db);
  await db.batch(privacy.requesterBlockStatements(db,{requestId:1,requesterUserId:'other',providerPersonId:1}));
  await db.exec("UPDATE users SET is_active=0 WHERE id='buyer'");
  await db.batch(privacy.requesterBlockStatements(db,{requestId:1,requesterUserId:'buyer',providerPersonId:1}));
  assert.equal(await fx.countRows(db,'service_request_blocks'),0);assert.equal(await fx.countRows(db,'audit_events'),0);
});

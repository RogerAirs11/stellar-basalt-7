/* R97 independent regressions. Actual production functions and migrated SQLite;
 * only external email HTTP is substituted. No SQL-recording mocks. */
require('./lib/register-typescript.cjs');
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fx = require('../tests/helpers/realDatabase.ts');
const alloc = require('../src/commerce/refundAllocation.ts');
const refunds = require('../src/commerce/refunds.ts');
const workspace = require('../src/workspaces/mutationCommands.ts');
const tasks = require('../src/workspaces/commands.ts');
const reminders = require('../src/workspaces/reminders.ts');
const worker = require('../src/notifications/worker.ts');
const {drainOutbox} = require('../src/notifications/outbox.ts');
const NOW = '2026-10-05T12:00:00.000Z';
async function fixture(){
  const db = await fx.openRealDatabase();
  for (const [id,role] of [['owner','admin'],['buyer','user'],['other','user'],['staff','user']]) await fx.seedUser(db,id,role);
  return db;
}
async function paid(db,key='r97-paid',lines){
  if (!await db.prepare('SELECT id FROM billing_prices LIMIT 1').first()) await fx.seedBillingPrices(db);
  const order = await fx.createOrder(db,{buyer:'buyer',key,lines});
  const {attemptId} = await fx.reserveAttempt(db,order.id,'buyer');
  await fx.verifyOrder(db,order,attemptId,crypto.randomUUID(),'2026-10-01T00:00:00.000Z');
  return {order,attemptId};
}
const policy={kind:'partial_consumed',sku:'farm_workspace_monthly',granted_days:30,consumed_days:4,remaining_days:26,access_action:'none',history_note:'R97 synthetic fixture'};
async function requestRefund(db,p){
  await db.batch(refunds.requestRefundStatements(db,{orderId:p.order.id,attemptId:p.attemptId,buyerUserId:'buyer',reason:'Synthetic cancellation request',generation:1},policy));
  return (await db.prepare('SELECT id FROM refund_requests WHERE payment_attempt_id=?').bind(p.attemptId).first()).id;
}
async function proposed(db,id){
  return alloc.proposeRefundAllocation(db,{refundId:id,operatorUserId:'owner',nowIso:NOW});
}
async function approveAllocation(db,id,actor='owner'){
  const a=await db.prepare("SELECT * FROM refund_allocations WHERE refund_request_id=? AND status='proposed'").bind(id).first();
  return db.batch(alloc.approveRefundAllocationStatements(db,{refundId:id,operatorUserId:actor,amountMinor:a.proposed_amount_minor,currency:a.currency,note:'Exact amount reviewed',expectedProposalOperationId:a.proposal_operation_id}));
}
async function collection(db){
  await db.exec("INSERT INTO workspace_collections(id,name,owner_user_id) VALUES(1,'Private workspace','buyer')");
}
async function task(db,overrides={}){
  const x={id:1,assigned:'staff',due:'2026-10-05',tz:'America/Los_Angeles',title:'Private horse appointment',...overrides};
  await db.prepare(`INSERT INTO workspace_tasks(id,collection_id,title,category,due_date,due_timezone,created_by_user_id,assigned_to_user_id,occurrence_key,recurrence,recurrence_interval_days)
    VALUES(?,1,?,'other',?,?,'buyer',?,?,'custom_days',7)`).bind(x.id,x.title,x.due,x.tz,x.assigned,`r97-task-${x.id}`).run();
}
async function staff(db,status='active'){
  await db.prepare("INSERT INTO workspace_staff_assignments(collection_id,user_id,actions,granted_by_user_id,status) VALUES(1,'staff','view,tasks_manage','buyer',?)").bind(status).run();
}
async function sendReminder(db){
  await db.exec("UPDATE notification_outbox SET next_attempt_at='2026-01-01'");
  const original=globalThis.fetch;const sent=[];
  globalThis.fetch=async(_url,init)=>{sent.push(JSON.parse(init.body));return new Response(JSON.stringify({id:'r97-message'}),{status:200});};
  try {await worker.drainNotificationOutbox(db,{EMAIL_API_URL:'https://email.example.test/send',EMAIL_API_KEY:'fake',EMAIL_FROM:'registry@example.test'},{now:()=>new Date(NOW)});} finally{globalThis.fetch=original;}
  return sent;
}

test('unauthorized allocation proposal changes no allocation or audit state',async()=>{
  const db=await fixture();const id=await requestRefund(db,await paid(db));
  try{await alloc.proposeRefundAllocation(db,{refundId:id,operatorUserId:'other',nowIso:NOW});}catch(e){assert.ok(e.status===403||e.status===409);}
  assert.equal(await fx.countRows(db,'refund_allocations'),0);
});
test('unauthorized allocation approval cannot approve the secondary ledger row',async()=>{
  const db=await fixture();const id=await requestRefund(db,await paid(db));await proposed(db,id);await approveAllocation(db,id,'other');
  assert.equal((await db.prepare('SELECT status FROM refund_allocations').first()).status,'proposed');
});
test('rejected refund cannot acquire approved allocation through a failed primary CAS',async()=>{
  const db=await fixture();const id=await requestRefund(db,await paid(db));await proposed(db,id);
  await db.exec("UPDATE refund_requests SET status='rejected'");await approveAllocation(db,id);
  assert.equal((await db.prepare('SELECT status FROM refund_allocations').first()).status,'proposed');
});
test('approved allocation cannot be silently overwritten by reproposal',async()=>{
  const db=await fixture();const id=await requestRefund(db,await paid(db));await proposed(db,id);await approveAllocation(db,id);
  const before=await db.prepare('SELECT * FROM refund_allocations').first();
  try{await proposed(db,id);}catch(e){assert.equal(e.status,409);}
  assert.deepEqual(await db.prepare('SELECT * FROM refund_allocations').first(),before);
});
test('allocation refuses negative fee policy rather than proposing more than the charge',()=>{
  assert.throws(()=>alloc.computeRefundAllocation({amount_minor:1000,currency:'IRR'},[{grant_event_id:1,sku:'farm',granted_days:30,activated_at:'2026-11-01',expires_at:'2026-12-01'}],{...alloc.CONSERVATIVE_ALLOCATION_POLICY_V1,fee_minor:-1},NOW));
});
test('heterogeneous SKU time is not interchangeable without line-price allocation',()=>{
  const result=alloc.computeRefundAllocation({amount_minor:1000,currency:'IRR'},[
    {grant_event_id:1,sku:'expensive',granted_days:30,activated_at:'2026-09-01',expires_at:'2026-10-01'},
    {grant_event_id:2,sku:'cheap',granted_days:30,activated_at:'2026-11-01',expires_at:'2026-12-01'},
  ],alloc.CONSERVATIVE_ALLOCATION_POLICY_V1,NOW);
  assert.equal(result.status,'manual_review_required');
});
test('partial refund records a partially_refunded order, not a full refund',async()=>{
  const db=await fixture();const p=await paid(db);const id=await requestRefund(db,p);await proposed(db,id);await approveAllocation(db,id);
  await db.batch(refunds.approveRefundStatements(db,{refundId:id,operatorUserId:'owner',note:'Reviewed money decision'}));
  await db.batch(refunds.recordProviderRefundOutcomeStatements(db,{refundId:id,operatorUserId:'owner',kind:'partial_consumed',result:{outcome:'confirmed',providerReference:'123456'}}));
  assert.equal((await db.prepare('SELECT status FROM orders WHERE id=?').bind(p.order.id).first()).status,'partially_refunded');
});

test('unauthorized workspace archive does not proceed after a zero-row lock',async()=>{
  const db=await fixture();await collection(db);
  await db.batch(workspace.archiveWorkspaceStatements(db,{collectionId:1,actorUserId:'other',operationId:crypto.randomUUID()}));
  assert.equal((await db.prepare('SELECT deleted_at FROM workspace_collections WHERE id=1').first()).deleted_at,null);
  assert.equal(await fx.countRows(db,'audit_events'),0);
});
test('unauthorized staff revocation does not proceed after a zero-row lock',async()=>{
  const db=await fixture();await collection(db);await staff(db);
  await db.batch(workspace.revokeStaffStatements(db,{collectionId:1,userId:'staff',actorUserId:'other',operationId:crypto.randomUUID()}));
  assert.equal((await db.prepare('SELECT status FROM workspace_staff_assignments').first()).status,'active');
  assert.equal(await fx.countRows(db,'audit_events'),0);
});
test('revoked staff reactivation counts as a new seat at capacity',async()=>{
  const db=await fixture();await collection(db);await staff(db,'revoked');
  for(let i=0;i<workspace.MAX_ACTIVE_STAFF_PER_COLLECTION;i++){
    await fx.seedUser(db,`seat-${i}`);await db.prepare("INSERT INTO workspace_staff_assignments(collection_id,user_id,actions,granted_by_user_id) VALUES(1,?,'view','buyer')").bind(`seat-${i}`).run();
  }
  await db.batch(workspace.assignStaffStatements(db,{collectionId:1,userId:'staff',actions:'view',actorUserId:'buyer',operationId:crypto.randomUUID()}));
  assert.equal(await fx.countRows(db,'workspace_staff_assignments',"status='active'"),workspace.MAX_ACTIVE_STAFF_PER_COLLECTION);
});
test('recurrence preserves the explicitly selected timezone',async()=>{
  const db=await fixture();await collection(db);await task(db);
  await db.batch(tasks.completeTaskStatements(db,{collectionId:1,taskId:1,actorUserId:'buyer',expectedVersion:1,operationId:crypto.randomUUID(),nextDueDate:'2026-10-12'}));
  assert.equal((await db.prepare('SELECT due_timezone FROM workspace_tasks WHERE parent_task_id=1').first()).due_timezone,'America/Los_Angeles');
});
test('task assignment cannot target an unrelated active account',async()=>{
  const db=await fixture();await collection(db);
  await db.batch(workspace.createTaskStatements(db,{collectionId:1,horseId:null,title:'Private content',category:'other',dueDate:'2026-10-05',recurrence:'none',recurrenceIntervalDays:null,actorUserId:'buyer',assignedToUserId:'other',occurrenceKey:'new-task',operationId:crypto.randomUUID()}));
  assert.equal(await fx.countRows(db,'workspace_tasks'),0);
});
test('inactive workspace owner cannot mutate through command boundary',async()=>{
  const db=await fixture();await collection(db);await db.exec("UPDATE users SET is_active=0 WHERE id='buyer'");
  await db.batch(workspace.archiveWorkspaceStatements(db,{collectionId:1,actorUserId:'buyer',operationId:crypto.randomUUID()}));
  assert.equal((await db.prepare('SELECT deleted_at FROM workspace_collections').first()).deleted_at,null);
});
test('reminder scheduler reaches due tasks beyond fifty future tasks',async()=>{
  const db=await fixture();await collection(db);
  for(let i=1;i<=50;i++)await task(db,{id:i,assigned:'buyer',due:'2099-01-01'});
  await task(db,{id:51,assigned:'buyer'});await reminders.enqueueDueTaskReminders(db,NOW);
  assert.equal(await fx.countRows(db,'notification_outbox'),1);
});
test('reminder scheduler progresses beyond already enqueued open tasks',async()=>{
  const db=await fixture();await collection(db);
  for(let i=1;i<=51;i++)await task(db,{id:i,assigned:'buyer'});
  await reminders.enqueueDueTaskReminders(db,NOW);await reminders.enqueueDueTaskReminders(db,NOW);
  assert.equal(await fx.countRows(db,'notification_outbox'),51);
});
test('revoked workspace staff receives no queued reminder content',async()=>{
  const db=await fixture();await collection(db);await staff(db);await task(db);await reminders.enqueueDueTaskReminders(db,NOW);
  await db.exec("UPDATE workspace_staff_assignments SET status='revoked'");
  assert.equal((await sendReminder(db)).length,0);
});
test('reassignment cannot redirect a queued reminder into another account preferences',async()=>{
  const db=await fixture();await collection(db);await staff(db);await task(db);await reminders.enqueueDueTaskReminders(db,NOW);
  await db.exec("UPDATE workspace_tasks SET assigned_to_user_id='buyer'");
  assert.equal((await sendReminder(db)).length,0);
});
test('future rescheduled task cannot use the old due-event to notify early',async()=>{
  const db=await fixture();await collection(db);await staff(db);await task(db);await reminders.enqueueDueTaskReminders(db,NOW);
  await db.exec("UPDATE workspace_tasks SET due_date='2099-01-01'");
  assert.equal((await sendReminder(db)).length,0);
});
test('authorized current assignee still receives a reminder',async()=>{
  const db=await fixture();await collection(db);await staff(db);await task(db);await reminders.enqueueDueTaskReminders(db,NOW);
  assert.equal((await sendReminder(db)).length,1);
});
test('monthly deferral does not spend an idempotency window before any provider send',async()=>{
  const db=await fixture();
  await db.exec(`INSERT INTO notification_preferences(user_id,monthly_send_limit) VALUES('buyer',0);
    INSERT INTO notification_outbox(event_key,channel,purpose,essential,recipient_user_id,recipient_masked,payload_ref,next_attempt_at)
    VALUES('r97:deferred:1','email','workspace_task_due',0,'buyer','b***@example.test','workspace_tasks:1','2026-10-01')`);
  let sends=0;await drainOutbox(db,{now:()=>new Date(NOW),send:async()=>{sends++;return {accepted:true};}});
  const row=await db.prepare('SELECT first_attempt_at FROM notification_outbox').first();
  assert.equal(sends,0);assert.equal(row.first_attempt_at,null);
});

async function confirmedPartial(db,key='r97-review') {
  const p=await paid(db,key);const id=await requestRefund(db,p);await proposed(db,id);await approveAllocation(db,id);
  await db.batch(refunds.approveRefundStatements(db,{refundId:id,operatorUserId:'owner',note:'Allocation reviewed'}));
  await db.batch(refunds.recordProviderRefundOutcomeStatements(db,{refundId:id,operatorUserId:'owner',kind:'partial_consumed',result:{outcome:'confirmed',providerReference:'review-fixture'}}));
  const grant=await db.prepare("SELECT id FROM entitlement_events WHERE payment_attempt_id=? AND kind IN ('grant','renewal')").bind(p.attemptId).first();
  return {...p,id,grantId:grant.id};
}
function reviewInput(id,grantId,decision='retain') {return {refundId:id,operatorUserId:'owner',decisions:[{grantEventId:grantId,decision,note:'Explicit operator disposition'}],resolutionNote:'Each refunded grant reviewed'};}
test('access review cannot cancel a service before the refund is confirmed',async()=>{
  const db=await fixture();const p=await paid(db);const id=await requestRefund(db,p);
  await db.prepare("INSERT INTO refund_access_reviews(refund_request_id,reason) VALUES(?,'manual')").bind(id).run();
  const ge=await db.prepare("SELECT id FROM entitlement_events WHERE kind='grant'").first();
  await db.batch(alloc.resolveRefundAccessReviewStatements(db,reviewInput(id,ge.id,'cancel_interval')));
  assert.equal(await fx.countRows(db,'entitlements','active=0'),0);assert.equal(await fx.countRows(db,'refund_access_review_decisions'),0);
});
test('review rejects the whole batch when one grant belongs to another payment',async()=>{
  const db=await fixture();const x=await confirmedPartial(db);const other=await paid(db,'other-period');
  const foreign=await db.prepare("SELECT id FROM entitlement_events WHERE payment_attempt_id=? AND kind IN ('grant','renewal')").bind(other.attemptId).first();
  const input=reviewInput(x.id,x.grantId);input.decisions.push({grantEventId:foreign.id,decision:'retain',note:'Foreign grant must refuse whole command'});
  await db.batch(alloc.resolveRefundAccessReviewStatements(db,input));
  assert.equal(await fx.countRows(db,'refund_access_review_decisions'),0);assert.equal((await db.prepare('SELECT status FROM refund_access_reviews').first()).status,'open');
});
test('credit_review remains open and reports review_required',async()=>{
  const db=await fixture();const x=await confirmedPartial(db);
  await db.batch(alloc.resolveRefundAccessReviewStatements(db,reviewInput(x.id,x.grantId,'credit_review')));
  assert.equal((await db.prepare('SELECT status FROM refund_access_reviews').first()).status,'open');
  assert.equal((await db.prepare('SELECT access_reconciliation_status FROM refund_requests').first()).access_reconciliation_status,'review_required');
});
test('retain resolves confirmed complete grant set and reconciles request status',async()=>{
  const db=await fixture();const x=await confirmedPartial(db);
  await db.batch(alloc.resolveRefundAccessReviewStatements(db,reviewInput(x.id,x.grantId)));
  assert.equal((await db.prepare('SELECT status FROM refund_access_reviews').first()).status,'resolved');
  assert.equal((await db.prepare('SELECT access_reconciliation_status FROM refund_requests').first()).access_reconciliation_status,'applied');
  assert.equal(await fx.countRows(db,'entitlements','active=1'),1);
});
test('exact confirmed interval cancellation is operation-bound and repeat safe',async()=>{
  const db=await fixture();const x=await confirmedPartial(db);const input=reviewInput(x.id,x.grantId,'cancel_interval');
  await db.batch(alloc.resolveRefundAccessReviewStatements(db,input));await db.batch(alloc.resolveRefundAccessReviewStatements(db,input));
  assert.equal(await fx.countRows(db,'entitlements','active=0'),1);assert.equal(await fx.countRows(db,'entitlement_events',"kind='refund_reversal'"),1);
  assert.equal(await fx.countRows(db,'refund_access_review_decisions'),1);
});
test('inexact combined interval cannot be marked cancelled or review resolved',async()=>{
  const db=await fixture();const x=await confirmedPartial(db);await paid(db,'later-renewal');
  await db.batch(alloc.resolveRefundAccessReviewStatements(db,reviewInput(x.id,x.grantId,'cancel_interval')));
  assert.equal(await fx.countRows(db,'entitlements','active=1'),1);
  assert.equal(await fx.countRows(db,'refund_access_review_decisions'),0);
  assert.equal((await db.prepare('SELECT status FROM refund_access_reviews').first()).status,'open');
});
test('allocation approval is bound to proposal identity, not merely repeated amount',async()=>{
  const db=await fixture();const id=await requestRefund(db,await paid(db));await proposed(db,id);
  const old=await db.prepare('SELECT * FROM refund_allocations').first();await proposed(db,id);
  await db.batch(alloc.approveRefundAllocationStatements(db,{refundId:id,operatorUserId:'owner',amountMinor:old.proposed_amount_minor,currency:'IRR',note:'Stale proposal must fail',expectedProposalOperationId:old.proposal_operation_id}));
  assert.equal((await db.prepare('SELECT status FROM refund_allocations').first()).status,'proposed');
  assert.equal(await fx.countRows(db,'refund_events',"to_status='allocation_proposed'"),2);
});
test('heterogeneous SKU refund uses immutable line money, not pooled days',()=>{
  const x=alloc.computeRefundAllocation({amount_minor:1000,currency:'IRR'},[
    {grant_event_id:1,sku:'expensive',granted_days:30,activated_at:'2026-09-01',expires_at:'2026-10-01',paid_amount_minor:900},
    {grant_event_id:2,sku:'cheap',granted_days:30,activated_at:'2026-11-01',expires_at:'2026-12-01',paid_amount_minor:100},
  ],alloc.CONSERVATIVE_ALLOCATION_POLICY_V1,NOW);
  assert.equal(x.status,'computed');assert.equal(x.proposed_amount_minor,100);
});
const market=require('../src/marketplace/commands.ts');const dossiers=require('../src/dossiers/commands.ts');
async function horse(db){await db.exec("INSERT INTO horses(id,name_latin) VALUES(1,'Synthetic review horse')");}
async function grant(db,from='2020-01-01') {await db.prepare("INSERT INTO horse_access_grants(id,horse_id,grantee_user_id,relationship,actions,valid_from) VALUES('mandate',1,'buyer','seller','create_listing',?)").bind(from).run();}
function dossierInput(actor='buyer',role='user'){return {operationId:crypto.randomUUID(),actorUserId:actor,actorRole:role,horseId:1,version:1,snapshotJson:'{}',sectionsMetaJson:'{}',issuedDigest:'synthetic-test-digest'};}
test('future horse mandate is denied by the actual shared SQL predicate',async()=>{
  const db=await fixture();await horse(db);await grant(db,'2099-01-01');
  const pred=market.buildActiveGrantPredicate('h.id','create_listing',{userId:'buyer'},NOW);
  assert.equal((await db.prepare(`SELECT COUNT(*) n FROM horses h WHERE ${pred.sql}`).bind(...pred.binds).first()).n,0);
});
test('active mandate remains usable through the shared write predicate',async()=>{
  const db=await fixture();await horse(db);await grant(db);
  const pred=market.buildActiveGrantPredicate('h.id','create_listing',{userId:'buyer'},NOW);
  assert.equal((await db.prepare(`SELECT COUNT(*) n FROM horses h WHERE ${pred.sql}`).bind(...pred.binds).first()).n,1);
});
test('dossier creation rechecks current editorial role rather than stale role argument',async()=>{
  const db=await fixture();await horse(db);
  await db.batch(dossiers.createDossierStatements(db,dossierInput('other','admin')));
  assert.equal(await fx.countRows(db,'dossier_snapshots'),0);assert.equal(await fx.countRows(db,'audit_events'),0);
});
test('inactive editorial issuer cannot create a dossier',async()=>{
  const db=await fixture();await horse(db);await db.exec("UPDATE users SET is_active=0 WHERE id='owner'");
  await db.batch(dossiers.createDossierStatements(db,dossierInput('owner','admin')));
  assert.equal(await fx.countRows(db,'dossier_snapshots'),0);
});
test('future mandate cannot issue a public dossier',async()=>{
  const db=await fixture();await horse(db);await grant(db,'2099-01-01');
  await db.batch(dossiers.createDossierStatements(db,dossierInput()));assert.equal(await fx.countRows(db,'dossier_snapshots'),0);
});
test('demoted editorial issuer cannot mint a fresh share link',async()=>{
  const db=await fixture();await horse(db);await db.batch(dossiers.createDossierStatements(db,dossierInput('owner','admin')));
  const d=await db.prepare('SELECT id FROM dossier_snapshots').first();await db.exec("UPDATE users SET role='user' WHERE id='owner'");
  await db.batch(dossiers.createDossierLinkStatements(db,{operationId:crypto.randomUUID(),actorUserId:'owner',actorRole:'admin',dossierId:d.id,tokenHash:'synthetic-token',expiresAt:'2099-01-01',recipientUserId:null}));
  assert.equal(await fx.countRows(db,'dossier_share_links'),0);
});

test('authorized staff revoke is live, audited once and repeat safe',async()=>{
  const db=await fixture();await collection(db);await staff(db);
  for(let i=0;i<2;i++)await db.batch(workspace.revokeStaffStatements(db,{collectionId:1,userId:'staff',actorUserId:'buyer',operationId:crypto.randomUUID()}));
  const s=await db.prepare('SELECT status,revoked_by_user_id FROM workspace_staff_assignments').first();
  assert.equal(s.status,'revoked');assert.equal(s.revoked_by_user_id,'buyer');assert.equal(await fx.countRows(db,'audit_events'),1);
});
const workspaceDomain=require('../src/workspaces/domain.ts');const taskIdentity=require('../src/workspaces/taskIdentity.ts');
test('dashboard buckets use each task timezone across local midnight',()=>{
  const list=[{id:1,due_date:'2026-10-05',due_timezone:'Asia/Tehran',status:'open'},{id:2,due_date:'2026-10-05',due_timezone:'America/Los_Angeles',status:'open'}];
  const b=workspaceDomain.bucketTasksInZones(list,'2026-10-05T22:00:00.000Z');
  assert.deepEqual(b.overdue.map(x=>x.id),[1]);assert.deepEqual(b.dueSoon.map(x=>x.id),[2]);
});
test('invalid legacy timezone/date enters repair bucket rather than breaking dashboard',()=>{
  const b=workspaceDomain.bucketTasksInZones([{due_date:'2026-02-30',status:'open'},{due_date:'2026-10-05',due_timezone:'Mars/Central',status:'open'}],NOW);
  assert.equal(b.invalid.length,2);assert.equal(b.overdue.length+b.dueSoon.length+b.later.length,0);
});
test('initial task identity distinguishes timezone, assignee and recurrence',async()=>{
  const base={collectionId:1,actorUserId:'buyer',horseId:null,title:'Reminder',category:'other',dueDate:'2026-10-05',dueTimezone:'Asia/Tehran',recurrence:'none',recurrenceIntervalDays:null,assignedToUserId:null};
  const first=await taskIdentity.initialTaskKey(base);assert.equal(await taskIdentity.initialTaskKey({...base}),first);
  for(const change of [{dueTimezone:'America/Los_Angeles'},{assignedToUserId:'staff'},{recurrence:'custom_days',recurrenceIntervalDays:7},{actorUserId:'staff'}])assert.notEqual(await taskIdentity.initialTaskKey({...base,...change}),first);
});

test('authorized archive hides the workspace without deleting a canonical horse',async()=>{
  const db=await fixture();await collection(db);
  await db.exec("INSERT INTO horses(id,name_latin) VALUES(901,'Synthetic preserved horse')");
  await db.batch(workspace.archiveWorkspaceStatements(db,{collectionId:1,actorUserId:'buyer',operationId:crypto.randomUUID()}));
  assert.ok((await db.prepare('SELECT deleted_at FROM workspace_collections WHERE id=1').first()).deleted_at);
  assert.equal(await fx.countRows(db,'horses','id=901'),1);
  assert.equal(await fx.countRows(db,'audit_events'),1);
});

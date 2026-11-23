/* Actual production helpers + actual SQLite, not a SQL-recording mock.
 * Run: node --test tools/test-r95-runtime.cjs
 * The real installed TypeScript compiler is required (local or global). */
require('./lib/register-typescript.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {openLocalSqlite}=require('../src/db/localSqlite.ts');
const commands=require('../src/commerce/paymentCommands.ts');
const {sqliteSqlToPostgres}=require('../src/db/sqliteSqlToPostgres.ts');
const domain=require('../src/workspaces/domain.ts');
const migrations=fs.readdirSync(path.join(__dirname,'../migrations')).filter(f=>/^\d+.*\.sql$/.test(f)).sort();
async function fixture(){
  const db=openLocalSqlite(':memory:');
  for(const f of migrations)await db.exec(fs.readFileSync(path.join(__dirname,'../migrations',f),'utf8'));
  await db.exec(`INSERT INTO users(id,email,display_name,password_hash,role) VALUES('buyer','b@example.test','Buyer','not-a-real-hash','user'),('other','o@example.test','Other','not-a-real-hash','user');
    INSERT INTO billing_prices(id,sku,version,name_en,name_fa,price_minor,period_days,created_by_user_id) VALUES(1,'farm_workspace_monthly',1,'Farm','Farm',19000000,30,'buyer'),(2,'provider_pro_monthly',1,'Provider','Provider',4900000,30,'buyer');`);
  return db;
}
const line=(id=1,qty=1)=>({sku:id===1?'farm_workspace_monthly':'provider_pro_monthly',price_id:id,version:1,title_en:'Plan',title_fa:'Plan',unit_minor:id===1?19000000:4900000,quantity:qty,line_total_minor:(id===1?19000000:4900000)*qty,period_days:30});
async function order(db,{key='order-key-0001',lines=[line()],org=null,buyer='buyer',op=crypto.randomUUID()}={}){
  const total=lines.reduce((s,l)=>s+l.line_total_minor,0),digest=await commands.orderIntentDigest(lines,org);
  await db.batch(commands.atomicOrderStatements(db,{operationId:op,orderKey:key,buyerUserId:buyer,organizationId:org,digest,totalMinor:total,lines}));
  return db.prepare('SELECT * FROM orders WHERE order_key=? AND buyer_user_id=?').bind(key,buyer).first();
}
async function reserve(db,o,key=crypto.randomUUID(),provider='zarinpal'){
  const results=await db.batch(commands.reservePaymentStatements(db,{orderId:o.id,buyerUserId:o.buyer_user_id,requestKey:key,provider}));
  const p=await db.prepare('SELECT * FROM payment_attempts WHERE request_key=?').bind(key).first();
  if(p)await db.batch(commands.attachAuthorityStatements(db,{requestKey:key,authority:`auth-${key}`,provider}));
  return {attempt:p,results,key};
}
async function verify(db,o,p,{op=crypto.randomUUID(),now='2026-10-03T00:00:00.000Z',lines=JSON.parse(o.price_snapshot_json)}={}){
  return db.batch(commands.verifiedOrderStatements(db,{operationId:op,attemptId:p.id,orderId:o.id,buyerUserId:o.buyer_user_id,organizationId:o.payer_organization_id,providerReference:'ref-'+p.id,nowIso:now,totalMinor:o.total_minor,lines}));
}
async function count(db,table){return Number((await db.prepare(`SELECT COUNT(*) n FROM ${table}`).first()).n)}

test('all supplied migrations apply with foreign keys enabled',async()=>{
  const db=await fixture(); assert.equal((await db.prepare('PRAGMA integrity_check').first()).integrity_check,'ok');
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
  await assert.rejects(db.prepare("INSERT INTO payment_events(payment_attempt_id,actor,to_state) VALUES(0,'system','created')").run(),/FOREIGN KEY/);
});
test('atomic order saves frozen periods and every line',async()=>{
  const db=await fixture(),o=await order(db,{lines:[line(1,2),line(2)]});
  assert.equal(o.total_minor,42900000); assert.equal(await count(db,'order_lines'),2);
  assert.deepEqual(JSON.parse(o.price_snapshot_json).map(l=>l.period_days),[30,30]);
});
test('order retry creates no duplicate lines or audit event',async()=>{
  const db=await fixture(); await order(db);await order(db);
  assert.equal(await count(db,'orders'),1);assert.equal(await count(db,'order_lines'),1);assert.equal(await count(db,'audit_events'),1);
});
test('failed batch leaves no order header or lines',async()=>{
  const db=await fixture(),lines=[line()];
  const statements=commands.atomicOrderStatements(db,{operationId:'fail-op',orderKey:'failing-order',buyerUserId:'buyer',organizationId:null,digest:'digest',totalMinor:19000000,lines});
  statements.push(db.prepare("INSERT INTO payment_events(payment_attempt_id,actor,to_state) VALUES(0,'system','created')"));
  await assert.rejects(db.batch(statements)); assert.equal(await count(db,'orders'),0);assert.equal(await count(db,'order_lines'),0);
});
test('organization without current membership cannot create payable order',async()=>{
  const db=await fixture(); const o=await order(db,{org:777});assert.equal(o,null);assert.equal(await count(db,'order_lines'),0);
});
test('order intent combines duplicate skus and fixes item order',async()=>{
  const a=await commands.orderIntentDigest([{sku:'farm',quantity:1},{sku:'farm',quantity:2},{sku:'provider',quantity:1}],null);
  const b=await commands.orderIntentDigest([{sku:'provider',quantity:1},{sku:'farm',quantity:3}],null);
  assert.equal(a,b); assert.notEqual(a,await commands.orderIntentDigest([{sku:'farm',quantity:3},{sku:'provider',quantity:1}],9));
});
test('combined quantity and corrupted totals are rejected',()=>{
  assert.throws(()=>commands.normalizeOrderIntent([{sku:'farm',quantity:99},{sku:'farm',quantity:2}],null));
  assert.throws(()=>commands.validateFrozenLines([line()],1));
  assert.throws(()=>commands.validateFrozenLines([{...line(),period_days:undefined}],19000000));
});
test('payment reservation writes real FK and prevents second active attempt',async()=>{
  const db=await fixture(),o=await order(db),first=await reserve(db,o),second=await reserve(db,o);
  assert.ok(first.attempt.id>0);assert.equal(second.attempt,null);assert.equal(await count(db,'payment_attempts'),1);
  assert.equal(await count(db,'payment_events'),2);assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
});
test('verification credits every purchased sku and quantity',async()=>{
  const db=await fixture(),o=await order(db,{lines:[line(1,2),line(2)]}),{attempt}=await reserve(db,o);await verify(db,o,attempt);
  const es=(await db.prepare('SELECT sku,expires_at FROM entitlements ORDER BY sku').all()).results;
  assert.equal(es.length,2);assert.equal(es[0].expires_at,'2026-12-02 00:00:00');assert.equal(es[1].expires_at,'2026-11-02 00:00:00');
  assert.equal((await db.prepare('SELECT status FROM orders WHERE id=?').bind(o.id).first()).status,'paid');
});
test('same in-flight verification replay cannot extend expiry or duplicate ledger',async()=>{
  const db=await fixture(),o=await order(db),{attempt}=await reserve(db,o);await verify(db,o,attempt);await verify(db,o,attempt,{now:'2026-10-04T00:00:00Z'});
  assert.equal((await db.prepare('SELECT expires_at FROM entitlements').first()).expires_at,'2026-11-02 00:00:00');
  assert.equal(await count(db,'entitlement_events'),1);assert.equal(await count(db,'payment_events'),3);
});
test('distinct renewals accumulate against current locked balance',async()=>{
  const db=await fixture(),a=await order(db),b=await order(db,{key:'order-key-0002'}),pa=(await reserve(db,a)).attempt,pb=(await reserve(db,b)).attempt;
  await Promise.all([verify(db,a,pa),verify(db,b,pb)]);
  assert.equal((await db.prepare('SELECT expires_at FROM entitlements').first()).expires_at,'2026-12-02 00:00:00');
  assert.equal(await count(db,'entitlements'),1);assert.equal(await count(db,'entitlement_events'),2);
});
test('cancelled order cannot receive entitlement from late verification',async()=>{
  const db=await fixture(),o=await order(db),{attempt}=await reserve(db,o);
  await db.prepare("UPDATE orders SET status='cancelled' WHERE id=?").bind(o.id).run();
  await verify(db,o,attempt);assert.equal(await count(db,'entitlements'),0);assert.equal(await count(db,'entitlement_events'),0);
  assert.equal((await db.prepare('SELECT state FROM payment_attempts').first()).state,'redirected');
});
test('unresolved attempt blocks cancellation with no false audit event',async()=>{
  const db=await fixture(),o=await order(db);await reserve(db,o);
  await db.batch(commands.cancelOrderStatements(db,{orderId:o.id,actorUserId:'buyer',operationId:'cancel-op',staff:false}));
  assert.equal((await db.prepare('SELECT status FROM orders').first()).status,'awaiting_payment');
  assert.equal(await count(db,'audit_events'),1);
});
test('unrelated user cannot cancel order',async()=>{
  const db=await fixture(),o=await order(db);
  await db.batch(commands.cancelOrderStatements(db,{orderId:o.id,actorUserId:'other',operationId:'cancel-op',staff:false}));
  assert.equal((await db.prepare('SELECT status FROM orders').first()).status,'pending');
});
test('cancellation without attempt is atomic and replay safe',async()=>{
  const db=await fixture(),o=await order(db);
  for(let i=0;i<2;i++)await db.batch(commands.cancelOrderStatements(db,{orderId:o.id,actorUserId:'buyer',operationId:'cancel-op-'+i,staff:false}));
  assert.equal((await db.prepare('SELECT status FROM orders').first()).status,'cancelled');assert.equal(await count(db,'audit_events'),2);
});
test('changed payment amount cannot fulfill order',async()=>{
  const db=await fixture(),o=await order(db),{attempt}=await reserve(db,o);
  await db.prepare('UPDATE payment_attempts SET amount_minor=10 WHERE id=?').bind(attempt.id).run();await verify(db,o,attempt);
  assert.equal(await count(db,'entitlements'),0);
});
test('scope keys separate organization and personal purchases',()=>{
  assert.equal(commands.entitlementHolderKey('buyer',7),'org:7');assert.equal(commands.entitlementHolderKey('buyer',null),'user:buyer');
});
test('demo and production grants never merge, and demo cannot satisfy a production entitlement gate',async()=>{
  const gates=require('../src/commerce/entitlementGates.ts');
  const db=await fixture();
  const demoOrder=await order(db,{key:'demo-order'}),demoAttempt=(await reserve(db,demoOrder,'demo-request','demo')).attempt;
  await verify(db,demoOrder,demoAttempt);
  assert.equal(await gates.findActiveEntitlement(db,'buyer','farm_workspace_monthly'),null);
  const realOrder=await order(db,{key:'real-order'}),realAttempt=(await reserve(db,realOrder,'real-request','zarinpal')).attempt;
  await verify(db,realOrder,realAttempt);
  const rows=(await db.prepare("SELECT grant_scope,expires_at FROM entitlements WHERE holder_key='user:buyer' AND sku='farm_workspace_monthly' ORDER BY grant_scope").all()).results;
  assert.deepEqual(rows.map(r=>r.grant_scope),['demo','production']);
  assert.equal(rows[0].expires_at,'2026-11-02 00:00:00');
  assert.equal(rows[1].expires_at,'2026-11-02 00:00:00');
  assert.equal((await gates.findActiveEntitlement(db,'buyer','farm_workspace_monthly')).expires_at,'2026-11-02 00:00:00');
});
test('dynamic date addition has an explicit PostgreSQL translation',()=>{
  const sql=sqliteSqlToPostgres("UPDATE entitlements SET expires_at=datetime(CASE WHEN datetime(expires_at)>datetime(?) THEN expires_at ELSE ? END, ?) WHERE holder_key=?");
  assert.ok(!sql.includes('datetime_sqlite_compat__'));assert.ok(!/\bdatetime\s*\(/.test(sql));assert.match(sql,/\(\$3\)::interval/);assert.match(sql,/holder_key=\$4/);
});

const pgValues=require('../src/db/postgresValues.ts');
const outbox=require('../src/notifications/outbox.ts');
const taskCommands=require('../src/workspaces/commands.ts');
const dossier=require('../src/dossiers/snapshot.ts');
test('PostgreSQL int8 parsing covers flags, money, scope, and count aliases by wire type',()=>{
  const rows=pgValues.normalizePostgresRows([{active:'1',price_minor:'19000000',organization_id:'7',custom_count:'12',id:'00123',registration:'00042'}],
    ['active','price_minor','organization_id','custom_count'].map(name=>({name,type:20})).concat([{name:'id',type:25},{name:'registration',type:25}]));
  assert.deepEqual(rows,[{active:1,price_minor:19000000,organization_id:7,custom_count:12,id:'00123',registration:'00042'}]);
});
test('PostgreSQL unsafe integers fail explicitly rather than silently rounding',()=>{
  assert.throws(()=>pgValues.parseSafePostgresInt8('9007199254740993'),/safe integer/);
  assert.throws(()=>pgValues.parseSafePostgresInt8('1.5'));
  assert.deepEqual(pgValues.normalizePostgresRows([{id:null}], [{name:'id',type:20}]),[{id:null}]);
});
test('local INSERT and UPDATE RETURNING preserve mutation metadata',async()=>{
  const db=await fixture();
  const [insert]=await db.batch([db.prepare("INSERT INTO horses(id,name_latin) VALUES(1,'Test') RETURNING id")]);
  assert.equal(insert.meta.changes,1);assert.equal(insert.meta.last_row_id,1);
  const [update,noop,read]=await db.batch([
    db.prepare("UPDATE horses SET name_latin='Updated' WHERE id=1 RETURNING id"),
    db.prepare("UPDATE horses SET name_latin='No' WHERE id=2 RETURNING id"),
    db.prepare('SELECT id FROM horses'),
  ]);
  assert.equal(update.meta.changes,1);assert.equal(noop.meta.changes,0);assert.equal(read.meta.changes,0);
});
test('CSV formula protection never skips structural escaping',()=>{
  assert.equal(domain.csvSafeCell('=safe,=1+1'),'"\'=safe,=1+1"');
  assert.equal(domain.csvSafeCell('line\rbreak'),'"line\rbreak"');
  assert.equal(domain.csvSafeCell('"quoted"'),'"""quoted"""');
  assert.equal(domain.csvSafeCell('normal'),'normal');
  assert.match(domain.csvSafeCell('  =1+1'),/^'/);
});
test('workspace dates reject calendar rollover and invalid intervals',()=>{
  assert.equal(domain.isValidDay('2026-02-31'),false);assert.equal(domain.isValidDay('2024-02-29'),true);
  assert.equal(domain.isValidDay('2026-02-29'),false);assert.equal(domain.isValidDay('2026-2-01'),false);
  assert.throws(()=>domain.addDays('2026-02-31',1));assert.throws(()=>domain.addDays('2026-10-03',1.5));
  assert.equal(domain.addDays('2026-12-31',1),'2027-01-01');
});
async function taskFixture(){
  const db=await fixture();await db.exec(`
    INSERT INTO workspace_collections(id,name,owner_user_id) VALUES(1,'Private collection','buyer');
    INSERT INTO horses(id,name_latin) VALUES(1,'Example');
    INSERT INTO workspace_tasks(id,collection_id,horse_id,title,category,due_date,recurrence,recurrence_interval_days,created_by_user_id,assigned_to_user_id,occurrence_key)
    VALUES(1,1,1,'User-entered reminder','other','2026-10-03','custom_days',7,'buyer','other','task-1');`);
  return db;
}
const completeInput=(more={})=>({collectionId:1,taskId:1,actorUserId:'buyer',expectedVersion:1,operationId:crypto.randomUUID(),nextDueDate:'2026-10-10',...more});
test('successful task completion creates exactly one assigned recurrence',async()=>{
  const db=await taskFixture();await db.batch(taskCommands.completeTaskStatements(db,completeInput()));
  await db.batch(taskCommands.completeTaskStatements(db,completeInput()));
  const rows=(await db.prepare('SELECT * FROM workspace_tasks ORDER BY id').all()).results;
  assert.equal(rows.length,2);assert.equal(rows[0].status,'done');assert.equal(rows[1].assigned_to_user_id,'other');
  assert.equal(rows[1].parent_task_id,1);assert.equal(rows[1].occurrence_index,1);
});
test('stale completion cannot enqueue a next recurrence',async()=>{
  const db=await taskFixture();await db.batch(taskCommands.completeTaskStatements(db,completeInput({expectedVersion:2})));
  assert.equal(await count(db,'workspace_tasks'),1);assert.equal((await db.prepare('SELECT status FROM workspace_tasks').first()).status,'open');
});
test('unrelated and revoked task managers cannot mutate the private workspace',async()=>{
  const db=await taskFixture();
  await db.exec("INSERT INTO workspace_staff_assignments(collection_id,user_id,actions,granted_by_user_id,status,revoked_at) VALUES(1,'other','view,tasks_manage','buyer','revoked',CURRENT_TIMESTAMP)");
  await db.batch(taskCommands.completeTaskStatements(db,completeInput({actorUserId:'other'})));
  assert.equal(await count(db,'workspace_tasks'),1);assert.equal((await db.prepare('SELECT status FROM workspace_tasks').first()).status,'open');
});
async function enqueue(db,key='notice-1',extra={}){
  await db.batch([outbox.outboxStatement(db,{eventKey:key,channel:'email',purpose:'service_request_notice',recipientUserId:'buyer',recipientMasked:'b***@example.test',...extra})]);
  await db.prepare("UPDATE notification_outbox SET next_attempt_at='2026-10-01T00:00:00Z' WHERE event_key=?").bind(key).run();
}
const testNow=()=>new Date('2026-10-03T12:00:00.000Z');
test('concurrent outbox drains cannot dispatch an actively leased row twice',async()=>{
  const db=await fixture();await enqueue(db);let sends=0,release,entered;
  const gate=new Promise(resolve=>{release=resolve});const started=new Promise(resolve=>{entered=resolve});
  const opts={now:testNow,send:async()=>{sends++;entered();await gate;return {accepted:true,providerName:'test-bridge',providerMessageId:'msg-1'}}};
  const first=outbox.drainOutbox(db,opts);await started;
  const second=await outbox.drainOutbox(db,opts);assert.equal(second.claimed,0);release();await first;
  assert.equal(sends,1);assert.equal((await db.prepare('SELECT status FROM notification_outbox').first()).status,'provider_accepted');
});
test('temporary quiet hours defer instead of permanently discarding a notification',async()=>{
  const db=await fixture();await enqueue(db);
  await db.exec("INSERT INTO notification_preferences(user_id,quiet_hour_start,quiet_hour_end,timezone) VALUES('buyer',15,17,'Asia/Tehran')");
  let calls=0;const result=await outbox.drainOutbox(db,{now:testNow,send:async()=>{calls++;return {accepted:true}}});
  const row=await db.prepare('SELECT status,attempts,next_attempt_at FROM notification_outbox').first();
  assert.equal(calls,0);assert.equal(result.deferred,1);assert.equal(row.status,'queued');assert.equal(row.attempts,0);
  assert.equal(row.next_attempt_at,'2026-10-03T12:30:00.000Z');
});
test('an essential OTP bypasses marketing unsubscribe and quiet preferences',async()=>{
  const db=await fixture();await enqueue(db,'otp-1',{purpose:'login_otp'});
  await db.exec("INSERT INTO notification_preferences(user_id,unsubscribed_purposes,quiet_hour_start,quiet_hour_end,monthly_send_limit,timezone) VALUES('buyer','login_otp',0,23,0,'Asia/Tehran')");
  const result=await outbox.drainOutbox(db,{now:testNow,send:async()=>({accepted:true,providerName:'test',providerMessageId:'otp-msg'})});
  assert.equal(result.provider_accepted,1);
});
test('provider exceptions are retriable and do not strand the lease',async()=>{
  const db=await fixture();await enqueue(db);
  const result=await outbox.drainOutbox(db,{now:testNow,send:async()=>{throw new Error('network unavailable')}});
  const row=await db.prepare('SELECT status,lease_token,last_error FROM notification_outbox').first();
  assert.equal(result.failed,1);assert.equal(row.status,'queued');assert.equal(row.lease_token,null);assert.equal(row.last_error,'network');
});
async function callback(db,{key='notice-1',message='msg-1',provider='test-bridge',status='delivered',signature=null}={}){
  const rawBody=JSON.stringify({event_key:key,provider_message_id:message,status});
  return outbox.recordDeliveryCallback(db,{provider,rawBody,secret:'test-only-secret',signature:signature ?? await outbox.computeCallbackSignature('test-only-secret',provider,rawBody)});
}
test('a valid callback for an unknown notification cannot create a phantom delivery',async()=>{
  const db=await fixture();await assert.rejects(callback(db),{status:409});assert.equal(await count(db,'notification_deliveries'),0);
});
test('delivery callbacks require exact provider and exact message; R96-N04 keyed callbacks upgrade unaccepted rows',async()=>{
  const db=await fixture();await enqueue(db);
  // A keyless callback can correlate NOTHING (no event key, row unaccepted).
  const keylessBody=JSON.stringify({provider_message_id:'msg-1',status:'delivered'});
  await assert.rejects(outbox.recordDeliveryCallback(db,{provider:'test-bridge',rawBody:keylessBody,secret:'test-only-secret',signature:await outbox.computeCallbackSignature('test-only-secret','test-bridge',keylessBody)}),{status:409});
  assert.equal(await count(db,'notification_deliveries'),0);
  // R96-N04 callback-before-acceptance: the send's acceptance response was
  // lost (timeout) but the VERIFIED delivery callback carries the event's
  // idempotency key — the row upgrades to delivered directly.
  const upgraded=await (await callback(db)).json();
  assert.equal(upgraded.state_change,true);
  assert.equal(upgraded.upgraded_from_unaccepted,true);
  assert.equal(await count(db,'notification_deliveries'),1);
  const upgradedRow=await db.prepare('SELECT status,provider_name,provider_message_id FROM notification_outbox').first();
  assert.equal(upgradedRow.status,'delivered');
  assert.equal(upgradedRow.provider_name,'test-bridge');
  assert.equal(upgradedRow.provider_message_id,'msg-1');
  // Exact provider and exact message are still required on ACCEPTED rows.
  const db2=await fixture();await enqueue(db2,'notice-1',{status:'provider_accepted',providerName:'test-bridge',providerMessageId:'msg-1'});
  await assert.rejects(callback(db2,{provider:'other-bridge'}),{status:409});
  await assert.rejects(callback(db2,{message:'other-message'}),{status:409});
  assert.equal(await count(db2,'notification_deliveries'),0);
  assert.equal((await db2.prepare('SELECT status FROM notification_outbox').first()).status,'provider_accepted');
  // R95-N10: a VERIFIED non-delivery (bridge envelope status 'failed') is no
  // longer a 400 — it is recorded honestly: the accepted row moves to failed
  // with provider_reported_not_delivered, and no delivery row is ever written.
  const nonDelivery=await (await callback(db2,{status:'failed'})).json();
  assert.equal(nonDelivery.delivery,'not_delivered');
  assert.equal(await count(db2,'notification_deliveries'),0);
  assert.equal((await db2.prepare('SELECT status FROM notification_outbox').first()).status,'failed');
  assert.equal((await db2.prepare("SELECT last_error FROM notification_outbox").first()).last_error,'provider_reported_not_delivered');
});
test('correlated delivery callback is idempotent and forged signature changes no delivery state',async()=>{
  const db=await fixture();await enqueue(db,'notice-1',{status:'provider_accepted',providerName:'test-bridge',providerMessageId:'msg-1'});
  await assert.rejects(callback(db,{signature:'0'.repeat(64)}),{status:401});
  assert.equal(await count(db,'notification_deliveries'),0);
  assert.equal((await (await callback(db)).json()).state_change,true);
  assert.equal((await (await callback(db)).json()).idempotent_replay,true);
  assert.equal(await count(db,'notification_deliveries'),1);
});
test('callback payload limits apply before logging or parsing',async()=>{
  const db=await fixture();await assert.rejects(outbox.recordDeliveryCallback(db,{provider:'test',rawBody:'x'.repeat(16385),signature:null,secret:'test'}),{status:413});
  assert.equal(await count(db,'notification_callbacks'),0);
});
async function dossierFixture(){
  const db=await fixture();await db.exec(`INSERT INTO horses(id,name_latin,sex_desc,color_desc,breed_desc,birth_year) VALUES(1,'Example','Mare','Bay','Recorded breed',2020),(2,'Deleted sire','Stallion',NULL,NULL,2000);
    UPDATE horses SET father_id=2 WHERE id=1;UPDATE horses SET deleted_at=CURRENT_TIMESTAMP WHERE id=2;
    -- R140-A: the shared HYPP row carries the explicit disclosure decision; the unverified row stays excluded.
    INSERT INTO genetic_tests(id,horse_id,test_type,result,verified,lab_accession,notes,result_interpretation,public_disclosed) VALUES(1,1,'HYPP','N/N',1,'PRIVATE-LAB-ID','PRIVATE-NOTE','PRIVATE-INTERPRETATION',1),(2,1,'HYPP','N/H',0,'OTHER-PRIVATE',NULL,NULL,0);`);
  return db;
}
const dossierOpts={includePedigree:true,includeResults:true,includeGenetics:true,includeContact:false,creatorUserId:'buyer'};
test('dossier snapshot executes on the real schema and redacts private genetics and deleted parents',async()=>{
  const db=await dossierFixture();const {snapshot,sectionsMeta}=await dossier.buildDossierSnapshot(db,1,dossierOpts);
  assert.equal(snapshot.identity.sex,'Mare');assert.equal(snapshot.pedigree.sire_name,null);assert.equal(snapshot.genetics.length,1);
  const text=JSON.stringify(snapshot);assert.ok(!text.includes('PRIVATE'));assert.equal(snapshot.genetics[0].lab_accession,null);
  assert.deepEqual(snapshot.contact,{not_shared:true});assert.notEqual(sectionsMeta.identity.review_state,'verified');
  assert.equal(snapshot.results_summary.total_records,0);
});
test('default-redacted dossier does not describe missing evidence as clear',async()=>{
  const db=await dossierFixture();const {snapshot}=await dossier.buildDossierSnapshot(db,1,{...dossierOpts,includeGenetics:false,includePedigree:false,includeResults:false});
  assert.deepEqual(snapshot.genetics,{not_shared:true});assert.deepEqual(snapshot.results,{not_shared:true});assert.deepEqual(snapshot.pedigree,{not_shared:true});
});
test('a genetic correction changes dossier staleness without changing horses.updated_at',async()=>{
  const db=await dossierFixture();const original=await dossier.buildDossierSnapshot(db,1,dossierOpts);
  await db.exec("UPDATE genetic_tests SET result='N/H' WHERE id=1");
  const current=await dossier.buildDossierSnapshot(db,1,dossierOpts);
  assert.equal(dossier.dossierSnapshotsEqual(original.snapshot,current.snapshot),false);
  assert.equal(dossier.frozenGeneticsStillPublic(original.snapshot,current.snapshot),true);
});
test('a withdrawn genetic result prevents re-exposure of its frozen public copy',async()=>{
  const db=await dossierFixture();const original=await dossier.buildDossierSnapshot(db,1,dossierOpts);
  await db.exec('UPDATE genetic_tests SET verified=0 WHERE id=1');
  const current=await dossier.buildDossierSnapshot(db,1,dossierOpts);
  assert.equal(dossier.frozenGeneticsStillPublic(original.snapshot,current.snapshot),false);
});
test('deleted horses cannot generate new dossiers',async()=>{
  const db=await dossierFixture();await db.exec('UPDATE horses SET deleted_at=CURRENT_TIMESTAMP WHERE id=1');
  await assert.rejects(dossier.buildDossierSnapshot(db,1,dossierOpts),{status:404});
});
test('N13 the snapshot is ONE statement — identity, sections and source marker from a single engine snapshot',async()=>{
  const db=await dossierFixture();const prepared=[];
  const recording=new Proxy(db,{get(target,property,receiver){
    if(property==='prepare')return (sql)=>{prepared.push(sql);return target.prepare(sql);};
    return Reflect.get(target,property,receiver);
  }});
  await dossier.buildDossierSnapshot(recording,1,dossierOpts);
  assert.equal(prepared.length,1,'the builder must issue exactly one query (multi-reads tear on PostgreSQL READ COMMITTED)');
  assert.ok(prepared[0].includes('AS source_updated_at'));
  // Excluded sections are never read at all — not read-then-redacted.
  const preparedMinimal=[];
  const recordingMinimal=new Proxy(db,{get(target,property,receiver){
    if(property==='prepare')return (sql)=>{preparedMinimal.push(sql);return target.prepare(sql);};
    return Reflect.get(target,property,receiver);
  }});
  await dossier.buildDossierSnapshot(recordingMinimal,1,{...dossierOpts,includeGenetics:false,includePedigree:false,includeResults:false});
  assert.equal(preparedMinimal.length,1);
  assert.ok(!preparedMinimal[0].includes('genetic_tests'));
  assert.ok(!preparedMinimal[0].includes('competition_results'));
});
test('N13 a mandate revoked between preflight and mint produces no snapshot and no share token',async()=>{
  const db=await dossierFixture();
  // 'buyer' has NO grant at all: the command-level call bypasses the route
  // preflight on purpose — the transaction itself must refuse.
  const [dossierInsert]=await db.batch(dossierCommands.createDossierStatements(db,{operationId:crypto.randomUUID(),actorUserId:'buyer',actorRole:'user',horseId:1,version:2,snapshotJson:'{}',sectionsMetaJson:'{}',issuedDigest:'d'.repeat(64)}));
  assert.equal(Number(dossierInsert.meta.changes),0);
  assert.equal(await count(db,'dossier_snapshots'),0);
  const [linkInsert]=await db.batch(dossierCommands.createDossierLinkStatements(db,{operationId:crypto.randomUUID(),actorUserId:'buyer',actorRole:'user',dossierId:1,tokenHash:'a'.repeat(64),expiresAt:'2026-12-01T00:00:00.000Z',recipientUserId:null}));
  assert.equal(Number(linkInsert.meta.changes),0);
  assert.equal(await count(db,'dossier_share_links'),0);
  // A live owner grant DOES mint.
  await db.exec(`INSERT INTO horse_access_grants(id,horse_id,grantee_user_id,relationship,actions,basis,valid_from)
    VALUES('gd',1,'buyer','owner','manage_profile,upload_media,create_listing,manage_inquiries','claim_approval','2026-01-01 00:00:00')`);
  const [granted]=await db.batch(dossierCommands.createDossierStatements(db,{operationId:crypto.randomUUID(),actorUserId:'buyer',actorRole:'user',horseId:1,version:2,snapshotJson:'{"horse_id":1,"source":{"schema_version":2}}',sectionsMetaJson:'{}',issuedDigest:'e'.repeat(64)}));
  assert.equal(Number(granted.meta.changes),1);
  assert.equal(await count(db,'audit_events'),1);
  // Late revocation kills the mint path again.
  await db.exec("UPDATE horse_access_grants SET revoked_at=CURRENT_TIMESTAMP WHERE id='gd'");
  const [revoked]=await db.batch(dossierCommands.createDossierLinkStatements(db,{operationId:crypto.randomUUID(),actorUserId:'buyer',actorRole:'user',dossierId:1,tokenHash:'b'.repeat(64),expiresAt:'2026-12-01T00:00:00.000Z',recipientUserId:null}));
  assert.equal(Number(revoked.meta.changes),0);
  assert.equal(await count(db,'dossier_share_links'),0);
});
test('N13 the issued digest binds exact content and legacy payloads validate controlled',async()=>{
  const db=await dossierFixture();
  const {snapshot,sectionsMeta}=await dossier.buildDossierSnapshot(db,1,dossierOpts);
  const snapshotJson=JSON.stringify(snapshot),sectionsMetaJson=JSON.stringify(sectionsMeta);
  const digest=await dossier.dossierContentDigest(snapshotJson,sectionsMetaJson);
  assert.equal(digest.length,64);
  assert.equal(await dossier.dossierContentDigest(snapshotJson,sectionsMetaJson),digest);
  assert.notEqual(await dossier.dossierContentDigest(snapshotJson+' ',sectionsMetaJson),digest);
  // Controlled legacy validation: good payload passes, every malformed class fails closed.
  const ok=dossier.parseLegacyDossierPayload(snapshotJson,sectionsMetaJson);
  assert.equal(ok.ok,true);
  assert.equal(dossier.parseLegacyDossierPayload('{"broken',sectionsMetaJson).ok,false);
  assert.equal(dossier.parseLegacyDossierPayload(snapshotJson,'nope').ok,false);
  const badVersion=dossier.parseLegacyDossierPayload(JSON.stringify({...snapshot,source:{schema_version:99}}),sectionsMetaJson);
  assert.equal(badVersion.ok,false);
});

const serviceCommands=require('../src/services/commands.ts');
const servicePolicy=require('../src/services/policy.ts');
async function serviceFixture(){
  const db=await fixture();
  await db.exec(`INSERT INTO people(id,name_latin) VALUES(1,'Example Provider');
    INSERT INTO directory_profiles(person_id,service_categories,publication_consent) VALUES(1,'["veterinarian"]',1);
    INSERT INTO user_person_links(user_id,person_id,status) VALUES('other',1,'verified');`);
  return db;
}
async function serviceInput(overrides={}){
  const value={operationId:crypto.randomUUID(),receiptKey:await serviceCommands.serviceReceiptKey('buyer','same-client-key'),digest:'payload-v1',actorUserId:'buyer',providerPersonId:1,category:'veterinarian',province:null,city:null,horseId:null,note:'Please discuss availability. No diagnosis requested.',shareContact:false,responseJson:'{}',...overrides};
  return value;
}
test('service requests save a durable request id and notify actual provider accounts',async()=>{
  const db=await serviceFixture();await db.batch(serviceCommands.createServiceStatements(db,await serviceInput()));
  assert.equal(await count(db,'service_requests'),1);assert.equal((await db.prepare('SELECT request_id FROM service_request_receipts').first()).request_id,1);
  assert.equal((await db.prepare('SELECT recipient_user_id FROM notification_outbox').first()).recipient_user_id,'other');
  assert.equal(await count(db,'audit_events'),1);
});
test('service retry does not duplicate request audit or notification',async()=>{
  const db=await serviceFixture();await db.batch(serviceCommands.createServiceStatements(db,await serviceInput()));
  await db.batch(serviceCommands.createServiceStatements(db,await serviceInput()));
  for(const table of ['service_requests','service_request_receipts','notification_outbox','audit_events'])assert.equal(await count(db,table),1,table);
});
test('service client idempotency keys are isolated by authenticated actor',async()=>{
  assert.notEqual(await serviceCommands.serviceReceiptKey('buyer','key-1234'),await serviceCommands.serviceReceiptKey('other','key-1234'));
});
test('withdrawn directory consent and category mismatch cannot create a service request',async()=>{
  const db=await serviceFixture();await db.batch(serviceCommands.createServiceStatements(db,await serviceInput({category:'farrier'})));
  await db.exec('UPDATE directory_profiles SET publication_consent=0');await db.batch(serviceCommands.createServiceStatements(db,await serviceInput()));
  assert.equal(await count(db,'service_requests'),0);assert.equal(await count(db,'service_request_receipts'),0);assert.equal(await count(db,'audit_events'),0);
});
test('service block and open-request quota are enforced at command execution',async()=>{
  const db=await serviceFixture();await db.exec("INSERT INTO service_request_blocks(blocker_user_id,blocked_person_id) VALUES('buyer',1)");
  await db.batch(serviceCommands.createServiceStatements(db,await serviceInput()));assert.equal(await count(db,'service_requests'),0);
  await db.exec('DELETE FROM service_request_blocks');
  // N12: distinct notes — identical provider+category+note text inside 24h is
  // now refused by the duplicate-lead arm before the open quota is reached.
  for(let n=0;n<5;n++)await db.batch(serviceCommands.createServiceStatements(db,await serviceInput({receiptKey:'unique-'+n,note:'Please discuss availability, question '+n+'. No diagnosis requested.'})));
  assert.equal(await count(db,'service_requests'),3);assert.equal(await count(db,'notification_outbox'),3);
});
test('requesters cannot impersonate provider response metrics',()=>{
  assert.equal(serviceCommands.serviceTransitionAllowed('new','acknowledged','requester'),false);
  assert.equal(serviceCommands.serviceTransitionAllowed('new','withdrawn','provider'),false);
  assert.equal(serviceCommands.serviceTransitionAllowed('new','closed','requester'),true);
});
test('revoked provider cannot respond and stale transition creates no side effects',async()=>{
  const db=await serviceFixture();await db.batch(serviceCommands.createServiceStatements(db,await serviceInput()));
  const input={requestId:1,expectedVersion:1,from:'new',to:'acknowledged',actorUserId:'other',actor:'provider',operationId:crypto.randomUUID()};
  await db.exec("UPDATE user_person_links SET status='revoked'");
  await db.batch(serviceCommands.transitionServiceStatements(db,input));assert.equal((await db.prepare('SELECT status FROM service_requests').first()).status,'new');
  assert.equal(await count(db,'audit_events'),1);
  await db.exec("UPDATE user_person_links SET status='verified'");await db.batch(serviceCommands.transitionServiceStatements(db,{...input,operationId:crypto.randomUUID()}));
  await db.batch(serviceCommands.transitionServiceStatements(db,{...input,operationId:crypto.randomUUID()}));
  const row=await db.prepare('SELECT * FROM service_requests').first();assert.equal(row.status,'acknowledged');assert.ok(row.first_response_at);assert.equal(row.row_version,2);
  assert.equal(await count(db,'audit_events'),2);assert.equal(await count(db,'notification_outbox'),2);
});
test('unrelated active user is not a provider manager',async()=>{
  const db=await serviceFixture();assert.equal(await serviceCommands.isServiceProviderManager(db,'buyer',1),false);
  assert.equal(await serviceCommands.isServiceProviderManager(db,'other',1),true);
  await db.exec("UPDATE users SET is_active=0 WHERE id='other'");assert.equal(await serviceCommands.isServiceProviderManager(db,'other',1),false);
});
test('N11 self-lead is refused inside the create transaction',async()=>{
  const db=await serviceFixture(); // 'other' holds the verified link to person 1
  await db.batch(serviceCommands.createServiceStatements(db,await serviceInput({actorUserId:'other',receiptKey:await serviceCommands.serviceReceiptKey('other','self-lead-key')})));
  assert.equal(await count(db,'service_requests'),0);assert.equal(await count(db,'service_request_receipts'),0);
  assert.equal(await count(db,'audit_events'),0);assert.equal(await count(db,'notification_outbox'),0);
});
// ---------------------------------------------------------------------------
// R95-N12: consent withdrawal + anti-abuse lifecycle (real SQLite, exact SQL).
// ---------------------------------------------------------------------------
const servicePrivacy=require('../src/services/privacy.ts');
test('N12 consent withdrawal removes future disclosure and suppresses pending optional notices',async()=>{
  const db=await serviceFixture();
  await db.batch(serviceCommands.createServiceStatements(db,await serviceInput({shareContact:true})));
  const before=(await db.prepare('SELECT share_contact FROM service_requests WHERE id=1').first()).share_contact;
  assert.equal(before,1);
  const results=await db.batch(servicePrivacy.consentWithdrawalStatements(db,{requestId:1,requesterUserId:'buyer',operationId:crypto.randomUUID()}));
  assert.equal(results[0].meta.changes,1);
  assert.equal(results[1].meta.changes,1); // the queued created-notice is suppressed
  const row=await db.prepare('SELECT share_contact,consent_updated_at FROM service_requests WHERE id=1').first();
  assert.equal(row.share_contact,0);assert.ok(row.consent_updated_at);
  const outbox=await db.prepare('SELECT status,last_error FROM notification_outbox').first();
  assert.equal(outbox.status,'suppressed');assert.equal(outbox.last_error,'consent_withdrawn');
  assert.equal(await count(db,'audit_events'),2); // created + consent_withdrawn
  // Idempotence guard: a second withdrawal CAS changes nothing and suppresses nothing.
  const again=await db.batch(servicePrivacy.consentWithdrawalStatements(db,{requestId:1,requesterUserId:'buyer',operationId:crypto.randomUUID()}));
  assert.equal(again[0].meta.changes,0);assert.equal(again[1].meta.changes,0);
});
test('N12 provider block refuses new leads transactionally and skips their notifications',async()=>{
  const db=await serviceFixture();
  await db.exec("INSERT INTO service_provider_blocks(provider_person_id,blocked_requester_user_id,reason) VALUES(1,'buyer','abusive pattern')");
  await db.batch(serviceCommands.createServiceStatements(db,await serviceInput()));
  assert.equal(await count(db,'service_requests'),0);assert.equal(await count(db,'service_request_receipts'),0);
  assert.equal(await count(db,'notification_outbox'),0); // blocked senders mint no notice
  // The route's provider-block batch: insert + suppress + audit.
  const block=await db.batch(servicePrivacy.providerBlockStatements(db,{providerPersonId:1,blockedRequesterUserId:'buyer',actorUserId:'other',reason:'private reason',operationId:crypto.randomUUID()}));
  assert.equal(block[0].meta.changes,0); // INSERT OR IGNORE: already blocked
  assert.equal(block[2].meta.changes,0); // no new block, no authority, no fabricated audit
});
test('N12 abuse standing, rate bounds and duplicate detection refuse in-transaction',async()=>{
  const db=await serviceFixture();
  await db.exec("INSERT INTO service_abuse_standing(user_id,standing,reason) VALUES('buyer','restricted','spam wave')");
  await db.batch(serviceCommands.createServiceStatements(db,await serviceInput()));
  assert.equal(await count(db,'service_requests'),0);
  await db.exec('DELETE FROM service_abuse_standing');
  // Per-account/category bound: 5 veterinarian leads inside the window. Each
  // lead is CLOSED right after creation so the open-per-provider cap (3)
  // never fires — only the category bound can refuse the 6th.
  for(let n=0;n<5;n++){
    await db.batch(serviceCommands.createServiceStatements(db,await serviceInput({receiptKey:await serviceCommands.serviceReceiptKey('buyer','rate-'+n),note:'Availability question number '+n+'.'})));
    const created=(await db.prepare('SELECT id FROM service_requests ORDER BY id DESC LIMIT 1').first()).id;
    await db.batch(serviceCommands.transitionServiceStatements(db,{requestId:created,expectedVersion:1,from:'new',to:'closed',actorUserId:'buyer',actor:'requester',operationId:crypto.randomUUID()}));
  }
  assert.equal(await count(db,'service_requests'),5);
  await db.batch(serviceCommands.createServiceStatements(db,await serviceInput({receiptKey:await serviceCommands.serviceReceiptKey('buyer','rate-6'),note:'One more veterinarian note over the bound.'})));
  assert.equal(await count(db,'service_requests'),5); // refused by the category bound
  // Duplicate: same provider+category+note inside 24h.
  await db.batch(serviceCommands.createServiceStatements(db,await serviceInput({receiptKey:await serviceCommands.serviceReceiptKey('buyer','dup-1'),note:'Availability question number 1.'})));
  assert.equal(await count(db,'service_requests'),5);
});
test('N12 withdrawing the whole lead suppresses its pending optional notices',async()=>{
  const db=await serviceFixture();
  await db.batch(serviceCommands.createServiceStatements(db,await serviceInput()));
  const statements=serviceCommands.transitionServiceStatements(db,{requestId:1,expectedVersion:1,from:'new',to:'withdrawn',actorUserId:'buyer',actor:'requester',operationId:crypto.randomUUID()});
  assert.equal(statements.length,4); // transition + audit + outbox + N12 suppress
  const results=await db.batch(statements);
  // The suppression matches BOTH still-queued optional notices for this
  // request: the created-notice AND the just-minted v2 status notice — after
  // a withdrawal the provider is told nothing further about the dead lead
  // (they still see it as withdrawn in their inbox).
  assert.deepEqual(results.map((r)=>r.meta.changes),[1,1,1,2]);
  const remaining=await db.prepare("SELECT COUNT(*) AS n FROM notification_outbox WHERE status='queued' AND event_key LIKE 'service-request:1:%'").first();
  assert.equal(Number(remaining.n),0);
  // A non-withdrawal transition carries NO suppression statement.
  const ack=serviceCommands.transitionServiceStatements(db,{requestId:1,expectedVersion:2,from:'new',to:'acknowledged',actorUserId:'other',actor:'provider',operationId:crypto.randomUUID()});
  assert.equal(ack.length,3);
});
test('N12 retention sweep minimizes old terminal leads only, and is idempotent',async()=>{
  const db=await serviceFixture();
  await db.exec(`INSERT INTO service_requests(id,requester_user_id,provider_person_id,category,note,share_contact,status,row_version,created_at,updated_at)
    VALUES (50,'buyer',1,'veterinarian','old closed',1,'closed',2,'2024-01-01 00:00:00','2024-02-01 00:00:00'),
           (51,'buyer',1,'veterinarian','old live',1,'new',1,'2024-01-01 00:00:00','2024-02-01 00:00:00'),
           (52,'buyer',1,'veterinarian','recent closed',1,'closed',2,'2026-09-01 00:00:00','2026-09-20 00:00:00');
    INSERT INTO notification_outbox(event_key,channel,purpose,essential,recipient_user_id,recipient_masked)
    VALUES ('service-request:50:v5:other','email','service_request_notice',0,'other','provider account');`);
  const first=await servicePrivacy.serviceRetentionSweep(db,new Date().toISOString());
  assert.equal(first.redacted_notes,1);assert.equal(first.suppressed_notices,1);
  const row=await db.prepare('SELECT note,share_contact,note_redacted_at FROM service_requests WHERE id=50').first();
  assert.equal(row.note,'[retention: note minimized]');assert.equal(row.share_contact,0);assert.ok(row.note_redacted_at);
  assert.equal((await db.prepare('SELECT note FROM service_requests WHERE id=51').first()).note,'old live');
  assert.equal((await db.prepare('SELECT note FROM service_requests WHERE id=52').first()).note,'recent closed');
  const second=await servicePrivacy.serviceRetentionSweep(db,new Date().toISOString());
  assert.equal(second.redacted_notes,0);assert.equal(second.suppressed_notices,0);
});
test('N12 honest metrics need a minimum cohort and cap per-requester samples',()=>{
  const now='2026-10-04T00:00:00.000Z';
  const row=(uid,status,created,first)=>({requester_user_id:uid,status,created_at:created,first_response_at:first});
  const low=servicePrivacy.computeProviderResponseMetrics([
    row('a','closed','2026-09-01 10:00:00','2026-09-01 12:00:00'),
    row('b','closed','2026-09-02 10:00:00','2026-09-02 12:00:00'),
  ],now);
  assert.equal(low.insufficient_data,true);assert.equal(low.response_time_hours,null);
  const spammer=Array.from({length:9},(_,i)=>row('spam','closed','2026-09-0'+(i+1)+' 10:00:00','2026-09-0'+(i+1)+' 11:00:00'));
  assert.equal(servicePrivacy.computeProviderResponseMetrics(spammer,now).response_time_hours,null); // capped at 2
  const mixed=[...spammer,
    row('r1','closed','2026-09-10 10:00:00','2026-09-10 11:00:00'),
    row('r2','closed','2026-09-11 10:00:00','2026-09-11 11:00:00'),
    row('r3','closed','2026-09-12 10:00:00','2026-09-12 11:00:00'),
    row('r4','closed','2026-09-13 10:00:00','2026-09-13 11:00:00')];
  const metrics=servicePrivacy.computeProviderResponseMetrics(mixed,now);
  assert.equal(metrics.insufficient_data,false);
  assert.equal(metrics.response_time_hours.sample_size,6);
  assert.equal(metrics.exclusions.capped_per_requester,7);
});
test('N11 a horse reference needs a CURRENT mandate inside the transaction',async()=>{
  const db=await serviceFixture();
  await db.exec(`INSERT INTO horses(id,name_latin) VALUES(5,'MANDATE HORSE'),(6,'NO-GRANT HORSE');
    INSERT INTO horse_access_grants(id,horse_id,grantee_user_id,relationship,actions,valid_from)
      VALUES('g-svc-5',5,'buyer','owner','manage_profile,upload_media,create_listing,manage_inquiries','2026-01-01 00:00:00');`);
  // Live mandate: the reference lands.
  await db.batch(serviceCommands.createServiceStatements(db,await serviceInput({horseId:5,receiptKey:await serviceCommands.serviceReceiptKey('buyer','horse-live-key')})));
  assert.equal(await count(db,'service_requests'),1);
  assert.equal((await db.prepare('SELECT horse_id FROM service_requests').first()).horse_id,5);
  // No grant at all: refused in-transaction.
  await db.batch(serviceCommands.createServiceStatements(db,await serviceInput({horseId:6,receiptKey:await serviceCommands.serviceReceiptKey('buyer','horse-nogrant-key')})));
  // Late revocation: refused in-transaction.
  await db.exec("UPDATE horse_access_grants SET revoked_at=CURRENT_TIMESTAMP WHERE id='g-svc-5'");
  await db.batch(serviceCommands.createServiceStatements(db,await serviceInput({horseId:5,receiptKey:await serviceCommands.serviceReceiptKey('buyer','horse-revoked-key')})));
  assert.equal(await count(db,'service_requests'),1);assert.equal(await count(db,'service_request_receipts'),1);
});
test('N11 the moderator axis is defined but empty and route metadata is derived',()=>{
  for(const state of servicePolicy.SERVICE_STATES){
    assert.deepEqual(servicePolicy.SERVICE_TRANSITION_MATRIX[state].moderator,[]);
  }
  const route=servicePolicy.serviceRouteTransitions();
  assert.deepEqual([...route.new.by],['requester','provider']);
  assert.deepEqual([...route.new.to],['closed','withdrawn','acknowledged','spam']);
  assert.deepEqual([...route.closed.by],[]);
  // The matrix and both consumers agree on a requester-only and a provider-only move.
  assert.deepEqual([...servicePolicy.serviceActorsPermitting('new','withdrawn')],['requester']);
  assert.deepEqual([...servicePolicy.serviceActorsPermitting('new','acknowledged')],['provider']);
});
const moderationCommands=require('../src/moderation/commands.ts');
async function moderationFixture(){
  const db=await fixture();await db.exec(`UPDATE users SET role='admin' WHERE id='other';
    INSERT INTO horses(id,name_latin) VALUES(1,'Synthetic Horse');
    INSERT INTO sales_listings(id,horse_id,seller_user_id,seller_contact_name,status,provenance) VALUES('listing',1,'buyer','Example','active','user');
    INSERT INTO moderation_cases(id,target_table,target_id,reporter_user_id,reason) VALUES(1,'sales_listings','listing','buyer','other'),(2,'sales_listings','listing','other','other');`);return db;
}
const hideInput=(id=1)=>({caseId:id,expectedStatus:'new',targetId:'listing',targetTable:'sales_listings',actorUserId:'other',operationId:crypto.randomUUID(),decision:'hide',note:'Evidence reviewed by test operator.'});
test('only winning moderation decision creates its suspension and event; horse remains untouched',async()=>{
  const db=await moderationFixture(),before=await db.prepare('SELECT * FROM horses').first();
  await db.batch(moderationCommands.decideCaseStatements(db,hideInput()));await db.batch(moderationCommands.decideCaseStatements(db,hideInput()));
  assert.equal(await count(db,'listing_suspensions'),1);assert.equal(await count(db,'moderation_case_events'),1);assert.deepEqual(await db.prepare('SELECT * FROM horses').first(),before);
});
test('moderation command rechecks active operator and refuses unimplemented hide targets',async()=>{
  const db=await moderationFixture();await db.batch(moderationCommands.decideCaseStatements(db,{...hideInput(),actorUserId:'buyer'}));
  assert.equal(await count(db,'listing_suspensions'),0);assert.equal(await count(db,'moderation_case_events'),0);
  assert.throws(()=>moderationCommands.decideCaseStatements(db,{...hideInput(),targetTable:'directory_profiles'}),/no implemented/);
});
test('overturning one appeal cannot erase an independent suspension',async()=>{
  const db=await moderationFixture();await db.batch(moderationCommands.decideCaseStatements(db,hideInput(1)));await db.batch(moderationCommands.decideCaseStatements(db,hideInput(2)));
  await db.exec("INSERT INTO moderation_appeals(id,case_id,appellant_user_id,statement) VALUES(1,1,'buyer','Please review the evidence again.')");
  const appeal={appealId:1,caseId:1,actorUserId:'other',operationId:crypto.randomUUID(),outcome:'overturned',note:'Independent evidence now reviewed.'};
  await db.batch(moderationCommands.decideAppealStatements(db,appeal));await db.batch(moderationCommands.decideAppealStatements(db,{...appeal,operationId:crypto.randomUUID()}));
  const active=(await db.prepare('SELECT case_id FROM listing_suspensions WHERE reinstated_at IS NULL').all()).results;
  assert.deepEqual(active.map(row=>row.case_id),[2]);assert.equal(await count(db,'moderation_case_events'),3);
  assert.equal((await db.prepare('SELECT status FROM moderation_cases WHERE id=1').first()).status,'resolved_reinstated');
});
test('N14 duplicate ACTIVE reports are refused structurally under any active-status pair',async()=>{
  const db=await moderationFixture();
  // case 1 (buyer) is active 'new': a cross-status duplicate is refused by the partial index.
  await assert.rejects(()=>db.exec("INSERT INTO moderation_cases(id,target_table,target_id,reporter_user_id,reason,status) VALUES(3,'sales_listings','listing','buyer','other','triaged')"),/UNIQUE constraint/);
  // And once triaged (still active), the 'new' slot is refused too.
  await db.exec("UPDATE moderation_cases SET status='triaged' WHERE id=1");
  await assert.rejects(()=>db.exec("INSERT INTO moderation_cases(id,target_table,target_id,reporter_user_id,reason) VALUES(4,'sales_listings','listing','buyer','other')"),/UNIQUE constraint/);
  // Closed history never blocks: three dismissed cases for the same reporter+target coexist.
  await db.exec("UPDATE moderation_cases SET status='resolved_dismissed',resolved_at=CURRENT_TIMESTAMP WHERE id=1");
  db.exec("INSERT INTO moderation_cases(id,target_table,target_id,reporter_user_id,reason) VALUES(5,'sales_listings','listing','buyer','other')");
  await db.exec("UPDATE moderation_cases SET status='resolved_dismissed',resolved_at=CURRENT_TIMESTAMP WHERE id=5");
  db.exec("INSERT INTO moderation_cases(id,target_table,target_id,reporter_user_id,reason) VALUES(6,'sales_listings','listing','buyer','other')");
  await db.exec("UPDATE moderation_cases SET status='resolved_dismissed',resolved_at=CURRENT_TIMESTAMP WHERE id=6");
  assert.equal((await db.prepare("SELECT COUNT(*) c FROM moderation_cases WHERE status='resolved_dismissed' AND reporter_user_id='buyer' AND target_id='listing'").first()).c,3);
});
test('N14 standing commands are marker-gated and refuse non-resolved or merged cases',async()=>{
  const db=await moderationFixture();
  const standing=require('../src/moderation/commands.ts');
  await db.batch(moderationCommands.decideCaseStatements(db,hideInput(1))); // case 1 hidden (1 decision event)
  // Stamp+upsert+event land on the resolved case; the affected account is the seller of the listing.
  const op=crypto.randomUUID(),op2=crypto.randomUUID();
  await db.batch(standing.setStandingStatements(db,{expectedStanding:'normal',caseId:1,accountUserId:'buyer',standing:'restricted',reason:'test restriction',actorUserId:'other',operationId:op}));
  assert.equal((await db.prepare("SELECT standing FROM service_abuse_standing WHERE user_id='buyer'").first()).standing,'restricted');
  assert.equal(await count(db,'moderation_case_events'),2); // decision + standing
  // An ACTIVE case (case 2 is 'new') refuses the whole batch: stamp 0, marker-conditioned upsert 0, event 0.
  await db.batch(standing.setStandingStatements(db,{expectedStanding:'normal',caseId:2,accountUserId:'other',standing:'suspended',reason:'must not land',actorUserId:'other',operationId:op2}));
  assert.equal((await db.prepare("SELECT standing FROM service_abuse_standing WHERE user_id='other'").first()),null);
  assert.equal(await count(db,'moderation_case_events'),2);
  // A MERGED case is refused by the LIKE predicate (status<>'resolved_merged').
  await db.exec("UPDATE moderation_cases SET status='resolved_merged', merged_into_case_id=1 WHERE id=2");
  const op3=crypto.randomUUID();
  await db.batch(standing.setStandingStatements(db,{expectedStanding:'normal',caseId:2,accountUserId:'other',standing:'restricted',reason:'must not land either',actorUserId:'other',operationId:op3}));
  assert.equal((await db.prepare("SELECT standing FROM service_abuse_standing WHERE user_id='other'").first()),null);
  assert.equal(await count(db,'moderation_case_events'),2);
});
test('N14 assignment carries CAS + rechecks acting admin AND assignee standing inside the write',async()=>{
  const db=await moderationFixture();
  const commands=require('../src/moderation/commands.ts');
  // Expected-status CAS: assigning with a stale expected status changes nothing and writes no event.
  await db.batch(commands.assignCaseStatements(db,{caseId:1,expectedStatus:'triaged',operatorUserId:'other',severity:null,actorUserId:'other',operationId:crypto.randomUUID()}));
  assert.equal((await db.prepare("SELECT status FROM moderation_cases WHERE id=1").first()).status,'new');
  // A non-admin assignee is refused inside the statement.
  await db.batch(commands.assignCaseStatements(db,{caseId:1,expectedStatus:'new',operatorUserId:'buyer',severity:null,actorUserId:'other',operationId:crypto.randomUUID()}));
  assert.equal((await db.prepare("SELECT status FROM moderation_cases WHERE id=1").first()).status,'new');
  assert.equal(await count(db,'moderation_case_events'),0);
  // A real assignment moves new -> triaged and records the marker-gated event.
  await db.batch(commands.assignCaseStatements(db,{caseId:1,expectedStatus:'new',operatorUserId:'other',severity:'high',actorUserId:'other',operationId:crypto.randomUUID()}));
  assert.equal((await db.prepare("SELECT status,severity FROM moderation_cases WHERE id=1").first()).status,'triaged');
  assert.equal(await count(db,'moderation_case_events'),1);
});
const dossierCommands=require('../src/dossiers/commands.ts');
test('dossier revocation is creator-scoped and only the winner audits and revokes links',async()=>{
  const db=await dossierFixture();await db.exec(`INSERT INTO dossier_snapshots(id,horse_id,created_by_user_id,snapshot_json,sections_meta_json) VALUES(1,1,'buyer','{}','{}');
    INSERT INTO dossier_share_links(id,dossier_id,token_hash,expires_at,created_by_user_id) VALUES(1,1,'hash-not-a-real-token','2026-12-01','buyer');`);
  const input={id:1,actorUserId:'other',operationId:crypto.randomUUID()};await db.batch(dossierCommands.revokeDossierStatements(db,input));assert.equal(await count(db,'audit_events'),0);
  await db.batch(dossierCommands.revokeDossierStatements(db,{...input,actorUserId:'buyer',operationId:crypto.randomUUID()}));
  await db.batch(dossierCommands.revokeDossierStatements(db,{...input,actorUserId:'buyer',operationId:crypto.randomUUID()}));
  assert.equal(await count(db,'audit_events'),1);assert.ok((await db.prepare('SELECT revoked_at FROM dossier_share_links').first()).revoked_at);
});
const notificationCommands=require('../src/notifications/commands.ts');
test('notification retry never audits losing or unauthorized updates',async()=>{
  const db=await fixture();await enqueue(db);await db.exec("UPDATE notification_outbox SET status='dead_letter'");
  const input={id:1,actorUserId:'buyer',operationId:crypto.randomUUID()};await db.batch(notificationCommands.retryNotificationStatements(db,input));assert.equal(await count(db,'audit_events'),0);
  await db.exec("UPDATE users SET role='admin' WHERE id='buyer'");await db.batch(notificationCommands.retryNotificationStatements(db,{...input,operationId:crypto.randomUUID()}));
  await db.batch(notificationCommands.retryNotificationStatements(db,{...input,operationId:crypto.randomUUID()}));assert.equal(await count(db,'audit_events'),1);
  assert.equal((await db.prepare('SELECT status FROM notification_outbox').first()).status,'queued');
});
test('legacy refund and single-item payment builders fail without bookkeeping side effects',async()=>{
  const legacy=require('../src/commerce/entitlements.ts');assert.throws(()=>legacy.refundStatements(null,{}),/not implemented/);assert.throws(()=>legacy.verifiedPaymentStatements(null,{}),/disabled/);
});
test('destructive parity tooling rejects public and unsafe schema names',async()=>{
  const safety=await import('../scripts/lib/disposable-schema.mjs');
  for(const value of ['public','pg_catalog','information_schema','anything','hr_test_x;DROP SCHEMA public CASCADE'])assert.throws(()=>safety.disposableSchemaName(value));
  assert.match(safety.disposableSchemaName(),/^hr_test_[a-f0-9]{32}$/);
  const calls=[];await assert.rejects(safety.createOwnedSchema({unsafe:async sql=>{calls.push(sql);throw new Error('schema exists')}},'hr_test_existing'));
  assert.deepEqual(calls,['CREATE SCHEMA hr_test_existing']);
  assert.throws(()=>safety.requireDisposableLocalDatabase('postgres://u:p@production.example/db','yes'));
  assert.throws(()=>safety.requireDisposableLocalDatabase('postgres://u:p@localhost/db',undefined));
  safety.requireDisposableLocalDatabase('postgres://u:p@localhost/db','yes');
});
const maintenance=require('../src/commerce/maintenanceCommands.ts');
const priceInput={sku:'farm_workspace_monthly',version:2,nameEn:'Farm',nameFa:'Farm',description:null,amountMinor:25000000,periodDays:30,actorUserId:'buyer'};
test('repricing supersedes a version without changing a frozen order',async()=>{
  const db=await fixture(),o=await order(db),before=JSON.stringify(o);
  await db.batch(maintenance.repriceStatements(db,priceInput));
  assert.equal(JSON.stringify(await db.prepare('SELECT * FROM orders WHERE id=?').bind(o.id).first()),before);
  const rows=(await db.prepare('SELECT version,price_minor,superseded_at FROM billing_prices WHERE sku=? ORDER BY version').bind(priceInput.sku).all()).results;
  assert.equal(rows[0].price_minor,19000000);assert.ok(rows[0].superseded_at);assert.equal(rows[1].price_minor,25000000);assert.equal(rows[1].superseded_at,null);
});
test('racing price version rolls back superseding the winning price',async()=>{
  const db=await fixture();await db.batch(maintenance.repriceStatements(db,priceInput));
  await assert.rejects(db.batch(maintenance.repriceStatements(db,{...priceInput,amountMinor:30000000})));
  const row=await db.prepare('SELECT version,price_minor FROM billing_prices WHERE sku=? AND superseded_at IS NULL').bind(priceInput.sku).first();
  assert.equal(row.version,2);assert.equal(row.price_minor,25000000);assert.equal(await count(db,'audit_events'),1);
});
test('stale payment sweep queues once without guessing expiry or changing verified attempts',async()=>{
  const db=await fixture(),o=await order(db),{attempt}=await reserve(db,o);
  await db.exec("UPDATE payment_attempts SET created_at='2000-01-01 00:00:00'");
  await maintenance.queueStalePaymentStatement(db).run();await maintenance.queueStalePaymentStatement(db).run();
  assert.equal(await count(db,'billing_review_cases'),1);assert.equal((await db.prepare('SELECT state FROM payment_attempts').first()).state,'redirected');
  await verify(db,o,attempt);await db.exec('DELETE FROM billing_review_cases');await maintenance.queueStalePaymentStatement(db).run();assert.equal(await count(db,'billing_review_cases'),0);
});
test('outbox future schedule is not dispatched and delivered retries remain refused',async()=>{
  const db=await fixture();await enqueue(db);await db.exec("UPDATE notification_outbox SET next_attempt_at='2999-01-01T00:00:00Z'");
  let calls=0;const result=await outbox.drainOutbox(db,{now:testNow,send:async()=>{calls++;return {accepted:true}}});assert.equal(calls,0);assert.equal(result.claimed,0);
  await db.exec("UPDATE users SET role='admin' WHERE id='buyer';UPDATE notification_outbox SET status='delivered'");
  await db.batch(notificationCommands.retryNotificationStatements(db,{id:1,actorUserId:'buyer',operationId:crypto.randomUUID()}));assert.equal(await count(db,'audit_events'),0);
  assert.equal((await db.prepare('SELECT status FROM notification_outbox').first()).status,'delivered');
});
test('unsubscribed nonessential notifications suppress but essential security messages bypass',async()=>{
  const db=await fixture();await enqueue(db);await db.exec("INSERT INTO notification_preferences(user_id,unsubscribed_purposes) VALUES('buyer','service_request_notice')");
  let calls=0;await outbox.drainOutbox(db,{now:testNow,send:async()=>{calls++;return {accepted:true}}});assert.equal(calls,0);
  assert.equal((await db.prepare('SELECT status FROM notification_outbox').first()).status,'suppressed');
});
const gateway=require('../src/commerce/payments/zarinpal.ts');
test('Zarinpal redirect uses documented pg path and explicit IRR request currency',()=>{
  assert.equal(gateway.zarinpalStartPayUrl({merchantId:'test'},'A000000001'),'https://payment.zarinpal.com/pg/StartPay/A000000001');
  assert.equal(gateway.zarinpalStartPayUrl({merchantId:'test',baseUrl:'https://sandbox.zarinpal.com'},'S000000001'),'https://sandbox.zarinpal.com/pg/StartPay/S000000001');
  const body=JSON.parse(gateway.buildZarinpalRequestInit({merchantId:'test'},19000000,'Test','https://example.invalid/callback').init.body);
  assert.equal(body.currency,'IRR');assert.equal(body.amount,19000000);
});
test('Zarinpal negative errors preserve amount mismatch versus unpaid versus unknown',()=>{
  const parse=(code)=>gateway.parseZarinpalVerification({errors:{code}},400);
  assert.equal(parse(-50).failure,'amount_mismatch');assert.equal(parse(-51).failure,'not_paid');assert.equal(parse(-52).failure,'provider_rejected');
  assert.equal(parse(-53).failure,'configuration');assert.equal(parse(-54).failure,'authority_not_found');
  assert.equal(parse(53).failure,'provider_rejected');assert.equal(parse(-999).failure,'provider_rejected');
});
test('Zarinpal 100 and 101 require an exact nonempty provider reference',()=>{
  assert.equal(gateway.parseZarinpalVerification({data:{code:100,ref_id:201}}).ok,true);
  assert.equal(gateway.parseZarinpalVerification({data:{code:101,ref_id:'201'}}).alreadyVerified,true);
  assert.equal(gateway.parseZarinpalVerification({data:{code:100}}).ok,false);
  assert.equal(gateway.parseZarinpalVerification({data:{code:100,ref_id:9007199254740992}}).ok,false);
  assert.equal(gateway.parseZarinpalVerification({data:{code:100,ref_id:201}},500).ok,false);
});

test('malformed gateway verification envelopes cannot be successful',()=>{
  for (const value of [null,undefined,[],{}, {data:{code:100,ref_id:""}}, {errors:{code:-999}}]) {
    assert.equal(gateway.parseZarinpalVerification(value).ok,false);
  }
});
test('supported deployment paths reject unattended production repair',()=>{
  const repair=fs.readFileSync(path.join(__dirname,'../.github/workflows/deploy-self-heal.yml'),'utf8');
  assert.ok(!repair.includes('schedule:'));assert.ok(!repair.includes('wrangler d1'));assert.ok(repair.includes('exit 1'));
  const powershell=fs.readFileSync(path.join(__dirname,'../scripts/deploy-cloudflare.ps1'),'utf8');
  assert.ok(powershell.indexOf('node tools/require-r95-release-approval.mjs')<powershell.indexOf('function Get-Wrangler'));
  assert.ok(powershell.includes('Bulk production replacement is disabled'));
});

function actualMicrochipImportSql(){
  const ts=require('./lib/register-typescript.cjs');
  const filename=path.join(__dirname,'../src/api/modules/imports.ts');
  const source=ts.createSourceFile(filename,fs.readFileSync(filename,'utf8'),ts.ScriptTarget.Latest,true);
  let found;
  function walk(n){
    if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='prepare'){
      const a=n.arguments[0];
      if(a&&(ts.isNoSubstitutionTemplateLiteral(a)||ts.isStringLiteral(a))&&a.text.includes("SELECT 'microchip_no','microchip'"))found=a.text;
    }
    ts.forEachChild(n,walk);
  }
  walk(source);assert.ok(found,'actual production microchip SQL must exist');return found;
}
test('actual import microchip statement preserves raw digits and canonical identity',async()=>{
  const db=await fixture(),sql=actualMicrochipImportSql();
  await db.exec("INSERT INTO horses(name_latin,last_mutation_id) VALUES('Import Horse','import:test:1')");
  // R113 keeps source provenance before the operation marker in the SELECT.
  // Exercise the real statement with its current parameter order.
  await db.prepare(sql).bind('00123','\u06f0\u06f0\u06f1\u06f2\u06f3','7','import:test:1','00123','00123').run();
  const row=await db.prepare('SELECT normalized_value,raw_value,horse_id,source_id FROM horse_identifiers').first();
  assert.equal(row.normalized_value,'00123');assert.equal(row.raw_value,'\u06f0\u06f0\u06f1\u06f2\u06f3');assert.equal(row.source_id,'7');assert.ok(row.horse_id);
  await db.prepare(sql).bind('','','7','import:test:1',null,null).run();assert.equal(await count(db,'horse_identifiers'),1);
});
test('microchip collision rolls back newly created horse in actual import batch',async()=>{
  const db=await fixture(),sql=actualMicrochipImportSql();
  await db.exec("INSERT INTO horses(name_latin,last_mutation_id) VALUES('Existing','import:test:existing')");
  await db.prepare(sql).bind('00123','00123','7','import:test:existing','00123','00123').run();
  await assert.rejects(db.batch([
    db.prepare("INSERT INTO horses(name_latin,last_mutation_id) VALUES('Candidate','import:test:collision')"),
    db.prepare(sql).bind('00123','00123','7','import:test:collision','00123','00123'),
  ]),/UNIQUE/);
  assert.equal(await count(db,'horses'),1);assert.equal(await count(db,'horse_identifiers'),1);
});
test('PostgreSQL execution parity requires disposable local acknowledgement',()=>{
  const script=fs.readFileSync(path.join(__dirname,'../scripts/pg-execution-parity.mjs'),'utf8');
  assert.ok(script.includes('requireDisposableLocalDatabase(connectionString, process.env.PG_PARITY_DISPOSABLE)'));
});

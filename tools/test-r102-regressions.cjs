/* R102 offline tests. Real domain functions and migrated SQLite; no live-provider claim. */
const ts=require('./lib/register-typescript.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const routes=require('../src/frontend-kit/routes.ts');
const nav=require('../src/frontend-kit/navigation.ts');
const calendar=require('../src/frontend-kit/domain/workspaceCalendar.ts');
const {parseDatabaseProviderMode}=require('../src/db/providerMode.ts');
const {declineStaffInviteStatements}=require('../src/workspaces/collaboration.ts');
const fx=require('../tests/helpers/realDatabase.ts');
const task=(overrides={})=>({id:1,title:'Synthetic reminder',category:'other',due_date:'2026-10-06',due_timezone:'UTC',status:'open',...overrides});
const build=(tasks=[],now='2026-10-06T22:00:00Z',horizon=7)=>calendar.buildWorkspaceCalendar(tasks,2026,10,now,horizon);
// Extract pure production functions, not reimplementations, without loading UI/DB drivers.
function pureFunction(file,name,context={}) {
 const source=fs.readFileSync(path.join(__dirname,'..',file),'utf8');
 const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const node=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
 assert.ok(node,`Function ${name} exists`);
 const code=ts.transpileModule(node.getText(ast),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 return vm.runInNewContext(`${code}; ${name}`,{...context,exports:{},Number,URL,Request});
}
test('R102 unconfigured environment defaults to canonical Supabase',()=>assert.equal(parseDatabaseProviderMode(undefined),'supabase_full'));
for(const value of ['d1_only','turso_only','supabase_full','supabase_with_d1_read_failover','supabase_with_turso_read_failover','supabase_read_with_d1_write'])
 test(`R102 explicit database posture ${value} preserved`,()=>assert.equal(parseDatabaseProviderMode(value),value));
for(const value of ['', 'auto', 'supabase_full_or_anything', 'invalid'])test(`R102 invalid DB configuration fails closed: ${JSON.stringify(value)}`,()=>assert.throws(()=>parseDatabaseProviderMode(value),e=>e.code==='invalid_database_provider_mode'));
test('R102 full Supabase selection overrides legacy auth and AI bindings',()=>{
 const clone=pureFunction('src/db/provider.ts','cloneEnvWithDb');const db={name:'canonical'},old={name:'old-d1'};
 const selected=clone({DB:old,AUTH_DB:old,AI_DB:old},db,{configuredMode:'supabase_full'});
 assert.equal(selected.DB,db);assert.equal(selected.AUTH_DB,db);assert.equal(selected.AI_DB,db);
});
test('R102 legacy read selection preserves original private authority',()=>{
 const clone=pureFunction('src/db/provider.ts','cloneEnvWithDb');const old={name:'canonical'},replica={name:'snapshot'};
 const selected=clone({DB:old},replica,{configuredMode:'supabase_read_with_d1_write'});
 assert.equal(selected.DB,replica);assert.equal(selected.AUTH_DB,old);assert.equal(selected.AI_DB,old);
});
for(const kind of ['horse','person'])for(const id of ['0','9007199254740992','999999999999999999999999999','-1','NaN'])
 test(`R102 rejects ${kind} route ID ${id}`,()=>assert.equal(routes.parseHorseDbRoute(`/${kind}/${id}`).kind,'unknown'));
test('R102 maximum safe ID and query suffix are preserved',()=>assert.deepEqual(routes.parseHorseDbRoute('/horse/9007199254740991?q=x'),{kind:'horse',id:Number.MAX_SAFE_INTEGER}));
test('R102 malformed percent escapes never throw',()=>{assert.equal(routes.safeDecodeRouteSegment('%E0%A4%A'),null);assert.equal(routes.safeDecodeRouteSegment('horse%20news'),'horse news');});
for(const frontend of ['fei-classic','equidata-elite']){
 const local=pureFunction(`src/web/frontends/${frontend}/entry.tsx`,'localRoute',routes);
 for(const route of ['/directory-profile-garbage','/organization-profile/0','/directory-profile/9007199254740992','/pedigree/0'])test(`R102 ${frontend} rejects malformed local route ${route}`,()=>assert.equal(local(route).kind,'unknown'));
 test(`R102 ${frontend} supports root and valid edit route`,()=>{assert.equal(local('/').kind,'home');assert.equal(local('/directory-profile/12').kind,'directory-profile');});
 if(frontend==='fei-classic')test('R102 FEI invalid content encoding becomes a not-found route',()=>assert.equal(local('/content/%E0%A4%A').kind,'unknown'));
}
for(const id of ['heritage','equidata-elite','fei-classic','retro-astra','classic-registry']){
 test(`R102 ${id} hierarchy has distinct links with only the documented R117 market alias`,()=>{
  const links=nav.navigationGroups(id,'/','fa').flatMap(g=>g.links);
  assert.ok(links.length>=10);assert.equal(new Set(links.map(x=>x.id)).size,links.length);
  // R117-15 deliberately places the signed-in desk ON the market page in
  // React frontends. Classic retains a separate native market-desk route.
  // No other duplicate destination is allowed, including a duplicate demo.
  const destinations=new Map();for(const link of links)destinations.set(link.href,[...(destinations.get(link.href)||[]),link.id]);
  const aliases=[...destinations.values()].filter(ids=>ids.length>1).map(ids=>ids.slice().sort());
  assert.deepEqual(aliases,id==='classic-registry'?[]:[['market','market-desk']]);
  const market=links.find(x=>x.id==='market'),desk=links.find(x=>x.id==='market-desk');assert.ok(market);assert.ok(desk);
  const marketPath={heritage:'/market','equidata-elite':'/f/equidata-elite/market','fei-classic':'/f/fei-classic/market','retro-astra':'#/collections/market','classic-registry':'#/market'}[id];
  assert.equal(market.href,marketPath);assert.equal(desk.href,id==='classic-registry'?'/f/classic-registry/market-desk':marketPath);
  assert.deepEqual(nav.navigationGroups(id,marketPath,'fa').flatMap(g=>g.links).filter(x=>x.active).map(x=>x.id),['market']);
  assert.ok(links.every(x=>x.label.fa&&x.label.en));
 });
 test(`R102 ${id} keeps an explicitly labelled external synthetic demo in each language`,()=>{
  for(const locale of ['en','fa']){
   const demos=nav.navigationGroups(id,'/',locale).flatMap(g=>g.links).filter(x=>x.id==='demo');
   assert.equal(demos.length,1);const demo=demos[0];
   assert.equal(demo.href,`/demo-workbench/?lang=${locale}`);assert.equal(demo.external,true);assert.equal(demo.active,false);
   assert.equal(demo.label.en,'Synthetic capability demo');assert.ok(demo.label.fa);
  }
 });
}
test('R102 navigation preferences are isolated for each frontend',()=>{assert.equal(new Set(['heritage','equidata-elite','fei-classic','retro-astra','classic-registry'].map(nav.navigationStorageKey)).size,5);assert.equal(nav.parseNavigationLayout('bad'),'tabs');});
test('R102 local root and entity routes have a single active link',()=>{
 for(const route of ['/f/fei-classic','/horse/12','/person/12'])assert.equal(nav.navigationGroups('fei-classic',route).flatMap(g=>g.links).filter(x=>x.active).length,1);
});
test('R102 search preserves input model and includes translated labels',()=>{const groups=nav.navigationGroups('heritage','/');const original=JSON.stringify(groups);assert.equal(nav.filterNavigation(groups,'workspaces').flatMap(g=>g.links).length,1);assert.equal(nav.filterNavigation(groups,'does-not-exist').length,0);assert.equal(JSON.stringify(groups),original);});
test('R102 modified navigation clicks retain browser behavior',()=>{const event={button:0,metaKey:false,ctrlKey:false,shiftKey:false,altKey:false,defaultPrevented:false};assert.equal(nav.isPlainNavigationClick(event),true);for(const key of ['metaKey','ctrlKey','shiftKey','altKey','defaultPrevented'])assert.equal(nav.isPlainNavigationClick({...event,[key]:true}),false);assert.equal(nav.isPlainNavigationClick({...event,button:1}),false);});
test('R102 calendar labels do not depend on negative server timezone',()=>{
 const before=process.env.TZ;try{process.env.TZ='America/Los_Angeles';assert.equal(build().monthLabel,'October 2026');}finally{if(before===undefined)delete process.env.TZ;else process.env.TZ=before;}
});
test('R102 each task uses its actual timezone at the date boundary',()=>{const m=build([task({due_timezone:'Asia/Tehran'}),task({id:2,due_timezone:'Europe/London'})]);assert.equal(m.list.find(t=>t.id===1).overdue,true);assert.equal(m.list.find(t=>t.id===2).dueToday,true);});
for(const due_date of ['2026-02-30','2026-10-06garbage','2026-10-06T00:00:00Z'])test(`R102 rejects noncanonical date ${due_date}`,()=>assert.equal(build([task({due_date})]).counts.invalid,1));
for(const due_timezone of [undefined,'','Mars/Base'])test(`R102 does not invent missing/invalid timezone ${due_timezone}`,()=>{const m=build([task({due_timezone})]);assert.equal(m.counts.invalid,1);assert.equal(m.counts.overdue,0);assert.equal(m.counts.dueSoon,0);});
for(const now of ['invalid','2026-10-06T12:00:00'])test(`R102 invalid or ambiguous reference instant ${now} is rejected`,()=>assert.throws(()=>build([],now),RangeError));
for(const n of [-1,NaN,Infinity,0.5,367])test(`R102 invalid reminder horizon ${n} is rejected`,()=>assert.throws(()=>build([],undefined,n),RangeError));
test('R102 leap-year grid and closed reminders stay coherent',()=>{const m=calendar.buildWorkspaceCalendar([task({due_date:'2028-02-29'}),task({id:2,status:'done'})],2028,2,'2028-02-20T12:00:00Z',10);assert.equal(m.days.filter(d=>d.inMonth).length,29);assert.equal(m.days.length%7,0);assert.equal(m.counts.total,1);assert.equal(m.counts.dueSoon,1);});
async function inviteFixture(){
 const db=await fx.openRealDatabase();await fx.seedUser(db,'owner');await fx.seedUser(db,'invitee');
 await db.exec("INSERT INTO workspace_collections(id,name,owner_user_id) VALUES(1,'Synthetic stable','owner'); INSERT INTO workspace_staff_invites(collection_id,invitee_user_id,invited_by_user_id,proposed_actions,expires_at) VALUES(1,'invitee','owner','[]','2099-01-01 00:00:00')");return db;
}
const command=(db,operationId='r102-op')=>declineStaffInviteStatements(db,{collectionId:1,inviteeUserId:'invitee',actorUserId:'invitee',operationId});
test('R102 invitation decline executes real migrated SQL with matching bindings',async()=>{const db=await inviteFixture();await db.batch(command(db));assert.equal((await db.prepare('SELECT status FROM workspace_staff_invites').first()).status,'declined');assert.equal(await fx.countRows(db,'audit_events'),1);});
test('R102 declined invite replay, same or fresh operation, produces no duplicate audit',async()=>{const db=await inviteFixture();await db.batch(command(db));await db.batch(command(db));await db.batch(command(db,'different-op'));assert.equal(await fx.countRows(db,'audit_events'),1);});
test('R102 nonpending invitation is not mutated or audited',async()=>{const db=await inviteFixture();await db.exec("UPDATE workspace_staff_invites SET status='revoked'");await db.batch(command(db));assert.equal(await fx.countRows(db,'audit_events'),0);assert.equal((await db.prepare('SELECT status FROM workspace_staff_invites').first()).status,'revoked');});
test('R102 a different principal cannot decline another user invitation',async()=>{const db=await inviteFixture();assert.throws(()=>declineStaffInviteStatements(db,{collectionId:1,inviteeUserId:'invitee',actorUserId:'owner',operationId:'forged'}),e=>e.status===403);assert.equal(await fx.countRows(db,'audit_events'),0);});
test('R102 synthetic task commands reject duplicate IDs',async()=>{const m=await import('../src/demo/workbench/model.mjs');const state=m.newState();const data={horses:[{id:17}]};assert.throws(()=>m.addTask(state,{title:'Synthetic test',due:'2026-10-06',horseId:17},data,'demo-task-1'),/Duplicate/);assert.equal(m.addTask(state,{title:'Synthetic test',due:'2026-10-06',horseId:17},data,'new-task').tasks.length,4);});

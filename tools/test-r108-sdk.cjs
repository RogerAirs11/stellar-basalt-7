'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const {load}=require('./lib/r104-isolated-module.cjs');
const {createPlatformClient}=load('src/frontend-kit/platformClient.ts');
const cases=[
 ['inviteStaff',[8,{invitee_user_id:'staff-8',actions:'view,tasks_manage'}],'/api/workspaces/8/invites','POST',{invitee_user_id:'staff-8',actions:'view,tasks_manage'}],
 ['myInvites',[],'/api/workspaces/invites/mine','GET',undefined],
 ['respondInvite',[8,'accept'],'/api/workspaces/invites/8/respond','POST',{action:'accept'}],
 ['respondInvite',[8,'decline'],'/api/workspaces/invites/8/respond','POST',{action:'decline'}],
 ['revokeInvite',[8,'staff-8'],'/api/workspaces/8/invites/staff-8/revoke','POST',undefined],
 ['documents',[8,{includeArchived:true}],'/api/workspaces/8/documents?all=1','GET',undefined],
 ['createDocument',[8,{title:'Synthetic document',category:'registration',expires_at:'2027-01-01'}],'/api/workspaces/8/documents','POST',{title:'Synthetic document',category:'registration',expires_at:'2027-01-01'}],
 ['updateDocument',[8,9,{title:'Revised document',category:'other'}],'/api/workspaces/8/documents/9','PATCH',{title:'Revised document',category:'other',expected_version:3}],
 ['archiveDocument',[8,9],'/api/workspaces/8/documents/9/archive','POST',undefined],
 ['reassignTask',[8,10,'staff-8'],'/api/workspaces/8/tasks/10/reassign','POST',{assigned_to_user_id:'staff-8',expected_version:3}],
 ['reassignTask',[8,10,null],'/api/workspaces/8/tasks/10/reassign','POST',{assigned_to_user_id:null,expected_version:3}],
 ['importTasks',[8,[{title:'Synthetic reminder',category:'other',due_date:'2027-01-01'}]],'/api/workspaces/8/tasks/import','POST',{tasks:[{title:'Synthetic reminder',category:'other',due_date:'2027-01-01'}]}],
 ['completeTask',[8,10],'/api/workspaces/8/tasks/10/complete','POST',{expected_version:3}],
];
for(const [name,args,url,method,body] of cases) test(`R108 SDK: ${name} ${url} uses the canonical route, CSRF, signal and version`,async()=>{
 let actual;const controller=new AbortController();const fixture={fixture:true};const client=createPlatformClient({csrfToken:()=> 'synthetic-csrf',transport:async(u,init)=>{actual={u,init};return fixture}});
 const response=await client.modules.workspaces[name](...args,{signal:controller.signal,expectedVersion:3});assert.equal(response,fixture);
 assert.equal(actual.u,url);assert.equal(actual.init.method??'GET',method);assert.equal(actual.init.signal,controller.signal);
 assert.deepEqual(actual.init.body===undefined?undefined:JSON.parse(actual.init.body),body);
 if(method!=='GET')assert.equal(actual.init.headers['x-csrf-token'],'synthetic-csrf');
});
for(const version of [undefined,0,-1,1.5,Number.MAX_SAFE_INTEGER+1,NaN]) test(`R108 SDK: unsafe version ${version} cannot emit a workspace mutation`,async()=>{
 let calls=0;const client=createPlatformClient({transport:async()=>{calls++;return {}}});
 for(const [name,args] of [['completeTask',[1,2]],['reassignTask',[1,2,null]],['updateDocument',[1,2,{title:'x',category:'other'}]]]) {
  await assert.rejects(async()=>client.modules.workspaces[name](...args,{expectedVersion:version}),e=>e.code==='invalid_version');
 }
 assert.equal(calls,0);
});
for(const id of ['../secret','A/B','a?b','x','x%2Fz',' staff-8 ']) test(`R108 SDK: private account path rejects ${id}`,async()=>{
 let calls=0;const client=createPlatformClient({transport:async()=>{calls++;return {}}});
 await assert.rejects(async()=>client.modules.workspaces.revokeInvite(1,id),e=>e.code==='invalid_user_id');assert.equal(calls,0);
});
test('R108 SDK: invalid import count and invitation decisions never send',async()=>{
 let calls=0;const client=createPlatformClient({transport:async()=>{calls++;return {}}});
 for(const tasks of [[],Array(201).fill({})])await assert.rejects(async()=>client.modules.workspaces.importTasks(1,tasks),e=>e.code==='invalid_import');
 await assert.rejects(async()=>client.modules.workspaces.respondInvite(1,'approve'),e=>e.code==='invalid_response');assert.equal(calls,0);
});

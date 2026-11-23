import { describe,expect,it } from 'vitest';
import worker from '../../src/worker';
import { openRealDatabase,seedUser,makeSession,authedRequest,type AuthedSession } from '../helpers/realDatabase';
import type { D1Database } from '@cloudflare/workers-types';

const limiter={limit:async()=>({success:true})};
async function call(db:D1Database,path:string,body?:unknown,session?:AuthedSession,method?:string) {
  const response=await (worker as unknown as {fetch(r:Request,e:unknown):Promise<Response>}).fetch(authedRequest(path,body,{session,method}),{
    APP_ENV:'production',DB_PROVIDER_MODE:'d1_only',DB:db,SESSION_COOKIE_NAME:'hr_session',ASSETS:{fetch:async()=>new Response('unused')},
    PUBLIC_RATE_LIMITER:limiter,AUTH_RATE_LIMITER:limiter,EXPENSIVE_RATE_LIMITER:limiter,WRITE_RATE_LIMITER:limiter,ACCOUNT_RATE_LIMITER:limiter,
  });
  return {status:response.status,body:await response.json() as any};
}
async function setup() {
  const db=await openRealDatabase();
  await seedUser(db,'metadata-admin','admin');await seedUser(db,'metadata-editor','editor');
  await db.prepare("INSERT INTO horses(id,name_latin,is_active) VALUES(1,'Visible synthetic horse',1),(2,'Withheld synthetic horse',0)").run();
  return {db,admin:await makeSession(db,'metadata-admin'),editor:await makeSession(db,'metadata-editor')};
}
const definition={type:'select',label:{en:'Training discipline',fa:'رشته آموزشی'},visibility:'public',filter_enabled:true,options:[{value:'dressage',label:{en:'Dressage'}},{value:'jumping',label:{en:'Jumping'}}]};
const command=()=>({operation_id:crypto.randomUUID(),reason:'Synthetic integration review'});
async function field(db:D1Database,admin:AuthedSession,key='extra_discipline',def=definition) {
  const created=await call(db,'/api/admin/metadata/fields',{...command(),key,definition:def},admin);
  expect(created.status,JSON.stringify(created.body)).toBe(201);
  const activated=await call(db,`/api/admin/metadata/fields/${key}/activate`,{...command(),expected_revision:1,version:1},admin);
  expect(activated.status,JSON.stringify(activated.body)).toBe(200);
}
const value=()=>({...command(),expected_version:0,definition_version:1,value:'dressage',source_ref:'synthetic-reviewed-source'});

describe('R147 versioned supplementary metadata through actual HTTP/database',()=>{
  it('restricts administration and rejects executable, core and unsafe filter definitions',async()=>{
    const {db,admin,editor}=await setup();
    expect((await call(db,'/api/admin/metadata/fields',undefined,editor)).status).toBe(403);
    expect((await call(db,'/api/admin/metadata/fields')).status).toBe(401);
    for(const input of [
      {...command(),key:'father_id',definition},
      {...command(),key:'extra_valid',definition:{...definition,sql:'DROP TABLE horses'}},
      {...command(),key:'extra_valid',definition:{...definition,visibility:'staff'}},
      {...command(),key:'extra_valid',definition:{type:'text',label:{en:'Text'},visibility:'public',filter_enabled:true,max_length:200}},
    ]) expect((await call(db,'/api/admin/metadata/fields',input,admin)).status).toBe(422);
    expect(await db.prepare('SELECT COUNT(*) n FROM registry_metadata_fields').first()).toMatchObject({n:0});
  });
  it('keeps drafts and staff-only fields out of public catalogs, values and facets',async()=>{
    const {db,admin}=await setup();
    await field(db,admin);
    await field(db,admin,'extra_private',{...definition,visibility:'staff',filter_enabled:false});
    await call(db,'/api/admin/metadata/fields',{...command(),key:'extra_draft',definition},admin);
    await call(db,'/api/admin/horses/1/supplementary/extra_discipline',value(),admin,'PUT');
    await call(db,'/api/admin/horses/1/supplementary/extra_private',value(),admin,'PUT');
    const catalog=await call(db,'/api/registry/metadata');
    expect(catalog.body.fields.map((f:any)=>f.key)).toEqual(['extra_discipline']);
    const publicValues=await call(db,'/api/horses/1/supplementary');
    expect(publicValues.body.values.map((f:any)=>f.field_key)).toEqual(['extra_discipline']);
    expect(JSON.stringify(publicValues.body)).not.toContain('synthetic-reviewed-source');
    expect((await call(db,'/api/registry/metadata/extra_private/filter?value=dressage')).status).toBe(404);
    const privateValues=await call(db,'/api/admin/horses/1/supplementary',undefined,admin);
    expect(privateValues.body.values).toHaveLength(2);
  });
  it('replays the complete command and refuses payload or scope reuse without duplicate audit',async()=>{
    const {db,admin}=await setup();
    const input={...command(),key:'extra_discipline',definition};
    const first=await call(db,'/api/admin/metadata/fields',input,admin);
    expect((await call(db,'/api/admin/metadata/fields',input,admin)).body).toEqual(first.body);
    expect((await call(db,'/api/admin/metadata/fields',{...input,definition:{...definition,label:{en:'Changed'}}},admin)).status).toBe(409);
    expect((await call(db,'/api/admin/metadata/fields',{...input,key:'extra_other'},admin)).status).toBe(409);
    expect(await db.prepare('SELECT COUNT(*) n FROM registry_metadata_history').first()).toMatchObject({n:1});
    expect(await db.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='metadata.create_field'").first()).toMatchObject({n:1});
  });
  it('preserves old definition decoding and blocks incompatible type or privacy changes',async()=>{
    const {db,admin}=await setup();await field(db,admin);
    expect((await call(db,'/api/admin/horses/1/supplementary/extra_discipline',value(),admin,'PUT')).status).toBe(200);
    const next={...definition,label:{en:'Updated training label'},options:[{value:'jumping',label:{en:'Jumping'}}]};
    expect((await call(db,'/api/admin/metadata/fields/extra_discipline/versions',{...command(),expected_revision:2,definition:next},admin)).status).toBe(201);
    expect((await call(db,'/api/admin/metadata/fields/extra_discipline/activate',{...command(),expected_revision:3,version:2},admin)).status).toBe(200);
    const prior=await call(db,'/api/horses/1/supplementary');
    expect(prior.body.values[0]).toMatchObject({definition_version:1,value:'dressage',definition:{label:{en:'Training discipline'}}});
    expect((await call(db,'/api/admin/horses/1/supplementary/extra_discipline',{...value(),expected_version:1,definition_version:2},admin,'PUT')).status).toBe(422);
    for(const incompatible of [{...next,visibility:'staff',filter_enabled:false},{type:'text',label:{en:'Wrong type'},visibility:'public',filter_enabled:false,max_length:100}]) {
      expect((await call(db,'/api/admin/metadata/fields/extra_discipline/versions',{...command(),expected_revision:4,definition:incompatible},admin)).status).toBe(422);
    }
  });
  it('uses optimistic versions for values and activation, retaining durable private value history',async()=>{
    const {db,admin}=await setup();await field(db,admin);
    const first=value();expect((await call(db,'/api/admin/horses/1/supplementary/extra_discipline',first,admin,'PUT')).status).toBe(200);
    expect((await call(db,'/api/admin/horses/1/supplementary/extra_discipline',first,admin,'PUT')).status).toBe(200);
    expect((await call(db,'/api/admin/horses/1/supplementary/extra_discipline',{...value(),value:'jumping'},admin,'PUT')).status).toBe(409);
    expect((await call(db,'/api/admin/horses/1/supplementary/extra_discipline',{...value(),expected_version:1,value:'jumping'},admin,'PUT')).status).toBe(200);
    expect((await call(db,'/api/admin/metadata/fields/extra_discipline/activate',{...command(),expected_revision:1,version:null},admin)).status).toBe(409);
    const history=await call(db,'/api/admin/horses/1/supplementary/history',undefined,admin);
    expect(history.body.history.map((h:any)=>h.snapshot.value).sort()).toEqual(['dressage','jumping']);
    expect((await call(db,'/api/admin/horses/1/supplementary/history')).status).toBe(401);
  });
  it('does not reinterpret an older option value through the labels of a new filter version',async()=>{
    const {db,admin}=await setup();await field(db,admin);await call(db,'/api/admin/horses/1/supplementary/extra_discipline',value(),admin,'PUT');
    const next={...definition,options:[{value:'dressage',label:{en:'New definition with a different scope'}}]};
    await call(db,'/api/admin/metadata/fields/extra_discipline/versions',{...command(),expected_revision:2,definition:next},admin);
    await call(db,'/api/admin/metadata/fields/extra_discipline/activate',{...command(),expected_revision:3,version:2},admin);
    expect((await call(db,'/api/registry/metadata/extra_discipline/filter?value=dressage')).body.horses).toEqual([]);
    expect((await call(db,'/api/horses/1/supplementary')).body.values[0]).toMatchObject({definition_version:1,value:'dressage'});
    await call(db,'/api/admin/horses/1/supplementary/extra_discipline',{...value(),expected_version:1,definition_version:2},admin,'PUT');
    expect((await call(db,'/api/registry/metadata/extra_discipline/filter?value=dressage')).body.horses.map((h:any)=>h.id)).toEqual([1]);
  });
  it('never exposes inactive or cleared subjects through indexed filters',async()=>{
    const {db,admin}=await setup();await field(db,admin);
    for(const id of [1,2]) expect((await call(db,`/api/admin/horses/${id}/supplementary/extra_discipline`,value(),admin,'PUT')).status).toBe(200);
    expect((await call(db,'/api/registry/metadata/extra_discipline/filter?value=dressage')).body.horses.map((h:any)=>h.id)).toEqual([1]);
    expect((await call(db,'/api/horses/2/supplementary')).status).toBe(404);
    expect((await call(db,'/api/admin/horses/1/supplementary/extra_discipline',{...value(),expected_version:1,value:null},admin,'PUT')).status).toBe(200);
    expect((await call(db,'/api/registry/metadata/extra_discipline/filter?value=dressage')).body.horses).toEqual([]);
  });
  it('withdraws a field immediately without deleting historical values and can reactivate a prior version',async()=>{
    const {db,admin}=await setup();await field(db,admin);await call(db,'/api/admin/horses/1/supplementary/extra_discipline',value(),admin,'PUT');
    expect((await call(db,'/api/admin/metadata/fields/extra_discipline/activate',{...command(),expected_revision:2,version:null},admin)).status).toBe(200);
    expect((await call(db,'/api/horses/1/supplementary')).body.values).toEqual([]);
    expect((await call(db,'/api/registry/metadata/extra_discipline/filter?value=dressage')).status).toBe(404);
    expect((await call(db,'/api/admin/metadata/fields/extra_discipline/activate',{...command(),expected_revision:3,version:1},admin)).status).toBe(200);
    expect((await call(db,'/api/horses/1/supplementary')).body.values).toHaveLength(1);
  });
  it('rechecks administrator authority inside the transaction and leaves no partial definition',async()=>{
    const {db,admin}=await setup();const batch=db.batch.bind(db);let injected=false;
    db.batch=(async statements=>{if(!injected){injected=true;await db.prepare("UPDATE users SET role='user' WHERE id='metadata-admin'").run();}return batch(statements);}) as typeof db.batch;
    const response=await call(db,'/api/admin/metadata/fields',{...command(),key:'extra_discipline',definition},admin);
    expect(response.status,JSON.stringify(response.body)).toBe(409);
    for(const table of ['registry_metadata_fields','registry_metadata_versions','registry_metadata_history','registry_metadata_operations']) expect(await db.prepare(`SELECT COUNT(*) n FROM ${table}`).first()).toMatchObject({n:0});
  });
  it('rolls back values, receipt and audit on a failure midway through the transaction',async()=>{
    const {db,admin}=await setup();await field(db,admin);
    const batch=db.batch.bind(db);db.batch=(async statements=>batch([...statements,db.prepare('INSERT INTO missing_test_table VALUES(1)')])) as typeof db.batch;
    expect((await call(db,'/api/admin/horses/1/supplementary/extra_discipline',value(),admin,'PUT')).status).toBe(500);
    expect(await db.prepare('SELECT COUNT(*) n FROM registry_metadata_values').first()).toMatchObject({n:0});
    expect(await db.prepare("SELECT COUNT(*) n FROM registry_metadata_operations WHERE command='save_value'").first()).toMatchObject({n:0});
    expect(await db.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='metadata.save_value'").first()).toMatchObject({n:0});
  });
});

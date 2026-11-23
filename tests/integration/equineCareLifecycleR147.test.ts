import {describe,it,expect} from 'vitest';
import type {D1Database,D1PreparedStatement} from '@cloudflare/workers-types';
import {openRealDatabase,seedUser,makeSession,authedRequest,type AuthedSession} from '../helpers/realDatabase';
import {routeEquineCare} from '../../src/api/modules/equineCare';
import {HttpError,error} from '../../src/api/http';

const command=()=>({operation_id:crypto.randomUUID(),reason:'Fictional typed lifecycle acceptance fixture'});
const clinical=(extra:Record<string,unknown>={})=>({...command(),event_type:'vaccination',occurred_on:'2024-01-02',title:'Fictional vaccination',findings:'Synthetic observation only',source_ref:'fictional-clinical-source',...extra});
const reproduction=(extra:Record<string,unknown>={})=>({...command(),sire_id:2,method:'natural_cover',covering_on:'2024-01-02',outcome_on:'2024-12-02',outcome:'foaled',offspring:[{outcome:'live'}],source_ref:'fictional-reproductive-source',...extra});
const material=(donor:number,kind='semen',collected_on='2019-01-01')=>({donor_horse_id:donor,material:kind,collected_on,evidence_ref:'fictional-source-document',justification:'Explicit stored material recovery and use documented by assigned professional'});
async function setup(){
  const db=await openRealDatabase();await seedUser(db,'lifecycle-vet','user');
  await db.prepare("INSERT INTO horses(id,name_latin,sex_desc) VALUES(1,'Fictional genetic dam','Mare'),(2,'Fictional historical sire','Gelding'),(3,'Fictional recipient','Mare')").run();
  for(const id of [1,2,3])await db.prepare("INSERT INTO professional_access_grants(id,horse_id,grantee_user_id,professional_kind,permissions,authority_ref,assignment_ref,basis,valid_from) VALUES(?,?,'lifecycle-vet','veterinarian','private_health_read,clinical_write,sample_submit','fictional-authority','fictional-assignment','admin_grant','2018-01-01T00:00:00Z')").bind(crypto.randomUUID(),id).run();
  return {db,session:await makeSession(db,'lifecycle-vet')};
}
async function call(db:D1Database,session:AuthedSession,path:string,input:unknown,method='POST'){
  const request=authedRequest(`/api/horses/1/care/${path}`,input,{session,method});
  try{return (await routeEquineCare(request,{DB:db,SESSION_COOKIE_NAME:'hr_session',APP_ENV:'test',EQUINE_CARE_MODE:'local_review'},new URL(request.url)))!;}
  catch(cause){if(cause instanceof HttpError)return error(cause.status,cause.code,cause.message,cause.details);throw cause;}
}
async function date(db:D1Database,id:number,kind:'birth'|'death',value:string,precision='day',calendar:string|null='gregorian'){
  await db.prepare(`UPDATE horses SET ${kind}_date_value=?,${kind}_date_precision=?,${kind}_date_calendar=?,row_version=row_version+1${kind==='death'?",is_dead=1,life_status='dead'":''} WHERE id=?`).bind(value,precision,calendar,id).run();
}

describe('Care typed lifecycle boundaries through real migrations, sessions and routes',()=>{
  it('rejects physical vaccination/treatment before birth or after known death without writing receipts',async()=>{
    const {db,session}=await setup();await date(db,1,'birth','2025-01-01');
    for(const event_type of ['vaccination','medication'])expect((await call(db,session,'clinical',clinical({event_type}))).status).toBe(422);
    await date(db,1,'birth','2010-01-01');await date(db,1,'death','2020-01-01');
    for(const event_type of ['vaccination','medication','examination','procedure'])expect((await call(db,session,'clinical',clinical({event_type}))).status).toBe(422);
    expect(await db.prepare('SELECT COUNT(*) n FROM equine_clinical_events').first()).toEqual({n:0});
    expect(await db.prepare('SELECT COUNT(*) n FROM equine_care_operations').first()).toEqual({n:0});
  });
  it('compares explicit Solar Hijri intervals without converting unknown calendars into guessed Gregorian dates',async()=>{
    const {db,session}=await setup();await date(db,1,'death','1399-01-01','day','solar_hijri');
    expect((await call(db,session,'clinical',clinical())).status).toBe(422);
    await date(db,1,'death','1399','year',null);
    expect((await call(db,session,'clinical',clinical())).status).toBe(201);
    await db.prepare('UPDATE horses SET death_date_value=NULL,death_date_precision=NULL,death_date_calendar=NULL WHERE id=1').run();
    await date(db,1,'birth','1403-01-01','day','solar_hijri');
    expect((await call(db,session,'clinical',clinical({occurred_on:'2023-01-02'}))).status).toBe(422);
  });
  it('preserves overlapping partial-date uncertainty but rejects a day outside the entire interval',async()=>{
    const {db,session}=await setup();await date(db,1,'death','2024','year');
    expect((await call(db,session,'clinical',clinical({occurred_on:'2024-06-01'}))).status).toBe(201);
    expect((await call(db,session,'clinical',clinical({occurred_on:'2025-01-01'}))).status).toBe(422);
    await date(db,1,'death','2024-02','month');
    expect((await call(db,session,'clinical',clinical({occurred_on:'2024-02-29'}))).status).toBe(201);
    expect((await call(db,session,'clinical',clinical({occurred_on:'2024-03-01'}))).status).toBe(422);
    await date(db,1,'birth','2024','year');
    expect((await call(db,session,'clinical',clinical())).status).toBe(201);
    expect((await call(db,session,'clinical',clinical({occurred_on:'2023-12-31'}))).status).toBe(422);
  });
  it('allows explicitly sourced postmortem diagnosis and tissue collection without permitting postmortem vaccination',async()=>{
    const {db,session}=await setup();await date(db,1,'death','2020-01-01');
    const lifecycle_context={kind:'postmortem',evidence_ref:'fictional-necropsy-record',justification:'Documented postmortem investigation by assigned professional'};
    expect((await call(db,session,'clinical',clinical({event_type:'diagnosis',lifecycle_context}))).status).toBe(201);
    expect((await call(db,session,'clinical',clinical({event_type:'diagnosis',occurred_on:'2019-01-01',lifecycle_context}))).status).toBe(422);
    expect((await call(db,session,'clinical',clinical({lifecycle_context}))).status).toBe(400);
    expect((await call(db,session,'clinical',clinical({event_type:'allergy',lifecycle_context:{...lifecycle_context,kind:'record_review'}}))).status).toBe(201);
    expect((await call(db,session,'samples',{...command(),sample_ref:'fictional-postmortem-tissue',specimen:'tissue',collected_on:'2024-01-02',identity_check:'document_checked',identity_evidence_ref:'fictional-necropsy-identity',source_ref:'fictional-necropsy-record'})).status).toBe(201);
  });
  it('leaves a contradictory historical entry voidable, preserving history',async()=>{
    const {db,session}=await setup(),input=clinical();const created=await call(db,session,'clinical',input);
    const {receipt}=await created.json() as {receipt:{id:string}};await date(db,1,'death','2020-01-01');
    const amendment={...input,...command(),expected_version:1,status:'recorded'};
    expect((await call(db,session,`clinical/${receipt.id}`,amendment,'PATCH')).status).toBe(422);
    expect((await call(db,session,`clinical/${receipt.id}`,{...amendment,...command(),status:'voided'},'PATCH')).status).toBe(200);
    expect(await db.prepare('SELECT COUNT(*) n FROM equine_care_history WHERE resource_id=?').bind(receipt.id).first()).toEqual({n:2});
  });
  it('rejects impossible dam/recipient events, including prebirth covering and postdeath foaling',async()=>{
    const {db,session}=await setup();await date(db,1,'death','2020-01-01');
    expect((await call(db,session,'reproduction',reproduction())).status).toBe(422);
    await db.prepare('UPDATE horses SET death_date_value=NULL,death_date_precision=NULL,death_date_calendar=NULL WHERE id=1').run();
    await date(db,1,'birth','2025-01-01');
    expect((await call(db,session,'reproduction',reproduction())).status).toBe(422);
    await date(db,1,'birth','2010-01-01');await date(db,3,'death','2020-01-01');
    expect((await call(db,session,'reproduction',reproduction({method:'embryo_transfer',recipient_dam_id:3,transfer_on:'2024-01-08',stored_material:[material(1,'embryo')]}))).status).toBe(422);
    expect(await db.prepare('SELECT COUNT(*) n FROM equine_reproductive_episodes').first()).toEqual({n:0});
  });
  it('allows documented stored semen for a deceased sire only under a compatible method and donor',async()=>{
    const {db,session}=await setup();await date(db,2,'death','2020-01-01');
    const input=reproduction({method:'artificial_insemination'});
    expect((await call(db,session,'reproduction',input)).status).toBe(422);
    expect((await call(db,session,'reproduction',{...input,...command(),stored_material:[material(2)]})).status).toBe(201);
    expect((await call(db,session,'reproduction',{...input,...command(),method:'natural_cover',stored_material:[material(2)]})).status).toBe(422);
    expect((await call(db,session,'reproduction',{...input,...command(),stored_material:[material(1)]})).status).toBe(422);
    expect((await call(db,session,'reproduction',{...input,...command(),stored_material:[material(2,'semen','2025-01-01')]})).status).toBe(422);
  });
  it('keeps unknown historical death timing uncertain but refuses future physical covering of a recorded deceased subject',async()=>{
    const {db,session}=await setup();await db.prepare("UPDATE horses SET is_dead=1,life_status='dead',row_version=row_version+1 WHERE id=1").run();
    expect((await call(db,session,'reproduction',reproduction())).status).toBe(201);
    const future=new Date(Date.now()+86400000*30).toISOString().slice(0,10);
    expect((await call(db,session,'reproduction',reproduction({covering_on:future,outcome_on:null,outcome:'planned',offspring:[]}))).status).toBe(422);
    await db.prepare("UPDATE horses SET is_dead=0,life_status='alive',row_version=row_version+1 WHERE id=1").run();
    await db.prepare("UPDATE horses SET is_dead=1,life_status='dead',row_version=row_version+1 WHERE id=2").run();
    expect((await call(db,session,'reproduction',reproduction({method:'artificial_insemination',covering_on:future,outcome_on:null,outcome:'planned',offspring:[],stored_material:[material(2)]}))).status).toBe(201);
  });
  it('supports stored embryo/oocyte history without exempting a gestational recipient from lifecycle checks',async()=>{
    const {db,session}=await setup();await date(db,1,'death','2020-05-01');
    const input=reproduction({method:'embryo_transfer',recipient_dam_id:3,covering_on:'2019-12-01',transfer_on:'2024-01-08'});
    expect((await call(db,session,'reproduction',input)).status).toBe(422);
    expect((await call(db,session,'reproduction',{...input,...command(),stored_material:[material(1,'embryo','2019-12-08')]})).status).toBe(201);
    expect((await call(db,session,'reproduction',reproduction({method:'icsi',recipient_dam_id:3,transfer_on:'2024-01-08',stored_material:[material(1,'oocyte')]}))).status).toBe(201);
    // Genetic dam died after transfer, before recipient foaling: no exception is needed.
    expect((await call(db,session,'reproduction',{...input,...command(),transfer_on:'2019-12-08',outcome_on:'2020-11-01'})).status).toBe(201);
  });
  it('binds clinical lifecycle validation to the post-lock horse version when canonical death changes after preflight',async()=>{
    const {db,session}=await setup();
    const raced={...db,prepare:db.prepare.bind(db),batch:async(statements:D1PreparedStatement[])=>{await date(db,1,'death','2020-01-01');return db.batch(statements);}} as D1Database;
    expect((await call(raced,session,'clinical',clinical())).status).toBe(409);
    expect(await db.prepare('SELECT COUNT(*) n FROM equine_clinical_events').first()).toEqual({n:0});
    expect(await db.prepare('SELECT COUNT(*) n FROM equine_care_operations').first()).toEqual({n:0});
  });
});

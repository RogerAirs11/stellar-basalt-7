import {describe,expect,it} from 'vitest';
import {openRealDatabase,seedUser,makeSession,authedRequest} from '../helpers/realDatabase';
import {buildHorseRegistryAiTools} from '../../src/ai/domain/horseRegistry/broker';
import {loadCanonicalHorseProfile} from '../../src/registry/profile';
import {competitionDetail,horseCompetitionHistory} from '../../src/api/modules/competitions';
import {duplicateCheck,registryCertificateSvg,verifyCertificateCode} from '../../src/api/modules/registryExtras';
import worker from '../../src/worker';

async function setup() {
  const db=await openRealDatabase();
  await db.exec(`INSERT INTO horses(id,name_latin,name_native,register_no,microchip_no,is_active,sex_desc) VALUES
    (15401,'Visible daughter','آزمایشی','VISIBLE-01','123',1,'Female'),
    (15402,'WITHHELD-FATHER','پدر خصوصی','WITHHELD-02','456',0,'Male'),
    (15403,'Visible mother','مادر','VISIBLE-03','789',1,'Female'),
    (15404,'WITHHELD-CHILD','خصوصی','WITHHELD-04','012',0,'Female');
    UPDATE horses SET father_id=15402,mother_id=15403 WHERE id=15401;
    INSERT INTO people(id,name_latin) VALUES(15401,'Synthetic person');
    INSERT INTO horse_people(horse_id,person_id,role,is_current) VALUES(15401,15401,'owner',1),(15402,15401,'owner',1),(15404,15401,'breeder',1);
    INSERT INTO competitions(id,name_native,discipline,event_date,venue,season,provenance) VALUES(15401,'Synthetic competition','dressage','2024-01-01','Synthetic venue',2024,'demo');
    INSERT INTO competition_results(id,competition_id,horse_id,placement,provenance) VALUES(15401,15401,15401,2,'demo'),(15402,15401,15402,1,'demo');
    INSERT INTO registry_certificates(id,horse_id,verification_code,payload_digest) VALUES('fixture-cert',15402,'WITHHELD-CODE','fixture');`);
  return db;
}
describe('R147 public secondary views cannot disclose withheld horse identities',()=>{
  it('masks private canonical parent pointers in the shared public/AI profile',async()=>{
    const db=await setup();expect(await loadCanonicalHorseProfile(db,15402)).toBeNull();
    const profile=await loadCanonicalHorseProfile(db,15401);
    expect(profile?.horse.father_id).toBeNull();expect(profile?.father).toBeNull();
    expect(profile?.mother?.id).toBe(15403);expect(JSON.stringify(profile)).not.toContain('WITHHELD');
  });
  it('filters competition rows and totals, rejects private history and excludes withdrawals from starts',async()=>{
    const db=await setup();
    const detail=await (await competitionDetail(db,15401)).json() as any;
    expect(detail.results.map((r:any)=>r.horse_id)).toEqual([15401]);expect(detail.results_page.total).toBe(1);
    expect(detail.competition.result_count).toBe(1);
    await db.exec('UPDATE horses SET is_active=0 WHERE id=15401');
    const withdrawn=await (await competitionDetail(db,15401)).json() as any;
    expect(withdrawn.results).toEqual([]);expect(withdrawn.competition.result_count).toBe(0);expect(withdrawn.results_page.total).toBe(0);
    await db.exec('UPDATE horses SET is_active=1 WHERE id=15401');
    await expect(horseCompetitionHistory(db,15402)).rejects.toMatchObject({status:404});
    await db.exec(`INSERT INTO competitions(id,name_native,discipline,event_date,venue,season,provenance) VALUES(15402,'Withdrawn fixture','dressage','2024-02-01','Synthetic venue',2024,'demo');
      INSERT INTO competition_results(competition_id,horse_id,placement,is_withdrawn,provenance) VALUES(15402,15401,1,1,'demo');`);
    const history=await (await horseCompetitionHistory(db,15401)).json() as any;
    expect(history.summary).toMatchObject({entries:2,starts:1,withdrawals:1,wins:0,podium:1});expect(history.history_page.total).toBe(2);
  });
  it('withholds private duplicate candidates, certificate previews and legacy verification',async()=>{
    const db=await setup();
    const duplicates=await (await duplicateCheck(db,new URL('https://registry.example/api/horses/duplicate-check?name=WITHHELD'))).json() as any;
    expect(duplicates.candidates).toEqual([]);
    await expect(duplicateCheck(db,new URL('https://registry.example/api/horses/duplicate-check?microchip=123'))).rejects.toMatchObject({status:403});
    await expect(registryCertificateSvg(db,15402,'en')).rejects.toMatchObject({status:404});
    const preview=await (await registryCertificateSvg(db,15401,'en')).text();expect(preview).not.toContain('WITHHELD');expect(preview).toContain('Visible mother');
    expect(await (await verifyCertificateCode(db,new URL('https://registry.example/api/certificate/verify?code=WITHHELD-CODE'))).json()).toMatchObject({valid:false});
  });
  it('requires current reviewer authentication for chip duplicate lookup while public names remain searchable',async()=>{
    const db=await setup();await seedUser(db,'secondary-owner','owner');await seedUser(db,'secondary-editor','editor');
    const owner=await makeSession(db,'secondary-owner'),editor=await makeSession(db,'secondary-editor');const limiter={limit:async()=>({success:true})};
    const env={APP_ENV:'production',DB_PROVIDER_MODE:'d1_only',DB:db,SESSION_COOKIE_NAME:'hr_session',ASSETS:{fetch:async()=>new Response('unused')},PUBLIC_RATE_LIMITER:limiter,AUTH_RATE_LIMITER:limiter,EXPENSIVE_RATE_LIMITER:limiter,WRITE_RATE_LIMITER:limiter,ACCOUNT_RATE_LIMITER:limiter};
    const fetch=(session?:typeof owner)=>(worker as unknown as {fetch(r:Request,e:unknown):Promise<Response>}).fetch(authedRequest('/api/horses/duplicate-check?microchip=123',undefined,{session}),env);
    expect((await fetch()).status).toBe(401);expect((await fetch(owner)).status).toBe(403);
    const response=await fetch(editor);expect(response.status).toBe(200);expect((await response.json() as any).candidates[0].horse.id).toBe(15401);
  });
  it('keeps AI profiles, browse, people and exact aggregate tools on public records',async()=>{
    const db=await setup(),tools=buildHorseRegistryAiTools(),context={registryDb:db,maxResultCharacters:200000};
    const result=await tools.execute('registry_research',{operations:[{op:'profile',horseId:15401},{op:'profile',horseId:15402},{op:'browse',limit:10},{op:'person',personId:15401},{op:'people_search',query:'Synthetic'}]},context);
    const rows=(result.output as any).results;
    expect(rows[0].horse.father_id).toBeNull();expect(rows[1].found).toBe(false);
    expect(rows[2].total).toBe(2);expect(rows[2].items.map((h:any)=>h.id)).toEqual([15401,15403]);
    expect(rows[3].person.horse_count).toBe(1);expect(rows[3].horses.map((h:any)=>h.id)).toEqual([15401]);
    expect(rows[4].items[0]).toMatchObject({horse_count:1,owner_count:1,breeder_count:0});
    expect(JSON.stringify(result)).not.toContain('WITHHELD');
    const analysis=await tools.execute('registry_analysis',{operations:[{op:'count'},{op:'count',filters:{lifecycle:'inactive'}},{op:'group_count',field:'sire'},{op:'group_count',field:'dam'},{op:'snapshot',section:'progeny'}]},context);
    const metrics=(analysis.output as any).results;
    expect(metrics[0].count).toBe(2);expect(metrics[1].count).toBe(0);expect(metrics[2].items).toEqual([]);expect(metrics[3].items[0].id).toBe(15403);
    expect(metrics[4]).toMatchObject({available:false,reason:'public_snapshot_rebuild_required'});expect(JSON.stringify(analysis)).not.toContain('15402');
  });
});

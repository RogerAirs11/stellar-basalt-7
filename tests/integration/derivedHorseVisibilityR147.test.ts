import { describe,it,expect } from 'vitest';
import { openRealDatabase } from '../helpers/realDatabase';
import { loadAncestorGraph,getPedigreeHorse,calculateDescendantReach } from '../../src/pedigree/engine';
import { loadAncestors,loadDescendants } from '../../src/pedigree/graph';
import { analyzeBreedingPairing,optimizeBreedingCandidates } from '../../src/pedigree/breeding';
import { validateParentAssignment } from '../../src/pedigree/integrity';
import { horseRacing,raceDetail,racesList } from '../../src/api/modules/racing';

describe('Public derived views enforce inactive subject boundaries in real SQL',()=>{
  it('does not reveal withheld roots, ancestors, reference IDs or descendants',async()=>{
    const db=await openRealDatabase();
    await db.exec(`INSERT INTO horses(id,name_latin,sex_desc,is_active) VALUES(14751,'Visible mare','Mare',1),(14752,'WITHHELD-ANCESTOR','Stallion',0),(14753,'Visible grandmother','Mare',1),(14754,'WITHHELD-OFFSPRING','Filly',0),(14755,'Visible sire','Stallion',1);UPDATE horses SET father_id=14752,mother_id=14753 WHERE id=14751;UPDATE horses SET mother_id=14751 WHERE id=14754`);
    expect(await getPedigreeHorse(db,14752)).toBeNull();expect(await loadAncestorGraph(db,14752,4)).toBeNull();
    const mare=await getPedigreeHorse(db,14751);expect(mare?.father_id).toBeNull();
    const graph=await loadAncestorGraph(db,14751,4);expect(graph?.horses.has(14752)).toBe(false);
    const tree=await loadAncestors(db,14751,4);expect(JSON.stringify(tree)).not.toContain('14752');expect(JSON.stringify(tree)).not.toContain('WITHHELD');
    expect((await loadDescendants(db,14752,4)).tree).toBeNull();
    const descendants=await loadDescendants(db,14753,4);expect(JSON.stringify(descendants)).not.toContain('WITHHELD');expect(JSON.stringify(descendants)).not.toContain('14752');
    expect((await calculateDescendantReach(db,14751))?.knownDescendants).toBe(0);
    expect(await analyzeBreedingPairing(db,14752,14751,4)).toBeNull();
    const optimizer=await optimizeBreedingCandidates(db,{fixedHorseId:14755,fixedRole:'sire',candidateIds:[14754,14751],depth:4});
    expect(optimizer.ranked).toHaveLength(0);expect(optimizer.excludedCandidates?.map(c=>c.candidateId)).toContain(14754);
    expect((await validateParentAssignment(db,null,14752,null)).valid).toBe(false);
  });
  it('counts only observed runners, exposes unknown status separately and withholds unavailable crosswalk rows',async()=>{
    const db=await openRealDatabase();
    await db.exec(`INSERT INTO horses(id,name_latin,is_active) VALUES(14761,'Visible runner',1),(14762,'WITHHELD-RUNNER',0);INSERT INTO racing_races(race_id,race_name,season,week_date) VALUES('race-147','Fictional race','fixture','2024-01-02');INSERT INTO racing_results(racehorse_id,race_id,registry_horse_id,horse_name,is_run,rank,week_date,season) VALUES('running','race-147','14761','Visible runner',1,2,'2024-01-02','fixture'),('nonrunner','race-147','14761','Visible runner',0,1,'2024-01-03','fixture'),('unknown','race-147','14761','Visible runner',NULL,1,'2024-01-04','fixture'),('withheld','race-147','14762','WITHHELD-RUNNER',1,1,'2024-01-02','fixture'),('source-only','race-147',NULL,'Unlinked source runner',1,3,'2024-01-02','fixture')`);
    const history=await (await horseRacing(db,14761)).json() as {summary:Record<string,unknown>;results:unknown[]};
    expect(history.summary).toMatchObject({entries:3,starts:1,non_runners:1,unknown_run_status:1,wins:0,second_places:1,first_race_date:'2024-01-02',last_race_date:'2024-01-02'});
    expect(history.results).toHaveLength(3);
    await expect(horseRacing(db,14762)).rejects.toMatchObject({status:404});
    const card=await (await raceDetail(db,'race-147')).json();expect(JSON.stringify(card)).not.toContain('WITHHELD');expect(JSON.stringify(card)).not.toContain('14762');
    const list=await (await racesList(db,new URL('https://example.test/api/racing/races'))).json() as {races:Record<string,unknown>[]};
    expect(list.races[0]).toMatchObject({entries_count:4,starters_count:2,decided_count:0});
  });
  it('retains historical sire parentage after castration and rejects impossible recorded sex roles',async()=>{
    const db=await openRealDatabase();
    await db.exec(`INSERT INTO horses(id,name_latin,sex_desc) VALUES(14771,'Historical sire','Gelding'),(14772,'Recorded dam','Female'),(14773,'Recorded male','Male')`);
    expect((await validateParentAssignment(db,null,14771,14772)).valid).toBe(true);
    expect((await validateParentAssignment(db,null,14772,14773)).issues.filter(x=>x.code==='parent_sex_role')).toHaveLength(2);
    expect((await validateParentAssignment(db,null,-1,14772)).valid).toBe(false);
  });
});

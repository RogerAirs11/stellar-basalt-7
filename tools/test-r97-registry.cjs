'use strict';
require('./lib/register-typescript.cjs');
const test=require('node:test');
const assert=require('node:assert/strict');
const fx=require('../tests/helpers/realDatabase.ts');
const {buildCanonicalHorseUpdateStatements}=require('../src/registry/mutationStatements.ts');
const identifiers=require('../src/registry/identifiers.ts');
const {typedDateChange}=require('../src/registry/typedDateValue.ts');
const {loadCanonicalHorseProfile}=require('../src/registry/profile.ts');
const interpretation=require('../src/pedigree/interpretation.ts');

async function fixture(){
 const db=await fx.openRealDatabase();
 await db.exec("INSERT INTO horses(id,name_latin,row_version) VALUES(1,'Original',1),(2,'Child',1); UPDATE horses SET father_id=1 WHERE id=2");
 return db;
}
function plan(changes,extra={}){
 return {normalizedChanges:changes,appliedFields:Object.keys(changes),parentageChanged:false,nextFather:null,nextMother:null,
  touchesName:'name_latin' in changes,touchesIdentifiers:false,effectiveIdentifierChanges:{},...extra};
}
async function update(db,changes,options={}){
 const params={plan:plan(changes),horseId:1,expectedRowVersion:1,mutationId:crypto.randomUUID(),identifierTableReady:true,...options};
 const x=buildCanonicalHorseUpdateStatements(db,params);
 const result=await db.batch([x.updateStatement,...x.afterUpdateStatements]);return{params,result};
}
test('canonical update binds its operation identity exactly once and updates the real row',async()=>{
 const db=await fixture();const{params}=await update(db,{name_latin:'Updated'});
 const h=await db.prepare('SELECT name_latin,row_version,last_mutation_id FROM horses WHERE id=1').first();
 assert.deepEqual({...h},{name_latin:'Updated',row_version:2,last_mutation_id:params.mutationId});
 assert.equal(await fx.countRows(db,'horse_search_reindex_queue'),2);
});
test('stale canonical update changes no horse, identifiers, revision, or search queue',async()=>{
 const db=await fixture();const before=await db.prepare('SELECT canonical_revision FROM registry_state').first();
 await update(db,{name_latin:'Stale'}, {expectedRowVersion:7});
 assert.equal((await db.prepare('SELECT name_latin FROM horses WHERE id=1').first()).name_latin,'Original');
 assert.deepEqual(await db.prepare('SELECT canonical_revision FROM registry_state').first(),before);
 assert.equal(await fx.countRows(db,'horse_search_reindex_queue'),0);
});
test('typed birth date persists its precision/calendar and bucket in the actual update',async()=>{
 const db=await fixture();await update(db,{birth_date:typedDateChange({value:'2020-05',precision:'month',calendar:'gregorian'},2020)});
 const h=await db.prepare('SELECT birth_date_value,birth_date_precision,birth_date_calendar,birth_year FROM horses WHERE id=1').first();
 assert.deepEqual({...h},{birth_date_value:'2020-05',birth_date_precision:'month',birth_date_calendar:'gregorian',birth_year:2020});
});
test('typed date clear stores nulls without inventing an exact date',async()=>{
 const db=await fixture();await update(db,{birth_date:typedDateChange(null,null)});
 assert.equal((await db.prepare('SELECT birth_date_value FROM horses WHERE id=1').first()).birth_date_value,null);
});
test('canonical update rejects a pedigree cycle in the same statement',async()=>{
 const db=await fixture();await update(db,{father_id:2},{plan:plan({father_id:2},{parentageChanged:true,nextFather:2})});
 assert.equal((await db.prepare('SELECT father_id,row_version FROM horses WHERE id=1').first()).father_id,null);
 assert.equal(await fx.countRows(db,'horse_search_reindex_queue'),0);
});
test('missing review claim prevents a canonical update and its secondary effects',async()=>{
 const db=await fixture();await update(db,{name_latin:'No review'},{viaChangeRequestId:'missing'});
 assert.equal((await db.prepare('SELECT name_latin FROM horses WHERE id=1').first()).name_latin,'Original');
 assert.equal(await fx.countRows(db,'horse_search_reindex_queue'),0);
});
async function atomicCreate(db,registration,op){
 return db.batch([
  db.prepare('INSERT INTO horses(name_latin,register_no,last_mutation_id) VALUES(?,?,?)').bind('Synthetic new horse',registration,op),
  ...identifiers.identifierStatementsForHorseCreate(db,{mutationId:op,changes:{register_no:registration},identifierTableReady:true}),
  db.prepare('UPDATE registry_state SET canonical_revision=canonical_revision+1 WHERE id=1'),
  db.prepare('UPDATE registry_runtime_counters SET active_horse_count=active_horse_count+1 WHERE id=1'),
 ]);
}
test('auto-ID creation attaches identifiers inside its actual transaction',async()=>{
 const db=await fixture();const op=crypto.randomUUID();await atomicCreate(db,'00123',op);
 const h=await db.prepare('SELECT id FROM horses WHERE last_mutation_id=?').bind(op).first();
 const i=await db.prepare('SELECT horse_id,normalized_value FROM horse_identifiers').first();
 assert.equal(i.horse_id,h.id);assert.equal(i.normalized_value,'00123');
});
test('duplicate auto-ID identity rolls back horse and counter changes together',async()=>{
 const db=await fixture();await atomicCreate(db,'00123',crypto.randomUUID());
 const before={horses:await fx.countRows(db,'horses'),rev:await db.prepare('SELECT * FROM registry_state').first(),counter:await db.prepare('SELECT * FROM registry_runtime_counters').first()};
 await assert.rejects(()=>atomicCreate(db,'00123',crypto.randomUUID()),identifiers.isDuplicateIdentifierError);
 assert.equal(await fx.countRows(db,'horses'),before.horses);
 assert.deepEqual(await db.prepare('SELECT * FROM registry_state').first(),before.rev);
 assert.deepEqual(await db.prepare('SELECT * FROM registry_runtime_counters').first(),before.counter);
});
test('duplicate updated identity rolls back canonical name and version too',async()=>{
 const db=await fixture();await atomicCreate(db,'TAKEN',crypto.randomUUID());
 const changes={name_latin:'Must roll back',register_no:'TAKEN'};
 await assert.rejects(()=>update(db,changes,{plan:plan(changes,{effectiveIdentifierChanges:{register_no:'TAKEN'}})}),identifiers.isDuplicateIdentifierError);
 assert.deepEqual({...await db.prepare('SELECT name_latin,row_version FROM horses WHERE id=1').first()},{name_latin:'Original',row_version:1});
 assert.equal(await fx.countRows(db,'horse_search_reindex_queue'),0);
});
test('missing integrity schema fails closed without poisoning another database',async()=>{
 const missing=await fixture(),healthy=await fixture();await missing.exec('DROP TABLE horse_identifiers');
 await assert.rejects(()=>identifiers.identifierTableReady(missing),e=>e.status===503);
 assert.equal(await identifiers.identifierTableReady(healthy),true);
 assert.throws(()=>identifiers.identifierStatementsForHorseChange(healthy,{horseId:1,mutationId:'m',source:'test',changes:{register_no:'123'},identifierTableReady:false}),e=>e.status===503);
});
test('an unrelated PostgreSQL uniqueness failure is not an identity conflict',()=>{
 assert.equal(identifiers.isDuplicateIdentifierError({code:'23505',constraint:'audit_events_pkey'}),false);
 assert.equal(identifiers.isDuplicateIdentifierError({code:'23505'}),false);
 assert.equal(identifiers.isDuplicateIdentifierError({cause:{code:'23505',constraint:'uq_horse_identifiers_live'}}),true);
});
test('public/AI profile masks archived and withheld parent identity while retaining canonical pointers',async()=>{
 for(const restriction of ['deleted_at=CURRENT_TIMESTAMP','is_active=0']){
  const db=await fixture();await db.exec(`UPDATE horses SET name_latin='Do not publish parent identity',${restriction} WHERE id=1;UPDATE horses SET precise_address='Private stable location' WHERE id=2`);
  const profile=await loadCanonicalHorseProfile(db,2);assert.equal(profile.father,null);assert.equal(profile.horse.father_id,null);
  assert.equal(await db.prepare('SELECT father_id FROM horses WHERE id=2').first('father_id'),1);
  const text=JSON.stringify(profile);assert.ok(!text.includes('Do not publish'));assert.ok(!text.includes('Private stable'));assert.ok(!('father_name' in profile.horse));
 }
});
test('public/AI profile preserves an active parent summary',async()=>{
 const profile=await loadCanonicalHorseProfile(await fixture(),2);assert.equal(profile.father.name_latin,'Original');assert.equal(profile.people_truncated,false);
});
test('invalid coefficient numbers never produce a favorable or medical-looking verdict',()=>{
 for(const value of [NaN,Infinity,-1,100.01])assert.equal(interpretation.classifyMatingBand(value,true),'unknown');
 assert.equal(interpretation.classifyMatingBand(0,true),'outcross');
});
test('omitted pedigree completeness cannot silently mean sufficient ancestry',()=>{
 const result=interpretation.buildBreedingMatingVerdict({kinshipPercent:0},{summary:{kind:null},commonAncestors:[]});
 assert.equal(result.classification,'insufficient_ancestry');
});

/** Fixture integrity, not a claim of real-world identity, scientific review or hosted E2E. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDemoSeed } from '../src/demo/seed-r88.mjs';
const data=JSON.parse(readFileSync('public/demo-workbench/data.json','utf8'));
assert.deepEqual(createDemoSeed(),createDemoSeed(),'seed must be deterministic');
assert.equal(data.namespace,'synthetic:r88');assert.equal(data.is_demo,true);
const unique=(items,name)=>{const ids=new Set(items.map(x=>x.id));assert.equal(ids.size,items.length,`duplicate ${name} IDs`);return ids;};
const horses=new Map(data.horses.map(h=>[h.id,h]));
const people=unique(data.people,'people'),providers=unique(data.providers,'provider'),events=unique(data.competitions,'event'),categories=unique(data.serviceCategories,'category');
for(const key of ['horses','people','providers','competitions','results','listings','products','breedingRecords']){
 unique(data[key],key);
 for(const item of data[key]){assert.equal(item.is_demo,true,key);assert.equal(item.provenance,data.namespace,key);assert.equal(item.authority,'none',key);}
}
for(const h of data.horses){
 assert(people.has(h.owner_id)&&people.has(h.breeder_id),'missing horse/person link');
 assert.equal(h.keeping_address,null);assert.equal(h.media.length,0);
 for(const [field,sex] of [['father_id','male'],['mother_id','female']]){
  if(h[field]===null)continue;
  const parent=horses.get(h[field]);assert(parent,'missing parent');assert.equal(parent.sex_desc,sex);assert(parent.birth_year<h.birth_year,'parent must predate foal');
 }
 for(const t of h.tests){assert.equal(t.verified,0);assert.equal(t.is_demo,true);assert.equal(t.interpretation.clinical_diagnosis,false);}
 assert(data.metrics[h.id],'missing engine metrics');
}
for(const p of data.providers){assert(people.has(p.person_id));assert(categories.has(p.category));assert.equal(p.contact,null);assert.equal(p.credential.status,'synthetic_not_valid');}
const resultKeys=new Set();
for(const r of data.results){assert(horses.has(r.horse_id)&&people.has(r.rider_id)&&events.has(r.competition_id));const key=`${r.horse_id}:${r.competition_id}`;assert(!resultKeys.has(key),'duplicate horse/event result without class');resultKeys.add(key);}
for(const listing of data.listings){assert(horses.has(listing.horse_id));assert.equal(listing.seller_id,horses.get(listing.horse_id).owner_id);assert.equal(listing.price_basis,'illustrative_not_market_quote');}
for(const product of data.products)assert(providers.has(product.provider_id));
for(const r of data.breedingRecords){const h=horses.get(r.foal_id);assert(h);assert.equal(h.father_id,r.sire_id);assert.equal(h.mother_id,r.dam_id);assert(Number(r.covering_date.slice(0,4))<=h.birth_year);}
assert.equal(Object.keys(data.pairings).length,196);
assert.equal(data.pairings['9:10'].projectedOffspringInbreedingPercent,25);
assert.equal(data.pairings['1:4'].projectedOffspringInbreedingPercent,0);
assert(data.pairings['1:4'].sirePedigreeCompletenessPercent<100);
for(const [key,pair] of Object.entries(data.pairings)){const [sire,dam]=key.split(':').map(Number);assert.equal(horses.get(sire).sex_desc,'male');assert.equal(horses.get(dam).sex_desc,'female');assert(pair.algorithmVersion);}
console.log('PASS deterministic synthetic fixture integrity, family/person/service/result references, no duplicate horse/event results, and 196 engine pairings.');

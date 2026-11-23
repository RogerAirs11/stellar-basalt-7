'use strict';
const {test}=require('node:test'); const assert=require('node:assert/strict');
const {load}=require('./lib/r104-isolated-module.cjs');
const {analyzeArabianPairingEvidence:analyze,ARABIAN_VARIANTS}=load('src/genetics/arabianPairingEvidence.ts');
const genotype=(v,n)=>n===0?'N/N':n===1?`N/${v}`:`${v}/${v}`;
const record=(horseId,assayKey='CA',copies=1,extra={})=>({horseId,assayKey,result:genotype(assayKey,copies),evidenceId:`${horseId}-${assayKey}`,verified:true,...extra});
for(const v of ARABIAN_VARIANTS) for(let a=0;a<3;a++) for(let b=0;b<3;b++) test(`R108 ${v}: exact Mendelian ${a} x ${b} copies`,()=>{
  const report=analyze(1,2,[record(1,v,a)],[record(2,v,b)]); const row=report.variants.find(r=>r.variant===v);
  const probabilities=row.probabilities;assert.equal(row.status,'calculable');assert.equal(probabilities.twoVariantCopies,a*b/4);
  assert.equal(Object.values(probabilities).reduce((s,p)=>s+p,0),1); assert.ok(Object.values(probabilities).every(p=>p>=0&&p<=1));
  const swapped=analyze(2,1,[record(2,v,b)],[record(1,v,a)]).variants.find(r=>r.variant===v);assert.deepEqual(swapped.probabilities,probabilities);
});
test('R108 genetics: missing data is null, never a zero-risk claim',()=>{
  const r=analyze(1,2,[],[]);assert.equal(r.calculableVariants,0);assert.ok(r.variants.every(v=>v.probabilities===null&&v.parentA.status==='missing'));
});
for(const [name,rows,status] of [
  ['unverified',[record(1,'CA',0,{verified:false})],'unverified'],
  ['negated prose',[record(1,'CA',0,{result:'not clear'})],'uninterpreted'],
  ['conflicting retests',[record(1,'CA',0),record(1,'CA',1,{evidenceId:'retest'})],'conflict'],
  ['ambiguous verified retest',[record(1,'CA',0),record(1,'CA',0,{evidenceId:'retest',result:'inconclusive'})],'uninterpreted']
]) test(`R108 genetics: ${name} never receives a probability`,()=>{
  const row=analyze(1,2,rows,[record(2)]).variants.find(r=>r.variant==='CA');assert.equal(row.parentA.status,status);assert.equal(row.probabilities,null);
});
test('R108 genetics: duplicate consistent evidence remains traceable and does not inflate coverage',()=>{
  const r=analyze(1,2,[record(1),record(1,'CA',1,{evidenceId:'retest'})],[record(2)]);assert.equal(r.calculableVariants,1);assert.equal(r.variants.find(v=>v.variant==='CA').parentA.consideredEvidenceIds.length,2);
});
test('R108 genetics: exact OAAM token requires explicit OAAM1 assay mapping and retains limitation',()=>{
  const r=analyze(1,2,[record(1,'OAAM1',1,{result:'N/OAAM'})],[record(2,'OAAM1',1,{result:'OAAM/N'})]);
  assert.equal(r.variants.find(v=>v.variant==='OAAM1').probabilities.twoVariantCopies,.25);assert.ok(r.limitationCodes.includes('oaam1_does_not_exclude_other_oaam_forms'));
  assert.throws(()=>analyze(1,2,[record(1,'OAAM',1)],[]),TypeError);
});
for(const [name,run] of [
 ['self-pair',()=>analyze(1,1,[],[])],['unsafe horse',()=>analyze(Number.MAX_SAFE_INTEGER+1,2,[],[])],
 ['cross-horse evidence',()=>analyze(1,2,[record(3)],[])],['duplicate evidence ID',()=>analyze(1,2,[record(1),record(1)],[])],
 ['implicit verification',()=>analyze(1,2,[record(1,'CA',0,{verified:1})],[])],['oversized input',()=>analyze(1,2,Array(501).fill(record(1)),[])]
]) test(`R108 genetics: reject ${name}`,()=>assert.throws(run));

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createDemoSeed } from '../src/demo/seed-r88.mjs';
import { sourceRuntime } from './r88-test-runtime.mjs';
const checkOnly=process.argv.includes('--check');
if(process.argv.slice(2).some(arg=>arg!=='--check')) throw new Error('Usage: node tools/generate-r88-demo.mjs [--check]');
const stale=[];
function emit(file,content){
 if(checkOnly){if(!existsSync(file)||readFileSync(file,'utf8')!==content)stale.push(file);}
 else writeFileSync(file,content);
}
const rt=sourceRuntime();
try {
 const data=createDemoSeed();
 const { calculatePedigreeCoefficientFromGraph }=rt.load('src/pedigree/coefficients.ts');
 const { analyzeBreedingPairingFromGraphs }=rt.load('src/pedigree/breeding.ts');
 const { interpretAssayResult, ASSAY_CATALOG_VERSION }=rt.load('src/genetics/assayCatalog.ts');
 const { formatRegistryDate, registryAgeRange }=rt.load('src/registry/dates.ts');
 const horses=new Map(data.horses.map(h=>[h.id,h]));
 const graph=(id,depth=4)=>{
   const visited=new Map(), missing=new Set(), unloaded=new Set(), cycles=new Set();
   function visit(id,level,path){ if(path.has(id)){cycles.add(id);return;} const h=horses.get(id);if(!h){missing.add(id);return;}visited.set(id,h);if(level>=depth){for(const p of [h.father_id,h.mother_id])if(p)unloaded.add(p);return;}const next=new Set(path);next.add(id);for(const p of [h.father_id,h.mother_id])if(p)visit(p,level+1,next); }
   visit(id,0,new Set());
   return {rootId:id,depth,horses:visited,missingParentIds:missing,unloadedParentIds:unloaded,cycleNodeIds:cycles,truncated:unloaded.size>0};
 };
 data.metrics={};data.pairings={};
 for(const h of data.horses){h.birth_display={en:formatRegistryDate(h.birth_date,'gregorian','en').text,fa:formatRegistryDate(h.birth_date,'solar_hijri','fa').text};h.age=registryAgeRange(h.birth_date,{gy:2026,gm:10,gd:3});data.metrics[h.id]=calculatePedigreeCoefficientFromGraph(graph(h.id));for(const t of h.tests)t.interpretation={...interpretAssayResult(t.test_type,t.result),clinical_diagnosis:false,assay_catalog_version:ASSAY_CATALOG_VERSION};}
 for(const sire of data.horses.filter(h=>h.sex_desc==='male'))for(const dam of data.horses.filter(h=>h.sex_desc==='female')){
   const a=analyzeBreedingPairingFromGraphs(graph(sire.id),graph(dam.id),4);
   data.pairings[`${sire.id}:${dam.id}`]={status:a.status,depth:a.depth,projectedOffspringInbreedingPercent:a.projectedOffspringInbreedingPercent,sirePedigreeCompletenessPercent:a.sirePedigreeCompletenessPercent,damPedigreeCompletenessPercent:a.damPedigreeCompletenessPercent,commonAncestorIds:a.commonAncestors.map(x=>x.horse.id),closeMatingWarning:a.verdict?.closeMatingWarning??false,classification:a.verdict?.classification,algorithmVersion:a.provenance.algorithmVersion};
 }
 if(!checkOnly){mkdirSync('public/demo-workbench',{recursive:true});mkdirSync('public/business-model',{recursive:true});}
 emit('public/demo-workbench/data.json',JSON.stringify(data)+'\n');
 for(const [source,target] of [['src/commerce/economics.ts','public/business-model/economics.js'],['src/search/normalize.ts','public/demo-workbench/normalize.js']]){
  const result=rt.ts.transpileModule(readFileSync(source,'utf8'),{compilerOptions:{target:rt.ts.ScriptTarget.ES2022,module:rt.ts.ModuleKind.ES2022}});
  emit(target,'// GENERATED from '+source+'; do not edit this copy.\n'+result.outputText);
 }
 if(stale.length)throw new Error('Stale generated demo assets: '+stale.join(', ')+'. Run npm run generate:r88:demo');
 console.log(`${checkOnly?'Verified':'Generated'} ${data.horses.length} synthetic horses, ${data.providers.length} providers, ${Object.keys(data.pairings).length} source-engine pairing analyses. No canonical database touched.`);
}finally{rt.cleanup();}

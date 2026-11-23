/* Dependency-independent tests of actual TypeScript source (no application mocks).
 * Uses the installed TypeScript compiler, or the global compiler in source-only environments. */
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
let ts;try{ts=require('typescript');}catch{ts=require(path.join(require('node:child_process').execSync('npm root -g',{encoding:'utf8'}).trim(),'typescript'));}
const root=path.resolve(__dirname,'..');const cache=new Map();
function load(file){
 const resolved=path.resolve(root,file);if(cache.has(resolved))return cache.get(resolved).exports;
 const code=ts.transpileModule(fs.readFileSync(resolved,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const module={exports:{}};cache.set(resolved,module);
 const requireLocal=(name)=>{if(!name.startsWith('.'))return require(name);let next=path.resolve(path.dirname(resolved),name);if(!fs.existsSync(next))next+='.ts';return load(next);};
 vm.runInThisContext('(function(require,module,exports){'+code+'\n})',{filename:resolved})(requireLocal,module,module.exports);return module.exports;
}
const nav=load('src/frontend-kit/navigation.ts');const {fitNavigationTabs:fit}=nav;
const policy=load('src/marketplace/policy.ts');const shared=load('src/shared/marketplacePolicy.ts');
test('hidden and zero-width layouts keep all destinations',()=>assert.deepEqual(fit([90,100,80],0,90),[0,1,2]));
test('empty catalog does not fabricate an index',()=>assert.deepEqual(fit([],300,90),[]));
test('all tabs fit without an unnecessary overflow reservation',()=>assert.deepEqual(fit([100,100],204,80,4),[0,1]));
test('always-visible complete catalog control has its own width reservation',()=>assert.deepEqual(fit([100,100],204,80,4,-1,true),[0]));
test('a wide active tab replaces rather than appends to the fitted prefix',()=>assert.deepEqual(fit([80,80,220],300,50,4,2),[2]));
test('active tab and canonical order both survive a narrow viewport',()=>assert.deepEqual(fit([40,40,40,90],200,50,4,3),[0,3]));
test('one current tab remains discoverable even below its intrinsic width',()=>assert.deepEqual(fit([80,150],100,80,4,1),[1]));
test('negative and malformed measurement inputs remain bounded',()=>assert.deepEqual(fit([-2,NaN,30],100,30,-2,900),[0,1,2]));
test('5000 deterministic width cases preserve active location, order and budget',()=>{
 let seed=173;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 for(let n=0;n<5000;n++){
  const widths=Array.from({length:1+Math.floor(random()*26)},()=>20+Math.floor(random()*200));
  const gap=Math.floor(random()*9),more=35+Math.floor(random()*95),active=Math.floor(random()*widths.length);
  const available=40+Math.floor(random()*1500),always=random()>.5;const result=fit(widths,available,more,gap,active,always);
  assert(result.includes(active));assert.equal(new Set(result).size,result.length);assert.deepEqual(result,[...result].sort((a,b)=>a-b));
  const needsMore=always||result.length<widths.length;
  const used=result.reduce((sum,i)=>sum+widths[i],0)+Math.max(0,result.length-1)*gap+(needsMore?more+gap:0);
  if(widths[active]+more+gap<=available)assert(used<=available,JSON.stringify({widths,available,more,gap,active,result,used}));
  else if(result.length<widths.length)assert.equal(result.length,1);
 }
});
test('all five catalogs have unique destinations and populated bilingual labels',()=>{
 for(const skin of ['heritage','equidata-elite','fei-classic','retro-astra','classic-registry']){
  const links=nav.navigationGroups(skin,'/','fa').flatMap(g=>g.links);
  assert.equal(new Set(links.map(l=>l.id)).size,links.length);
  for(const link of links){assert(link.href);assert(link.label.fa);assert(link.label.en);}
 }
});
test('FEI workspace, directory, services and market are reachable in the canonical catalog',()=>{
 const ids=nav.navigationGroups('fei-classic','/','en').flatMap(g=>g.links.map(l=>l.id));
 for(const id of ['workspaces','directory','requests','market','organization-management'])assert(ids.includes(id),id);
});
test('server and client vocabulary has one immutable source',()=>{
 assert.equal(policy.LISTING_TRANSITIONS,shared.LISTING_TRANSITIONS);
 assert(Object.isFrozen(shared.LISTING_TRANSITIONS));for(const list of Object.values(shared.LISTING_TRANSITIONS))assert(Object.isFrozen(list));
 const client=fs.readFileSync(path.join(root,'src/frontend-kit/domain/marketplace.ts'),'utf8');
 assert(client.includes('= LISTING_TRANSITIONS;'));assert(!client.includes('draft: ["active"'));
});
test('sold remains terminal; a repeated sold state is idempotent',()=>{
 assert.throws(()=>policy.assertListingTransition('sold','active'),e=>e.status===409&&e.code==='invalid_listing_transition');
 assert.doesNotThrow(()=>policy.assertListingTransition('sold','sold'));
});
test('invalid inherited status names cannot pass backend validation',()=>{
 for(const value of ['toString','__proto__','constructor','missing']){
  assert.throws(()=>policy.assertListingTransition(value,'active'),e=>e.status===409);
  assert.throws(()=>policy.assertInquiryTransition(value,'closed'),e=>e.status===409);
 }
});
test('inquiry transition is terminal after closure',()=>{
 assert.doesNotThrow(()=>policy.assertInquiryTransition('new','contacted'));
 assert.doesNotThrow(()=>policy.assertInquiryTransition('contacted','closed'));
 assert.throws(()=>policy.assertInquiryTransition('closed','new'),e=>e.status===409);
});
test('expired listing cannot bypass renewal',()=>assert.throws(()=>policy.assertListingTransition('draft','active','2020-01-01T00:00:00Z',Date.UTC(2026,9,18)),e=>e.code==='listing_expired'));
test('disclosure retains introduction-only/no-escrow boundary',()=>{
 assert.equal(shared.MARKETPLACE_DISCLOSURE.role,'introduction_only');assert(shared.MARKETPLACE_DISCLOSURE.en.includes('does not escrow'));assert(shared.MARKETPLACE_DISCLOSURE.fa.length>80);
});

const display=load('src/frontend-kit/horseDisplay.ts');
test('male/female and colt/filly labels do not invent adult breeding status',()=>{
 assert.equal(display.horseSexLabel('Male','fa'),"نر");assert.equal(display.horseSexLabel('Female','fa'),"ماده");
 assert.equal(display.horseSexLabel('Colt','fa'),"کره نر");assert.equal(display.horseSexLabel('Filly','fa'),"کره ماده");
 assert.notEqual(display.horseSexLabel('Male','fa'),display.horseSexLabel('Stallion','fa'));
});
test('gelding is not lost as unknown and unknown raw descriptions survive',()=>{
 assert.equal(display.horseSexLabel('Gelding','fa'),"اسب اخته");
 for(const raw of ['Special registry value','__proto__','constructor','Mare (uncertain)'])assert.equal(display.horseSexLabel(raw,'fa'),raw);
 assert.equal(display.horseSexLabel(null,'fa','--'),'--');assert.equal(display.horseSexLabel('Stallion','en'),'Stallion');
});
test('sex decoration never treats unknown or female as male',()=>{
 assert.equal(display.horseSexKind('Female'),'female');assert.equal(display.horseSexKind('Male'),'male');assert.equal(display.horseSexKind('Gelding'),'gelding');assert.equal(display.horseSexKind('Unknown'),'unknown');assert.equal(display.horseSexKind('not a male'),'unknown');
});

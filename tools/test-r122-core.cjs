/* R122 source-only checks. Actual production functions and SQLite statements;
 * these do not replace the locked project typecheck, HTTP, or PostgreSQL gates. */
const ts = require('./lib/register-typescript.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root,file), 'utf8');
const ui = require('../src/shared/uiLocale.ts');
const pref = require('../src/frontend-kit/navigationPreference.ts');
const nav = require('../src/frontend-kit/navigation.ts');
const loc = require('../src/web/heritage/analyticsNavigation.ts');
const events = require('../src/web/heritage/competitionPresentation.ts');
const fmt = require('../src/web/heritage/presentationLocale.ts');
const horse = require('../src/frontend-kit/horseDisplay.ts');
const { openLocalSqlite } = require('../src/db/localSqlite.ts');
const { sqliteSqlToPostgres } = require('../src/db/sqliteSqlToPostgres.ts');
const sql = require('../src/registry/mutationStatements.ts');
const cats = { fr: require('../src/shared/uiCopy.fr.json'), ar: require('../src/shared/uiCopy.ar.json') };

test('four explicit UI locales; invalid stored values fall back safely', () => {
 assert.deepEqual(ui.UI_LOCALES, ['fa','en','ar','fr']);
 for (const value of [null,undefined,'FR','constructor','__proto__',{},42]) assert.equal(ui.parseUiLocale(value,'en'),'en');
 for (const value of ui.UI_LOCALES) assert.equal(ui.parseUiLocale(value),value);
});
test('direction, calendar-compatible legacy boundary and native names are independent', () => {
 for (const value of ['fa','ar']) assert.equal(ui.isUiRtl(value),true);
 for (const value of ['en','fr']) assert.equal(ui.isUiRtl(value),false);
 assert.equal(ui.legacyUiLocale('ar'),'en');assert.equal(ui.legacyUiLocale('fr'),'en');assert.equal(ui.legacyUiLocale('fa'),'fa');
 for (const value of ui.UI_LOCALES) assert.ok(ui.UI_LOCALE_INFO[value].name.length>0);
});
test('unknown interface copy is not invented and known entries are nonblank', () => {
 assert.equal(ui.uiText('fr','Unknown source text'),'Unknown source text');
 for(const value of ['constructor','toString','__proto__'])for(const locale of ['ar','fr']){assert.equal(ui.uiText(locale,value),value);assert.equal(horse.horseSexLabel(value,locale),value);}
 assert.equal(ui.uiText('fa','English','Persian'),'Persian');
 for (const locale of ['fr','ar']) for (const [key,value] of Object.entries(cats[locale])) {
  assert.equal(typeof value,'string',`${locale}:${key}`);assert.ok(value.trim().length>0,`${locale}:${key}`);
 }
});
test('French and Arabic cover every literal in the original Core EN dictionary', () => {
 const sf=ts.createSourceFile('i18n.tsx',read('src/web/i18n.tsx'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let count=0;
 function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(sf)==='EN'&&ts.isObjectLiteralExpression(node.initializer)){
  for(const item of node.initializer.properties){if(!ts.isPropertyAssignment(item)||!ts.isStringLiteralLike(item.initializer))continue;
   count++;for(const locale of ['fr','ar'])assert.equal(ui.hasUiTranslation(locale,item.initializer.text),true,`${locale}: ${item.initializer.text}`);
  }}ts.forEachChild(node,visit);}visit(sf);assert.equal(count,510);
});
test('locale catalogs use exactly the same keys and preserve placeholders',()=>{
 assert.deepEqual(Object.keys(cats.fr).sort(),Object.keys(cats.ar).sort());
 const tokens=text=>[...text.matchAll(/\{[a-zA-Z][\w.]*\}/g)].map(x=>x[0]).sort();
 for(const [locale,copy] of Object.entries(cats))for(const [key,value]of Object.entries(copy))assert.deepEqual(tokens(value),tokens(key),`${locale}: ${key}`);
});
test('Arabic identifiers retain leading zeros and never acquire grouping',()=>{
 assert.equal(fmt.localizedDigits('000123','ar'),'\u0660\u0660\u0660\u0661\u0662\u0663');
 assert.equal(fmt.localizedDigits('000123','fr'),'000123');
 assert.equal(fmt.localizedDigits('2005','fa'),'\u06f2\u06f0\u06f0\u06f5');
});
test('percent is an already-percent quantity; nonfinite results remain unknown',()=>{
 assert.equal(fmt.localizedPercent(12.5,'en',1),'12.5%');assert.equal(fmt.localizedPercent(NaN,'fr'),'\u2014');
 assert.ok(fmt.localizedPercent(12.5,'fr',1).includes('12,5'));assert.ok(fmt.localizedPercent(12.5,'ar',1).includes('\u0661\u0662'));
});
test('Arabic quantity digits are explicit instead of engine-dependent defaults',()=>assert.match(new Intl.NumberFormat(ui.uiNumberTag('ar')).format(123),/[\u0660-\u0669]/));
for(const value of ['auto','tabs','sidebar'])test(`navigation preference ${value} survives parsing`,()=>assert.equal(pref.parseNavigationPreference(value,'auto'),value));
test('automatic navigation resolves from available space, not a persisted decision',()=>{
 assert.equal(pref.resolveNavigationLayout('auto',true),'sidebar');assert.equal(pref.resolveNavigationLayout('auto',false),'tabs');
 for(const value of ['tabs','sidebar'])for(const wide of [false,true])assert.equal(pref.resolveNavigationLayout(value,wide),value);
 assert.equal(pref.parseNavigationPreference('broken','auto'),'auto');assert.match(pref.AUTO_SIDEBAR_QUERY,/78rem/);assert.match(pref.AUTO_SIDEBAR_QUERY,/30rem/);
});
test('all Core navigation labels have four nonempty language choices',()=>{
 for(const locale of ui.UI_LOCALES)for(const group of nav.navigationGroups('heritage','/stats',locale)){
  assert.ok(group.label[locale]);for(const link of group.links)assert.ok(link.label[locale]);
 }
});
test('analytics validates section and view together, rejecting inherited object keys',()=>{
 assert.deepEqual(loc.readAnalyticsLocation('?section=overview&view=intelligence'),{section:'overview',view:'intelligence'});
 assert.deepEqual(loc.readAnalyticsLocation('?section=people&view=intelligence'),{section:'people',view:'all'});
 for(const bad of ['__proto__','constructor','unknown'])assert.deepEqual(loc.readAnalyticsLocation(`?section=${bad}&view=all`),{section:'all',view:'all'});
});
test('analytics updates preserve unrelated query state and do not invent views',()=>{
 assert.equal(loc.analyticsLocation('?keep=yes&section=people&view=summary','pedigree','influence'),'/stats?keep=yes&section=pedigree&view=influence');
 assert.equal(loc.analyticsLocation('?keep=yes&section=people&view=summary','all','all'),'/stats?keep=yes');
 assert.equal(loc.analyticsLocation('','quality','intelligence'),'/stats?section=quality&view=all');
});
test('competition IDs fail closed for malformed/unsafe values',()=>{
 for(const value of [0,-1,NaN,Infinity,'01','1x','1.2',1.2,{},Number.MAX_SAFE_INTEGER+1])assert.equal(events.competitionId(value),null);
 assert.equal(events.competitionId('17'),17);assert.equal(events.competitionId(17),17);
});
test('Persian season follows the calendar rather than a fixed March-21 rule',()=>{
 assert.equal(events.persianYearAt(new Date('2024-03-20T12:00:00Z')),1403);
 assert.equal(events.persianYearAt(new Date('2025-03-20T12:00:00Z')),1403);
 assert.equal(events.persianYearAt(new Date('2025-03-21T12:00:00Z')),1404);
 assert.equal(events.persianYearAt(new Date('invalid')),null);
});
test('ambient field keyframes never rotate; endpoint geometry covers very wide and tall hosts',()=>{
 const css=read('src/web/styles/heritage.lighting.css');
 const frames=[...css.matchAll(/@keyframes heritage-v2-field-[\w-]+\s*\{([\s\S]*?)(?=\n\})/g)];assert.equal(frames.length,10);
 for(const frame of frames){assert.match(frame[1],/0%,100%/);assert.doesNotMatch(frame[1],/rotate|skew/);
  for(const [,x,y,scale]of frame[1].matchAll(/translate3d\((-?[\d.]+)%?,(-?[\d.]+)%?,0\) scale\(([\d.]+)\)/g)){
   assert.ok(Math.abs(+x)<=6&&Math.abs(+y)<=6&&+scale>=1);
   for(const [w,h]of[[40,2000],[2000,40],[320,700],[1280,720]])for(const [size,offset]of[[w,+x],[h,+y]]){
    const over=.2*size,canvas=1.4*size;
    assert.ok(over-Math.abs(offset)/100*canvas>=size*.115999);
   }
  }
 }
 assert.doesNotMatch(css,/local-specular-r[34]/,'remove superseded tilted stripe overrides');
 assert.match(css,/prefers-reduced-motion:reduce/);assert.match(css,/data-perf="lite"/);assert.match(css,/data-ambient-motion="off"/);
});

async function graph(){const db=openLocalSqlite(':memory:');await db.exec('CREATE TABLE horses(id INTEGER PRIMARY KEY,name_latin TEXT,father_id INTEGER,mother_id INTEGER,deleted_at TEXT,updated_at TEXT,row_version INTEGER DEFAULT 1,last_mutation_id TEXT)');await db.exec("INSERT INTO horses(id,name_latin) VALUES(1,'One'),(2,'Two'),(3,'Three')");return db;}
async function edit(db,id,father,mother){return db.prepare(sql.HORSE_UPDATE_SQL_TEMPLATE('father_id=?,mother_id=?')+sql.HORSE_UPDATE_PARENTAGE_GUARD_SQL).bind(father,mother,'op',id,1,father,mother,id).run();}
test('live unrelated parents are accepted by the actual post-lock guard',async()=>{const db=await graph();assert.equal((await edit(db,1,2,3)).meta.changes,1);});
for(const side of ['father','mother'])test(`archived ${side} after preflight is rejected atomically`,async()=>{const db=await graph();await db.exec("UPDATE horses SET deleted_at='2026-10-01' WHERE id=2");assert.equal((await edit(db,1,side==='father'?2:null,side==='mother'?2:null)).meta.changes,0);const row=await db.prepare('SELECT * FROM horses WHERE id=1').first();assert.equal(row.row_version,1);assert.equal(row.last_mutation_id,null);});
test('missing parent is rejected and removing a parent is allowed',async()=>{const db=await graph();assert.equal((await edit(db,1,999,null)).meta.changes,0);assert.equal((await edit(db,1,null,null)).meta.changes,1);});
test('self, opposite-edge and three-node ancestry cycles remain rejected',async()=>{
 for(const mode of ['self','pair','three']){const db=await graph();if(mode==='pair')await db.exec('UPDATE horses SET father_id=1 WHERE id=2');if(mode==='three')await db.exec('UPDATE horses SET father_id=3 WHERE id=2;UPDATE horses SET mother_id=1 WHERE id=3');assert.equal((await edit(db,1,mode==='self'?1:2,null)).meta.changes,0);}
});
test('actual create SELECT and counters refuse stale parents without fabricating capacity',async()=>{
 const db=openLocalSqlite(':memory:');for(const file of fs.readdirSync(path.join(root,'migrations')).filter(x=>x.endsWith('.sql')).sort())await db.exec(read('migrations/'+file));
 await db.exec("INSERT INTO horses(id,name_latin,deleted_at) VALUES(1,'Archived parent','2026-10-01')");
 const source=read('src/api/routes.ts').split('async function createHorse(')[1].split('async function updateHorse(')[0];
 const template=source.match(/INSERT INTO horses[\s\S]+?`\)\.bind/)[0].split('`).bind')[0].replace('${HORSE_UPDATE_PARENTAGE_GUARD_SQL}',sql.HORSE_UPDATE_PARENTAGE_GUARD_SQL);
 const columns=template.slice(template.indexOf('(')+1,template.indexOf(')')).split(',').map(x=>x.trim());assert.equal(columns.length,31);
 const values=columns.map(key=>({id:4,name_latin:'New horse',father_id:1,is_dead:0,last_mutation_id:'create-op'}[key]??null));
 const revisions=[...source.matchAll(/env\.DB\.prepare\("(UPDATE registry_(?:state|runtime_counters)[^"]+)"\)/g)].map(x=>x[1]);assert.equal(revisions.length,2);
 const before=await db.prepare('SELECT canonical_revision FROM registry_state WHERE id=1').first();
 const result=await db.batch([db.prepare(template).bind(...values,1,null,4),...revisions.map(q=>db.prepare(q).bind('create-op'))]);
 assert.equal(result[0].meta.changes,0);assert.equal(await db.prepare('SELECT id FROM horses WHERE id=4').first(),null);assert.deepEqual(await db.prepare('SELECT canonical_revision FROM registry_state WHERE id=1').first(),before);
 await db.exec('UPDATE horses SET deleted_at=NULL WHERE id=1');
 assert.equal((await db.prepare(template).bind(...values,1,null,4).run()).meta.changes,1);
 assert.equal((await db.prepare('SELECT father_id FROM horses WHERE id=4').first()).father_id,1);
});
test('create and archive use the graph-aware batch rather than an unlocked batch',()=>{
 const source=read('src/api/routes.ts');
 for(const [start,end]of[['createHorse','updateHorse'],['archiveHorse','adminDashboard']]){
  const body=source.split(`async function ${start}(`)[1].split(`async function ${end}(`)[0];
  assert.match(body,/runGuardedHorseBatch/);assert.match(body,/graphLock: true/);assert.doesNotMatch(body,/await env\.DB\.batch\(/);
 }
});
test('updated guard retains three binds and PostgreSQL-recursive single-branch form',()=>{
 const translated=sqliteSqlToPostgres('SELECT 1 WHERE 1=1'+sql.HORSE_UPDATE_PARENTAGE_GUARD_SQL);
 assert.ok(translated.includes('CAST($1 AS BIGINT),CAST($2 AS BIGINT),CAST($3 AS BIGINT)'));
 assert.equal((translated.match(/JOIN ancestor_ids/g)||[]).length,1);assert.doesNotMatch(translated,/\?/);
});

test("shared destinations have one current navigation item, not duplicate highlights",()=>{
 for(const locale of ui.UI_LOCALES){const active=nav.navigationGroups("heritage","/market",locale).flatMap(x=>x.links).filter(x=>x.active);assert.equal(active.length,1);assert.equal(active[0].id,"market");}
});

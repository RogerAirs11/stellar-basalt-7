#!/usr/bin/env node
/** Measure actual Worker API handlers against a separately marked read-only scale
 * fixture. This process opens no HTTP listener, reads no env files and forbids
 * external fetch. Timings include handler work and response JSON consumption,
 * but exclude browser rendering, network transport and module compilation. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rows = Number(process.argv[2] || 78000);
const iterations = Number(process.argv[3] || 20);
if (!Number.isInteger(rows) || rows < 5000 || rows > 80000 || !Number.isInteger(iterations) || iterations < 10 || iterations > 50) {
  throw new Error('Usage: node tools/benchmark-scale.mjs [5000..80000 rows] [10..50 iterations]');
}
const database = path.join(root, 'data', 'benchmarks', `r111-scale-${rows}.sqlite`);
for (let part = database; part !== path.dirname(part); part = path.dirname(part)) {
  if (fs.lstatSync(part).isSymbolicLink()) throw new Error('Symlink fixture refused');
}
const server = await createServer({ root, configFile:false, envDir:false, appType:'custom',
  logLevel:'error', server:{middlewareMode:true,hmr:false,watch:null}, optimizeDeps:{noDiscovery:true} });
const originalFetch = globalThis.fetch;
let networkAttempts = 0;
globalThis.fetch = async () => { networkAttempts++; throw new Error('External IO forbidden in synthetic scale benchmark'); };

function quantile(values, fraction) {
  const sorted = [...values].sort((a,b)=>a-b);
  return Number(sorted[Math.max(0, Math.ceil(sorted.length*fraction)-1)].toFixed(3));
}
function summarize(samples) {
  return {n:samples.length,min_ms:quantile(samples,0),median_ms:quantile(samples,.5),p95_ms:quantile(samples,.95),max_ms:quantile(samples,1)};
}
function countTree(tree) {
  if (!tree) return 0;
  return 1 + [...(tree.parents || []),...(tree.children || [])].reduce((sum,node)=>sum+countTree(node),0);
}
function optionalText(filename) { try { return fs.readFileSync(filename,'utf8').trim(); } catch { return null; } }

try {
  const { openLocalSqlite } = await server.ssrLoadModule('/src/db/localSqlite.ts');
  const worker = (await server.ssrLoadModule('/src/worker.ts')).default;
  const rawDb = openLocalSqlite(database,{readOnly:true});
  const marked = await rawDb.prepare('SELECT namespace,manifest_json FROM synthetic_scale_manifest WHERE id=1').first();
  if (marked?.namespace !== 'synthetic:scale:r111') throw new Error('Unmarked or live database refused');
  const fixture = JSON.parse(marked.manifest_json);
  if (fixture.rows !== rows || fixture.is_demo !== true) throw new Error('Fixture count/marker mismatch');
  const actualRows = await rawDb.prepare('SELECT COUNT(*) AS n FROM horses WHERE deleted_at IS NULL').first('n');
  if (actualRows !== rows) throw new Error('Generated population is incomplete');
  const statements = new Map();
  const noteStatement = (sql,bindings) => {
    if (!statements.has(sql)) statements.set(sql,{sql,bindings,executions:0});
    statements.get(sql).executions++;
  };
  function wrappedStatement(sql, statement, bindings = []) {
    return { underlying:statement, sql, bindings,
      bind(...values) { return wrappedStatement(sql,statement.bind(...values),values); },
      async first(column) { noteStatement(sql,bindings); return statement.first(column); },
      async all() { noteStatement(sql,bindings); return statement.all(); },
      async run() { noteStatement(sql,bindings); return statement.run(); },
    };
  }
  const db = { ...rawDb,
    prepare(sql) { return wrappedStatement(sql,rawDb.prepare(sql)); },
    async batch(items) { items.forEach(item=>noteStatement(item.sql,item.bindings)); return rawDb.batch(items.map(item=>item.underlying)); },
  };
  const env = { DB:db, DB_PROVIDER_MODE:'d1_only', APP_ENV:'local', REGISTRY_DATASET_KIND:'synthetic',
    ISOLATED_DEMO_MODE:'0', ENABLE_DEMO_ADMIN_LOGIN:'0', AI_ASSISTANT_ENABLED:'0', AI_GEMINI_ENABLED:'0', AI_DEEPSEEK_ENABLED:'0',
    BILLING_LIVE_PAYMENTS_ENABLED:'false', DEMO_PAYMENTS_ENABLED:'0', DEMO_NOTIFICATIONS_ENABLED:'0',
    ASSETS:{fetch:async()=>new Response('Not Found',{status:404})} };
  const tests = [
    {name:'search_exact_identifier',kind:'search',url:`/api/search?q=${fixture.cases.exact_id}&limit=25`,expectId:fixture.cases.exact_id},
    {name:'search_explicit_horse_id',kind:'search',url:`/api/search?q=id%3A${fixture.cases.exact_id}&limit=25`,expectId:fixture.cases.exact_id},
    {name:'search_exact_name',kind:'search',url:`/api/search?q=${encodeURIComponent(fixture.cases.exact_name)}&limit=25`,expectId:fixture.cases.exact_id},
    {name:'search_native_name',kind:'search',url:`/api/search?q=${encodeURIComponent(fixture.cases.native_name)}&limit=25`,expectId:fixture.cases.exact_id},
    {name:'search_fuzzy',kind:'search',url:'/api/search?q=aurra&limit=25'},
    {name:'search_broad_prefix',kind:'search',url:'/api/search?q=SCALE&limit=50'},
    {name:'search_year_filter',kind:'search',url:'/api/search?q=year%3A2010&limit=25'},
    {name:'search_empty',kind:'search',url:'/api/search?q=ABSENTZZXR111QWERTY&limit=25',empty:true},
    {name:'registry_page',kind:'page_api',url:'/api/horses?limit=25&sort=name&dir=asc'},
    {name:'profile',kind:'profile',url:`/api/horses/${fixture.cases.deep_profile}`},
    {name:'pedigree_depth_8',kind:'pedigree',url:`/api/horses/${fixture.cases.deep_profile}/pedigree?depth=8`,nodeCap:511},
    {name:'descendants_depth_6_max_600',kind:'pedigree',url:`/api/horses/${fixture.cases.prolific_sire}/descendants?depth=6&max=600`,nodeCap:600,truncated:true},
  ];
  async function invoke(test) {
    const start = performance.now();
    const response = await worker.fetch(new Request('http://127.0.0.1'+test.url),env);
    const body = await response.json();
    const milliseconds = performance.now()-start;
    if (response.status !== 200) throw new Error(`${test.name}: HTTP ${response.status}: ${JSON.stringify(body).slice(0,600)}`);
    if (test.kind === 'search') {
      if (!Array.isArray(body.results) || body.results.length > 50) throw new Error('Search result limit broken');
      if (body.results.some(row=>row.id < 800000001 || row.id > 800000000+rows)) throw new Error('Non-fixture result found');
      if (test.expectId && !body.results.some(row=>row.id === test.expectId)) throw new Error(`${test.name}: exact result missing`);
      if (test.empty && body.results.length) throw new Error('Empty query fixture did not remain empty');
    }
    const treeNodes = test.nodeCap ? countTree(body.tree) : null;
    if (test.nodeCap && (!treeNodes || treeNodes > test.nodeCap)) throw new Error(`${test.name}: tree node cap broken`);
    if (test.truncated && body.truncated !== true) throw new Error('Expected explicit prolific-sire truncation');
    return {milliseconds,results:Array.isArray(body.results)?body.results.length:null,treeNodes,truncated:body.truncated??null,bytes:Buffer.byteLength(JSON.stringify(body))};
  }
  const measurements = [];
  for (const test of tests) {
    // This is a first pass in one fresh SQLite connection, not an OS-cold test.
    const first = await invoke(test);
    const samples=[];
    for (let n=0;n<iterations;n++) samples.push((await invoke(test)).milliseconds);
    const summary=summarize(samples);
    measurements.push({...test,first_pass_ms:Number(first.milliseconds.toFixed(3)),warm:summary,
      returned_results:first.results,tree_nodes:first.treeNodes,truncated:first.truncated,response_bytes:first.bytes,
      target_ms:test.kind==='search'?500:1000,meets_local_target:summary.p95_ms <= (test.kind==='search'?500:1000)});
    console.error(`${test.name}: warm p95 ${summary.p95_ms}ms; ${test.nodeCap?'nodes='+first.treeNodes:''}`);
  }
  const concurrent = [];
  const concurrentTest = tests.find(test=>test.name==='search_broad_prefix');
  for (let round=0;round<5;round++) {
    const batch=await Promise.all(Array.from({length:4},()=>invoke(concurrentTest)));
    concurrent.push(...batch.map(result=>result.milliseconds));
  }
  const invalidBounds=[];
  for(const suffix of ['pedigree?depth=999','descendants?depth=99&max=999999']) {
    const response=await worker.fetch(new Request(`http://127.0.0.1/api/horses/${fixture.cases.deep_profile}/${suffix}`),env);
    if(response.status!==400)throw new Error('Out-of-range graph request must fail before traversal');
    invalidBounds.push({path:suffix,status:response.status});
  }
  const queryPlans=[];
  for(const item of [...statements.values()].filter(item=>/^\s*(SELECT|WITH)\b/i.test(item.sql)).slice(0,60)) {
    try {
      const plan=await rawDb.prepare('EXPLAIN QUERY PLAN '+item.sql).bind(...item.bindings).all();
      queryPlans.push({...item,plan:plan.results});
    } catch(error) { queryPlans.push({sql:item.sql,executions:item.executions,error:String(error)}); }
  }
  const indexRows = (await rawDb.prepare("SELECT name,sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY name").all()).results;
  let indexBytes = null;
  try { indexBytes=(await rawDb.prepare("SELECT name,SUM(pgsize) AS bytes FROM dbstat GROUP BY name ORDER BY bytes DESC LIMIT 30").all()).results; } catch { /* dbstat is build-specific; report unsupported rather than infer. */ }
  const result={suite:'r111-synthetic-scale',generated_at:new Date().toISOString(),fixture:{...fixture,path:path.relative(root,database),bytes:fs.statSync(database).size,sha256:crypto.createHash('sha256').update(fs.readFileSync(database)).digest('hex')},
    environment:{node:process.version,sqlite:await rawDb.prepare('SELECT sqlite_version() AS version').first('version'),platform:process.platform,arch:process.arch,
      cpu_model:os.cpus()[0]?.model,visible_logical_cpus:os.cpus().length,available_parallelism:os.availableParallelism?.(),host_memory_bytes:os.totalmem(),
      cgroup_cpu_max:optionalText('/sys/fs/cgroup/cpu.max'),cgroup_memory_max:optionalText('/sys/fs/cgroup/memory.max'),process_memory:process.memoryUsage()},
    method:{transport:'actual Worker.fetch and canonical API/query implementations in process; no HTTP socket',module_compilation:'completed before timing',
      cache:'OS file cache warm after generation; first pass and repeated warm connection measured separately. OS cache was not flushed.',
      sqlite_cache_size:await rawDb.prepare('PRAGMA cache_size').first('cache_size'),sqlite_page_size:await rawDb.prepare('PRAGMA page_size').first('page_size'),
      quantile:'nearest-rank p95',iterations_per_case:iterations,steady_concurrency:1,burst_concurrency:4,
      concurrency_note:'One Node process and synchronous SQLite adapter; bursts measure queueing, not independent multi-process database concurrency.',
      thresholds:'Audit provisional local targets: search p95 <=500ms; profile/pedigree/page API p95 <=1000ms. This is measurement, not owner acceptance.',
      statistics:'No browser rendering, HTTP transport, real archive distribution, hosted database or cold OS-cache claim.'},
    measurements,burst_search_broad_prefix:{...summarize(concurrent),concurrency:4},invalidBounds,
    distinct_sql_statements:statements.size,queryPlans,indexes:indexRows,largest_sqlite_objects:indexBytes,
    external_fetch_attempts:networkAttempts,all_sequential_targets_met:measurements.every(item=>item.meets_local_target),
    limits:['Generated shape is documented and is not claimed to reproduce the unavailable real archive.', 'Full UI responsiveness at scale still needs browser evidence.', 'Private workflows, media payloads, analytics rebuild cost and backend production adapters were not benchmarked.']};
  if(networkAttempts)throw new Error('An external IO attempt occurred');
  console.log(JSON.stringify(result,null,2));
} finally {
  globalThis.fetch=originalFetch;
  await server.close();
}

/** TEST ONLY: offline CommonJS wrapper of the real browser modules.
 * It uses explicit fixture-fetch, storage and URL/history test doubles; it
 * neither relaxes managed browser policy nor certifies HTTP/CSP/deployment.
 */
const fs=require('node:fs');let ts;
try{ts=require('typescript')}catch{ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript')}
const modules=['public/demo-workbench/model.mjs','public/demo-workbench/views.mjs','public/business-model/economics.js','public/demo-workbench/app.mjs','public/demo-workbench/viewContext.mjs',...fs.readdirSync('public/demo-workbench/views').filter(x=>x.endsWith('.mjs')).map(x=>'public/demo-workbench/views/'+x)];
let out='(()=>{const factories={},cache={};\n';
for(const path of modules){
 let source=fs.readFileSync(path,'utf8').replaceAll('import.meta.url',JSON.stringify('https://offline.test/demo-workbench/app.mjs'));
 const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 out+=`factories[${JSON.stringify(path)}]=function(require,module,exports){const location=window.__demoLocation,history=window.__demoHistory;\n${compiled}\n};\n`;
}
out+=`function load(path){if(cache[path])return cache[path].exports;if(!factories[path])throw Error('Unbundled module '+path);const module={exports:{}};cache[path]=module;const require=ref=>{const base=path.split('/');base.pop();for(const p of ref.split('/')){if(p==='..')base.pop();else if(p!=='.')base.push(p);}return load(base.join('/'));};factories[path](require,module,module.exports);return module.exports;}load('public/demo-workbench/app.mjs');})();`;
const index=process.argv.indexOf('--output-dir');
if(index>=0&&!process.argv[index+1])throw new Error('--output-dir requires a directory');
const directory=index>=0?process.argv[index+1]:'review-r96/evidence';
fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(require('node:path').join(directory,'browser-harness.js'),out);

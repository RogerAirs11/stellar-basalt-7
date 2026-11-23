/** TEST ONLY: execute the actual Classic modules with explicit offline URL/fetch/storage doubles.
 * This does not validate hosted HTTP, CSP, real persistence or production providers.
 */
const fs = require('node:fs');
const path = require('node:path');
let ts;
try { ts = require('typescript'); } catch { ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript'); }
const root = 'public/classic-registry/ui';
function walk(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(`${dir}/${entry.name}`) : entry.name.endsWith('.js') ? [`${dir}/${entry.name}`] : []); }
let output = '(()=>{const factories={},cache={};\n';
for (const file of walk(root)) {
 const source = fs.readFileSync(file, 'utf8').replaceAll('import.meta.url', JSON.stringify(`https://offline.test/${file.replace(/^public\//, '')}`));
 const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
 output += `factories[${JSON.stringify(file)}]=${file===`${root}/app.js`?'async ':''}function(require,module,exports){const location=window.__classicLocation;\n${compiled}\n};\n`;
}
output += `function load(file){if(cache[file])return cache[file].exports;if(!factories[file])throw Error('Unbundled module '+file);const module={exports:{}};cache[file]=module;const require=ref=>{const parts=file.split('/');parts.pop();for(const part of ref.split('/')){if(part==='..')parts.pop();else if(part!=='.')parts.push(part);}return load(parts.join('/'));};const result=factories[file](require,module,module.exports);if(result&&typeof result.catch==='function')result.catch(error=>{window.__classicBootError=String(error);setTimeout(()=>{throw error},0);});return module.exports;}load('${root}/app.js');})();`;
const outIndex = process.argv.indexOf('--output-dir');
if (outIndex >= 0 && !process.argv[outIndex + 1]) throw new Error('--output-dir requires a directory');
const dest = path.join(outIndex >= 0 ? process.argv[outIndex + 1] : 'review-r102/evidence', 'classic-offline-harness.js');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, output);

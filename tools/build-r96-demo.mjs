/** Copy only first-party demo sources. Does not touch canonical data or deploy. */
import {readFileSync,writeFileSync,mkdirSync,existsSync,readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const check=process.argv.includes('--check');
if(process.argv.slice(2).some(x=>x!=='--check'))throw new Error('Usage: node tools/build-r96-demo.mjs [--check]');
const generated=spawnSync(process.execPath,['tools/generate-r88-demo.mjs',...(check?['--check']:[])],{stdio:'inherit'});
if(generated.status!==0)process.exit(generated.status||1);
const stale=[];
function emit(path,content){if(check){if(!existsSync(path)||readFileSync(path,'utf8')!==content)stale.push(path);}else writeFileSync(path,content);}
if(!check){mkdirSync('public/demo-workbench/views',{recursive:true});mkdirSync('public/business-model',{recursive:true});}
for(const name of ['model.mjs','views.mjs','app.mjs','style.css','index.html','viewContext.mjs'])emit(`public/demo-workbench/${name}`,readFileSync(`src/demo/workbench/${name}`,'utf8'));
for(const name of readdirSync('src/demo/workbench/views').filter(n=>n.endsWith('.mjs')))emit(`public/demo-workbench/views/${name}`,readFileSync(`src/demo/workbench/views/${name}`,'utf8'));
const index=readFileSync('src/demo/workbench/index.html','utf8').replace('href="./style.css"','href="../demo-workbench/style.css"').replace('src="./app.mjs"','src="../demo-workbench/app.mjs"');
emit('public/business-model/index.html',index);
if(stale.length)throw new Error(`Stale R96 demo assets: ${stale.join(', ')}`);
console.log(`${check?'Verified':'Built'} isolated R96 workbench and scenario calculator.`);

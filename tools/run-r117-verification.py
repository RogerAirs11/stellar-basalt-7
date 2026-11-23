#!/usr/bin/env python3
"""Execute independent, non-deploying gates and record every exit code.
No install or live provider calls. Uses the actual runtime, never silently
claims the pinned Node version was used. Nonzero gates remain nonzero.
"""
import argparse,datetime,json,os,subprocess,time,shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--quick',action='store_true');args=p.parse_args()
OUT=ROOT/'review-r117/evidence';OUT.mkdir(exist_ok=True,parents=True)
env=os.environ.copy();node=subprocess.check_output(['node','--version'],text=True).strip()
if node.startswith('v22.') and '--experimental-strip-types' not in env.get('NODE_OPTIONS',''):
 env['NODE_OPTIONS']=(env.get('NODE_OPTIONS','')+' --experimental-strip-types').strip()
commands=[
 ('r117-tests',['node','--test','tools/test-r117-navigation-policy.cjs'],60),
 ('syntax-final',['node','tools/validate-all-source-syntax.cjs'],60),
 ('navigation-final',['node','tools/build-navigation-model.cjs','--check'],30),
 ('language-final',['node','tools/validate-language-localization.mjs'],30),
 ('mobile-final',['node','tools/validate-mobile-ux-system.mjs'],30),
 ('platform-final',['node','tools/validate-platform-contract.mjs'],30),
 ('frontends-final',['node','tools/validate-frontends.mjs'],30),
 ('css-final',['node','tools/validate-css-architecture.mjs'],30),
 ('sql-final',['node','tools/validate-sql-bindings.cjs'],30),
 ('typecheck-pure-final',['tsc','-p','tsconfig.r117-pure.json'],30),
 ('classic-browser-final',['python','tools/test-r102-classic-browser.py','--offline','--r104','--r108','--output-dir','review-r117/evidence/classic-browser'],100),
 ('fei-layout-final',['python','tools/test-r117-fei-layout.py'],60),
 ('navigation-layout',['python','tools/test-r117-navigation-layout.py'],120),
]
if not args.quick: commands.extend([
 ('python-final',['python','-m','unittest','discover','-s','tests/python','-p','test_*.py'],180),
 ('native-final',['npm','run','test:review-native'],150),
 ('assets-final',['node','tools/validate-production-frontend-assets.mjs','--source'],30),
 ('typecheck-final',['npm','run','typecheck'],60),
 ('vitest-final',['npm','test','--','--reporter=dot'],60),
 ('build-final',['npm','run','build'],90),
])
comparison=OUT/'fei-layout/baseline-comparison.json';old=OUT/'fei-layout/results.json'
if old.exists() and not comparison.exists():
 data=json.loads(old.read_text())
 if any(x['revision']=='baseline' for x in data.get('measurements',[])):shutil.copyfile(old,comparison)
metadata={'utc_started':datetime.datetime.now(datetime.timezone.utc).isoformat(),'node':node,'pinned_node':(ROOT/'.node-version').read_text().strip(),'node_options':env.get('NODE_OPTIONS',''),'quick':args.quick,'gates':[]}
for name,cmd,timeout in commands:
 start=time.monotonic();log=OUT/(name+'.log')
 with log.open('w') as f:
  f.write('$ '+' '.join(cmd)+'\nNODE_OPTIONS='+env.get('NODE_OPTIONS','')+'\n');f.flush()
  try:code=subprocess.run(cmd,cwd=ROOT,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=timeout).returncode
  except subprocess.TimeoutExpired:code=124;f.write('\nTIMEOUT\n')
  f.write('\nEXIT_CODE:'+str(code)+'\n')
 metadata['gates'].append({'name':name,'command':cmd,'exit_code':code,'elapsed_seconds':round(time.monotonic()-start,2),'log':str(log.relative_to(ROOT))})
 (OUT/'validation.json').write_text(json.dumps(metadata,indent=2)+'\n');print(name,code,flush=True)
metadata['utc_finished']=datetime.datetime.now(datetime.timezone.utc).isoformat()
(OUT/'validation.json').write_text(json.dumps(metadata,indent=2)+'\n')
raise SystemExit(1 if any(g['exit_code']!=0 for g in metadata['gates']) else 0)

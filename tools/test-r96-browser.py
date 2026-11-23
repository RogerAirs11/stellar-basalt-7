"""R96 static workbench DOM tests. Default mode is hosted localhost.
--offline uses explicit URL/history/fetch/storage doubles where managed browser
policy forbids navigation. It does NOT prove HTTP, CSP, browser persistence,
production API wiring, provider delivery, or the five production frontends.
"""
from pathlib import Path
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import argparse,json,os,re,shutil,subprocess,threading
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--offline',action='store_true');parser.add_argument('--output-dir',default='review-r96/evidence');args=parser.parse_args()
EVIDENCE=ROOT/args.output_dir;OUT=EVIDENCE/'screenshots';OUT.mkdir(parents=True,exist_ok=True)
fixture=json.loads((ROOT/'public/demo-workbench/data.json').read_text())
checks=[];errors=[];external=[];server=None
if args.offline:
 subprocess.run(['node','tools/build-r96-dom-harness.cjs','--output-dir',str(EVIDENCE)],cwd=ROOT,check=True)
 bundle=(EVIDENCE/'browser-harness.js').read_text()
else:
 class Quiet(SimpleHTTPRequestHandler):
  def log_message(self,*a):pass
 server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(ROOT/'public')))
 threading.Thread(target=server.serve_forever,daemon=True).start();base=f'http://127.0.0.1:{server.server_port}'
def check(name,condition):
 if not condition:raise AssertionError(name)
 checks.append(name);print('PASS',name,flush=True)
def load(page,route='home',lang='en',store=None):
 if not args.offline:
  page.goto(base+f'/demo-workbench/?lang={lang}#/{route}',wait_until='networkidle');page.locator('main h1').wait_for();return
 html=(ROOT/'public/demo-workbench/index.html').read_text()
 html=re.sub(r'<meta http-equiv="Content-Security-Policy"[^>]+>','',html)
 html=re.sub(r'<link[^>]+>|<script[^>]*>.*?</script>','',html,flags=re.S)
 page.set_content(html);page.add_style_tag(content=(ROOT/'public/demo-workbench/style.css').read_text())
 page.evaluate('''({fixture,store,lang,route})=>{
  window.__store=store||{};
  Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>window.__store[k]??null,setItem:(k,v)=>window.__store[k]=String(v),removeItem:k=>delete window.__store[k]}});
  window.fetch=async input=>{if(!String(input).endsWith('/data.json'))throw Error('Unexpected network call');return new Response(JSON.stringify(fixture),{status:200});};
  let hash='#/'+route;
  window.__demoLocation={href:'https://offline.test/demo-workbench/?lang='+lang+hash,pathname:'/demo-workbench/',search:'?lang='+lang,get hash(){return hash},set hash(v){hash=v.startsWith('#')?v:'#'+v;queueMicrotask(()=>window.dispatchEvent(new HashChangeEvent('hashchange')));}};
  window.__demoHistory={replaceState:(_,__,value)=>{const u=new URL(value);window.__demoLocation.search=u.search;window.__demoLocation.href=u.href;}};
  document.addEventListener('click',event=>{const a=event.target.closest('a[href^="#/"]');if(a){event.preventDefault();window.__demoLocation.hash=a.getAttribute('href');}},true);
 }''',{'fixture':fixture,'store':store,'lang':lang,'route':route})
 page.add_script_tag(content=bundle);page.locator('main h1').wait_for()
def route(page,value):
 if args.offline:page.evaluate("r=>{window.__demoLocation.hash='#/'+r}",value)
 else:page.evaluate("r=>location.hash='#/'+r",value)
 page.wait_for_timeout(50)
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE') or shutil.which('chromium'),headless=True,args=['--no-sandbox'])
  context=browser.new_context(viewport={'width':1440,'height':960},accept_downloads=True)
  def fresh(r='home',lang='en',width=1440,store=None):
   p=context.new_page();p.set_viewport_size({'width':width,'height':960});p.on('pageerror',lambda err:errors.append(str(err)));load(p,r,lang,store);return p
  page=fresh();check('connected home renders real fixture counts','196' in page.locator('main').inner_text());page.screenshot(path=str(OUT/'home-en-desktop.png'),full_page=True)
  page.locator('main a[href="#/horse/17"]').first.click();check('actual navigation opens connected horse profile','DEMO Azin' in page.locator('main h1').inner_text())
  check('route change focuses the main heading',page.locator('main h1').evaluate('(e)=>document.activeElement===e'))
  check('horse links both people and ancestry',page.locator('main a[href^="#/person/"]').count()>=2 and page.locator('main a[href^="#/horse/"]').count()>=4)
  page.screenshot(path=str(OUT/'horse-en-desktop.png'),full_page=True)
  route(page,'horses');check('all 28 records render',page.locator('tbody tr').count()==28)
  page.locator('[name=q]').fill('DEMO-H017');page.locator('#horse-filters button[type=submit]').click();check('stable-ID search returns one record',page.locator('tbody tr').count()==1)
  page.locator('[name=q]').fill('not_a_real_record');page.locator('#horse-filters button[type=submit]').click();check('empty query does not invent records',page.locator('tbody tr').count()==0 and page.locator('.empty').count()==1)
  page.locator('[data-action=clear-filters]').click();page.locator('[data-action=save]').first.click();route(page,'saved');check('saved selection is coherent',page.locator('tbody tr').count()==1)
  if args.offline:
   store=page.evaluate('window.__store');page.close();page=fresh('saved',store=store);check('saved records survive serialization roundtrip',page.locator('tbody tr').count()==1)
  else:
   page.reload(wait_until='networkidle');check('native reload preserves saved selection',page.locator('tbody tr').count()==1)
  route(page,'directory');check('all 22 professional roles render',page.locator('#results-region .card').count()==22)
  page.locator('[name=category]').select_option('dc');page.locator('#directory-filters button[type=submit]').click();check('DC filter is not course designer',page.locator('#results-region .card').count()==1 and 'Disciplinary' in page.locator('#results-region').inner_text())
  page.locator('#results-region .card a').first.click();page.locator('[data-action=inquire]').first.click();check('request dialog is native and labeled',page.locator('dialog').evaluate('(d)=>d.open') and page.locator('#request-title').is_visible());check('contact consent starts unchecked',not page.locator('[name=shareContact]').is_checked())
  page.keyboard.press('Escape');check('Escape closes request dialog',not page.locator('dialog').evaluate('(d)=>d.open'))
  page.locator('[data-action=inquire]').first.click();payload='<img src=x onerror="window.__unsafe=1">';page.locator('textarea[name=note]').fill(payload);page.locator('#request-form button[type=submit]').click();page.wait_for_timeout(80)
  check('demo inquiry reaches inbox',page.locator('main article').count()==1 and 'Private inquiry' in page.locator('main h1').inner_text())
  check('inquiry text cannot execute HTML',payload in page.locator('main').inner_text() and page.evaluate('window.__unsafe') is None and page.locator('main img').count()==0)
  page.locator('[data-status=acknowledged]').click();check('local provider acknowledgment advances once',page.locator('[data-status=acknowledged]').count()==0)
  page.locator('[data-action=withdraw]').click();check('withdrawal removes note and further transitions',payload not in page.locator('main').inner_text() and page.locator('[data-action=inquiry-status]').count()==0)
  route(page,'workspace');before=page.locator('[data-action=complete-task]').count();page.locator('[data-action=complete-task]').first.click();check('reminder completion updates visible state',page.locator('[data-action=complete-task]').count()==before-1)
  page.locator('#task-form [name=title]').fill('DEMO: verify document list');page.locator('#task-form button[type=submit]').click();check('new local reminder is visible','DEMO: verify document list' in page.locator('main').inner_text());page.screenshot(path=str(OUT/'workspace-en-desktop.png'),full_page=True)
  route(page,'products');page.locator('[data-action=cart]').first.click();check('quote shortlist updates without checkout',page.locator('[data-action=cart]').first.get_attribute('aria-pressed')=='true' and 'not a shopping order' in page.locator('main').inner_text())
  route(page,'listing/'+fixture['listings'][-1]['id']);check('closed listing refuses new inquiries',page.locator('[data-action=inquire]').count()==0)
  route(page,'compare');check('source engine yields 25 percent for full siblings',page.locator('#coi').get_attribute('data-value')=='25')
  page.locator('[data-sire="1"]').click();check('zero coefficient does not become an outcross claim',page.locator('#coi').get_attribute('data-value')=='0' and 'Sparse ancestry' in page.locator('#pairing-result').inner_text())
  route(page,'business');check('pilot correctly shows a loss',page.locator('#surplus').get_attribute('data-value')=='-43755000');check('one-off ads excluded from recurring revenue',page.locator('#mrr').get_attribute('data-value')=='67400000')
  page.locator('[data-scenario=growth]').click();check('conditional growth arithmetic matches source',page.locator('#surplus').get_attribute('data-value')=='59151000')
  page.locator('[name=farm-price]').fill('-1');check('invalid financial input removes stale profitable result',page.locator('#surplus').count()==0 and page.locator('#model-error').count()==1)
  page.locator('[data-scenario=pilot]').click();page.screenshot(path=str(OUT/'business-en-desktop.png'),full_page=True)
  route(page,'horse/999');check('missing detail link is an honest missing record','Record not found' in page.locator('main h1').inner_text());page.close()
  # Actual layout and direction are exercised; offline doubles do not replace DOM rendering.
  for lang in ['en','fa']:
   for width in [360,390,768,1280,1440]:
    page=fresh(lang=lang,width=width)
    for r in ['home','horses','horse/17','people','directory','provider/demo-provider-1','marketplace','products','events','compare','workspace','inbox','business','capabilities','trust']:
     route(page,r)
     check(f'no document overflow: {lang} / {width}px / {r}',page.evaluate('document.documentElement.scrollWidth <= innerWidth+1'))
     check(f'correct direction: {lang} / {width}px / {r}',page.locator('html').get_attribute('dir')==('rtl' if lang=='fa' else 'ltr'))
     if lang=='fa' and width==390 and r in ['home','horse/17','workspace','business']:
      page.screenshot(path=str(OUT/(r.replace('/','-')+'-fa-mobile.png')),full_page=True)
    route(page,'home');check(f'visible buttons have at least 36px target: {lang}/{width}',page.locator('button:visible').evaluate_all('(els)=>els.every(e=>e.getBoundingClientRect().height>=36&&e.getBoundingClientRect().width>=36)'))
    page.close()
  page=fresh(store={'horse-registry:demo:r96:v1':'{broken'}) if args.offline else fresh()
  if args.offline:check('corrupt demo storage is visible and nonfatal','storage could not be read' in page.locator('main').inner_text())
  page.locator('[data-action=language]').click();check('language switch sets Persian direction',page.locator('html').get_attribute('dir')=='rtl')
  route(page,'trust');page.on('dialog',lambda d:d.accept());page.evaluate("localStorage.setItem('unrelated-private-key','keep')");page.locator('[data-action=reset]').click();check('reset preserves unrelated browser keys',page.evaluate("localStorage.getItem('unrelated-private-key')")=='keep')
  check('no uncaught script errors',not errors)
  mode='offline DOM; URL/history/fetch/storage doubles, no hosted HTTP/CSP/API assertions' if args.offline else 'hosted static workbench; no production APIs or React frontend assertions'
  report={'mode':mode,'checks':checks,'count':len(checks),'errors':errors}
  (EVIDENCE/('demo-offline-results.json' if args.offline else 'demo-hosted-results.json')).write_text(json.dumps(report,indent=2)+'\n')
  print(json.dumps({'checks':len(checks),'mode':mode}));browser.close()
finally:
 if server:server.shutdown();server.server_close()

"""Exercise the actual native Classic frontend over local HTTP with explicit synthetic API fixtures.
The --offline mode uses explicit URL/fetch/storage doubles where HTTP navigation is blocked.
Neither mode tests live authentication, database providers, consent delivery, or React frontends.
Requires Playwright and a Chromium executable. No external network request is permitted.
"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import argparse, json, os, re, shutil, subprocess, threading
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
checks, errors, external, requests = [], [], [], []
adaptive_counts = {}  # R117: measured native tabs, not a synthetic layout mock.
horse = {'id': 17, 'name_latin': 'DEMO Synthetic horse', 'name_native': '\u0627\u0633\u0628 \u0646\u0645\u0627\u06cc\u0634\u06cc', 'birth_year': 2020, 'breed_desc': 'Synthetic breed', 'sex_desc': 'Mare', 'color_desc': 'Bay', 'is_active': 1, 'is_dead': 0, 'father_id': None, 'mother_id': None, 'is_demo': True}
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args): pass
parser=argparse.ArgumentParser()
parser.add_argument('--offline', action='store_true', help='Explicit URL/fetch/storage doubles; not an HTTP/CSP or actual persistence test')
parser.add_argument('--output-dir', default='review-r102/evidence', help='Evidence directory relative to repository root')
parser.add_argument('--r104', action='store_true', help='Also test R104 search clear/Escape controls')
parser.add_argument('--r108', action='store_true', help='Also run offline native-source stale-route and session-race checks')
args=parser.parse_args()
if args.r108 and not args.offline: parser.error('--r108 requires --offline (explicit transport doubles)')
OUT = ROOT / args.output_dir
OUT.mkdir(parents=True, exist_ok=True)
server=None
base='https://offline.test'
if args.offline:
    subprocess.run(['node','tools/build-r102-classic-harness.cjs','--output-dir',str(OUT)],cwd=ROOT,check=True)
    bundle=(OUT/'classic-offline-harness.js').read_text()
    if args.r108:
        # Test-only export in the in-memory harness, never in delivered public JS.
        bundle=bundle.replace("load('public/classic-registry/ui/app.js');})();", "window.__r108Core=load('public/classic-registry/ui/core.js');load('public/classic-registry/ui/app.js');})();")
else:
    server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(ROOT/'public')))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    base=f'http://127.0.0.1:{server.server_port}'
def check(name, result):
    if not result: raise AssertionError(name)
    checks.append(name); print('PASS', name, flush=True)
def response(path):
    if path == '/api/platform/meta': return {'application': {'shortName':'Synthetic test fixture'}, 'contractVersion':'test-only', 'stats': {'horses':1,'people':0,'horsesWithBothParents':0}, 'health': {'ok':True}, 'limits': {}, 'source': {'filename':'SYNTHETIC-TEST-ONLY'}}
    if path == '/api/auth/me': return {'user': None, 'permissions': [], 'csrfToken': None}
    if path == '/api/content/posts': return {'posts': []}
    if path == '/api/quality/summary': return {'openIssues':0,'severities':[],'topIssueCodes':[]}
    if path == '/api/registry/facets': return {'breeds':[],'sexes':[],'colors':[],'mainStrains':[],'importedFrom':[]}
    if path == '/api/horses': return {'rows':[horse], 'total':1,'offset':0,'limit':50,'previousOffset':None,'nextOffset':None,'sort':'name','dir':'asc'}
    if path == '/api/horses/17': return {'horse':horse,'people':[],'aliases':[]}
    return None
def load(page, lang='en', route='#/home', store=None, deny_storage=False):
    if not args.offline:
        if deny_storage: page.add_init_script("Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Denied','SecurityError')}})")
        page.goto(base+f'/classic-registry/?locale={lang}'+route,wait_until='networkidle')
        page.locator('#workspace h1').wait_for()
        return
    html=(ROOT/'public/classic-registry/index.html').read_text()
    html=re.sub(r'<meta http-equiv="Content-Security-Policy"[^>]+>', '', html)
    html=re.sub(r'<link[^>]+>|<script[^>]*>.*?</script>', '', html, flags=re.S)
    page.set_content(html)
    for name in ['classic.css','density-tokens.css','compact-r88.css','hierarchical-navigation.css','navigationGroupTokens.css']:
        page.add_style_tag(content=(ROOT/'public/classic-registry/ui'/name).read_text())
    fixtures={p:response(p) for p in ['/api/platform/meta','/api/auth/me','/api/content/posts','/api/quality/summary','/api/registry/facets','/api/horses','/api/horses/17']}
    page.evaluate("""({lang,route,store,denyStorage,fixtures})=>{
        window.__classicStore=store||{};
        if(denyStorage)Object.defineProperty(window,'localStorage',{configurable:true,get(){throw new DOMException('Denied','SecurityError')}});
        else Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>window.__classicStore[k]??null,setItem:(k,v)=>window.__classicStore[k]=String(v),removeItem:k=>delete window.__classicStore[k]}});
        window.__fixtureRequests=[];
        window.fetch=async (input,init={})=>{const path=new URL(String(input),'https://offline.test').pathname;window.__fixtureRequests.push({method:init.method||'GET',url:path});const payload=fixtures[path];return new Response(JSON.stringify(payload??{error:{message:'Not provided by synthetic test fixture'}}),{status:payload?200:404,headers:{'Content-Type':'application/json'}});};
        let hash=route;
        window.__classicLocation={origin:'https://offline.test',pathname:'/classic-registry/',search:'?locale='+lang,get href(){return 'https://offline.test/classic-registry/'+this.search+hash},get hash(){return hash},set hash(value){hash=value.startsWith('#')?value:'#'+value;queueMicrotask(()=>window.dispatchEvent(new HashChangeEvent('hashchange')));}};
        document.addEventListener('click',event=>{const a=event.target.closest('a[href^="#/"]');if(a&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.altKey){event.preventDefault();window.__classicLocation.hash=a.getAttribute('href');}},true);
    }""",{'lang':lang,'route':route,'store':store,'denyStorage':deny_storage,'fixtures':fixtures})
    page.add_script_tag(content=bundle)
    page.locator('#workspace h1').wait_for()
    page.wait_for_function("document.getElementById('app').getAttribute('aria-busy') === 'false'")
def set_route(page, value):
    page.evaluate("value=>{window.__classicLocation.hash=value}" if args.offline else "value=>{location.hash=value}",value)
    page.wait_for_timeout(80)
def collect_requests(page):
    if args.offline: requests.extend(page.evaluate('window.__fixtureRequests||[]'))
try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE') or shutil.which('chromium'), headless=True, args=['--no-sandbox'])
        context = browser.new_context(viewport={'width':1440,'height':960})
        def intercept(route):
            url = route.request.url
            if '/api/' in url:
                requests.append({'method':route.request.method,'url':urlparse(url).path})
                payload = response(urlparse(url).path)
                route.fulfill(status=200 if payload is not None else 404, content_type='application/json', body=json.dumps(payload if payload is not None else {'error':{'message':'Not provided by synthetic test fixture'}})); return
            if not url.startswith(base): external.append(url); route.abort(); return
            route.continue_()
        context.route('**/*', intercept)
        for lang in ['en', 'fa']:
            for width in [1440,1024,768,390,320]:
                page = context.new_page(); page.set_viewport_size({'width':width,'height':960})
                page.on('pageerror', lambda error: errors.append(str(error)))
                load(page,lang)
                page.locator('#workspace h1').wait_for()
                page.select_option('#classic-navigation-layout','sidebar')
                page.wait_for_function("document.getElementById('app').dataset.navigationLayout === 'sidebar'")
                if width<=860: page.locator('.classic-sidebar-toggle').click()
                check(f'{lang}/{width}: hierarchy is visible', page.locator('#classic-sidebar-groups').is_visible())
                check(f'{lang}/{width}: no document horizontal overflow', page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'))
                check(f'{lang}/{width}: layout selector has accessible name', bool(page.locator('#classic-navigation-layout').get_attribute('aria-label')))
                page.locator('#classic-navigation-search').fill('work-not-found')
                check(f'{lang}/{width}: search empty state', page.locator('#classic-sidebar-groups [role=status]').count()==1)
                if args.r104:
                    if width<=860:
                        check(f'{lang}/{width}: expanded navigation stays within a compact scrolling region', page.locator('#classic-sidebar-body').evaluate('(el)=>el.getBoundingClientRect().height <= window.innerHeight * .65'))
                    clear = page.locator('[data-action="clear-navigation-search"]')
                    check(f'{lang}/{width}: clear control has accessible name', bool(clear.get_attribute('aria-label')))
                    page.locator('#classic-navigation-search').press('Escape')
                    check(f'{lang}/{width}: first Escape clears search without hiding navigation', page.locator('#classic-navigation-search').input_value()=='' and page.locator('#classic-sidebar-groups').is_visible())
                    page.locator('#classic-navigation-search').fill('work-not-found')
                    clear.click()
                    check(f'{lang}/{width}: clear restores results and input focus', page.locator('#classic-sidebar-groups a').count()>0 and page.locator('#classic-navigation-search').evaluate('(el)=>el===document.activeElement'))
                    check(f'{lang}/{width}: empty query disables clear action', clear.is_disabled())
                    if width<=860:
                        page.locator('#classic-navigation-search').press('Escape')
                        check(f'{lang}/{width}: second Escape closes mobile rail and restores toggle focus', not page.locator('#classic-sidebar-groups').is_visible() and page.locator('.classic-sidebar-toggle').evaluate('(el)=>el===document.activeElement'))
                        page.locator('.classic-sidebar-toggle').click()
                    else:
                        page.locator('#classic-navigation-search').press('Escape')
                        check(f'{lang}/{width}: desktop Escape does not focus hidden toggle', page.locator('#classic-navigation-search').evaluate('(el)=>el===document.activeElement'))
                else:
                    page.locator('#classic-navigation-search').fill('')
                page.locator('#classic-sidebar-groups a[href="#/registry"]').click()
                page.locator('#workspace a[href="#/horse/17"]:visible').first.wait_for()
                check(f'{lang}/{width}: registry route has active navigation', page.locator('#classic-sidebar-groups a[aria-current=page]').get_attribute('href')=='#/registry')
                set_route(page,"#/horse/17")
                # R116 keeps record controls beside content on small screens.
                # At <=1100px many-page sections use an accessible select, not hidden links.
                target='#classic-context-navigation' if width>860 else '#workspace'
                page.locator(target+' .tabs').wait_for(state='attached')
                if width>860:
                    check(f'{lang}/{width}: actual profile controls moved, not cloned', page.locator('#classic-context-navigation .tab').count()==7 and page.locator('#workspace .tabs').count()==0)
                    page.locator(target+' a[href$="tab=workflows"]').click()
                else:
                    check(f'{lang}/{width}: mobile record controls remain beside content', page.locator('#classic-context-navigation .tab').count()==0 and page.locator('#workspace .tab').count()==7)
                    picker=page.locator('#workspace .classic-context-picker select')
                    picker.wait_for()
                    option=picker.locator('option').evaluate_all("nodes=>nodes.find(n=>n.value.endsWith('tab=workflows'))?.value")
                    assert option, 'Workflows option missing'
                    picker.select_option(option)
                page.wait_for_timeout(80)
                page.wait_for_function("selector=>document.querySelector(selector+' a[aria-current=page]')?.getAttribute('href').endsWith('tab=workflows')",arg=target)
                check(f'{lang}/{width}: contextual navigation stays functional', page.locator(target+' a[aria-current=page]').get_attribute('href').endswith('tab=workflows'))
                check(f'{lang}/{width}: direction matches locale', page.locator('html').get_attribute('dir')==('rtl' if lang=='fa' else 'ltr'))
                if width in [1440,390]:
                    if width<=860: page.locator('.classic-sidebar-toggle').click()
                    page.screenshot(path=str(OUT/f'classic-sidebar-{lang}-{width}.png'),full_page=True)
                if args.offline:
                    store=page.evaluate('window.__classicStore'); collect_requests(page); page.close()
                    page=context.new_page(); page.set_viewport_size({'width':width,'height':960}); page.on('pageerror',lambda error:errors.append(str(error)))
                    load(page,lang,'#/horse/17?tab=workflows',store)
                else: page.reload(wait_until='networkidle')
                check(f'{lang}/{width}: preference survives '+('serialized storage roundtrip' if args.offline else 'actual reload'), page.locator('#classic-navigation-layout').input_value()=='sidebar')
                page.select_option('#classic-navigation-layout','tabs')
                page.locator('#workspace .tabs').wait_for(state='attached')
                check(f'{lang}/{width}: record navigation has a visible accessible control',page.locator('#workspace .tabs').is_visible() or page.locator('#workspace .classic-context-picker select').is_visible())
                if width<=1100:
                    check(f'{lang}/{width}: compact record picker retains all sections',page.locator('#workspace .classic-context-picker select option').count()==7)
                page.wait_for_timeout(120)
                adaptive_counts[(lang,width)]=page.locator('#primary-nav .nav-inner > .nav-link').count()
                check(f'{lang}/{width}: current destination remains in measured row',page.locator('#primary-nav .nav-inner > .nav-link[aria-current=page]').count()==1)
                check(f'{lang}/{width}: measured primary row stays within viewport',page.locator('#primary-nav .nav-inner').evaluate('el=>el.scrollWidth<=el.clientWidth+2'))
                check(f'{lang}/{width}: tabs return to native page', page.locator('#classic-context-navigation').count()==0 and page.locator('#workspace .tabs').count()==1)
                set_route(page,"#/post/%E0%A4%A")
                page.wait_for_function("document.getElementById('workspace').getAttribute('aria-busy') === 'false'")
                check(f'{lang}/{width}: malformed route has no crash', page.locator('#workspace .empty').count()==1)
                collect_requests(page); page.close()
        for language in ['en','fa']:
            check(f'{language}: more primary tabs fit at desktop width',adaptive_counts[(language,1440)]>adaptive_counts[(language,390)]>=1)
        if args.r108:
            page=context.new_page();page.on('pageerror',lambda error:errors.append(str(error)));load(page)
            page.select_option('#classic-navigation-layout','sidebar')
            page.evaluate("""()=>{
              const prior=window.fetch;
              window.fetch=(input,init)=>{
                const path=new URL(String(input),'https://offline.test').pathname;
                if(path==='/api/horses/17')return new Promise(resolve=>{window.__releaseOldHorse=()=>resolve(new Response(JSON.stringify({horse:{id:17,name_latin:'DEMO OLD HORSE',sex_desc:'Stallion'},people:[],aliases:[]})))});
                if(path==='/api/horses/18')return Promise.resolve(new Response(JSON.stringify({horse:{id:18,name_latin:'DEMO CURRENT HORSE',sex_desc:'Mare'},people:[],aliases:[]})));
                return prior(input,init);
              };
            }""")
            set_route(page,'#/horse/17');page.wait_for_function('typeof window.__releaseOldHorse === "function"')
            check('R108: contextual tabs clear before a pending route resolves',page.locator('#classic-context-navigation .tab').count()==0)
            set_route(page,'#/horse/18');page.wait_for_function('document.getElementById("workspace").textContent.includes("DEMO CURRENT HORSE")')
            page.evaluate('window.__releaseOldHorse()');page.wait_for_timeout(80)
            check('R108: slow older horse cannot repaint the current route',page.locator('#workspace').inner_text().find('DEMO CURRENT HORSE')>=0 and 'DEMO OLD HORSE' not in page.locator('#workspace').inner_text())
            check('R108: old completion cannot move stale contextual navigation',page.locator('#classic-context-navigation .tab[href*="/horse/18"]').count()==7)
            results=page.evaluate("""async()=>{
              const core=window.__r108Core, releases=[];
              core.state.auth={user:{id:'old-user',email:'old@local.invalid',display_name:'OLD PRIVATE USER',role:'admin'},csrfToken:'old',permissions:[]};
              window.fetch=()=>new Promise(resolve=>releases.push(data=>resolve(new Response(JSON.stringify(data)))));
              const first=core.refreshAuth();const cleared=core.state.auth.user===null;
              const second=core.refreshAuth();
              releases[1]({user:null,csrfToken:null,permissions:[]});const secondAccepted=await second;
              releases[0]({user:{id:'old-user',email:'old@local.invalid',display_name:'OLD PRIVATE USER',role:'admin'},csrfToken:'old',permissions:[]});
              const firstAccepted=await first;
              const oldRead=core.api('/api/private-fixture').then(()=>false,e=>e.code==='session_superseded');
              const fresh=core.refreshAuth();releases[3]({user:null,csrfToken:null,permissions:[]});await fresh;
              releases[2]({private:'OBSOLETE'});const dropped=await oldRead;
              return {cleared,secondAccepted,firstAccepted,anonymous:core.state.auth.user===null,dropped};
            }""")
            check('R108: native session refresh blanks old authority synchronously',results['cleared'])
            check('R108: older native session response cannot resurrect logout',results['secondAccepted'] and not results['firstAccepted'] and results['anonymous'])
            check('R108: native API discards an old-principal response',results['dropped'])
            collect_requests(page);page.close()
        # Deny browser storage; actual source modules must still start and allow navigation.
        page=context.new_page();page.on('pageerror', lambda error: errors.append(str(error)))
        load(page,deny_storage=True)
        page.locator('#workspace h1').wait_for()
        page.select_option('#classic-navigation-layout','sidebar')
        check('storage denied: application and sidebar remain usable',page.locator('#classic-sidebar-groups').is_visible())
        collect_requests(page); page.close()
        check('no browser page errors',not errors)
        check('fixture tests never submit a mutation',all(request['method'] in ['GET','HEAD'] for request in requests))
        context.close();browser.close()
finally:
    if server: server.shutdown(); server.server_close()
    (OUT/('classic-offline-results.json' if args.offline else 'classic-browser-results.json')).write_text(json.dumps({'scope':('actual native Classic DOM/CSS; explicit URL/fetch/storage doubles; no hosted HTTP/CSP or actual browser persistence proof' if args.offline else 'actual native Classic UI; local HTTP; explicitly synthetic API fixtures; external resources blocked'), 'passed':len(checks), 'checks':checks, 'page_errors':errors, 'blocked_external_count':len(external), 'api_requests':requests},indent=2))

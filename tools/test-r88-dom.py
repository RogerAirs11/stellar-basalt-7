"""Offline Chromium DOM harness for R88's new static pages.
Managed Chromium blocks all URL navigation in the audit environment. This harness
uses set_content and executes the unchanged app source after removing ESM import
lines and injecting its real generated modules. Local fixture fetch and storage
are test doubles. This verifies DOM/JS behavior and rendering, NOT HTTP, CSP,
browser-native persistence, production routes, delivery, or the five React skins.
Run test-r88-browser.py in unrestricted local/CI Chromium for hosted tests.
"""
from pathlib import Path
import json
import os
import re
import shutil
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'audit/r88/screenshots'
OUT.mkdir(parents=True,exist_ok=True)
fixture=json.loads((ROOT/'public/demo-workbench/data.json').read_text())
css=(ROOT/'public/demo-workbench/workbench.css').read_text()
checks=[]
def check(name, condition):
    if not condition: raise AssertionError(name)
    checks.append(name);print('PASS',name,flush=True)
def module_source(path):
    source=(ROOT/path).read_text()
    return re.sub(r'^export\s+', '', source, flags=re.M)
def load(page, business=False, lang='en', route='registry', store=None):
    page.set_content('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><a class="skip" href="#main">Skip to content</a><div id="app"></div><dialog id="request-dialog" aria-labelledby="request-title"></dialog><div id="announcement" role="status" aria-live="polite" class="sr-only"></div></body></html>')
    page.add_style_tag(content=css)
    page.evaluate("document.body.className = '"+('business-page' if business else '')+"'")
    page.evaluate('''({fixture,store,lang,route})=>{
       window.__store=store||{};
       Object.defineProperty(window,'localStorage',{configurable:true,value:{
          getItem:k=>window.__store[k]??null,
          setItem:(k,v)=>{window.__store[k]=String(v)},
          removeItem:k=>{delete window.__store[k]}
       }});
       window.fetch=async()=>new Response(JSON.stringify(fixture),{status:200,headers:{'Content-Type':'application/json'}});
       window.__url={href:'https://offline.test/?lang='+lang+'#/'+route,search:'?lang='+lang,hash:'#/'+route};
       window.__history={replaceState:(_,__,u)=>{window.__url.href=String(u);window.__url.search=new URL(u).search;window.__url.hash=new URL(u).hash;}};
    }''',{'fixture':fixture,'store':store,'lang':lang,'route':route})
    app_path='public/business-model/app.js' if business else 'public/demo-workbench/app.js'
    dependency='public/business-model/economics.js' if business else 'public/demo-workbench/normalize.js'
    source=(ROOT/app_path).read_text()
    source=re.sub(r'^import .*?;\s*', '', source, flags=re.M)
    # Lexical URL/history stand-ins make navigation deterministic without attempting
    # to defeat the environment's URL navigation policy.
    page.evaluate('(async()=>{const location=window.__url,history=window.__history;'+module_source(dependency)+'\n'+source+'\n})()')
    page.locator('#surplus' if business else 'main h1').wait_for()

def route(page, value):
    page.evaluate("r=>{window.__url.hash='#/'+r;window.dispatchEvent(new HashChangeEvent('hashchange'));}", value)

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE') or shutil.which('chromium'),headless=True,args=['--no-sandbox'])
    context=browser.new_context(viewport={'width':1280,'height':900})
    errors=[]
    def fresh(business=False,lang='en',r='registry',store=None):
        page=context.new_page();page.on('pageerror',lambda error:errors.append(str(error)));load(page,business,lang,r,store);return page
    page=fresh()
    check('28 synthetic horses render',page.locator('#results-region .card').count()==28)
    check('every horse card has demo provenance',page.locator('#results-region .badge.demo').count()==28)
    first=fixture['horses'][0]
    page.locator('#search').fill(first['public_id'])
    check('identifier filter works',page.locator('#results-region .card').count()==1)
    page.locator('#search').fill('ZZZ_NONEXISTENT')
    check('empty search does not fabricate records',page.locator('#results-region .card').count()==0)
    page.locator('#search').fill('')
    page.locator('[data-action=save]').first.click()
    store=page.evaluate('window.__store');page.close();page=fresh(store=store,r='saved')
    check('saved state deserializes through storage adapter',page.locator('#results-region .card').count()==1)
    route(page,'horse/17')
    check('profile links family and people',page.locator('main a[href^="#/person/"]').count()>=1 and page.locator('main a[href^="#/horse/"]').count()>=2)
    route(page,'professionals')
    check('22 professionals render',page.locator('#results-region .card').count()==22)
    page.locator('#group').select_option('dc')
    check('DC is a distinct professional category',page.locator('#results-region .card').count()==1 and 'Disciplinary' in page.locator('#results-region').inner_text())
    page.locator('[data-action=request]').first.click()
    check('native request dialog opens',page.locator('dialog').evaluate('(d)=>d.open'))
    page.keyboard.press('Escape')
    check('Escape closes native dialog',not page.locator('dialog').evaluate('(d)=>d.open'))
    page.locator('[data-action=request]').first.click()
    payload='<img src=x onerror=window.__unsafe=1>'
    page.locator('textarea').fill(payload);page.locator('button[type=submit]').click();route(page,'inbox')
    check('simulated request appears in local inbox',page.locator('main article').count()==1)
    check('stored HTML is escaped in DOM',payload in page.locator('main').inner_text() and page.evaluate('window.__unsafe') is None and page.locator('main img').count()==0)
    page.locator('[data-status=contacted]').click()
    check('inquiry advances to contacted',page.locator('[data-status=contacted]').count()==0)
    page.locator('[data-status=closed]').click()
    check('closed inquiry has no transition controls',page.locator('[data-action=request-status]').count()==0)
    route(page,'breeding')
    check('full siblings show actual-engine 25 percent COI',page.locator('#pairing-result .stat strong').first.inner_text()=='25%')
    page.locator('[data-action=preset][data-sire="1"]').click()
    check('zero COI retains missing-ancestry warning',page.locator('#pairing-result .stat strong').first.inner_text()=='0%' and 'Sparse ancestry' in page.locator('#pairing-result').inner_text())
    page.locator('[data-action=preset][data-sire="9"]').click()
    page.screenshot(path=str(OUT/'pedigree-en-desktop.png'),full_page=True);page.close()
    page=fresh(business=True)
    check('pilot calculator shows loss',page.locator('#surplus').get_attribute('data-value')=='-43755000')
    check('one-off ads excluded from MRR',page.locator('#mrr').get_attribute('data-value')=='67400000')
    page.locator('[data-scenario=growth]').click()
    check('growth illustration matches tested arithmetic',page.locator('#surplus').get_attribute('data-value')=='59151000')
    page.locator('#farm-price').fill('-1')
    check('invalid input hides stale profit result',page.locator('#surplus').count()==0 and bool(page.locator('#model-error').inner_text()))
    page.locator('[data-scenario=pilot]').click();page.screenshot(path=str(OUT/'business-en-desktop.png'),full_page=True);page.close()
    for lang in ['en','fa']:
        for width in [360,390,768,1280,1440]:
            for r in ['registry','horse/17','professionals','market','breeding','business']:
                page=context.new_page();page.on('pageerror',lambda error:errors.append(str(error)));page.set_viewport_size({'width':width,'height':900})
                load(page,r=='business',lang,r)
                check(f'no overflow {lang} {width}px {r}',page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'))
                check(f'direction {lang} {width}px {r}',page.locator('html').get_attribute('dir')==('rtl' if lang=='fa' else 'ltr'))
                if lang=='fa' and width==390 and r in ['registry','business']:
                    page.screenshot(path=str(OUT/f'{r}-fa-mobile.png'),full_page=True)
                if lang=='en' and width==1280 and r=='registry':
                    page.screenshot(path=str(OUT/'registry-en-desktop.png'),full_page=True)
                page.close()
    page=fresh(store={'horse-db:synthetic-r88:v1':'{broken'})
    check('corrupt storage handled without crashing',page.locator('#results-region .card').count()==28 and 'Local storage' in page.locator('main').inner_text());page.close()
    check('no uncaught JS errors in offline DOM harness',not errors)
    result={'checks':checks,'browser_errors':errors,'scope':'Offline DOM harness only; URL/history, local fetch and storage test doubles. NOT hosted browser E2E, HTTP/CSP, native reload persistence or original React skins.'}
    (ROOT/'audit/r88/dom-results.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'check_count':len(checks),'scope':result['scope']},indent=2));browser.close()

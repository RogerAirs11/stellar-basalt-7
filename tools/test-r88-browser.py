"""Dependency-light browser regression of NEW static R88 pages, not the React apps.
Requires Python playwright and Chromium. Starts a localhost-only temporary server.
"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import os
import shutil
import threading
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'audit/r88/screenshots'
OUT.mkdir(parents=True, exist_ok=True)
class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass
server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT/'public')))
threading.Thread(target=server.serve_forever, daemon=True).start()
BASE = f'http://127.0.0.1:{server.server_port}'
checks=[]
def check(name, condition):
    if not condition:
        raise AssertionError(name)
    checks.append(name)
    print('PASS', name, flush=True)

def nav(page, path, ready='main h1'):
    page.goto(BASE+path, wait_until='networkidle')
    page.locator(ready).wait_for()

try:
    with sync_playwright() as p:
        binary=os.environ.get('CHROMIUM_EXECUTABLE') or shutil.which('chromium') or shutil.which('chromium-browser')
        browser=p.chromium.launch(executable_path=binary, headless=True, args=['--no-sandbox'])
        context=browser.new_context(viewport={'width':1280,'height':900})
        page=context.new_page()
        errors=[]; external=[]
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('request', lambda req: external.append(req.url) if not req.url.startswith(BASE) else None)
        nav(page,'/demo-workbench/', '#results-region .card')
        check('registry renders 28 isolated synthetic horses',page.locator('#results-region .card').count()==28)
        check('synthetic label visible on every horse',page.locator('#results-region .badge.demo').count()==28)
        page.locator('#search').fill('DEMO-H-0001')
        # The fixture identifier format is authoritative; use its actual first ID below.
        fixture=json.loads((ROOT/'public/demo-workbench/data.json').read_text())
        first=fixture['horses'][0]
        page.locator('#search').fill(first['public_id'])
        check('search by stable synthetic identifier',page.locator('#results-region .card').count()==1)
        page.locator('#search').fill('ZZZ_NONEXISTENT')
        check('empty search is honest, not invented fallback',page.locator('#results-region .card').count()==0)
        page.locator('#search').fill('')
        page.locator('[data-action=save]').first.click()
        page.goto(BASE+'/demo-workbench/#/saved',wait_until='networkidle')
        check('saved horses persist across reload',page.locator('#results-region .card').count()==1)
        nav(page,'/demo-workbench/#/horse/17')
        check('horse profile links people and pedigree',page.locator('main a[href^="#/person/"]').count()>=1 and page.locator('main a[href^="#/horse/"]').count()>=2)
        nav(page,'/demo-workbench/#/professionals','#results-region .card')
        check('all 22 service categories are demonstrated',page.locator('#results-region .card').count()==22)
        page.locator('#group').select_option('dc')
        check('DC is distinct from course designer',page.locator('#results-region .card').count()==1 and 'Disciplinary' in page.locator('#results-region').inner_text())
        page.locator('#group').select_option('')
        page.locator('[data-action=request]').first.click()
        check('request opens labeled native dialog',page.locator('dialog').evaluate('(d)=>d.open') and page.locator('#request-title').is_visible())
        page.keyboard.press('Escape')
        check('Escape closes request dialog',not page.locator('dialog').evaluate('(d)=>d.open'))
        page.locator('[data-action=request]').first.click()
        payload='<img src=x onerror=window.__unsafe=1>'
        page.locator('textarea[name=note]').fill(payload)
        page.locator('#request-form button[type=submit]').click()
        page.wait_for_url('**/#/inbox')
        check('simulated request stored only in demo inbox',page.locator('main article').count()==1)
        check('stored HTML is escaped',payload in page.locator('main').inner_text() and page.evaluate('window.__unsafe') is None and page.locator('main img').count()==0)
        page.reload(wait_until='networkidle')
        check('simulated request persists across reload',page.locator('main article').count()==1)
        page.locator('[data-status=contacted]').click()
        check('local request can advance to contacted',page.locator('[data-status=contacted]').count()==0)
        page.locator('[data-status=closed]').click()
        check('closed simulated request cannot advance',page.locator('[data-action=request-status]').count()==0)
        nav(page,'/demo-workbench/#/breeding','#pairing-result .stat')
        check('full-sibling pairing uses actual engine: 25 percent',page.locator('#pairing-result .stat strong').first.inner_text()=='25%')
        page.locator('[data-action=preset][data-sire="1"]').click()
        check('zero COI keeps missing-ancestry warning','0%'==page.locator('#pairing-result .stat strong').first.inner_text() and 'Sparse ancestry' in page.locator('#pairing-result').inner_text())
        page.locator('[data-action=preset][data-sire="9"]').click()
        page.screenshot(path=str(OUT/'pedigree-en-desktop.png'),full_page=True)
        nav(page,'/business-model/','#surplus')
        check('calculator default pilot is loss-making',page.locator('#surplus').get_attribute('data-value')=='-43755000')
        check('promotions excluded from recurring subscription revenue',page.locator('#mrr').get_attribute('data-value')=='67400000')
        page.locator('[data-scenario=growth]').click()
        check('conditional growth arithmetic matches tested source',page.locator('#surplus').get_attribute('data-value')=='59151000')
        page.locator('#farm-price').fill('-1')
        check('invalid financial input cannot retain stale profit',page.locator('#surplus').count()==0 and bool(page.locator('#model-error').inner_text()))
        page.locator('[data-scenario=pilot]').click()
        page.screenshot(path=str(OUT/'business-en-desktop.png'),full_page=True)
        for lang in ['en','fa']:
            for width in [360,390,768,1280,1440]:
                page.set_viewport_size({'width':width,'height':900})
                for route,ready in [('/demo-workbench/','#results-region .card'),('/demo-workbench/#/horse/17','main h1'),('/demo-workbench/#/professionals','#results-region .card'),('/demo-workbench/#/market','#results-region .card'),('/demo-workbench/#/breeding','#pairing-result .stat'),('/business-model/','#surplus')]:
                    path=route.replace('/#/',f'/?lang={lang}#/') if '#/' in route else route+f'?lang={lang}'
                    nav(page,path,ready)
                    check(f'no document overflow {lang} {width}px {route}',page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'))
                    check(f'correct document direction {lang} {width}px {route}',page.locator('html').get_attribute('dir')==('rtl' if lang=='fa' else 'ltr'))
                if width==390 and lang=='fa':
                    page.screenshot(path=str(OUT/'business-fa-mobile.png'),full_page=True)
                    nav(page,'/demo-workbench/?lang=fa','#results-region .card')
                    page.screenshot(path=str(OUT/'registry-fa-mobile.png'),full_page=True)
                if width==1280 and lang=='en':
                    nav(page,'/demo-workbench/','#results-region .card')
                    page.screenshot(path=str(OUT/'registry-en-desktop.png'),full_page=True)
        page.set_viewport_size({'width':1280,'height':900})
        nav(page,'/demo-workbench/','#results-region .card')
        page.evaluate("localStorage.setItem('unrelated-account-key','preserve-me')")
        page.on('dialog',lambda dialog:dialog.accept())
        page.locator('[data-action=reset]').click()
        check('reset preserves unrelated storage',page.evaluate("localStorage.getItem('unrelated-account-key')")=='preserve-me')
        check('reset clears only demo requests/saves',page.evaluate("JSON.parse(localStorage.getItem('horse-db:synthetic-r88:v1')).requests.length") == 0)
        page.evaluate("localStorage.setItem('horse-db:synthetic-r88:v1','{broken')")
        page.reload(wait_until='networkidle')
        check('corrupt demo storage fails gracefully',page.locator('#results-region .card').count()==28 and 'Local storage' in page.locator('main').inner_text())
        check('no uncaught browser errors',not errors)
        check('no external requests from workbench/calculator',not external)
        print(json.dumps({'checks':len(checks),'browser_errors':errors,'external_requests':external,'scope':'R88 static workbench and calculator only'},indent=2))
        (ROOT/'audit/r88/browser-results.json').write_text(json.dumps({'checks':checks,'browser_errors':errors,'external_requests':external,'scope':'R88 static workbench and calculator only'},indent=2)+'\n')
        browser.close()
finally:
    server.shutdown();server.server_close()

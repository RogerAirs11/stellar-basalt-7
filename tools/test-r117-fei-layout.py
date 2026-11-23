#!/usr/bin/env python3
"""Measure actual FEI styles on a representative static record/form fixture.
NOT a React runtime, live backend, authentication, or full application test.
Requires Python Playwright + Chromium. No network or original fonts/assets.
Use --baseline-ref only with a locally trusted git revision, e.g. HEAD at R116.
"""
import argparse,json,re,shutil,subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--baseline-ref');p.add_argument('--output-dir',default='review-r117/evidence/fei-layout');args=p.parse_args()
out=ROOT/args.output_dir;out.mkdir(parents=True,exist_ok=True)
base='src/web/frontends/fei-classic/'
def read(name,revision=None):
 if revision:return subprocess.check_output(['git','show',revision+':'+name],cwd=ROOT,text=True)
 return (ROOT/name).read_text()
def styles(revision=None):
 entry=read(base+'entry.tsx',revision)
 paths=re.findall(r'import "\./([^"\n]+\.css)";',entry)
 css='\n'.join(read(base+x,revision) for x in paths)
 # Remote and excluded fonts are intentionally replaced by platform fallback.
 css=re.sub(r'@font-face\s*\{[^}]*\}','',css)
 css=re.sub(r'@import\s+[^;]+;','',css)
 return css
FA=['\u0646\u0627\u0645 \u0627\u0633\u0628','\u0634\u0645\u0627\u0631\u0647 \u062b\u0628\u062a','\u0646\u0698\u0627\u062f','\u062c\u0646\u0633\u06cc\u062a','\u0631\u0646\u06af','\u0633\u0627\u0644 \u062a\u0648\u0644\u062f','\u0646\u0627\u0645 \u067e\u062f\u0631','\u0646\u0627\u0645 \u0645\u0627\u062f\u0631']
EN=['Horse name','Registry no.','Breed','Sex','Color','Birth year','Sire','Dam']
def fixture(locale,css):
 fa=locale=='fa';names=FA if fa else EN
 fields=''.join('<div class="fei-field"><label for="f'+str(i)+'">'+x+'</label><div><input id="f'+str(i)+'" class="fei-input"></div></div>' for i,x in enumerate(names))
 rows=''.join('<tr><td>'+str(i+1)+'</td><td>'+('\u0627\u0633\u0628 \u0641\u0631\u0636\u06cc' if fa else 'Fictional horse')+' '+str(i+1)+'</td><td>DEMO-'+str(100+i)+'</td><td>'+('\u0645\u0627\u062f\u06cc\u0627\u0646' if fa else 'Mare')+'</td><td>2020</td><td>DEMO-SIRE</td><td>DEMO-DAM</td></tr>' for i in range(16))
 title='\u0641\u0647\u0631\u0633\u062a \u0627\u0633\u0628\u200c\u0647\u0627' if fa else 'Horse registry'
 note='\u0622\u0632\u0645\u0648\u0646 \u0686\u06cc\u062f\u0645\u0627\u0646 \u0628\u0627 \u0627\u0637\u0644\u0627\u0639\u0627\u062a \u0641\u0631\u0636\u06cc \u2014 \u0646\u0647 \u0646\u0633\u062e\u0647 \u0632\u0646\u062f\u0647 \u0633\u0627\u06cc\u062a' if fa else 'STATIC LAYOUT FIXTURE - FICTIONAL RECORDS - NOT THE LIVE APP'
 action='\u062c\u0633\u062a\u200c\u0648\u062c\u0648' if fa else 'Search'
 return f'''<!doctype html><html lang="{locale}" dir="{'rtl' if fa else 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{{margin:0}}*{{box-sizing:border-box}}{css}</style></head><body><div class="fei-classic-ui" data-locale="{locale}" data-density="compact" data-navigation-layout="tabs" dir="{'rtl' if fa else 'ltr'}"><main class="fc-main"><div class="fc-page-title fei-page-title"><div><h1>{title}</h1><p>{note}</p></div></div><form class="fei-search-form-stack"><div class="fei-panel fei-search-panel"><div class="fei-donor-grid two">{fields}</div></div><div class="fei-search-actions"><button class="fei-button" type="button">{action}</button></div></form><div class="fei-panel fei-results-panel"><div class="fei-table-block"><div class="fei-table-scroll" tabindex="0" aria-label="Records"><table class="fei-data-table"><thead><tr><th>#</th><th>{names[0]}</th><th>{names[1]}</th><th>{names[3]}</th><th>{names[5]}</th><th>{names[6]}</th><th>{names[7]}</th></tr></thead><tbody>{rows}</tbody></table></div></div></div></main></div></body></html>'''
report={'scope':'Representative static DOM, actual FEI stylesheet cascade, platform fonts. No React/router/API claims.','checks':[],'measurements':[]}
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox'])
 for revision,label in [(args.baseline_ref,'baseline'),(None,'candidate')] if args.baseline_ref else [(None,'candidate')]:
  css=styles(revision)
  for locale in ['en','fa']:
   for width in [1440,1024,768,390,320]:
    coarse=width<=390
    context=browser.new_context(viewport={'width':width,'height':1000},has_touch=coarse,is_mobile=coarse,device_scale_factor=1,reduced_motion='reduce')
    context.route('**/*',lambda route:route.abort())
    page=context.new_page();page.set_content(fixture(locale,css));page.wait_for_timeout(80)
    m=page.evaluate('''()=>{const rect=s=>document.querySelector(s).getBoundingClientRect();return {documentWidth:document.documentElement.scrollWidth,viewport:innerWidth,bodyHeight:rect('.fc-main').height,formHeight:rect('form').height,rowHeight:rect('tbody tr').height,tableWidth:rect('table').width,tableWrapperWidth:rect('.fei-table-scroll').width,controlHeight:rect('input').height,columns:getComputedStyle(document.querySelector('.fei-donor-grid')).gridTemplateColumns.split(' ').length}}''')
    report['measurements'].append({'revision':label,'locale':locale,'width':width,'coarsePointer':coarse,**m})
    if label=='candidate':
     report['checks'].append({'name':f'{locale}-{width} no document horizontal overflow','pass':m['documentWidth']<=m['viewport']+1})
     report['checks'].append({'name':f'{locale}-{width} appropriate input size','pass':m['controlHeight']>=(43.5 if coarse else 31.5)})
     report['checks'].append({'name':f'{locale}-{width} logical responsive grid','pass':m['columns']==(1 if width<=600 else 2 if width<=1000 else 4)})
     if locale=='fa' and width in [1440,390]:page.screenshot(path=str(out/f'fei-fixture-fa-{width}.png'),full_page=True)
    context.close()
 browser.close()
report['passed']=sum(x['pass'] for x in report['checks']);report['failed']=sum(not x['pass'] for x in report['checks'])
(out/'results.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'passed':report['passed'],'failed':report['failed'],'scope':report['scope']}))
raise SystemExit(1 if report['failed'] else 0)

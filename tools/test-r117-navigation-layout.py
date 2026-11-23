#!/usr/bin/env python3
"""Browser geometry tests using actual shared fitter and each skin's nav CSS.
Representative static markup, NOT React rendering/router/auth/hosted proof.
No network, third-party fonts, or production data; Playwright/Chromium required.
"""
import json,re,shutil
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'review-r117/evidence/navigation-layout';OUT.mkdir(parents=True,exist_ok=True)
js=(ROOT/'standalone-frontends/classic-v1.4/public/ui/navigationModel.js').read_text()
js=re.sub(r'^export ', '', js, flags=re.M)+'\nwindow.navModel={fitNavigationTabs,navigationGroups};'
skins={
 'heritage':('app-shell','h112-primary-navigation','h112-primary-measure','h112-sections-toggle',['src/web/heritage/Navigation.css']),
 'equidata-elite':('equidata-elite-ui','edx112-shortcuts','edx112-primary-measure','edx112-sections-toggle',['src/web/frontends/equidata-elite/Navigation.css']),
 'fei-classic':('fei-classic-ui','fc112-shortcuts','fc117-nav-measure','fc112-sections-toggle',[]),
 'retro-astra':('retro-astra-transplant','primary-nav-inner','astra-primary-measure','astra-more', ['src/web/frontends/retro-astra/transplant/styles/hierarchical-navigation.css']),
 'classic-registry':('classic-skin','nav-inner','nav-measure','classic-more',['standalone-frontends/classic-v1.4/public/ui/classic.css','standalone-frontends/classic-v1.4/public/ui/hierarchical-navigation.css'])
}
base='src/web/frontends/fei-classic/'
skins['fei-classic'][4].extend(base+p for p in re.findall(r'import "\./([^"\n]+\.css)";', (ROOT/(base+'entry.tsx')).read_text()))
result={'scope':'Actual pure fitter + navigation CSS on representative static DOM; not full React or backend acceptance.','cases':[]}
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox'])
 for skin,(wrapper,row,measure,more,files) in skins.items():
  css='\n'.join((ROOT/f).read_text() for f in files)
  css=re.sub(r'@font-face\s*\{[^}]*\}|@import\s+[^;]+;','',css)
  for locale in ['en','fa']:
   for width in [1200,768,480,320,240]:
    for size in [16,20]:
     context=browser.new_context(viewport={'width':max(width+40,400),'height':900},reduced_motion='reduce')
     context.route('**/*',lambda route:route.abort());p=context.new_page()
     dom=f'''<!doctype html><html lang="{locale}" dir="{'rtl' if locale=='fa' else 'ltr'}" data-frontend="{skin}"><head><meta charset="utf-8"><style>*{{box-sizing:border-box}}html{{font-size:{size}px}}body{{margin:0;font-family:Arial,sans-serif}}{css}</style></head><body data-classic-registry><div class="{wrapper}" dir="{'rtl' if locale=='fa' else 'ltr'}" style="width:{width}px;position:relative"><div class="preferences-root"><div data-edition="default"><div class="astra-primary" id="primary-nav"><nav id="row" class="{row}" style="width:100%;min-width:0;position:relative"><div id="measure" class="{measure}" aria-hidden="true"></div></nav></div></div></div></div></body></html>'''
     p.set_content(dom);p.add_script_tag(content=js)
     state=p.evaluate('''({skin,locale,more})=>{
      const row=document.querySelector('#row'), twin=document.querySelector('#measure');
      const links=navModel.navigationGroups(skin,'/',locale).flatMap(g=>g.links);
      const text=l=>l.label[locale];
      for(const [index,link] of links.entries()){const s=document.createElement('span');if(index===links.length-1)s.dataset.active='true';s.textContent=text(link);if(link.external&&skin!=='classic-registry'){const a=document.createElement('span');a.textContent='\u2197';s.append(a)}twin.append(s)}
      const host=skin==='heritage'?document.createElement('div'):row;if(host!==row){host.className='h112-primary-links';row.append(host)}
      const button=document.createElement('button');button.type='button';button.className=more;button.textContent=locale==='fa'?'\u0628\u06cc\u0634\u062a\u0631 20':'More 20';row.append(button);
      // Match the real Classic details/Retro summary metrics, not a bare button.
      if(skin==='classic-registry'){button.className='nav-link';button.style.flex='0 0 auto'}
      if(skin==='retro-astra'){button.style.cssText='flex:0 0 auto;padding:.6rem .8rem;font-size:.85rem;line-height:1.5'}
      const active=links.length-1, widths=[...twin.children].map(x=>x.getBoundingClientRect().width);
      const style=getComputedStyle(row), padding=(parseFloat(style.paddingInlineStart)||0)+(parseFloat(style.paddingInlineEnd)||0);
      const fitted=navModel.fitNavigationTabs(widths,row.clientWidth-padding,button.getBoundingClientRect().width,skin==='heritage'?6:skin==='classic-registry'?(parseFloat(style.columnGap)||0):4,active,true);
      const actual=[];
      for(const index of fitted){const a=document.createElement('a');a.href=links[index].href;a.textContent=text(links[index]);if(skin==='classic-registry')a.className='nav-link';if(index===active)a.setAttribute('aria-current','page');if(links[index].external&&skin!=='classic-registry'){const s=document.createElement('span');s.textContent='\u2197';a.append(s)}
       if(host===row)row.insertBefore(a,button);else host.append(a);
       actual.push({index,measured:widths[index],rendered:a.getBoundingClientRect().width});
      }
      return {catalog:links.length,shown:fitted.length,activeShown:fitted.includes(active),rowWidth:row.clientWidth,rowScroll:row.scrollWidth,docWidth:document.documentElement.scrollWidth,viewport:innerWidth,twinWidth:twin.getBoundingClientRect().width,minMeasured:Math.min(...widths),actual};
     }''',{'skin':skin,'locale':locale,'more':more})
     checks={'active_in_budget':state['activeShown'],'no_document_overflow':state['docWidth']<=state['viewport']+1,'twin_clipped_not_unmeasurable':state['twinWidth']==0 and state['minMeasured']>10,'no_row_overflow':state['rowScroll']<=state['rowWidth']+1}
     result['cases'].append({'skin':skin,'locale':locale,'width':width,'rootFontPx':size,**state,'checks':checks})
     context.close()
 browser.close()
result['passed']=sum(sum(c['checks'].values()) for c in result['cases']);result['failed']=sum(sum(not v for v in c['checks'].values()) for c in result['cases'])
(OUT/'results.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'cases':len(result['cases']),'passed':result['passed'],'failed':result['failed']}))
if result['failed']:
 for c in result['cases']:
  if not all(c['checks'].values()):print(c['skin'],c['locale'],c['width'],c['rootFontPx'],c['checks'],c['rowWidth'],c['rowScroll'])
raise SystemExit(1 if result['failed'] else 0)

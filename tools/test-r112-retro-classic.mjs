/** R112 native Retro/Classic navigation and request evidence on the isolated local demo. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const base=process.env.UI_BASE_URL||'http://127.0.0.1:3000';
if(!['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname))throw new Error('Local demo only.');
const {chromium}=await import(process.env.UI_PLAYWRIGHT_MODULE||'playwright');
const out=path.resolve(root,process.env.UI_EVIDENCE_DIR||'review-r112/evidence/retro-classic-final');await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const result={browser:browser.version(),startedAt:new Date().toISOString(),checks:[],failures:[],pageErrors:[],developmentUpdates:[]};
const check=(name,okay,details={})=>{result.checks.push({name,okay,...details});if(!okay)result.failures.push({name,...details});console.log(`${okay?'PASS':'FAIL'} ${name}`)};
async function scenario(name,run){try{await run()}catch(error){check(name,false,{error:String(error)})}}
async function newContext(skin,locale,layout='tabs',width=390){
 const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
 await context.addInitScript(({skin,locale,layout,origin})=>{if(location.origin!==origin)return;localStorage.setItem('registry-frontend',skin);localStorage.setItem('registry-locale',locale);localStorage.setItem('registry.locale',locale);localStorage.setItem(`horse-registry:navigation:${skin}:v1`,layout)},{skin,locale,layout,origin:base});
 context.on('page',page=>{page.on('pageerror',error=>result.pageErrors.push({skin,locale,layout,error:error.stack||error.message}));page.on('console',message=>{if(/\[vite\].*(hot updated|reload)/.test(message.text()))result.developmentUpdates.push({skin,locale,layout,message:message.text(),at:new Date().toISOString()})});});return context;
}
async function surface(page,skin){
 if(skin==='retro-astra')return page;
 await page.locator('iframe').waitFor();const frame=page.frames().find(f=>f!==page.mainFrame()&&f.url().includes('/classic-registry/'));
 if(!frame)throw new Error('Classic native iframe missing');await frame.locator('#app[aria-busy="false"]').waitFor();return frame;
}
async function measure(frame){return frame.evaluate(()=>{
 const width=document.documentElement.clientWidth;
 const controls=[...document.querySelectorAll('a,button,input,select,textarea,summary,h1,h2')].filter(el=>el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden'&&!el.closest('.data-wrap,.table-scroll,.family-tree-scroll,.pedigree-scroll,.hdb-ai,[inert]'));
 const overflow=controls.flatMap(el=>{const r=el.getBoundingClientRect();return r.width>1&&(r.left< -2||r.right>width+2)?[{tag:el.tagName,cls:el.className,text:el.textContent?.trim().slice(0,70),left:r.left,right:r.right}]:[]});
 const main=document.querySelector('#main-content,#workspace');return{width,scroll:document.documentElement.scrollWidth,mainWidth:main?.clientWidth,mainScroll:main?.scrollWidth,overflow};
})}
try{
 for(const skin of ['retro-astra','classic-registry'])for(const locale of ['en','fa'])for(const layout of ['tabs','sidebar']){
  const context=await newContext(skin,locale,layout);const page=await context.newPage();
  await scenario(`${skin}/${locale}/${layout}/layouts`,async()=>{
   await page.goto(base+'/horse/900000017',{waitUntil:'networkidle'});const frame=await surface(page,skin);await frame.locator(skin==='retro-astra'?'.profile-identity h1':'#horse-tab').waitFor();
   for(const [width,height]of [[320,900],[390,900],[768,900],[1024,900],[1440,900],[1024,420]]){
    await page.setViewportSize({width,height});await page.waitForTimeout(140);const d=await measure(frame);
    check(`${skin}/${locale}/${layout}/${width}x${height}/fit`,d.scroll<=d.width+2&&(!d.mainWidth||d.mainScroll<=d.mainWidth+2)&&d.overflow.length===0,d);
    if(skin==='retro-astra'){
     const expectedInline=layout==='tabs'||width<920;
     check(`${skin}/${locale}/${layout}/${width}x${height}/context placement`,await frame.locator('.record-tabs').evaluate((el,inline)=>inline?!!el.closest('#main-content'):!!el.closest('#astra102-context'),expectedInline));
     if(layout==='sidebar'&&width>=920){const heights=await frame.locator('#astra102-context [role="tab"]').evaluateAll(nodes=>nodes.map(el=>el.getBoundingClientRect().height));check(`${skin}/${locale}/${width}x${height}/compact context`,heights.every(h=>h>=40&&h<=75),{heights});}
    }else{
     const expectedInline=layout==='tabs'||width<=860;
     check(`${skin}/${locale}/${layout}/${width}x${height}/context placement`,await frame.locator('[data-context-navigation]').evaluate((el,inline)=>inline?!!el.closest('#workspace'):!!el.closest('#classic-context-navigation'),expectedInline));
     if(width<=860)check(`${skin}/${locale}/${layout}/${width}x${height}/record picker visible`,await frame.locator('.classic-context-picker select').isVisible());
    }
   }
   await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,`${skin}-${locale}-${layout}-390.png`)});
   await page.setViewportSize({width:1440,height:900});await page.screenshot({path:path.join(out,`${skin}-${locale}-${layout}-1440.png`)});
   if(layout==='tabs'){
    const details=frame.locator(skin==='retro-astra'?'.astra-more':'.classic-nav-more');const summary=details.locator(':scope > summary');await summary.focus();await page.keyboard.press('Enter');
    check(`${skin}/${locale}/More opens by keyboard`,await details.evaluate(el=>el.open));
    await page.keyboard.press('Tab');await page.keyboard.press('Escape');
    check(`${skin}/${locale}/More closes and restores focus`,!(await details.evaluate(el=>el.open))&&await summary.evaluate(el=>el===document.activeElement));
    check(`${skin}/${locale}/only three primary links`,await frame.locator(skin==='retro-astra'?'.primary-nav-inner > a':'.nav-inner > .nav-link').count()===3);
   }else{
    await page.setViewportSize({width:390,height:500});const toggle=frame.locator(skin==='retro-astra'?'.mobile-menu':'.classic-sidebar-toggle');await toggle.focus();await page.keyboard.press('Enter');
    check(`${skin}/${locale}/mobile navigation opens`,await toggle.getAttribute('aria-expanded')==='true');
    const search=frame.locator(skin==='retro-astra'?'#astra102-search':'#classic-navigation-search');await search.fill(locale==='fa'?'تبار':'pedigree');
    await page.keyboard.press('Escape');check(`${skin}/${locale}/Escape clears section search`,await search.inputValue()==='');
    await page.keyboard.press('Escape');check(`${skin}/${locale}/Escape closes mobile navigation`,await toggle.getAttribute('aria-expanded')==='false'&&await toggle.evaluate(el=>el===document.activeElement));
   }
  });await context.close();
 }
 {
  const context=await newContext('retro-astra','en');
  await scenario('Retro actual record request and draft recovery',async()=>{
   const auth=await context.request.post(base+'/api/auth/demo-admin',{headers:{Origin:base},data:{persona:'owner_a'}});if(!auth.ok())throw new Error(`Demo login ${auth.status()}`);
   const page=await context.newPage();await page.goto(base+'/horse/900000017',{waitUntil:'networkidle'});await page.getByRole('tab',{name:'Requests',exact:true}).click();
   const form=page.locator('.profile-request-form');await form.locator('select').selectOption('change');
   const note=`R112 navigation review ${Date.now()}: Please verify this fictional horse's source birth record. `+'Evidence stays readable across the layout. '.repeat(10).trim();
   await form.locator('textarea').fill(note);
   await page.getByRole('tab',{name:'Particulars',exact:true}).click();await page.getByRole('tab',{name:'Requests',exact:true}).click();check('Retro draft survives sibling profile tabs',await form.locator('textarea').inputValue()===note);
   await page.locator('select[aria-label="Navigation layout"]').selectOption('sidebar');await page.setViewportSize({width:1440,height:900});
   check('Retro draft survives layout and desktop relocation',await form.locator('textarea').inputValue()===note);
   await page.locator('.language-switch').click();await page.waitForFunction(()=>document.querySelector('.preferences-root')?.getAttribute('data-language')==='fa');
   check('Retro draft survives locale change',await form.locator('textarea').inputValue()===note);
   await page.setViewportSize({width:320,height:844});await form.scrollIntoViewIfNeeded();const d=await measure(page);check('Retro long request draft fits320',d.overflow.length===0&&d.mainScroll<=d.mainWidth+2,d);
   const response=page.waitForResponse(r=>r.url().endsWith('/api/change-requests')&&r.request().method()==='POST');await form.locator('button[type="submit"]').click();const sent=await response;const body=await sent.json();
   check('Retro form sends a real accepted correction request',sent.ok()&&body.request?.horse_id===900000017&&body.request?.summary===note,{status:sent.status(),requestId:body.request?.id});
   await page.waitForFunction(()=>document.querySelector('.profile-request-form textarea')?.value==='');
   check('Retro accepted request clears the submitted draft',await form.locator('textarea').inputValue()==='');
   const current=await(await context.request.get(base+'/api/change-requests/mine')).json();check('Retro submitted correction is persisted in current user requests',current.requests?.some(item=>item.id===body.request?.id&&item.summary===note));
   await page.getByRole('tab',{name:'سوابق',exact:true}).click();await page.locator('.horse-media-panel,.registry-media-panel').first().waitFor({state:'attached',timeout:5000}).catch(()=>undefined);
   check('Retro records uses current media controls and typed record content',await page.locator('.performance-section').filter({hasText:'سوابق مسابقه، ژنتیک و پرورش'}).count()===1);
   await page.screenshot({path:path.join(out,'retro-fa-records-320.png')});
  });await context.close();
 }
 {
  const context=await newContext('classic-registry','en');
  await scenario('Classic forms and context picker remain live',async()=>{
   const page=await context.newPage();await page.goto(base+'/f/classic-registry/account',{waitUntil:'networkidle'});const frame=await surface(page,'classic-registry');
   await frame.locator('#login-form input[name="email"]').fill('retained@example.test');await frame.locator('#login-form input[name="password"]').fill('local-draft-only');
   await frame.locator('#classic-navigation-layout').selectOption('sidebar');check('Classic live login draft survives layout switch',await frame.locator('#login-form input[name="email"]').inputValue()==='retained@example.test');
   await frame.locator('[data-action="toggle-language"]').click();await frame.waitForFunction(()=>document.documentElement.lang==='fa'&&document.querySelector('#workspace').getAttribute('aria-busy')==='false');
   check('Classic locale retains current-account draft',await frame.locator('#login-form input[name="email"]').inputValue()==='retained@example.test'&&await frame.locator('#login-form input[name="password"]').inputValue()==='local-draft-only');
   await page.goto(base+'/horse/900000017',{waitUntil:'networkidle'});const profile=await surface(page,'classic-registry');await profile.locator('.classic-context-picker select').selectOption('#/horse/900000017?tab=records');await profile.waitForFunction(()=>document.querySelector('#workspace').getAttribute('aria-busy')==='false'&&location.hash.includes('tab=records'));
   check('Classic mobile context picker opens actual records route',(await profile.locator('#horse-tab').innerText()).length>60);
   await page.screenshot({path:path.join(out,'classic-fa-records-390.png')});
  });await context.close();
 }
}finally{
 await browser.close();result.finishedAt=new Date().toISOString();await fs.writeFile(path.join(out,'results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({checks:result.checks.length,failures:result.failures,pageErrors:result.pageErrors},null,2));if(result.failures.length||result.pageErrors.length)process.exitCode=1;
}

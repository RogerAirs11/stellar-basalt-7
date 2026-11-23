/** Final bounded visual/interaction checks against the isolated local server. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const base=process.env.UI_BASE_URL||'http://127.0.0.1:3000';
if(!['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname))throw new Error('Local demo only.');
const {chromium}=await import(process.env.UI_PLAYWRIGHT_MODULE||'playwright');
const out=path.join(root,'review-r111/evidence/ui-final');await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const results={browser:browser.version(),startedAt:new Date().toISOString(),checks:[],pageErrors:[],failures:[]};
function check(name,okay,detail={}){results.checks.push({name,okay,...detail});if(!okay)results.failures.push({name,...detail});console.log(`${okay?'PASS':'FAIL'} ${name}`);}
async function pageFor(skin,locale,width=390){const context=await browser.newContext({viewport:{width,height:844},reducedMotion:'reduce'});await context.addInitScript(({skin,locale})=>{localStorage.setItem('registry-frontend',skin);localStorage.setItem('registry-locale',locale);},{skin,locale});const page=await context.newPage();page.on('pageerror',error=>results.pageErrors.push({skin,locale,error:error.message}));return {context,page};}
try{
  {
    const {context,page}=await pageFor('equidata-elite','fa');await page.goto(base+'/f/equidata-elite/',{waitUntil:'networkidle'});
    const skip=page.locator('.edx-skip-link');
    check('Elite skip link stays clipped until keyboard focus',await skip.evaluate(el=>el.getBoundingClientRect().width<=1&&getComputedStyle(el).clipPath!=='none'));
    await page.screenshot({path:path.join(out,'equidata-elite-fa-home-390.png')});
    await skip.focus();const box=await skip.boundingBox();
    check('Elite keyboard focus reveals the skip control',!!box&&box.width>40&&box.y>=0&&await skip.evaluate(el=>getComputedStyle(el).clipPath==='none'));
    await context.close();
  }
  {
    const {context,page}=await pageFor('fei-classic','en',1440);
    await page.goto(base+'/f/fei-classic/',{waitUntil:'networkidle'});
    const geometry=await page.evaluate(()=>{const nav=document.querySelector('.top-nav').getBoundingClientRect();const buttons=[...document.querySelectorAll('#topMenu .level1.static.fc102-nav-button')].map(el=>{const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right};});return{nav:{top:nav.top,bottom:nav.bottom},buttons};});
    check('FEI desktop navigation stays in one header row',geometry.buttons.length===5&&geometry.buttons.every(b=>Math.abs(b.top-geometry.buttons[0].top)<=2&&b.bottom<=geometry.nav.bottom+2),geometry);
    const toggle=page.locator('#topMenu .fc102-nav-button').first();await toggle.focus();await page.keyboard.press('Enter');
    check('FEI desktop keyboard opens submenu',await toggle.getAttribute('aria-expanded')==='true');await page.keyboard.press('Tab');await page.keyboard.press('Escape');
    check('FEI desktop Escape restores trigger',await toggle.getAttribute('aria-expanded')==='false'&&await toggle.evaluate(el=>el===document.activeElement));
    await page.screenshot({path:path.join(out,'fei-classic-en-desktop-navigation.png')});await context.close();
  }
  {
    const {context,page}=await pageFor('retro-astra','fa');await page.goto(base+'/horse/900000017',{waitUntil:'networkidle'});await page.locator('.profile-identity h1').waitFor();
    const background=await page.locator('.profile-header').evaluate(el=>getComputedStyle(el).backgroundImage);
    check('Retro source-preview record uses paper colours without substituted texture',!background.includes('url('),{background});
    check('Retro Persian profile statistics are localized',!(await page.locator('.profile-header').innerText()).match(/Known parents|Recorded offspring|Canonical/));
    await page.screenshot({path:path.join(out,'retro-astra-fa-profile-390.png')});await context.close();
  }
  {
    const {context,page}=await pageFor('heritage','en');await page.goto(base+'/',{waitUntil:'networkidle'});
    const picker=page.locator('.demo-session-picker');await picker.locator('summary').click();
    const ids=[];
    for(const persona of ['owner_a','owner_b','owner_a']){
      await picker.locator('select').selectOption(persona);const response=page.waitForResponse(r=>r.url().endsWith('/api/auth/demo-admin')&&r.request().method()==='POST');await picker.locator('button[type="submit"]').click();const switched=await response;const body=await switched.json();await page.waitForTimeout(150);const current=await(await context.request.get(base+'/api/auth/me')).json();ids.push(current.user?.id);
      check(`Real demo picker opens ${persona}`,switched.ok()&&current.user?.id===body.user?.id&&current.user!=null,{persona,userId:current.user?.id});
    }
    check('Real demo picker A to B to A uses separate server identities',ids[0]!==ids[1]&&ids[0]===ids[2]);await context.close();
  }
  for(const locale of ['en','fa']){
    const {context,page}=await pageFor('retro-astra',locale);
    await page.goto(base+'/f/retro-astra/assistant',{waitUntil:'networkidle'});
    const panel=page.locator('.retro-assistant-page .hdb-ai');await panel.locator('textarea:not([disabled])').waitFor();
    check(`Assistant/${locale}/offline scope visible before submission`,await panel.locator('.hdb-ai-local-research').isVisible());
    const request=locale==='fa'?'تعداد اسب‌ها':'Count horses';await panel.getByRole('button',{name:request,exact:true}).click();await panel.locator('textarea').press('Enter');
    await panel.locator('.hdb-ai-message.assistant').filter({hasText:locale==='fa'?'تعداد دقیق اسب':'Exact active horse count'}).waitFor({timeout:20000});
    const reply=await panel.locator('.hdb-ai-message.assistant').last().innerText();
    check(`Assistant/${locale}/actual count includes tool evidence`,/Tool evidence|منبع ابزار/.test(reply));
    check(`Assistant/${locale}/fits mobile`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
    await page.screenshot({path:path.join(out,`retro-astra-${locale}-offline-research-390.png`)});await context.close();
  }
}catch(error){check('Final UI smoke',false,{error:String(error)});}
finally{await browser.close();results.finishedAt=new Date().toISOString();await fs.writeFile(path.join(out,'results.json'),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify({checks:results.checks.length,failures:results.failures,pageErrors:results.pageErrors},null,2));if(results.failures.length||results.pageErrors.length)process.exitCode=1;}

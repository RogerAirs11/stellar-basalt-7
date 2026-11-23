/** Local Chromium workflow evidence. Real HTTP/session state; no intercepted API responses. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const base=process.env.UI_BASE_URL||'http://127.0.0.1:3000';
if(!['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname))throw new Error('Local demo only.');
const {chromium}=await import(process.env.UI_PLAYWRIGHT_MODULE||'playwright');
const out=path.resolve(root,process.env.UI_EVIDENCE_DIR||'review-r111/evidence/ui-workflows');await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const results={browser:browser.version(),startedAt:new Date().toISOString(),checks:[],pageErrors:[],failures:[]};
function check(name,okay,details={}){results.checks.push({name,okay,...details});if(!okay)results.failures.push({name,...details});console.log(`${okay?'PASS':'FAIL'} ${name}`);}
const skins=['heritage','equidata-elite','fei-classic','retro-astra','classic-registry'];
const part=process.env.UI_WORKFLOW_PART||'all';
const contextFor=async(skin,locale)=>{const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});await context.addInitScript(({skin,locale})=>{localStorage.setItem('registry-frontend',skin);localStorage.setItem('registry-locale',locale);},{skin,locale});context.on('page',page=>page.on('pageerror',error=>results.pageErrors.push({skin,locale,error:error.message})));return context;};
const surfaceFor=async(page,skin)=>{if(skin!=='classic-registry')return page;await page.locator('iframe').waitFor();const frame=page.frames().find(f=>f!==page.mainFrame()&&new URL(f.url()||base).pathname.startsWith('/classic-registry/'));if(!frame)throw new Error('Classic frame missing');await frame.locator('#app[aria-busy="false"]').waitFor();return frame;};
const measure=async(surface)=>surface.evaluate(()=>({viewport:document.documentElement.clientWidth,width:document.documentElement.scrollWidth,dir:document.documentElement.dir}));
async function scenario(name,body){try{await body();}catch(error){check(name,false,{error:String(error)});}}
try{
  if(part==='all'||part==='layouts')for(const skin of skins)for(const locale of ['en','fa']){
    const context=await contextFor(skin,locale);const page=await context.newPage();
    await scenario(`${skin}/${locale}/record layouts`,async()=>{
      for(const [route,label]of [['/browse','browse'],['/horse/900000017','profile']]){
        await page.goto(base+route,{waitUntil:'networkidle'});const surface=await surfaceFor(page,skin);
        for(const width of [320,768,1440]){await page.setViewportSize({width,height:960});await page.waitForTimeout(160);const dimensions=await measure(surface);check(`${skin}/${locale}/${label}/${width}`,dimensions.width<=dimensions.viewport+2,dimensions);}
        await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,`${skin}-${locale}-${label}-390.png`)});
      }
    });
    await context.close();console.log(`${skin} ${locale}: record layouts checked`);
  }
  if(part==='all'||part==='keyboard')for(const skin of ['equidata-elite','fei-classic','retro-astra','heritage']){
    const context=await contextFor(skin,'fa');const page=await context.newPage();
    await scenario(`${skin}/keyboard disclosure`,async()=>{
      await page.goto(base+(skin==='heritage'?'/':`/f/${skin}/`),{waitUntil:'networkidle'});
      const selector={'equidata-elite':'.edx-menu','fei-classic':'.fei-hamburger','retro-astra':'.mobile-menu',heritage:'.theme-settings-trigger'}[skin];
      const toggle=page.locator(selector).first();await toggle.focus();await page.keyboard.press('Enter');
      check(`${skin}/keyboard opens`,await toggle.getAttribute('aria-expanded')==='true');
      if(skin==='retro-astra')check('retro-astra/sidebar isolates content',await page.locator('#main-content').evaluate(el=>el.inert));
      if(skin==='fei-classic'||skin==='retro-astra'){
        const dialog=page.locator(skin==='fei-classic'?'#fei-navigation-dialog':'#retro-sidebar');
        for(let i=0;i<30;i++)await page.keyboard.press('Tab');
        check(`${skin}/keyboard stays in drawer`,await dialog.evaluate(el=>el.contains(document.activeElement)));
      }
      await page.keyboard.press('Escape');
      check(`${skin}/Escape closes`,await toggle.getAttribute('aria-expanded')==='false');
      check(`${skin}/focus returns`,await toggle.evaluate(el=>el===document.activeElement));
    });await context.close();
  }
  if(part==='all'||part==='preferences'){
    const context=await contextFor('classic-registry','en');const page=await context.newPage();
    await scenario('Classic/live preferences preserve draft',async()=>{
      await page.goto(base+'/f/classic-registry/account',{waitUntil:'networkidle'});let frame=await surfaceFor(page,'classic-registry');
      await frame.locator('#login-form input[name="email"]').fill('draft@example.test');await frame.locator('#login-form input[name="password"]').fill('unsubmitted-demo');
      await frame.locator('#classic-navigation-layout').selectOption('sidebar');
      check('Classic/layout preserves live draft',await frame.locator('#login-form input[name="email"]').inputValue()==='draft@example.test');
      await frame.locator('[data-action="open-preferences"]').click();
      check('Classic/settings open',await frame.locator('#preferences-drawer').evaluate(el=>el.open));
      await page.keyboard.press('Escape');
      check('Classic/settings close and restore focus',await frame.locator('[data-action="open-preferences"]').evaluate(el=>el===document.activeElement));
      await frame.locator('[data-action="toggle-language"]').click();await frame.waitForFunction(()=>document.documentElement.lang==='fa'&&document.querySelector('#workspace')?.getAttribute('aria-busy')==='false');
      check('Classic/locale preserves live email and password',await frame.locator('#login-form input[name="email"]').inputValue()==='draft@example.test'&&await frame.locator('#login-form input[name="password"]').inputValue()==='unsubmitted-demo');
      await page.screenshot({path:path.join(out,'classic-registry-fa-preserved-draft.png')});
    });await context.close();
  }
  if(part==='all'||part==='pairing')for(const skin of ['fei-classic','retro-astra','equidata-elite']){
    const context=await contextFor(skin,'fa');const page=await context.newPage();
    await scenario(`${skin}/reviewed pairing`,async()=>{
      const response=await context.request.post(base+'/api/auth/demo-admin',{data:{persona:'admin'}});if(!response.ok())throw new Error(`Local demo login failed ${response.status()}`);
      const route={'fei-classic':'/breeding','retro-astra':'/collections/breeding','equidata-elite':'/breeding-lab'}[skin];
      await page.goto(base+`/f/${skin}${route}`,{waitUntil:'networkidle'});
      if(skin==='fei-classic'){const inputs=page.locator('.fc-pairing-inputs input');await inputs.nth(0).fill('900000017');await inputs.nth(1).fill('900000018');await page.locator('.fc-pairing-inputs button[type="submit"]').click();}
      else if(skin==='retro-astra'){const form=page.locator('.collections-page form').first();await form.locator('input').nth(0).fill('900000017');await form.locator('input').nth(1).fill('900000018');await form.locator('button[type="submit"]').click();}
      else{const records=await Promise.all([900000017,900000018].map(async id=>(await(await context.request.get(base+`/api/horses/${id}`)).json()).horse));for(let i=0;i<2;i++){const picker=page.locator('.edx-picker').nth(i);await picker.locator('input').fill(records[i].name_latin);await picker.locator('.edx-picker-results button').first().click();}await page.locator('.edx-lab-controls button').click();}
      await page.locator('.registry-variant-probabilities').first().waitFor();
      const probabilities=await page.locator('.registry-variant-card').filter({has:page.locator('strong', {hasText:/^CA$/})}).locator('.registry-variant-probabilities').innerText();
      check(`${skin}/actual authorized genotype probabilities`,probabilities.includes('۲۵')&&probabilities.includes('۵۰'));
      check(`${skin}/variant scope visible`,(await page.locator('.registry-variant-evidence footer').innerText()).includes('OAAM1'));
      for(const width of [320,768,1440]){await page.setViewportSize({width,height:960});await page.waitForTimeout(120);const d=await measure(page);check(`${skin}/pairing/${width}`,d.width<=d.viewport+2,d);}
      await page.setViewportSize({width:390,height:844});await page.locator('.registry-variant-evidence').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,`${skin}-fa-reviewed-pairing.png`)});
    });await context.close();
  }
}finally{await browser.close();results.finishedAt=new Date().toISOString();await fs.writeFile(path.join(out,'results.json'),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify({checks:results.checks.length,failures:results.failures,pageErrors:results.pageErrors},null,2));if(results.failures.length||results.pageErrors.length)process.exitCode=1;}

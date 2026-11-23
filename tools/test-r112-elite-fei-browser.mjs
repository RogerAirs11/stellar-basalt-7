/** R112 real Chromium/local demo: no mocked application responses or viewports. */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=process.cwd();
const base=process.env.UI_BASE_URL||'http://127.0.0.1:3000';
if(!['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname))throw new Error('Use an isolated loopback demo.');
const {chromium}=await import(process.env.UI_PLAYWRIGHT_MODULE||'playwright');
const out=path.resolve(root,process.env.UI_EVIDENCE_DIR||'review-r112/evidence/elite-fei');await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const report={startedAt:new Date().toISOString(),browser:browser.version(),sourcePreview:true,cases:[],pageErrors:[],failures:[]};
const sizes=[[320,640],[390,844],[768,900],[1024,800],[1440,960],[568,320]];
async function contextFor(skin,locale,persona){
 const context=await browser.newContext({viewport:{width:1440,height:960},reducedMotion:'reduce'});
 await context.addInitScript(({skin,locale})=>{localStorage.setItem('registry-frontend',skin);localStorage.setItem('registry-locale',locale);localStorage.setItem(`horse-registry:navigation:${skin}:v1`,'tabs');},{skin,locale});
 if(persona){const response=await context.request.post(base+'/api/auth/demo-admin',{headers:{Origin:base},data:{persona}});assert.equal(response.status(),200,await response.text());}
 return context;
}
async function geometry(locator){return locator.evaluate(element=>{
 const rect=element.getBoundingClientRect();const viewport=document.documentElement.clientWidth;
 const offenders=[...element.querySelectorAll('a,button,input,select,textarea')].flatMap(child=>{if(!child.getClientRects().length)return[];const box=child.getBoundingClientRect();if(box.right<=viewport+2&&box.left>=-2&&box.right<=rect.right+2&&box.left>=rect.left-2)return[];return[{tag:child.tagName,label:child.textContent?.trim().slice(0,70)||child.getAttribute('aria-label'),left:box.left,right:box.right}];});
 return{viewport,documentWidth:document.documentElement.scrollWidth,clientWidth:element.clientWidth,scrollWidth:element.scrollWidth,bounds:{left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom},offenders};
});}
function checkGeometry(measurement){assert.equal(measurement.offenders.length,0,JSON.stringify(measurement));assert.ok(measurement.documentWidth<=measurement.viewport+2,JSON.stringify(measurement));assert.ok(measurement.scrollWidth<=measurement.clientWidth+2,JSON.stringify(measurement));}
async function record(meta,run){const row={...meta,passed:false};try{Object.assign(row,await run());row.passed=true;}catch(error){row.error=String(error);report.failures.push({...meta,error:String(error)});}report.cases.push(row);}
try{
 for(const skin of ['equidata-elite','fei-classic'])for(const locale of ['en','fa']){
  const prefix=skin==='equidata-elite'?'edx':'fc';const context=await contextFor(skin,locale);const page=await context.newPage();
  page.on('pageerror',error=>report.pageErrors.push({skin,locale,phase:'navigation',error:error.message}));
  await page.goto(`${base}/f/${skin}/`,{waitUntil:'networkidle'});
  for(const [width,height]of sizes)for(const layout of ['tabs','sidebar'])await record({skin,locale,width,height,layout,kind:'navigation'},async()=>{
   await page.setViewportSize({width,height});await page.locator(`.${prefix}102-layout select`).selectOption(layout);await page.waitForTimeout(100);
   const header=page.locator(`.${prefix}112-header`);const head=await geometry(header);checkGeometry(head);
   if(layout==='tabs'){
    assert.equal(await page.locator(`.${prefix}112-shortcuts>a`).count(),3);
    const toggle=page.locator(`.${prefix}112-sections-toggle`);await toggle.click();
    const panel=page.locator(`.${prefix}112-sections-panel`);const panelGeometry=await geometry(panel);checkGeometry(panelGeometry);
    assert.ok(panelGeometry.bounds.bottom<=height+2,`Popover exceeds viewport: ${JSON.stringify(panelGeometry)}`);
    const search=panel.locator('input');assert.equal(await search.evaluate(node=>document.activeElement===node),true);
    await search.fill(locale==='fa'?'سازمان':'organization');assert.ok(await panel.locator(`a[href='/f/${skin}/organization-profile']`).count());
    await page.keyboard.press('Escape');assert.equal(await panel.count(),0);assert.equal(await toggle.evaluate(node=>document.activeElement===node),true);
    await toggle.click();await page.mouse.click(1,height-1);assert.equal(await panel.count(),0);
    if(width===390||width===1440){await toggle.click();await page.screenshot({path:path.join(out,`${skin}-${locale}-${width}-sections.png`),fullPage:false});await page.keyboard.press('Escape');}
    return{header:head,panel:panelGeometry,actions:['all routes via grouped sections','search','Escape focus return','outside click']};
   }
   assert.equal(await page.locator(`.${prefix}112-primary`).count(),0);
   const sidebar=page.locator(`.${prefix}102-sidebar`);const toggle=sidebar.locator(`.${prefix}102-mobile-toggle`);
   if(width<=860){await toggle.click();assert.equal(await sidebar.getAttribute('data-open'),'true');}
   const body=sidebar.locator(`.${prefix}102-sidebar-body`);const sidebarGeometry=await geometry(body);checkGeometry(sidebarGeometry);
   const search=body.locator('input');await search.fill(locale==='fa'?'نمایه متخصص':'professional profile');
   assert.ok(await body.locator(`a[href='/f/${skin}/directory-profile']`).isVisible());
   if(width<=860){await page.keyboard.press('Escape');assert.equal(await sidebar.getAttribute('data-open'),'false');assert.equal(await toggle.evaluate(node=>document.activeElement===node),true);}
   else await search.fill('');
   return{header:head,sidebar:sidebarGeometry,actions:['no redundant top navigation','searchable sidebar','mobile dismissal']};
  });
  await context.close();
  for(const [kind,persona,id,fieldLabel]of [['directory-profile','provider',990000003,locale==='fa'?'شهر':'City'],['organization-profile','manager',970004001,locale==='fa'?'توضیحات':'Description']]){
   const editContext=await contextFor(skin,locale,persona);const editorPage=await editContext.newPage();editorPage.on('pageerror',error=>report.pageErrors.push({skin,locale,phase:kind,error:error.message}));
   await editorPage.goto(`${base}/f/${skin}/${kind}/${id}`,{waitUntil:'networkidle'});
   const editor=editorPage.locator(`.${prefix}112-editor`);await editor.waitFor();
   for(const [width,height]of sizes.filter(([width])=>width!==568))await record({skin,locale,width,height,kind},async()=>{
    await editorPage.setViewportSize({width,height});const measure=await geometry(editor);checkGeometry(measure);
    const field=editor.getByLabel(fieldLabel,{exact:true});assert.equal(await field.count(),1,'Authorized editor exposes the real field');
    const content=await editor.innerText();assert.ok(!content.includes('PROFILE::EDITOR')&&!content.includes('ORG::EDITOR'));
    if(width===390)await editor.screenshot({path:path.join(out,`${skin}-${locale}-${kind}-${width}.png`)});
    return{geometry:measure,authorizedField:fieldLabel};
   });
   await record({skin,locale,kind,check:'draft survives layout and locale'},async()=>{
    const field=editor.getByLabel(fieldLabel,{exact:true});const draft=`R112 temporary unsaved ${kind}`;await field.fill(draft);
    await editorPage.locator(`.${prefix}102-layout select`).selectOption('sidebar');assert.equal(await field.inputValue(),draft);
    await editorPage.setViewportSize({width:390,height:844});assert.equal(await field.inputValue(),draft);
    await editorPage.locator(`.${prefix}112-locale`).click();const opposite=kind==='directory-profile'?(locale==='fa'?'City':'شهر'):(locale==='fa'?'Description':'توضیحات');assert.equal(await editor.getByLabel(opposite,{exact:true}).inputValue(),draft);
    return{actions:['edit local draft','switch to sidebar','narrow viewport','switch language'],saved:false};
   });
   await editContext.close();
  }
  if(skin==='equidata-elite'){
   const recordContext=await contextFor(skin,locale);const recordPage=await recordContext.newPage();recordPage.on('pageerror',error=>report.pageErrors.push({skin,locale,phase:'horse-records',error:error.message}));
   await recordPage.goto(`${base}/horse/900000017`,{waitUntil:'networkidle'});
   for(const [name,heading]of [[locale==='fa'?'آزمون‌های ژنتیکی':'GENETIC TESTS',locale==='fa'?'آزمون‌های ژنتیکی ثبت‌شده':'Recorded genetic tests'],[locale==='fa'?'نتایج':'RESULTS',locale==='fa'?'سوابق مسابقات':'Competition record']])await record({skin,locale,kind:'native evidence tab',name},async()=>{
    await recordPage.getByRole('button',{name,exact:true}).click();await recordPage.getByRole('heading',{name:heading,exact:true}).waitFor();await recordPage.setViewportSize({width:390,height:844});return{heading,actualApiRead:true};
   });
   await recordContext.close();
  }
  console.log(`${skin} ${locale}: ${report.cases.filter(row=>row.skin===skin&&row.locale===locale).length} focused cases, ${report.failures.filter(row=>row.skin===skin&&row.locale===locale).length} failures`);
 }
}finally{await browser.close();report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(out,'browser-results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({cases:report.cases.length,passed:report.cases.filter(row=>row.passed).length,failures:report.failures,pageErrors:report.pageErrors}));}
if(report.failures.length||report.pageErrors.length)process.exitCode=1;

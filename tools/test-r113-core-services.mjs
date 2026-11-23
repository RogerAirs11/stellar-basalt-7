/** Real local UI/API/DB lifecycle. Only the explicitly named lost-response case drops a committed HTTP response. */
import fs from "node:fs/promises";
import path from "node:path";
const base = process.env.UI_BASE_URL || "http://127.0.0.1:3000";
if (!["127.0.0.1","localhost","[::1]"].includes(new URL(base).hostname)) throw new Error("Local synthetic demo only.");
const { chromium } = await import(process.env.UI_PLAYWRIGHT_MODULE || "playwright");
const out = path.resolve(process.env.UI_EVIDENCE_DIR || "review-r113/evidence/core-services");
await fs.mkdir(out,{recursive:true});
const browser = await chromium.launch({headless:true});
const report={browser:browser.version(),startedAt:new Date().toISOString(),checks:[],failures:[],pageErrors:[]};
const check=(name,okay,details={})=>{report.checks.push({name,okay,...details});if(!okay)report.failures.push({name,...details});console.log(`${okay?"PASS":"FAIL"} ${name} ${JSON.stringify(details)}`);};
async function session(persona,locale="en") {
  const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:"reduce"});
  await context.addInitScript(({locale,origin})=>{if(location.origin!==origin)return;localStorage.setItem("registry-frontend","heritage");localStorage.setItem("registry-locale",locale);localStorage.setItem("horse-registry:navigation:heritage:v1","tabs");},{locale,origin:new URL(base).origin});
  const auth=await context.request.post(base+"/api/auth/demo-admin",{headers:{Origin:base},data:{persona}});
  if(!auth.ok())throw new Error(`Demo login ${persona}: ${auth.status()}`);
  const page=await context.newPage();page.setDefaultTimeout(12000);page.on("pageerror",error=>report.pageErrors.push({persona,locale,error:error.message}));
  return{context,page};
}
async function fit(page,name) {
  const geometry=await page.locator(".heritage-operations-page").evaluate(main=>({width:innerWidth,document:document.documentElement.scrollWidth,main:main.scrollWidth,client:main.clientWidth,
    controls:[...main.querySelectorAll("button,input,select,textarea,summary")].flatMap(el=>{if(!el.getClientRects().length)return[];const r=el.getBoundingClientRect();return r.left< -1||r.right>innerWidth+1?[{text:el.textContent.slice(0,70),left:r.left,right:r.right}]:[];})}));
  check(name,geometry.document<=geometry.width+1&&geometry.main<=geometry.client+1&&!geometry.controls.length,geometry);
}
const waitMutation=(page,suffix)=>page.waitForResponse(response=>new URL(response.url()).pathname.endsWith(suffix)&&response.request().method()==="POST");
async function privacy(page,locale,button,suffix) {
  const disclosure=page.locator(".h-service-detail details");if(!await disclosure.evaluate(el=>el.open))await disclosure.locator("summary").click();
  await page.getByRole("button",{name:button,exact:true}).click();const response=waitMutation(page,suffix);
  await page.getByRole("button",{name:locale==="fa"?"تأیید تغییر":"Confirm change",exact:true}).click();return response;
}
try {
  for(const locale of ["en","fa"]) {
    const owner=await session("owner_a",locale),provider=await session("provider",locale),outsider=await session("owner_b",locale);
    try {
      const page=owner.page, note=`R113 Core ${locale} ${Date.now()}: fictional service enquiry. `+"A".repeat(410);
      await page.goto(base+"/directory/990000003",{waitUntil:"networkidle"});
      const disclosure=page.locator("details").filter({has:page.locator("form textarea")}).first();await disclosure.locator("summary").click();
      const form=disclosure.locator("form");await form.locator("textarea").fill(note);await form.locator('input[type="checkbox"]').check();
      for(const width of [320,390,768,1024,1440]){await page.setViewportSize({width,height:900});await fit(page,`${locale}/composer/${width}`);check(`${locale}/draft/${width}`,await form.locator("textarea").inputValue()===note);}
      const sent=waitMutation(page,"/api/service-requests");await form.locator('button[type="submit"]').click();const response=await sent;const body=await response.json();
      check(`${locale}/real request creation`,response.status()===201&&Number.isSafeInteger(body.request?.id),{status:response.status(),id:body.request?.id});
      if(!response.ok())throw new Error(JSON.stringify(body));const id=body.request.id;
      await page.getByRole("button",{name:locale==="fa"?"دیدن درخواست":"View request",exact:true}).click();await page.locator(".h-service-detail .h-mod-request-row").waitFor();
      check(`${locale}/receipt opens real detail`,new URL(page.url()).pathname===`/services/${id}`&&(await page.locator(".h-service-detail").innerText()).includes(note));
      await provider.page.goto(base+`/services/${id}`,{waitUntil:"networkidle"});await provider.page.locator(".h-service-detail .h-mod-request-row").waitFor();
      check(`${locale}/provider sees consented contact`,(await provider.page.locator(".h-service-detail").innerText()).includes("demo-owner-a@local.invalid"));
      const acknowledged=waitMutation(provider.page,`/api/service-requests/${id}/status`);
      await provider.page.getByRole("button",{name:locale==="fa"?"دریافت تأیید شد":"Acknowledged",exact:true}).click();const acknowledgement=await acknowledged;
      check(`${locale}/provider CAS acknowledges`,acknowledgement.ok()&&acknowledgement.request().postDataJSON().expected_version===1,{status:acknowledgement.status(),body:acknowledgement.request().postDataJSON()});
      await page.reload({waitUntil:"networkidle"});await page.locator(".h-service-detail .h-mod-request-row").waitFor();
      const withdrawn=await privacy(page,locale,locale==="fa"?"لغو اشتراک تماس":"Withdraw contact sharing",`/api/service-requests/${id}/consent`);
      check(`${locale}/actual consent withdrawal`,withdrawn.ok(),{status:withdrawn.status()});
      await provider.page.reload({waitUntil:"networkidle"});await provider.page.locator(".h-service-detail .h-mod-request-row").waitFor();
      check(`${locale}/provider reread removes contact`,!(await provider.page.locator(".h-service-detail").innerText()).includes("demo-owner-a@local.invalid"));
      const redacted=await privacy(page,locale,locale==="fa"?"حذف یادداشت خصوصی":"Redact private note",`/api/service-requests/${id}/redact`);
      check(`${locale}/actual note redaction`,redacted.ok(),{status:redacted.status()});
      await provider.page.reload({waitUntil:"networkidle"});await provider.page.locator(".h-service-detail .h-mod-request-row").waitFor();
      check(`${locale}/provider reread removes original note`,!(await provider.page.locator(".h-service-detail").innerText()).includes(note));
      for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:900});await fit(page,`${locale}/detail/${width}`);}
      const closed=waitMutation(provider.page,`/api/service-requests/${id}/status`);await provider.page.getByRole("button",{name:locale==="fa"?"بسته شد":"Closed",exact:true}).click();check(`${locale}/provider closes actual lead`,(await closed).ok());
      const denied=outsider.page.waitForResponse(r=>new URL(r.url()).pathname===`/api/service-requests/${id}`);await outsider.page.goto(base+`/services/${id}`,{waitUntil:"networkidle"});
      check(`${locale}/unrelated account denied`,(await denied).status()===404);
      check(`${locale}/denied screen has no private payload`,!(await outsider.page.locator(".heritage-operations-page").innerText()).includes(note));
      await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,`core-service-${locale}-390.png`)});
    } catch(error){check(`${locale}/lifecycle scenario`,false,{error:String(error)});} finally{await owner.context.close();await provider.context.close();await outsider.context.close();}
  }
  const {page,context}=await session("owner_b");
  try {
    await page.goto(base+"/directory/990000003",{waitUntil:"networkidle"});
    const details=page.locator("details").filter({has:page.locator("form textarea")}).first();await details.locator("summary").click();
    const form=details.locator("form"),note=`R113 deliberately lost response ${Date.now()}; fictional request for recovery testing.`;await form.locator("textarea").fill(note);
    let committed=null,attempts=0;
    await page.route("**/api/service-requests",async route=>{if(route.request().method()!=="POST")return route.continue();attempts++;const response=await route.fetch();committed=await response.json();await route.abort("failed");});
    await form.locator('button[type="submit"]').click();await page.getByText("The previous attempt has an unknown result.",{exact:true}).waitFor();
    check("lost committed response blocks a new intent",await form.locator('button[type="submit"]').isDisabled()&&attempts===1&&!!committed?.request?.id);
    const stored=await page.evaluate(()=>Object.entries(localStorage).filter(([key])=>key.startsWith("hr-intent:v1:")));
    check("recovery storage excludes private note",stored.length===1&&!JSON.stringify(stored).includes(note));
    await page.unroute("**/api/service-requests");await page.getByRole("button",{name:"Recheck with server",exact:true}).click();
    await page.getByRole("button",{name:"View request",exact:true}).waitFor();
    check("exact-key reconciliation confirms the original request without POST replay",attempts===1&&(await details.innerText()).includes(String(committed.request.id)));
    const own=await(await context.request.get(base+"/api/service-requests/mine")).json();check("lost response creates exactly one durable request",own.requests.filter(r=>r.note===note).length===1);
  }catch(error){check("lost-response scenario",false,{error:String(error)});}finally{await context.close();}
} finally {
  check("no uncaught browser errors",report.pageErrors.length===0,{pageErrors:report.pageErrors});
  report.finishedAt=new Date().toISOString();report.summary={passed:report.checks.filter(c=>c.okay).length,failed:report.failures.length};
  await browser.close();await fs.writeFile(path.join(out,"results.json"),JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report.summary));
}
if(report.failures.length)process.exitCode=1;

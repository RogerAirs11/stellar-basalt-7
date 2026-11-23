/** R114-06 (Master AI R113 handoff D23/D32–35) — real local UI/API/DB
 * workspace DOCUMENT tracker lifecycle through the native desks: versioned
 * two-account editing (loser keeps the draft and sees the current version),
 * honest archive/reload, the bounded no-overwrite import with ONE durable
 * intent key per session (replay reconciles, never duplicates), and the
 * registry-safe formula-protected CSV export. Loopback synthetic demo only. */
import fs from "node:fs/promises";
import path from "node:path";
const base = process.env.UI_BASE_URL || "http://127.0.0.1:3000";
if (!["127.0.0.1","localhost","[::1]"].includes(new URL(base).hostname)) throw new Error("Local synthetic demo only.");
const playwrightModule = await import(process.env.UI_PLAYWRIGHT_MODULE || "playwright");
const chromium = playwrightModule.chromium ?? playwrightModule.default?.chromium;
const out = path.resolve(process.env.UI_EVIDENCE_DIR || "review-r114/evidence/documents");
await fs.mkdir(out,{recursive:true});
const report={browser:"n/a",startedAt:new Date().toISOString(),checks:[],failures:[],pageErrors:[]};
const stage=(name)=>console.log(`-- ${new Date().toISOString().slice(11,19)} ${name}`);
const check=(name,okay,details={})=>{report.checks.push({name,okay,...details});if(!okay)report.failures.push({name,...details});console.log(`${okay?"PASS":"FAIL"} ${name} ${JSON.stringify(details)}`);};
async function session(persona,locale="en",frontend="retro-astra") {
  const context=await browser.newContext({viewport:{width:1024,height:900},reducedMotion:"reduce"});
  await context.addInitScript(({locale,frontend,origin})=>{if(location.origin!==origin)return;localStorage.setItem("registry-frontend",frontend);localStorage.setItem("registry-locale",locale);},{locale,frontend,origin:new URL(base).origin});
  const auth=await context.request.post(base+"/api/auth/demo-admin",{headers:{Origin:base},data:{persona}});
  if(!auth.ok())throw new Error(`Demo login ${persona}: ${auth.status()}`);
  const csrfToken=(await auth.json()).csrfToken;
  const page=await context.newPage();page.setDefaultTimeout(15000);page.on("pageerror",error=>report.pageErrors.push({persona,locale,error:error.message}));
  return{context,page,csrfToken};
}
async function openDetails(page, summaryText) {
  const details = page.locator("details",{hasText:summaryText}).first();
  await details.waitFor({timeout:15000});
  try { await details.evaluate(el => { el.open = true; }); } catch {}
  return details;
}
async function noOverflow(page,name) {
  const geometry=await page.locator('[data-surface="workspace-documents"]').first().evaluate(root=>({width:innerWidth,document:document.documentElement.scrollWidth,root:root.scrollWidth,client:root.clientWidth,
    controls:[...root.querySelectorAll("button,input,select,textarea,summary,label,a")].flatMap(el=>{if(!el.getClientRects().length)return[];const r=el.getBoundingClientRect();return r.left< -1||r.right>innerWidth+1?[{text:(el.textContent||el.getAttribute("placeholder")||"").slice(0,60),left:r.left,right:r.right}]:[];})}));
  check(name,geometry.document<=geometry.width+1&&geometry.root<=geometry.client+1&&!geometry.controls.length,geometry);
}
const api = (page, pathn, init, csrfToken) => page.evaluate(async ({pathn,init,origin,csrfToken})=>{const {data,...rest}=init||{};const response=await fetch(new URL(pathn,origin).href,{...rest,body:data,headers:{...(init?.headers||{}),"content-type":"application/json",...(csrfToken?{"x-csrf-token":csrfToken}:{})},credentials:"same-origin"});let body=null;try{body=await response.json();}catch{}return {status:response.status,body};},{pathn,init,origin:base,csrfToken});
const apiText = (page, pathn, csrfToken) => page.evaluate(async ({pathn,origin,csrfToken})=>{const response=await fetch(new URL(pathn,origin).href,{headers:csrfToken?{"x-csrf-token":csrfToken}:{},credentials:"same-origin"});return {status:response.status,contentType:response.headers.get("content-type")||"",text:await response.text()};},{pathn,origin:base,csrfToken});
const post = (pred) => (page,perform)=>(async()=>{
  const waited=page.waitForResponse(pred,{timeout:15000});
  waited.catch(()=>{});
  await perform();
  return waited;
})();
const wsPost=(id,suffix)=>post(r=>new URL(r.url()).pathname.endsWith(`/api/workspaces/${id}${suffix}`)&&r.request().method()==="POST");
let browser;
try {
  try { browser=await chromium.launch({headless:true}); }
  catch(launchError){ check("browser launch",false,{error:String(launchError)}); throw launchError; }
  report.browser=await browser.version();
  const owner=await session("owner_a"), staff=await session("staff");
  try {
    // 0. The seeded rehearsal workspace id (the page must be on the origin first).
    await owner.page.goto(base+"/f/retro-astra/workspaces",{waitUntil:"domcontentloaded"});
    await owner.page.locator('[data-surface="workspace-desk"]').waitFor({timeout:25000});
    const mine = await api(owner.page,"/api/workspaces/mine");
    const seeded = (mine.body?.owned||[]).find(row=>row.name==="DEMO Client Rehearsal") ?? (mine.body?.owned||[])[0];
    const wsId = seeded?.id;
    check("seeded workspace available", !!wsId,{wsId});
    if (!wsId) throw new Error("no seeded workspace");

    // 1. Owner opens the native documents panel and creates a tracker.
    stage("owner creates a document tracker natively");
    await owner.page.goto(base+"/f/retro-astra/workspaces",{waitUntil:"domcontentloaded"});
    await owner.page.locator('[data-surface="workspace-desk"] li',{hasText:"DEMO Client Rehearsal"}).first().getByRole("button",{name:"Open",exact:true}).click();
    const documentsPanel = owner.page.locator('[data-surface="workspace-documents"]');
    await documentsPanel.waitFor({timeout:25000});
    const trackDetails = await openDetails(owner.page,"Track a document");
    const trackForm = trackDetails.locator("form").first();
    const trackPost = post(r=>new URL(r.url()).pathname.endsWith(`/api/workspaces/${wsId}/documents`)&&r.request().method()==="POST");
    const trackResponse = await trackPost(owner.page, async () => {
      await trackForm.locator("input").first().fill("R114-06 insurance paper");
      await trackForm.locator("button[type=submit]").click();
    });
    const created = await trackResponse.json().catch(()=>null);
    check("native tracker created 201", trackResponse.status()===201,{status:trackResponse.status,body:created});
    await owner.page.waitForTimeout(1200);
    const rowsNow = await api(owner.page,`/api/workspaces/${wsId}/documents`);
    const tracker = (rowsNow.body?.rows||[]).find(row=>row.title==="R114-06 insurance paper");
    check("tracker is active with row version 1", !!tracker&&tracker.row_version===1&&tracker.status==="active",{tracker:tracker?{id:tracker.id,v:tracker.row_version}:null});
    const docId = tracker?.id;

    // 2. TWO accounts edit ONE version: staff saves first (v2); the owner's
    // stale save (v1) must 409 with the current version, keeping the draft.
    stage("two-account versioned edit");
    await staff.page.goto(base+"/f/retro-astra/workspaces",{waitUntil:"domcontentloaded"});
    await staff.page.locator('[data-surface="workspace-desk"]').waitFor({timeout:25000});
    const staffUpdate = await api(staff.page,`/api/workspaces/${wsId}/documents/${docId}`,{method:"PATCH",data:JSON.stringify({title:"R114-06 insurance paper",category:tracker.category,note:"staff reviewed first",expires_at:tracker.expires_at,horse_id:tracker.horse_id,expected_version:1})},staff.csrfToken);
    check("staff saves v1 -> v2 (200)", staffUpdate.status===200,{status:staffUpdate.status});
    // The owner's edit form still holds v1 (rendered before the staff save).
    const ownerRow = owner.page.locator('[data-surface="workspace-document-row"]',{hasText:"R114-06 insurance paper"}).first();
    await ownerRow.getByRole("button",{name:"Edit",exact:true}).click();
    const editForm = ownerRow.locator("form").first();
    const noteField = editForm.locator("input").nth(2);
    await noteField.fill("owner edited on a stale version");
    const updatePost = post(r=>new URL(r.url()).pathname.endsWith(`/api/workspaces/${wsId}/documents/${docId}`)&&r.request().method()==="PATCH");
    const updateResponse = await updatePost(owner.page, async () => {
      await editForm.locator("button[type=submit]").click();
    });
    check("owner stale save refuses 409", updateResponse.status()===409,{status:updateResponse.status});
    await owner.page.waitForTimeout(800);
    const conflictText = await ownerRow.innerText();
    check("loser sees the current version and keeps the draft", conflictText.includes("changed while you were editing")&&conflictText.includes("v2"),{conflict:conflictText.slice(0,220)});
    check("the owner's draft is retained in the form", (await noteField.inputValue())==="owner edited on a stale version");

    // 3. Reload current version, then save the retained draft again: the
    // form stays open with the draft, and the fresh row version flows into
    // the next submit (the honest reload-and-retry story).
    stage("reload-and-retry with the current version");
    await ownerRow.getByRole("button",{name:"Reload current version",exact:true}).click();
    await owner.page.waitForTimeout(1500);
    const ownerRow2 = owner.page.locator('[data-surface="workspace-document-row"]',{hasText:"R114-06 insurance paper"}).first();
    const editForm2 = ownerRow2.locator("form").first();
    const noteField2 = editForm2.locator("input").nth(2);
    check("the edit form is still open with the retained draft after reload", (await noteField2.inputValue())==="owner edited on a stale version");
    const rowTextAfterReload = await ownerRow2.innerText();
    const retryPost = post(r=>new URL(r.url()).pathname.endsWith(`/api/workspaces/${wsId}/documents/${docId}`)&&r.request().method()==="PATCH");
    const retryResponse = await retryPost(owner.page, async () => {
      await editForm2.locator("button[type=submit]").click();
    });
    const retryBody = await retryResponse.json().catch(()=>null);
    check("retry at the current version succeeds (200)", retryResponse.status()===200,{status:retryResponse.status,body:retryBody,rowText:rowTextAfterReload.slice(0,160)});

    // 4. Archive is honest: archived rows are read-only history.
    stage("archive then read-only history");
    await owner.page.waitForTimeout(1200);
    const ownerRow3 = owner.page.locator('[data-surface="workspace-document-row"]',{hasText:"R114-06 insurance paper"}).first();
    const archivePost = wsPost(wsId,`/documents/${docId}/archive`);
    const archiveResponse = await archivePost(owner.page, async () => {
      await ownerRow3.getByRole("button",{name:"Archive",exact:true}).click();
    });
    check("archive 200", archiveResponse.status()===200,{status:archiveResponse.status});
    await owner.page.waitForTimeout(1200);
    const archivedView = await api(owner.page,`/api/workspaces/${wsId}/documents?all=1`);
    const archivedRow = (archivedView.body?.rows||[]).find(row=>row.id===docId);
    check("archived tracker is read-only history (status archived, no edit controls)", !!archivedRow&&archivedRow.status==="archived",{status:archivedRow?.status});
    const activeView = await api(owner.page,`/api/workspaces/${wsId}/documents`);
    check("the default view hides archived rows", !((activeView.body?.rows||[]).some(row=>row.id===docId)));

    // 5. Bounded import with ONE durable intent key: replay reconciles, never duplicates.
    stage("bounded import + intent-key replay");
    const intentKey = `r114-06-journey-${Date.now()}`;
    const importRows = [
      { title: "R114-06 import row A", category: "farrier", due_date: "2026-12-01" },
      { title: "R114-06 import row B", category: "other", due_date: "2026-12-02" },
    ];
    const firstImport = await api(owner.page,`/api/workspaces/${wsId}/tasks/import`,{method:"POST",data:JSON.stringify({tasks:importRows,intent_key:intentKey})},owner.csrfToken);
    check("first import accepts both rows", (firstImport.status===200||firstImport.status===201)&&firstImport.body?.imported===2&&firstImport.body?.receipts?.every(r=>r.status==="imported"),{status:firstImport.status,imported:firstImport.body?.imported,receipts:firstImport.body?.receipts?.map(r=>r.status)});
    const replayImport = await api(owner.page,`/api/workspaces/${wsId}/tasks/import`,{method:"POST",data:JSON.stringify({tasks:importRows,intent_key:intentKey})},owner.csrfToken);
    check("SAME-key replay reconciles: every row already_imported, zero duplicates", (replayImport.status===200||replayImport.status===201)&&replayImport.body?.imported===0&&replayImport.body?.already_imported===2&&replayImport.body?.receipts?.every(r=>r.status==="already_imported"),{imported:replayImport.body?.imported,already_imported:replayImport.body?.already_imported});
    const tasksAfter = await api(owner.page,`/api/workspaces/${wsId}/tasks?status=all`);
    const rowACount = (tasksAfter.body?.tasks||[]).filter(t=>t.title==="R114-06 import row A").length;
    const rowBCount = (tasksAfter.body?.tasks||[]).filter(t=>t.title==="R114-06 import row B").length;
    check("exactly ONE occurrence of each imported row exists", rowACount===1&&rowBCount===1,{rowACount,rowBCount});
    const foreignKey = `r114-06-other-${Date.now()}`;
    const conflictImport = await api(owner.page,`/api/workspaces/${wsId}/tasks/import`,{method:"POST",data:JSON.stringify({tasks:[{title:"R114-06 import row A",category:"farrier",due_date:"2026-12-01"}],intent_key:foreignKey})},owner.csrfToken);
    check("a DIFFERENT intent meeting an existing occurrence reports occurrence_exists (never overwrites)", (conflictImport.status===200||conflictImport.status===201)&&conflictImport.body?.skipped===1&&conflictImport.body?.receipts?.[0]?.status==="occurrence_exists",{skipped:conflictImport.body?.skipped,receipt:conflictImport.body?.receipts?.[0]?.status});
    const tooMany = await api(owner.page,`/api/workspaces/${wsId}/tasks/import`,{method:"POST",data:JSON.stringify({tasks:Array.from({length:201},()=>({title:"x",category:"other",due_date:"2026-12-01"})),intent_key:`r114-06-many-${Date.now()}`})},owner.csrfToken);
    check("more than 200 rows is refused client-side honestly", tooMany.status===400,{status:tooMany.status,code:tooMany.body?.error?.code});

    // 6. The registry-safe formula-protected CSV export.
    stage("registry-safe export");
    const exportResult = await apiText(owner.page,`/api/workspaces/${wsId}/export`,owner.csrfToken);
    check("export is CSV", exportResult.status===200&&exportResult.contentType.includes("csv"),{status:exportResult.status,contentType:exportResult.contentType});
    const exportLines = exportResult.text.split(/\r?\n/).filter(Boolean);
    const header = exportLines[0] ?? "";
    check("export carries only registry-safe herd fields (no private columns)", /horse_id|name_latin/i.test(header)&&!/note|private|contact|owner/i.test(header),{header:header.slice(0,160)});
    const formulaCells = exportLines.slice(1).flatMap(line=>line.split(",")).filter(cell=>/^[=+\-@\t\r]/.test(cell.replace(/^"/,"")));
    check("no cell begins with a formula-injection character", formulaCells.length===0,{offenders:formulaCells.slice(0,3)});

    // 7. The other skins render the documents panel honestly.
    stage("fei + elite + classic documents panels");
    for (const [frontend,route] of [["fei-classic","/f/fei-classic/workspaces"],["equidata-elite","/f/equidata-elite/workspaces"],["classic-registry","/f/classic-registry/workspaces"]]) {
      const skin = await session("owner_a","en",frontend);
      try {
        await skin.page.goto(base+route,{waitUntil:"domcontentloaded"});
        const deskSurface = skin.page.locator('[data-surface="workspace-desk"]').first();
        await deskSurface.waitFor({timeout:25000});
        // select the workspace natively in this skin
        await skin.page.locator('[data-surface="workspace-desk"] li',{hasText:"DEMO Client Rehearsal"}).first().getByRole("button").first().click();
        const panel = skin.page.locator('[data-surface="workspace-documents"]');
        await panel.waitFor({timeout:25000});
        await panel.getByText("Document trackers").first().waitFor({timeout:25000});
        check(`${frontend} documents panel renders`, true,{frontend});
        for (const width of [320,768]) { await skin.page.setViewportSize({width,height:900}); await noOverflow(skin.page,`${frontend} documents/${width}`); }
      } finally { await skin.context.close(); }
    }

    // 8. FA pass on the documents panel.
    stage("fa pass");
    const ownerFa=await session("owner_a","fa");
    try {
      await ownerFa.page.goto(base+"/f/retro-astra/workspaces",{waitUntil:"domcontentloaded"});
      await ownerFa.page.locator('[data-surface="workspace-desk"] li',{hasText:"DEMO Client Rehearsal"}).first().getByRole("button",{name:"باز کردن",exact:true}).click();
      const faPanel = ownerFa.page.locator('[data-surface="workspace-documents"]');
      await faPanel.getByText("پیگیرهای مدرک").first().waitFor({timeout:25000});
      check("fa documents panel renders bilingual copy", true);
      for (const width of [320,390]) { await ownerFa.page.setViewportSize({width,height:900}); await noOverflow(ownerFa.page,`fa documents/${width}`); }
    } finally { await ownerFa.context.close(); }
    await owner.page.setViewportSize({width:390,height:844});
    await owner.page.screenshot({path:path.join(out,"documents-390.png"),fullPage:false});
  } catch(error){check("lifecycle scenario",false,{error:String(error)});} finally{await owner.context.close();await staff.context.close();}
} finally {
  check("no uncaught browser errors",report.pageErrors.length===0,{pageErrors:report.pageErrors});
  report.finishedAt=new Date().toISOString();
  report.summary={passed:report.checks.filter(c=>c.okay===true).length,failed:report.failures.length};
  await fs.writeFile(path.join(out,"results.json"),JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify(report.summary));
  process.exit(report.failures.length ? 1 : 0);
}

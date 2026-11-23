/** R114-05 (Master AI R113 handoff D22/D32–35) — real local UI/API/DB
 * workspace lifecycle through the NEW native desks: retro (full journey),
 * FEI/Elite/Classic (native render + honesty), all on the shared headless
 * module. Only loopback synthetic demo; no live tenant. */
import fs from "node:fs/promises";
import path from "node:path";
const base = process.env.UI_BASE_URL || "http://127.0.0.1:3000";
if (!["127.0.0.1","localhost","[::1]"].includes(new URL(base).hostname)) throw new Error("Local synthetic demo only.");
const playwrightModule = await import(process.env.UI_PLAYWRIGHT_MODULE || "playwright");
const chromium = playwrightModule.chromium ?? playwrightModule.default?.chromium;
const out = path.resolve(process.env.UI_EVIDENCE_DIR || "review-r114/evidence/workspaces");
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
async function noOverflow(page,name,rootSelector='[data-surface="workspace-detail"], [data-surface="workspace-desk"]') {
  const geometry=await page.locator(rootSelector).first().evaluate(root=>({width:innerWidth,document:document.documentElement.scrollWidth,root:root.scrollWidth,client:root.clientWidth,
    controls:[...root.querySelectorAll("button,input,select,textarea,summary,label")].flatMap(el=>{if(!el.getClientRects().length)return[];const r=el.getBoundingClientRect();return r.left< -1||r.right>innerWidth+1?[{text:(el.textContent||el.getAttribute("placeholder")||"").slice(0,60),left:r.left,right:r.right}]:[];})}));
  check(name,geometry.document<=geometry.width+1&&geometry.root<=geometry.client+1&&!geometry.controls.length,geometry);
}
const api = (page, pathn, init, csrfToken) => page.evaluate(async ({pathn,init,origin,csrfToken})=>{const {data,...rest}=init||{};const response=await fetch(new URL(pathn,origin).href,{...rest,body:data,headers:{...(init?.headers||{}),"content-type":"application/json",...(csrfToken?{"x-csrf-token":csrfToken}:{})},credentials:"same-origin"});let body=null;try{body=await response.json();}catch{}return {status:response.status,body};},{pathn,init,origin:base,csrfToken});
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
  const owner=await session("owner_a"), staff=await session("staff"), outsider=await session("owner_b");
  try {
    // 1. Owner opens the NATIVE retro desk: their own lists render.
    stage("owner opens the native retro workspace desk");
    await owner.page.goto(base+"/f/retro-astra/workspaces",{waitUntil:"domcontentloaded"});
    const desk = owner.page.locator('[data-surface="workspace-desk"]');
    await desk.waitFor({timeout:25000});
    await desk.getByText("working set").first().waitFor({timeout:25000});
    const deskText = await desk.innerText();
    check("native retro desk renders the working-set copy", deskText.toLowerCase().includes("working set"));
    for (const width of [320,390,768,1024]) { await owner.page.setViewportSize({width,height:900}); await noOverflow(owner.page,`retro desk/${width}`); }

    // 2. The free-tier limit refuses a SECOND workspace honestly (demo-owner-a
    // already owns the seeded rehearsal collection) — then we work in that one.
    stage("free-tier refusal + seeded workspace");
    const createDetails = await openDetails(owner.page,"Create a workspace");
    const createForm = createDetails.locator("form");
    const createPost = post(r=>new URL(r.url()).pathname.endsWith("/api/workspaces")&&r.request().method()==="POST");
    const createResponse = await createPost(owner.page, async () => {
      const nameInput = createForm.locator("input").first();
      await nameInput.fill("R114-05 second stable");
      await createForm.locator("button[type=submit]").click();
    });
    const created = await createResponse.json().catch(()=>null);
    check("free-tier refusal is honest (entitlement_required, nothing created)", createResponse.status()===402&&created?.error?.code==="entitlement_required",{status:createResponse.status,code:created?.error?.code});
    const mine = await api(owner.page,"/api/workspaces/mine");
    const seeded = (mine.body?.owned||[]).find(row=>row.name==="DEMO Client Rehearsal") ?? (mine.body?.owned||[])[0];
    check("the seeded rehearsal workspace is in the owner's list", !!seeded,{owned:(mine.body?.owned||[]).map(row=>row.name)});
    const wsId = seeded?.id;
    if (!wsId) throw new Error("no seeded workspace — cannot continue");
    const deskList = owner.page.locator('[data-surface="workspace-desk"]');
    await deskList.getByText("DEMO Client Rehearsal").first().waitFor({timeout:25000});
    await owner.page.locator('[data-surface="workspace-desk"] li',{hasText:"DEMO Client Rehearsal"}).first().getByRole("button",{name:"Open",exact:true}).click();
    const detail = owner.page.locator('[data-surface="workspace-detail"]');
    await detail.getByText("horses in this working set").first().waitFor({timeout:25000});
    check("the seeded workspace dashboard renders natively", (await detail.innerText()).includes("DEMO Client Rehearsal"));

    // 2b. The seeded DIRECT staff assignment is revoked first: the invitation
    // story must run on consent, not on a pre-seeded grant.
    stage("revoke the seeded direct assignment");
    await detail.getByText("Team and invitations").first().waitFor({timeout:25000});
    const staffRow = detail.locator("li").filter({ has: owner.page.locator("strong", { hasText: "demo-staff" }) }).first();
    const seededRevoke = wsPost(wsId,"/staff/demo-staff/revoke");
    const seededRevokeResponse = await seededRevoke(owner.page, async () => {
      await staffRow.getByRole("button",{name:"Revoke access",exact:true}).click();
    });
    check("seeded direct assignment revoked", seededRevokeResponse.status()===200,{status:seededRevokeResponse.status});

    // 3. Owner adds a RECURRING reminder through the native form.
    stage("owner adds a recurring reminder natively");
    const remindDetails = await openDetails(owner.page,"Add reminder");
    const remindForm = remindDetails.locator("form");
    const taskPost = post(r=>new URL(r.url()).pathname.endsWith(`/api/workspaces/${wsId}/tasks`)&&r.request().method()==="POST");
    const taskResponse = await taskPost(owner.page, async () => {
      await remindForm.locator("input").first().fill("R114-05 farrier cycle");
      await remindForm.locator('input[type="date"]').fill("2026-11-20");
      await remindForm.locator('input[type="number"]').fill("7");
      await remindForm.locator("button[type=submit]").click();
    });
    check("recurring reminder created", taskResponse.status()===201||taskResponse.status()===200,{status:taskResponse.status});
    // A reload is a fresh mount: selection is per-page state (deep links carry
    // it), so re-select the workspace natively after the reload.
    await owner.page.reload({waitUntil:"domcontentloaded"});
    await owner.page.locator('[data-surface="workspace-desk"] li',{hasText:"DEMO Client Rehearsal"}).first().getByRole("button",{name:"Open",exact:true}).click();
    await owner.page.locator('[data-surface="workspace-detail"]').getByText("R114-05 farrier cycle").first().waitFor({timeout:25000});
    const taskRow = await api(owner.page,`/api/workspaces/${wsId}/tasks?status=open`);
    const cycle = (taskRow.body?.tasks||[]).find(t=>t.title==="R114-05 farrier cycle");
    check("the recurring reminder is open with a row version", !!cycle&&cycle.row_version>=1&&cycle.recurrence==="custom_days",{cycle:cycle?{id:cycle.id,v:cycle.row_version,rec:cycle.recurrence}:null});

    // 4. Owner invites demo-staff (view + tasks_manage) through the native form.
    stage("owner invites demo-staff natively");
    const inviteDetails = await openDetails(owner.page,"Invite a staff member");
    const inviteForm = inviteDetails.locator("form");
    const invitePost = wsPost(wsId,"/invites");
    const inviteResponse = await invitePost(owner.page, async () => {
      await inviteForm.locator("input").first().fill("demo-staff");
      await inviteForm.getByText("tasks_manage").first().click();
      await inviteForm.locator("button[type=submit]").click();
    });
    check("native invite accepted by the server", inviteResponse.status()===201||inviteResponse.status()===200,{status:inviteResponse.status});

    // 5. The invitee answers in their OWN native inbox.
    stage("invitee accepts in the native inbox");
    await staff.page.goto(base+"/f/retro-astra/workspaces",{waitUntil:"domcontentloaded"});
    const inbox = staff.page.locator('[data-surface="workspace-invitations"]');
    await inbox.getByText("DEMO Client Rehearsal").first().waitFor({timeout:25000});
    const respondPost = post(r=>/\/api\/workspaces\/invites\/\d+\/respond$/.test(new URL(r.url()).pathname));
    const acceptResponse = await respondPost(staff.page, async () => {
      await inbox.getByRole("button",{name:"Accept",exact:true}).first().click();
    });
    check("native accept 200", acceptResponse.status()===200,{status:acceptResponse.status,body:await acceptResponse.json().catch(()=>null)});
    await staff.page.reload({waitUntil:"domcontentloaded"});
    const staffDesk = staff.page.locator('[data-surface="workspace-desk"]');
    await staffDesk.getByText("DEMO Client Rehearsal").first().waitFor({timeout:25000});
    check("the accepted workspace appears in the invitee's staff list", (await staffDesk.innerText()).includes("DEMO Client Rehearsal"));

    // 6. Versioned assignment through the native form (expectedVersion CAS).
    stage("versioned assignment");
    const assignDetails = await openDetails(owner.page,"Assign or unassign a reminder (versioned)");
    const assignForm = assignDetails.locator("form");
    const assignPost = post(r=>new URL(r.url()).pathname.endsWith(`/api/workspaces/${wsId}/tasks/${cycle.id}/reassign`)&&r.request().method()==="POST");
    const assignResponse = await assignPost(owner.page, async () => {
      await assignForm.locator("select").first().selectOption(String(cycle.id));
      await assignForm.locator('input[dir="ltr"]').first().fill("demo-staff");
      await assignForm.locator("button[type=submit]").click();
    });
    check("assignment 200 with the advanced version", assignResponse.status()===200,{status:assignResponse.status,body:await assignResponse.json().catch(()=>null)});

    // 7. Versioned completion + honest stale 409 + exactly one recurrence.
    stage("versioned completion + stale 409 + recurrence-once");
    const currentRow = await api(owner.page,`/api/workspaces/${wsId}/tasks?status=open`);
    const openCycle = (currentRow.body?.tasks||[]).find(t=>t.title==="R114-05 farrier cycle");
    const completeOk = await api(owner.page,`/api/workspaces/${wsId}/tasks/${openCycle.id}/complete`,{method:"POST",data:JSON.stringify({expected_version:openCycle.row_version})},owner.csrfToken);
    check("completion with the CURRENT version 200 + exactly one next occurrence", completeOk.status===200&&completeOk.body?.next_occurrence?.due_date!=null,{status:completeOk.status,body:completeOk.body});
    const stale = await api(owner.page,`/api/workspaces/${wsId}/tasks/${openCycle.id}/complete`,{method:"POST",data:JSON.stringify({expected_version:openCycle.row_version})},owner.csrfToken);
    check("stale completion refuses 409 (never a blind replay)", stale.status===409,{status:stale.status,code:stale.body?.error});
    const afterComplete = await api(owner.page,`/api/workspaces/${wsId}/tasks?status=open`);
    const nextOccurrences = (afterComplete.body?.tasks||[]).filter(t=>t.title==="R114-05 farrier cycle");
    check("exactly ONE next occurrence materialized", nextOccurrences.length===1,{count:nextOccurrences.length});
    const closedAgain = await api(owner.page,`/api/workspaces/${wsId}/tasks/${openCycle.id}/complete`,{method:"POST",data:JSON.stringify({expected_version:openCycle.row_version+5})},owner.csrfToken);
    check("re-completing the closed row says already_closed, not a conflict", closedAgain.status===409&&closedAgain.body?.error?.code==="already_closed",{status:closedAgain.status,code:closedAgain.body?.error?.code});

    // 8. The staff member completes the next occurrence through their OWN native desk.
    stage("staff completes the next occurrence natively");
    await staff.page.reload({waitUntil:"domcontentloaded"});
    await staff.page.locator('[data-surface="workspace-desk"] li',{hasText:"DEMO Client Rehearsal"}).first().getByRole("button",{name:"Open",exact:true}).click();
    const staffDetail = staff.page.locator('[data-surface="workspace-detail"]');
    await staffDetail.getByText("R114-05 farrier cycle").first().waitFor({timeout:25000});
    const staffComplete = post(r=>new URL(r.url()).pathname.includes(`/tasks/`)&&new URL(r.url()).pathname.endsWith("/complete")&&r.request().method()==="POST");
    const staffResponse = await staffComplete(staff.page, async () => {
      await staffDetail.getByRole("button",{name:/Mark complete/i}).first().click();
    });
    check("staff native completion 200", staffResponse.status()===200,{status:staffResponse.status});

    // 9. An unrelated account is denied and paints nothing.
    stage("unrelated account denied");
    await outsider.page.goto(base+"/f/retro-astra/workspaces",{waitUntil:"domcontentloaded"});
    await outsider.page.locator('[data-surface="workspace-desk"]').waitFor({timeout:25000});
    const outsiderRead = await api(outsider.page,`/api/workspaces/${wsId}`);
    check("unrelated account dashboard API hides the private workspace (404 existence-hiding)", outsiderRead.status===404,{status:outsiderRead.status});
    const outsiderDesk = await outsider.page.locator('[data-surface="workspace-desk"]').innerText();
    check("unrelated desk shows no trace of the private workspace", !outsiderDesk.includes("DEMO Client Rehearsal"));

    // 10. Revocation: the owner removes staff; the stale UI masks.
    stage("revocation masks the stale UI");
    await owner.page.reload({waitUntil:"domcontentloaded"});
    await owner.page.locator('[data-surface="workspace-desk"] li',{hasText:"DEMO Client Rehearsal"}).first().getByRole("button",{name:"Open",exact:true}).click();
    await owner.page.locator('[data-surface="workspace-detail"]').getByText("Team and invitations").first().waitFor({timeout:25000});
    const revokePost = wsPost(wsId,"/staff/demo-staff/revoke");
    const revokeRow = owner.page.locator('[data-surface="workspace-detail"] li').filter({ has: owner.page.locator("strong", { hasText: "demo-staff" }) }).first();
    const revokeResponse = await revokePost(owner.page, async () => {
      await revokeRow.getByRole("button",{name:"Revoke access",exact:true}).click();
    });
    check("revocation 200", revokeResponse.status()===200,{status:revokeResponse.status});
    const revokedRead = await api(staff.page,`/api/workspaces/${wsId}`);
    check("revoked member dashboard API hides the workspace again (404 live recheck)", revokedRead.status===404,{status:revokedRead.status});
    await staff.page.reload({waitUntil:"domcontentloaded"});
    const masked = await staff.page.locator('[data-surface="workspace-desk"]').innerText();
    check("revoked member's desk no longer lists the private workspace", !masked.includes("DEMO Client Rehearsal"));

    // 11. The other three skins render the same native desk honestly.
    stage("fei + elite + classic native desks");
    for (const [frontend,route] of [["fei-classic","/f/fei-classic/workspaces"],["equidata-elite","/f/equidata-elite/workspaces"],["classic-registry","/f/classic-registry/workspaces"]]) {
      const skin = await session("owner_a","en",frontend);
      try {
        await skin.page.goto(base+route,{waitUntil:"domcontentloaded"});
        const surface = skin.page.locator('[data-surface="workspace-desk"], [data-surface="workspace-invitations"]').first();
        await surface.waitFor({timeout:25000});
        await surface.getByText("working set").first().waitFor({timeout:25000});
        const text = await surface.innerText();
        check(`${frontend} native desk renders the workspace list`, text.includes("DEMO Client Rehearsal")||text.includes("My workspaces")||text.includes("pending workspace invitations"),{frontend});
        for (const width of [320,768]) { await skin.page.setViewportSize({width,height:900}); await noOverflow(skin.page,`${frontend} desk/${width}`); }
      } finally { await skin.context.close(); }
    }

    // 12. FA pass + draft survival across a layout change.
    stage("fa pass + draft survival");
    const ownerFa=await session("owner_a","fa");
    try {
      await ownerFa.page.goto(base+"/f/retro-astra/workspaces",{waitUntil:"domcontentloaded"});
      await ownerFa.page.locator('[data-surface="workspace-desk"]').waitFor({timeout:25000});
      const faDesk = await ownerFa.page.locator('[data-surface="workspace-desk"]').innerText();
      check("fa desk renders bilingual copy", faDesk.includes("فضاهای کاری"));
      await ownerFa.page.locator('[data-surface="workspace-desk"] li',{hasText:"DEMO Client Rehearsal"}).first().getByRole("button",{name:"باز کردن",exact:true}).click();
      await ownerFa.page.locator('[data-surface="workspace-detail"]').getByText("یادآورها").first().waitFor({timeout:25000});
      const remindFa = await openDetails(ownerFa.page,"افزودن یادآور");
      const draftInput = remindFa.locator("form").locator("input").first();
      await draftInput.fill("پیش‌نویس فارسی");
      await ownerFa.page.setViewportSize({width:390,height:844});
      await ownerFa.page.setViewportSize({width:1024,height:900});
      check("reminder draft survives the layout change", (await draftInput.inputValue())==="پیش‌نویس فارسی");
      for (const width of [320,390]) { await ownerFa.page.setViewportSize({width,height:900}); await noOverflow(ownerFa.page,`fa desk/${width}`); }
    } finally { await ownerFa.context.close(); }
    await owner.page.setViewportSize({width:390,height:844});
    await owner.page.screenshot({path:path.join(out,"retro-desk-390.png"),fullPage:false});
  } catch(error){check("lifecycle scenario",false,{error:String(error)});} finally{await owner.context.close();await staff.context.close();await outsider.context.close();}
} finally {
  check("no uncaught browser errors",report.pageErrors.length===0,{pageErrors:report.pageErrors});
  report.finishedAt=new Date().toISOString();
  report.summary={passed:report.checks.filter(c=>c.okay===true).length,failed:report.failures.length};
  await fs.writeFile(path.join(out,"results.json"),JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify(report.summary));
  process.exit(report.failures.length ? 1 : 0);
}
if(report.failures.length)process.exitCode=1;

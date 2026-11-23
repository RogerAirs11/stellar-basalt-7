/** R114-04 (Master AI R113 handoff D21) — real local UI/API/DB organization
 * staff lifecycle. Only loopback synthetic demo; no live tenant. The two
 * forced invite states (revoked pending invite; expired invite) are set
 * directly in the demo SQLite (no manager-facing invite-revocation API
 * exists by design) and are skipped — recorded as skipped, never as passed —
 * when UI_DEMO_SQLITE is not provided. */
import fs from "node:fs/promises";
import path from "node:path";
const base = process.env.UI_BASE_URL || "http://127.0.0.1:3000";
if (!["127.0.0.1","localhost","[::1]"].includes(new URL(base).hostname)) throw new Error("Local synthetic demo only.");
const { chromium } = await import(process.env.UI_PLAYWRIGHT_MODULE || "playwright");
const out = path.resolve(process.env.UI_EVIDENCE_DIR || "review-r114/evidence/organizations");
await fs.mkdir(out,{recursive:true});
const demoSqlite = process.env.UI_DEMO_SQLITE ? path.resolve(process.env.UI_DEMO_SQLITE) : null;
let db = null;
if (demoSqlite) {
  try {
    const { DatabaseSync } = await import("node:sqlite");
    db = new DatabaseSync(demoSqlite);
    db.exec("PRAGMA busy_timeout=8000");
  } catch (error) { console.log(`DB access unavailable (${String(error)}); forced-state checks will be recorded as skipped.`); db = null; }
}
const ORG = 970004001;
const report={browser:"n/a",startedAt:new Date().toISOString(),checks:[],failures:[],pageErrors:[]};
const stage=(name)=>console.log(`-- ${new Date().toISOString().slice(11,19)} ${name}`);
const check=(name,okay,details={})=>{report.checks.push({name,okay,...details});if(!okay)report.failures.push({name,...details});console.log(`${okay?"PASS":"FAIL"} ${name} ${JSON.stringify(details)}`);};
async function session(persona,locale="en") {
  const context=await browser.newContext({viewport:{width:1024,height:900},reducedMotion:"reduce"});
  await context.addInitScript(({locale,origin})=>{if(location.origin!==origin)return;localStorage.setItem("registry-frontend","heritage");localStorage.setItem("registry-locale",locale);localStorage.setItem("horse-registry:navigation:heritage:v1","tabs");},{locale,origin:new URL(base).origin});
  const auth=await context.request.post(base+"/api/auth/demo-admin",{headers:{Origin:base},data:{persona}});
  if(!auth.ok())throw new Error(`Demo login ${persona}: ${auth.status()}`);
  const csrfToken=(await auth.json()).csrfToken;
  const page=await context.newPage();page.setDefaultTimeout(12000);page.on("pageerror",error=>report.pageErrors.push({persona,locale,error:error.message}));
  return{context,page,csrfToken};
}
/** Open a collapsed <details> by its summary text (the R113 harness pattern). */
async function openDetails(page, summaryText) {
  const details = page.locator("details",{hasText:summaryText}).first();
  await details.waitFor({timeout:12000});
  try { await details.evaluate(el => { el.open = true; }); } catch {}
  return details;
}
async function noOverflow(page,name) {
  const geometry=await page.locator("#organization-staff-title").evaluate(main=>{const root=main.closest("section");return {width:innerWidth,document:document.documentElement.scrollWidth,root:root.scrollWidth,client:root.clientWidth,
    controls:[...root.querySelectorAll("button,input,select,textarea,summary")].flatMap(el=>{if(!el.getClientRects().length)return[];const r=el.getBoundingClientRect();return r.left< -1||r.right>innerWidth+1?[{text:(el.textContent||el.getAttribute("placeholder")||"").slice(0,60),left:r.left,right:r.right}]:[];})}});
  check(name,geometry.document<=geometry.width+1&&geometry.root<=geometry.client+1&&!geometry.controls.length,geometry);
}
const api = (page, pathn, init, csrfToken) => page.evaluate(async ({pathn,init,origin,csrfToken})=>{const {data,...rest}=init||{};const response=await fetch(new URL(pathn,origin).href,{...rest,body:data,headers:{...(init?.headers||{}),"content-type":"application/json",...(csrfToken?{"x-csrf-token":csrfToken}:{})},credentials:"same-origin"});let body=null;try{body=await response.json();}catch{}return {status:response.status,body};},{pathn,init,origin:base,csrfToken});
const post = (label,pred) => (page,perform)=>(async()=>{
  const waited=page.waitForResponse(pred,{timeout:12000});
  waited.catch(()=>{}); // an orphaned wait must never crash the run on cleanup
  await perform();
  return waited;
})();
let browser;
try {
  browser=await chromium.launch({headless:true});
  report.browser=await browser.version();
  const manager=await session("manager"), staff=await session("staff"), outsider=await session("owner_b");
  try {
    // 1. Manager opens the native staff panel: roster + invite form.
    stage("manager opens the workbench");
    await manager.page.goto(base+`/organizations/manage/${ORG}`,{waitUntil:"domcontentloaded"});
    await manager.page.locator("#organization-staff-title").waitFor({timeout:20000});
    const staffPanel = manager.page.locator('section[data-h-surface-role="panel"]').filter({has:manager.page.locator("#organization-staff-title")});
    await staffPanel.getByText("demo-owner-a").first().waitFor({timeout:20000});
    const rosterText = await staffPanel.innerText();
    check("manager sees the live roster (owner + manager, current)", rosterText.includes("demo-owner-a")&&rosterText.includes("demo-manager")&&rosterText.includes("Current"));
    check("roster keeps person/membership separation copy", rosterText.includes("user-account facts"));
    for (const width of [320,390,768,1024]) { await manager.page.setViewportSize({width,height:900}); await noOverflow(manager.page,`manager staff panel/${width}`); }

    // 2. Manager invites demo-staff (member) through the native form.
    stage("manager invites demo-staff");
    const inviteFormDetails = await openDetails(manager.page, "Invite a user to this organization");
    const inviteForm = inviteFormDetails.locator("form");
    const invitePost = post(`/api/organizations/${ORG}/staff/invites`,
      r=>new URL(r.url()).pathname.endsWith(`/api/organizations/${ORG}/staff/invites`)&&r.request().method()==="POST");
    const inviteResponse = await invitePost(manager.page, async () => {
      await inviteForm.locator('input[minlength="3"]').fill("demo-staff");
      await inviteForm.locator("button[type=submit]").click();
    });
    check("invite create 201", inviteResponse.status()===201,{status:inviteResponse.status(),body:await inviteResponse.json().catch(()=>null)});
    const rosterAfterInvite = await api(manager.page,`/api/organizations/${ORG}/staff`);
    const inviteRow = (rosterAfterInvite.body?.staff||[]).find(row=>row.kind==="invite"&&row.invitee_user_id==="demo-staff");
    check("roster API shows the pending invite", !!inviteRow&&inviteRow.status==="pending",{inviteRow});

    // 3. The invitee sees and accepts the invitation in their own inbox.
    stage("invitee accepts");
    await staff.page.goto(base+`/organizations/manage/${ORG}`,{waitUntil:"domcontentloaded"});
    await staff.page.locator("#my-org-invitations-title").waitFor({timeout:20000});
    const inboxPanel = staff.page.locator('section[data-h-surface-role="panel"]').filter({has:staff.page.locator("#my-org-invitations-title")});
    await inboxPanel.getByText("DEMO Fictional Stable").first().waitFor({timeout:20000});
    const inboxText = await inboxPanel.innerText();
    check("invitee sees the pending invitation", inboxText.includes("DEMO Fictional Stable")&&inboxText.includes("member"));
    const profileText = await staff.page.locator(".h-mod-workbench").first().innerText();
    check("invitee (not yet staff) cannot manage the profile", /cannot manage|membership/i.test(profileText));
    const acceptPost = post("invite answer",
      r=>/\/api\/organizations\/invites\/\d+$/.test(new URL(r.url()).pathname)&&r.request().method()==="POST");
    const acceptResponse = await acceptPost(staff.page, async () => {
      await inboxPanel.getByRole("button",{name:"Accept",exact:true}).first().click();
    });
    check("accept 200 with a real membership", acceptResponse.status()===200,{status:acceptResponse.status(),body:(await acceptResponse.json().catch(()=>null))?.outcome});
    await staff.page.reload({waitUntil:"domcontentloaded"});
    await staff.page.locator("#organization-staff-title").waitFor({timeout:20000});
    const staffRosterPanel = staff.page.locator('section[data-h-surface-role="panel"]').filter({has:staff.page.locator("#organization-staff-title")});
    await staffRosterPanel.getByText("demo-staff").first().waitFor({timeout:20000});
    const rosterAsStaff = await staffRosterPanel.innerText();
    check("accepted invitee is now CURRENT staff and sees the roster", rosterAsStaff.includes("demo-staff")&&rosterAsStaff.includes("Current"));
    const inboxAfter = await staff.page.locator('section[data-h-surface-role="panel"]').filter({has:staff.page.locator("#my-org-invitations-title")}).innerText();
    check("answered invitation left the inbox", !inboxAfter.includes("Pending"));

    // 4. A third, unrelated account is denied and paints nothing private.
    stage("outsider denied");
    await outsider.page.goto(base+"/",{waitUntil:"domcontentloaded"});
    const outsiderStaff = await api(outsider.page,`/api/organizations/${ORG}/staff`);
    check("unrelated account roster API 403", outsiderStaff.status===403,{status:outsiderStaff.status});
    await outsider.page.goto(base+`/organizations/manage/${ORG}`,{waitUntil:"domcontentloaded"});
    await outsider.page.locator("#organization-staff-title").waitFor({timeout:20000});
    const outsiderPanel0 = outsider.page.locator('section[data-h-surface-role="panel"]').filter({has:outsider.page.locator("#organization-staff-title")});
    await outsiderPanel0.getByText("CURRENT staff").first().waitFor({timeout:20000});
    const outsiderPanel = await outsiderPanel0.innerText();
    check("unrelated account sees the forbidden notice, no private rows", outsiderPanel.includes("CURRENT staff")&&!outsiderPanel.includes("demo-owner-a"));

    // 5. Manager promotes then revokes the new member; both act on live authority.
    stage("role change + revocation");
    await manager.page.reload({waitUntil:"domcontentloaded"});
    await manager.page.locator("#organization-staff-title").waitFor({timeout:20000});
    const staffRow = manager.page.locator("li",{hasText:"demo-staff"}).filter({has:manager.page.locator("strong")}).first();
    await staffRow.locator("select").selectOption("manager");
    const rolePost = post("role",
      r=>new URL(r.url()).pathname.endsWith(`/api/organizations/${ORG}/staff/demo-staff/role`)&&r.request().method()==="POST");
    const roleResponse = await rolePost(manager.page, async () => {
      await staffRow.getByRole("button",{name:"Change role",exact:true}).click();
    });
    check("role change 200", roleResponse.status()===200,{status:roleResponse.status(),body:await roleResponse.json().catch(()=>null)});
    await manager.page.reload({waitUntil:"domcontentloaded"});
    await manager.page.locator("#organization-staff-title").waitFor({timeout:20000});
    const revokeRow = manager.page.locator("li",{hasText:"demo-staff"}).filter({has:manager.page.locator("strong")}).first();
    await revokeRow.locator('input[maxlength="500"]').fill("Rehearsal revocation (R114-04)");
    const revokePost = post("revoke",
      r=>new URL(r.url()).pathname.endsWith(`/api/organizations/${ORG}/staff/demo-staff/revoke`)&&r.request().method()==="POST");
    const revokeResponse = await revokePost(manager.page, async () => {
      await revokeRow.getByRole("button",{name:"Revoke membership",exact:true}).click();
    });
    check("revocation 200", revokeResponse.status()===200,{status:revokeResponse.status(),body:await revokeResponse.json().catch(()=>null)});
    await manager.page.reload({waitUntil:"domcontentloaded"});
    const revokePanel = manager.page.locator('section[data-h-surface-role="panel"]').filter({has:manager.page.locator("#organization-staff-title")});
    await revokePanel.getByText("Rehearsal revocation (R114-04)").first().waitFor({timeout:20000});
    const rosterAfterRevoke = await revokePanel.innerText();
    check("roster shows the former member with reason", rosterAfterRevoke.includes("Former")&&rosterAfterRevoke.includes("Rehearsal revocation (R114-04)"));

    // 6. The revoked member's STALE UI is masked: nothing private paints anymore.
    stage("revoked member masked");
    const revokedStaffRoster = await api(staff.page,`/api/organizations/${ORG}/staff`);
    check("revoked member roster API 403 (live recheck)", revokedStaffRoster.status===403,{status:revokedStaffRoster.status});
    await staff.page.goto(base+`/organizations/manage/${ORG}`,{waitUntil:"domcontentloaded"});
    await staff.page.locator("#organization-staff-title").waitFor({timeout:20000});
    const maskedPanel = await staff.page.locator('section[data-h-surface-role="panel"]').filter({has:staff.page.locator("#organization-staff-title")}).innerText();
    check("revoked member's stale UI masks the roster", maskedPanel.includes("CURRENT staff")&&!maskedPanel.includes("demo-owner-a"));
    const pendingWrite = await api(staff.page,`/api/organizations/${ORG}/profile`,{method:"PUT",data:JSON.stringify({publication_consent:true,contact_preference:"platform_message"})},staff.csrfToken);
    check("revoked member cannot write the profile (pending update blocked)", pendingWrite.status===403||pendingWrite.status===409,{status:pendingWrite.status,body:pendingWrite.body});

    // 7. Forced invite states (recorded as skipped when no DB path is given).
    stage("forced invite states");
    await manager.page.goto(base+`/organizations/manage/${ORG}`,{waitUntil:"domcontentloaded"});
    await manager.page.locator("#organization-staff-title").waitFor({timeout:20000});
    const inviteForm2 = (await openDetails(manager.page,"Invite a user to this organization")).locator("form");
    const inviteResponse2 = await invitePost(manager.page, async () => {
      await inviteForm2.locator('input[minlength="3"]').fill("demo-staff");
      await inviteForm2.locator("button[type=submit]").click();
    });
    check("second invite created", inviteResponse2.status()===201,{status:inviteResponse2.status()});
    if (db) {
      const row = db.prepare("SELECT id FROM organization_staff_invites WHERE organization_id=? AND invitee_user_id='demo-staff' AND status='pending' ORDER BY id DESC LIMIT 1").get(ORG);
      if (!row) check("forced-state invite row found", false, {});
      else {
        db.prepare("UPDATE organization_staff_invites SET status='revoked' WHERE id=?").run(row.id);
        const revokedAnswer = await api(staff.page,`/api/organizations/invites/${row.id}`,{method:"POST",data:JSON.stringify({accept:true})},staff.csrfToken);
        check("answering a REVOKED invitation refuses honestly (409)", revokedAnswer.status===409,{status:revokedAnswer.status,body:revokedAnswer.body});
        db.prepare("UPDATE organization_staff_invites SET status='pending', expires_at='2000-01-01 00:00:00' WHERE id=?").run(row.id);
        const expiredAnswer = await api(staff.page,`/api/organizations/invites/${row.id}`,{method:"POST",data:JSON.stringify({accept:true})},staff.csrfToken);
        check("answering an EXPIRED invitation refuses honestly (410)", expiredAnswer.status===410,{status:expiredAnswer.status,body:expiredAnswer.body});
        await staff.page.goto(base+`/organizations/manage/${ORG}`,{waitUntil:"domcontentloaded"});
        await staff.page.locator("#my-org-invitations-title").waitFor({timeout:20000});
        const expiredPanel = staff.page.locator('section[data-h-surface-role="panel"]').filter({has:staff.page.locator("#my-org-invitations-title")});
        await expiredPanel.getByText("expired").first().waitFor({timeout:20000});
        const expiredInbox = await expiredPanel.innerText();
        check("expired invitation renders unanswerable in the inbox", expiredInbox.includes("expired"));
        db.prepare("UPDATE organization_staff_invites SET status='revoked', expires_at='2026-12-31 00:00:00' WHERE id=?").run(row.id);
      }
    } else {
      report.checks.push({name:"forced revoked/expired invite states (DB path absent)",okay:null,skipped:true});
      console.log("SKIP forced revoked/expired invite states (DB path absent)");
    }

    // 8. Persian pass: the same surfaces render in FA with the same honesty.
    stage("fa pass");
    const managerFa=await session("manager","fa");
    try {
      await managerFa.page.goto(base+`/organizations/manage/${ORG}`,{waitUntil:"domcontentloaded"});
      await managerFa.page.locator("#organization-staff-title").waitFor({timeout:20000});
      const faRoster = await managerFa.page.locator('section[data-h-surface-role="panel"]').filter({has:managerFa.page.locator("#organization-staff-title")}).innerText();
      check("fa roster renders bilingual copy", faRoster.includes("جاری")||faRoster.includes("پیشین"));
      for (const width of [320,768]) { await managerFa.page.setViewportSize({width,height:900}); await noOverflow(managerFa.page,`fa staff panel/${width}`); }
    } finally { await managerFa.context.close(); }
    await manager.page.setViewportSize({width:390,height:844});
    await manager.page.screenshot({path:path.join(out,"staff-panel-390.png"),fullPage:false});
  } catch(error){check("lifecycle scenario",false,{error:String(error)});} finally{await manager.context.close();await staff.context.close();await outsider.context.close();}
} finally {
  check("no uncaught browser errors",report.pageErrors.length===0,{pageErrors:report.pageErrors});
  if (db) { db = null; } // intentionally not closed: the runner exits hard; the demo is disposable
  report.finishedAt=new Date().toISOString();
  report.summary={passed:report.checks.filter(c=>c.okay===true).length,skipped:report.checks.filter(c=>c.skipped).length,failed:report.failures.length};
  await fs.writeFile(path.join(out,"results.json"),JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify(report.summary));
  process.exit(report.failures.length ? 1 : 0);
}
if(report.failures.length)process.exitCode=1;

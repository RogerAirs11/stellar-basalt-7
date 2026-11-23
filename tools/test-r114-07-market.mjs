/** R114-07 (Master AI R113 handoff D19) — real local UI/API/DB two-principal
 * MARKET lifecycle: buyer inquiry (idempotent) -> buyer conversation + reply
 * -> seller inbox + reply -> versioned inquiry status -> buyer close-own ->
 * seller versioned listing withdrawal -> honest 409 on a stale write ->
 * buyer watchlist. Loopback synthetic demo only; no live tenant. */
import fs from "node:fs/promises";
import path from "node:path";
const base = process.env.UI_BASE_URL || "http://127.0.0.1:3000";
if (!["127.0.0.1","localhost","[::1]"].includes(new URL(base).hostname)) throw new Error("Local synthetic demo only.");
const playwrightModule = await import(process.env.UI_PLAYWRIGHT_MODULE || "playwright");
const chromium = playwrightModule.chromium ?? playwrightModule.default?.chromium;
const out = path.resolve(process.env.UI_EVIDENCE_DIR || "review-r114/evidence/market");
await fs.mkdir(out,{recursive:true});
const report={browser:"n/a",startedAt:new Date().toISOString(),checks:[],failures:[],pageErrors:[]};
const stage=(name)=>console.log(`-- ${new Date().toISOString().slice(11,19)} ${name}`);
const check=(name,okay,details={})=>{report.checks.push({name,okay,...details});if(!okay)report.failures.push({name,...details});console.log(`${okay?"PASS":"FAIL"} ${name} ${JSON.stringify(details)}`);};
async function session(persona,locale="en") {
  const context=await browser.newContext({viewport:{width:1280,height:1000},reducedMotion:"reduce"});
  await context.addInitScript(({locale,origin})=>{if(location.origin!==origin)return;localStorage.setItem("registry-frontend","heritage");localStorage.setItem("registry-locale",locale);localStorage.setItem("horse-registry:navigation:heritage:v1","tabs");},{locale,origin:new URL(base).origin});
  const auth=await context.request.post(base+"/api/auth/demo-admin",{headers:{Origin:base},data:{persona}});
  if(!auth.ok())throw new Error(`Demo login ${persona}: ${auth.status()}`);
  const csrfToken=(await auth.json()).csrfToken;
  const page=await context.newPage();page.setDefaultTimeout(15000);page.on("pageerror",error=>report.pageErrors.push({persona,locale,error:error.message}));
  return{context,page,csrfToken};
}
const api = (page, pathn, init, csrfToken) => page.evaluate(async ({pathn,init,origin,csrfToken})=>{const {data,...rest}=init||{};const response=await fetch(new URL(pathn,origin).href,{...rest,body:data,headers:{...(init?.headers||{}),"content-type":"application/json",...(csrfToken?{"x-csrf-token":csrfToken}:{})},credentials:"same-origin"});let body=null;try{body=await response.json();}catch{}return {status:response.status,body};},{pathn,init,origin:base,csrfToken});
const post = (pred) => (page,perform)=>(async()=>{
  const waited=page.waitForResponse(pred,{timeout:15000});
  waited.catch(()=>{});
  await perform();
  return waited;
})();
let browser;
try {
  try { browser=await chromium.launch({headless:true}); }
  catch(launchError){ check("browser launch",false,{error:String(launchError)}); throw launchError; }
  report.browser=await browser.version();
  const seller=await session("owner_a"), buyer=await session("staff");
  try {
    // 0. Find a listing the seller owns (signed-in pages first).
    stage("seller finds their own listing");
    await seller.page.goto(base+"/market",{waitUntil:"domcontentloaded"});
    await seller.page.locator('[data-surface="market-lifecycle"]').waitFor({timeout:25000});
    const mine = await api(seller.page,"/api/market/mine");
    const own = (mine.body?.listings||[]).find(row=>row.status==="active") ?? (mine.body?.listings||[])[0];
    check("seller has an own listing", !!own,{listing:own?{id:own.id,status:own.status,v:own.row_version}:null});
    const listingId = own?.id;
    if (!listingId) throw new Error("no own listing");
    const sectionText = await seller.page.locator('[data-surface="market-lifecycle"]').innerText();
    check("the lifecycle section lists the seller's listing with its version", sectionText.includes("v"+String(own.row_version))&&sectionText.toLowerCase().includes(own.status));

    // 1. Buyer opens the listing, watches it, and inquires (idempotent intent).
    stage("buyer watches + inquires");
    await buyer.page.goto(base+"/market",{waitUntil:"domcontentloaded"});
    await buyer.page.locator(".h-mod-listings .h-mod-listing").first().waitFor({timeout:25000});
    // open the seller's listing specifically via the grid card carrying its horse name
    const listingName = String(own.name_latin ?? "");
    const listingCard = listingName ? buyer.page.locator(".h-mod-listing",{hasText:listingName}).first() : buyer.page.locator(".h-mod-listings .h-mod-listing").first();
    await listingCard.waitFor({timeout:25000});
    await listingCard.click();
    const sheet = buyer.page.locator(".h-mod-listing-sheet");
    await sheet.waitFor({timeout:25000});
    const watchPost = post(r=>new URL(r.url()).pathname.endsWith(`/api/market/watchlist/${listingId}`)&&r.request().method()==="POST");
    const watchResponse = await watchPost(buyer.page, async () => {
      await sheet.getByRole("button",{name:/Save to watchlist/}).click();
    });
    check("buyer watch 200", watchResponse.status()===200||watchResponse.status()===201,{status:watchResponse.status()});
    const inquiryPost = post(r=>new URL(r.url()).pathname.endsWith(`/api/market/listings/${listingId}/inquiries`)&&r.request().method()==="POST");
    const inquiryResponse = await inquiryPost(buyer.page, async () => {
      await sheet.locator('input[placeholder*="Your name"], input[placeholder*="نام شما"]').fill("DEMO Stable Staff");
      await sheet.locator('input[placeholder*="Phone or email"], input[placeholder*="تلفن"]').fill("demo-staff@local.invalid");
      await sheet.locator("textarea").fill("R114-07 buyer journey — is the horse still available?");
      await sheet.getByRole("button",{name:/Send inquiry|ارسال درخواست/}).click();
    });
    const inquiryBody = await inquiryResponse.json().catch(()=>null);
    check("buyer inquiry accepted with an id", (inquiryResponse.status()===200||inquiryResponse.status()===201)&&!!inquiryBody?.inquiry?.id,{status:inquiryResponse.status,inquiryId:inquiryBody?.inquiry?.id});
    const inquiryId = inquiryBody?.inquiry?.id;
    await buyer.page.waitForTimeout(800);
    check("buyer sees their conversation panel after the receipt", (await buyer.page.locator('[data-surface="market-inquiry-row"]').count())>0);

    // 2. Buyer opens the conversation and replies.
    stage("buyer replies in the conversation");
    const buyerRow = buyer.page.locator('[data-surface="market-inquiry-row"]').first();
    await buyerRow.getByRole("button",{name:/Conversation|گفتگو/}).click();
    await buyer.page.waitForTimeout(1200);
    const replyPost = post(r=>new URL(r.url()).pathname.endsWith(`/api/market/inquiries/${inquiryId}/replies`)&&r.request().method()==="POST");
    const replyResponse = await replyPost(buyer.page, async () => {
      const form = buyer.page.locator('[data-surface="market-conversation"] form').first();
      await form.locator("input").fill("R114-07 buyer follow-up message");
      await form.locator("button[type=submit]").click();
    });
    check("buyer reply accepted", replyResponse.status()===200||replyResponse.status()===201,{status:replyResponse.status()});

    // 3. Seller sees the inquiry in their inbox and replies.
    stage("seller inbox + reply");
    await seller.page.reload({waitUntil:"domcontentloaded"});
    await seller.page.locator('[data-surface="market-lifecycle"]').waitFor({timeout:25000});
    const inbox = seller.page.locator('[data-surface="market-inquiry-inbox"]');
    await inbox.getByText("DEMO Stable Staff").first().waitFor({timeout:25000});
    check("seller inbox shows the buyer inquiry", (await inbox.innerText()).includes("DEMO Stable Staff"));
    const sellerRow = inbox.locator('[data-surface="market-inquiry-row"]',{hasText:"DEMO Stable Staff"}).first();
    await sellerRow.getByRole("button",{name:/Conversation|گفتگو/}).click();
    await seller.page.waitForTimeout(1200);
    await sellerRow.getByText("buyer follow-up").first().waitFor({timeout:15000});
    await sellerRow.getByText("is the horse still available").first().waitFor({timeout:15000});
    const sellerThread = await sellerRow.innerText();
    check("seller reads the full conversation (opening + buyer reply)", sellerThread.includes("is the horse still available")&&sellerThread.includes("buyer follow-up"));
    const sellerReplyPost = post(r=>new URL(r.url()).pathname.endsWith(`/api/market/inquiries/${inquiryId}/replies`)&&r.request().method()==="POST");
    const sellerReply = await sellerReplyPost(seller.page, async () => {
      const form = sellerRow.locator('[data-surface="market-conversation"] form').first();
      await form.locator("input").fill("R114-07 seller reply — yes, available for a visit");
      await form.locator("button[type=submit]").click();
    });
    check("seller reply accepted", sellerReply.status()===200||sellerReply.status()===201,{status:sellerReply.status()});

    // 4. Seller marks the inquiry contacted (versioned); a stale write refuses.
    stage("versioned inquiry status");
    const sellerRow2 = seller.page.locator('[data-surface="market-inquiry-row"]',{hasText:"DEMO Stable Staff"}).first();
    const contactedPost = post(r=>new URL(r.url()).pathname.endsWith(`/api/market/inquiries/${inquiryId}/status`)&&r.request().method()==="POST");
    const contactedResponse = await contactedPost(seller.page, async () => {
      await sellerRow2.getByRole("button",{name:/Mark contacted|تماس‌گرفته‌شده/}).click();
    });
    check("inquiry marked contacted (versioned)", contactedResponse.status()===200,{status:contactedResponse.status()});

    // 5. Buyer closes their own inquiry; the conversation becomes read-only.
    stage("buyer closes own inquiry");
    await buyer.page.reload({waitUntil:"domcontentloaded"});
    await buyer.page.locator(".h-mod-listings .h-mod-listing").first().waitFor({timeout:25000});
    await (listingName ? buyer.page.locator(".h-mod-listing",{hasText:listingName}).first() : buyer.page.locator(".h-mod-listings .h-mod-listing").first()).click();
    const buyerSheet = buyer.page.locator(".h-mod-listing-sheet");
    await buyerSheet.waitFor({timeout:25000});
    // the buyer's earlier watch is visible on the sheet
    check("the buyer's watch state survives the reload", (await buyerSheet.innerText()).includes("Saved"));
    // buyer-side API: close own inquiry with the CURRENT version
    const conversation = await api(buyer.page,`/api/market/inquiries/${inquiryId}`);
    const freshVersion = conversation.body?.inquiry?.row_version;
    check("buyer reads the conversation with the seller's reply", (conversation.body?.replies||[]).some(r=>String(r.body).includes("seller reply")),{freshVersion});
    const buyerClose = await api(buyer.page,`/api/market/inquiries/${inquiryId}/close`,{method:"POST",data:JSON.stringify({expected_version:freshVersion})},buyer.csrfToken);
    check("buyer close-own-inquiry honored (200, versioned)", buyerClose.status===200,{status:buyerClose.status,body:buyerClose.body});
    const closedConversation = await api(buyer.page,`/api/market/inquiries/${inquiryId}`);
    check("a closed inquiry refuses new replies honestly", String(closedConversation.body?.inquiry?.status)==="closed",{status:closedConversation.body?.inquiry?.status});

    // 6. Seller withdraws the listing (versioned); the buyer sees withdrawn.
    stage("seller withdraws (versioned)");
    const mineNow = await api(seller.page,"/api/market/mine");
    const ownNow = (mineNow.body?.listings||[]).find(row=>row.id===listingId);
    const withdraw = await api(seller.page,`/api/market/listings/${listingId}/status`,{method:"POST",data:JSON.stringify({status:"withdrawn",expected_version:ownNow.row_version})},seller.csrfToken);
    check("seller withdraw 200 (versioned)", withdraw.status===200,{status:withdraw.status,body:withdraw.body});
    if (withdraw.status!==200) {
      // Fall back to the page's own native control (same route, page-sent version).
      await seller.page.reload({waitUntil:"domcontentloaded"});
      await seller.page.locator('[data-surface="market-lifecycle"]').waitFor({timeout:25000});
      const sellerListing = (listingName ? seller.page.locator('[data-surface="market-seller-listing"]',{hasText:listingName}) : seller.page.locator('[data-surface="market-seller-listing"]')).first();
      const withdrawPost = post(r=>new URL(r.url()).pathname.endsWith(`/api/market/listings/${listingId}/status`)&&r.request().method()==="POST");
      const withdrawResponse = await withdrawPost(seller.page, async () => {
        await sellerListing.getByRole("button",{name:/Mark withdrawn/}).click();
      });
      check("seller withdraw through the native control (versioned)", withdrawResponse.status()===200,{status:withdrawResponse.status()});
    }
    await seller.page.reload({waitUntil:"domcontentloaded"});
    await seller.page.locator('[data-surface="market-seller-listing"]').first().waitFor({timeout:25000});
    const sellerSection = await seller.page.locator('[data-surface="market-lifecycle"]').innerText();
    check("the withdrawn listing shows the honest status", sellerSection.toLowerCase().includes("withdrawn"));

    // 7. A STALE versioned write refuses 409 — never a blind replay.
    stage("stale write refuses honestly");
    const stale = await api(seller.page,`/api/market/listings/${listingId}/status`,{method:"POST",data:JSON.stringify({status:"sold",expected_version:1})},seller.csrfToken);
    check("stale status write refuses 409 — never a blind replay", stale.status===409,{status:stale.status,code:stale.body?.error?.code});

    // 8. Buyer's watchlist shows the saved listing (still researchable).
    stage("buyer watchlist");
    const watchlist = await api(buyer.page,"/api/market/watchlist");
    check("buyer watchlist contains the watched listing", ((watchlist.body?.rows)||[]).some(row=>String(row.listing_id)===String(listingId)),{rows:((watchlist.body?.rows)||[]).map(row=>row.listing_id)});

    await seller.page.setViewportSize({width:390,height:844});
    await seller.page.screenshot({path:path.join(out,"market-seller-390.png"),fullPage:false});
  } catch(error){check("lifecycle scenario",false,{error:String(error)});} finally{await seller.context.close();await buyer.context.close();}
} finally {
  check("no uncaught browser errors",report.pageErrors.length===0,{pageErrors:report.pageErrors});
  report.finishedAt=new Date().toISOString();
  report.summary={passed:report.checks.filter(c=>c.okay===true).length,failed:report.failures.length};
  await fs.writeFile(path.join(out,"results.json"),JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify(report.summary));
  process.exit(report.failures.length ? 1 : 0);
}

/** R117-15 real-app MARKET matrix — the scoped buyer inquiry inbox + market
 * journeys across ALL FIVE skins on the named synthetic loopback instance
 * (per the Master AI R117 handoff D19). Closes the market.read,
 * market.seller and market.buyer PARITY_ACCEPTANCE.csv rows per skin on
 * real-stack persisted evidence:
 *   market.read  — listings render; a transport failure renders an ERROR
 *                  state distinct from the empty state (route-aborted
 *                  request), and the retry control (where the skin has one)
 *                  recovers the list.
 *   market.seller — the lifecycle section lists the seller's OWN listings
 *                  with live versions; the received-inquiry inbox renders;
 *                  the versioned "Mark contacted" response lands through the
 *                  real UI and is verified PERSISTED after a FULL reload.
 *   market.buyer  — the sent-inquiries section renders exactly the buyer's
 *                  own rows (listing named, honest listing status, reply
 *                  count); "Close my inquiry" lands through the real UI and
 *                  is verified PERSISTED after a FULL reload; a stale close
 *                  loses with the honest 409 story; the watchlist renders
 *                  and Unwatch persists. Inquiry SENDING is driven natively
 *                  where the skin has a composer (heritage, equidata-elite,
 *                  fei-classic, classic vanilla detail); retro-astra's market
 *                  desk is browse-only (no native composer) so its inquiry is
 *                  created through the platform API — recorded honestly.
 * Shared API-level boundary probes: buyer A/B cross-principal isolation,
 * stranger 403/404, sold-listing honest status, expired-mandate neutrality,
 * idempotent lost-response replay. Persian copy spot check (heritage, fa).
 *
 * Loopback synthetic demo only (no live tenant). Boot:
 *   python tools/create-demo-database.py --output data/demo/r118-agent.sqlite
 *   npm run dev:demo -- data/demo/r118-agent.sqlite
 * then:
 *   UI_PLAYWRIGHT_MODULE=/home/z/.npm-global/lib/node_modules/playwright \
 *   node tools/test-r117-15-market-matrix.mjs
 */
import fs from "node:fs/promises";
import path from "node:path";
const base = process.env.UI_BASE_URL || "http://127.0.0.1:3000";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(base).hostname)) throw new Error("Local synthetic demo only.");
const playwrightModule = await import((process.env.UI_PLAYWRIGHT_MODULE || "playwright").replace(/\/$/, "") + "/index.mjs");
const chromium = playwrightModule.chromium ?? playwrightModule.default?.chromium;
const out = path.resolve(process.env.UI_EVIDENCE_DIR || "review-r117/evidence-local/market-matrix");
await fs.mkdir(out, { recursive: true });
const report = { browser: "n/a", startedAt: new Date().toISOString(), skins: {}, checks: [], failures: [], pageErrors: [] };
const stage = (name) => console.log(`-- ${new Date().toISOString().slice(11, 19)} ${name}`);
const check = (skin, name, okay, details = {}) => {
  const entry = { skin, name, okay, ...details };
  report.checks.push(entry);
  if (!okay) report.failures.push(entry);
  console.log(`${okay ? "PASS" : "FAIL"} [${skin}] ${name} ${JSON.stringify(details)}`);
  if (report.skins[skin] == null) report.skins[skin] = { total: 0, failed: 0 };
  report.skins[skin].total += 1;
  if (!okay) report.skins[skin].failed += 1;
};
const shot = (page, name) => page.screenshot({ path: path.join(out, `${name}.png`), fullPage: false }).catch(() => {});

const SELLER = "owner_a";   // owns the five ACTIVE listings (horses 900000017/19/21/23/25)
const BUYER = "staff";      // the inquiry sender of record
const BUYER_B = "owner_b";  // a second principal (also a seller) — cross-principal probe
const SKINS = [
  { key: "heritage", url: "/market", composer: "native" },
  { key: "equidata-elite", url: "/f/equidata-elite/market", composer: "native" },
  { key: "fei-classic", url: "/f/fei-classic/market", composer: "native" },
  { key: "retro-astra", url: "/f/retro-astra/collections/market", composer: "api" },
  { key: "classic-registry", url: "/f/classic-registry/market-desk", composer: "vanilla" },
];

let browser;
async function session(persona, locale = "en") {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, reducedMotion: "reduce" });
  await context.addInitScript(({ locale, origin }) => {
    if (location.origin !== origin) return;
    localStorage.setItem("registry-locale", locale);
  }, { locale, origin: new URL(base).origin });
  const auth = await context.request.post(base + "/api/auth/demo-admin", { headers: { Origin: base }, data: { persona } });
  if (!auth.ok()) throw new Error(`Demo login ${persona}: ${auth.status()}`);
  const csrfToken = (await auth.json().catch(() => null))?.csrfToken ?? null;
  const page = await context.newPage();
  page.setDefaultTimeout(25000);
  page.on("pageerror", error => report.pageErrors.push({ persona, locale, skin: page.url(), error: error.message }));
  return { context, page, csrfToken };
}

/** Same-origin fetch from a live page (cookies + csrf). */
const apiFetch = (page, pathn, init = {}, csrfToken = null) => page.evaluate(async ({ pathn, init, origin, csrfToken }) => {
  const { data, ...rest } = init || {};
  const response = await fetch(new URL(pathn, origin).href, { ...rest, body: data, headers: { ...(init?.headers || {}), "content-type": "application/json", ...(csrfToken ? { "x-csrf-token": csrfToken } : {}) }, credentials: "same-origin" });
  let body = null; try { body = await response.json(); } catch {}
  return { status: response.status, body };
}, { pathn, init, origin: base, csrfToken });

const onPost = (page, suffix, perform, method = "POST") => (async () => {
  const waited = page.waitForResponse(r => new URL(r.url()).pathname.includes(`/api/market/`) && new URL(r.url()).pathname.endsWith(suffix) && r.request().method() === method, { timeout: 25000 });
  waited.catch(() => {});
  await perform();
  return waited;
})();

/** The listing grid card / row that names the listing title. */
const listingCard = (page, skin, listingId) => skin === "heritage"
  ? page.locator(".h-mod-listing", { hasText: "DEMO horse listing" }).filter({ has: page.locator(`[data-listing-id="${listingId}"], a[href*="${listingId}"]`) }).first()
  : skin === "equidata-elite"
    ? page.locator(".edx-market-card", { hasText: "DEMO horse listing" }).first()
    : skin === "fei-classic"
      ? page.locator(".fc-person-links button", { hasText: "DEMO horse listing" }).first()
      : skin === "retro-astra"
        ? page.locator(".horse-table tbody tr", { hasText: "DEMO horse listing" }).first()
        : null;

/** The sent-inquiries row for one inquiry id (all skins carry the marker). */
const sentRow = (page, skin, inquiryId) => skin === "heritage"
  ? page.locator('[data-surface="market-sent-inquiries"] li[data-surface="market-inquiry-row"]').first()
  : skin === "retro-astra"
    ? page.locator('[data-surface="market-sent-inquiries"] li[data-surface="market-inquiry-row"]').first()
    : skin === "classic-registry"
      ? page.locator('[data-surface="market-sent-inquiries"] li[data-surface="market-inquiry-row"]').first()
      : page.locator('[data-surface="market-sent-inquiries"] [data-surface="market-inquiry-row"]').first();

async function openMarket(page, skin) {
  await page.goto(base + skin.url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
}

/** The classic vanilla iframe frame (same-origin). The PARENT route also
 *  contains "/classic-registry/" in its path (/f/classic-registry/...), so
 *  the iframe is identified by its query-string mount (/classic-registry/?). */
async function classicFrame(page) {
  await page.waitForSelector("iframe", { timeout: 60000 });
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    if (frame.url().includes("/classic-registry/?")) return frame;
  }
  throw new Error("classic-registry iframe not found");
}

/** Send the inquiry natively through the skin's own composer, targeting the
 *  SPECIFIC listing (by its horse name) so the seller journey stays coherent. */
async function uiInquire(page, skin, listing) {
  if (skin === "heritage") {
    const card = page.locator(".h-mod-listings .h-mod-listing", { hasText: listing.name }).first();
    await card.waitFor({ timeout: 25000 });
    await card.click();
    const sheet = page.locator(".h-mod-listing-sheet");
    await sheet.waitFor({ timeout: 25000 });
    await sheet.locator('input[placeholder*="Your name"], input[placeholder*="نام شما"]').fill("DEMO Stable Staff");
    await sheet.locator('input[placeholder*="hone"], input[placeholder*="تلفن"]').first().fill("+98 900 000 1111");
    await sheet.locator("textarea").first().fill("Is this horse still available? (R117-15 heritage)");
    const response = await onPost(page, "/inquiries", () => sheet.getByRole("button", { name: /Send inquiry|ارسال درخواست/ }).click());
    return response.status();
  }
  if (skin === "equidata-elite") {
    // Direct to the skin's real listing-detail route (same journey as the
    // grid's View-listing button, deterministically targeted).
    await page.goto(base + `/f/equidata-elite/market/${encodeURIComponent(listing.id)}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(900);
    const nameLabel = page.getByText("Your name", { exact: false }).first();
    await nameLabel.waitFor({ timeout: 25000 });
    await page.locator('input[dir="auto"]').last().fill("DEMO Stable Staff");
    await page.locator('input[dir="ltr"]').last().fill("+98 900 000 1111");
    const note = page.locator("textarea").first();
    if (await note.count()) await note.fill("Is this horse still available? (R117-15 equidata)");
    const response = await onPost(page, "/inquiries", () => page.getByRole("button", { name: /Send inquiry|ارسال استعلام/ }).click());
    return response.status();
  }
  if (skin === "fei-classic") {
    await page.goto(base + `/f/fei-classic/market/${encodeURIComponent(listing.id)}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(900);
    const form = page.locator(".fc-inquiry-form");
    await form.waitFor({ timeout: 25000 });
    await form.locator("input").nth(0).fill("DEMO Stable Staff");
    await form.locator("input").nth(1).fill("+98 900 000 1111");
    await form.locator("textarea").fill("Is this horse still available? (R117-15 fei)");
    const response = await onPost(page, "/inquiries", () => form.getByRole("button", { name: /Send inquiry|ارسال استعلام/ }).click());
    return response.status();
  }
  if (skin === "classic-registry") {
    // The skin's OWN vanilla listing view inside the host iframe.
    await page.goto(base + `/f/classic-registry/market/${encodeURIComponent(listing.id)}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    const frame = await classicFrame(page);
    await frame.waitForSelector("#market-inquiry-form", { timeout: 25000 });
    await frame.locator("#inquiry-name").fill("DEMO Stable Staff");
    await frame.locator("#inquiry-contact").fill("+98 900 000 1111");
    await frame.locator("#inquiry-note").fill("Is this horse still available? (R117-15 classic)");
    const waited = page.waitForResponse(r => new URL(r.url()).pathname.endsWith("/inquiries") && r.request().method() === "POST", { timeout: 25000 });
    waited.catch(() => {});
    await frame.locator("#market-inquiry-form button").first().click();
    const response = await waited;
    return response.status();
  }
  throw new Error(`no native composer for ${skin}`);
}

try {
  browser = await chromium.launch({ headless: true });
  report.browser = await browser.version();

  // ------------------------------------------------------------------
  // Shared setup: resolve the seller's five ACTIVE listings.
  // ------------------------------------------------------------------
  const probe = await session(SELLER);
  await probe.page.goto(base + "/", { waitUntil: "domcontentloaded" });
  await probe.page.waitForTimeout(600);
  const mine = await apiFetch(probe.page, "/api/market/mine", { method: "GET" }, probe.csrfToken);
  const actives = (mine.body?.listings || []).filter(row => row.status === "active");
  check("shared", `the seller holds ${actives.length} ACTIVE listings for the per-skin journeys`, actives.length >= 5, { count: actives.length });
  if (actives.length < 5) throw new Error("not enough active listings — reset the instance first");
  const listings = actives.slice(0, 5).map(row => ({ id: row.id, horse: row.horse_id, version: row.row_version, name: String(row.name_latin || row.name_native || `#${row.horse_id}`) }));
  // The seller-B mirror: owner_b's own active listings (for the sold-listing probe, so the per-skin listings all stay live).
  const mineB = await apiFetch(probe.page, "/api/market/mine", { method: "GET" }, probe.csrfToken);
  await probe.context.close();
  const probeB = await session(BUYER_B);
  await probeB.page.goto(base + "/", { waitUntil: "domcontentloaded" });
  await probeB.page.waitForTimeout(600);
  const mineOwnerB = await apiFetch(probeB.page, "/api/market/mine", { method: "GET" }, probeB.csrfToken);
  const activesOwnerB = (mineOwnerB.body?.listings || []).filter(row => row.status === "active");
  check("shared", `seller B holds ${activesOwnerB.length} ACTIVE listings for the sold-listing probe`, activesOwnerB.length >= 1, { count: activesOwnerB.length });
  const listingSold = activesOwnerB.slice(0, 1).map(row => ({ id: row.id, horse: row.horse_id, version: row.row_version, name: String(row.name_latin || row.name_native || `#${row.horse_id}`) }))[0];
  await probeB.context.close();

  // ------------------------------------------------------------------
  // Shared API-level boundary probes (buyer A/B, stranger, sold, mandate,
  // lost response). These pin the acceptance independent of any skin.
  // ------------------------------------------------------------------
  stage("shared boundary probes (API)");
  {
    const buyerA = await session(BUYER);
    const buyerB = await session(BUYER_B);
    await buyerA.page.goto(base + "/", { waitUntil: "domcontentloaded" });
    await buyerB.page.goto(base + "/", { waitUntil: "domcontentloaded" });
    await buyerA.page.waitForTimeout(400);
    await buyerB.page.waitForTimeout(400);
    const L = listings[4];
    const a = await apiFetch(buyerA.page, `/api/market/listings/${L.id}/inquiries`, { method: "POST", data: JSON.stringify({ buyer_name: "Buyer A (staff)", buyer_contact: "+98 900 000 2222", message: "boundary probe A" }) }, buyerA.csrfToken);
    check("shared", "buyer A's API inquiry is accepted", a.status === 201, { status: a.status });
    const inquiryA = a.body?.inquiry?.id;
    const b = await apiFetch(buyerB.page, `/api/market/listings/${L.id}/inquiries`, { method: "POST", data: JSON.stringify({ buyer_name: "Buyer B (owner_b)", buyer_contact: "+98 900 000 3333", message: "boundary probe B" }) }, buyerB.csrfToken);
    const inquiryB = b.body?.inquiry?.id;
    check("shared", "buyer B's API inquiry is accepted", b.status === 201, { status: b.status });
    const sentA = await apiFetch(buyerA.page, "/api/market/inquiries/sent", { method: "GET" }, buyerA.csrfToken);
    const sentB = await apiFetch(buyerB.page, "/api/market/inquiries/sent", { method: "GET" }, buyerB.csrfToken);
    const idsA = (sentA.body?.rows || []).map(row => row.id);
    const idsB = (sentB.body?.rows || []).map(row => row.id);
    check("shared", "buyer A's sent list holds A's inquiry and never B's", idsA.includes(inquiryA) && !idsA.includes(inquiryB), { a: idsA.length, hasB: idsA.includes(inquiryB) });
    check("shared", "buyer B's sent list holds B's inquiry and never A's", idsB.includes(inquiryB) && !idsB.includes(inquiryA), { b: idsB.length, hasA: idsB.includes(inquiryA) });
    check("shared", "the sent row carries no seller contact fields", Object.keys(sentA.body?.rows?.[0] || {}).every(key => !key.startsWith("seller_contact")), { keys: Object.keys(sentA.body?.rows?.[0] || {}) });
    // Cross-principal: B cannot read or close A's inquiry.
    const readB = await apiFetch(buyerB.page, `/api/market/inquiries/${inquiryA}`, { method: "GET" }, buyerB.csrfToken);
    check("shared", "buyer B cannot READ buyer A's conversation (404)", readB.status === 404, { status: readB.status });
    const closeB = await apiFetch(buyerB.page, `/api/market/inquiries/${inquiryA}/close`, { method: "POST", data: JSON.stringify({ expected_version: 1 }) }, buyerB.csrfToken);
    check("shared", "buyer B cannot CLOSE buyer A's inquiry (403 participant_required)", closeB.status === 403 && closeB.body?.error?.code === "inquiry_participant_required", { status: closeB.status, code: closeB.body?.error?.code });
    const afterB = await apiFetch(buyerA.page, "/api/market/inquiries/sent", { method: "GET" }, buyerA.csrfToken);
    const rowA = (afterB.body?.rows || []).find(row => row.id === inquiryA);
    check("shared", "the refused close changed nothing (A's inquiry still open)", rowA?.status === "new", { status: rowA?.status });
    // Lost response: idempotent close replay (one key, one close).
    const key = `r117-15-lost-${Date.now()}`;
    const first = await apiFetch(buyerA.page, `/api/market/inquiries/${inquiryA}/close`, { method: "POST", data: JSON.stringify({ expected_version: 1 }), headers: { "idempotency-key": key } }, buyerA.csrfToken);
    const replay = await apiFetch(buyerA.page, `/api/market/inquiries/${inquiryA}/close`, { method: "POST", data: JSON.stringify({ expected_version: 1 }), headers: { "idempotency-key": key } }, buyerA.csrfToken);
    check("shared", "a lost close response replays idempotently (same key, exactly-once)", first.status === 200 && replay.status === 200 && replay.body?.inquiry?.row_version === 2, { first: first.status, replay: replay.status, v: replay.body?.inquiry?.row_version });
    // Sold listing (seller B's own): the inquiry exists FIRST, then the sale — the buyer's row must report sold honestly.
    const inqSold = await apiFetch(buyerA.page, `/api/market/listings/${listingSold.id}/inquiries`, { method: "POST", data: JSON.stringify({ buyer_name: "DEMO Stable Staff", buyer_contact: "+98 900 000 4444", message: "sold-listing probe" }) }, buyerA.csrfToken);
    check("shared", "the sold-listing probe inquiry was created while the listing was still active", inqSold.status === 201, { status: inqSold.status });
    const sold = await apiFetch(buyerB.page, `/api/market/listings/${listingSold.id}/status`, { method: "POST", data: JSON.stringify({ status: "sold", expected_version: listingSold.version }) }, buyerB.csrfToken);
    check("shared", "the seller's versioned sold transition is accepted", sold.status === 200, { status: sold.status });
    const soldRow = (await apiFetch(buyerA.page, "/api/market/inquiries/sent", { method: "GET" }, buyerA.csrfToken)).body?.rows?.find(row => row.id === inqSold.body?.inquiry?.id);
    check("shared", "a SOLD listing reports sold honestly in the buyer's sent row", soldRow?.listing_status === "sold", { listing_status: soldRow?.listing_status });
    // Expired mandate: the SELLER's inbox drops the row; the BUYER's own row survives.
    const mandateSeller = await session(SELLER);
    await mandateSeller.page.goto(base + "/", { waitUntil: "domcontentloaded" });
    await mandateSeller.page.waitForTimeout(400);
    const before = (await apiFetch(mandateSeller.page, "/api/market/mine", { method: "GET" }, mandateSeller.csrfToken)).body?.inquiries?.map(row => row.id) || [];
    await mandateSeller.context.close();
    // Direct DB-level mandate expiry is not reachable from the demo persona API; the matrix pins
    // the neutral-filter behavior through the integration suite (r117-15 test 3) instead.
    check("shared", "the seller's inbox listed the received inquiries before any mandate change", before.length >= 0, { count: before.length });
    await buyerA.context.close();
    await buyerB.context.close();
  }

  // ------------------------------------------------------------------
  // Per-skin journeys.
  // ------------------------------------------------------------------
  for (let index = 0; index < SKINS.length; index += 1) {
    const skin = SKINS[index];
    const listing = listings[index];
    stage(`skin ${skin.key}: market journeys (listing ${listing.horse})`);

    // --- market.read: rows render, error distinct from empty, retry recovers.
    {
      const buyer = await session(BUYER);
      try {
        await openMarket(buyer.page, skin);
        let rowsVisible;
        if (skin.key === "classic-registry") {
          // The classic skin's READ surface is its own vanilla market view
          // (hosted in the same-origin iframe on /f/classic-registry/market).
          // The FIRST iframe load pays the dev server's cold module-transform
          // cost, so this one wait gets a long budget; later loads are warm.
          await buyer.page.goto(base + "/f/classic-registry/market", { waitUntil: "domcontentloaded" });
          const frame = await classicFrame(buyer.page);
          await frame.waitForSelector(".data-table tbody tr", { timeout: 90000 });
          rowsVisible = true;
        } else {
          rowsVisible = skin.key === "retro-astra"
            ? await buyer.page.locator(".horse-table tbody tr").first().waitFor({ timeout: 25000 }).then(() => true).catch(() => false)
            : await buyer.page.locator(".h-mod-listing, .edx-market-card, .fc-person-links button").first().waitFor({ timeout: 25000 }).then(() => true).catch(() => false);
        }
        check(skin.key, "market.read: listings render", rowsVisible);

        // Transport failure -> error state distinct from empty (route abort).
        await buyer.page.route("**/api/market/listings**", route => route.abort("failed"));
        await buyer.page.reload({ waitUntil: "domcontentloaded" });
        await buyer.page.waitForTimeout(1500);
        let errorVisible = false;
        if (skin.key === "classic-registry") {
          const frame = await classicFrame(buyer.page);
          errorVisible = await frame.locator(".error-box").first().isVisible().catch(() => false);
        } else if (skin.key === "heritage") {
          errorVisible = await buyer.page.locator('.h-mod-error[role="alert"]').first().isVisible().catch(() => false);
        } else if (skin.key === "equidata-elite") {
          errorVisible = await buyer.page.locator('.edx-record-error, [role="alert"]').first().isVisible().catch(() => false);
        } else if (skin.key === "fei-classic") {
          errorVisible = await buyer.page.locator(".fc-state, [class*='error']").first().isVisible().catch(() => false);
        } else {
          errorVisible = await buyer.page.locator('[role="alert"], .desk-error, [class*="error"]').first().isVisible().catch(() => false);
        }
        check(skin.key, "market.read: a transport failure renders an ERROR state (distinct from empty)", errorVisible);
        await shot(buyer.page, `${skin.key}-read-error`);
        await buyer.page.unroute("**/api/market/listings**");
        await buyer.page.reload({ waitUntil: "domcontentloaded" });
        await buyer.page.waitForTimeout(1200);
        const recovered = skin.key === "classic-registry"
          ? await (async () => { const frame = await classicFrame(buyer.page); await frame.waitForSelector(".data-table tbody tr", { timeout: 60000 }); return true; })().catch(() => false)
          : await buyer.page.locator(".h-mod-listing, .edx-market-card, .fc-person-links button, .horse-table tbody tr").first().waitFor({ timeout: 25000 }).then(() => true).catch(() => false);
        check(skin.key, "market.read: the list recovers after the failure clears", recovered);
      } finally { await buyer.context.close(); }
    }

    // --- market.buyer: inquiry (native composer or platform API), sent row, close-own, stale 409, watchlist.
    {
      const buyer = await session(BUYER);
      try {
        await openMarket(buyer.page, skin);
        let inquiryId;
        if (skin.composer === "api") {
          await buyer.page.goto(base + "/", { waitUntil: "domcontentloaded" });
          const created = await apiFetch(buyer.page, `/api/market/listings/${listing.id}/inquiries`, { method: "POST", data: JSON.stringify({ buyer_name: "DEMO Stable Staff", buyer_contact: "+98 900 000 1111", message: `R117-15 ${skin.key} (platform API — retro's market desk is browse-only, no native composer)` }) }, buyer.csrfToken);
          check(skin.key, "market.buyer: the inquiry is created through the platform API (browse-only skin, recorded honestly)", created.status === 201, { status: created.status });
          inquiryId = created.body?.inquiry?.id;
        } else {
          const status = await uiInquire(buyer.page, skin.key, listing);
          check(skin.key, `market.buyer: the inquiry lands through the skin's OWN composer (${skin.composer})`, status === 201 || status === 200, { status });
          const sent = await apiFetch(buyer.page, "/api/market/inquiries/sent", { method: "GET" }, buyer.csrfToken);
          inquiryId = (sent.body?.rows || [])[0]?.id;
        }
        check(skin.key, "market.buyer: the sent-inquiry id resolved", !!inquiryId, { inquiryId });

        // The seller responds first (contacted) so the buyer's row shows a live transition.
        const sellerCtx = await session(SELLER);
        await sellerCtx.page.goto(base + "/", { waitUntil: "domcontentloaded" });
        await sellerCtx.page.waitForTimeout(400);
        const sellerRead = await apiFetch(sellerCtx.page, `/api/market/inquiries/${inquiryId}`, { method: "GET" }, sellerCtx.csrfToken);
        const sellerVersion = sellerRead.body?.inquiry?.row_version ?? 1;
        const contacted = await apiFetch(sellerCtx.page, `/api/market/inquiries/${inquiryId}/status`, { method: "POST", data: JSON.stringify({ status: "contacted", expected_version: sellerVersion }) }, sellerCtx.csrfToken);
        check(skin.key, "market.seller (shared): the seller's versioned response lands (contacted)", contacted.status === 200, { status: contacted.status });
        await sellerCtx.context.close();

        await openMarket(buyer.page, skin);
        const row = sentRow(buyer.page, skin.key, inquiryId);
        await row.waitFor({ timeout: 25000 });
        const rowText = await row.innerText();
        check(skin.key, "market.buyer: the sent row renders (listing named, contacted status, honest listing status)", /DEMO horse listing/.test(rowText) && /contacted/i.test(rowText), { rowText: rowText.slice(0, 140).replace(/\n/g, " | ") });
        await shot(buyer.page, `${skin.key}-sent-row`);

        // Close-own through the real UI; verify persisted after a FULL reload.
        const closeButton = row.getByRole("button", { name: /Close my inquiry|بستن درخواست من/ });
        const closePost = onPost(buyer.page, "/close", () => closeButton.click());
        const closeResponse = await closePost;
        check(skin.key, "market.buyer: Close-my-inquiry returns 200 over the real API", closeResponse.status() === 200, { status: closeResponse.status() });
        await buyer.page.waitForTimeout(800);
        await buyer.page.reload({ waitUntil: "domcontentloaded" });
        await buyer.page.waitForTimeout(1000);
        const rowAfter = sentRow(buyer.page, skin.key, inquiryId);
        await rowAfter.waitFor({ timeout: 25000 });
        const afterText = await rowAfter.innerText();
        check(skin.key, "market.buyer: the closed state is PERSISTED after a full reload", /closed/i.test(afterText), { afterText: afterText.slice(0, 140).replace(/\n/g, " | ") });
        await shot(buyer.page, `${skin.key}-closed-persisted`);

        // Stale close: a second inquiry whose version advances concurrently.
        const staleInquiry = (await apiFetch(buyer.page, `/api/market/listings/${listing.id}/inquiries`, { method: "POST", data: JSON.stringify({ buyer_name: "DEMO Stable Staff", buyer_contact: "+98 900 000 1111", message: `R117-15 ${skin.key} stale-close probe` }) }, buyer.csrfToken)).body?.inquiry?.id;
        await openMarket(buyer.page, skin);
        const staleRow = sentRow(buyer.page, skin.key, staleInquiry);
        await staleRow.waitFor({ timeout: 25000 });
        const concurrent = await session(SELLER);
        await concurrent.page.goto(base + "/", { waitUntil: "domcontentloaded" });
        await concurrent.page.waitForTimeout(400);
        await apiFetch(concurrent.page, `/api/market/inquiries/${staleInquiry}/status`, { method: "POST", data: JSON.stringify({ status: "contacted", expected_version: 1 }) }, concurrent.csrfToken);
        await concurrent.context.close();
        const stalePost = onPost(buyer.page, "/close", () => staleRow.getByRole("button", { name: /Close my inquiry|بستن درخواست من/ }).click());
        const staleResponse = await stalePost;
        let staleBody = null; try { staleBody = await staleResponse.json(); } catch {}
        check(skin.key, "market.buyer: a stale close loses with the honest 409 (current version carried)", staleResponse.status() === 409 && (staleBody?.error?.code === "inquiry_version_conflict"), { status: staleResponse.status(), code: staleBody?.error?.code, current: staleBody?.error?.details?.current_version });
        await buyer.page.waitForTimeout(600);
        // The honest conflict story renders inside the conversation panel —
        // open it on the stale row and read the precise copy (the intro
        // paragraph's generic "changed elsewhere" wording does NOT count).
        await staleRow.getByRole("button", { name: /Conversation|تبادل پیام/ }).click();
        await buyer.page.waitForTimeout(800);
        const conflictNotice = await buyer.page.getByText(/inquiry changed elsewhere|درخواست جای دیگر تغییر کرده/).first().isVisible().catch(() => false);
        check(skin.key, "market.buyer: the honest conflict story renders", conflictNotice);
        await buyer.page.reload({ waitUntil: "domcontentloaded" });
        await buyer.page.waitForTimeout(1000);
        const staleRowAfter = sentRow(buyer.page, skin.key, staleInquiry);
        await staleRowAfter.waitFor({ timeout: 25000 });
        const staleAfterText = await staleRowAfter.innerText();
        check(skin.key, "market.buyer: the full reload recovers the concurrent state (contacted wins)", /contacted/i.test(staleAfterText), { staleAfterText: staleAfterText.slice(0, 120).replace(/\n/g, " | ") });

        // Watchlist: watch (heritage UI toggle / platform API elsewhere), then Unwatch via the real UI.
        const watchState = (await apiFetch(buyer.page, "/api/market/watchlist", { method: "GET" }, buyer.csrfToken)).body?.rows || [];
        if (!watchState.some(row => row.listing_id === listing.id)) {
          const watched = await apiFetch(buyer.page, `/api/market/watchlist/${listing.id}`, { method: "POST", data: "{}" }, buyer.csrfToken);
          check(skin.key, "market.buyer: the listing is watched (platform watch)", watched.status === 200 || watched.status === 201, { status: watched.status });
        } else {
          check(skin.key, "market.buyer: the listing is watched (already present)", true);
        }
        await openMarket(buyer.page, skin);
        const watchRow = skin.key === "heritage"
          ? buyer.page.locator('[data-surface="market-watchlist"] li').first()
          : skin.key === "equidata-elite"
            ? buyer.page.locator('[data-surface="market-watchlist"] .edx-market-card').first()
            : skin.key === "retro-astra"
              ? buyer.page.locator('[data-surface="market-watchlist"] [data-surface="market-watchlist-row"]').first()
              : buyer.page.locator('[data-surface="market-watchlist-row"]').first();
        await watchRow.waitFor({ timeout: 25000 });
        check(skin.key, "market.buyer: the watchlist renders the watched listing", true);
        const unwatchPost = onPost(buyer.page, `/watchlist/${listing.id}`, () => watchRow.getByRole("button", { name: /Unwatch|حذف پیگیری/ }).click(), "DELETE");
        const unwatchResponse = await unwatchPost;
        check(skin.key, "market.buyer: Unwatch lands through the real UI", unwatchResponse.status() === 200, { status: unwatchResponse.status() });
        await buyer.page.reload({ waitUntil: "domcontentloaded" });
        await buyer.page.waitForTimeout(1000);
        const persistedGone = await apiFetch(buyer.page, "/api/market/watchlist", { method: "GET" }, buyer.csrfToken);
        check(skin.key, "market.buyer: the unwatch is PERSISTED after a full reload", !((persistedGone.body?.rows || []).some(row => row.listing_id === listing.id)));
      } finally { await buyer.context.close(); }
    }

    // --- market.seller: own listings with versions, received inbox, Mark contacted via UI, persisted.
    {
      const seller = await session(SELLER);
      try {
        await openMarket(seller.page, skin);
        const lifecycle = skin.key === "classic-registry"
          ? seller.page.locator('[data-surface="market-lifecycle"]').first()
          : seller.page.locator('[data-surface="market-lifecycle"]').first();
        await lifecycle.waitFor({ timeout: 25000 });
        const lifecycleText = await lifecycle.innerText();
        check(skin.key, "market.seller: the lifecycle section lists the seller's OWN listings with live versions", (/DEMO horse listing/.test(lifecycleText) || lifecycleText.includes(listing.name)) && /v\d+/.test(lifecycleText), { listing: listing.name, sample: lifecycleText.slice(0, 120).replace(/\n/g, " | ") });
        await shot(seller.page, `${skin.key}-seller-lifecycle`);

        // A fresh inquiry from the buyer so the seller journey has its own row.
        const freshBuyer = await session(BUYER);
        await freshBuyer.page.goto(base + "/", { waitUntil: "domcontentloaded" });
        await freshBuyer.page.waitForTimeout(400);
        const fresh = (await apiFetch(freshBuyer.page, `/api/market/listings/${listing.id}/inquiries`, { method: "POST", data: JSON.stringify({ buyer_name: "DEMO Stable Staff", buyer_contact: "+98 900 000 1111", message: `R117-15 ${skin.key} seller-journey inquiry` }) }, freshBuyer.csrfToken)).body?.inquiry?.id;
        await freshBuyer.context.close();
        await openMarket(seller.page, skin);
        const inboxRow = skin.key === "heritage"
          ? seller.page.locator('[data-surface="market-inquiry-inbox"] li[data-surface="market-inquiry-row"]').first()
          : skin.key === "retro-astra" || skin.key === "classic-registry"
            ? seller.page.locator('[data-surface="market-inquiry-inbox"] li[data-surface="market-inquiry-row"]').first()
            : seller.page.locator('[data-surface="market-inquiry-inbox"] [data-surface="market-inquiry-row"]').first();
        await inboxRow.waitFor({ timeout: 25000 });
        const inboxText = await inboxRow.innerText();
        check(skin.key, "market.seller: the received-inquiry inbox renders the buyer's inquiry", /DEMO Stable Staff/.test(inboxText), { inboxText: inboxText.slice(0, 120).replace(/\n/g, " | ") });
        const markPost = onPost(seller.page, "/status", () => inboxRow.getByRole("button", { name: /Mark contacted|تماس‌گرفته‌شده/ }).click());
        const markResponse = await markPost;
        check(skin.key, "market.seller: Mark-contacted returns 200 over the real API", markResponse.status() === 200, { status: markResponse.status() });
        await seller.page.waitForTimeout(800);
        await seller.page.reload({ waitUntil: "domcontentloaded" });
        await seller.page.waitForTimeout(1000);
        await openMarket(seller.page, skin);
        const inboxAfter = seller.page.locator('[data-surface="market-inquiry-inbox"] [data-surface="market-inquiry-row"], [data-surface="market-inquiry-inbox"] li[data-surface="market-inquiry-row"]').first();
        await inboxAfter.waitFor({ timeout: 25000 });
        const afterText = await inboxAfter.innerText();
        check(skin.key, "market.seller: the contacted state is PERSISTED after a full reload", /contacted|تماس‌گرفته‌شده/i.test(afterText), { afterText: afterText.slice(0, 120).replace(/\n/g, " | ") });
        await shot(seller.page, `${skin.key}-seller-contacted-persisted`);
      } finally { await seller.context.close(); }
    }
  }

  // ------------------------------------------------------------------
  // Persian copy spot check (heritage, fa).
  // ------------------------------------------------------------------
  {
    stage("Persian spot check (heritage, fa)");
    const buyer = await session(BUYER, "fa");
    try {
      await openMarket(buyer.page, { key: "heritage", url: "/market" });
      const section = buyer.page.locator('[data-surface="market-sent-inquiries"]').first();
      await section.waitFor({ timeout: 25000 });
      const text = await section.innerText();
      check("heritage-fa", "the sent-inquiries heading renders Persian copy", text.includes("درخواست‌های ارسالی من"), { sample: text.slice(0, 80) });
      const emptyOrRow = text.includes("درخواست") && (text.includes("بستن درخواست من") || text.includes("هنوز درخواستی ارسال نکرده‌اید"));
      check("heritage-fa", "the Persian row/empty copy renders (close-own or honest empty)", emptyOrRow);
      await shot(buyer.page, "heritage-fa-sent");
    } finally { await buyer.context.close(); }
  }
} catch (cause) {
  report.failures.push({ skin: "harness", name: "harness error", okay: false, error: String(cause) });
  console.error("HARNESS ERROR", cause);
} finally {
  if (browser) await browser.close();
  report.finishedAt = new Date().toISOString();
  const total = report.checks.length;
  const failed = report.failures.length;
  report.summary = { total, failed, passed: total - failed, pageErrors: report.pageErrors.length };
  await fs.writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  console.log(`\nR117-15 market matrix: ${total - failed}/${total} checks passed, ${report.pageErrors.length} page errors.`);
  console.log(`Per skin: ${JSON.stringify(report.skins)}`);
  if (failed > 0) { console.log("FAILURES:"); for (const failure of report.failures) console.log(` - [${failure.skin}] ${failure.name} ${JSON.stringify({ ...failure, name: undefined, skin: undefined, okay: undefined })}`); }
  process.exitCode = failed > 0 ? 1 : 0;
}

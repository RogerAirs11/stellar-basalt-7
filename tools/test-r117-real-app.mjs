/** R117 real-app qualification — first slice of R117-13 + handoff §5.
 * Runs against the named synthetic loopback instance only (no live tenant).
 * Section A: FEI new compact header + adaptive canonical navigation (the R116-era
 *   dome/donor-menu selectors were retired by design in R117; this is their replacement).
 * Section B: marketplace read-error honesty on the REAL local server via route
 *   interception (list failure != empty registry; detail retry/close; stale-response guard).
 * Section C: narrowest-width overflow guard.
 * Data pages settle via waitForFunction (networkidle resolves early on the Vite dev cascade). */
import fs from "node:fs/promises";
import path from "node:path";
const base = process.env.UI_BASE_URL || "http://127.0.0.1:3000";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(base).hostname)) throw new Error("Local synthetic demo only.");
const playwrightModule = await import(process.env.UI_PLAYWRIGHT_MODULE || "playwright");
const chromium = playwrightModule.chromium ?? playwrightModule.default?.chromium;
const out = path.resolve(process.env.UI_EVIDENCE_DIR || "review-r117/evidence-local/real-app");
await fs.mkdir(out, { recursive: true });
const report = { browser: "n/a", startedAt: new Date().toISOString(), checks: [], failures: [], pageErrors: [] };
const stage = (name) => console.log(`-- ${new Date().toISOString().slice(11, 19)} ${name}`);
const check = (name, okay, details = {}) => {
  report.checks.push({ name, okay, ...details });
  if (!okay) report.failures.push({ name, ...details });
  console.log(`${okay ? "PASS" : "FAIL"} ${name} ${JSON.stringify(details)}`);
};
async function open(page, url, viewport) {
  await page.setViewportSize(viewport ?? { width: 1280, height: 1000 });
  await page.goto(new URL(url, base).href, { waitUntil: "load" });
  await page.waitForTimeout(900);
}
/** Wait until the marketplace surface settles: data rows, an explicit error alert, or the empty state. */
async function settleMarket(page, timeout = 15000) {
  try {
    await page.waitForFunction(() => {
      const rows = document.querySelectorAll("button.h-mod-listing").length;
      const alert = document.querySelector('[role="alert"]');
      const empty = document.querySelector(".h-mod-empty");
      return rows > 0 || !!alert || !!empty;
    }, null, { timeout });
  } catch (error) {
    const diag = await page.evaluate(() => ({
      url: location.href,
      readyState: document.readyState,
      hasBrowseCount: !!document.querySelector(".browse-count"),
      rows: document.querySelectorAll("button.h-mod-listing").length,
      empty: document.querySelector(".h-mod-empty")?.textContent ?? null,
      alert: document.querySelector('[role="alert"]')?.textContent ?? null,
      textHead: (document.body.textContent ?? "").replace(/\s+/g, " ").slice(0, 220),
    })).catch(() => null);
    console.log("SETTLE-DIAG " + JSON.stringify(diag));
    throw error;
  }
}

let browser;
try {
  browser = await chromium.launch({ headless: true });
  report.browser = await browser.version();
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", error => report.pageErrors.push({ url: page.url(), error: error.message }));

  // ── A. FEI compact header + adaptive canonical navigation ──
  stage("fei new header contract (fa)");
  await open(page, "/f/fei-classic/", { width: 1440, height: 900 });
  await page.waitForSelector(".fc112-shortcuts a", { timeout: 15000 });
  const header = await page.evaluate(() => {
    const root = document.querySelector(".fei-classic-ui");
    return {
      compactHeader: !!document.querySelector(".fc112-header.fc117-header"),
      identityRow: !!document.querySelector(".fc112-identity-row"),
      brand: !!document.querySelector(".fc117-brand"),
      legacyDomeGone: !document.querySelector(".top-bar-body-logo"),
      dir: root?.getAttribute("dir"),
      layout: root?.getAttribute("data-navigation-layout"),
    };
  });
  check("fei compact identity header present (fa/rtl)", header.compactHeader && header.identityRow && header.brand && header.dir === "rtl", header);
  check("fei legacy dome retired by design (recorded)", header.legacyDomeGone, header);

  const wide = await page.evaluate(() => document.querySelectorAll(".fc112-shortcuts a").length);
  await page.setViewportSize({ width: 640, height: 900 });
  await page.waitForTimeout(700);
  const narrow = await page.evaluate(() => document.querySelectorAll(".fc112-shortcuts a").length);
  const overflow = await page.evaluate(() => {
    const row = document.querySelector(".fc112-shortcuts");
    return { rowScroll: row ? row.scrollWidth - row.clientWidth : -1, docScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  check("fei tab count shrinks with width", narrow < wide && narrow >= 1, { wide, narrow });
  check("fei row never overflows (row + document)", overflow.rowScroll <= 1 && overflow.docScroll <= 1, overflow);
  const measure = await page.evaluate(() => {
    const m = document.querySelector(".fc117-nav-measure");
    if (!m) return null;
    const cs = getComputedStyle(m);
    return { display: cs.display, position: cs.position, visibility: cs.visibility, docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  check("fei hidden measurement twin stays out of flow without expanding the page",
    measure !== null && measure.position === "absolute" && (measure.visibility === "hidden" || measure.display === "none") && measure.docOverflow <= 1, measure ?? {});

  // More panel must carry every destination not visible in the row
  const coverage = await page.evaluate(() => {
    const rowHrefs = new Set([...document.querySelectorAll(".fc112-shortcuts a")].map(a => a.getAttribute("href")));
    const toggle = document.querySelector(".fc112-sections-toggle");
    if (toggle) toggle.click();
    return new Promise(resolve => setTimeout(() => {
      const panelHrefs = [...document.querySelectorAll(".fc112-sections-panel a")].map(a => a.getAttribute("href"));
      const union = new Set([...rowHrefs, ...panelHrefs]);
      resolve({ row: rowHrefs.size, panel: panelHrefs.length, union: union.size, sample: [...union].slice(0, 6) });
    }, 300));
  });
  check("fei More panel keeps every destination reachable", coverage.panel > 0 && coverage.union >= 12, coverage);
  await page.evaluate(() => document.querySelector(".fc112-sections-toggle")?.click()); // close panel
  await page.waitForTimeout(300);

  // active destination must be included in the fitted budget (visible in the row, not folded away)
  const activeBudget = await page.evaluate(async () => {
    const last = [...document.querySelectorAll(".fc112-shortcuts a")].pop();
    if (!last) return null;
    last.click();
    await new Promise(r => setTimeout(r, 800));
    const row = document.querySelector(".fc112-shortcuts");
    const rowBox = row?.getBoundingClientRect();
    const links = [...row.querySelectorAll("a")];
    const active = links.find(a => a.getAttribute("aria-current") === "page" || a.classList.contains("active") || a.classList.contains("fc112-active"));
    const visible = links.filter(a => { const r = a.getBoundingClientRect(); return r.width > 0 && r.right <= (rowBox?.right ?? 0) + 1 && r.left >= (rowBox?.left ?? 0) - 1; });
    return { total: links.length, activeFound: !!active, activeHref: active?.getAttribute("href") ?? null, visibleInRow: visible.length, activeAmongVisible: visible.some(v => v.getAttribute("href") === active?.getAttribute("href")) };
  });
  check("fei active destination stays inside the fitted row", activeBudget !== null && activeBudget.activeFound && activeBudget.activeAmongVisible, activeBudget ?? {});

  stage("fei locale switch without navigation (en/ltr)");
  await page.evaluate(() => localStorage.setItem("registry-locale", "en"));
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector(".fc112-shortcuts a", { timeout: 15000 });
  const ltr = await page.evaluate(() => ({ dir: document.querySelector(".fei-classic-ui")?.getAttribute("dir"), nav: document.querySelector(".fc112-shortcuts")?.getAttribute("aria-label"), tabText: document.querySelector(".fc112-shortcuts a")?.textContent?.trim() }));
  check("fei switches to ltr english without route change", ltr.dir === "ltr" && /Primary navigation/i.test(ltr.nav ?? "") && /[a-z]/i.test(ltr.tabText ?? ""), ltr);
  await page.evaluate(() => localStorage.removeItem("registry-locale"));
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(600);

  stage("fei sidebar mode");
  await page.waitForSelector(".fc102-layout select", { timeout: 15000 });
  await page.evaluate(() => {
    const select = document.querySelector(".fc102-layout select");
    if (select) { select.value = "sidebar"; select.dispatchEvent(new Event("change", { bubbles: true })); }
  });
  await page.waitForTimeout(900);
  const sidebarState = await page.evaluate(() => ({
    layout: document.querySelector(".fei-classic-ui")?.getAttribute("data-navigation-layout"),
    sidebar: !!document.querySelector(".fc102-sidebar"),
    groups: document.querySelectorAll(".fc102-sidebar .fc102-group").length,
    counts: document.querySelectorAll(".fc102-sidebar .nav-group-count").length,
  }));
  check("fei sidebar mode works with grouped counts", sidebarState.layout === "sidebar" && sidebarState.sidebar && sidebarState.groups >= 4 && sidebarState.counts >= 4, sidebarState);
  await page.evaluate(() => { const s = document.querySelector(".fc102-layout select"); if (s) { s.value = "tabs"; s.dispatchEvent(new Event("change", { bubbles: true })); } });
  await page.waitForTimeout(500);

  // ── B. Marketplace read-error honesty on the real local server ──
  stage("marketplace baseline + list failure != empty registry (fa)");
  await page.evaluate(() => localStorage.setItem("registry-frontend", "heritage"));
  await open(page, "/market", { width: 1280, height: 1000 });
  await settleMarket(page);
  const listOk = await page.evaluate(() => ({ rows: document.querySelectorAll("button.h-mod-listing").length, empty: document.querySelector(".h-mod-empty")?.textContent ?? null }));
  await context.route("**/api/market/listings?*", route => { route.abort("failed").catch(() => {}); });
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => !!document.querySelector('[role="alert"]') || !!document.querySelector(".h-mod-empty"), null, { timeout: 15000 });
  await page.waitForTimeout(400);
  const listFail = await page.evaluate(() => ({
    alert: document.querySelector('[role="alert"]')?.textContent ?? null,
    emptyState: document.querySelector(".h-mod-empty")?.textContent ?? null,
    count: document.querySelector(".browse-count strong")?.textContent ?? null,
    rows: document.querySelectorAll("button.h-mod-listing").length,
  }));
  check("real server: failed list reads as loading failure (fa), not the empty state",
    /روبه‌رو شد/.test(listFail.alert ?? "") && listFail.emptyState === null, { alert: (listFail.alert ?? "").slice(0, 80), baselineRows: listOk.rows, emptyState: listFail.emptyState });
  check("real server: failed list shows em-dash count, zero rows", listFail.count === "—" && listFail.rows === 0, { count: listFail.count, rows: listFail.rows });
  await context.unroute("**/api/market/listings?*");
  const retryClicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find(b => /تلاش دوباره|Try again/i.test(b.textContent ?? ""));
    btn?.click();
    return !!btn;
  });
  await page.waitForFunction(() => document.querySelectorAll("button.h-mod-listing").length > 0, null, { timeout: 15000 });
  const recovered = await page.evaluate(() => ({ rows: document.querySelectorAll("button.h-mod-listing").length, alert: document.querySelector('[role="alert"]')?.textContent ?? null }));
  check("real server: retry recovers the real listing rows", retryClicked && recovered.rows > 0 && recovered.alert === null, { rows: recovered.rows });

  stage("marketplace detail failure with retry + close");
  await context.route(/\/api\/market\/listings\/[^/?]+/, route => { route.abort("failed").catch(() => {}); });
  await page.evaluate(() => document.querySelector("button.h-mod-listing")?.click());
  await page.waitForFunction(() => {
    const panel = document.querySelector("section[role=alert]");
    return !!panel && /ممکن نشد|could not be loaded/.test(panel.textContent ?? "");
  }, null, { timeout: 15000 });
  const detailFail = await page.evaluate(() => {
    const panel = document.querySelector("section[role=alert]");
    return {
      role: panel?.getAttribute("role") ?? null,
      text: panel?.textContent ?? null,
      hasRetry: !!panel && [...panel.querySelectorAll("button")].some(b => /تلاش دوباره|Try again/i.test(b.textContent ?? "")),
      hasClose: !!panel && [...panel.querySelectorAll("button")].some(b => /^بستن$|^Close$/i.test(b.textContent?.trim() ?? "")),
    };
  });
  check("real server: failed detail is explicit with retry + close", /ممکن نشد/.test(detailFail.text ?? "") && detailFail.hasRetry && detailFail.hasClose, { text: (detailFail.text ?? "").slice(0, 80), role: detailFail.role });
  const closed = await page.evaluate(() => {
    const panel = document.querySelector("section[role=alert]");
    if (!panel) return false;
    const btn = [...panel.querySelectorAll("button")].find(b => /^بستن$|^Close$/i.test(b.textContent?.trim() ?? ""));
    btn?.click();
    return !!btn;
  });
  await page.waitForTimeout(500);
  const afterClose = await page.evaluate(() => ({ alert: document.querySelector("section[role=alert]") }));
  check("real server: reader can close the failed detail", closed && afterClose.alert === null, { closed });
  await context.unroute(/\/api\/market\/listings\/[^/?]+/);

  stage("stale-response guard (old rejected request after filter change)");
  await page.evaluate(() => localStorage.setItem("registry-frontend", "heritage"));
  await open(page, "/market", { width: 1280, height: 1000 });
  await settleMarket(page);
  // Server contract: q must fit 48 UTF-8 bytes after LIKE escaping (filter_too_long -> 400).
  // Use SHORT no-match values so both requests are valid; the handler tells them apart by marker.
  const OLD_Q = "قدیما";
  const NEW_Q = "جدیدا";
  const oldMarker = "قدیما"; // raw marker; the URL is decoded before comparison
  const marketRequests = [];
  page.on("request", r => { if (r.url().includes("/api/market/listings")) marketRequests.push(decodeURIComponent(r.url().replace(base, "")) + " -> " + (r.failure()?.errorText ?? "ok")); });
  page.on("requestfailed", r => { if (r.url().includes("/api/market/listings")) { const i = marketRequests.findIndex(x => x.startsWith(decodeURIComponent(r.url().replace(base, "")))); if (i >= 0) marketRequests[i] = decodeURIComponent(r.url().replace(base, "")) + " -> " + (r.failure()?.errorText ?? "failed"); } });
  let resolveOld;
  const oldRejected = new Promise(resolve => { resolveOld = resolve; });
  const guard = new Promise((_, reject) => setTimeout(() => reject(new Error("stale-guard timeout")), 25000));
  await context.route("**/api/market/listings?*", route => {
    const url = route.request().url();
    if (decodeURIComponent(url).includes(oldMarker)) {
      // the OLD request: hold it, then reject it AFTER the newer request has settled
      setTimeout(() => { route.abort("failed").catch(() => {}); resolveOld(true); }, 1200);
    } else {
      route.continue().catch(() => {});
    }
  });
  const input = await page.waitForSelector('input[aria-label="جست‌وجوی آگهی‌ها"], input[aria-label="Search listings"]', { timeout: 15000 });
  await input.fill(OLD_Q); // request OLD (held by the route)
  await page.waitForTimeout(300); // OLD in flight
  await input.fill(NEW_Q); // request NEW (passes through to the real server): guaranteed no-match
  await Promise.race([oldRejected, guard]);
  await page.waitForFunction(() => !!document.querySelector(".h-mod-empty") || !!document.querySelector('[role="alert"]'), null, { timeout: 15000 });
  await page.waitForTimeout(900); // the late OLD rejection must not replace the NEW state
  const stale = await page.evaluate(() => ({
    alert: document.querySelector('[role="alert"]')?.textContent ?? null,
    empty: document.querySelector(".h-mod-empty")?.textContent ?? null,
    rows: document.querySelectorAll("button.h-mod-listing").length,
    count: document.querySelector(".browse-count strong")?.textContent ?? null,
    inputValue: document.querySelector('input[aria-label="جست‌وجوی آگهی‌ها"]')?.value ?? null,
  }));
  check("real server: aborted older request never becomes the current state",
    stale.alert === null && stale.empty !== null && /یافت نشد/.test(stale.empty) && stale.count !== "—" && stale.count !== null && /^[0-9\u06f0-\u06f9]+$/.test(stale.count ?? ""),
    { ...stale, requests: marketRequests });
  await context.unroute("**/api/market/listings?*");

  // ── C. narrowest width overflow guard ──
  stage("heritage 320px overflow guard");
  await page.evaluate(() => localStorage.setItem("registry-frontend", "heritage"));
  await open(page, "/", { width: 320, height: 700 });
  await page.waitForSelector(".h112-sections-toggle, .h112-primary-links a:visible", { timeout: 15000 });
  await page.waitForTimeout(700);
  const narrowDoc = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, tabs: document.querySelectorAll(".h112-primary-links a").length, toggle: document.querySelector(".h112-sections-toggle")?.textContent?.trim() ?? null }));
  check("heritage 320px: no document overflow", narrowDoc.overflow <= 1, narrowDoc);

  await context.close();
} catch (error) {
  check("harness completed without internal error", false, { error: String(error) });
} finally {
  await browser?.close();
}
const passed = report.checks.filter(c => c.okay).length;
console.log(`\nR117 real-app browser checks: ${passed}/${report.checks.length} passed, ${report.pageErrors.length} page errors`);
await fs.writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2));
process.exit(report.failures.length === 0 && report.pageErrors.length === 0 ? 0 : 1);

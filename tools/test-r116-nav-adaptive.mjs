/** R116 owner-directed frontend polish — real browser verification of the
 * adaptive tab rows in ALL five skins, the restored Retro Astra sidebar
 * default + parents-column repair, the centred FEI donor logo in both
 * directions, and the Classic Registry adaptive row + sidebar mode.
 * Loopback synthetic demo only; no live tenant. */
import fs from "node:fs/promises";
import path from "node:path";
const base = process.env.UI_BASE_URL || "http://127.0.0.1:3000";
if (!["127.0.0.1","localhost","[::1]"].includes(new URL(base).hostname)) throw new Error("Local synthetic demo only.");
const playwrightModule = await import(process.env.UI_PLAYWRIGHT_MODULE || "playwright");
const chromium = playwrightModule.chromium ?? playwrightModule.default?.chromium;
const out = path.resolve(process.env.UI_EVIDENCE_DIR || "review-r116/evidence/nav-adaptive");
await fs.mkdir(out, { recursive: true });
const report = { browser: "n/a", startedAt: new Date().toISOString(), checks: [], failures: [], pageErrors: [] };
const stage = (name) => console.log(`-- ${new Date().toISOString().slice(11, 19)} ${name}`);
const check = (name, okay, details = {}) => {
  report.checks.push({ name, okay, ...details });
  if (!okay) report.failures.push({ name, ...details });
  console.log(`${okay ? "PASS" : "FAIL"} ${name} ${JSON.stringify(details)}`);
};

async function openFrontend(page, url, { viewport = { width: 1280, height: 1000 } } = {}) {
  await page.setViewportSize(viewport);
  await page.goto(new URL(url, base).href, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
}

async function tabCount(page, selector) {
  return page.evaluate((selector) => document.querySelectorAll(selector).length, selector);
}

let browser;
try {
  try { browser = await chromium.launch({ headless: true }); }
  catch (launchError) { check("browser launch", false, { error: String(launchError) }); throw launchError; }
  report.browser = await browser.version();
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", error => report.pageErrors.push({ url: page.url(), error: error.message }));

  // ── 1. Heritage (R115 reference, must stay adaptive) ──
  stage("heritage adaptive row");
  await openFrontend(page, "/", { viewport: { width: 1440, height: 900 } });
  const heritageWide = await tabCount(page, ".h112-primary-links a");
  await page.setViewportSize({ width: 700, height: 900 });
  await page.waitForTimeout(500);
  const heritageNarrow = await tabCount(page, ".h112-primary-links a");
  check("heritage tab count shrinks with width", heritageNarrow < heritageWide && heritageNarrow >= 1, { wide: heritageWide, narrow: heritageNarrow });
  const heritageMore = await page.evaluate(() => document.querySelector(".h112-sections-toggle")?.textContent?.trim() ?? "");
  check("heritage More toggle present", /more|بیشتر/i.test(heritageMore), { label: heritageMore.slice(0, 20) });

  // ── 2. EquiData Elite ──
  stage("elite adaptive row");
  await openFrontend(page, "/f/equidata-elite/", { viewport: { width: 1440, height: 900 } });
  const eliteWide = await tabCount(page, ".edx112-shortcuts a");
  await page.setViewportSize({ width: 640, height: 900 });
  await page.waitForTimeout(500);
  const eliteNarrow = await tabCount(page, ".edx112-shortcuts a");
  const eliteOverflow = await page.evaluate(() => {
    const row = document.querySelector(".edx112-shortcuts");
    return row ? row.scrollWidth <= row.clientWidth + 2 : null;
  });
  check("elite tab count shrinks with width", eliteNarrow < eliteWide && eliteNarrow >= 1, { wide: eliteWide, narrow: eliteNarrow });
  check("elite row never overflows", eliteOverflow === true);
  const eliteMore = await page.evaluate(async () => {
    const toggle = document.querySelector(".edx112-sections-toggle");
    if (!toggle) return null;
    toggle.click();
    await new Promise(resolve => setTimeout(resolve, 150));
    const panel = document.querySelector(".edx112-sections-panel");
    return panel ? panel.querySelectorAll("a").length : 0;
  });
  check("elite More panel carries every destination", eliteMore !== null && eliteMore >= eliteWide, { links: eliteMore, wideTabs: eliteWide });

  // ── 3. Retro Astra: sidebar default + adaptive row + parents repair ──
  stage("retro astra sidebar + tabs + parents");
  await openFrontend(page, "/f/retro-astra/#/horses", { viewport: { width: 1280, height: 900 } });
  const retroDefault = await page.evaluate(() => ({
    layout: document.querySelector(".desk-surround")?.getAttribute("data-navigation-layout"),
    sidebarVisible: (() => { const sb = document.getElementById("retro-sidebar"); return sb ? getComputedStyle(sb).display !== "none" : false; })(),
  }));
  check("retro astra defaults to the sidebar", retroDefault.layout === "sidebar" && retroDefault.sidebarVisible, retroDefault);
  const parents = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".horse-table tbody tr")].slice(0, 4).map(row => {
      const cell = row.querySelectorAll("td")[3];
      const parentRows = cell ? cell.querySelectorAll(".parent-row") : [];
      return { stacked: parentRows.length, display: parentRows[0] ? getComputedStyle(parentRows[0]).display : null };
    }).filter(item => item.stacked > 0);
    return rows.length ? rows[0] : null;
  });
  check("retro astra parents column stacks sire and dam", parents !== null && parents.stacked === 2 && parents.display === "flex", parents ?? {});
  await page.evaluate(() => localStorage.setItem("horse-registry:navigation:retro-astra:v1", "tabs"));
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const retroWide = await tabCount(page, ".primary-nav-inner > a");
  await page.setViewportSize({ width: 640, height: 900 });
  await page.waitForTimeout(500);
  const retroNarrow = await tabCount(page, ".primary-nav-inner > a");
  const retroOverflow = await page.evaluate(() => {
    const row = document.querySelector(".primary-nav-inner");
    return row ? row.scrollWidth <= row.clientWidth + 2 : null;
  });
  check("retro astra tab count shrinks with width", retroNarrow < retroWide && retroNarrow >= 1, { wide: retroWide, narrow: retroNarrow });
  check("retro astra row never overflows", retroOverflow === true);
  await page.evaluate(() => localStorage.removeItem("horse-registry:navigation:retro-astra:v1"));

  // ── 4. Classic Registry (host iframe): adaptive row + sidebar mode ──
  stage("classic registry adaptive row + sidebar");
  await openFrontend(page, "/f/classic-registry/", { viewport: { width: 1440, height: 900 } });
  const classicWide = await page.evaluate(() => {
    const frame = document.querySelector(".classic-registry-frame");
    return frame?.contentDocument?.querySelectorAll(".nav-link").length ?? 0;
  });
  await page.setViewportSize({ width: 700, height: 900 });
  await page.waitForTimeout(700);
  const classicNarrow = await page.evaluate(() => {
    const frame = document.querySelector(".classic-registry-frame");
    return frame?.contentDocument?.querySelectorAll(".nav-link").length ?? 0;
  });
  check("classic registry tab count shrinks with width", classicNarrow < classicWide && classicNarrow >= 1, { wide: classicWide, narrow: classicNarrow });
  const classicSidebar = await page.evaluate(() => {
    const frame = document.querySelector(".classic-registry-frame");
    const doc = frame?.contentDocument;
    if (!doc) return null;
    const select = doc.getElementById("classic-navigation-layout");
    if (!select) return null;
    select.value = "sidebar";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return new Promise(resolve => setTimeout(async () => {
      const shell = doc.getElementById("app");
      const wide = matchMedia("(min-width: 940px)").matches;
      const body = doc.getElementById("classic-sidebar-body");
      let open = body ? getComputedStyle(body).display !== "none" : false;
      // Narrow screens collapse the sidebar behind its toggle (designed
      // accordion); open it once so the check verifies the real rail.
      if (!open && wide === false) {
        const toggle = doc.querySelector('.classic-sidebar-toggle');
        toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        await new Promise(wait => setTimeout(wait, 250));
        open = body ? getComputedStyle(body).display !== "none" : false;
      }
      resolve({ layout: shell?.dataset.navigationLayout, wide, sidebarVisible: open, groups: doc.querySelectorAll("#classic-sidebar-groups details").length });
    }, 300));
  });
  check("classic registry sidebar layout works from the header select", classicSidebar !== null && classicSidebar.layout === "sidebar" && classicSidebar.sidebarVisible && classicSidebar.groups > 0, classicSidebar ?? {});

  // ── 5. FEI: donor logo exactly centred (LTR + RTL) + donor menu fold ──
  stage("fei logo centring + donor menu fold");
  for (const locale of ["fa", "ltr-en"]) {
    await openFrontend(page, locale === "fa" ? "/f/fei-classic/" : "/f/fei-classic/", { viewport: { width: 1440, height: 900 } });
    if (locale === "ltr-en") {
      await page.evaluate(() => localStorage.setItem("registry-locale", "en"));
      await page.reload({ waitUntil: "networkidle" });
      await page.waitForTimeout(400);
    }
    const measure = await page.evaluate(() => {
      const logo = document.querySelector(".top-bar-body-logo");
      const body = document.querySelector(".top-bar-body");
      if (!logo || !body) return null;
      const lr = logo.getBoundingClientRect();
      const br = body.getBoundingClientRect();
      return { dir: document.querySelector(".fei-classic-ui")?.getAttribute("dir"), h1Offset: Math.round((lr.left + lr.right) / 2 - (br.left + br.right) / 2) };
    });
    check(`fei logo banner exactly centred (${locale})`, measure !== null && Math.abs(measure.h1Offset) <= 1, measure ?? {});
    await page.evaluate(() => localStorage.removeItem("registry-locale"));
  }
  await openFrontend(page, "/f/fei-classic/", { viewport: { width: 1000, height: 900 } });
  const feiFold = await page.evaluate(() => {
    const menu = document.getElementById("topMenu");
    if (!menu) return null;
    const items = [...menu.querySelectorAll("ul.level1 > li")];
    const more = items.find(li => li.querySelector("a")?.textContent.includes("More") || li.querySelector("a")?.textContent.includes("بیشتر"));
    if (!more) return { folded: 0, children: 0 };
    const submenu = more.querySelectorAll("ul.level2 a");
    return { folded: items.length, children: submenu.length };
  });
  check("fei donor menu folds trailing tabs at narrow widths", feiFold !== null && feiFold.folded < 5 && feiFold.children > 0, feiFold ?? {});
  const feiWide1440 = await (async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(500);
    return page.evaluate(() => document.querySelectorAll("#topMenu ul.level1 > li").length);
  })();
  check("fei donor menu keeps the exact five tabs on wide screens", feiWide1440 === 5, { tabs: feiWide1440 });

  await context.close();
} finally {
  await browser?.close();
}
const passed = report.checks.filter(check => check.okay).length;
console.log(`\nR116 nav-adaptive browser checks: ${passed}/${report.checks.length} passed, ${report.pageErrors.length} page errors`);
await fs.writeFile(path.join(out, "r116-nav-adaptive.json"), JSON.stringify(report, null, 2));
if (report.failures.length || report.pageErrors.length) process.exit(1);

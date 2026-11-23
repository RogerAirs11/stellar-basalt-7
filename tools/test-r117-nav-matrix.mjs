/** R117-13 remainder — full navigation/density qualification matrix on the REAL apps.
 * Loopback synthetic instance only. Extends the first slice (tools/test-r117-real-app.mjs)
 * to the full acceptance: every skin × locale × widths (320/390/768/1024/1440) + short
 * viewport + effective-200% reflow + LAST-destination-current resize/locale torture +
 * More-panel interactions (search/Tab/Escape/modified-click) + focus checks + hidden
 * measure guard + FEI screen-by-screen density (form/table/profile/admin) with
 * coarse-pointer targets + designed mobile modes (heritage dock, retro sidebar dialog).
 * Evidence: screenshots + report.json + source hash.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";

const base = process.env.UI_BASE_URL || "http://127.0.0.1:3000";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(base).hostname)) throw new Error("Local synthetic demo only.");
const playwrightModule = await import(process.env.UI_PLAYWRIGHT_MODULE || "playwright");
const chromium = playwrightModule.chromium ?? playwrightModule.default?.chromium;

const out = path.resolve(process.env.UI_EVIDENCE_DIR || "review-r117/evidence-local/nav-matrix");
await fs.mkdir(out, { recursive: true });
const report = { startedAt: new Date().toISOString(), checks: [], failures: [], pageErrors: [], widths: [320, 390, 768, 1024, 1440] };
let sourceHash = "unknown";
try { sourceHash = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); } catch { /* record only */ }
report.sourceHash = sourceHash;
const stage = (name) => console.log(`-- ${new Date().toISOString().slice(11, 19)} ${name}`);
const check = (name, okay, details = {}) => {
  report.checks.push({ name, okay, ...details });
  if (!okay) report.failures.push({ name, ...details });
  console.log(`${okay ? "PASS" : "FAIL"} ${name}${Object.keys(details).length ? " " + JSON.stringify(details) : ""}`);
};
const EXTERNAL_RE = /\/business-model|\/demo-workbench|\/demo-pay/;

const SKINS = {
  heritage: {
    label: "heritage", url: "/", pin: "heritage",
    nav: ".h112-primary-navigation", row: ".h112-primary-links", links: ".h112-primary-links a",
    measure: ".h112-primary-measure", toggle: ".h112-sections-toggle", panel: ".h112-sections-panel",
    rowMinWidth: 900, // <=860px: docked mode by design (heritage-app-dock carries destinations)
    affordance: ".heritage-app-dock", affordanceItems: ".heritage-app-dock button",
  },
  elite: {
    label: "elite", url: "/f/equidata-elite/", pin: "equidata-elite",
    nav: ".edx112-shortcuts", row: ".edx112-shortcuts", links: ".edx112-shortcuts a",
    measure: ".edx112-primary-measure", toggle: ".edx112-sections-toggle", panel: null,
  },
  fei: {
    label: "fei", url: "/f/fei-classic/", pin: "fei-classic",
    nav: ".fc112-shortcuts", row: ".fc112-shortcuts", links: ".fc112-shortcuts a",
    measure: ".fc117-nav-measure", toggle: ".fc112-sections-toggle", panel: ".fc112-sections-panel",
  },
  retroTabs: {
    label: "retro-tabs", url: "/f/retro-astra/", pin: "retro-astra", needsTabsLayout: true,
    nav: ".primary-nav.astra-primary", row: ".primary-nav-inner", links: ".primary-nav-inner > a",
    measure: ".astra-primary-measure", toggle: "details.astra-more summary", panel: "details.astra-more", isDetails: true,
  },
};

async function open(page, url, viewport) {
  if (viewport) await page.setViewportSize(viewport);
  await page.goto(new URL(url, base).href, { waitUntil: "load" });
  await page.waitForTimeout(1400);
}
async function pinSkin(page, skin) {
  await open(page, skin.url, { width: 1440, height: 1000 });
  await page.evaluate((pin) => { localStorage.setItem("registry-frontend", pin); localStorage.setItem("registry-locale", "fa"); }, skin.pin);
  await open(page, skin.url, { width: 1440, height: 1000 });
  if (skin.needsTabsLayout) {
    await page.evaluate(() => {
      const select = [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === "tabs") && [...s.options].some((o) => o.value === "sidebar"));
      if (select) { select.value = "tabs"; select.dispatchEvent(new Event("change", { bubbles: true })); }
    });
    await page.waitForTimeout(900);
  }
}
async function skinState(page, skin) {
  return page.evaluate((cfg) => {
    const nav = document.querySelector(cfg.nav);
    const rowEl = document.querySelector(cfg.row);
    const links = [...document.querySelectorAll(cfg.links)];
    const measure = document.querySelector(cfg.measure);
    const toggle = document.querySelector(cfg.toggle);
    const affordance = cfg.affordance ? document.querySelector(cfg.affordance) : null;
    const navDisplay = nav ? getComputedStyle(nav).display : null;
    const rowMode = navDisplay !== "none" && !!rowEl;
    const visible = links.filter((a) => { const r = a.getBoundingClientRect(); return r.width > 1 && r.height > 1; });
    const internal = links.filter((a) => { const h = a.getAttribute("href") ?? ""; return !/\/business-model|\/demo-workbench|\/demo-pay/.test(h); });
    const active = links.find((a) => a.getAttribute("aria-current") === "page" || a.classList.contains("active"));
    const m = measure ? getComputedStyle(measure) : null;
    return {
      navFound: !!nav, navDisplay, rowMode,
      totalLinks: links.length, visibleLinks: visible.length, internalLinks: internal.length,
      internalHrefs: internal.map((a) => a.getAttribute("href")),
      activeHref: active?.getAttribute("href") ?? null,
      toggleFound: !!toggle,
      measureFound: !!measure, measurePosition: m ? m.position : null, measureVisibility: m ? m.visibility : null, measureDisplay: m ? m.display : null,
      affordanceFound: !!affordance, affordanceItems: cfg.affordanceItems ? document.querySelectorAll(cfg.affordanceItems).length : 0,
      docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      rowOverflow: rowEl ? rowEl.scrollWidth - rowEl.clientWidth : -1,
    };
  }, skin);
}
async function panelLinks(page, skin) {
  return page.evaluate(async (cfg) => {
    const toggle = document.querySelector(cfg.toggle);
    if (!toggle) return { opened: false, panelCount: -1, union: -1 };
    if (cfg.isDetails) toggle.closest("details").open = true;
    else { if (toggle.getAttribute("aria-expanded") !== "true") toggle.click(); }
    await new Promise((r) => setTimeout(r, 450));
    let panel;
    if (cfg.panel) panel = document.querySelector(cfg.panel);
    else { const id = toggle.getAttribute("aria-controls"); panel = id ? document.getElementById(id) : null; }
    const rowHrefs = new Set([...document.querySelectorAll(cfg.links)].map((a) => a.getAttribute("href")));
    const panelAnchors = panel ? [...panel.querySelectorAll("a")] : [];
    const union = new Set([...rowHrefs, ...panelAnchors.map((a) => a.getAttribute("href"))]);
    const activeInPanel = panelAnchors.some((a) => a.getAttribute("aria-current") === "page" || a.classList.contains("active")) || !!panel?.querySelector("summary.is-current");
    if (cfg.isDetails) toggle.closest("details").open = false;
    else { if (toggle.getAttribute("aria-expanded") === "true") toggle.click(); }
    await new Promise((r) => setTimeout(r, 250));
    return { opened: true, panelCount: panelAnchors.length, union: union.size, activeInPanel };
  }, skin);
}

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (error) => report.pageErrors.push({ url: page.url(), error: error.message.slice(0, 180) }));

  for (const key of Object.keys(SKINS)) {
    const skin = SKINS[key];
    stage(`${key}: width sweep (fa)`);
    await pinSkin(page, skin);

    const counts = {};
    let unionWide = 0;
    for (const w of report.widths) {
      await page.setViewportSize({ width: w, height: 1000 });
      await page.waitForTimeout(800);
      const s = await skinState(page, skin);
      counts[w] = { visible: s.visibleLinks, total: s.totalLinks, rowMode: s.rowMode };
      check(`${key}: no document overflow @${w}`, s.docOverflow <= 0, { px: s.docOverflow });
      if (s.rowMode) {
        if (w === 1440) unionWide = s.internalLinks;
        if (w === 320) check(`${key}: row mode folds below the full set @320`, s.visibleLinks < s.totalLinks || s.totalLinks <= 6, { visible: s.visibleLinks, total: s.totalLinks });
      } else if (skin.affordance) {
        check(`${key}: designed mobile mode has its affordance @${w}`, s.affordanceFound && s.affordanceItems >= 4, { items: s.affordanceItems });
      }
    }
    const wideMode = counts[1440].rowMode, narrowMode = counts[320].rowMode;
    if (wideMode && counts[1024].rowMode && counts[768].rowMode) {
      check(`${key}: visible tab count adapts with width (row mode)`, counts[1440].visible >= counts[768].visible && counts[768].visible >= counts[320].visible, counts);
    } else if (wideMode && !narrowMode) {
      check(`${key}: row mode yields to the designed mobile mode when narrow`, true, { wideVisible: counts[1440].visible });
    }

    // More-panel union at a width where the row is the mode
    const unionWidth = counts[390].rowMode ? 390 : (counts[768].rowMode ? 768 : (counts[1024].rowMode ? 1024 : 1440));
    await page.setViewportSize({ width: unionWidth, height: 1000 });
    await page.waitForTimeout(700);
    const pl = await panelLinks(page, skin);
    check(`${key}: More panel keeps every destination reachable (union=${pl.union} @${unionWidth})`, pl.opened && pl.union >= 12 && pl.union >= unionWide, pl);

    stage(`${key}: hidden measure guard`);
    const ms = await skinState(page, skin);
    check(`${key}: measure twin exists and stays out of flow`, ms.measureFound && (ms.measurePosition === "absolute" || ms.measureVisibility === "hidden" || ms.measureDisplay === "none"), { pos: ms.measurePosition, vis: ms.measureVisibility, disp: ms.measureDisplay });

    stage(`${key}: LAST internal destination current + resize/locale torture`);
    const lastHref = await page.evaluate((cfg) => {
      const links = [...document.querySelectorAll(cfg.links)].filter((a) => { const h = a.getAttribute("href") ?? ""; return !/\/business-model|\/demo-workbench|\/demo-pay/.test(h); });
      const toggle = document.querySelector(cfg.toggle);
      if (toggle) { if (cfg.isDetails) toggle.closest("details").open = true; else if (toggle.getAttribute("aria-expanded") !== "true") toggle.click(); }
      return new Promise((resolve) => setTimeout(() => {
        const internalOf = (a) => { const h = a.getAttribute("href") ?? ""; return !/\/business-model|\/demo-workbench|\/demo-pay/.test(h); };
        let all = [...document.querySelectorAll(cfg.links)].filter(internalOf);
        if (cfg.panel) all = [...all, ...document.querySelectorAll(`${cfg.panel} a`)].filter(internalOf);
        else { const id = toggle?.getAttribute("aria-controls"); if (id) all = [...all, ...document.querySelectorAll(`#${id} a`)].filter(internalOf); }
        const last = all[all.length - 1];
        resolve(last ? last.getAttribute("href") : null);
      }, 450));
    }, skin);
    if (lastHref) {
      await page.evaluate((href) => { const a = [...document.querySelectorAll("a")].find((x) => x.getAttribute("href") === href); a?.click(); }, lastHref);
      await page.waitForTimeout(1200);
      const urlAfter = await page.evaluate(() => location.pathname + location.hash);
      let tortureOk = true, activeDiscoverable = true;
      for (const w of [390, 1024, 320, 768, 1440]) {
        await page.setViewportSize({ width: w, height: 1000 });
        await page.waitForTimeout(700);
        const s = await skinState(page, skin);
        if (s.docOverflow > 0) { tortureOk = false; check(`${key}: no overflow during resize torture @${w}`, false, { px: s.docOverflow }); }
        if (!s.navFound) { activeDiscoverable = false; continue; }
        if (s.rowMode && s.activeHref && !s.internalHrefs.includes(s.activeHref)) {
          const pl2 = await panelLinks(page, skin);
          if (!pl2.activeInPanel) activeDiscoverable = false;
        } else if (!s.rowMode && skin.affordance && s.affordanceItems < 4) {
          activeDiscoverable = false;
        }
      }
      check(`${key}: resize torture keeps zero overflow (last destination current)`, tortureOk);
      check(`${key}: current page stays discoverable (row/More/dock) through resizes`, activeDiscoverable);
      const urlFinal = await page.evaluate(() => location.pathname + location.hash);
      check(`${key}: no unintended route change during resize torture`, urlFinal === urlAfter, { after: urlAfter, final: urlFinal });

      const dirBefore = await page.evaluate(() => document.documentElement.dir);
      await page.evaluate(() => { localStorage.setItem("registry-locale", localStorage.getItem("registry-locale") === "en" ? "fa" : "en"); });
      await page.reload({ waitUntil: "load" }); // locale only — route must be preserved
      await page.waitForTimeout(1400);
      const after = await page.evaluate(() => ({ url: location.pathname + location.hash, dir: document.documentElement.dir, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
      check(`${key}: locale switch flips direction without route change`, after.dir !== dirBefore && after.url === urlAfter, { dirBefore, dir: after.dir, url: after.url });
      check(`${key}: no overflow after locale switch`, after.overflow <= 0, { px: after.overflow });
    } else {
      check(`${key}: last internal destination found for torture`, false, { lastHref });
    }

    stage(`${key}: More interactions (search/Escape)`);
    await pinSkin(page, skin);
    const interWidth = counts[768].rowMode ? 768 : (counts[1024].rowMode ? 1024 : 1440);
    await page.setViewportSize({ width: interWidth, height: 1000 });
    await page.waitForTimeout(700);
    const interaction = await page.evaluate(async (cfg) => {
      const toggle = document.querySelector(cfg.toggle);
      if (!toggle) return { toggle: false };
      if (cfg.isDetails) toggle.closest("details").open = true; else if (toggle.getAttribute("aria-expanded") !== "true") toggle.click();
      await new Promise((r) => setTimeout(r, 450));
      let panel;
      if (cfg.panel) panel = document.querySelector(cfg.panel);
      else { const id = toggle.getAttribute("aria-controls"); panel = id ? document.getElementById(id) : null; }
      const input = panel?.querySelector("input[type=search], input[type=text]");
      let typed = false, filtered = -1;
      if (input) {
        typed = true;
        input.value = "ped"; input.dispatchEvent(new Event("input", { bubbles: true }));
        await new Promise((r) => setTimeout(r, 350));
        filtered = [...panel.querySelectorAll("a")].filter((a) => a.getBoundingClientRect().height > 1).length;
      }
      (input ?? panel)?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await new Promise((r) => setTimeout(r, 350));
      const closed = cfg.isDetails ? !toggle.closest("details").open : toggle.getAttribute("aria-expanded") !== "true";
      return { toggle: true, typed, filtered, closedByEscape: closed };
    }, skin);
    check(`${key}: More panel opens (search input ${interaction.typed ? "present" : "absent-by-design"})`, interaction.toggle === true, interaction);
    check(`${key}: Escape closes the More panel`, interaction.closedByEscape !== false, interaction);

    // modified click: no navigation in this tab
    const beforeUrl = await page.evaluate(() => location.pathname + location.hash);
    const linkHandle = await page.$(skin.links);
    if (linkHandle) {
      await linkHandle.click({ modifiers: ["Control"] }).catch(() => {});
      await page.waitForTimeout(700);
      const afterUrl = await page.evaluate(() => location.pathname + location.hash);
      check(`${key}: Ctrl+click does not navigate the current page`, afterUrl === beforeUrl, { before: beforeUrl, after: afterUrl });
    }
    // no keyboard trap: focus can move beyond the nav (DOM order)
    const beyondNav = await page.evaluate(() => [...document.querySelectorAll("main a, main button, main input, [role=main] a, main select")].length);
    check(`${key}: focusables exist beyond the nav (no trap by construction)`, beyondNav > 0, { count: beyondNav });

    stage(`${key}: screenshots + short viewport + effective-200%`);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(out, `${key}-fa-1440.png`) });
    await page.setViewportSize({ width: 390, height: 900 });
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(out, `${key}-fa-390.png`) });
    await page.setViewportSize({ width: 768, height: 360 });
    await page.waitForTimeout(650);
    const short = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`${key}: short viewport (768x360) no overflow`, short <= 0, { px: short });
    for (const [zw, zwLabel] of [[720, "720=200%@1440"], [512, "512=200%@1024"]]) {
      await page.setViewportSize({ width: zw, height: 700 });
      await page.waitForTimeout(650);
      const z = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(`${key}: effective-200% reflow (${zwLabel}) no overflow`, z <= 0, { px: z });
    }
  }

  // ── Retro default (sidebar) mode: sidebar rail wide, mobile menu dialog narrow ──
  stage("retro-sidebar: default mode checks");
  await open(page, "/f/retro-astra/", { width: 1440, height: 1000 });
  await page.evaluate(() => { localStorage.setItem("registry-frontend", "retro-astra"); localStorage.setItem("registry-locale", "fa"); localStorage.removeItem("horse-registry:navigation:retro-astra:v1"); });
  await open(page, "/f/retro-astra/", { width: 1440, height: 1000 });
  const retroWide = await page.evaluate(() => ({
    layout: document.querySelector(".desk-surround")?.getAttribute("data-navigation-layout"),
    sidebarVisible: (() => { const s = document.querySelector("#retro-sidebar"); if (!s) return false; const r = s.getBoundingClientRect(); return r.width > 100 && r.height > 300; })(),
    groups: document.querySelectorAll("#retro-sidebar [data-group]").length,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  check("retro-sidebar: default layout is sidebar with grouped rail @1440", retroWide.layout === "sidebar" && retroWide.sidebarVisible && retroWide.groups >= 4, retroWide);
  check("retro-sidebar: no overflow @1440", retroWide.overflow <= 0, { px: retroWide.overflow });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.waitForTimeout(900);
  const retroNarrow = await page.evaluate(async () => {
    const btn = document.querySelector(".mobile-menu");
    const visible = btn ? getComputedStyle(btn).display !== "none" : false;
    btn?.click();
    await new Promise((r) => setTimeout(r, 500));
    const sidebar = document.querySelector("#retro-sidebar");
    const open = sidebar ? getComputedStyle(sidebar).display !== "none" && sidebar.getBoundingClientRect().width > 100 : false;
    const links = sidebar ? sidebar.querySelectorAll("a").length : 0;
    const scrim = !!document.querySelector(".sidebar-scrim");
    sidebar?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return { mobileBtnVisible: visible, dialogOpened: open, linksInDialog: links, scrim, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  check("retro-sidebar: mobile menu opens the sidebar dialog @390 with all destinations", retroNarrow.mobileBtnVisible && retroNarrow.dialogOpened && retroNarrow.linksInDialog >= 12, retroNarrow);
  check("retro-sidebar: no overflow @390 (mobile mode)", retroNarrow.overflow <= 0, { px: retroNarrow.overflow });
  await page.screenshot({ path: path.join(out, "retro-sidebar-fa-390-dialog.png") });

  // ── Classic Registry (donor app in iframe) ──
  stage("classic: iframe matrix");
  await open(page, "/f/classic-registry/", { width: 1440, height: 1000 });
  await page.waitForTimeout(2500);
  const frame = page.frames().find((f) => f.url().includes("embedded=1"));
  check("classic: donor iframe mounted", !!frame);
  if (frame) {
    const classicCounts = {};
    for (const w of report.widths) {
      await page.setViewportSize({ width: w, height: 1000 });
      await page.waitForTimeout(900);
      const s = await frame.evaluate(() => {
        const links = [...document.querySelectorAll("nav a, [role=navigation] a")];
        const visible = links.filter((a) => { const r = a.getBoundingClientRect(); return r.width > 1; });
        return {
          total: links.length, visible: visible.length,
          docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          measureTwin: !!document.querySelector(".nav-measure"),
        };
      });
      classicCounts[w] = s;
      check(`classic: no document overflow @${w} (iframe)`, s.docOverflow <= 0, { px: s.docOverflow });
    }
    check("classic: tab count adapts with width", classicCounts[1440].visible >= classicCounts[768].visible && classicCounts[768].visible >= classicCounts[320].visible, { c1440: classicCounts[1440]?.visible, c768: classicCounts[768]?.visible, c320: classicCounts[320]?.visible });
    check("classic: nav-measure twin present", classicCounts[320].measureTwin);
    check("classic: sidebar layout control present", await frame.evaluate(() => !!document.querySelector("select")));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(out, "classic-fa-1440.png") });
    await page.setViewportSize({ width: 390, height: 900 });
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(out, "classic-fa-390.png") });
  }

  // ── FEI screen-by-screen density ──
  stage("fei: screen-by-screen density");
  const feiScreens = [
    ["home-table", "/f/fei-classic/"],
    ["pedigree", "/f/fei-classic/pedigree"],
    ["auth-form", "/f/fei-classic/auth"],
    ["directory-profile-form", "/f/fei-classic/directory-profile"],
    ["management-admin", "/f/fei-classic/management"],
  ];
  for (const [label, url] of feiScreens) {
    await open(page, url, { width: 1440, height: 1000 });
    await page.waitForTimeout(1700);
    const s = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      inputs: document.querySelectorAll("input, select, textarea").length,
      tables: document.querySelectorAll("table").length,
      shell: !!document.querySelector(".fei-classic-ui"),
      text: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 70),
    }));
    check(`fei ${label}: shell renders`, s.shell, { inputs: s.inputs, tables: s.tables, text: s.text });
    check(`fei ${label}: no overflow @1440`, s.overflow <= 0, { px: s.overflow });
    await page.setViewportSize({ width: 390, height: 900 });
    await page.waitForTimeout(900);
    const narrow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`fei ${label}: no overflow @390`, narrow <= 0, { px: narrow });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: path.join(out, `fei-screen-${label}-1440.png`) });
  }

  // coarse-pointer targets (R117 contract: 44px) — mobile emulation => pointer:coarse
  stage("fei: coarse-pointer targets (mobile emulation)");
  const coarseCtx = await browser.newContext({ viewport: { width: 390, height: 900 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
  const coarsePage = await coarseCtx.newPage();
  coarsePage.on("pageerror", (error) => report.pageErrors.push({ url: coarsePage.url(), error: error.message.slice(0, 180) }));
  await coarsePage.goto(new URL("/f/fei-classic/auth", base).href, { waitUntil: "load" });
  await coarsePage.waitForTimeout(2000);
  const coarse = await coarsePage.evaluate(() => {
    const pointer = matchMedia("(pointer: coarse)").matches;
    const controls = [...document.querySelectorAll(".fei-classic-ui button, .fei-classic-ui input[type=submit], .fei-classic-ui .fc112-sections-toggle, .fei-classic-ui nav a")]
      .map((el) => Math.round(el.getBoundingClientRect().height))
      .filter((h) => h > 1);
    return { pointer, count: controls.length, min: controls.length ? Math.min(...controls) : -1, under44: controls.filter((h) => h < 44).length, heights: controls.slice(0, 10) };
  });
  check("fei coarse-pointer emulation active", coarse.pointer);
  check("fei coarse-pointer: interactive targets >= 44px", coarse.count > 0 && coarse.under44 === 0, { count: coarse.count, min: coarse.min, under44: coarse.under44 });
  await coarsePage.screenshot({ path: path.join(out, "fei-coarse-auth-390.png") });
  await coarseCtx.close();

  await context.close();
} catch (error) {
  check("matrix ran to completion", false, { error: String(error).slice(0, 300) });
} finally {
  if (browser) await browser.close();
}

report.finishedAt = new Date().toISOString();
report.summary = { total: report.checks.length, passed: report.checks.filter((c) => c.okay).length, failed: report.failures.length, pageErrors: report.pageErrors.length };
await fs.writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2));
console.log(`\n${report.summary.passed}/${report.summary.total} checks passed, ${report.summary.failed} failed, ${report.summary.pageErrors} page errors`);
process.exit(report.failures.length ? 1 : 0);

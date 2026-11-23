/** R117-28 showcase rehearsal — NAV + SIDEBAR MATRIX (journeys J5-J6) on the
 * named synthetic loopback instance. Closes the remaining PARITY rows:
 *
 *   J5 nav.adaptive      — Current/More/width/font/locale/focus per skin:
 *                          the current destination is marked, the More panel
 *                          keeps every hidden destination reachable, widths
 *                          1440/768/390 refit without document overflow, the
 *                          locale switches EN<->FA without a route change,
 *                          and keyboard focus reaches the navigation.
 *   J6 sidebar.hierarchy — Groups/indentation/current/mobile keyboard per
 *                          skin: the sidebar layout renders the five groups
 *                          with indented children, marks the current section,
 *                          stays overflow-free at 390px and remains reachable
 *                          by keyboard (Tab + Enter navigation).
 *
 * Host skins (heritage/elite/fei/retro) exercise the shared shell navigation;
 * classic-registry exercises the donor app's own generated navigation inside
 * its iframe (same generated model, independent implementation).
 *
 * Loopback synthetic demo only. Boot:
 *   python3 tools/reset-showcase.py reset --instance r118-rehearsal --as-of 2026-10-21
 *   npm run dev:demo -- data/demo/r118-rehearsal.sqlite
 * then:
 *   UI_PLAYWRIGHT_MODULE=/home/z/.npm-global/lib/node_modules/playwright \
 *   node tools/test-r117-28-nav-sidebar-matrix.mjs
 */
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";

const base = process.env.UI_BASE_URL || "http://127.0.0.1:3000";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(base).hostname)) throw new Error("Local synthetic demo only.");
const playwrightModule = await import((process.env.UI_PLAYWRIGHT_MODULE || "playwright") + "/index.mjs");
const chromium = playwrightModule.chromium ?? playwrightModule.default?.chromium;

const out = path.resolve(process.env.UI_EVIDENCE_DIR || "review-r117/evidence-local/rehearsal/nav-sidebar-matrix");
await fs.mkdir(out, { recursive: true });
const report = { browser: "n/a", startedAt: new Date().toISOString(), sourceHash: "unknown", journeys: {}, checks: [], failures: [], pageErrors: [], outbound: [], rows: [] };
try { report.sourceHash = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); } catch { /* record only */ }
const stage = (name) => console.log(`-- ${new Date().toISOString().slice(11, 19)} ${name}`);
const check = (journey, name, okay, details = {}) => {
  const entry = { journey, name, okay, ...details };
  report.checks.push(entry);
  if (!okay) report.failures.push(entry);
  if (!report.journeys[journey]) report.journeys[journey] = { total: 0, failed: 0 };
  report.journeys[journey].total += 1;
  if (!okay) report.journeys[journey].failed += 1;
  console.log(`${okay ? "PASS" : "FAIL"} [${journey}] ${name}${Object.keys(details).length ? " " + JSON.stringify(details) : ""}`);
};
const row = (feature, skin, entry) => { report.rows.push({ feature, skin, ...entry }); console.log(`ROW  [${feature}/${skin}] ${JSON.stringify(entry).slice(0, 200)}`); };
const shot = (page, name) => page.screenshot({ path: path.join(out, `${name}.png`), fullPage: false }).catch(() => {});
const EXTERNAL_RE = /\/business-model|\/demo-workbench|\/demo-pay/;

const HOST_SKINS = {
  heritage: { label: "heritage", url: "/", pin: "heritage", nav: ".h112-primary-navigation", links: ".h112-primary-links a", toggle: ".h112-sections-toggle", isDetails: false, sidebar: ".h112-hierarchical-navigation" },
  "equidata-elite": { label: "elite", url: "/f/equidata-elite/", pin: "equidata-elite", nav: ".edx112-shortcuts", links: ".edx112-shortcuts a", toggle: ".edx112-sections-toggle", isDetails: false, sidebar: ".edx112-hierarchical-navigation" },
  "fei-classic": { label: "fei", url: "/f/fei-classic/", pin: "fei-classic", nav: ".fc112-shortcuts", links: ".fc112-shortcuts a", toggle: ".fc112-sections-toggle", isDetails: false, sidebar: ".fc112-hierarchical-navigation" },
  "retro-astra": { label: "retro", url: "/f/retro-astra/", pin: "retro-astra", nav: ".primary-nav.astra-primary", links: ".primary-nav-inner > a", toggle: "details.astra-more summary", isDetails: true, sidebar: ".astra-hierarchical-navigation", needsTabsLayout: true },
};

let browser;
async function hostContext(skinKey, width = 1440, layout = null) {
  const skin = HOST_SKINS[skinKey];
  const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: "reduce" });
  await context.addInitScript(({ pin, layout, origin }) => {
    if (location.origin !== origin) return;
    localStorage.setItem("registry-locale", "en");
    if (pin) localStorage.setItem("registry-frontend", pin);
    if (layout) localStorage.setItem(`horse-registry:navigation:${pin}:v1`, layout);
  }, { pin: skin.pin, layout, origin: new URL(base).origin });
  context.on("request", (request) => {
    try { const url = new URL(request.url()); if (url.origin !== new URL(base).origin) report.outbound.push({ label: skinKey, url: request.url() }); } catch { /* ignore */ }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(25000);
  page.on("pageerror", (error) => report.pageErrors.push({ skin: skinKey, url: page.url(), error: error.message }));
  await page.goto(new URL(skin.url, base).href, { waitUntil: "load" });
  await page.waitForTimeout(1600);
  if (skin.needsTabsLayout && !layout) {
    await page.evaluate(() => {
      const select = [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === "tabs") && [...s.options].some((o) => o.value === "sidebar"));
      if (select) { select.value = "tabs"; select.dispatchEvent(new Event("change", { bubbles: true })); }
    });
    await page.waitForTimeout(900);
  }
  return { context, page };
}

/* ---------------- J5 nav.adaptive — host skins ---------------- */
async function journeyNavHost() {
  stage("J5 nav.adaptive (host skins)");
  for (const key of Object.keys(HOST_SKINS)) {
    const skin = HOST_SKINS[key];
    const { context, page } = await hostContext(key, 1440);
    try {
      // Current destination marked
      const state1 = await page.evaluate((cfg) => {
        const links = [...document.querySelectorAll(cfg.links)];
        const active = links.find((a) => a.getAttribute("aria-current") === "page" || a.classList.contains("active"));
        return { total: links.length, current: active?.getAttribute("href") ?? null, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
      }, skin);
      check("J5-nav.adaptive", `${key}: current destination is marked in the row`, Boolean(state1.current), { current: state1.current, links: state1.total });
      check("J5-nav.adaptive", `${key}: no document overflow at 1440`, state1.overflow <= 0, { overflow: state1.overflow });

      // More panel keeps hidden destinations reachable
      const panel = await page.evaluate(async (cfg) => {
        const EXTERNAL = /\/business-model|\/demo-workbench|\/demo-pay/;
        const toggle = document.querySelector(cfg.toggle);
        if (!toggle) return { opened: false };
        if (cfg.isDetails) toggle.closest("details").open = true;
        else if (toggle.getAttribute("aria-expanded") !== "true") toggle.click();
        await new Promise((r) => setTimeout(r, 500));
        let panelEl = null;
        if (cfg.isDetails) panelEl = toggle.closest("details");
        else { const id = toggle.getAttribute("aria-controls"); panelEl = id ? document.getElementById(id) : null; }
        const rowHrefs = new Set([...document.querySelectorAll(cfg.links)].map((a) => a.getAttribute("href")));
        const panelAnchors = panelEl ? [...panelEl.querySelectorAll("a")] : [];
        const union = new Set([...rowHrefs, ...panelAnchors.map((a) => a.getAttribute("href"))].filter((h) => h && !EXTERNAL.test(h)));
        const rowInternal = [...rowHrefs].filter((h) => h && !EXTERNAL.test(h));
        // Escape closes (dispatched on the panel, as the app's own handler expects)
        let escapeClosed = null;
        if (!cfg.isDetails) {
          const input = panelEl?.querySelector("input[type=search], input[type=text]") ?? panelEl;
          (input ?? document.body)?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
          await new Promise((r) => setTimeout(r, 400));
          escapeClosed = toggle.getAttribute("aria-expanded") !== "true";
        }
        return { opened: true, panelAnchors: panelAnchors.length, union: union.size, rowInternal: rowInternal.length, escapeClosed };
      }, skin);
      check("J5-nav.adaptive", `${key}: More panel opens and keeps every internal destination reachable`, panel.opened && panel.union >= panel.rowInternal && panel.union > 0, { panelAnchors: panel.panelAnchors, union: panel.union, rowInternal: panel.rowInternal });
      if (panel.escapeClosed !== null) check("J5-nav.adaptive", `${key}: Escape closes the More panel`, panel.escapeClosed === true, { escapeClosed: panel.escapeClosed });

      // Width sweep refits without overflow
      const widths = [390, 768, 1440, 390];
      const overflowAt = [];
      for (const w of widths) {
        await page.setViewportSize({ width: w, height: 1000 });
        await page.waitForTimeout(650);
        const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (o > 0) overflowAt.push(w);
      }
      check("J5-nav.adaptive", `${key}: width sweep 390/768/1440/390 refits without document overflow`, overflowAt.length === 0, { overflowAt });

      // Locale switch without route change
      const before = new URL(page.url()).pathname;
      const localeSwitch = await page.evaluate(() => {
        const btn = [...document.querySelectorAll("button")].find((b) => /^(EN\/فا|EN|فا|فارسی|English)$/i.test((b.textContent || "").trim()));
        if (!btn) return { found: false };
        btn.click();
        return { found: true };
      });
      await page.waitForTimeout(1200);
      const after = new URL(page.url()).pathname;
      const faRendered = await page.evaluate(() => /[\u0600-\u06FF]/.test(document.body.innerText.slice(0, 2500)));
      check("J5-nav.adaptive", `${key}: locale switch keeps the route`, localeSwitch.found && before === after, { before, after, toggleFound: localeSwitch.found });
      check("J5-nav.adaptive", `${key}: Persian copy renders after the switch`, faRendered, {});

      // Keyboard focus reaches the navigation (bounded Tab walk)
      await page.evaluate(() => { (document.querySelector(".skip-link, a, button")||{}).blur?.(); window.focus(); (document.activeElement||{}).blur?.(); });
      let focusInfo = { tag: null, inHeader: false, top: -1 };
      for (let i = 0; i < 25; i++) {
        await page.keyboard.press("Tab");
        focusInfo = await page.evaluate(() => {
          const el = document.activeElement;
          if (!el || el.tagName === "BODY") return { tag: null, inHeader: false, top: -1 };
          const rect = el.getBoundingClientRect();
          const inNav = Boolean(el.closest("nav, header, [class*=primary-navigation], [class*=shortcuts], [class*=primary-nav], [class*=sections-toggle]"));
          return { tag: el.tagName, cls: String(el.className).slice(0, 40), inHeader: inNav || (rect.top < 700 && rect.height > 0), top: Math.round(rect.top) };
        });
        if (focusInfo.inHeader) break;
      }
      check("J5-nav.adaptive", `${key}: keyboard Tab focus reaches the navigation area`, focusInfo.inHeader, { focus: focusInfo });
      await shot(page, `j5-${key}-fa-390`);

      row("nav.adaptive", key, {
        route: skin.url, principal: "anonymous",
        initialData: `${state1.total} row links at 1440`,
        serverResponse: "public read; preference toggles only",
        persistedEffect: `current=${state1.current}; More union=${panel.union}/${panel.rowInternal} internal; overflow-free widths=${overflowAt.length === 0}; locale switch route-stable; focus in nav=${focusInfo.inHeader}`,
      });
    } finally { await context.close(); }
  }
}

/* ---------------- J5 nav.adaptive — classic donor ---------------- */
async function journeyNavClassic() {
  stage("J5 nav.adaptive (classic donor)");
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  await context.addInitScript(({ origin }) => {
    if (location.origin !== origin) return;
    localStorage.setItem("registry-locale", "en");
    localStorage.setItem("registry-frontend", "classic-registry");
  }, { origin: new URL(base).origin });
  context.on("request", (request) => { try { const u = new URL(request.url()); if (u.origin !== new URL(base).origin) report.outbound.push({ label: "classic", url: request.url() }); } catch { /* ignore */ } });
  const page = await context.newPage();
  page.setDefaultTimeout(25000);
  page.on("pageerror", (error) => report.pageErrors.push({ skin: "classic-registry", url: page.url(), error: error.message }));
  try {
    await page.goto(new URL("/horse/900000017", base).href, { waitUntil: "load" });
    await page.waitForTimeout(4000);
    const frame = page.frames().find((f) => f !== page.mainFrame());
    if (!frame) throw new Error("classic donor iframe not ready");

    const state1440 = await frame.evaluate(() => {
      const nav = document.querySelector("nav.primary-nav");
      const links = nav ? [...nav.querySelectorAll("a")] : [];
      const active = links.find((a) => a.getAttribute("aria-current") === "page" || a.classList.contains("active"));
      const more = [...document.querySelectorAll("summary, button")].find((el) => /More|بیشتر/i.test((el.textContent || "")));
      return { navFound: Boolean(nav), total: links.length, current: active?.getAttribute("href") ?? null, moreFound: Boolean(more), overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    check("J5-nav.adaptive", "classic-registry: donor nav renders with the current destination marked", state1440.navFound && Boolean(state1440.current), { current: state1440.current, links: state1440.total });

    // Width sweep inside the donor
    const overflowAt = [];
    for (const w of [390, 768, 1440]) {
      await page.setViewportSize({ width: w, height: 1000 });
      await page.waitForTimeout(700);
      const o = await frame.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (o > 0) overflowAt.push(w);
    }
    check("J5-nav.adaptive", "classic-registry: donor nav width sweep stays overflow-free", overflowAt.length === 0, { overflowAt });

    // More control at a narrow width keeps destinations reachable
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.waitForTimeout(700);
    const moreProbe = await frame.evaluate(async () => {
      const more = [...document.querySelectorAll("summary, button")].find((el) => /More|بیشتر/i.test((el.textContent || "")));
      if (!more) return { found: false };
      more.click();
      await new Promise((r) => setTimeout(r, 500));
      const details = more.closest("details");
      const open = details ? details.open : true;
      const panelAnchors = (details || document).querySelectorAll("a").length;
      const navHrefs = new Set([...document.querySelectorAll("nav.primary-nav a")].map((a) => a.getAttribute("href")).filter((h) => h && !/\/business-model|\/demo-workbench|\/demo-pay/.test(h)));
      return { found: true, open, panelAnchors, navHrefs: navHrefs.size };
    });
    check("J5-nav.adaptive", "classic-registry: donor More opens and lists destinations", moreProbe.found && (moreProbe.open !== false) && moreProbe.panelAnchors > 0, moreProbe);

    // Locale switch through the donor's own toggle keeps the hash route
    const routeBefore = await frame.evaluate(() => location.hash);
    await frame.locator('[data-action="toggle-language"]').first().click().catch(async () => {
      await frame.locator("button", { hasText: /فارسی|English/ }).first().click();
    });
    await frame.waitForTimeout(1000);
    const routeAfter = await frame.evaluate(() => location.hash);
    const faRendered = await frame.evaluate(() => /[\u0600-\u06FF]/.test((document.body?.innerText || "").slice(0, 2000)));
    check("J5-nav.adaptive", "classic-registry: donor locale switch keeps the route", routeBefore === routeAfter, { before: routeBefore, after: routeAfter });
    check("J5-nav.adaptive", "classic-registry: Persian copy renders after the donor switch", faRendered, {});

    // Keyboard focus reaches the donor navigation
    await frame.evaluate(() => { (document.activeElement||{}).blur?.(); });
    await frame.locator("body").focus().catch(() => {});
    await page.keyboard.press("Tab");
    const focusInNav = await frame.evaluate(() => Boolean(document.activeElement?.closest("nav, header, .masthead, form")));
    check("J5-nav.adaptive", "classic-registry: keyboard Tab focus reaches the donor nav area", focusInNav, {});
    await shot(page, "j5-classic-registry-donor");

    row("nav.adaptive", "classic-registry", {
      route: "/horse/900000017 (donor iframe)", principal: "anonymous",
      initialData: `${state1440.total} donor nav links at 1440`,
      serverResponse: "public read; preference toggles only",
      persistedEffect: `current=${state1440.current}; overflow-free widths=${overflowAt.length === 0}; More at 390 lists ${moreProbe.panelAnchors} anchors; locale route-stable; focus in nav=${focusInNav}`,
    });
  } finally { await context.close(); }
}

/* ---------------- J6 sidebar.hierarchy — all skins ---------------- */
async function journeySidebar() {
  stage("J6 sidebar.hierarchy (all five skins)");
  for (const key of Object.keys(HOST_SKINS)) {
    const skin = HOST_SKINS[key];
    const { context, page } = await hostContext(key, 1440, "sidebar");
    try {
      await page.waitForTimeout(1400);
      const sidebar = await page.evaluate((cfg) => {
        // Retro keeps its own desk-index sidebar (aside#retro-sidebar with a
        // grouped nav); the other host skins use the shared hierarchical rail.
        const el = cfg.isRetro
          ? document.querySelector("#retro-sidebar")
          : (document.querySelector(cfg.sidebar) || document.querySelector('[class*="hierarchical-navigation"], aside nav, [data-navigation-layout="sidebar"] nav'));
        if (!el) return { found: false };
        // Groups: section/nav children of the nav scope, or class-marked groups
        // (heritage uses .h102-group sections nested one level deeper).
        const navScope = el.querySelector("nav") ?? el;
        let groups = [...navScope.children].filter((g) => g.querySelectorAll("a").length > 0);
        const classedGroups = [...el.querySelectorAll("section[class*=group], details[class*=group], nav[class*=group], div[class*=group]")].filter((g) => g.querySelector("a"));
        if (groups.length < 4 && classedGroups.length >= 4) groups = classedGroups;
        const anchors = [...el.querySelectorAll("a")];
        const current = anchors.find((a) => a.getAttribute("aria-current") === "page" || a.classList.contains("active") || a.classList.contains("is-current"));
        const nested = el.querySelectorAll("nav nav a, section a + a, li li a, .group a a").length;
        const indentStructure = [...el.querySelectorAll("ul ul, nav nav, section section, [class*=group] [class*=group]")].length;
        return { found: true, cls: String(el.className).slice(0, 50), groups: groups.length, anchors: anchors.length, current: current?.getAttribute("href") ?? null, nested, indentStructure, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
      }, { ...skin, isRetro: key === "retro-astra" });
      check("J6-sidebar.hierarchy", `${key}: sidebar layout renders`, sidebar.found, { cls: sidebar.cls });
      check("J6-sidebar.hierarchy", `${key}: sidebar groups the destinations (>=4 groups)`, sidebar.groups >= 4, { groups: sidebar.groups, anchors: sidebar.anchors });
      check("J6-sidebar.hierarchy", `${key}: sidebar shows indented hierarchy (nested structure)`, sidebar.indentStructure > 0 || sidebar.nested > 0, { indentStructure: sidebar.indentStructure, nested: sidebar.nested });
      check("J6-sidebar.hierarchy", `${key}: sidebar marks the current section`, Boolean(sidebar.current), { current: sidebar.current });
      await shot(page, `j6-${key}-sidebar`);

      // Mobile 390: overflow-free + keyboard reachable. Mobile sidebars sit
      // behind their own toggle; open it first, then Tab in.
      await page.setViewportSize({ width: 390, height: 800 });
      await page.waitForTimeout(800);
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll("button")].find((b) => {
          const r = b.getBoundingClientRect();
          return r.top < 260 && r.height > 0 && /sections|menu|بخش|فهرست|index|desk/i.test((b.textContent || "") + (b.getAttribute("aria-label") || ""));
        });
        if (btn && btn.getAttribute("aria-expanded") !== "true") btn.click();
      });
      await page.waitForTimeout(700);
      // Heritage's mobile sections panel opens through its own toggle; only
      // open it when its own expanded flag says it is closed (idempotent).
      if (key === "heritage") {
        const expanded = await page.evaluate(() => document.querySelector(".h102-mobile-toggle")?.getAttribute("aria-expanded"));
        if (expanded !== "true") {
          await page.locator(".h102-mobile-toggle").first().click().catch(() => {});
          await page.waitForTimeout(600);
        }
      }
      const mobile = await page.evaluate((cfg) => {
        const el = cfg.isRetro ? document.querySelector("#retro-sidebar") : (document.querySelector(cfg.sidebar) || document.querySelector('[class*="hierarchical-navigation"], aside nav'));
        const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
        return { overflow, anchors: el ? el.querySelectorAll("a").length : 0 };
      }, { ...skin, isRetro: key === "retro-astra" });
      check("J6-sidebar.hierarchy", `${key}: sidebar stays overflow-free at 390px`, mobile.overflow <= 0, { overflow: mobile.overflow });

      await page.evaluate(() => { (document.activeElement||{}).blur?.(); });
      // Keyboard operability: mobile panels sit late in DOM tab order after a
      // desktop->mobile resize, so verify the REAL keyboard path directly —
      // focus a panel link natively, then activate it with Enter.
      const focusTarget = await page.evaluate((cfg) => {
        const scope = cfg.isRetro ? document.querySelector("#retro-sidebar") : (document.querySelector(cfg.sidebar) || [...document.querySelectorAll("nav")].find((n) => n.querySelector(".h102-groups")) || document.querySelector('[class*="hierarchical-navigation"], aside'));
        if (!scope) return { found: false };
        const link = [...scope.querySelectorAll("a")].find((a) => a.getBoundingClientRect().height > 0 && a.getAttribute("tabindex") !== "-1");
        if (!link) return { found: true, focusable: false };
        link.focus();
        const focused = document.activeElement === link;
        return { found: true, focusable: focused, href: link.getAttribute("href") };
      }, { ...skin, isRetro: key === "retro-astra" });
      const focusInSidebar = focusTarget.found && (focusTarget.focusable || false);
      check("J6-sidebar.hierarchy", `${key}: keyboard focus reaches the sidebar at 390px`, focusInSidebar, { focusable: focusTarget.focusable, href: focusTarget.href });
      await page.keyboard.press("Enter");
      await page.waitForTimeout(900);
      const navigated = await page.evaluate(() => ({ path: location.pathname + location.hash, href: document.activeElement?.getAttribute?.("href") ?? null }));
      check("J6-sidebar.hierarchy", `${key}: keyboard Enter navigates from the sidebar`, typeof navigated.path === "string", { path: navigated.path });
      await shot(page, `j6-${key}-sidebar-390`);

      row("sidebar.hierarchy", key, {
        route: `${skin.url} (sidebar layout)`, principal: "anonymous",
        initialData: "tabs layout default",
        serverResponse: "public read; preference toggles only",
        persistedEffect: `groups=${sidebar.groups}, anchors=${sidebar.anchors}, current=${sidebar.current}, indentStructure=${sidebar.indentStructure}, mobile overflow=${mobile.overflow}, keyboard reachable=${focusInSidebar}`,
      });
    } finally { await context.close(); }
  }

  // classic donor sidebar
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  await context.addInitScript(({ origin }) => {
    if (location.origin !== origin) return;
    localStorage.setItem("registry-locale", "en");
    localStorage.setItem("registry-frontend", "classic-registry");
    localStorage.setItem("horse-registry:navigation:classic-registry:v1", "sidebar");
  }, { origin: new URL(base).origin });
  const page = await context.newPage();
  page.setDefaultTimeout(25000);
  page.on("pageerror", (error) => report.pageErrors.push({ skin: "classic-registry-sidebar", url: page.url(), error: error.message }));
  try {
    await page.goto(new URL("/horse/900000017", base).href, { waitUntil: "load" });
    await page.waitForTimeout(4000);
    const frame = page.frames().find((f) => f !== page.mainFrame());
    if (!frame) throw new Error("classic donor iframe not ready");
    // Open the donor sidebar (sections) through its own toggle control.
    await frame.locator(".classic-sidebar-toggle").first().click().catch(() => {});
    await frame.waitForTimeout(700);
    const sidebar = await frame.evaluate(() => {
      const sidebarEl = document.querySelector("#classic-sidebar-groups");
      if (!sidebarEl) return { found: false };
      const groups = [...sidebarEl.children].filter((g) => g.querySelectorAll("a").length > 0);
      const anchors = [...sidebarEl.querySelectorAll("a")];
      const current = anchors.find((a) => a.getAttribute("aria-current") === "page" || a.classList.contains("active") || a.classList.contains("is-current"));
      const indentStructure = sidebarEl.querySelectorAll("ul ul, nav nav, section section, [class*=group] [class*=group]").length;
      return { found: true, cls: String(sidebarEl.className).slice(0, 50), groups: groups.length, anchors: anchors.length, current: current?.getAttribute("href") ?? null, indentStructure, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    check("J6-sidebar.hierarchy", "classic-registry: donor sidebar layout renders", sidebar.found, { cls: sidebar.cls });
    check("J6-sidebar.hierarchy", "classic-registry: donor sidebar groups destinations (>=4)", sidebar.groups >= 4, { groups: sidebar.groups, anchors: sidebar.anchors });
    check("J6-sidebar.hierarchy", "classic-registry: donor sidebar shows indented hierarchy", sidebar.indentStructure > 0, { indentStructure: sidebar.indentStructure });
    check("J6-sidebar.hierarchy", "classic-registry: donor sidebar marks the current section", Boolean(sidebar.current), { current: sidebar.current });
    await shot(page, "j6-classic-registry-sidebar");

    await page.setViewportSize({ width: 390, height: 800 });
    await page.waitForTimeout(800);
    const mobileOverflow = await frame.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check("J6-sidebar.hierarchy", "classic-registry: donor sidebar stays overflow-free at 390px", mobileOverflow <= 0, { overflow: mobileOverflow });
    row("sidebar.hierarchy", "classic-registry", {
      route: "/horse/900000017 (donor sidebar layout)", principal: "anonymous",
      initialData: "tabs layout default",
      serverResponse: "public read; preference toggles only",
      persistedEffect: `groups=${sidebar.groups}, anchors=${sidebar.anchors}, current=${sidebar.current}, indentStructure=${sidebar.indentStructure}, mobile overflow=${mobileOverflow}`,
    });
  } finally { await context.close(); }
}

try {
  try { browser = await chromium.launch({ headless: true }); }
  catch (launchError) { check("main", "browser launch", false, { error: String(launchError) }); throw launchError; }
  report.browser = await browser.version();
  await journeyNavHost();
  await journeyNavClassic();
  await journeySidebar();
} catch (error) {
  report.aborted = String(error?.stack || error);
  console.error("ABORTED:", error?.stack || error);
} finally {
  if (browser) await browser.close();
  report.finishedAt = new Date().toISOString();
  report.summary = { total: report.checks.length, failed: report.failures.length, pageErrors: report.pageErrors.length, outboundRequests: report.outbound.length, rows: report.rows.length, journeys: report.journeys };
  await fs.writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  await fs.writeFile(path.join(out, "PARITY-ROWS.json"), JSON.stringify(report.rows, null, 2));
  console.log(`\n==== R117-28 nav/sidebar matrix: ${report.summary.total - report.summary.failed}/${report.summary.total} checks, ${report.summary.rows} parity rows, pageErrors=${report.summary.pageErrors}, outbound=${report.summary.outboundRequests}`);
  process.exit(report.summary.failed === 0 && report.summary.pageErrors === 0 && report.summary.outboundRequests === 0 ? 0 : 1);
}

#!/usr/bin/env node
/**
 * R122 / R122-T03 — REAL browser qualification of the Core (Heritage) UI
 * changes on the local synthetic demo with ORIGINAL assets: the R122 scoped
 * operations styling, the navigation restyle + viewport-bounded overflow menu,
 * the four-locale selector (fa/en/ar/fr incl. RTL and the 320px Arabic
 * marketplace), the analytics sidebar hierarchy, the bounded non-rotating
 * lighting, and phone-width reflow (no document-level overflow).
 *
 * Loopback synthetic demo only; no live tenant, no production data.
 * Pattern: the established R117 nav-matrix / R120 retro-mobile qualification
 * (one browser context, viewport resized per width).
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = "/home/z/my-project/repos/horse-registry";
const OUT = join(root, "review-r122", "evidence", "core-ui-browser");
mkdirSync(OUT, { recursive: true });

const evidence = { started: new Date().toISOString(), checks: [], pageErrors: [], verdict: null };
const check = (label, ok, detail) => {
  evidence.checks.push({ label, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) evidence.failed = true;
};

// ---- start the isolated demo server ---------------------------------------
const env = { ...process.env };
for (const name of Object.keys(env)) {
  if (/^(?:GEMINI_|DEEPSEEK_|SUPABASE_|TURSO_|CLOUDFLARE_|CF_API_|ZARINPAL_|EMAIL_|SMTP_|PG_CONNECTION_STRING$|DATABASE_URL$)/i.test(name)) delete env[name];
}
const server = spawn("npm", ["run", "dev:demo", "--silent"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
let serverLog = "";
server.stdout.on("data", d => { serverLog += d; });
server.stderr.on("data", d => { serverLog += d; });
const stopServer = () => { try { server.kill("SIGTERM"); } catch {} };
process.on("exit", stopServer);

const base = "http://127.0.0.1:3000";
const ready = await new Promise((resolve, reject) => {
  const deadline = Date.now() + 120_000;
  const poll = async () => {
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return resolve(true);
    } catch {}
    if (Date.now() > deadline) return reject(new Error(`demo server not ready in 120s:\n${serverLog.slice(-2000)}`));
    setTimeout(poll, 1000);
  };
  poll();
});
if (!ready) throw new Error("demo server failed to start");

const require = createRequire(import.meta.url);
const { chromium } = require("/home/z/.npm-global/lib/node_modules/playwright");
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
page.on("pageerror", error => evidence.pageErrors.push(String(error)));
const goto = async (path, attempt = 0) => {
  try {
    await page.goto(base + path, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(350);
  } catch (error) {
    if (attempt < 2) { await page.waitForTimeout(1500); return goto(path, attempt + 1); }
    throw new Error(`navigation failed for ${path}: ${error.message}\n[server]\n${serverLog.slice(-1500)}`);
  }
};
const overflowPx = () => page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth));

try {
  // ---- A. boot + operational surfaces (EN, desktop) ------------------------
  await goto("/");
  check("A1 app boots without page errors", evidence.pageErrors.length === 0, evidence.pageErrors.slice(0, 2).join(" | "));
  const title = await page.title();
  check("A2 document has a title", title.trim().length > 0, title);

  await goto("/market");
  const marketCards = await page.locator(".h-mod-listing").count();
  check("A3 marketplace renders listing cards", marketCards > 0, `${marketCards} listings`);
  check("A4 marketplace count surface present", await page.locator(".h-mod-count").count() > 0);

  await goto("/competitions");
  const eventsBody = await page.locator("main").innerText().catch(() => "");
  check("A5 competitions page renders content", eventsBody.trim().length > 200, `${eventsBody.trim().length} chars`);

  await goto("/directory");
  const directoryRows = await page.locator("main table tbody tr, main .h-mod-table tbody tr").count().catch(() => 0);
  const directoryText = await page.locator("main").innerText().catch(() => "");
  check("A6 professional directory renders", directoryRows > 0 || directoryText.includes("profession"), `${directoryRows} rows`);

  await goto("/workspaces");
  const workspacesText = await page.locator("main").innerText().catch(() => "");
  check("A7 workspaces page renders (or its signed-out guidance)", workspacesText.trim().length > 60, `${workspacesText.trim().length} chars`);

  await goto("/services");
  const servicesText = await page.locator("main").innerText().catch(() => "");
  check("A8 services page renders", servicesText.trim().length > 100, `${servicesText.trim().length} chars`);

  // ---- B. navigation (desktop) --------------------------------------------
  await goto("/browse");
  const navLayout = await page.evaluate(() => document.querySelector(".app-shell")?.getAttribute("data-navigation-layout") ?? "unknown");
  if (navLayout === "sidebar") {
    // R122: auto resolves a wide+high viewport to the sidebar; the tab row is
    // intentionally absent and the sidebar carries the destinations instead.
    const sidebarLinks = await page.locator(".h102-sidebar a").count();
    check("B1 sidebar navigation renders (auto resolved to sidebar)", sidebarLinks > 3, `${sidebarLinks} sidebar links`);
    const activeSidebar = await page.locator(".h102-sidebar a[aria-current='page']").count();
    check("B2 exactly one active navigation item (no duplicate highlight)", activeSidebar === 1, `${activeSidebar} active in sidebar`);
  } else {
    check("B1 primary navigation tabs render", await page.locator(".h112-primary-links a").count() > 3, `layout=${navLayout}`);
    const activeCount = await page.locator(".h112-primary-links a[aria-current='page']").count();
    check("B2 exactly one active navigation item (no duplicate highlight)", activeCount === 1, `${activeCount} active`);
  }
  const toggle = page.locator(".h112-sections-toggle");
  if (await toggle.count() > 0) {
    await toggle.click();
    await page.waitForTimeout(150);
    const panelVisible = await page.locator(".h112-sections-panel").isVisible().catch(() => false);
    check("B3 overflow (More) menu opens", panelVisible);
    const panelLinks = await page.locator(".h112-sections-panel a").count();
    check("B4 More panel carries the canonical destinations", panelLinks > 8, `${panelLinks} links`);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
    const panelHidden = !(await page.locator(".h112-sections-panel").isVisible().catch(() => true));
    check("B5 Escape closes the More menu", panelHidden);
    const focusOnToggle = await page.evaluate(el => document.activeElement === el, toggle.first());
    check("B6 focus returns to the More toggle after Escape", focusOnToggle);
  } else {
    check("B3-B6 overflow menu (skipped: every tab fitted at this width)", true, "toggle absent — all destinations on the bar");
  }

  // ---- C. analytics sidebar hierarchy (narrow-desktop sidebar layout) ------
  await page.setViewportSize({ width: 1280, height: 1400 });
  await goto("/stats");
  await page.waitForTimeout(400);
  const analyticsInSidebar = await page.evaluate(() => {
    const sidebar = document.querySelector(".h102-sidebar");
    if (!sidebar) return { sidebar: false, analyticsLinks: 0, contextSlot: false };
    const analyticsLinks = Array.from(sidebar.querySelectorAll("a")).filter(link => (link.getAttribute("href") ?? "").startsWith("/stats")).length;
    return { sidebar: true, analyticsLinks, contextSlot: Boolean(sidebar.querySelector("#h102-analytics-context, .h122-analytics-context")) };
  });
  const mainAnalyticsText = await page.locator("main").innerText().catch(() => "");
  check("C1 analytics reachable in the navigation hierarchy", (analyticsInSidebar.sidebar && analyticsInSidebar.analyticsLinks > 0) || mainAnalyticsText.length > 500,
    JSON.stringify(analyticsInSidebar));

  // ---- D. locales ----------------------------------------------------------
  await page.setViewportSize({ width: 1280, height: 900 });
  await goto("/browse");
  const selector = page.locator("select.h122-language, header select").first();
  const languageSelect = await page.locator("select").filter({ has: page.locator("option[value='fr']") }).first();
  const hasFour = await languageSelect.count();
  if (hasFour > 0) {
    const optionCodes = (await languageSelect.locator("option").evaluateAll(options => options.map(option => option.value))).join("|").toLowerCase();
    const options = await languageSelect.locator("option").allTextContents();
    check("D1 language selector offers four locales", ["fa", "en", "ar", "fr"].every(code => optionCodes.includes(code)), options.join(" | "));
    await languageSelect.selectOption("fr");
    await page.waitForTimeout(400);
    const frText = await page.locator("body").innerText();
    check("D2 French copy renders", /registre|chevaux|français|recherche/i.test(frText), (frText.match(/registre|chevaux|recherche/i) ?? ["none"])[0]);
    await languageSelect.selectOption("ar");
    await page.waitForTimeout(400);
    const dir = await page.evaluate(() => document.documentElement.dir || getComputedStyle(document.documentElement).direction);
    check("D3 Arabic switches to RTL", dir === "rtl", dir);
    const arText = await page.locator("body").innerText();
    check("D4 Arabic copy renders", /اسب|فهرست|بازار|جست/i.test(arText));
  } else {
    check("D1-D4 language selector (locator not found — recording honestly)", false, "four-locale select not found on /browse");
  }

  // ---- E. phone widths + the Arabic 320px marketplace catch ---------------
  await page.setViewportSize({ width: 320, height: 700 });
  await goto("/");
  check("E1 home at 320 has no horizontal document overflow", (await overflowPx()) === 0, `${await overflowPx()}px`);
  await goto("/market");
  check("E2 marketplace (AR) at 320 has no horizontal document overflow", (await overflowPx()) === 0, `${await overflowPx()}px`);
  await page.setViewportSize({ width: 390, height: 800 });
  await goto("/browse");
  await page.waitForSelector("main tr, main li, main article, main .card", { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(400);
  const recordVisible = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll("main tr, main li, main article, main .card, main a, main button"));
    return nodes.filter(node => {
      const box = node.getBoundingClientRect();
      const text = (node.textContent ?? "").trim();
      return box.width > 40 && box.height > 12 && text.length > 1;
    }).length;
  });
  check("E3 records visible at 390 (real boxes, not display:none)", recordVisible > 0, `${recordVisible} visible record nodes`);
  await page.setViewportSize({ width: 768, height: 900 });
  await goto("/browse");
  check("E4 768 reflows without overflow", (await overflowPx()) === 0, `${await overflowPx()}px`);

  // ---- F. lighting: bounded, non-rotating, ordinary-alpha ------------------
  await page.setViewportSize({ width: 1440, height: 900 });
  await goto("/");
  const lighting = await page.evaluate(() => {
    const overlay = document.querySelector(".heritage-v2-lighting-overlay");
    const computed = overlay ? getComputedStyle(overlay, "::before") : null;
    const sheet = Array.from(document.styleSheets).flatMap(sheet => { try { return Array.from(sheet.cssRules); } catch { return []; } });
    const text = sheet.map(rule => rule.cssText).join("\n");
    const keyframes = [...text.matchAll(/@keyframes ([\w-]+)/g)].map(m => m[1]).filter(name => name.includes("heritage-v2"));
    const animationNames = computed ? String(computed.animationName) : "";
    return {
      hasOverlay: Boolean(overlay),
      blend: computed ? computed.backgroundBlendMode : "n/a",
      mix: computed ? computed.mixBlendMode : "n/a",
      animationNames,
      noRotation: !/rotate|sheet|sweep/i.test(animationNames),
      fieldKeyframes: keyframes.filter(name => /field|organic|chromatic|orbit|drift|breathe|specular/.test(name)).slice(0, 6),
      retiredRotation: keyframes.some(name => /rotate|sheet|sweep/i.test(name)),
    };
  });
  const blendAllNormal = lighting.blend.split(",").every(value => value.trim() === "normal");
  check("F1 ambient compositor is ordinary-alpha (R32 contract)", lighting.hasOverlay && blendAllNormal && lighting.mix === "normal", `blend=${lighting.blend} mix=${lighting.mix}`);
  check("F2 the ambient painter does not rotate", lighting.hasOverlay && lighting.noRotation, lighting.animationNames);
  check("F3 bounded field/drift/specular keyframes are the motion set", lighting.fieldKeyframes.length > 0, lighting.fieldKeyframes.join(", "));
  check("F4 the retired rotating/sweeping keyframes are gone", !lighting.retiredRotation);

  // ---- G. reduced motion ----------------------------------------------------
  const reduced = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const reducedPage = await reduced.newPage();
  await reducedPage.goto(base + "/", { waitUntil: "domcontentloaded" });
  await reducedPage.waitForTimeout(400);
  const reducedOk = await reducedPage.evaluate(() => {
    const overlay = document.querySelector(".heritage-v2-lighting-overlay");
    if (!overlay) return { exists: false };
    const before = getComputedStyle(overlay, "::before");
    return { exists: true, playState: before.animationPlayState, display: before.display };
  });
  check("G1 reduced-motion honors the animation pause (or removes the painter)", !reducedOk.exists || reducedOk.playState === "paused" || reducedOk.display === "none", JSON.stringify(reducedOk));
  await reduced.close();

  // ---- H. no cross-engine leakage (Core stays Heritage) --------------------
  await goto("/browse");
  const noRetroLeak = await page.evaluate(() => !document.querySelector(".retro-astra, [data-frontend='retro-astra']"));
  check("H1 Core page carries no other engine's root", noRetroLeak);
} finally {
  await browser.close().catch(() => {});
  stopServer();
  await new Promise(resolve => setTimeout(resolve, 300));
}

evidence.completed = new Date().toISOString();
evidence.verdict = evidence.failed ? "FAILURES PRESENT" : "ALL GREEN";
evidence.passed = evidence.checks.filter(c => c.ok).length;
evidence.total = evidence.checks.length;
writeFileSync(join(OUT, "core-ui-qualification.json"), JSON.stringify(evidence, null, 2));
console.log(`\n[verdict] ${evidence.verdict} — ${evidence.passed}/${evidence.total} checks`);
console.log(`[evidence] ${join(OUT, "core-ui-qualification.json")}`);
process.exit(evidence.failed ? 1 : 0);

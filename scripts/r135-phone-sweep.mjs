#!/usr/bin/env node
/** R135 phone sweep: verify the phone-economy round on the built dist with the
 *  live API route-forwarded (read-only). Checks overflow, the registry explorer
 *  (infinite scroll, head tools, no pager), competitions (collapsed filter drawer,
 *  photo column), the More panel (no keyboard hijack), hidden phone chrome, and
 *  the nested-frost collapse. */
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, extname } from "node:path";
const DIST = "/home/z/my-project/horse-registry/dist/client";
const OUT = "/home/z/my-project/horse-registry/review-r135/evidence";
mkdirSync(OUT, { recursive: true });
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".webp": "image/webp", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".woff2": "font/woff2", ".ico": "image/x-icon" };
const server = createServer((req, res) => {
  const path = req.url.split("?")[0];
  let file = join(DIST, path === "/" ? "index.html" : path);
  if (!existsSync(file)) file = join(DIST, "index.html");
  try { res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" }); res.end(readFileSync(file)); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(4196, "127.0.0.1", r));
const require = createRequire(import.meta.url);
const { chromium } = require("/home/z/.npm-global/lib/node_modules/playwright");
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const page = await context.newPage();
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
await page.route("**/api/**", async route => {
  const request = route.request();
  const headers = { ...request.headers(), host: "iraho.ir", origin: "https://iraho.ir", referer: "https://iraho.ir/" };
  try {
    const response = await fetch(`https://iraho.ir${request.url().replace(/^https?:\/\/[^/]+/, "")}`, { method: request.method(), headers });
    const body = Buffer.from(await response.arrayBuffer());
    const rh = {};
    response.headers.forEach((v, k) => { if (!/^content-encoding$|^transfer-encoding$|^content-length$|^set-cookie$/i.test(k)) rh[k] = v; });
    await route.fulfill({ status: response.status, headers: rh, body });
  } catch { await route.abort(); }
});
const results = [];
const overflow = async () => await page.evaluate(() => ({
  doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  offenders: [...document.querySelectorAll("body *")]
    .filter(el => el.getBoundingClientRect().right > document.documentElement.clientWidth + 1 && getComputedStyle(el).position !== "fixed")
    .slice(0, 3).map(el => `${el.tagName}.${String(el.className).slice(0, 40)}`),
}));
const check = (name, pass, detail) => { results.push({ name, pass, detail }); console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); };

// 1) Registry explorer
await page.goto("http://127.0.0.1:4196/browse", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3200);
let o = await overflow();
check("browse: no horizontal overflow", o.doc <= 0, `overflow=${o.doc} ${o.offenders.join(",")}`);
check("browse: head tools present", await page.locator(".browse-head-tools").count() > 0);
check("browse: sort picker present with importance default", await page.locator(".browse-sort-picker select").count() > 0 && await page.locator(".browse-sort-picker select").inputValue() === "importance");
check("browse: prev/next pager gone", await page.locator(".pager-buttons").count() === 0);
check("browse: load-more bar present", await page.locator(".registry-load-more").count() > 0);
check("browse: old view toggle not in main flow", await page.evaluate(() => !document.querySelector(".table-panel > .mobile-registry-view-toggle")));
const phoneCards1 = await page.locator(".mobile-registry-card").count();
await page.evaluate(() => { const list = document.querySelector(".mobile-registry-list"); if (list) list.scrollTop = list.scrollHeight; else window.scrollTo(0, document.body.scrollHeight); });
await page.waitForTimeout(2600);
const phoneCards2 = await page.locator(".mobile-registry-card").count();
check("browse: infinite scroll appends", phoneCards2 > phoneCards1, `${phoneCards1} -> ${phoneCards2}`);
check("browse: serial shown on cards", await page.evaluate(() => {
  const b = document.querySelector(".mobile-registry-card .mobile-card-id b");
  return b ? /^(#|\d|[A-Z])/i.test(b.textContent.trim()) : false;
}));
await page.screenshot({ path: join(OUT, "browse-phone.png"), fullPage: false });
// nested frost suppression evidence
const frost = await page.evaluate(() => {
  const nested = [...document.querySelectorAll('[data-h-frost-nested="1"]')];
  const stillBlurring = nested.filter(el => getComputedStyle(el).backdropFilter !== "none").length;
  const top = [...document.querySelectorAll('[data-h-material-role]')].filter(el => el.dataset.hFrostNested !== "1" && getComputedStyle(el).backdropFilter !== "none").length;
  return { nested: nested.length, stillBlurring, top };
});
check("frost: nested surfaces lose backdrop-filter", frost.nested > 0 && frost.stillBlurring === 0, JSON.stringify(frost));

// 2) Advanced rail: view toggle relocated
await page.evaluate(() => document.querySelector(".browse-head-tools .advanced-toggle")?.click());
await page.waitForTimeout(700);
check("browse: advanced rail opens", await page.locator(".advanced-registry-rail").count() > 0);
check("browse: view toggle lives in rail", await page.locator(".adv-rail-display .mobile-registry-view-toggle").count() > 0);
await page.screenshot({ path: join(OUT, "browse-rail.png") });
await page.keyboard.press("Escape");

// 3) Competitions
await page.goto("http://127.0.0.1:4196/competitions", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3200);
o = await overflow();
check("competitions: no horizontal overflow", o.doc <= 0, `overflow=${o.doc} ${o.offenders.join(",")}`);
check("competitions: filter drawer collapsed by default", await page.locator(".h-mod-filter-toggle").count() > 0 && await page.locator(".h-mod-filter-body").isHidden().catch(() => false));
check("competitions: legend phone-hidden", await page.locator(".h-mod-legend").isHidden().catch(() => false));
const overlap = await page.evaluate(() => {
  // Direction-neutral: grid children must never interpenetrate, whichever
  // side the reading direction starts from (the registry is RTL by default).
  let bad = 0;
  for (const card of document.querySelectorAll(".h-mod-event")) {
    const rects = [".h-mod-event-date", ".h-mod-event-photo", ".h-mod-event-body", ".h-mod-event-count"]
      .map(sel => card.querySelector(sel)?.getBoundingClientRect()).filter(Boolean);
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w > 2 && h > 2) { bad++; i = rects.length; break; }
    }
  }
  return bad;
});
check("competitions: event card columns do not overlap", overlap === 0, `badCards=${overlap}`);
await page.screenshot({ path: join(OUT, "competitions-phone.png") });

// 4) Newsroom bottom
await page.goto("http://127.0.0.1:4196/newsroom", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
o = await overflow();
check("newsroom: no horizontal overflow", o.doc <= 0, `overflow=${o.doc}`);
await page.evaluate(() => document.querySelector(".heritage-news-feed")?.scrollTo(0, 999999));
await page.waitForTimeout(600);
const feedBottom = await page.evaluate(() => {
  const feed = document.querySelector(".heritage-news-feed");
  if (!feed) return -1;
  const last = feed.querySelector(".heritage-news-card:last-child");
  if (!last) return -1;
  return feed.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom;
});
check("newsroom: last card clears the feed bottom", feedBottom >= 8, `gap=${Math.round(feedBottom)}px`);
await page.screenshot({ path: join(OUT, "newsroom-phone.png") });

// 5) Phone chrome economy (topbar)
const chrome = await page.evaluate(() => ({
  layoutToggle: getComputedStyle(document.querySelector(".h122-layout-toggle") ?? document.body).display,
  frontendPill: getComputedStyle(document.querySelector(".frontend-switcher") ?? document.body).display,
  langCode: getComputedStyle(document.querySelector(".h122-language-display b") ?? document.body).display,
}));
check("chrome: layout toggle hidden on phone", chrome.layoutToggle === "none", JSON.stringify(chrome));
check("chrome: frontend pill hidden on phone", chrome.frontendPill === "none");
check("chrome: language code hidden on phone", chrome.langCode === "none");

// 6) More panel: no keyboard hijack + compact
await page.goto("http://127.0.0.1:4196/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2600);
await page.evaluate(() => document.querySelector(".h112-sections-toggle")?.click());
await page.waitForTimeout(700);
const focusInfo = await page.evaluate(() => ({
  active: document.activeElement?.tagName ?? "none",
  isSearch: document.activeElement?.id?.includes("search") ?? false,
}));
check("more panel: keyboard not hijacked on touch", !focusInfo.isSearch, JSON.stringify(focusInfo));
check("more panel: change-interface entry present", await page.locator(".h112-frontend-entry").count() > 0);
await page.screenshot({ path: join(OUT, "more-panel-phone.png") });

// 7) Horse profile at phone width
await page.goto("http://127.0.0.1:4196/horse/401201", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3200);
o = await overflow();
check("profile: no horizontal overflow", o.doc <= 0, `overflow=${o.doc} ${o.offenders.join(",")}`);
await page.screenshot({ path: join(OUT, "profile-phone.png") });

// 8) Desktop spot check (browse + competitions unchanged layouts sane)
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto("http://127.0.0.1:4196/browse", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
o = await overflow();
check("desktop browse: no overflow", o.doc <= 0, `overflow=${o.doc}`);
check("desktop browse: advanced chip in head", await page.locator(".browse-head-tools .advanced-toggle").count() > 0);
check("desktop browse: load-more bar present", await page.locator(".registry-load-more").count() > 0);
await page.goto("http://127.0.0.1:4196/competitions", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
o = await overflow();
check("desktop competitions: no overflow", o.doc <= 0, `overflow=${o.doc}`);
check("desktop competitions: filter body always visible", await page.locator(".h-mod-filter-body").isVisible().catch(() => false));

const failed = results.filter(r => !r.pass);
writeFileSync(join(OUT, "r135-phone-sweep.json"), JSON.stringify({ when: new Date().toISOString(), results, errors }, null, 2));
console.log(`\n== ${results.length - failed.length}/${results.length} checks passed; pageerrors=${errors.length} ==`);
for (const e of errors.slice(0, 5)) console.log("PAGEERROR:", e.slice(0, 200));
await browser.close();
server.close();
process.exit(failed.length ? 1 : 0);

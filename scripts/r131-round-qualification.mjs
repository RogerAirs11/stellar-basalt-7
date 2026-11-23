#!/usr/bin/env node
/**
 * R131 — REAL browser qualification of the owner round:
 *   1. horse-profile section rail as a hierarchical TREE (children nested
 *      under pedigree/record, phone children strip, dock-active gating that
 *      can no longer leave a phone with zero section navigation);
 *   2. newsroom feed cards with breathing room (3:2 thumbs, 3-line clamps,
 *      phone top-cover cards) — nothing half-cropped or clipped;
 *   3. the professionals directory toolbar (labels no longer squeezed into a
 *      30px icon column, selects never clip);
 *   4. the matches page two-layer scroll (event list and results scroll
 *      independently on desktop; phone swaps to the results surface);
 *   5. zero horizontal overflow at 390px and 1440px on every touched route.
 *
 * Pattern: R122 core-ui qualification — local dist/client served statically,
 * /api/* forwarded to the LIVE site through Playwright routing (real data,
 * real latency), one browser context resized per width.
 */
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, extname } from "node:path";

const root = "/home/z/my-project/repos/horse-registry";
const DIST = join(root, "dist", "client");
const OUT = join(root, "review-r131", "evidence");
mkdirSync(OUT, { recursive: true });

const evidence = { started: new Date().toISOString(), checks: [], pageErrors: [] };
const check = (label, ok, detail) => {
  evidence.checks.push({ label, ok, detail: detail ?? null });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) evidence.failed = true;
};

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".webp": "image/webp", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".woff2": "font/woff2", ".ico": "image/x-icon" };
const server = createServer((req, res) => {
  const path = req.url.split("?")[0];
  let file = join(DIST, path === "/" ? "index.html" : path);
  if (!existsSync(file)) file = join(DIST, "index.html");
  try {
    const body = readFileSync(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404); res.end("missing");
  }
});
await new Promise(resolve => server.listen(4199, "127.0.0.1", resolve));

const require = createRequire(import.meta.url);
const { chromium } = require("/home/z/.npm-global/lib/node_modules/playwright");
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.on("pageerror", error => evidence.pageErrors.push(String(error)));

await page.route("**/api/**", async route => {
  const request = route.request();
  const headers = { ...request.headers(), host: "iraho.ir", origin: "https://iraho.ir", referer: "https://iraho.ir/" };
  try {
    const response = await fetch(`https://iraho.ir${request.url().replace(/^https?:\/\/[^/]+/, "")}`, {
      method: request.method(), headers,
      body: ["GET", "HEAD"].includes(request.method()) ? undefined : request.postDataBuffer(),
    });
    const body = Buffer.from(await response.arrayBuffer());
    const responseHeaders = {};
    response.headers.forEach((value, key) => { if (!/^content-encoding$|^transfer-encoding$|^content-length$|^set-cookie$/i.test(key)) responseHeaders[key] = value; });
    await route.fulfill({ status: response.status, headers: responseHeaders, body });
  } catch (cause) {
    await route.abort(String(cause));
  }
});

const overflow = () => page.evaluate(() => ({
  doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  offenders: [...document.querySelectorAll("body *")]
    .filter(el => el.getBoundingClientRect().right > document.documentElement.clientWidth + 1 && getComputedStyle(el).position !== "fixed")
    .slice(0, 4).map(el => `${el.tagName}.${String(el.className).slice(0, 44)}`),
}));
const textClipped = selector => page.evaluate(sel => [...document.querySelectorAll(sel)]
  .some(el => el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2), selector);

// ── Desktop 1440 ────────────────────────────────────────────────────────────
console.log("DESKTOP 1440x900");
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto("http://127.0.0.1:4199/horse/1", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".profile-workspace-nav", { timeout: 30000 });
await page.waitForTimeout(1200);

// 1. Tree structure: children nested inside the branch, connector present.
const tree = await page.evaluate(() => {
  const nav = document.querySelector(".profile-workspace-nav");
  const branch = nav?.querySelector('.profile-tree-branch[data-branch="pedigree"]');
  const record = nav?.querySelector('.profile-tree-branch[data-branch="record"]');
  return {
    nav: Boolean(nav),
    branch: Boolean(branch),
    pedigreeChildCount: branch?.querySelectorAll(".profile-tree-children button").length ?? 0,
    recordChildCount: record?.querySelectorAll(".profile-tree-children button").length ?? 0,
    sidebarMounted: Boolean(document.querySelector("#h102-context .profile-workspace-nav")),
    allFlat: nav ? [...nav.querySelectorAll(":scope > button")].length : 0,
  };
});
check("profile nav is the hierarchical tree", tree.nav && tree.branch && tree.pedigreeChildCount === 2 && tree.recordChildCount === 3, JSON.stringify(tree));

// 2. Activate pedigree → branch opens, children visible and nested.
await page.evaluate(() => {
  const nav = document.querySelector(".profile-workspace-nav");
  [...nav.querySelectorAll("button")].find(b => b.textContent.includes("تبارنامه"))?.click();
});
await page.waitForTimeout(700);
const opened = await page.evaluate(() => {
  const branch = document.querySelector('.profile-tree-branch[data-branch="pedigree"]');
  const children = branch?.querySelector(".profile-tree-children");
  const visible = children ? getComputedStyle(children).display !== "none" : false;
  const rect = children?.getBoundingClientRect();
  return { open: branch?.classList.contains("open"), visible, indented: rect ? rect.width < branch.getBoundingClientRect().width : false,
    paneSwitched: document.querySelector(".pedigree-section")?.className.includes("pane-visualizer") };
});
check("pedigree branch opens with nested view children", opened.open && opened.visible && opened.paneSwitched, JSON.stringify(opened));

// 3. Real click on the Intelligence child switches the pane.
await page.evaluate(() => document.querySelector('.profile-tree-children[data-hidden="false"] , .profile-tree-branch[data-branch="pedigree"] .profile-tree-children')?.scrollIntoView({ block: "center" }));
const childButton = page.locator('.profile-tree-branch[data-branch="pedigree"] .profile-tree-children button', { hasText: /هوشمندی|Intelligence/ });
if (await childButton.count()) {
  await childButton.first().click({ force: true });
  await page.waitForTimeout(600);
  const pane = await page.evaluate(() => document.querySelector(".pedigree-section")?.className.match(/pane-\w+/)?.[0]);
  check("child view click switches pedigree pane (real click)", pane === "pane-intelligence", String(pane));
} else check("child view click switches pedigree pane (real click)", false, "child button not found");

// 4. Newsroom desktop cards.
await page.goto("http://127.0.0.1:4199/newsroom", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".heritage-news-card", { timeout: 30000 });
await page.waitForTimeout(1500);
const news = await page.evaluate(() => {
  const card = document.querySelector(".heritage-news-card");
  const img = card?.querySelector("img, .heritage-news-thumb-fallback");
  const r = img?.getBoundingClientRect();
  return {
    thumbRatio: r ? Math.round((r.width / r.height) * 100) / 100 : 0,
    thumbW: Math.round(r?.width ?? 0),
    clamps: card ? [getComputedStyle(card.querySelector("strong")).webkitLineClamp, getComputedStyle(card.querySelector("p")).webkitLineClamp] : [],
    clipped: card ? card.querySelector("strong").scrollWidth > card.querySelector("strong").clientWidth + 2 : true,
    feedScrolls: (() => { const f = document.querySelector(".heritage-news-feed"); if (!f) return false; f.scrollTop = 120; const s = f.scrollTop > 0; f.scrollTop = 0; return s; })(),
  };
});
check("news desktop thumb is 3:2 at 132px", Math.abs(news.thumbRatio - 1.5) < 0.06 && news.thumbW >= 130, JSON.stringify(news));
check("news desktop title/summary clamp at 3 lines", news.clamps.join(",") === "3,3" && !news.clipped, JSON.stringify(news));
check("news feed still scrolls independently on desktop", news.feedScrolls);

// 5. Directory toolbar.
await page.goto("http://127.0.0.1:4199/directory", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".directory-toolbar", { timeout: 30000 });
await page.waitForTimeout(900);
const dir = await page.evaluate(() => {
  const field = document.querySelector(".directory-field");
  const span = field?.querySelector("span");
  const select = field?.querySelector("select");
  const sr = span?.getBoundingClientRect(); const cr = field?.getBoundingClientRect();
  return {
    fields: document.querySelectorAll(".directory-field").length,
    labelAbove: sr && cr ? sr.bottom <= cr.top + 26 : false,
    labelWide: sr ? sr.width > 60 : false,
    selectClipped: select ? select.scrollWidth > select.clientWidth + 2 : true,
    oldFilterMisuse: Boolean(document.querySelector(".directory-toolbar .table-filter")),
  };
});
check("directory toolbar uses labeled fields (no 30px squeeze)", dir.fields === 3 && dir.labelAbove && dir.labelWide && !dir.selectClipped && !dir.oldFilterMisuse, JSON.stringify(dir));
const dirOverflow = await overflow();
check("directory desktop zero horizontal overflow", dirOverflow.doc <= 0, JSON.stringify(dirOverflow));

// 6. Competitions two-layer independent scroll.
await page.goto("http://127.0.0.1:4199/competitions", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".h-mod-events .h-mod-event", { timeout: 30000 });
await page.waitForTimeout(1200);
const compIndependent = await page.evaluate(() => {
  const list = document.querySelector(".h-mod-events");
  const page_ = document.querySelector(".h-mod-competitions-page");
  if (!list) return { listScrolls: false };
  const before = scrollY;
  list.scrollTop = 160;
  const listScrolled = list.scrollTop > 0;
  const pageDidNotScroll = Math.abs(scrollY - before) < 2;
  list.scrollTop = 0;
  return { listScrolls: listScrolled && pageDidNotScroll, pageOverflowHidden: getComputedStyle(page_).overflow };
});
check("matches: event list scrolls independently (desktop)", compIndependent.listScrolls === true, JSON.stringify(compIndependent));
await page.locator(".h-mod-event").first().click();
await page.waitForTimeout(1400);
const compDetail = await page.evaluate(() => {
  const detail = document.querySelector(".h-mod-event-detail");
  if (!detail) return { detail: false };
  const overflowAuto = getComputedStyle(detail).overflowY === "auto";
  const bounded = detail.getBoundingClientRect().height <= detail.parentElement.getBoundingClientRect().height + 2;
  detail.scrollTop = detail.scrollHeight; // clamp-scroll to the bottom
  const detailScrolls = detail.scrollTop > 0 || detail.scrollHeight <= detail.clientHeight + 2;
  detail.scrollTop = 0;
  const list = document.querySelector(".h-mod-events");
  return { detail: true, overflowAuto, bounded, detailScrolls, listStillThere: Boolean(list) };
});
check("matches: results panel scrolls independently", compDetail.detail && compDetail.overflowAuto && compDetail.bounded && compDetail.detailScrolls, JSON.stringify(compDetail));

// ── Phone 390 ───────────────────────────────────────────────────────────────
console.log("PHONE 390x844");
await page.setViewportSize({ width: 390, height: 844 });
await page.goto("http://127.0.0.1:4199/horse/1", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".profile-workspace-nav", { timeout: 30000, state: "attached" });
await page.waitForTimeout(1200);
// With the default phone hierarchy the dock replaces the in-flow rail — the
// rail being display:none is CORRECT there. Verify the gate both ways, then
// lift the gate to exercise the in-flow tree.
const dockGate = await page.evaluate(() => {
  const root = document.documentElement;
  const dockWasActive = root.dataset.dockActive === "1";
  const dockPresent = Boolean(document.querySelector(".heritage-global-app-dock"));
  root.dataset.dockActive = "1";
  const hiddenWithDock = getComputedStyle(document.querySelector(".profile-workspace-nav")).display === "none";
  delete root.dataset.dockActive;
  const shownWithoutDock = getComputedStyle(document.querySelector(".profile-workspace-nav")).display !== "none";
  return { dockWasActive, dockPresent, hiddenWithDock, shownWithoutDock };
});
check("dock-active gate hides rail only while dock is mounted", dockGate.hiddenWithDock && dockGate.shownWithoutDock, JSON.stringify(dockGate));
check("phone dock actually replaces the rail when docked", dockGate.dockWasActive === dockGate.dockPresent, JSON.stringify(dockGate));
const phoneNav = await page.evaluate(() => {
  const nav = document.querySelector(".profile-workspace-nav");
  const r = nav?.getBoundingClientRect();
  return { exists: Boolean(nav), w: Math.round(r?.width ?? 0), h: Math.round(r?.height ?? 0),
    pos: nav ? getComputedStyle(nav).position : null, visible: r ? r.width > 100 && r.height > 60 : false };
});
check("phone profile nav visible when the dock is not mounted", phoneNav.visible, JSON.stringify(phoneNav));
await page.evaluate(() => {
  const nav = document.querySelector(".profile-workspace-nav");
  [...nav.querySelectorAll("button")].find(b => b.textContent.includes("رکورد") || b.textContent.toLowerCase().includes("record"))?.click();
});
await page.waitForTimeout(600);
const phoneChildren = await page.evaluate(() => {
  const children = document.querySelector('.profile-tree-branch[data-branch="record"] .profile-tree-children');
  if (!children) return { found: false };
  const r = children.getBoundingClientRect();
  return { found: true, display: getComputedStyle(children).display, visible: r.height > 20, inBar: r.width < 400 };
});
check("phone record branch shows children strip", phoneChildren.found && phoneChildren.visible, JSON.stringify(phoneChildren));
const phoneOverflowProfile = await overflow();
check("profile phone zero horizontal overflow", phoneOverflowProfile.doc <= 0, JSON.stringify(phoneOverflowProfile));

await page.goto("http://127.0.0.1:4199/newsroom", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".heritage-news-card", { timeout: 30000 });
await page.waitForTimeout(1500);
const phoneNews = await page.evaluate(() => {
  const card = document.querySelector(".heritage-news-card");
  const img = card?.querySelector("img, .heritage-news-thumb-fallback");
  const cr = card?.getBoundingClientRect(); const ir = img?.getBoundingClientRect();
  return { topCover: ir && cr ? Math.abs(ir.width - cr.width) < 8 : false,
    ratio: ir ? Math.round((ir.width / ir.height) * 100) / 100 : 0,
    textInside: cr && ir ? ir.top <= cr.top + 2 : false };
});
check("news phone cards use full-width 16:9 top cover", phoneNews.topCover && Math.abs(phoneNews.ratio - 1.78) < 0.1, JSON.stringify(phoneNews));
const phoneOverflowNews = await overflow();
check("newsroom phone zero horizontal overflow", phoneOverflowNews.doc <= 0, JSON.stringify(phoneOverflowNews));

await page.goto("http://127.0.0.1:4199/directory", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".directory-toolbar", { timeout: 30000 });
await page.waitForTimeout(900);
const phoneDir = await page.evaluate(() => {
  const fields = [...document.querySelectorAll(".directory-field")];
  const full = fields.every(f => { const r = f.getBoundingClientRect(); return r.width > 330; });
  const select = fields[0]?.querySelector("select");
  return { stacked: full, clipped: select ? select.scrollWidth > select.clientWidth + 2 : true };
});
check("directory phone fields stack full-width, unclipped", phoneDir.stacked && !phoneDir.clipped, JSON.stringify(phoneDir));

await page.goto("http://127.0.0.1:4199/competitions", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".h-mod-events .h-mod-event", { timeout: 30000 });
await page.waitForTimeout(1000);
await page.locator(".h-mod-event").first().click();
await page.waitForTimeout(900);
const phoneSwap = await page.evaluate(() => ({
  listHidden: (() => { const l = document.querySelector(".h-mod-events"); return l ? getComputedStyle(l).display === "none" : true; })(),
  detailVisible: (() => { const d = document.querySelector(".h-mod-event-detail"); return d ? d.getBoundingClientRect().height > 100 : false; })(),
}));
check("matches phone: tapping event swaps to results surface", phoneSwap.listHidden && phoneSwap.detailVisible, JSON.stringify(phoneSwap));
await page.locator(".h-mod-close").click();
await page.waitForTimeout(500);
const phoneBack = await page.evaluate(() => {
  const l = document.querySelector(".h-mod-events");
  return l ? getComputedStyle(l).display !== "none" : false;
});
check("matches phone: close returns to the calendar", phoneBack);
const phoneOverflowComp = await overflow();
check("competitions phone zero horizontal overflow", phoneOverflowComp.doc <= 0, JSON.stringify(phoneOverflowComp));

await page.screenshot({ path: join(OUT, "phone-competitions.png"), fullPage: false });
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto("http://127.0.0.1:4199/newsroom", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1600);
await page.screenshot({ path: join(OUT, "desktop-newsroom.png") });
await page.goto("http://127.0.0.1:4199/horse/1", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1400);
await page.screenshot({ path: join(OUT, "desktop-profile.png") });

check("no page errors across the sweep", evidence.pageErrors.length === 0, evidence.pageErrors.slice(0, 3).join(" | "));

evidence.finished = new Date().toISOString();
evidence.verdict = evidence.failed ? "FAIL" : "ALL GREEN";
writeFileSync(join(OUT, "qualification.json"), JSON.stringify(evidence, null, 2));
console.log(`\nVERDICT: ${evidence.verdict} (${evidence.checks.filter(c => c.ok).length}/${evidence.checks.length} checks)`);
await browser.close();
server.close();
process.exit(evidence.failed ? 1 : 0);

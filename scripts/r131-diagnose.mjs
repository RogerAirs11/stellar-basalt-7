#!/usr/bin/env node
/** One-shot local diagnosis of the phone nav hidden state + competitions scroll. */
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";

const DIST = "/home/z/my-project/repos/horse-registry/dist/client";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".webp": "image/webp", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".woff2": "font/woff2", ".ico": "image/x-icon" };
const server = createServer((req, res) => {
  const path = req.url.split("?")[0];
  let file = join(DIST, path === "/" ? "index.html" : path);
  if (!existsSync(file)) file = join(DIST, "index.html");
  try { const body = readFileSync(file); res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end("missing"); }
});
await new Promise(r => server.listen(4198, "127.0.0.1", r));

const require = createRequire(import.meta.url);
const { chromium } = require("/home/z/.npm-global/lib/node_modules/playwright");
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
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

await page.goto("http://127.0.0.1:4198/horse/1", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".profile-workspace-nav", { state: "attached", timeout: 30000 });
await page.waitForTimeout(1500);

const phone = await page.evaluate(() => {
  const el = document.querySelector(".profile-workspace-nav");
  const found = [];
  for (let s = 0; s < document.styleSheets.length; s++) {
    const sheet = document.styleSheets[s];
    let rules; try { rules = sheet.cssRules; } catch { continue; }
    (function walk(list, parentCond) {
      for (let i = 0; i < list.length; i++) {
        const r = list[i];
        const cond = parentCond;
        if (r.cssRules && r.conditionText !== undefined) { walk(r.cssRules, r.conditionText); continue; }
        if (!r.selectorText || !r.style) continue;
        let m = null; try { m = r.style.getPropertyValue("display"); } catch {}
        if (m === "none" && el.matches(r.selectorText)) found.push({ sel: r.selectorText.slice(0, 200), media: cond, file: (sheet.href || "inline").split("/").pop() });
      }
    })(rules, "");
  }
  return {
    attrs: { dock: document.documentElement.dataset.dockActive, tab: document.documentElement.dataset.tabHierarchy, nav: document.documentElement.dataset.navigationLayout, both: document.documentElement.dataset.navBoth },
    display: getComputedStyle(el).display, position: getComputedStyle(el).position,
    dockInDom: Boolean(document.querySelector(".heritage-global-app-dock")),
    found,
  };
});
console.log("PHONE NAV DIAG:", JSON.stringify(phone, null, 1));

// competitions scroll diagnosis at 1440
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto("http://127.0.0.1:4198/competitions", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".h-mod-events .h-mod-event", { timeout: 30000 });
await page.waitForTimeout(1500);
const comp = await page.evaluate(() => {
  const list = document.querySelector(".h-mod-events");
  const split = document.querySelector(".h-mod-comp-split, .h-mod-comp-list");
  const panel = document.querySelector(".h-mod-competitions-page > .h-mod-panel");
  const pageEl = document.querySelector(".h-mod-competitions-page");
  const cs = el => el ? { h: Math.round(el.getBoundingClientRect().height), sh: el.scrollHeight, oy: getComputedStyle(el).overflowY, mh: getComputedStyle(el).minHeight, disp: getComputedStyle(el).display, flex: getComputedStyle(el).flex, ai: getComputedStyle(el).alignItems } : null;
  return { list: cs(list), split: cs(split), panel: cs(panel), page: cs(pageEl) };
});
console.log("COMPETITIONS DIAG:", JSON.stringify(comp, null, 1));
await browser.close();
server.close();
process.exit(0);

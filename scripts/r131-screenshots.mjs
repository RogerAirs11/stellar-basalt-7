#!/usr/bin/env node
/** R131 evidence screenshots with settled waits. */
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, extname } from "node:path";

const DIST = "/home/z/my-project/repos/horse-registry/dist/client";
const OUT = "/home/z/my-project/repos/horse-registry/review-r131/evidence";
mkdirSync(OUT, { recursive: true });
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".webp": "image/webp", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".woff2": "font/woff2", ".ico": "image/x-icon" };
const server = createServer((req, res) => {
  const path = req.url.split("?")[0];
  let file = join(DIST, path === "/" ? "index.html" : path);
  if (!existsSync(file)) file = join(DIST, "index.html");
  try { const body = readFileSync(file); res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end("missing"); }
});
await new Promise(r => server.listen(4197, "127.0.0.1", r));

const require = createRequire(import.meta.url);
const { chromium } = require("/home/z/.npm-global/lib/node_modules/playwright");
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
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

// Desktop newsroom with settled cards
await page.goto("http://127.0.0.1:4197/newsroom", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".heritage-news-card img", { timeout: 40000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: join(OUT, "desktop-newsroom.png") });

// Desktop profile with pedigree branch open (tree)
await page.goto("http://127.0.0.1:4197/horse/1", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".profile-workspace-nav", { timeout: 40000 });
await page.waitForTimeout(1800);
await page.evaluate(() => {
  const nav = document.querySelector(".profile-workspace-nav");
  [...nav.querySelectorAll("button")].find(b => b.textContent.includes("تبارنامه"))?.click();
});
await page.waitForTimeout(1500);
await page.screenshot({ path: join(OUT, "desktop-profile-tree.png") });

// Desktop directory
await page.goto("http://127.0.0.1:4197/directory", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".directory-toolbar select", { timeout: 40000 });
await page.waitForTimeout(1800);
await page.screenshot({ path: join(OUT, "desktop-directory.png") });

// Desktop competitions with detail open
await page.goto("http://127.0.0.1:4197/competitions", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".h-mod-events .h-mod-event", { timeout: 40000 });
await page.waitForTimeout(1500);
await page.locator(".h-mod-event").first().click();
await page.waitForTimeout(1800);
await page.screenshot({ path: join(OUT, "desktop-competitions.png") });

// Phone: newsroom cards + profile nav (contextual via attribute lift) + competitions detail
await page.setViewportSize({ width: 390, height: 844 });
await page.goto("http://127.0.0.1:4197/newsroom", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".heritage-news-card img", { timeout: 40000 });
await page.waitForTimeout(2200);
await page.screenshot({ path: join(OUT, "phone-newsroom.png") });

await page.goto("http://127.0.0.1:4197/horse/1", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".profile-workspace-nav", { state: "attached", timeout: 40000 });
await page.waitForTimeout(1600);
await page.evaluate(() => { delete document.documentElement.dataset.dockActive; });
await page.waitForTimeout(400);
await page.evaluate(() => {
  const nav = document.querySelector(".profile-workspace-nav");
  [...nav.querySelectorAll("button")].find(b => b.textContent.includes("رکورد"))?.click();
});
await page.waitForTimeout(700);
await page.screenshot({ path: join(OUT, "phone-profile-tree.png") });

await page.goto("http://127.0.0.1:4197/directory", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".directory-toolbar select", { timeout: 40000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: join(OUT, "phone-directory.png") });

await browser.close();
server.close();
console.log("screenshots done");
process.exit(0);

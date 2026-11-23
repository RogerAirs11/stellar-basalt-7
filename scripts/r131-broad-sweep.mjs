#!/usr/bin/env node
/** R131 broad sweep: zero overflow + no page errors on every major route, both widths. */
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, extname } from "node:path";
const DIST = "/home/z/my-project/repos/horse-registry/dist/client";
const OUT = "/home/z/my-project/repos/horse-registry/review-r131/evidence";
mkdirSync(OUT, { recursive: true });
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".webp": "image/webp", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".woff2": "font/woff2", ".ico": "image/x-icon" };
const server = createServer((req, res) => {
  const path = req.url.split("?")[0];
  let file = join(DIST, path === "/" ? "index.html" : path);
  if (!existsSync(file)) file = join(DIST, "index.html");
  try { res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" }); res.end(readFileSync(file)); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(4195, "127.0.0.1", r));
const require = createRequire(import.meta.url);
const { chromium } = require("/home/z/.npm-global/lib/node_modules/playwright");
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
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
const routes = ["/", "/browse", "/stats", "/newsroom", "/competitions", "/directory", "/horse/1", "/person/1", "/marketplace", "/services"];
const results = [];
for (const width of [1440, 390]) {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  for (const route of routes) {
    await page.goto(`http://127.0.0.1:4195${route}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2600);
    const o = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      offenders: [...document.querySelectorAll("body *")]
        .filter(el => el.getBoundingClientRect().right > document.documentElement.clientWidth + 1 && getComputedStyle(el).position !== "fixed")
        .slice(0, 3).map(el => `${el.tagName}.${String(el.className).slice(0, 40)}`),
    }));
    results.push({ width, route, ...o, ok: o.doc <= 0 });
    console.log(`${width}px ${route}: overflow=${o.doc} ${o.ok ? "OK" : "OFFENDERS " + o.offenders.join(",")}`);
  }
}
writeFileSync(join(OUT, "broad-sweep.json"), JSON.stringify({ results, errors }, null, 2));
console.log("PAGE ERRORS:", errors.length, errors.slice(0, 3));
await browser.close(); server.close();
process.exit(results.every(r => r.ok) && errors.length === 0 ? 0 : 1);

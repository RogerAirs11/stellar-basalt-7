#!/usr/bin/env node
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
const DIST = "/home/z/my-project/repos/horse-registry/dist/client";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
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
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
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
await page.goto("http://127.0.0.1:4196/newsroom", { waitUntil: "domcontentloaded" });
// BISECT: flip suspect properties one at a time and measure card height.
await page.waitForSelector(".heritage-news-card", { timeout: 40000 });
await page.waitForTimeout(1500);
const bisect = await page.evaluate(() => {
  const results = {};
  const style = document.createElement("style");
  document.head.appendChild(style);
  const measure = label => {
    const card = document.querySelector(".heritage-news-card");
    results[label] = Math.round(card.getBoundingClientRect().height);
  };
  measure("baseline");
  style.textContent = ".heritage-news-card strong,.heritage-news-card p{-webkit-line-clamp:unset!important;display:block!important}";
  measure("no-clamp");
  style.textContent = ".heritage-news-card img,.heritage-news-card .heritage-news-thumb-fallback{grid-row:1/6!important}";
  measure("thumb-span");
  style.textContent = ".heritage-news-card .heritage-news-card-body{display:contents!important}";
  measure("body-contents");
  style.textContent = ".heritage-news-feed{grid-auto-rows:min-content!important}";
  measure("feed-min-content");
  style.textContent = ".heritage-news-card{display:flex!important}.heritage-news-card img,.heritage-news-card .heritage-news-thumb-fallback{flex:0 0 132px!important}.heritage-news-card .heritage-news-card-body{flex:1!important}";
  measure("card-flex");
  style.textContent = "";
  measure("restored");
  return results;
});
console.log("BISECT:", JSON.stringify(bisect));
await page.waitForSelector(".heritage-news-card img", { timeout: 40000 });
await page.waitForTimeout(2000);
const diag = await page.evaluate(() => {
  const card = document.querySelector(".heritage-news-card");
  const strong = card.querySelector("strong");
  const p = card.querySelector("p");
  const ss = getComputedStyle(strong); const ps = getComputedStyle(p); const cs = getComputedStyle(card);
  const sr = strong.getBoundingClientRect(); const pr = p.getBoundingClientRect(); const cr = card.getBoundingClientRect();
  return {
    cardH: Math.round(cr.height), strongH: Math.round(sr.height), pH: Math.round(pr.height),
    strongColor: ss.color, pColor: ps.color, strongOpacity: ss.opacity, strongDisplay: ss.display,
    cardColor: cs.color, cardBg: cs.backgroundImage.slice(0, 60), cardBgColor: cs.backgroundColor,
    strongText: strong.textContent.slice(0, 30),
    strongRectTop: Math.round(sr.top - cr.top), pRectTop: Math.round(pr.top - cr.top),
    gridCols: cs.gridTemplateColumns,
    lineClamp: ss.webkitLineClamp, boxOrient: ss.webkitBoxOrient,
    vis: ss.visibility, fontSize: ss.fontSize,
    thumbH: Math.round(card.querySelector("img, .heritage-news-thumb-fallback").getBoundingClientRect().height),
    thumbAlignSelf: getComputedStyle(card.querySelector("img, .heritage-news-thumb-fallback")).alignSelf,
    thumbAspect: getComputedStyle(card.querySelector("img, .heritage-news-thumb-fallback")).aspectRatio,
    thumbRow: getComputedStyle(card.querySelector("img, .heritage-news-thumb-fallback")).gridRow,
    cardRows: cs.gridTemplateRows,
    feedH: Math.round(document.querySelector(".heritage-news-feed").getBoundingClientRect().height),
    feedRows: getComputedStyle(document.querySelector(".heritage-news-feed")).gridAutoRows,
    shellH: Math.round(document.querySelector(".heritage-newsroom").getBoundingClientRect().height),
    feedTemplateRows: getComputedStyle(document.querySelector('.heritage-news-feed')).gridTemplateRows.split(' ').slice(0,6),
    feedAutoRows: getComputedStyle(document.querySelector('.heritage-news-feed')).gridAutoRows,
    feedAlignContent: getComputedStyle(document.querySelector('.heritage-news-feed')).alignContent,
    cardAlignSelf: getComputedStyle(card).alignSelf,
    cardMaxH: getComputedStyle(card).maxHeight,
    cardMinH: getComputedStyle(card).minHeight,
    feedH2: Math.round(document.querySelector('.heritage-news-feed').getBoundingClientRect().height),
    feedScrollH: document.querySelector('.heritage-news-feed').scrollHeight,
    cardHeightCss: cs.height,
    cardDisplay: cs.display,
    cardBox: cs.boxSizing,
    cardPad: cs.paddingTop + '/' + cs.paddingBottom,
    cardScrollH: card.scrollHeight,
    cardAspect: cs.aspectRatio,
    heightRules: (() => {
      const out = [];
      for (let s = 0; s < document.styleSheets.length; s++) {
        const sheet = document.styleSheets[s];
        let rules; try { rules = sheet.cssRules; } catch { continue; }
        (function walk(list) {
          for (let i = 0; i < list.length; i++) {
            const r = list[i];
            if (r.cssRules && r.conditionText !== undefined) { walk(r.cssRules); continue; }
            if (!r.selectorText || !r.style) continue;
            try {
              if (card.matches(r.selectorText) && (r.style.getPropertyValue('height') || r.style.getPropertyValue('max-height') || r.style.getPropertyValue('min-height') || r.style.getPropertyValue('aspect-ratio'))) {
                out.push({ sel: r.selectorText.slice(0, 150), h: r.style.getPropertyValue('height'), mh: r.style.getPropertyValue('max-height'), minh: r.style.getPropertyValue('min-height'), ar: r.style.getPropertyValue('aspect-ratio'), file: (sheet.href || 'inline').split('/').pop() });
              }
            } catch {}
          }
        })(rules);
      }
      return out;
    })(),
  };
});
console.log(JSON.stringify(diag, null, 1));
await browser.close(); server.close(); process.exit(0);

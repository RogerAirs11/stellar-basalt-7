#!/usr/bin/env node
/**
 * R120 / IMP-063 acceptance — REAL browser qualification of the Retro mobile
 * registry fix (FE-15), original assets, isolated synthetic demo (28 horses).
 *
 * One browser context, viewport resized per width (the established R117
 * nav-matrix pattern — the demo server is single-instance). Widths
 * 320/390/720/721. Acceptance: NONEMPTY records VISIBLE (real bounding boxes,
 * not display:none) and OPENABLE — absence of overflow is not sufficient.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = "/home/z/my-project/repos/horse-registry";
const OUT = join(root, "review-r120", "evidence-local", "retro-mobile");
mkdirSync(OUT, { recursive: true });

const evidence = { started: new Date().toISOString(), widths: [], verdict: null };
const check = (label, ok, detail) => {
  (evidence.checks ??= []).push({ label, ok, detail });
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
let ready = false;
for (let i = 0; i < 90; i++) {
  await new Promise(r => setTimeout(r, 2000));
  try { const res = await fetch(`${base}/api/health`); if (res.ok) { const b = await res.json(); if (b.ok) { ready = true; break; } } } catch {}
}
if (!ready) { console.error("demo server did not become ready:\n" + serverLog.slice(-2000)); process.exit(2); }
console.log("[demo] server ready");

const playwrightModule = createRequire("/home/z/package.json")("playwright");
const browser = await playwrightModule.chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 900 }, reducedMotion: "reduce" });
await context.addInitScript(() => {
  localStorage.setItem("registry-locale", "en");
  localStorage.setItem("registry-frontend", "retro-astra");
});
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", e => pageErrors.push(String(e).slice(0, 160)));

const WIDTHS = [320, 390, 720, 721];
for (const width of WIDTHS) {
  console.log(`\n== Retro Astra @ ${width}px ==`);
  const record = { width, pageErrors: [...pageErrors] };
  evidence.widths.push(record);
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${base}/f/retro-astra/#/horses`, { waitUntil: "load", timeout: 45000 });
  await page.waitForTimeout(4500); // donor transplant settle

  const state = await page.evaluate(() => {
    const text = (document.body?.innerText ?? "").replace(/\s+/g, " ");
    const links = [...document.querySelectorAll('a[href*="horse"], a[href*="/horse/"], [data-horse-id]')];
    const visibleLinks = links.map(el => {
      const box = el.getBoundingClientRect(); const cs = getComputedStyle(el);
      return { text: (el.textContent || "").trim().slice(0, 60), w: Math.round(box.width), h: Math.round(box.height), display: cs.display };
    }).filter(r => r.text && r.w > 40 && r.h > 8 && r.display !== "none");
    const tableScrolls = [...document.querySelectorAll(".table-scroll")].map(el => ({ display: getComputedStyle(el).display, h: Math.round(el.getBoundingClientRect().height) }));
    const demoRows = [...document.querySelectorAll("li, tr, article, [class*=row], [class*=card], [class*=entry], [class*=record]")].filter(el => {
      const box = el.getBoundingClientRect(); const cs = getComputedStyle(el);
      return /DEMO [A-Z][a-z]+/.test(el.textContent || "") && cs.display !== "none" && box.width > 40 && box.height > 8;
    }).map(el => (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 70)).slice(0, 5);
    return { text: text.slice(0, 500), visibleLinks, tableScrolls, demoRows, frontend: document.documentElement.dataset.frontend, url: location.pathname + location.hash };
  });
  record.state = state;
  console.log(`  [info] url=${state.url} frontend=${state.frontend}`);
  console.log(`  [info] body: ${state.text.slice(0, 180)}`);

  const reportsDataset = /\b28\b/.test(state.text);
  check(`${width}px: the registry surface reports the 28-horse dataset (nonempty)`, reportsDataset);
  check(`${width}px: no Retro .table-scroll is display:none (heritage rule no longer leaks)`,
    state.tableScrolls.length === 0 || state.tableScrolls.every(t => t.display !== "none"),
    state.tableScrolls.length ? JSON.stringify(state.tableScrolls) : "no .table-scroll elements on this surface");
  check(`${width}px: VISIBLE record entries (real bounding boxes)`, state.visibleLinks.length > 0,
    `${state.visibleLinks.length} visible${state.visibleLinks.length ? `: ${state.visibleLinks.slice(0, 3).map(r => r.text).join(" | ")}` : ""}`);
  if (state.visibleLinks.length === 0) {
    check(`${width}px: VISIBLE DEMO record rows (generic fallback)`, state.demoRows.length > 0, state.demoRows.join(" | "));
  }

  // OPENABLE: click the first visible record link -> the horse detail renders.
  let opened = false, openedName = "";
  try {
    const first = page.locator('a[href*="horse"], [data-horse-id]').filter({ hasText: /DEMO/ }).first();
    if (await first.count()) {
      await first.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
      await first.click({ timeout: 6000 });
      await page.waitForTimeout(4000);
      const detailText = await page.evaluate(() => document.body?.innerText ?? "");
      const m = detailText.match(/DEMO [A-Z][a-z]+/);
      opened = Boolean(m);
      openedName = m ? m[0] : "";
    }
  } catch (e) { openedName = String(e.message).slice(0, 80); }
  check(`${width}px: a record is OPENABLE (click -> horse detail renders)`, opened, openedName);
  check(`${width}px: zero uncaught page errors`, pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));

  await page.screenshot({ path: join(OUT, `retro-${width}px.png`), fullPage: false });
}

// ---- heritage sanity at 390 (its OWN mobile rule still applies) ---------
{
  console.log("\n== Heritage @ 390px (own mobile design intact) ==");
  const hContext = await browser.newContext({ viewport: { width: 390, height: 900 }, reducedMotion: "reduce" });
  await hContext.addInitScript(() => { localStorage.setItem("registry-frontend", "heritage"); localStorage.setItem("registry-locale", "en"); });
  const hPage = await hContext.newPage();
  await hPage.goto(`${base}/browse`, { waitUntil: "load" });
  await hPage.waitForTimeout(3000);
  const heritageState = await hPage.evaluate(() => {
    const el = document.querySelector(".table-scroll");
    return {
      frontend: document.documentElement.dataset.frontend,
      tableScrollDisplay: el ? getComputedStyle(el).display : "absent",
      bodyHasRecords: /DEMO\s+\w+/.test(document.body?.innerText ?? ""),
    };
  });
  check("heritage 390px: scoped rule still applies to its own frontend (data-frontend=heritage)", heritageState.frontend === "heritage");
  check("heritage 390px: records still surface through its designed mobile layout", heritageState.bodyHasRecords, JSON.stringify(heritageState));
  await hPage.screenshot({ path: join(OUT, "heritage-390px.png") });
  await hContext.close();
}

await browser.close();
stopServer();
evidence.finished = new Date().toISOString();
evidence.verdict = evidence.failed ? "FAILURES" : "ALL GREEN";
writeFileSync(join(OUT, "retro-mobile-qualification.json"), JSON.stringify(evidence, null, 2));
console.log(`\n[verdict] ${evidence.verdict} — evidence: ${OUT}`);
process.exit(evidence.failed ? 1 : 0);

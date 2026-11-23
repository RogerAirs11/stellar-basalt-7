/** Actual browser URL state; no fabricated HTTP outcomes. */
import fs from "node:fs/promises";
import path from "node:path";
const base = process.env.UI_BASE_URL || "http://127.0.0.1:3000";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(base).hostname)) throw new Error("Local demo only.");
const { chromium } = await import(process.env.UI_PLAYWRIGHT_MODULE || "playwright");
const out = path.resolve(process.env.UI_EVIDENCE_DIR || "review-r113/evidence/core-url-initial");
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
await context.addInitScript(() => { localStorage.setItem("registry-frontend", "heritage"); localStorage.setItem("registry-locale", "en"); });
const page = await context.newPage();
const report = { browser: browser.version(), checks: [], requests: [], pageErrors: [] };
const check = (name, okay, extra = {}) => { report.checks.push({ name, okay, ...extra }); console.log(`${okay ? "PASS" : "FAIL"} ${name} ${JSON.stringify(extra)}`); };
page.on("pageerror", error => report.pageErrors.push(error.message));
page.on("request", request => { if (request.url().includes("/api/registry")) report.requests.push(request.url()); });
const suffix = "?q=DEMO&mode=registry&offset=50&sort=id&dir=asc";
try {
  await page.goto(base + "/browse" + suffix, { waitUntil: "networkidle" });
  check("copied URL keeps offset after mount/debounce", new URL(page.url()).searchParams.get("offset") === "50", { url: page.url() });
  await page.reload({ waitUntil: "networkidle" });
  check("refresh keeps query and offset", new URL(page.url()).searchParams.get("offset") === "50" && new URL(page.url()).searchParams.get("q") === "DEMO", { url: page.url() });
  await page.evaluate(() => { history.pushState({}, "", "/browse?q=DEMO&mode=registry&offset=100&sort=id&dir=asc"); dispatchEvent(new PopStateEvent("popstate")); });
  await page.waitForTimeout(350);
  check("popstate keeps restored offset", new URL(page.url()).searchParams.get("offset") === "100", { url: page.url() });
  await page.evaluate(() => history.back()); await page.waitForTimeout(350);
  check("back restores prior page", new URL(page.url()).searchParams.get("offset") === "50", { url: page.url() });
  await page.evaluate(() => history.forward()); await page.waitForTimeout(350);
  check("forward restores later page", new URL(page.url()).searchParams.get("offset") === "100", { url: page.url() });
  const filter = page.locator('.table-filter input').first();
  if (await filter.count()) {
    await filter.fill("DEMO Owner"); await page.waitForTimeout(350);
    check("user edit resets page and applies new query", !new URL(page.url()).searchParams.has("offset") && new URL(page.url()).searchParams.get("q") === "DEMO Owner", { url: page.url() });
  } else check("browse filter located for real edit", false);
} finally {
  await browser.close(); report.summary = { passed: report.checks.filter(c => c.okay).length, failed: report.checks.filter(c => !c.okay).length, pageErrors: report.pageErrors.length };
  await fs.writeFile(path.join(out, "results.json"), JSON.stringify(report, null, 2) + "\n");
}
if (report.summary.failed || report.summary.pageErrors) process.exitCode = 1;

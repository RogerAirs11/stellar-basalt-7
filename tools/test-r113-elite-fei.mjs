/** Local synthetic-demo verification. Never runs against a remote deployment. */
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const { chromium } = await import(process.env.UI_PLAYWRIGHT_MODULE || "playwright");
const AxeBuilder = process.env.UI_AXE_MODULE ? (await import(process.env.UI_AXE_MODULE)).default : null;
const base = process.env.UI_BASE_URL || "http://127.0.0.1:3000";
if (!["127.0.0.1", "localhost"].includes(new URL(base).hostname)) throw new Error("An isolated loopback demo is required.");
const out = path.resolve(process.env.UI_EVIDENCE_DIR || "review-r113/evidence/elite-fei-browser");
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const result = { startedAt: new Date().toISOString(), browser: browser.version(), layouts: [], journeys: [], audits: [], pageErrors: [], failures: [], caveat: "Chromium source-preview on the isolated synthetic demo. Viewport/reduced-motion and keyboard checks are measured; this is not a cross-browser or accessibility certification." };
const save = () => fs.writeFile(path.join(out, "results.json"), JSON.stringify(result, null, 2) + "\n");
const visit = async (page, route) => { await page.goto(base + route, { waitUntil: "networkidle", timeout: 30000 }); await page.locator("main").first().waitFor(); };
async function contextFor(skin, locale, layout, persona = "admin") {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  await context.addInitScript(({ skin, locale, layout, origin }) => { if (location.origin !== origin) return; localStorage.setItem("registry-frontend", skin); localStorage.setItem("registry-locale", locale); localStorage.setItem("registry.locale", locale); localStorage.setItem(`horse-registry:navigation:${skin}:v1`, layout); }, { skin, locale, layout, origin: new URL(base).origin });
  const login = await context.request.post(base + "/api/auth/demo-admin", { headers: { Origin: base }, data: { persona } });
  assert.equal(login.status(), 200, `Demo login ${persona}`);
  const page = await context.newPage();
  page.on("pageerror", error => result.pageErrors.push({ skin, locale, layout, message: error.message }));
  page.on("dialog", dialog => dialog.accept());
  return { context, page };
}
async function measure(page) {
  return page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    const visible = node => { const r = node.getBoundingClientRect(), s = getComputedStyle(node); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
    const controls = [...document.querySelectorAll("main input, main textarea, main select, main button")].filter(visible);
    const escaped = controls.filter(node => { const r = node.getBoundingClientRect(); return r.left < -1 || r.right > viewport + 1; }).map(node => ({ tag: node.tagName, text: (node.textContent || node.getAttribute("name") || "").slice(0, 90), left: node.getBoundingClientRect().left, right: node.getBoundingClientRect().right }));
    return { viewport, scrollWidth: document.documentElement.scrollWidth, h1: [...document.querySelectorAll("h1")].filter(visible).length, escaped, title: document.querySelector("main h1")?.textContent, reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches };
  });
}
try {
  if (process.env.UI_PHASE !== "journeys") for (const skin of (process.env.UI_SKINS || "equidata-elite,fei-classic").split(",")) for (const locale of (process.env.UI_LOCALES || "en,fa").split(",")) for (const layout of (process.env.UI_LAYOUTS || "tabs,sidebar").split(",")) {
    const { context, page } = await contextFor(skin, locale, layout);
    const routes = [["directory", `/f/${skin}/directory`], ["professional", `/f/${skin}/directory/990000003`], ["services", `/f/${skin}/services`], ["requests", `/f/${skin}/${skin === "fei-classic" ? "workflows" : "claims"}`], ["review", `/f/${skin}/${skin === "fei-classic" ? "management" : "governance"}`]].filter(([name]) => !process.env.UI_ROUTE_NAMES || process.env.UI_ROUTE_NAMES.split(",").includes(name));
    const widths = (process.env.UI_WIDTHS || "320,390,768,1024,1440").split(",").map(Number);
    for (const [name, route] of routes) for (const width of widths) {
      const state = { skin, locale, layout, name, width };
      try {
        await page.setViewportSize({ width, height: width === 1024 ? 420 : 844 });
        await visit(page, route);
        const measurement = await measure(page);
        assert.ok(measurement.h1 >= 1, "Visible page heading"); assert.ok(measurement.scrollWidth <= width + 1, `Horizontal page overflow ${measurement.scrollWidth} > ${width}`); assert.equal(measurement.escaped.length, 0, `Controls outside viewport: ${JSON.stringify(measurement.escaped)}`);
        assert.ok(measurement.reducedMotion, "Reduced-motion context");
        if (AxeBuilder) {
          const audit = await new AxeBuilder({ page }).analyze();
          const compact = rule => ({ id: rule.id, impact: rule.impact, nodes: rule.nodes.map(node => ({ target: node.target, html: node.html, failureSummary: node.failureSummary })) });
          result.audits.push({ ...state, violations: audit.violations.map(compact), incomplete: audit.incomplete.map(compact), passedRules: audit.passes.length });
          assert.equal(audit.violations.length, 0, `Accessibility violations: ${audit.violations.map(rule => `${rule.id}:${rule.nodes.length}`).join(", ")}`);
        }
        if (name === "professional") assert.equal(await page.locator('textarea[name="note"]').count(), 1, "Native service composer exists");
        if (width === 390 && layout === "tabs") await page.screenshot({ path: path.join(out, `${skin}-${locale}-${name}-390.png`), fullPage: true });
        if (name === "requests") {
          const selector = skin === "fei-classic" ? ".fc112-sections-toggle:visible, .fc102-mobile-toggle:visible" : ".edx112-sections-toggle:visible, .edx102-mobile-toggle:visible";
          const toggle = page.locator(selector).first();
          if (await toggle.count()) {
            await toggle.click(); assert.equal(await toggle.getAttribute("aria-expanded"), "true");
            await page.keyboard.press("Escape"); assert.equal(await toggle.getAttribute("aria-expanded"), "false"); assert.ok(await toggle.evaluate(node => document.activeElement === node), "Disclosure restores focus");
          }
        }
        result.layouts.push({ ...state, ok: true, ...measurement });
      } catch (error) { result.failures.push({ ...state, error: String(error) }); result.layouts.push({ ...state, ok: false }); }
      await save();
    }
    console.log(JSON.stringify({ skin, locale, layout, tested: routes.length * widths.length, failures: result.failures.length }));
    await context.close();
  }
  if (process.env.UI_PHASE !== "layouts") for (const [skin, persona] of [["equidata-elite", "admin"], ["fei-classic", "reviewer"]]) {
    const { context, page } = await contextFor(skin, "en", "tabs", persona);
    const journey = { skin, persona, steps: [], requestId: null };
    try {
      await visit(page, `/f/${skin}/directory/990000003`);
      const note = page.locator('textarea[name="note"]'), form = note.locator("xpath=ancestor::form");
      await note.fill(`R113 ${skin} synthetic service inquiry for native lifecycle validation.`);
      assert.ok(await page.getByRole("button", { name: "Send inquiry", exact: true }).isDisabled());
      await form.locator('input[type="checkbox"]').first().check(); await form.locator('input[type="checkbox"]').nth(1).check();
      const responsePromise = page.waitForResponse(response => response.url().endsWith("/api/service-requests") && response.request().method() === "POST");
      await page.getByRole("button", { name: "Send inquiry", exact: true }).click(); const response = await responsePromise; const created = await response.json(); assert.equal(response.status(), 201, JSON.stringify(created));
      journey.requestId = created.request.id; journey.steps.push("Explicit consent + real create receipt");
      await page.getByRole("button", { name: "Open my request", exact: true }).click(); await page.waitForURL(`**/services/${journey.requestId}`);
      await page.getByText(`R113 ${skin} synthetic service inquiry for native lifecycle validation.`, { exact: true }).waitFor();
      journey.steps.push("Native detail route with current private note");
      await page.getByText("Privacy and provider controls", { exact: true }).click();
      await page.getByRole("button", { name: "Withdraw contact sharing", exact: true }).click();
      await page.getByText(/Change recorded/).first().waitFor();
      await page.waitForFunction(() => !document.querySelector(".edx113-service-contact,.fc113-service-contact")); journey.steps.push("Contact consent withdrawn and disclosure cleared");
      // The status write is deliberately failed at the transport boundary. No
      // server mutation runs during this injection; a later explicit retry does.
      const pattern = `**/api/service-requests/${journey.requestId}/status`;
      await page.route(pattern, route => route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: { code: "injected_gateway", message: "Synthetic interrupted status response" } }) }));
      await page.getByRole("button", { name: "Close request", exact: true }).click();
      await page.getByRole("button", { name: "Reload this request", exact: true }).waitFor();
      assert.ok(await page.getByRole("button", { name: "Close request", exact: true }).isDisabled());
      await page.getByRole("button", { name: "Back to request list", exact: true }).click();
      await page.getByRole("button", { name: "Open request", exact: true }).click();
      await page.getByRole("button", { name: "Reload this request", exact: true }).click();
      await page.getByRole("button", { name: "I reviewed the current request", exact: true }).waitFor({ state: "visible" });
      await page.waitForFunction(() => [...document.querySelectorAll("button")].some(node => node.textContent === "I reviewed the current request" && !node.disabled));
      await page.getByRole("button", { name: "I reviewed the current request", exact: true }).click();
      await page.unroute(pattern); await page.getByRole("button", { name: "Close request", exact: true }).click();
      await page.getByText(/Change recorded/).first().waitFor(); journey.steps.push("Unknown lock survives list/detail navigation; fresh read + explicit acknowledgement; close confirmed");
      await page.screenshot({ path: path.join(out, `${skin}-service-lifecycle.png`), fullPage: true });
      const current = await context.request.get(`${base}/api/service-requests/${journey.requestId}`); const detail = await current.json(); assert.equal(detail.request.status, "closed"); assert.equal(detail.request.contact, null);
      journey.ok = true;
    } catch (error) { journey.ok = false; journey.error = String(error); result.failures.push({ skin, name: "service-journey", error: String(error) }); }
    result.journeys.push(journey); await save(); console.log(JSON.stringify(journey)); await context.close();
  }
} finally {
  await browser.close(); result.finishedAt = new Date().toISOString(); result.summary = { layoutStates: result.layouts.length, layoutsPassed: result.layouts.filter(state => state.ok).length, journeys: result.journeys.length, journeysPassed: result.journeys.filter(journey => journey.ok).length, failures: result.failures.length, pageErrors: result.pageErrors.length }; await save(); console.log(JSON.stringify(result.summary));
}
if (result.failures.length || result.pageErrors.length) process.exitCode = 1;

/** Rendered-state audit on an isolated demo. Automated findings are not an accessibility certification. */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = process.env.UI_BASE_URL || "http://127.0.0.1:3000";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(base).hostname)) throw new Error("Only an isolated loopback demo may be audited.");
const { chromium } = await import(process.env.UI_PLAYWRIGHT_MODULE || "playwright");
const { default: AxeBuilder } = await import(process.env.UI_AXE_MODULE || "@axe-core/playwright");
const out = path.resolve(root, process.env.UI_EVIDENCE_DIR || "review-r113/evidence/accessibility-initial");
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const result = { browser: browser.version(), startedAt: new Date().toISOString(), sourcePreview: true,
  caveat: "Automated audit of these rendered states only; incomplete rules and untested devices/manual checks remain.", states: [], errors: [], pageErrors: [] };
const skins = (process.env.UI_SKINS || "heritage,equidata-elite,fei-classic,retro-astra,classic-registry").split(",");
const routes = process.env.UI_ROUTES ? JSON.parse(process.env.UI_ROUTES) : [["home", "/"], ["browse", "/browse"], ["horse", "/horse/900000017"]];
try {
  for (const skin of skins) for (const locale of ["en", "fa"]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
    await context.addInitScript(({ skin, locale, origin }) => {
      if (location.origin !== origin) return;
      localStorage.setItem("registry-frontend", skin); localStorage.setItem("registry-locale", locale);
      localStorage.setItem("registry.locale", locale);
      localStorage.setItem(`horse-registry:navigation:${skin}:v1`, "tabs");
    }, { skin, locale, origin: new URL(base).origin });
    if (process.env.UI_PERSONA) {
      const login = await context.request.post(base + "/api/auth/demo-admin", {
        headers: { Origin: new URL(base).origin }, data: { persona: process.env.UI_PERSONA },
      });
      if (!login.ok()) throw new Error(`Isolated demo persona could not sign in: ${login.status()}`);
    }
    const page = await context.newPage();
    page.on("pageerror", error => result.pageErrors.push({ skin, locale, message: error.message }));
    for (const [name, route] of routes) for (const width of [390, 1440]) {
      const state = { skin, locale, name, width };
      try {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 960 });
        await page.goto(base + route, { waitUntil: "networkidle", timeout: 30000 });
        if (skin === "classic-registry") {
          await page.locator("iframe").waitFor();
          const frame = page.frames().find(item => item.url().includes("/classic-registry/"));
          if (frame) await frame.locator('#app[aria-busy="false"]').waitFor();
        } else await page.locator("main").first().waitFor();
        if (process.env.UI_EXPAND_DETAILS === "1") for (const frame of page.frames()) {
          if (frame === page.mainFrame() || frame.url().includes("/classic-registry/")) await frame.locator("details").evaluateAll(items => items.forEach(item => { item.open = true; }));
        }
        const audit = await new AxeBuilder({ page }).analyze();
        const compact = rule => ({ id: rule.id, impact: rule.impact, description: rule.description,
          help: rule.help, helpUrl: rule.helpUrl, nodes: rule.nodes.map(node => ({ target: node.target,
            html: node.html, failureSummary: node.failureSummary,
            checks: [...node.any, ...node.all, ...node.none].map(check => ({ id: check.id, data: check.data, message: check.message })) })) });
        const frames = [];
        for (const frame of page.frames()) {
          if (frame === page.mainFrame() || frame.url().includes("/classic-registry/")) frames.push(await frame.evaluate(() => ({
            url: location.pathname, width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth,
          })));
        }
        result.states.push({ ...state, frames, violations: audit.violations.map(compact),
          incomplete: audit.incomplete.map(compact), passedRules: audit.passes.length });
        console.log(JSON.stringify({ ...state, violations: audit.violations.map(v => `${v.id}:${v.nodes.length}`), incomplete: audit.incomplete.length, frames }));
      } catch (error) { result.errors.push({ ...state, error: String(error) }); console.log(JSON.stringify({ ...state, error: String(error) })); }
      await fs.writeFile(path.join(out, "results.json"), JSON.stringify(result, null, 2) + "\n");
    }
    await context.close();
  }
} finally {
  await browser.close(); result.finishedAt = new Date().toISOString();
  result.summary = { states: result.states.length, statesWithViolations: result.states.filter(s => s.violations.length).length,
    violations: result.states.reduce((count, s) => count + s.violations.reduce((sum, v) => sum + v.nodes.length, 0), 0),
    errors: result.errors.length, pageErrors: result.pageErrors.length };
  await fs.writeFile(path.join(out, "results.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result.summary));
}
if (result.errors.length || result.pageErrors.length || (process.env.UI_REQUIRE_NO_VIOLATIONS === "1" && result.summary.violations)) process.exitCode = 1;

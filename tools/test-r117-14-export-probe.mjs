/** R117-14 supplementary probe: the registry-safe CSV EXPORT journey per skin
 * (the document parity row promises read/save/version-conflict/export/import;
 * the matrix covered everything but export — this closes it with per-skin
 * persisted evidence: 200, text/csv, registry-safe fields only, and no cell
 * begins with a formula-injection character). Loopback synthetic demo only. */
import fs from "node:fs/promises";
import path from "node:path";
const base = process.env.UI_BASE_URL || "http://127.0.0.1:3000";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(base).hostname)) throw new Error("Local synthetic demo only.");
const playwrightModule = await import(process.env.UI_PLAYWRIGHT_MODULE || "playwright");
const chromium = playwrightModule.chromium ?? playwrightModule.default?.chromium;
const out = path.resolve(process.env.UI_EVIDENCE_DIR || "review-r117/evidence-local/parity-matrix");
await fs.mkdir(out, { recursive: true });
const report = { startedAt: new Date().toISOString(), skins: [], checks: 0, failures: 0 };
const check = (skin, name, okay, details = {}) => {
  report.checks += 1;
  if (!okay) report.failures += 1;
  console.log(`${okay ? "PASS" : "FAIL"} [${skin}] ${name} ${JSON.stringify(details)}`);
};
const SKINS = [
  { key: "heritage", url: "/workspaces" },
  { key: "equidata-elite", url: "/f/equidata-elite/workspaces" },
  { key: "fei-classic", url: "/f/fei-classic/workspaces" },
  { key: "retro-astra", url: "/f/retro-astra/workspaces" },
  { key: "classic-registry", url: "/f/classic-registry/workspaces" },
];
const browser = await chromium.launch({ headless: true });
try {
  for (const skin of SKINS) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    await context.addInitScript(({ origin, frontend }) => {
      if (location.origin !== origin) return;
      localStorage.setItem("registry-frontend", frontend);
      localStorage.setItem("registry-locale", "en");
    }, { origin: new URL(base).origin, frontend: skin.key });
    const auth = await context.request.post(base + "/api/auth/demo-admin", { headers: { Origin: base }, data: { persona: "owner_a" } });
    if (!auth.ok()) throw new Error(`login failed: ${auth.status()}`);
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    await page.goto(base + skin.url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    // The export endpoint is principal+workspace scoped; fetch it from the
    // live page (same cookies the skin's own export link uses).
    const result = await page.evaluate(async (origin) => {
      const response = await fetch(origin + "/api/workspaces/970000001/export", { credentials: "same-origin" });
      return { status: response.status, contentType: response.headers.get("content-type") || "", text: await response.text() };
    }, base);
    const header = (result.text.split("\n")[0] || "").toLowerCase();
    const rows = result.text.split("\n").slice(1).filter(line => line.trim().length);
    const formulaCells = [];
    for (const line of rows) for (const cell of line.split(",")) if (/^[=+\-@\t\r]/.test(cell.trim()) && cell.trim().length > 1) formulaCells.push(cell.slice(0, 40));
    check(skin.key, "export returns 200 as CSV", result.status === 200 && result.contentType.includes("csv"), { status: result.status, contentType: result.contentType });
    check(skin.key, "export carries registry-safe herd fields and no private columns", /horse_id|name_latin/.test(header) && !/note|private|contact|owner/.test(header), { header: header.slice(0, 160) });
    check(skin.key, "no cell begins with a formula-injection character", formulaCells.length === 0, { offenders: formulaCells.slice(0, 3) });
    report.skins.push({ skin: skin.key, status: result.status, bytes: result.text.length });
    await context.close();
  }
} finally {
  await browser.close().catch(() => {});
  report.finishedAt = new Date().toISOString();
  report.summary = { checks: report.checks, failures: report.failures };
  await fs.writeFile(path.join(out, "export-probe.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(`\nExport probe: ${report.checks - report.failures}/${report.checks} checks, ${report.failures} failures`);
  process.exit(report.failures ? 1 : 0);
}

/** Real Chromium + the isolated demo Worker. No mocked API results. */
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = process.env.UI_BASE_URL || "http://127.0.0.1:3000";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(base).hostname)) throw new Error("Media rehearsal requires a disposable loopback demo.");
const { chromium } = await import(process.env.UI_PLAYWRIGHT_MODULE || "playwright");
const fixtures = JSON.parse(await fs.readFile(path.join(root, "tests/fixtures/media-r111/images.json"), "utf8"));
const out = path.join(root, "review-r111/evidence/media-browser");
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const report = { startedAt: new Date().toISOString(), browser: browser.version(), sourcePreview: true, cases: [], failures: [], pageErrors: [] };
const skins = process.env.UI_MEDIA_SKIN ? [process.env.UI_MEDIA_SKIN] : ["heritage", "fei-classic", "equidata-elite", "retro-astra", "classic-registry"];
const locales = process.env.UI_MEDIA_LOCALE ? [process.env.UI_MEDIA_LOCALE] : ["en", "fa"];
const horseId = 900000017;
const anon = await browser.newContext();
const admin = await browser.newContext();
async function login(context, persona) {
  const response = await context.request.post(`${base}/api/auth/demo-admin`, { headers: { Origin: base }, data: { persona } });
  assert.equal(response.status(), 200, await response.text());
  return (await response.json()).csrfToken;
}
try {
  const demo = await anon.request.get(`${base}/api/demo/context`);
  assert.equal((await demo.json()).write_policy, "isolated_local_only");
  const adminCsrf = await login(admin, "admin");
  for (const skin of skins) for (const locale of locales) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
    const csrf = await login(context, "owner_a");
    await context.addInitScript(({ skin, locale }) => { localStorage.setItem("registry-frontend", skin); localStorage.setItem("registry-locale", locale); }, { skin, locale });
    const page = await context.newPage();
    page.on("pageerror", error => report.pageErrors.push({ skin, locale, error: error.message }));
    let mediaId;
    const entry = { skin, locale, passed: false, viewportChecks: [] };
    const L = (en, fa) => locale === "fa" ? fa : en;
    try {
      await page.goto(`${base}/horse/${horseId}`, { waitUntil: "networkidle" });
      let surface = page;
      if (skin === "classic-registry") {
        await page.locator("iframe").first().waitFor();
        surface = page.frames().find(frame => frame.url().includes("/classic-registry/"));
        if (!surface) throw new Error("Classic frame not found");
        await surface.locator(`a[href="#/horse/${horseId}?tab=records"]`).click();
      } else if (skin === "heritage") {
        await page.locator(".profile-workspace-nav, .profile-workspaces").first().waitFor({ state: "attached", timeout: 5000 }).catch(() => undefined);
        const choices = page.getByRole("button", { name: L("Media", "رسانه"), exact: true });
        for (const choice of await choices.all()) if (await choice.isVisible()) { await choice.click(); break; }
      } else if (skin === "retro-astra") {
        await page.getByRole("tab", { name: L("Modules", "ماژول‌ها"), exact: true }).click();
      } else {
        await page.getByRole("button", { name: skin === "equidata-elite" ? L("RECORDS", "رکوردها") : L("Records", "رکوردها"), exact: true }).click();
      }
      const panel = surface.locator(skin === "classic-registry" ? ".classic-media-panel" : ".registry-media-panel");
      await panel.waitFor();
      const upload = panel.locator('input[type="file"]');
      await upload.waitFor({ state: "attached" });
      const name = `DEMO-browser-${skin}-${locale}-${Date.now()}.png`;
      const uploadResponse = page.waitForResponse(response => response.url().endsWith(`/api/horses/${horseId}/media`) && response.request().method() === "POST");
      await upload.setInputFiles({ name, mimeType: "image/png", buffer: Buffer.from(fixtures.images["metadata.png"].base64, "base64") });
      const uploaded = await uploadResponse;
      assert.equal(uploaded.status(), 201, await uploaded.text());
      mediaId = (await uploaded.json()).media.id;
      assert.equal((await anon.request.get(`${base}/api/media/file/${mediaId}`)).status(), 404);
      let reviewed = await admin.request.post(`${base}/api/admin/media/${mediaId}/verify`, { headers: { Origin: base, "X-CSRF-Token": adminCsrf }, data: { decision: "platform_reviewed", expected_version: 1 } });
      assert.equal(reviewed.status(), 200, await reviewed.text());
      await panel.getByRole("button", { name: L("Refresh media", "تازه‌سازی رسانه"), exact: true }).click();
      const card = panel.locator("figure").filter({ hasText: name });
      const publishResponse = page.waitForResponse(response => response.url().endsWith(`/api/media/${mediaId}/publication`) && response.request().method() === "POST");
      await card.getByRole("button", { name: L("Publish photo", "انتشار عکس"), exact: true }).click();
      const published = await publishResponse;
      assert.equal(published.status(), 200, await published.text());
      assert.equal((await anon.request.get(`${base}/api/media/file/${mediaId}`)).status(), 200);
      await card.getByRole("button", { name: L("Withdraw publication", "لغو انتشار"), exact: true }).waitFor();
      // Another staff review changes the real version after the owner rendered.
      reviewed = await admin.request.post(`${base}/api/admin/media/${mediaId}/verify`, { headers: { Origin: base, "X-CSRF-Token": adminCsrf }, data: { decision: "platform_reviewed", expected_version: 3 } });
      assert.equal(reviewed.status(), 200, await reviewed.text());
      const conflictResponse = page.waitForResponse(response => response.url().endsWith(`/api/media/${mediaId}/publication`) && response.request().method() === "POST");
      await card.getByRole("button", { name: L("Withdraw publication", "لغو انتشار"), exact: true }).click();
      assert.equal((await conflictResponse).status(), 409);
      const withdrawResponse = page.waitForResponse(response => response.url().endsWith(`/api/media/${mediaId}/publication`) && response.request().method() === "POST");
      await panel.getByRole("button", { name: L("Retry visibility change", "تلاش دوباره برای تغییر نمایش"), exact: true }).click();
      assert.equal((await withdrawResponse).status(), 200);
      assert.equal((await anon.request.get(`${base}/api/media/file/${mediaId}`)).status(), 404);
      const accessResponse = page.waitForResponse(response => response.url().endsWith(`/api/media/${mediaId}/access`) && response.request().method() === "POST");
      await card.getByRole("button", { name: L("Create 15-minute access link", "ساخت پیوند دسترسی ۱۵ دقیقه‌ای"), exact: true }).click();
      const access = await accessResponse; assert.equal(access.status(), 201);
      const link = await access.json();
      assert.equal((await anon.request.get(base + link.url)).status(), 200);
      const revokedResponse = page.waitForResponse(response => response.url().endsWith(`/access/${link.grant_id}`) && response.request().method() === "DELETE");
      await card.getByRole("button", { name: L("Revoke this link", "لغو این پیوند"), exact: true }).click();
      assert.equal((await revokedResponse).status(), 200);
      assert.equal((await anon.request.get(base + link.url)).status(), 404);
      const ownRows = await (await context.request.get(`${base}/api/horses/${horseId}/media`)).json();
      const document = ownRows.media.find(item => item.media_type === "document");
      assert.ok(document, "Demo includes a real private document");
      assert.equal((await panel.locator(`a[href="/api/media/file/${document.id}"]`).count()), 1);
      const pdf = await context.request.get(`${base}/api/media/file/${document.id}`);
      assert.equal(pdf.status(), 200); assert.ok((await pdf.body()).subarray(0, 5).equals(Buffer.from("%PDF-")));
      assert.equal((await anon.request.get(`${base}/api/media/file/${document.id}`)).status(), 404);
      for (const width of [320, 390, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
        await panel.evaluate(element => element.scrollIntoView({ block: "start" }));
        const dimensions = await panel.evaluate(element => {
          const boundary = element.getBoundingClientRect();
          const offenders = [...element.querySelectorAll("button,select,input,a,figure")].flatMap(child => {
            if (!child.getClientRects().length) return [];
            const box = child.getBoundingClientRect();
            return box.left < boundary.left - 2 || box.right > boundary.right + 2 ? [{ tag: child.tagName, className: child.className, width: box.width }] : [];
          });
          return { width: boundary.width, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, viewport: document.documentElement.clientWidth, documentWidth: document.documentElement.scrollWidth, offenders };
        });
        const okay = dimensions.scrollWidth <= dimensions.clientWidth + 2 && !dimensions.offenders.length;
        entry.viewportChecks.push({ width, okay, ...dimensions });
        assert.ok(okay, `${skin}/${locale}/${width} media control overflow: ${JSON.stringify(dimensions)}`);
        if (width === 390 || width === 1440) await panel.screenshot({ path: path.join(out, `${skin}-${locale}-${width}.png`) });
      }
      entry.passed = true;
      entry.actions = ["private UI upload", "staff review HTTP", "explicit UI publication", "real409 conflict and explicit retry", "withdrawal", "exact link mint and revocation", "private PDF bytes and anonymous denial"];
      console.log(`${skin} ${locale}: native media actions and five viewport checks passed`);
    } catch (error) {
      entry.error = String(error); report.failures.push({ skin, locale, error: String(error) });
      await page.screenshot({ path: path.join(out, `${skin}-${locale}-failure.png`) }).catch(() => undefined);
      console.error(`${skin} ${locale}: ${String(error)}`);
    } finally {
      // Remove only the synthetic row this test created, with its owner's session.
      if (mediaId) await context.request.delete(`${base}/api/media/${mediaId}`, { headers: { Origin: base, "X-CSRF-Token": csrf } }).catch(() => undefined);
      report.cases.push(entry); await context.close();
    }
  }
} finally {
  await anon.close(); await admin.close(); await browser.close();
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
}
if (report.failures.length || report.pageErrors.length) process.exitCode = 1;

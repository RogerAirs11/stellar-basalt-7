/** Actual local-demo UI flows. No HTTP outcome is intercepted or fabricated. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:3000';
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname)) throw new Error('Only an isolated loopback demo may be used.');
const { chromium } = await import(process.env.UI_PLAYWRIGHT_MODULE || 'playwright');
const out = path.resolve(root, process.env.UI_EVIDENCE_DIR || 'review-r112/evidence/core-workflows-final');
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const report = { browser: browser.version(), startedAt: new Date().toISOString(), sourcePreview: true, checks: [], failures: [], pageErrors: [] };
const check = (name, okay, details = {}) => {
  report.checks.push({ name, okay, ...details });
  if (!okay) report.failures.push({ name, ...details });
  console.log(`${okay ? 'PASS' : 'FAIL'} ${name}`);
};
async function session(locale, persona) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' });
  await context.addInitScript(({ locale, origin }) => {
    if (location.origin !== origin) return;
    localStorage.setItem('registry-frontend', 'heritage');
    localStorage.setItem('registry-locale', locale);
    localStorage.setItem('horse-registry:navigation:heritage:v1', 'tabs');
  }, { locale, origin: new URL(base).origin });
  if (persona) {
    const response = await context.request.post(base + '/api/auth/demo-admin', { data: { persona } });
    if (!response.ok()) throw new Error(`Demo login ${persona}: ${response.status()}`);
  }
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', error => report.pageErrors.push({ locale, persona, error: error.stack || error.message }));
  return { context, page };
}
async function fit(page, name, selector = '.heritage-operations-page,.h-mod-workbench') {
  const geometry = await page.evaluate(selector => {
    const main = document.querySelector(selector);
    if (!main) return { missing: true };
    const bounds = main.getBoundingClientRect();
    const clippedControls = [...main.querySelectorAll('button,input,select,textarea,summary')].flatMap(element => {
      if (!element.getClientRects().length || getComputedStyle(element).visibility === 'hidden') return [];
      const rect = element.getBoundingClientRect();
      if (rect.left >= -1 && rect.right <= innerWidth + 1) return [];
      return [{ tag: element.tagName, label: element.getAttribute('aria-label') || element.textContent.trim().slice(0, 80), left: rect.left, right: rect.right }];
    });
    return { viewport: innerWidth, document: document.documentElement.scrollWidth, content: main.scrollWidth, contentWidth: main.clientWidth, left: bounds.left, right: bounds.right, clippedControls };
  }, selector);
  check(name, !geometry.missing && geometry.document <= geometry.viewport + 1 && geometry.content <= geometry.contentWidth + 1 && geometry.left >= -1 && geometry.right <= geometry.viewport + 1 && !geometry.clippedControls.length, geometry);
}
async function screenshot(page, name) {
  await page.screenshot({ path: path.join(out, name + '.png'), fullPage: false });
}
try {
  for (const locale of ['en', 'fa']) {
    const { context, page } = await session(locale, 'owner_a');
    try {
      await page.goto(base + '/workspaces', { waitUntil: 'networkidle' });
      await page.locator('.h-mod-workspace-list button').filter({ hasText: 'Client Rehearsal' }).click();
      const tabs = page.locator('.h-workspace-tabs [role="tab"]');
      await tabs.first().waitFor();
      const add = page.locator('summary').filter({ hasText: locale === 'fa' ? /^افزودن یادآور$/ : /^Add reminder$/ });
      await add.click();
      const form = add.locator('..').locator('form');
      const draft = `R112 ${locale} workspace draft ${Date.now()}`;
      await form.locator('input').first().fill(draft);
      for (const layout of ['tabs', 'sidebar']) {
        await page.setViewportSize({ width: 1440, height: 960 });
        await page.locator('.h102-layout select:visible').selectOption(layout);
        for (const width of [320, 390, 768, 1024, 1440]) {
          await page.setViewportSize({ width, height: width < 768 ? 844 : 960 });
          for (let section = 0; section < 4; section++) {
            await tabs.nth(section).click();
            await fit(page, `${locale}/${layout}/${width}/workspace-section-${section}`);
          }
          await tabs.first().click();
          check(`${locale}/${layout}/${width}/draft retained`, await form.locator('input').first().inputValue() === draft);
          if (width === 390 || width === 1440) {
            await tabs.first().scrollIntoViewIfNeeded();
            await screenshot(page, `workspace-${locale}-${layout}-${width}`);
          }
        }
      }
      await tabs.first().focus();
      await page.keyboard.press('End');
      check(`${locale}/End selects last workspace tab`, await tabs.nth(3).getAttribute('aria-selected') === 'true' && await tabs.nth(3).evaluate(element => element === document.activeElement));
      await page.keyboard.press('Home');
      await page.keyboard.press(locale === 'fa' ? 'ArrowLeft' : 'ArrowRight');
      check(`${locale}/arrow key follows reading direction`, await tabs.nth(1).getAttribute('aria-selected') === 'true');
      check(`${locale}/herd displays actual linked horses`, await page.locator('.h-workspace-herd a[href^="/horse/"]').count() === 6);
      await tabs.first().click();
      await page.getByRole('button', { name: locale === 'fa' ? 'نمای تقویم' : 'Calendar view', exact: true }).click();
      check(`${locale}/calendar replaces list`, await page.locator('.h-mod-calendar').isVisible() && await page.locator('.h-mod-task-list:visible').count() === 0);
      await page.setViewportSize({ width: 320, height: 844 });
      await fit(page, `${locale}/calendar320`);
      await page.getByRole('button', { name: locale === 'fa' ? 'نمای فهرست' : 'List view', exact: true }).click();
      await form.locator('input[type="date"]').fill('2026-10-31');
      const created = page.waitForResponse(response => /\/api\/workspaces\/\d+\/tasks$/.test(new URL(response.url()).pathname) && response.request().method() === 'POST');
      await form.locator('button[type="submit"]').click();
      const createResponse = await created;
      check(`${locale}/real reminder submission`, createResponse.status() === 201 && createResponse.request().postDataJSON().title === draft, { status: createResponse.status() });
      const reminder = page.getByRole('button', { name: (locale === 'fa' ? 'تکمیل یادآور' : 'Complete reminder') + ': ' + draft, exact: true });
      await reminder.waitFor();
      const completed = page.waitForResponse(response => /\/api\/workspaces\/\d+\/tasks\/\d+\/complete$/.test(new URL(response.url()).pathname) && response.request().method() === 'POST');
      await reminder.click();
      const completeResponse = await completed;
      check(`${locale}/real reminder completion`, completeResponse.ok(), { status: completeResponse.status() });
      await reminder.waitFor({ state: 'detached' });
      check(`${locale}/accepted completion refreshes actual task list`, await reminder.count() === 0);

      for (const [name, route, selector] of [
        ['account', '/login', '.h-account-page'], ['services', '/services', '.heritage-operations-page'],
        ['directory', '/directory', '.heritage-operations-page'], ['claims', '/directory/claims', '.h-mod-workbench'],
        ['registry-requests', '/f/heritage/desk', '.heritage-desk-page'],
      ]) {
        await page.goto(base + route, { waitUntil: 'networkidle' });
        await page.locator(selector).waitFor();
        for (const width of [320, 390, 768, 1024, 1440]) {
          await page.setViewportSize({ width, height: width < 768 ? 844 : 960 });
          await fit(page, `${locale}/${name}/${width}`, selector);
          if (width === 390) await screenshot(page, `${name}-${locale}-${width}`);
        }
        if (name === 'account') check(`${locale}/signed-in owner sees account without admin redirect`, new URL(page.url()).pathname === '/login' && (await page.locator('.h-account-details').innerText()).includes('demo-owner-a@local.invalid'));
        if (name === 'claims') check(`${locale}/claim center uses an explicit person ID and no endless profile loader`, await page.locator('input[type="number"]').count() > 0 && !/Loading the manageable profile|در حال بارگذاری نمایه قابل مدیریت/.test(await page.locator(selector).innerText()));
      }
      await page.goto(base + '/login', { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: locale === 'fa' ? 'خروج از حساب' : 'Sign out', exact: true }).click();
      await page.locator('.h-mod-auth-form').waitFor();
      const auth = await (await context.request.get(base + '/api/auth/me')).json();
      check(`${locale}/real sign-out revokes session and shows sign-in`, auth.user === null && await page.locator('.h-mod-auth-form').isVisible());
      await page.setViewportSize({ width: 320, height: 844 });
      await fit(page, `${locale}/guest-auth320`, '.h-mod-auth');
    } catch (error) { check(`${locale}/workspace-and-account scenario`, false, { error: String(error) }); }
    finally { await context.close(); }
  }
  for (const locale of ['en', 'fa']) for (const [persona, name, route] of [
    ['provider', 'person-editor', '/directory/manage/990000003'],
    ['manager', 'organization-editor', '/organizations/manage/970004001'],
  ]) {
    const { context, page } = await session(locale, persona);
    try {
      await page.goto(base + route, { waitUntil: 'networkidle' });
      await page.locator('.h-mod-workbench').waitFor();
      await page.locator('.h-mod-workbench input:not([type="checkbox"])').first().waitFor();
      check(`${locale}/${name}/authorized editor has real fields`, await page.locator('.h-mod-workbench input:not([disabled])').count() > 0);
      for (const width of [320, 390, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: width < 768 ? 844 : 960 });
        await fit(page, `${locale}/${name}/${width}`);
        if (width === 390 || width === 1440) await screenshot(page, `${name}-${locale}-${width}`);
      }
    } catch (error) { check(`${locale}/${name}/scenario`, false, { error: String(error) }); }
    finally { await context.close(); }
  }
} finally {
  check('no uncaught browser errors', report.pageErrors.length === 0, { pageErrors: report.pageErrors });
  report.finishedAt = new Date().toISOString();
  report.summary = { passed: report.checks.filter(item => item.okay).length, failed: report.failures.length };
  await browser.close();
  await fs.writeFile(path.join(out, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report.summary));
}
if (report.failures.length) process.exitCode = 1;

/** Bounded real-browser regressions for Core navigation; uses a local synthetic demo. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:3000';
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname)) throw new Error('Local demo only.');
const { chromium } = await import(process.env.UI_PLAYWRIGHT_MODULE || 'playwright');
const out = path.resolve(root, process.env.UI_EVIDENCE_DIR || 'review-r112/evidence/core-navigation-final');
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = { browser: browser.version(), startedAt: new Date().toISOString(), checks: [], pageErrors: [], failures: [] };
function check(name, okay, details = {}) {
  results.checks.push({ name, okay, ...details });
  if (!okay) results.failures.push({ name, ...details });
  console.log(`${okay ? 'PASS' : 'FAIL'} ${name}`);
}
async function newPage(width, height, layout, locale) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
  await context.addInitScript(({ layout, locale }) => {
    localStorage.setItem('registry-frontend', 'heritage'); localStorage.setItem('registry-locale', locale);
    localStorage.setItem('horse-registry:navigation:heritage:v1', layout);
  }, { layout, locale });
  const page = await context.newPage();
  page.on('pageerror', error => results.pageErrors.push({ width, height, layout, locale, error: error.stack || error.message }));
  return { context, page };
}
try {
  for (const [width, height, layout, locale, route] of [
    [1440, 900, 'tabs', 'en', '/'], [320, 844, 'tabs', 'en', '/'],
    [390, 844, 'tabs', 'fa', '/horse/900000017'], [900, 420, 'tabs', 'fa', '/'],
    [1440, 900, 'sidebar', 'en', '/horse/900000017'], [320, 844, 'sidebar', 'en', '/horse/900000017'],
  ]) {
    const name = `${width}x${height}/${layout}/${locale}`;
    const { context, page } = await newPage(width, height, layout, locale);
    try {
      await page.goto(base + route, { waitUntil: 'networkidle' });
      await page.locator('.h112-header').waitFor();
      const geometry = await page.evaluate(() => {
        const controls = [...document.querySelectorAll('.h112-header button,.h112-header a,.h112-header select')]
          .map(element => ({ label: element.getAttribute('aria-label') || element.textContent.trim(), rect: element.getBoundingClientRect() }))
          .filter(({ rect }) => rect.width > 0 && rect.height > 0);
        const collisions = controls.flatMap((item, index) => controls.slice(index + 1).filter(other =>
          Math.min(item.rect.right, other.rect.right) - Math.max(item.rect.left, other.rect.left) > 1 &&
          Math.min(item.rect.bottom, other.rect.bottom) - Math.max(item.rect.top, other.rect.top) > 1
        ).map(other => [item.label, other.label]));
        return { viewport: innerWidth, document: document.documentElement.scrollWidth, collisions,
          outsideControls: controls.filter(({ rect }) => rect.left < -1 || rect.right > innerWidth + 1).map(item => item.label) };
      });
      check(`${name}/document and header controls fit`, geometry.document <= width + 1 && !geometry.collisions.length && !geometry.outsideControls.length, geometry);
      if (layout === 'tabs') {
        const toggle = page.locator('.h112-sections-toggle');
        await toggle.focus(); await page.keyboard.press('Enter');
        const panel = page.locator('.h112-sections-panel');
        const bounds = await panel.evaluate(element => {
          const box = element.getBoundingClientRect();
          const dock = document.querySelector('.heritage-global-app-dock')?.getBoundingClientRect();
          return { top: box.top, bottom: box.bottom, limit: dock?.height ? dock.top : innerHeight,
            clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, links: element.querySelectorAll('a').length };
        });
        check(`${name}/all sections fit above bottom chrome`, bounds.bottom <= bounds.limit - 2 && bounds.scrollWidth <= bounds.clientWidth + 1 && bounds.links >= 15, bounds);
        if (width <= 820) {
          const wallpaper = panel.locator('a[href="/f/heritage/wallpaper"]');
          check(`${name}/desktop-only wallpaper link stays hidden`, await wallpaper.count() === 1 && !await wallpaper.isVisible() && await wallpaper.evaluate(element => getComputedStyle(element.closest('li')).display === 'none'));
        }
        await panel.locator('a').last().scrollIntoViewIfNeeded();
        check(`${name}/last section remains reachable`, await panel.locator('a').last().isVisible());
        await page.screenshot({ path: path.join(out, `${width}-${height}-${layout}-${locale}-sections.png`) });
        await page.keyboard.press('Escape');
        check(`${name}/Escape closes and restores focus`, await toggle.getAttribute('aria-expanded') === 'false' && await toggle.evaluate(element => element === document.activeElement));
        if (width === 1440) {
          await toggle.click();
          await panel.locator('a[href="/f/heritage/wallpaper"]').click();
          await page.locator('.wallpaper-view').waitFor();
          check(`${name}/Sections opens real Wallpaper presentation`, new URL(page.url()).pathname === '/f/heritage/wallpaper' && await page.locator('.wallpaper-view').isVisible());
          const wallpaperControls = await page.locator('.h112-header').evaluate(element => {
            const nav = element.querySelector('.h112-primary-navigation').getBoundingClientRect();
            const utilities = element.querySelector('.topbar-tools').getBoundingClientRect();
            return { navTop: nav.top, navBottom: nav.bottom, utilitiesTop: utilities.top, utilitiesBottom: utilities.bottom };
          });
          check(`${name}/Wallpaper navigation and utilities share one row`, Math.min(wallpaperControls.navBottom, wallpaperControls.utilitiesBottom) - Math.max(wallpaperControls.navTop, wallpaperControls.utilitiesTop) > 20, wallpaperControls);
          await page.screenshot({ path: path.join(out, 'desktop-wallpaper.png') });
          await page.keyboard.press('Escape');
          await page.locator('.wallpaper-view').waitFor({ state: 'detached' });
          check(`${name}/Escape returns from Wallpaper to home`, new URL(page.url()).pathname === '/' && await toggle.isVisible());
          await page.locator('.h112-desktop-layout select').selectOption('sidebar');
          const showcase = page.locator('.h102-sidebar .h102-group').filter({ has: page.locator('a[href="/f/heritage/wallpaper"]') });
          await showcase.locator('.h102-group-title').click();
          await showcase.locator('a[href="/f/heritage/wallpaper"]').click();
          await page.locator('.wallpaper-view').waitFor();
          check(`${name}/sidebar opens Wallpaper with a full-width presentation layout`, await page.locator('.app-shell').getAttribute('data-navigation-layout') === 'tabs' && await toggle.isVisible() && await page.locator('.h102-sidebar').count() === 0);
          await page.keyboard.press('Escape');
          await page.locator('.h102-sidebar').waitFor();
          check(`${name}/Wallpaper exit restores saved sidebar preference`, new URL(page.url()).pathname === '/' && await page.locator('.app-shell').getAttribute('data-navigation-layout') === 'sidebar' && await page.locator('.h112-primary-navigation').count() === 0);
          await page.locator('.h112-desktop-layout select').selectOption('tabs');
        }
      } else {
        check(`${name}/sidebar has no duplicate top or bottom navigation`, await page.locator('.h112-primary-navigation,.heritage-global-app-dock').count() === 0);
        if (width > 860) {
          const bounds = await page.locator('.h102-context').evaluate(element => {
            const context = element.getBoundingClientRect(); const nav = element.querySelector('nav').getBoundingClientRect();
            return { top: context.top, bottom: context.bottom, navTop: nav.top, navBottom: nav.bottom };
          });
          check(`${name}/context controls do not overlap route groups`, bounds.navTop >= bounds.top - 1 && bounds.navBottom <= bounds.bottom + 1, bounds);
          const emphasis = await page.locator('.h102-context nav button:not(.active)').first().evaluate(element => {
            const style = getComputedStyle(element); return { opacity: style.opacity, transform: style.transform };
          });
          check(`${name}/inactive controls stay legible and stationary`, emphasis.opacity === '1' && ['none', 'matrix(1, 0, 0, 1, 0, 0)'].includes(emphasis.transform), emphasis);
        } else {
          check(`${name}/horse controls stay inline`, await page.locator('.h112-context-home .profile-workspace-nav').isVisible());
          const controls = await page.locator('.pedigree-controls').first().boundingBox();
          check(`${name}/pedigree controls wrap within viewport`, controls && controls.x >= 0 && controls.x + controls.width <= width + 1, { controls });
        }
      }
      await page.screenshot({ path: path.join(out, `${width}-${height}-${layout}-${locale}.png`) });
    } catch (error) { check(`${name}/scenario`, false, { error: String(error) }); }
    finally { await context.close(); }
  }
  const { context, page } = await newPage(1440, 900, 'tabs', 'en');
  try {
    await page.goto(base + '/horse/900000017', { waitUntil: 'networkidle' });
    const record = page.locator('.profile-workspace-nav button').filter({ hasText: /^Record$/ });
    await record.click();
    await record.evaluate(element => element.setAttribute('data-r112-live-control', 'retained'));
    await page.locator('.h112-desktop-layout select').selectOption('sidebar');
    check('live relocation retains selected record and original DOM', await page.locator('.h102-context [data-r112-live-control="retained"].active').count() === 1);
    await page.setViewportSize({ width: 320, height: 844 });
    await page.locator('.h112-context-home [data-r112-live-control="retained"]').waitFor();
    check('mobile sidebar relocation keeps record controls inline', await page.locator('.h112-context-home [data-r112-live-control="retained"].active').isVisible());
    await page.locator('.h102-mobile-toggle').click();
    await page.locator('.h102-sidebar .h112-mobile-layout select').selectOption('tabs');
    await page.locator('.h112-dock-section select').last().waitFor();
    check('mobile dock retains record workspace after layout switch', await page.locator('.h112-dock-section select').last().inputValue() === 'record');
    await page.locator('.h112-dock-section select').last().selectOption('media');
    check('compact mobile view selector activates real Media workspace', await page.locator('.h112-dock-section select').last().inputValue() === 'media' && await page.locator('.registry-media-panel').count() > 0);
    // Emulate a device bottom safe area using an explicit dock inset, then resize
    // the viewport so its actual geometry is observed rather than guessed.
    await page.addStyleTag({ content: '.heritage-global-app-dock { bottom:39px!important; }' });
    await page.setViewportSize({ width: 321, height: 844 });
    await page.waitForFunction(() => {
      const box = document.querySelector('.heritage-global-app-dock').getBoundingClientRect();
      return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--h-mobile-dock-stack-height')) >= box.height + innerHeight - box.bottom;
    });
    await page.locator('.h112-sections-toggle').click();
    const safeBounds = await page.locator('.h112-sections-panel').evaluate(element => ({ bottom: element.getBoundingClientRect().bottom,
      dockTop: document.querySelector('.heritage-global-app-dock').getBoundingClientRect().top }));
    check('menu bounds account for a device bottom inset', safeBounds.bottom <= safeBounds.dockTop - 2, safeBounds);
  } catch (error) { check('live-layout-switch/scenario', false, { error: String(error) }); }
  finally { await context.close(); }
} finally {
  check('no uncaught browser errors in any scenario', results.pageErrors.length === 0, { pageErrors: results.pageErrors });
  results.finishedAt = new Date().toISOString();
  results.summary = { passed: results.checks.filter(item => item.okay).length, failed: results.failures.length };
  await browser.close();
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(results, null, 2) + '\n');
}
if (results.failures.length) process.exitCode = 1;

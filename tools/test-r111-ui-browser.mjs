/** Real Chromium/local Worker layout checks. No network/permission outcome is mocked. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:3000';
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname)) throw new Error('UI rehearsal is limited to the local demo.');
const { chromium } = await import(process.env.UI_PLAYWRIGHT_MODULE || 'playwright');
const out = path.resolve(root, process.env.UI_EVIDENCE_DIR || 'review-r111/evidence/ui-browser');
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const results = { browser: browser.version(), startedAt: new Date().toISOString(), sourcePreview: true, cases: [], pageErrors: [], failures: [] };
const skins = ['heritage', 'equidata-elite', 'fei-classic', 'retro-astra', 'classic-registry'];
const widths = [320, 390, 768, 1024, 1440];
try {
  for (const skin of skins) for (const locale of ['en', 'fa']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' });
    await context.addInitScript(({ skin, locale }) => {
      localStorage.setItem('registry-frontend', skin); localStorage.setItem('registry-locale', locale);
    }, { skin, locale });
    const page = await context.newPage();
    page.on('pageerror', error => results.pageErrors.push({ skin, locale, error: error.message }));
    await page.goto(`${base}${skin === 'heritage' ? '/' : `/f/${skin}/`}`, { waitUntil: 'networkidle' });
    let surface = page;
    if (skin === 'classic-registry') {
      await page.locator('iframe').first().waitFor();
      for (let attempt = 0; attempt < 20; attempt++) {
        surface = page.frames().find(frame => frame !== page.mainFrame() && new URL(frame.url() || base).pathname.startsWith('/classic-registry/'));
        if (surface) break;
        await page.waitForTimeout(100);
      }
      if (!surface) throw new Error('Classic frame did not load');
      await surface.locator('#app[aria-busy="false"]').waitFor();
    } else {
      const selector = { heritage: '.h102-content', 'equidata-elite': '.equidata-elite-ui', 'fei-classic': '.fei-classic-ui', 'retro-astra': '.retro-astra-transplant' }[skin];
      await page.locator(selector).waitFor();
    }
    const body = await surface.locator('body').innerText();
    if (/module crashed|module unavailable|متوقف شد|ناسازگار است/.test(body)) results.failures.push({ skin, locale, error: 'Frontend failed to render' });
    for (const width of widths) {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 960 });
      await page.waitForTimeout(160);
      const dimensions = await surface.evaluate(() => {
        const viewport = document.documentElement.clientWidth;
        const offenders = [...document.body.querySelectorAll('*')].flatMap(element => {
          if (!(element instanceof HTMLElement) || !element.getClientRects().length) return [];
          const rect = element.getBoundingClientRect();
          if (rect.right <= viewport + 2 && rect.left >= -2) return [];
          let parent = element.parentElement;
          while (parent && parent !== document.body) {
            if (['auto', 'scroll', 'hidden', 'clip'].includes(getComputedStyle(parent).overflowX)) return [];
            parent = parent.parentElement;
          }
          return [{ tag: element.tagName, className: element.className, left: Math.round(rect.left), right: Math.round(rect.right) }];
        }).slice(0, 12);
        return { viewport, scrollWidth: document.documentElement.scrollWidth, dir: document.documentElement.dir, offenders };
      });
      const hostDimensions = await page.evaluate(() => ({ viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
      const okay = dimensions.scrollWidth <= dimensions.viewport + 2 && hostDimensions.scrollWidth <= hostDimensions.viewport + 2;
      results.cases.push({ skin, locale, width, okay, ...dimensions, hostDimensions });
      if (!okay) results.failures.push({ skin, locale, width, error: 'Page overflow', dimensions });
      if (width === 390 || width === 1440) await page.screenshot({ path: path.join(out, `${skin}-${locale}-${width}.png`), fullPage: false });
    }
    await context.close();
    console.log(`${skin} ${locale}: measured ${widths.length} viewport widths`);
  }
} catch (error) {
  results.failures.push({ error: String(error) });
} finally {
  await browser.close();
  results.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(out, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify({ cases: results.cases.length, pageErrors: results.pageErrors.length, failures: results.failures }, null, 2));
  if (results.failures.length || results.pageErrors.length) process.exitCode = 1;
}

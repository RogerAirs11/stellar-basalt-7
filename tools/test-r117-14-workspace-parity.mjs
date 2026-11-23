/** R117-14 real-app workspace parity — the REOPEN journey (the missing
 * promised action of the workspace.task / workspace.reminder parity rows)
 * across ALL FIVE skins on the named synthetic loopback instance, plus the
 * recurring-occurrence honest explanation, the staff two-principal boundary
 * and the outsider isolation boundary. Real UI, real HTTP, real SQLite:
 * every effect is verified PERSISTED after a full page reload.
 *
 * Loopback synthetic demo only (no live tenant). Boot:
 *   npm run dev:demo -- data/demo/r118-agent.sqlite
 * then:
 *   node tools/test-r117-14-workspace-parity.mjs
 */
import fs from "node:fs/promises";
import path from "node:path";
const base = process.env.UI_BASE_URL || "http://127.0.0.1:3000";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(base).hostname)) throw new Error("Local synthetic demo only.");
const playwrightModule = await import(process.env.UI_PLAYWRIGHT_MODULE || "playwright");
const chromium = playwrightModule.chromium ?? playwrightModule.default?.chromium;
const out = path.resolve(process.env.UI_EVIDENCE_DIR || "review-r117/evidence-local/workspace-parity");
await fs.mkdir(out, { recursive: true });
const report = { browser: "n/a", startedAt: new Date().toISOString(), checks: [], failures: [], pageErrors: [] };
const stage = (name) => console.log(`-- ${new Date().toISOString().slice(11, 19)} ${name}`);
const check = (name, okay, details = {}) => {
  report.checks.push({ name, okay, ...details });
  if (!okay) report.failures.push({ name, ...details });
  console.log(`${okay ? "PASS" : "FAIL"} ${name} ${JSON.stringify(details)}`);
};

const SEED_TASK = "DEMO completed checklist";
const SKINS = [
  { key: "heritage", url: "/workspaces" },
  { key: "equidata-elite", url: "/f/equidata-elite/workspaces" },
  { key: "fei-classic", url: "/f/fei-classic/workspaces" },
  { key: "retro-astra", url: "/f/retro-astra/workspaces" },
  { key: "classic-registry", url: "/f/classic-registry/workspaces" },
];

let browser;
async function session(persona, locale = "en", frontend = "heritage") {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, reducedMotion: "reduce" });
  await context.addInitScript(({ locale, frontend, origin }) => {
    if (location.origin !== origin) return;
    localStorage.setItem("registry-frontend", frontend);
    localStorage.setItem("registry-locale", locale);
  }, { locale, frontend, origin: new URL(base).origin });
  const auth = await context.request.post(base + "/api/auth/demo-admin", { headers: { Origin: base }, data: { persona } });
  if (!auth.ok()) throw new Error(`Demo login ${persona}: ${auth.status()}`);
  const page = await context.newPage();
  page.setDefaultTimeout(25000);
  page.on("pageerror", error => report.pageErrors.push({ persona, locale, skin: page.url(), error: error.message }));
  return { context, page };
}
const shot = (page, name) => page.screenshot({ path: path.join(out, `${name}.png`), fullPage: false }).catch(() => {});
const apiGet = async (context, pathn) => {
  const response = await context.request.get(new URL(pathn, base).href);
  let body = null; try { body = await response.json(); } catch {}
  return { status: response.status(), body };
};

/** Wait for a matching workspace POST response while performing an action. */
const onPost = (page, suffix, perform) => (async () => {
  const waited = page.waitForResponse(r => new URL(r.url()).pathname.includes(`/api/workspaces/`) && new URL(r.url()).pathname.endsWith(suffix) && r.request().method() === "POST", { timeout: 25000 });
  waited.catch(() => {});
  await perform();
  return waited;
})();

async function openCompleted(page) {
  const details = page.locator('details[data-surface="workspace-completed"]').first();
  await details.waitFor({ timeout: 25000 });
  await details.evaluate(el => { el.open = true; });
  return details;
}

/** The seeded one-shot completed row inside the completed section. */
function seededRow(details) {
  return details.locator("li", { hasText: SEED_TASK }).first();
}

async function selectWorkspace(page, skin) {
  // Every skin renders the workspace list as rows (li) containing the name;
  // the row's button selects it (heritage/fei/elite/classic name the button,
  // retro's says "Open" — the row-scoped button works for all five).
  const row = skin === "heritage"
    ? page.locator('ul.h-mod-workspace-list li, main li', { hasText: "DEMO Client Rehearsal" }).first()
    : page.locator('[data-surface="workspace-desk"] li', { hasText: "DEMO Client Rehearsal" }).first();
  await row.waitFor({ timeout: 25000 });
  await row.locator("button").first().click();
  await page.locator('[data-surface="workspace-detail"], .h-workspace-header').first().waitFor({ timeout: 25000 });
}

async function completeSeedAgain(page, skin) {
  // Heritage: the open task row itself is the complete button. React desks:
  // each open row carries a "Mark complete" button.
  if (skin === "heritage") {
    const row = page.locator("button.registry-row-clickable", { hasText: SEED_TASK }).first();
    await row.waitFor({ timeout: 25000 });
    const response = await onPost(page, "/complete", () => row.click());
    return response.status();
  }
  const row = page.locator('[data-surface="workspace-detail"] li', { hasText: SEED_TASK }).first();
  await row.waitFor({ timeout: 25000 });
  const button = row.locator('button[aria-label^="Mark complete"], button[aria-label^="علامت‌گذاری"]').first();
  const response = await onPost(page, "/complete", () => button.click());
  return response.status();
}

try {
  browser = await chromium.launch({ headless: true });
  report.browser = await browser.version();

  // ------------------------------------------------------------------
  // A. The reopen journey in every skin (owner_a on the seeded workspace).
  // ------------------------------------------------------------------
  const owner = await session("owner_a");
  const ws = await apiGet(owner.context, "/api/workspaces/mine");
  const seeded = (ws.body?.owned || []).find(row => row.name === "DEMO Client Rehearsal");
  check("owner_a holds the seeded rehearsal workspace", !!seeded, { owned: (ws.body?.owned || []).map(r => r.name) });
  if (!seeded) throw new Error("seeded workspace missing — reset the instance first");

  for (const skin of SKINS) {
    stage(`skin ${skin.key}: create/complete/REOPEN journey with persisted effects`);
    await owner.page.goto(base + skin.url, { waitUntil: "domcontentloaded" });
    await owner.page.waitForTimeout(800);
    await selectWorkspace(owner.page, skin.key);
    const completed = await openCompleted(owner.page);
    await owner.page.waitForTimeout(600);

    const row = seededRow(completed);
    const rowVisible = await row.isVisible().catch(() => false);
    check(`${skin.key}: the seeded completed one-shot reminder renders in the completed section`, rowVisible);
    if (!rowVisible) { await shot(owner.page, `${skin.key}-completed-missing`); continue; }

    const reopenButton = row.locator('button[aria-label^="Reopen"], button[aria-label^="بازگشایی"]').first();
    check(`${skin.key}: the one-shot row offers a Reopen control`, await reopenButton.isVisible().catch(() => false));

    const response = await onPost(owner.page, "/reopen", () => reopenButton.click());
    check(`${skin.key}: reopen returns 200 over the real API`, response.status() === 200, { status: response.status() });
    await owner.page.waitForTimeout(900);
    await shot(owner.page, `${skin.key}-after-reopen`);

    // Persisted effect: after a FULL reload the reminder is open again.
    await owner.page.reload({ waitUntil: "domcontentloaded" });
    await selectWorkspace(owner.page, skin.key);
    const completedAfter = await openCompleted(owner.page);
    await owner.page.waitForTimeout(700);
    const backInCompleted = await seededRow(completedAfter).isVisible().catch(() => false);
    check(`${skin.key}: after reload the reopened reminder is NOT completed anymore (persisted)`, !backInCompleted);
    const openNow = skin.key === "heritage"
      ? await owner.page.locator("main").getByText(SEED_TASK, { exact: false }).first().isVisible().catch(() => false)
      : await owner.page.locator('[data-surface="workspace-detail"], [data-surface="workspace-desk"]').getByText(SEED_TASK, { exact: false }).first().isVisible().catch(() => false);
    check(`${skin.key}: the reopened reminder renders as an open reminder after reload`, openNow);
    await shot(owner.page, `${skin.key}-persisted-open`);

    // Restore the seeded state: complete it again through the real UI.
    const completeStatus = await completeSeedAgain(owner.page, skin.key);
    check(`${skin.key}: completing it again restores the seeded done state (real UI write)`, completeStatus === 200, { status: completeStatus });
    await owner.page.waitForTimeout(900);
  }

  // ------------------------------------------------------------------
  // B. Recurring closure explains itself and offers NO reopen control.
  // ------------------------------------------------------------------
  stage("recurring closure: inline honest explanation, no reopen control (heritage)");
  await owner.page.goto(base + "/workspaces", { waitUntil: "domcontentloaded" });
  await owner.page.waitForTimeout(600);
  await selectWorkspace(owner.page, "heritage");
  const recurringTitle = `R117-14 recurring probe ${Date.now() % 100000}`;
  const addDetails = owner.page.locator("details", { hasText: "Add reminder" }).first();
  await addDetails.waitFor({ timeout: 25000 });
  await addDetails.evaluate(el => { el.open = true; });
  const form = addDetails.locator("form").first();
  await form.locator("input").nth(0).fill(recurringTitle);
  await form.locator('input[type="date"]').first().fill("2026-12-15");
  const repeat = form.locator('input[type="number"]');
  if (await repeat.count()) await repeat.first().fill("30");
  const created = await onPost(owner.page, "/tasks", () => form.locator('button[type="submit"]').click());
  check("recurring reminder created through the real UI", created.status() === 201, { status: created.status() });
  await owner.page.waitForTimeout(900);

  const recurringRow = owner.page.locator("button.registry-row-clickable", { hasText: recurringTitle }).first();
  await recurringRow.waitFor({ timeout: 25000 });
  const completedIt = await onPost(owner.page, "/complete", () => recurringRow.click());
  check("recurring reminder completed through the real UI (spawns its next occurrence)", completedIt.status() === 200, { status: completedIt.status() });
  await owner.page.waitForTimeout(900);

  const completed = await openCompleted(owner.page);
  await owner.page.waitForTimeout(700);
  const recurringDoneRow = completed.locator("li", { hasText: recurringTitle }).first();
  check("the closed recurring occurrence appears in the completed section", await recurringDoneRow.isVisible().catch(() => false));
  const recurringExplanation = await recurringDoneRow.textContent().catch(() => "");
  check("the recurring row explains inline why it cannot be reopened", /next occurrence|وقوع بعدی/.test(recurringExplanation ?? ""), { text: (recurringExplanation ?? "").slice(0, 160) });
  const reopenOnRecurring = await recurringDoneRow.locator('button[aria-label^="Reopen"], button[aria-label^="بازگشایی"]').count();
  check("the recurring row offers NO reopen control", reopenOnRecurring === 0, { count: reopenOnRecurring });
  // The next occurrence is exactly one OPEN reminder (open rows carry the
  // complete control; the closed recurring row carries none).
  const openNext = await owner.page.locator(`button[aria-label^="Complete reminder:"][aria-label*="${recurringTitle}"]`).count();
  check("the spawned next occurrence is visible exactly once as an open reminder", openNext === 1, { openRows: openNext });
  await shot(owner.page, "recurring-explanation");

  // ------------------------------------------------------------------
  // C. Persian copy spot check (heritage, fa locale, fresh session).
  // ------------------------------------------------------------------
  stage("Persian copy of the completed/reopen surface");
  const ownerFa = await session("owner_a", "fa");
  await ownerFa.page.goto(base + "/workspaces", { waitUntil: "domcontentloaded" });
  await ownerFa.page.waitForTimeout(600);
  await selectWorkspace(ownerFa.page, "heritage");
  const completedFa = await openCompleted(ownerFa.page);
  await ownerFa.page.waitForTimeout(700);
  const faText = await completedFa.textContent().catch(() => "");
  check("the completed section renders the Persian heading and note", /یادآورهای انجام‌شده/.test(faText ?? "") && /وقوع بعدی/.test(faText ?? ""), { text: (faText ?? "").slice(0, 120) });
  const faReopenButton = await completedFa.locator('button[aria-label^="بازگشایی"]').count();
  check("the one-shot row offers the Persian reopen control", faReopenButton >= 1, { count: faReopenButton });
  await shot(ownerFa.page, "fa-completed");
  await ownerFa.context.close();

  // ------------------------------------------------------------------
  // D. Two-principal boundaries: delegated staff may reopen; an unrelated
  //    owner sees neither the workspace nor its reminders.
  // ------------------------------------------------------------------
  stage("two-principal boundary: staff (view+tasks_manage) vs unrelated owner_b");
  const staff = await session("staff");
  await staff.page.goto(base + "/f/equidata-elite/workspaces", { waitUntil: "domcontentloaded" });
  await staff.page.waitForTimeout(800);
  const staffList = await staff.page.locator('[data-surface="workspace-desk"]').innerText().catch(() => "");
  check("the delegated staff member sees the rehearsal workspace in their staff list", /DEMO Client Rehearsal/.test(staffList), { text: (staffList || "").slice(0, 120) });
  if (/DEMO Client Rehearsal/.test(staffList)) {
    await staff.page.locator('[data-surface="workspace-desk"] button', { hasText: "DEMO Client Rehearsal" }).first().click();
    const staffCompleted = await openCompleted(staff.page);
    await staff.page.waitForTimeout(700);
    const staffRow = staffCompleted.locator("li", { hasText: SEED_TASK }).first();
    const staffRowVisible = await staffRow.isVisible().catch(() => false);
    check("the staff member sees the completed one-shot reminder", staffRowVisible);
    if (staffRowVisible) {
      const staffReopen = staffRow.locator('button[aria-label^="Reopen"]').first();
      check("the staff member (tasks_manage) is OFFERED the reopen control and it is enabled", await staffReopen.isEnabled().catch(() => false));
    }
  }
  await shot(staff.page, "staff-completed");
  await staff.context.close();

  const outsider = await session("owner_b");
  await outsider.page.goto(base + "/f/retro-astra/workspaces", { waitUntil: "domcontentloaded" });
  await outsider.page.waitForTimeout(900);
  const outsiderText = await outsider.page.locator('[data-surface="workspace-desk"]').innerText().catch(() => "");
  check("an unrelated owner's workspace list does NOT contain the rehearsal workspace", !/DEMO Client Rehearsal/.test(outsiderText ?? ""), { text: (outsiderText || "").slice(0, 120) });
  await outsider.page.goto(base + "/f/retro-astra/workspaces/970000001", { waitUntil: "domcontentloaded" });
  await outsider.page.waitForTimeout(1200);
  const outsiderLeak = await outsider.page.getByText(SEED_TASK, { exact: false }).count();
  check("a deep link to another principal's workspace leaks NO completed reminder titles", outsiderLeak === 0, { leaks: outsiderLeak });
  await shot(outsider.page, "outsider-deeplink");
  await outsider.context.close();
  await owner.context.close();
} catch (error) {
  check("unhandled journey error", false, { error: String(error) });
} finally {
  if (browser) await browser.close().catch(() => {});
}
report.checksTotal = report.checks.length;
report.failuresTotal = report.failures.length;
report.pageErrorsTotal = report.pageErrors.length;
await fs.writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2));
console.log(`\nR117-14 workspace parity: ${report.checks.length - report.failures.length}/${report.checks.length} checks, ${report.pageErrors.length} page errors`);
console.log(`Evidence: ${out}`);
if (report.failures.length || report.pageErrors.length) process.exit(1);

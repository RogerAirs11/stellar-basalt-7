/** R117-14 real-app ASSIGN matrix — the last open promised action of the
 * workspace.task parity rows: the versioned ASSIGN/UNASSIGN journey, across
 * ALL FIVE skins on the named synthetic loopback instance. R114-05 covered
 * the assignment on retro-astra only; this tool gives it the five-skin
 * matrix treatment so the PARITY_ACCEPTANCE.csv workspace.task rows can be
 * closed on real-stack persisted evidence, per skin:
 *   (1) the versioned assign editor renders per skin with the open rows
 *       carrying their live versions (option text `title · due · v{N}`);
 *   (2) a real UI assign to the delegated staff member returns 200 and the
 *       effect is verified PERSISTED after a FULL page reload (assignee +
 *       advanced row_version both on the wire and in the re-rendered form);
 *   (3) the deterministic stale-version story: a second context holds the
 *       version it read; a concurrent write advances it; the second context's
 *       UI submit then loses with the honest 409 task_version_conflict
 *       carrying current_version, the failure notice renders, and a full
 *       reload recovers the current state — the concurrent write wins;
 *   (4) a real UI unassign (blank = unassign) also advances the version;
 *   (5) the seed assignee is restored through the real UI (write, not a
 *       fixture edit) and verified persisted;
 *   (6) honest boundaries: assigning to a principal without workspace access
 *       is 403 assignee_not_authorized with NO state change; an unrelated
 *       owner's reassign attempt on the real id is the existence-hiding 404.
 * Persian copy spot check included (heritage, fa).
 *
 * Loopback synthetic demo only (no live tenant). Boot:
 *   python tools/create-demo-database.py --output data/demo/r118-agent.sqlite
 *   npm run dev:demo -- data/demo/r118-agent.sqlite
 * then:
 *   UI_PLAYWRIGHT_MODULE=/home/z/.npm-global/lib/node_modules/playwright \
 *   node tools/test-r117-14-assign-matrix.mjs
 */
import fs from "node:fs/promises";
import path from "node:path";
const base = process.env.UI_BASE_URL || "http://127.0.0.1:3000";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(base).hostname)) throw new Error("Local synthetic demo only.");
const playwrightModule = await import(process.env.UI_PLAYWRIGHT_MODULE || "playwright");
const chromium = playwrightModule.chromium ?? playwrightModule.default?.chromium;
const out = path.resolve(process.env.UI_EVIDENCE_DIR || "review-r117/evidence-local/assign-matrix");
await fs.mkdir(out, { recursive: true });
const report = { browser: "n/a", startedAt: new Date().toISOString(), skins: {}, checks: [], failures: [], pageErrors: [] };
const stage = (name) => console.log(`-- ${new Date().toISOString().slice(11, 19)} ${name}`);
const check = (skin, name, okay, details = {}) => {
  const entry = { skin, name, okay, ...details };
  report.checks.push(entry);
  if (!okay) report.failures.push(entry);
  console.log(`${okay ? "PASS" : "FAIL"} [${skin}] ${name} ${JSON.stringify(details)}`);
  if (report.skins[skin] == null) report.skins[skin] = { total: 0, failed: 0 };
  report.skins[skin].total += 1;
  if (!okay) report.skins[skin].failed += 1;
};
const shot = (page, name) => page.screenshot({ path: path.join(out, `${name}.png`), fullPage: false }).catch(() => {});

const WS_NAME = "DEMO Client Rehearsal";
const TASK_TITLE = "DEMO farrier reminder"; // seeded open task, assigned to demo-owner-a
const STAFF = "demo-staff";                 // seeded staff (view+tasks_manage) on the rehearsal workspace
const SEED_ASSIGNEE = "demo-owner-a";       // the seeded assignee of the open tasks
const OUTSIDER = "demo-owner-b";            // a principal with no access to the rehearsal workspace
const SKINS = [
  { key: "heritage", url: "/workspaces" },
  { key: "equidata-elite", url: "/f/equidata-elite/workspaces" },
  { key: "fei-classic", url: "/f/fei-classic/workspaces" },
  { key: "retro-astra", url: "/f/retro-astra/workspaces" },
  { key: "classic-registry", url: "/f/classic-registry/workspaces" },
];

let browser;
async function session(persona, locale = "en") {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, reducedMotion: "reduce" });
  await context.addInitScript(({ locale, origin }) => {
    if (location.origin !== origin) return;
    localStorage.setItem("registry-locale", locale);
  }, { locale, origin: new URL(base).origin });
  const auth = await context.request.post(base + "/api/auth/demo-admin", { headers: { Origin: base }, data: { persona } });
  if (!auth.ok()) throw new Error(`Demo login ${persona}: ${auth.status()}`);
  const csrfToken = (await auth.json().catch(() => null))?.csrfToken ?? null;
  const page = await context.newPage();
  page.setDefaultTimeout(25000);
  page.on("pageerror", error => report.pageErrors.push({ persona, locale, skin: page.url(), error: error.message }));
  return { context, page, csrfToken };
}

/** Same-origin fetch from the live page (cookies + csrf) — the contract probe path. */
const apiFetch = (page, pathn, init = {}, csrfToken = null) => page.evaluate(async ({ pathn, init, origin, csrfToken }) => {
  const { data, ...rest } = init || {};
  const response = await fetch(new URL(pathn, origin).href, { ...rest, body: data, headers: { ...(init?.headers || {}), "content-type": "application/json", ...(csrfToken ? { "x-csrf-token": csrfToken } : {}) }, credentials: "same-origin" });
  let body = null; try { body = await response.json(); } catch {}
  return { status: response.status, body };
}, { pathn, init, origin: base, csrfToken });

/** Wait for a matching workspace POST response while performing an action. */
const onPost = (page, suffix, perform) => (async () => {
  const waited = page.waitForResponse(r => new URL(r.url()).pathname.includes(`/api/workspaces/`) && new URL(r.url()).pathname.endsWith(suffix) && r.request().method() === "POST", { timeout: 25000 });
  waited.catch(() => {});
  await perform();
  return waited;
})();

async function selectWorkspace(page, skin) {
  // Same convention as the R117-14 parity tools: every skin renders the
  // workspace list as rows containing the name; the row-scoped button selects it.
  const row = skin === "heritage"
    ? page.locator('ul.h-mod-workspace-list li, main li', { hasText: WS_NAME }).first()
    : page.locator('[data-surface="workspace-desk"] li', { hasText: WS_NAME }).first();
  await row.waitFor({ timeout: 25000 });
  await row.locator("button").first().click();
  await page.locator('[data-surface="workspace-detail"], .h-workspace-header').first().waitFor({ timeout: 25000 });
}

/** The versioned assign editor of the current skin: the details element whose
 * form submits the reassign command. In fa the button reads Persian. Heritage
 * organizes the detail in tab panels — the assignment editor lives in the
 * "team" panel, so that tab is activated first (aria-controls, locale-free). */
async function openAssignEditor(page, locale = "en", skin = "") {
  if (skin === "heritage") {
    const teamTab = page.locator('[role="tab"][aria-controls$="-team-panel"]');
    await teamTab.waitFor({ timeout: 25000 });
    await teamTab.click();
    await page.waitForTimeout(400);
  }
  const buttonText = locale === "fa" ? "به‌روزرسانی انتساب" : "Update assignment";
  const details = page.locator("details", { hasText: buttonText }).first();
  await details.waitFor({ timeout: 25000 });
  await details.evaluate(el => { el.open = true; });
  await page.waitForTimeout(300);
  return details;
}

/** Read the live task row (version + assignee) through the real API. */
async function readTask(page, csrfToken, workspaceId) {
  const response = await apiFetch(page, `/api/workspaces/${workspaceId}/tasks`, { method: "GET" }, csrfToken);
  const rows = (response.body?.tasks || []).filter(row => String(row.title) === TASK_TITLE);
  return { status: response.status, row: rows[0] ?? null };
}

/** Submit a UI assign/unassign through the real form: `assignee` null/blank = unassign. */
async function uiAssign(page, details, csrfToken, assignee) {
  const select = details.locator("select").first();
  const option = select.locator("option", { hasText: TASK_TITLE }).first();
  const optionText = await option.textContent();
  const value = await option.getAttribute("value");
  await select.selectOption(value);
  const input = details.locator('input[dir="ltr"]').first();
  await input.fill(assignee == null ? "" : assignee);
  const response = await onPost(page, "/reassign", () => details.locator('button[type="submit"]').first().click());
  let body = null; try { body = await response.json(); } catch {}
  const errorCode = body?.error?.code ?? body?.error ?? null;
  const currentVersion = Number(body?.error?.details?.current_version ?? body?.current_version ?? 0);
  return { status: response.status(), body, errorCode, currentVersion, optionText: (optionText || "").trim(), heldVersion: Number(/v(\d+)$/.exec(optionText || "")?.[1] ?? 0) };
}

try {
  browser = await chromium.launch({ headless: true });
  report.browser = await browser.version();

  // Resolve the seeded workspace id once (owner_a owns it).
  const probe = await session("owner_a");
  await probe.page.goto(base + "/", { waitUntil: "domcontentloaded" });
  await probe.page.waitForTimeout(600);
  const mine = await apiFetch(probe.page, "/api/workspaces/mine", { method: "GET" }, probe.csrfToken);
  const seeded = (mine.body?.owned || []).find(row => row.name === WS_NAME);
  check("shared", "owner_a holds the seeded rehearsal workspace", !!seeded, { owned: (mine.body?.owned || []).map(r => r.name) });
  if (!seeded) throw new Error("seeded workspace missing — reset the instance first");
  const workspaceId = Number(seeded.id);
  const seededTask = await readTask(probe.page, probe.csrfToken, workspaceId);
  check("shared", `the seeded open task "${TASK_TITLE}" is assigned to the seed assignee`, seededTask.row?.status === "open" && seededTask.row?.assigned_to_user_id === SEED_ASSIGNEE, { row: seededTask.row ? { status: seededTask.row.status, assigned: seededTask.row.assigned_to_user_id, v: seededTask.row.row_version } : null });
  if (!seededTask.row || seededTask.row.status !== "open") throw new Error("seeded open task missing — reset the instance first");
  await probe.context.close();

  for (const skin of SKINS) {
    stage(`skin ${skin.key}: versioned ASSIGN journey`);
    const owner = await session("owner_a");
    const second = await session("owner_a");
    try {
      // (1) the editor renders with the live version in the option text.
      await owner.page.goto(base + skin.url, { waitUntil: "domcontentloaded" });
      await owner.page.waitForTimeout(800);
      await selectWorkspace(owner.page, skin.key);
      await owner.page.waitForTimeout(600);
      const editor = await openAssignEditor(owner.page, "en", skin.key);
      const select = editor.locator("select").first();
      const optionText = (await select.locator("option", { hasText: TASK_TITLE }).first().textContent() || "").trim();
      const v0 = Number(/v(\d+)$/.exec(optionText)?.[1] ?? 0);
      check(skin.key, "the assign editor renders the open task with its live version", v0 > 0, { optionText });

      // (2) real UI assign to the delegated staff member; success notice.
      const first = await uiAssign(owner.page, editor, owner.csrfToken, STAFF);
      check(skin.key, "UI assign to the staff member returns 200 over the real API", first.status === 200, { status: first.status, body: first.body });
      await owner.page.waitForTimeout(800);
      const noticeVisible = await owner.page.getByText(/Assignment updated and audit-recorded|انتساب به‌روزرسانی و ثبت شد/).first().isVisible().catch(() => false);
      check(skin.key, "the success notice renders (audit-recorded copy)", noticeVisible);
      await shot(owner.page, `${skin.key}-after-assign`);

      // (3) persisted after a FULL reload: server state + the re-rendered form.
      await owner.page.reload({ waitUntil: "domcontentloaded" });
      await owner.page.waitForTimeout(800);
      await selectWorkspace(owner.page, skin.key);
      await owner.page.waitForTimeout(600);
      const editorReloaded = await openAssignEditor(owner.page, "en", skin.key);
      const optionAfter = (await editorReloaded.locator("select").first().locator("option", { hasText: TASK_TITLE }).first().textContent() || "").trim();
      const vAfter = Number(/v(\d+)$/.exec(optionAfter)?.[1] ?? 0);
      check(skin.key, "after reload the form re-renders the advanced version", vAfter === v0 + 1, { optionAfter, expected: v0 + 1 });
      const persisted = await readTask(owner.page, owner.csrfToken, workspaceId);
      check(skin.key, "the assignment is PERSISTED after the full reload (assignee + version on the wire)", persisted.row?.assigned_to_user_id === STAFF && Number(persisted.row?.row_version) === v0 + 1, { row: persisted.row ? { assigned: persisted.row.assigned_to_user_id, v: persisted.row.row_version } : null });

      // (4) deterministic stale-version story: the second context holds v0+1;
      // a concurrent write (real API unassign) advances to v0+2; the second
      // context's UI submit then loses with the honest 409 + current_version.
      await second.page.goto(base + skin.url, { waitUntil: "domcontentloaded" });
      await second.page.waitForTimeout(800);
      await selectWorkspace(second.page, skin.key);
      await second.page.waitForTimeout(600);
      const editorSecond = await openAssignEditor(second.page, "en", skin.key);
      const secondOptionText = (await editorSecond.locator("select").first().locator("option", { hasText: TASK_TITLE }).first().textContent() || "").trim();
      check(skin.key, "the second context reads the current version before the concurrent write", Number(/v(\d+)$/.exec(secondOptionText)?.[1] ?? 0) === v0 + 1, { secondOptionText });
      const concurrent = await apiFetch(owner.page, `/api/workspaces/${workspaceId}/tasks/${persisted.row.id}/reassign`, { method: "POST", data: JSON.stringify({ assigned_to_user_id: null, expected_version: v0 + 1 }) }, owner.csrfToken);
      check(skin.key, "the concurrent write (real API unassign) advances the version", concurrent.status === 200 && Number(concurrent.body?.row_version) === v0 + 2, { status: concurrent.status, body: concurrent.body });
      const stale = await uiAssign(second.page, editorSecond, second.csrfToken, STAFF);
      check(skin.key, "the stale submit loses with 409 task_version_conflict carrying current_version", stale.status === 409 && stale.errorCode === "task_version_conflict" && stale.currentVersion === v0 + 2, { status: stale.status, body: stale.body });
      await second.page.waitForTimeout(700);
      const staleNotice = await second.page.getByText(/reload and retry with the current version|reload before reassigning|Reload current version|با نسخه فعلی دوباره تلاش کنید/).first().isVisible().catch(() => false);
      check(skin.key, "the honest failure notice renders for the losing writer", staleNotice);
      await shot(second.page, `${skin.key}-stale-refused`);
      await second.page.reload({ waitUntil: "domcontentloaded" });
      await second.page.waitForTimeout(800);
      await selectWorkspace(second.page, skin.key);
      await second.page.waitForTimeout(600);
      const editorRecovered = await openAssignEditor(second.page, "en", skin.key);
      const recoveredOption = (await editorRecovered.locator("select").first().locator("option", { hasText: TASK_TITLE }).first().textContent() || "").trim();
      const recovered = await readTask(second.page, second.csrfToken, workspaceId);
      check(skin.key, "after reload the losing writer sees the concurrent state (unassigned, advanced version)", Number(/v(\d+)$/.exec(recoveredOption)?.[1] ?? 0) === v0 + 2 && recovered.row?.assigned_to_user_id === null, { recoveredOption, row: recovered.row ? { assigned: recovered.row.assigned_to_user_id, v: recovered.row.row_version } : null });

      // (5) restore the seed assignee through the real UI and verify persisted.
      // The owner page must first re-read the concurrent state (full reload),
      // exactly like a human would after seeing the version moved underneath them.
      await owner.page.reload({ waitUntil: "domcontentloaded" });
      await owner.page.waitForTimeout(800);
      await selectWorkspace(owner.page, skin.key);
      await owner.page.waitForTimeout(600);
      const restore = await uiAssign(owner.page, await openAssignEditor(owner.page, "en", skin.key), owner.csrfToken, SEED_ASSIGNEE);
      check(skin.key, "UI assign restores the seed assignee (real write, not a fixture edit)", restore.status === 200 && Number(restore.body?.row_version) === v0 + 3, { status: restore.status, body: restore.body });
      await owner.page.reload({ waitUntil: "domcontentloaded" });
      await owner.page.waitForTimeout(800);
      await selectWorkspace(owner.page, skin.key);
      const finalState = await readTask(owner.page, owner.csrfToken, workspaceId);
      check(skin.key, "the restored assignment is PERSISTED after the full reload", finalState.row?.assigned_to_user_id === SEED_ASSIGNEE && Number(finalState.row?.row_version) === v0 + 3, { row: finalState.row ? { assigned: finalState.row.assigned_to_user_id, v: finalState.row.row_version } : null });
      await shot(owner.page, `${skin.key}-restored`);

      // (6) honest boundary: an assignee without workspace access is refused 403.
      // The probe uses the LIVE version (read through the real API) so the guarded
      // UPDATE can only fail on the assignee-authority predicate, not on CAS.
      const beforeRefusal = await readTask(owner.page, owner.csrfToken, workspaceId);
      const liveVersion = Number(beforeRefusal.row?.row_version ?? 0);
      const unauthorized = await apiFetch(owner.page, `/api/workspaces/${workspaceId}/tasks/${beforeRefusal.row.id}/reassign`, { method: "POST", data: JSON.stringify({ assigned_to_user_id: OUTSIDER, expected_version: liveVersion }) }, owner.csrfToken);
      const unauthorizedCode = unauthorized.body?.error?.code ?? unauthorized.body?.error ?? null;
      check(skin.key, "assigning to a principal without access is refused 403 assignee_not_authorized with NO state change", unauthorized.status === 403 && unauthorizedCode === "assignee_not_authorized", { status: unauthorized.status, body: unauthorized.body });
      const afterRefusal = await readTask(owner.page, owner.csrfToken, workspaceId);
      check(skin.key, "the refused request changed nothing (still seed assignee, same version)", afterRefusal.row?.assigned_to_user_id === SEED_ASSIGNEE && Number(afterRefusal.row?.row_version) === liveVersion, { row: afterRefusal.row ? { assigned: afterRefusal.row.assigned_to_user_id, v: afterRefusal.row.row_version } : null, liveVersion });
    } finally {
      await owner.context.close().catch(() => {});
      await second.context.close().catch(() => {});
    }
  }

  // ------------------------------------------------------------------
  // B. Cross-principal existence hiding for the assign action itself.
  // ------------------------------------------------------------------
  stage("boundary: an unrelated principal cannot even see the workspace (404)");
  const outsider = await session("owner_b");
  await outsider.page.goto(base + "/f/equidata-elite/workspaces", { waitUntil: "domcontentloaded" });
  await outsider.page.waitForTimeout(800);
  const seededForOutsider = await readTask(outsider.page, outsider.csrfToken, workspaceId);
  const taskId = seededForOutsider.row?.id ?? 0;
  const attempted = await apiFetch(outsider.page, `/api/workspaces/${workspaceId}/tasks/${taskId}/reassign`, { method: "POST", data: JSON.stringify({ assigned_to_user_id: "demo-owner-b", expected_version: 1 }) }, outsider.csrfToken);
  check("shared", "an unrelated principal's reassign on the real id is the existence-hiding 404", seededForOutsider.status === 404 && attempted.status === 404, { read: seededForOutsider.status, write: attempted.status, body: attempted.body });
  await shot(outsider.page, "outsider-refused");
  await outsider.context.close();

  // ------------------------------------------------------------------
  // C. Persian copy spot check (heritage, fa locale, fresh session).
  // ------------------------------------------------------------------
  stage("Persian copy of the assign editor (heritage, fa)");
  const ownerFa = await session("owner_a", "fa");
  await ownerFa.page.goto(base + "/workspaces", { waitUntil: "domcontentloaded" });
  await ownerFa.page.waitForTimeout(800);
  await selectWorkspace(ownerFa.page, "heritage");
  await ownerFa.page.waitForTimeout(600);
  const editorFa = await openAssignEditor(ownerFa.page, "fa", "heritage");
  const faText = await editorFa.textContent().catch(() => "");
  check("heritage-fa", "the assign editor renders the Persian labels (assign/unassign + blank-means-unassign)", /انتساب یا لغو انتساب/.test(faText ?? "") && /خالی = لغو انتساب|انتساب به/.test(faText ?? ""), { text: (faText || "").slice(0, 160) });
  const faOption = (await editorFa.locator("select").first().locator("option", { hasText: TASK_TITLE }).first().textContent() || "").trim();
  check("heritage-fa", "the open row carries its live version in the fa editor too", /v\d+$/.test(faOption), { faOption });
  await shot(ownerFa.page, "fa-assign-editor");
  await ownerFa.context.close();
} catch (error) {
  check("shared", "unhandled journey error", false, { error: String(error) });
} finally {
  if (browser) await browser.close().catch(() => {});
}
report.checksTotal = report.checks.length;
report.failuresTotal = report.failures.length;
report.pageErrorsTotal = report.pageErrors.length;
await fs.writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2));
console.log(`\nR117-14 assign matrix: ${report.checks.length - report.failures.length}/${report.checks.length} checks, ${report.pageErrors.length} page errors`);
console.log(`Evidence: ${out}`);
if (report.failures.length || report.pageErrors.length) process.exit(1);

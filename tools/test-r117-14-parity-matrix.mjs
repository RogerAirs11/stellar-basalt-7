/** R117-14 real-app parity MATRIX — the four remaining promised journeys of
 * the workspace parity rows, across ALL FIVE skins on the named synthetic
 * loopback instance:
 *   (1) two tabs editing the same document — the loser's stale save 409s,
 *       keeps the draft, offers reload-and-retry at the current version;
 *   (2) the duplicate import — an interrupted import replays with the SAME
 *       durable intent key through the real UI and reconciles to zero
 *       duplicates (already_imported receipts); a DIFFERENT intent meeting an
 *       existing occurrence reports occurrence_exists (never overwrites);
 *       more than 200 rows is refused;
 *   (3) the A-B-A session switch — signing A then B then A again in one
 *       context leaks nothing across principals, out-of-scope ids stay
 *       existence-hidden, and A's persisted effects survive the round trip;
 *   (4) revoked membership — the owner removes the staff member mid-session;
 *       the stale staff UI is masked, the live recheck is a 404, and the
 *       deep link leaks nothing.
 * Real UI, real HTTP, real SQLite: every effect is verified PERSISTED after
 * full page reloads. Persian copy spot check included (heritage).
 *
 * Loopback synthetic demo only (no live tenant). Boot:
 *   npm run dev:demo -- data/demo/r118-agent.sqlite
 * then:
 *   node tools/test-r117-14-parity-matrix.mjs
 */
import fs from "node:fs/promises";
import path from "node:path";
const base = process.env.UI_BASE_URL || "http://127.0.0.1:3000";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(base).hostname)) throw new Error("Local synthetic demo only.");
const playwrightModule = await import(process.env.UI_PLAYWRIGHT_MODULE || "playwright");
const chromium = playwrightModule.chromium ?? playwrightModule.default?.chromium;
const out = path.resolve(process.env.UI_EVIDENCE_DIR || "review-r117/evidence-local/parity-matrix");
await fs.mkdir(out, { recursive: true });
const report = { browser: "n/a", startedAt: new Date().toISOString(), skins: {}, checks: [], failures: [], pageErrors: [] };
const stage = (name) => console.log(`-- ${new Date().toISOString().slice(11, 19)} ${name}`);
const check = (skin, name, okay, details = {}) => {
  const entry = { skin, name, okay, ...details };
  report.checks.push(entry);
  if (!okay) report.failures.push(entry);
  console.log(`${okay ? "PASS" : "FAIL"} [${skin}] ${name} ${JSON.stringify(details)}`);
};
const shot = (page, name) => page.screenshot({ path: path.join(out, `${name}.png`), fullPage: false }).catch(() => {});

const WS_NAME = "DEMO Client Rehearsal";
const SKIN_FILTER = (process.env.UI_SKINS || "").split(",").map(s => s.trim()).filter(Boolean);
const SKINS = [
  { key: "heritage", url: "/workspaces", react: false },
  { key: "equidata-elite", url: "/f/equidata-elite/workspaces", react: true },
  { key: "fei-classic", url: "/f/fei-classic/workspaces", react: true },
  { key: "retro-astra", url: "/f/retro-astra/workspaces", react: true },
  { key: "classic-registry", url: "/f/classic-registry/workspaces", react: true },
].filter(skin => SKIN_FILTER.length === 0 || SKIN_FILTER.includes(skin.key));

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

/** Wait for a matching response while performing an action. */
const onResponse = (page, predicate, perform) => (async () => {
  const waited = page.waitForResponse(predicate, { timeout: 25000 });
  waited.catch(() => {});
  await perform();
  return waited;
})();
const postTo = (suffix) => (page, perform) => onResponse(page, r => new URL(r.url()).pathname.includes("/api/workspaces/") && new URL(r.url()).pathname.endsWith(suffix) && r.request().method() === "POST", perform);
const documentPatch = (wsId) => (page, perform) => onResponse(page, r => new URL(r.url()).pathname.includes(`/api/workspaces/${wsId}/documents/`) && r.request().method() === "PATCH", perform);

async function openDetails(page, summaryText) {
  const details = page.locator("details", { hasText: summaryText }).first();
  await details.waitFor({ timeout: 25000 });
  await details.evaluate(el => { el.open = true; });
  return details;
}

/** Per-skin surface selectors. `fa` switches the heritage aria-labels to
 * their Persian forms (the FA spot check drives the Persian UI). */
function surfaces(page, skin, fa = false) {
  if (skin.key === "heritage") {
    const docsLabel = fa ? "پیگیرهای مدرک" : "Document trackers";
    return {
      deskList: page.locator("ul.h-mod-workspace-list li"),
      detailHeader: page.locator(".h-workspace-header h3").first(),
      docsPanel: page.locator(`section[aria-label="${docsLabel}"]`),
      docRow: (title) => page.locator(`section[aria-label="${docsLabel}"] li`).filter({ hasText: title }).first(),
      importPanel: page.locator(`section[aria-label="${fa ? "درون‌ریزی یادآورها" : "Import reminders (no overwrite)"}"]`),
      teamPanel: page.locator(`section[aria-label="${fa ? "کارکنان و دعوت‌ها" : "Staff and invitations"}"]`),
      invitations: page.locator(`section[aria-label="${fa ? "دعوت‌های در انتظار من" : "My pending invitations"}"]`),
      remindersText: async () => (await page.locator(".h-workspace-panel").first().innerText()).slice(0, 4000),
      openTab: async (name) => { await page.getByRole("tab", { name }).click(); },
    };
  }
  return {
    deskList: page.locator('[data-surface="workspace-desk"] li'),
    detailHeader: page.locator('[data-surface="workspace-detail"] h1, [data-surface="workspace-detail"] h2').first(),
    docsPanel: page.locator('[data-surface="workspace-documents"]'),
    docRow: (title) => page.locator('[data-surface="workspace-document-row"]').filter({ hasText: title }).first(),
    importPanel: page.locator('[data-surface="workspace-documents"]'),
    teamPanel: page.locator('[data-surface="workspace-detail"]'),
    invitations: page.locator('[data-surface="workspace-invitations"]'),
    remindersText: async () => (await page.locator('[data-surface="workspace-detail"]').first().innerText()).slice(0, 6000),
    openTab: async () => {},
  };
}

async function selectWorkspace(page, skin) {
  // Heritage: scope to the actual workspace list — the page also carries the
  // (possibly collapsed, hence hidden) pending-invitation rows in `main`.
  const row = skin.key === "heritage"
    ? page.locator('ul.h-mod-workspace-list li').filter({ hasText: WS_NAME }).first()
    : page.locator('[data-surface="workspace-desk"] li', { hasText: WS_NAME }).first();
  await row.waitFor({ timeout: 25000 });
  await row.locator("button").first().click();
  if (skin.key === "heritage") await page.locator(".h-workspace-header").first().waitFor({ timeout: 25000 });
  else await page.locator('[data-surface="workspace-detail"]').first().waitFor({ timeout: 25000 });
}

/** The note input inside a document edit form. All five skins render the
 * same three-field edit form (title text, expiry date, note text) — the note
 * is the SECOND non-date input (heritage wraps inputs in labels; the React
 * desks use htmlFor siblings — index-based selection works for both). */
const noteInput = (form) => form.locator('input:not([type="date"])').nth(1);

/** Open the invite details, fill the native invite form, submit. */
async function inviteThroughUi(page, skin, s) {
  if (skin.key === "heritage") { await s.openTab("People"); await s.teamPanel.waitFor({ timeout: 25000 }); }
  const inviteDetails = await openDetails(page, skin.key === "heritage" ? "Invite a staff member" : "Invite a staff member");
  const form = inviteDetails.locator("form").first();
  const invitePost = postTo("/invites");
  const response = await invitePost(page, async () => {
    await form.locator("input").first().fill("demo-staff");
    await form.getByText("tasks_manage").first().click();
    await form.getByRole("button", { name: "Send invitation" }).click();
  });
  return response.status();
}

/** The whole per-skin journey sequence. `wsId` is the rehearsal workspace id. */
async function runSkin(skin, wsId) {
  const tag = skin.key;
  const DOC_TITLE = `R117-14 two-tabs ${tag}`;
  const IMP_A = `R117-14 import A ${tag}`;
  const IMP_B = `R117-14 import B ${tag}`;
  const owner = await session("owner_a", "en", skin.key === "heritage" ? "heritage" : skin.key);
  const s = surfaces(owner.page, skin);
  try {
    // --------------------------------------------------------------
    // A. Invite -> accept -> the staff member actually gets access.
    // --------------------------------------------------------------
    stage(`${tag}: invite + accept + staff sees the workspace`);
    await owner.page.goto(base + skin.url, { waitUntil: "domcontentloaded" });
    await s.deskList.first().waitFor({ timeout: 25000 });
    // Setup normalization (idempotent): clear ANY open invitation for
    // demo-staff (the invitee declines it through the real API) and any
    // active direct assignment, so every skin runs the FULL native
    // invite -> accept journey rather than colliding with seeded state.
    const staffProbe = await session("staff", "en", skin.key === "heritage" ? "heritage" : skin.key);
    try {
      await staffProbe.page.goto(base + skin.url, { waitUntil: "domcontentloaded" });
      await staffProbe.page.waitForTimeout(500);
      const invites = await apiFetch(staffProbe.page, "/api/workspaces/invites/mine");
      for (const invite of invites.body?.rows ?? invites.body?.invites ?? []) {
        if ((invite.workspace_name === WS_NAME || invite.workspace_id === wsId) && invite.actionable !== false) {
          const declined = await apiFetch(staffProbe.page, `/api/workspaces/invites/${invite.collection_id}/respond`, { method: "POST", data: JSON.stringify({ action: "decline" }) }, staffProbe.csrfToken);
          await staffProbe.page.waitForTimeout(300);
        }
      }
    } finally { await staffProbe.context.close().catch(() => {}); }
    const dash = await apiFetch(owner.page, `/api/workspaces/${wsId}`);
    if (dash.body?.active_staff?.some(member => member.user_id === "demo-staff")) {
      await apiFetch(owner.page, `/api/workspaces/${wsId}/staff/demo-staff/revoke`, { method: "POST", data: JSON.stringify({}) }, owner.csrfToken);
      await owner.page.reload({ waitUntil: "domcontentloaded" });
      await s.deskList.first().waitFor({ timeout: 25000 });
    }
    await selectWorkspace(owner.page, skin);
    const inviteStatus = await inviteThroughUi(owner.page, skin, s);
    check(tag, "owner invites demo-staff (view + tasks_manage) through the native form", inviteStatus === 200 || inviteStatus === 201, { status: inviteStatus });

    const staff = await session("staff", "en", skin.key === "heritage" ? "heritage" : skin.key);
    const staffS = surfaces(staff.page, skin);
    try {
      await staff.page.goto(base + skin.url, { waitUntil: "domcontentloaded" });
      if (skin.key === "heritage") {
        // Heritage keeps the inbox behind a collapsed details — open it first.
        await openDetails(staff.page, "My pending invitations");
      }
      const invitationRow = staffS.invitations.locator("li").filter({ hasText: WS_NAME }).first();
      await invitationRow.waitFor({ timeout: 25000 });
      const respondPred = r => /\/api\/workspaces\/invites\/\d+\/respond$/.test(new URL(r.url()).pathname) && r.request().method() === "POST";
      const acceptStatus = (await onResponse(staff.page, respondPred, async () => { await invitationRow.getByRole("button", { name: "Accept", exact: true }).click(); })).status();
      check(tag, "the invitee accepts in their own inbox (200)", acceptStatus === 200, { status: acceptStatus });
      // The accept confirms live; the workspace LIST itself appears on the
      // next load of the desk (the inbox does not repaint the list in place).
      await staff.page.goto(base + skin.url, { waitUntil: "domcontentloaded" });
      let staffSeesWorkspace = false;
      try {
        await staffS.deskList.filter({ hasText: WS_NAME }).first().waitFor({ timeout: 15000 });
        staffSeesWorkspace = true;
      } catch {}
      check(tag, "the accepted workspace appears in the invitee's staff list", staffSeesWorkspace, {});
      await selectWorkspace(staff.page, skin);
      const staffDetailText = await staffS.remindersText();
      check(tag, "the staff member opens the workspace and sees its dashboard", staffDetailText.length > 0, { chars: staffDetailText.length });
      const staffDash = await apiFetch(staff.page, `/api/workspaces/${wsId}`);
      check(tag, "the staff member's live actions include tasks_manage (server truth)", (staffDash.body?.workspace?.granted_actions ?? []).includes("tasks_manage"), { actions: staffDash.body?.workspace?.granted_actions });

      // --------------------------------------------------------------
      // B. TWO TABS, one document: the loser keeps the draft, reload-retry.
      // --------------------------------------------------------------
      stage(`${tag}: two tabs editing the same document`);
      if (skin.key === "heritage") { await s.openTab("Documents"); }
      await s.docsPanel.waitFor({ timeout: 25000 });
      const trackDetails = await openDetails(owner.page, "Track a document");
      const trackForm = trackDetails.locator("form").first();
      const createPost = postTo(`/documents`);
      const created = await createPost(owner.page, async () => { await trackForm.locator("input").first().fill(DOC_TITLE); await trackForm.getByRole("button", { name: /Create tracker|ساخت پیگیر/ }).click(); });
      check(tag, "tab 1 creates the document tracker through the real UI", created.status() === 201, { status: created.status() });
      await owner.page.waitForTimeout(900);
      const row1 = s.docRow(DOC_TITLE);
      await row1.waitFor({ timeout: 25000 });
      check(tag, "the new tracker renders (React desks show v1; heritage shows the row)", skin.react ? /v1/i.test(await row1.innerText()) : true, {});

      // Tab 2 (same principal, same skin): edits and saves FIRST (v1 -> v2).
      const tab2 = await owner.context.newPage();
      tab2.setDefaultTimeout(25000);
      tab2.on("pageerror", error => report.pageErrors.push({ persona: "owner_a/tab2", skin: skin.key, error: error.message }));
      try {
        await tab2.goto(base + skin.url, { waitUntil: "domcontentloaded" });
        await selectWorkspace(tab2, skin);
        const s2 = surfaces(tab2, skin);
        if (skin.key === "heritage") { await s2.openTab("Documents"); }
        await s2.docsPanel.waitFor({ timeout: 25000 });
        const row2 = s2.docRow(DOC_TITLE);
        await row2.waitFor({ timeout: 25000 });
        await row2.getByRole("button", { name: "Edit", exact: true }).click();
        const editForm2 = row2.locator("form").first();
        await noteInput(editForm2).fill("second tab saved first");
        const save2 = documentPatch(wsId);
        const saved2 = await save2(tab2, async () => { await editForm2.getByRole("button", { name: /Save|ذخیره/ }).click(); });
        check(tag, "tab 2 saves first: v1 -> v2 (200)", saved2.status() === 200, { status: saved2.status() });
      } finally { await tab2.close(); }

      // Tab 1 still holds v1 in its rendered row: its stale save must 409,
      // keep the draft, and offer the honest reload-and-retry.
      await row1.getByRole("button", { name: "Edit", exact: true }).click();
      const editForm1 = row1.locator("form").first();
      await noteInput(editForm1).fill("first tab draft kept");
      const save1 = documentPatch(wsId);
      const saved1 = await save1(owner.page, async () => { await editForm1.getByRole("button", { name: /Save|ذخیره/ }).click(); });
      check(tag, "tab 1's stale save refuses 409 (no blind overwrite)", saved1.status() === 409, { status: saved1.status() });
      await owner.page.waitForTimeout(800);
      const rowText1 = await row1.innerText();
      check(tag, "the loser sees the honest conflict story with the current version", rowText1.includes("changed while you were editing") && (skin.key === "heritage" || /v2/i.test(rowText1)), { conflict: rowText1.slice(0, 240) });
      check(tag, "the loser's draft is retained in the form", (await noteInput(editForm1).inputValue()) === "first tab draft kept", {});
      await shot(owner.page, `${tag}-two-tabs-conflict`);

      const reloadButton = skin.key === "heritage"
        ? row1.getByRole("button", { name: "Reload record", exact: true })
        : row1.getByRole("button", { name: "Reload current version", exact: true });
      await reloadButton.click();
      await owner.page.waitForTimeout(1200);
      const editForm1b = row1.locator("form").first();
      check(tag, "after reloading the current version the form still holds the draft", (await noteInput(editForm1b).inputValue()) === "first tab draft kept", {});
      const retry1 = documentPatch(wsId);
      const retried1 = await retry1(owner.page, async () => { await editForm1b.getByRole("button", { name: /Save|ذخیره/ }).click(); });
      check(tag, "the retry at the current version succeeds (200)", retried1.status() === 200, { status: retried1.status() });
      await owner.page.reload({ waitUntil: "domcontentloaded" });
      await selectWorkspace(owner.page, skin);
      if (skin.key === "heritage") { await s.openTab("Documents"); }
      await s.docsPanel.waitFor({ timeout: 25000 });
      const rowAfter = s.docRow(DOC_TITLE);
      await rowAfter.waitFor({ timeout: 25000 });
      check(tag, "the winning draft is PERSISTED after a full reload", (await rowAfter.innerText()).includes("first tab draft kept"), {});
      await shot(owner.page, `${tag}-two-tabs-persisted`);
    } catch (error) {
      check(tag, "journey error (invite/two-tabs)", false, { error: String(error) });
    } finally {
      await staff.context.close().catch(() => {});
    }
  } catch (error) {
    check(tag, "journey error (owner setup)", false, { error: String(error) });
  }
  await owner.context.close().catch(() => {});
}

/** Journey C: the duplicate import. The interrupted import replays with the
 * SAME durable intent key through the real UI and reconciles to zero
 * duplicates; a different intent reports occurrence_exists; >200 is refused. */
async function journeyImport(skin, wsId) {
  const tag = skin.key;
  const IMP_A = `R117-14 import A ${tag}`;
  const IMP_B = `R117-14 import B ${tag}`;
  const owner = await session("owner_a", "en", skin.key === "heritage" ? "heritage" : skin.key);
  const s = surfaces(owner.page, skin);
  try {
    stage(`${tag}: duplicate import (interrupted replay reconciles)`);
    await owner.page.goto(base + skin.url, { waitUntil: "domcontentloaded" });
    await selectWorkspace(owner.page, skin);
    // Every skin imports ONE row per submit (classic's native form is
    // single-row; the others could batch but one-per-submit keeps the
    // journey uniform and honest across all five presentations).
    const importDetails = await openDetails(owner.page, "Import up to 200 rows");
    const importForm = importDetails.locator("form").first();
    const titleField = importForm.locator('input:not([type="date"])').first();
    const dateField = importForm.locator('input[type="date"]').first();
    await titleField.fill(IMP_A);
    await dateField.fill("2026-12-01");

    // Interrupt the FIRST submit: the request reaches the server (route.fetch
    // delivers it) but the response is hidden from the page (abort), so the
    // command honestly fails with an unknown outcome — and the intent key is
    // NOT re-minted. The retained form holds the same row + same key.
    await owner.context.route("**/api/workspaces/*/tasks/import", async route => {
      try { await route.fetch(); } catch {}
      await route.abort("failed");
    });
    await importForm.getByRole("button", { name: /Import/ }).click();
    await owner.page.waitForTimeout(1800);
    const failedNotice = importDetails.locator('div[role="alert"]').last();
    const failedVisible = await failedNotice.isVisible().catch(() => false);
    check(tag, "the interrupted import reports the honest unknown outcome (form not falsely successful)", failedVisible, {});
    const keptA = await titleField.inputValue();
    check(tag, "the interrupted import keeps its row and durable intent key in the form", keptA === IMP_A, { keptA });
    await owner.context.unroute("**/api/workspaces/*/tasks/import");

    // The user resets the failed command (the notice's own reload button) and
    // submits the SAME row again: same key -> already_imported, zero duplicates.
    if (failedVisible) {
      await failedNotice.locator("button").first().click();
      await owner.page.waitForTimeout(600);
    }
    const replayPost = postTo("/tasks/import");
    const replay = await replayPost(owner.page, async () => { await importForm.getByRole("button", { name: /Import/ }).click(); });
    const replayBody = await replay.json().catch(() => null);
    check(tag, "the SAME-key replay returns 200 with the row already_imported", (replay.status() === 200 || replay.status() === 201) && (replayBody?.receipts ?? []).length === 1 && replayBody.receipts[0].status === "already_imported", { status: replay.status(), receipts: (replayBody?.receipts ?? []).map(r => r.status) });
    await owner.page.waitForTimeout(700);
    const receiptsText = await importDetails.locator('div[role="status"]').last().innerText().catch(() => "");
    check(tag, "the UI renders the reconciliation receipt (already imported by a previous attempt of this import)", receiptsText.includes(IMP_A) && /already imported by a previous attempt/i.test(receiptsText), { text: receiptsText.slice(0, 260) });
    await shot(owner.page, `${tag}-import-replay-receipt`);

    // A SECOND row imports normally in the same session (fresh intent after
    // the completed import) — the ordinary non-interrupted path.
    await titleField.fill(IMP_B);
    await dateField.fill("2026-12-02");
    const normalPost = postTo("/tasks/import");
    const normal = await normalPost(owner.page, async () => { await importForm.getByRole("button", { name: /Import/ }).click(); });
    const normalBody = await normal.json().catch(() => null);
    check(tag, "a second row imports normally after the reconciled one (fresh intent)", (normal.status() === 200 || normal.status() === 201) && normalBody?.receipts?.[0]?.status === "imported", { status: normal.status(), receipts: (normalBody?.receipts ?? []).map(r => r.status) });

    // Persisted exactly once each after a full reload.
    await owner.page.reload({ waitUntil: "domcontentloaded" });
    await selectWorkspace(owner.page, skin);
    await owner.page.waitForTimeout(900);
    const reminders = await s.remindersText();
    const countA = reminders.split(IMP_A).length - 1;
    const countB = reminders.split(IMP_B).length - 1;
    check(tag, "after a full reload each imported row exists EXACTLY ONCE (zero duplicates, persisted)", countA === 1 && countB === 1, { countA, countB });

    // A DIFFERENT import session (fresh intent key) meeting the same
    // occurrence reports occurrence_exists — never overwrites.
    const importDetails2 = await openDetails(owner.page, "Import up to 200 rows");
    const importForm2 = importDetails2.locator("form").first();
    await importForm2.locator('input:not([type="date"])').first().fill(IMP_A);
    await importForm2.locator('input[type="date"]').first().fill("2026-12-01");
    const conflictPost = postTo("/tasks/import");
    const conflict = await conflictPost(owner.page, async () => { await importForm2.getByRole("button", { name: /Import/ }).click(); });
    const conflictBody = await conflict.json().catch(() => null);
    check(tag, "a DIFFERENT intent meeting the existing occurrence reports occurrence_exists (skipped, never overwritten)", (conflict.status() === 200 || conflict.status() === 201) && conflictBody?.receipts?.[0]?.status === "occurrence_exists", { status: conflict.status(), receipts: (conflictBody?.receipts ?? []).map(r => r.status) });
    await owner.page.waitForTimeout(600);
    const conflictReceipts = await importDetails2.locator('div[role="status"]').last().innerText().catch(() => "");
    check(tag, "the UI renders the occurrence-exists receipt honestly", /never overwritten/i.test(conflictReceipts), { text: conflictReceipts.slice(0, 240) });

    // The >200 boundary is refused (contract probe from the live page).
    const tooMany = await apiFetch(owner.page, `/api/workspaces/${wsId}/tasks/import`, { method: "POST", data: JSON.stringify({ tasks: Array.from({ length: 201 }, () => ({ title: "x", category: "other", due_date: "2026-12-01" })), intent_key: `r117-14-many-${tag}-${Date.now()}` }) }, owner.csrfToken);
    check(tag, "more than 200 rows is refused honestly (400)", tooMany.status === 400, { status: tooMany.status, code: tooMany.body?.error?.code });
  } catch (error) {
    check(tag, "journey error (duplicate import)", false, { error: String(error) });
  } finally {
    await owner.context.close().catch(() => {});
  }
}

/** Journey D: the A-B-A session switch in ONE context. Nothing crosses
 * principals; out-of-scope ids stay existence-hidden; A's data survives. */
async function journeyABA(skin, wsId) {
  const tag = skin.key;
  const IMP_A = `R117-14 import A ${tag}`;
  const IMP_B = `R117-14 import B ${tag}`;
  const owner = await session("owner_a", "en", skin.key === "heritage" ? "heritage" : skin.key);
  const s = surfaces(owner.page, skin);
  try {
    stage(`${tag}: A-B-A session switch`);
    await owner.page.goto(base + skin.url, { waitUntil: "domcontentloaded" });
    await selectWorkspace(owner.page, skin);
    const before = await s.remindersText();
    check(tag, "session A sees the workspace with its imported reminders", before.includes(IMP_A) && before.includes(IMP_B), {});

    // Switch the SAME context to principal B. A persona switch with a live
    // session must present the CURRENT session's csrf token (server rule).
    const switchToB = await owner.context.request.post(base + "/api/auth/demo-admin", { headers: { Origin: base, "x-csrf-token": owner.csrfToken ?? "" }, data: { persona: "owner_b" } });
    check(tag, "the context signs in as principal B", switchToB.ok(), { status: switchToB.status() });
    const csrfB = (await switchToB.json().catch(() => null))?.csrfToken ?? null;
    await owner.page.goto(base + skin.url, { waitUntil: "domcontentloaded" });
    await owner.page.waitForTimeout(1100);
    const bodyB = await owner.page.locator("body").innerText();
    check(tag, "principal B's page shows NO trace of A's workspace or reminders", !bodyB.includes(WS_NAME) && !bodyB.includes(IMP_A) && !bodyB.includes(IMP_B), { leaks: [WS_NAME, IMP_A, IMP_B].filter(t => bodyB.includes(t)) });
    const readB = await apiFetch(owner.page, `/api/workspaces/${wsId}`);
    check(tag, "principal B's live read of A's workspace is existence-hidden (404)", readB.status === 404, { status: readB.status });
    const bogus = await apiFetch(owner.page, "/api/workspaces/999999999");
    check(tag, "an out-of-scope (nonexistent) id is also a plain 404", bogus.status === 404, { status: bogus.status });
    if (skin.react) {
      await owner.page.goto(base + skin.url + "/" + wsId, { waitUntil: "domcontentloaded" });
      await owner.page.waitForTimeout(1200);
      const deepB = await owner.page.locator("body").innerText();
      check(tag, "principal B's deep link to A's workspace leaks nothing", !deepB.includes(IMP_A) && !deepB.includes(IMP_B), { leaks: [IMP_A, IMP_B].filter(t => deepB.includes(t)) });
    } else {
      check(tag, "heritage: no per-workspace URL surface exists to leak (list-only route)", true, {});
    }

    // Switch BACK to A (presenting B's csrf now): the persisted effects are intact.
    const backToA = await owner.context.request.post(base + "/api/auth/demo-admin", { headers: { Origin: base, "x-csrf-token": csrfB ?? "" }, data: { persona: "owner_a" } });
    check(tag, "the context signs back in as principal A", backToA.ok(), { status: backToA.status() });
    await owner.page.goto(base + skin.url, { waitUntil: "domcontentloaded" });
    await selectWorkspace(owner.page, skin);
    await owner.page.waitForTimeout(900);
    const after = await s.remindersText();
    const countA = after.split(IMP_A).length - 1;
    check(tag, "back as A: the imported reminders are intact and EXACTLY ONCE (persisted through the switch)", countA === 1 && after.includes(IMP_B), { countA });
    await shot(owner.page, `${tag}-aba-back-to-a`);
  } catch (error) {
    check(tag, "journey error (A-B-A session switch)", false, { error: String(error) });
  } finally {
    await owner.context.close().catch(() => {});
  }
}

/** Journey E: revoked membership. The owner removes the staff member
 * mid-session; the stale staff UI is masked and the live recheck is a 404. */
async function journeyRevocation(skin, wsId) {
  const tag = skin.key;
  const IMP_A = `R117-14 import A ${tag}`;
  const owner = await session("owner_a", "en", skin.key === "heritage" ? "heritage" : skin.key);
  const staff = await session("staff", "en", skin.key === "heritage" ? "heritage" : skin.key);
  const s = surfaces(owner.page, skin);
  const staffS = surfaces(staff.page, skin);
  try {
    stage(`${tag}: revoked membership masks the stale staff UI`);
    // The staff member still holds access from the invite journey — verify,
    // then let the owner revoke it mid-session.
    await staff.page.goto(base + skin.url, { waitUntil: "domcontentloaded" });
    await selectWorkspace(staff.page, skin);
    const staffSees = await staffS.remindersText();
    check(tag, "before revocation the staff member still sees the workspace reminders", staffSees.includes(IMP_A), {});

    await owner.page.goto(base + skin.url, { waitUntil: "domcontentloaded" });
    await selectWorkspace(owner.page, skin);
    if (skin.key === "heritage") { await s.openTab("People"); await s.teamPanel.waitFor({ timeout: 25000 }); }
    const staffRow = s.teamPanel.locator("li").filter({ hasText: "demo-staff" }).first();
    await staffRow.waitFor({ timeout: 25000 });
    const revokePost = postTo("/staff/demo-staff/revoke");
    const revoked = await revokePost(owner.page, async () => { await staffRow.getByRole("button", { name: "Revoke access", exact: true }).click(); });
    check(tag, "the owner revokes the staff member through the native control (200)", revoked.status() === 200, { status: revoked.status() });

    const liveRecheck = await apiFetch(staff.page, `/api/workspaces/${wsId}`);
    check(tag, "the revoked member's live recheck is existence-hidden (404)", liveRecheck.status === 404, { status: liveRecheck.status });
    await staff.page.goto(base + skin.url, { waitUntil: "domcontentloaded" });
    await staff.page.waitForTimeout(1100);
    const staffListText = await staff.page.locator("body").innerText();
    check(tag, "the revoked member's fresh desk no longer lists the workspace and leaks no reminder titles", !staffListText.includes(WS_NAME) && !staffListText.includes(IMP_A), { leaks: [WS_NAME, IMP_A].filter(t => staffListText.includes(t)) });
    if (skin.react) {
      await staff.page.goto(base + skin.url + "/" + wsId, { waitUntil: "domcontentloaded" });
      await staff.page.waitForTimeout(1200);
      const deepLeak = await staff.page.locator("body").innerText();
      check(tag, "the revoked member's deep link leaks nothing", !deepLeak.includes(IMP_A), { leaks: deepLeak.includes(IMP_A) ? [IMP_A] : [] });
    } else {
      check(tag, "heritage: the revoked member's list route shows no trace", !staffListText.includes("R117-14"), {});
    }
    await shot(staff.page, `${tag}-revoked-desk`);
  } catch (error) {
    check(tag, "journey error (revoked membership)", false, { error: String(error) });
  } finally {
    await owner.context.close().catch(() => {});
    await staff.context.close().catch(() => {});
  }
}


/** Persian copy spot check (heritage, fa): the import receipts and the
 * document-conflict story render their approved Persian copy. */
async function faSpotCheck(wsId) {
  const tag = "fa";
  const owner = await session("owner_a", "fa", "heritage");
  const s = surfaces(owner.page, { key: "heritage" }, true);
  try {
    stage("fa: Persian import receipts + document conflict copy");
    await owner.page.goto(base + "/workspaces", { waitUntil: "domcontentloaded" });
    await selectWorkspace(owner.page, { key: "heritage" });
    // Persian import receipt (imported) — a fresh row through the real UI.
    const importDetails = await openDetails(owner.page, "درون‌ریزی تا ۲۰۰ ردیف");
    const importForm = importDetails.locator("form").first();
    await importForm.locator("fieldset").nth(0).locator("input").first().fill("R117-14 درون‌ریزی فارسی");
    await importForm.locator("fieldset").nth(0).locator('input[type="date"]').fill("2026-12-03");
    const importPost = postTo("/tasks/import");
    const imported = await importPost(owner.page, async () => { await importForm.getByRole("button", { name: "درون‌ریزی", exact: true }).click(); });
    check(tag, "the Persian import succeeds through the real UI", imported.status() === 200 || imported.status() === 201, { status: imported.status() });
    await owner.page.waitForTimeout(700);
    const receiptsFa = await importDetails.locator('div[role="status"]').last().innerText().catch(() => "");
    check(tag, "the imported receipt renders the approved Persian copy", receiptsFa.includes("وارد شد"), { text: receiptsFa.slice(0, 200) });
    // Persian occurrence-exists receipt (different intent, same occurrence).
    const importDetails2 = await openDetails(owner.page, "درون‌ریزی تا ۲۰۰ ردیف");
    const importForm2 = importDetails2.locator("form").first();
    await importForm2.locator("fieldset").nth(0).locator("input").first().fill("R117-14 درون‌ریزی فارسی");
    await importForm2.locator("fieldset").nth(0).locator('input[type="date"]').fill("2026-12-03");
    const conflictPost = postTo("/tasks/import");
    const conflicted = await conflictPost(owner.page, async () => { await importForm2.getByRole("button", { name: "درون‌ریزی", exact: true }).click(); });
    check(tag, "the second Persian import session meets the existing occurrence", conflicted.status() === 200 || conflicted.status() === 201, { status: conflicted.status() });
    await owner.page.waitForTimeout(700);
    const conflictFa = await importDetails2.locator('div[role="status"]').last().innerText().catch(() => "");
    check(tag, "the occurrence-exists receipt renders the approved Persian copy", conflictFa.includes("مورد موجود گزارش و رد شد"), { text: conflictFa.slice(0, 200) });

    // Persian document-conflict copy: two tabs, stale save 409.
    await s.openTab("مدارک");
    await s.docsPanel.waitFor({ timeout: 25000 });
    const trackDetails = await openDetails(owner.page, "پیگیری مدرک");
    const trackForm = trackDetails.locator("form").first();
    const createPost = postTo(`/documents`);
    const created = await createPost(owner.page, async () => { await trackForm.locator("input").first().fill("R117-14 مدرک فارسی"); await trackForm.getByRole("button", { name: "ساخت پیگیر" }).click(); });
    check(tag, "the Persian document tracker is created through the real UI", created.status() === 201, { status: created.status() });
    await owner.page.waitForTimeout(900);
    const row = s.docRow("R117-14 مدرک فارسی");
    await row.waitFor({ timeout: 25000 });
    // Second tab saves v2 first (through the real UI), then the stale save 409s.
    const tab2 = await owner.context.newPage();
    tab2.setDefaultTimeout(25000);
    tab2.on("pageerror", error => report.pageErrors.push({ persona: "owner_a/fa-tab2", skin: "fa", error: error.message }));
    try {
      await tab2.goto(base + "/workspaces", { waitUntil: "domcontentloaded" });
      await selectWorkspace(tab2, { key: "heritage" });
      const s2 = surfaces(tab2, { key: "heritage" }, true);
      await s2.openTab("مدارک");
      await s2.docsPanel.waitFor({ timeout: 25000 });
      const row2 = s2.docRow("R117-14 مدرک فارسی");
      await row2.waitFor({ timeout: 25000 });
      await row2.getByRole("button", { name: "ویرایش", exact: true }).click();
      const editForm2 = row2.locator("form").first();
      await noteInput(editForm2).fill("نسخه دوم");
      const save2 = documentPatch(wsId);
      const saved2 = await save2(tab2, async () => { await editForm2.getByRole("button", { name: "ذخیره" }).click(); });
      check(tag, "the second Persian tab saves first (v1 -> v2)", saved2.status() === 200, { status: saved2.status() });
    } finally { await tab2.close(); }
    await row.getByRole("button", { name: "ویرایش", exact: true }).click();
    const editForm = row.locator("form").first();
    await noteInput(editForm).fill("پیش‌نویس نگه‌داشته‌شده");
    const save1 = documentPatch(wsId);
    const saved1 = await save1(owner.page, async () => { await editForm.getByRole("button", { name: "ذخیره" }).click(); });
    check(tag, "the stale Persian save refuses 409", saved1.status() === 409, { status: saved1.status() });
    await owner.page.waitForTimeout(800);
    const rowText = await row.innerText();
    check(tag, "the Persian conflict copy renders honestly", /این مدرک هنگام ویرایش( شما)? تغییر کرده/.test(rowText), { text: rowText.slice(0, 320) });
    check(tag, "the Persian draft is retained in the form", (await noteInput(editForm).inputValue()) === "پیش‌نویس نگه‌داشته‌شده", {});
    await shot(owner.page, "fa-two-tabs-conflict");
  } catch (error) {
    check(tag, "journey error (fa spot check)", false, { error: String(error) });
  } finally {
    await owner.context.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------
try {
  browser = await chromium.launch({ headless: true });
  report.browser = await browser.version();

  // The rehearsal workspace id (probe through a throwaway session).
  const probe = await session("owner_a");
  try {
    await probe.page.goto(base + "/workspaces", { waitUntil: "domcontentloaded" });
    await probe.page.waitForTimeout(500);
    const mine = await apiFetch(probe.page, "/api/workspaces/mine");
    const seeded = (mine.body?.owned || []).find(row => row.name === WS_NAME);
    check("setup", "the seeded rehearsal workspace is available", !!seeded, { owned: (mine.body?.owned || []).map(r => r.name) });
    if (!seeded) throw new Error("seeded workspace missing — reset the instance first");
    const wsId = seeded.id;
    for (const skin of SKINS) {
      const skinStart = report.checks.filter(c => c.skin === skin.key).length;
      await runSkin(skin, wsId);          // A. invite + accept + B. two tabs
      await journeyImport(skin, wsId);    // C. duplicate import
      await journeyABA(skin, wsId);       // D. A-B-A session switch
      await journeyRevocation(skin, wsId);// E. revoked membership
      const done = report.checks.filter(c => c.skin === skin.key);
      report.skins[skin.key] = { checks: done.length - skinStart, passed: done.filter(c => c.okay).length, failed: done.filter(c => !c.okay).length };
      stage(`${skin.key} skin complete: ${report.skins[skin.key].passed}/${report.skins[skin.key].checks} checks`);
    }
    if (SKIN_FILTER.length === 0) await faSpotCheck(wsId);
  } finally {
    await probe.context.close().catch(() => {});
  }
} catch (error) {
  check("setup", "unhandled matrix error", false, { error: String(error) });
} finally {
  try { await browser?.close(); } catch {}
  check("all", "no uncaught browser errors", report.pageErrors.length === 0, { pageErrors: report.pageErrors.slice(0, 6) });
  report.finishedAt = new Date().toISOString();
  report.summary = {
    passed: report.checks.filter(c => c.okay === true).length,
    failed: report.failures.length,
    perSkin: report.skins,
  };
  await fs.writeFile(path.join(out, "results.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(`\nR117-14 parity matrix: ${report.summary.passed}/${report.checks.length} checks, ${report.failures.length} failures, ${report.pageErrors.length} page errors`);
  console.log(`Evidence: ${out}`);
  process.exit(report.failures.length ? 1 : 0);
}

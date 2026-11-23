/** R117-18 real-app PRIVACY OPERATOR matrix — the subject redaction queue
 * (decision vs the separate audited execution) across ALL FIVE skins on the
 * named synthetic loopback instance (per the Master AI R117 handoff D43,
 * ticket actions 2-3). Closes the privacy.fulfill PARITY_ACCEPTANCE.csv rows
 * per skin on real-stack persisted evidence:
 *   QUEUE  — the subject (owner_a) files a redaction request through the real
 *            API; the operator queue in the skin shows the row "received"
 *            with the honest "Awaiting decision" fulfillment indicator.
 *   GRANT  — the operator grants through the real UI: the row indicator
 *            becomes "Granted — not yet executed". A grant is a decision,
 *            NEVER an execution (the core acceptance pin).
 *   FULFILL— the separate audited executor runs through the real UI: the
 *            indicator becomes "Executed — receipt recorded" and the stored
 *            receipt is visible.
 *   RELOAD — after a FULL page reload the completed state persists, driven
 *            by the executor's receipt (never by the decision grant).
 *   REFUSE1— an untargeted request (no service request) refuses the grant
 *            honestly: redaction_scope_unresolved surfaces in the UI.
 *   REFUSE2— a request under an ACTIVE hold refuses the grant honestly:
 *            grant_blocked_by_hold surfaces in the UI (release first).
 * Shared (heritage fa session): the Persian operator copy renders (صف حذف +
 * مصوب — هنوز اجرا نشده indicator).
 *
 * Loopback synthetic demo only (no live tenant). Boot:
 *   python tools/create-demo-database.py --output data/demo/r117-18-privacy.sqlite
 *   npm run dev:demo -- data/demo/r117-18-privacy.sqlite
 * then:
 *   UI_PLAYWRIGHT_MODULE=/home/z/.npm-global/lib/node_modules/playwright \
 *   node tools/test-r117-18-privacy-matrix.mjs
 */
import fs from "node:fs/promises";
import path from "node:path";
const base = process.env.UI_BASE_URL || "http://127.0.0.1:3000";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(base).hostname)) throw new Error("Local synthetic demo only.");
const playwrightModule = await import((process.env.UI_PLAYWRIGHT_MODULE || "playwright").replace(/\/$/, "") + "/index.mjs");
const chromium = playwrightModule.chromium ?? playwrightModule.default?.chromium;
const out = path.resolve(process.env.UI_EVIDENCE_DIR || "review-r117/evidence-local/privacy-matrix");
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

const ADMIN = "admin";       // the demo administrator persona (role admin)
const SUBJECT = "owner_a";   // the demo owner persona — the data subject

/** The floating demo-persona picker is a demo affordance that can overlap
 * workflow controls; it is not part of this journey — remove it. */
const hideDemoPicker = (page) => page.evaluate(() => { document.querySelectorAll(".demo-session-picker").forEach(el => { el.style.display = "none"; }); }).catch(() => {});

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

/** The classic frontend renders inside a same-origin iframe — return its frame. */
async function classicFrame(page) {
  for (let i = 0; i < 40; i++) {
    const frame = page.frames().find(f => f !== page.mainFrame() && f.url().includes("/classic-registry/"));
    if (frame) {
      try { await frame.waitForSelector("#app", { timeout: 2000 }); return frame; } catch { /* retry */ }
    }
    await page.waitForTimeout(300);
  }
  throw new Error("classic-registry iframe did not become ready");
}

/** Same-origin fetch from a live page (cookies + csrf). */
const apiFetch = (page, pathn, init = {}, csrfToken = null) => page.evaluate(async ({ pathn, init, origin, csrfToken }) => {
  const { data, ...rest } = init || {};
  const response = await fetch(new URL(pathn, origin).href, { ...rest, body: data, headers: { ...(init?.headers || {}), "content-type": "application/json", ...(csrfToken ? { "x-csrf-token": csrfToken } : {}) }, credentials: "same-origin" });
  let body = null; try { body = await response.json(); } catch {}
  return { status: response.status, body };
}, { pathn, init, origin: base, csrfToken });

/** Per-skin operator surfaces. Every driver targets the SAME shared
 * data-surface markers the native sections carry. */
const SKINS = [
  {
    key: "heritage", url: "/admin", hashApp: false,
    open: async (target) => {
      await target.locator("[data-surface='privacy-redaction-desk']").scrollIntoViewIfNeeded();
      await target.locator("[data-surface='privacy-redaction-rows']").waitFor({ state: "visible" });
    },
    noteInput: (target, id) => target.locator(`[data-request-id='${id}'] input[aria-label='Operator note']`),
    grant: (target, id) => target.locator(`[data-request-id='${id}'] button`, { hasText: /Grant decision|تصمیم به تأیید/ }).click(),
    fulfill: (target, id) => target.locator(`[data-request-id='${id}'] button`, { hasText: /Execute redaction|اجرای حذف/ }).click(),
    rowIndicator: (target, id) => target.locator(`[data-request-id='${id}'] [data-surface='privacy-fulfillment-indicator']`),
    outcome: (target) => target.locator("[data-surface='privacy-command-outcome']"),
  },
  {
    key: "equidata-elite", url: "/f/equidata-elite/governance", hashApp: false,
    open: async (target) => {
      await target.locator("[data-surface='privacy-redaction-desk'], .hdb-gov-privacy").first().scrollIntoViewIfNeeded();
      await target.locator("[data-surface='privacy-redaction-rows']").waitFor({ state: "visible" });
    },
    noteInput: (target, id) => target.locator(`[data-request-id='${id}'] input[aria-label='Operator note']`),
    grant: (target, id) => target.locator(`[data-request-id='${id}'] button`, { hasText: /Grant decision|تصمیم به تأیید/ }).click(),
    fulfill: (target, id) => target.locator(`[data-request-id='${id}'] button`, { hasText: /Execute redaction|اجرای حذف/ }).click(),
    rowIndicator: (target, id) => target.locator(`[data-request-id='${id}'] [data-surface='privacy-fulfillment-indicator']`),
    outcome: (target) => target.locator("[data-surface='privacy-command-outcome']"),
  },
  {
    key: "fei-classic", url: "/f/fei-classic/management", hashApp: false,
    open: async (target) => {
      await target.locator("[data-surface='privacy-redaction-rows']").scrollIntoViewIfNeeded();
      await target.locator("[data-surface='privacy-redaction-rows']").waitFor({ state: "visible" });
    },
    // FEI carries ONE shared note input under the table.
    noteInput: (target) => target.locator("input[aria-label='Operator note']"),
    grant: (target, id) => target.locator(`tr[data-request-id='${id}'] button`, { hasText: /Grant decision|تصمیم به تأیید/ }).click(),
    fulfill: (target, id) => target.locator(`tr[data-request-id='${id}'] button`, { hasText: /Execute redaction|اجرای حذف/ }).click(),
    rowIndicator: (target, id) => target.locator(`tr[data-request-id='${id}'] [data-surface='privacy-fulfillment-indicator']`),
    outcome: (target) => target.locator("[data-surface='privacy-command-outcome']"),
  },
  {
    key: "retro-astra", url: "/f/retro-astra/collections/governance", hashApp: false,
    open: async (target) => {
      await target.locator("[data-surface='privacy-redaction-desk']").scrollIntoViewIfNeeded();
      await target.locator("[data-surface='privacy-redaction-rows']").waitFor({ state: "visible" });
    },
    noteInput: (target, id) => target.locator(`[data-request-id='${id}'] input`),
    grant: (target, id) => target.locator(`[data-request-id='${id}'] button`, { hasText: /Grant decision|تصمیم به تأیید/ }).click(),
    fulfill: (target, id) => target.locator(`[data-request-id='${id}'] button`, { hasText: /Execute redaction|اجرای حذف/ }).click(),
    rowIndicator: (target, id) => target.locator(`[data-request-id='${id}'] [data-surface='privacy-fulfillment-indicator']`),
    outcome: (target) => target.locator("[data-surface='privacy-command-outcome']"),
  },
  {
    key: "classic-registry", url: "/f/classic-registry/#/admin?tab=privacy", hashApp: true,
    open: async (target) => {
      await target.evaluate(() => { location.hash = "#/admin?tab=privacy"; });
      await target.locator("[data-surface='privacy-redaction-rows']").waitFor({ state: "visible" });
    },
    noteInput: null, // the decision note lives in the modal form
    grant: async (target, id) => {
      await target.locator(`tr[data-request-id='${id}'] [data-action='privacy-decide']`).click();
      await target.locator("#privacy-decide-form [name='note']").fill("The operator verified the exact subject scope before approving.");
      await target.locator("[data-action='submit-privacy-decide']").click();
      await target.waitForLoadState("load").catch(() => {});
      await target.locator("[data-surface='privacy-redaction-rows']").waitFor({ state: "visible" });
    },
    fulfill: async (page, id, target) => {
      // The classic executor confirm rides a native prompt — accept it.
      page.once("dialog", dialog => dialog.accept("Executed against the approved scope after verification.").catch(() => {}));
      await target.locator(`tr[data-request-id='${id}'] [data-action='privacy-fulfill']`).click();
      await target.waitForLoadState("load").catch(() => {});
      await target.locator("[data-surface='privacy-redaction-rows']").waitFor({ state: "visible" });
    },
    rowIndicator: (target, id) => target.locator(`tr[data-request-id='${id}'] [data-surface='privacy-fulfillment-indicator']`),
    outcome: () => null, // classic toasts the honest refusal message
  },
];

/** The subject files one targeted + one untargeted request (unique note per
 * skin); returns their ids. */
async function subjectFiles(skinKey) {
  const ctx = await session(SUBJECT, "en");
  const { page, csrfToken } = ctx;
  try {
    await page.goto(base + "/", { waitUntil: "domcontentloaded" });
    const mine = await apiFetch(page, "/api/service-requests/mine");
    const withNote = (mine.body?.requests ?? []).find(request => request.note && request.is_requester_view);
    if (!withNote) throw new Error("The demo subject owns no service request with a note");
    const stamp = Date.now().toString(36);
    const targeted = await apiFetch(page, "/api/privacy/redaction-requests", { method: "POST", data: JSON.stringify({
      data_category: "service_request_notes", service_request_id: withNote.id,
      request_note: `R117-18 ${skinKey} targeted operator journey ${stamp}: please minimize this note.`,
    }) }, csrfToken);
    const untargeted = await apiFetch(page, "/api/privacy/redaction-requests", { method: "POST", data: JSON.stringify({
      data_category: "service_request_notes", service_request_id: null,
      request_note: `R117-18 ${skinKey} untargeted scope refusal journey ${stamp}.`,
    }) }, csrfToken);
    return { serviceRequestId: withNote.id, targetedId: targeted.body?.request_id ?? null, untargetedId: untargeted.body?.request_id ?? null };
  } finally {
    await ctx.context.close();
  }
}

async function perSkinJourney(skin) {
  stage(`skin ${skin.key}`);
  const filed = await subjectFiles(skin.key);
  if (!filed.targetedId || !filed.untargetedId) throw new Error(`subject filing failed for ${skin.key}`);
  const ctx = await session(ADMIN, "en");
  const { page, csrfToken } = ctx;
  let target = null;
  const openSurface = async () => {
    await page.goto(base + skin.url, { waitUntil: "domcontentloaded" });
    // A same-URL navigation is hash-only (no reload) — the classic iframe
    // would keep its STALE queue DOM. Force a real document reload so every
    // open lands on fresh server state.
    if (skin.hashApp) await page.reload({ waitUntil: "domcontentloaded" });
    await hideDemoPicker(page);
    target = skin.hashApp ? await classicFrame(page) : page;
    await skin.open(target);
  };
  try {
    await openSurface();

    // ---- QUEUE: the filed rows render with the honest awaiting indicator ----
    await skin.rowIndicator(target, filed.targetedId).waitFor({ state: "visible" });
    const initial = (await skin.rowIndicator(target, filed.targetedId).innerText()).trim();
    check(skin.key, "QUEUE the targeted request renders 'Awaiting decision'", /awaiting decision|در انتظار تصمیم/i.test(initial), { initial });

    // ---- GRANT: a decision, never an execution ----
    if (skin.noteInput) await skin.noteInput(target, filed.targetedId).fill("The operator verified the exact subject scope before approving.");
    await skin.grant(target, filed.targetedId);
    await skin.rowIndicator(target, filed.targetedId).filter({ hasText: /Granted|مصوب/ }).first().waitFor({ state: "visible" });
    const grantedText = (await skin.rowIndicator(target, filed.targetedId).innerText()).trim();
    check(skin.key, "GRANT the row shows 'Granted — not yet executed' (a grant is not an execution)", /granted/i.test(grantedText) && /not yet executed|هنوز اجرا نشده/i.test(grantedText) && !/executed —|اجرا شد/i.test(grantedText), { grantedText });
    await shot(page, `${skin.key}-granted-not-executed`);

    // ---- FULFILL: the separate audited executor; the receipt drives completed ----
    if (skin.key === "classic-registry") await skin.fulfill(page, filed.targetedId, target);
    else await skin.fulfill(target, filed.targetedId);
    await skin.rowIndicator(target, filed.targetedId).filter({ hasText: /Executed|اجرا شد/ }).first().waitFor({ state: "visible" });
    const executedText = (await skin.rowIndicator(target, filed.targetedId).innerText()).trim();
    check(skin.key, "FULFILL the executor receipt drives the completed indicator", /executed — receipt recorded|اجرا شد — رسید ثبت شد/i.test(executedText), { executedText });
    const queueAfterFulfill = await apiFetch(page, "/api/admin/privacy/redaction-requests", {}, csrfToken);
    const row = (queueAfterFulfill.body?.requests ?? []).find(request => Number(request.id) === Number(filed.targetedId));
    check(skin.key, "FULFILL the server state carries the stored receipt (execution_status completed + receipt json)", row?.execution_status === "completed" && Boolean(row?.execution_receipt_json) && row?.redaction_completed === true, { execution_status: row?.execution_status });
    await shot(page, `${skin.key}-executed-receipt`);

    // ---- RELOAD: the receipt-driven status survives a FULL reload ----
    await openSurface();
    const reloadedText = (await skin.rowIndicator(target, filed.targetedId).innerText()).trim();
    check(skin.key, "RELOAD the completed state persists after a full reload (receipt-driven)", /executed — receipt recorded|اجرا شد — رسید ثبت شد/i.test(reloadedText), { reloadedText });
    await shot(page, `${skin.key}-reloaded`);

    // ---- REFUSE (untargeted): redaction_scope_unresolved surfaces honestly ----
    if (skin.key === "classic-registry") {
      await target.locator(`tr[data-request-id='${filed.untargetedId}'] [data-action='privacy-decide']`).click();
      await target.locator("#privacy-decide-form [name='note']").fill("An untargeted request cannot be approved without an exact scope.");
      page.once("pageerror", () => {});
      await target.locator("[data-action='submit-privacy-decide']").click();
      await target.waitForTimeout(1200);
      const refusalRow = await apiFetch(page, "/api/admin/privacy/redaction-requests", {}, csrfToken);
      const untargetedRow = (refusalRow.body?.requests ?? []).find(request => Number(request.id) === Number(filed.untargetedId));
      check(skin.key, "REFUSE the untargeted grant is refused honestly (scope unresolved, row unchanged)", untargetedRow?.status === "received" && untargetedRow?.execution_status == null, { status: untargetedRow?.status });
    } else {
      if (skin.noteInput) await skin.noteInput(target, filed.untargetedId).fill("An untargeted request cannot be approved without an exact scope.");
      await skin.grant(target, filed.untargetedId);
      await skin.outcome(target).filter({ hasText: /redaction_scope_unresolved/ }).first().waitFor({ state: "visible" });
      const outcomeText = (await skin.outcome(target).first().innerText()).trim();
      check(skin.key, "REFUSE the untargeted grant surfaces redaction_scope_unresolved in the UI", /redaction_scope_unresolved/.test(outcomeText), { outcomeText: outcomeText.slice(0, 140) });
    }
    await shot(page, `${skin.key}-untargeted-refusal`);

    // ---- REFUSE (active hold): grant_blocked_by_hold surfaces honestly ----
    const heldCtx = await session(SUBJECT, "en");
    const heldPage = heldCtx.page;
    try {
      await heldPage.goto(base + "/", { waitUntil: "domcontentloaded" });
      const heldFiling = await apiFetch(heldPage, "/api/privacy/redaction-requests", { method: "POST", data: JSON.stringify({
        data_category: "service_request_notes", service_request_id: filed.serviceRequestId,
        request_note: `R117-18 ${skin.key} held-scope refusal journey ${Date.now().toString(36)}.`,
      }) }, heldCtx.csrfToken);
      const heldId = heldFiling.body?.request_id;
      const placeHold = await apiFetch(page, `/api/admin/service-requests/${filed.serviceRequestId}/hold`, { method: "POST", data: JSON.stringify({ hold_kind: "dispute", reason: `R117-18 ${skin.key} matrix preservation hold.` }) }, csrfToken);
      check(skin.key, "HOLD the admin places an active hold through the audited path", placeHold.status === 201 || placeHold.status === 200, { status: placeHold.status });
      await openSurface();
      if (skin.key === "classic-registry") {
        await target.locator(`tr[data-request-id='${heldId}'] [data-action='privacy-decide']`).click();
        await target.locator("#privacy-decide-form [name='note']").fill("This grant must refuse while the preservation hold is active.");
        await target.locator("[data-action='submit-privacy-decide']").click();
        await target.waitForTimeout(1200);
        const queueHeld = await apiFetch(page, "/api/admin/privacy/redaction-requests", {}, csrfToken);
        const heldRow = (queueHeld.body?.requests ?? []).find(request => Number(request.id) === Number(heldId));
        check(skin.key, "HOLD the grant under an active hold is refused (row stays decidable)", heldRow?.status === "received" || heldRow?.status === "deferred_active_hold", { status: heldRow?.status });
      } else {
        if (skin.noteInput) await skin.noteInput(target, heldId).fill("This grant must refuse while the preservation hold is active.");
        await skin.grant(target, heldId);
        await skin.outcome(target).filter({ hasText: /grant_blocked_by_hold/ }).first().waitFor({ state: "visible" });
        const heldOutcome = (await skin.outcome(target).first().innerText()).trim();
        check(skin.key, "HOLD the grant under an active hold surfaces grant_blocked_by_hold in the UI", /grant_blocked_by_hold/.test(heldOutcome), { heldOutcome: heldOutcome.slice(0, 140) });
      }
      // Release the hold so later skins see the same clean baseline.
      const release = await apiFetch(page, `/api/admin/service-requests/${filed.serviceRequestId}/hold/release`, { method: "POST", data: JSON.stringify({ release_reason: `R117-18 ${skin.key} matrix hold released after the refusal check; retention may resume.` }) }, csrfToken);
      check(skin.key, "HOLD the hold is released through its own audited path (baseline restored)", release.status === 200 || release.status === 201, { status: release.status });
      await shot(page, `${skin.key}-held-refusal`);
    } finally {
      await heldCtx.context.close();
    }
  } finally {
    await ctx.context.close();
  }
}

/** Shared: the Persian operator copy renders on the heritage desk (fa). */
async function persianOperatorJourney() {
  stage("heritage fa operator");
  const filed = await subjectFiles("heritage-fa");
  const ctx = await session(ADMIN, "fa");
  const { page, csrfToken } = ctx;
  try {
    await page.goto(base + "/admin", { waitUntil: "domcontentloaded" });
    await hideDemoPicker(page);
    await page.locator("[data-surface='privacy-redaction-desk']").scrollIntoViewIfNeeded();
    await page.locator("[data-surface='privacy-redaction-rows']").waitFor({ state: "visible" });
    const deskText = await page.locator("[data-surface='privacy-redaction-desk']").innerText();
    check("heritage-fa", "FA the Persian operator copy renders (decision vs execution doctrine)", /صف حذف/.test(deskText) && /رسید/.test(deskText), { heading: deskText.slice(0, 120) });
    const row = page.locator(`[data-request-id='${filed.targetedId}'] input[aria-label='یادداشت اپراتور']`);
    await row.fill("اپراتور دامنه دقیق موضوع را پیش از تأیید بررسی کرد.");
    await page.locator(`[data-request-id='${filed.targetedId}'] button`, { hasText: /تصمیم به تأیید/ }).click();
    await page.locator(`[data-request-id='${filed.targetedId}'] [data-surface='privacy-fulfillment-indicator']`).filter({ hasText: /مصوب/ }).first().waitFor({ state: "visible" });
    const grantedFa = (await page.locator(`[data-request-id='${filed.targetedId}'] [data-surface='privacy-fulfillment-indicator']`).innerText()).trim();
    check("heritage-fa", "FA the granted row shows the honest Persian 'not yet executed' indicator", /مصوب — هنوز اجرا نشده/.test(grantedFa), { grantedFa });
    await shot(page, "heritage-fa-granted");
  } finally {
    await ctx.context.close();
  }
}

(async () => {
  const browserType = chromium;
  browser = await browserType.launch();
  report.browser = browserType.name();
  try {
    for (const skin of SKINS) await perSkinJourney(skin);
    await persianOperatorJourney();
  } finally {
    await browser.close();
  }
  report.finishedAt = new Date().toISOString();
  const failed = report.failures.length;
  await fs.writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  console.log(`\nPrivacy operator matrix: ${report.checks.length - failed}/${report.checks.length} checks passed; page errors: ${report.pageErrors.length}`);
  if (report.pageErrors.length) console.log(JSON.stringify(report.pageErrors, null, 2));
  if (failed) { console.log(JSON.stringify(report.failures, null, 2)); process.exit(1); }
})();

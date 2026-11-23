/** R117-17 real-app EDITORIAL matrix — the complete bilingual editorial
 * workflow (draft / preview / publish / retract / version-history) across ALL
 * FIVE skins on the named synthetic loopback instance (per the Master AI R117
 * handoff D26). Closes the news.publish PARITY_ACCEPTANCE.csv rows per skin
 * on real-stack persisted evidence:
 *   DRAFT  — the editor creates a staged bilingual draft through the real UI
 *            (complete English edition, empty Persian edition); language
 *            readiness and media-publication rights are shown as SEPARATE
 *            live indicators (EN complete · FA missing · No cover media).
 *   PREVIEW— the editor-only preview opens with the honest "unpublished"
 *            banner AND a noindex robots rule while open; the public list
 *            does NOT serve the draft (draft previews are never exposed
 *            through the public read routes).
 *   PUBLISH— the explicit human publish action serves the post publicly; the
 *            public projection reports language_completeness honestly (the
 *            English publication never claims a completed Persian
 *            translation).
 *   RETRACT— the explicit retract action removes the post from the public
 *            routes and the retraction stays visible after a FULL reload.
 *   HISTORY— the immutable version history records create / publish / retract
 *            with honest status pairs and the acting editor.
 * Shared (heritage fa session): the Persian reader shows the honest fallback
 * note ("translation not yet complete — the English original follows")
 * instead of silently presenting the English text as localized content.
 *
 * Loopback synthetic demo only (no live tenant). Boot:
 *   python tools/create-demo-database.py --output data/demo/r117-17-editorial.sqlite
 *   npm run dev:demo -- data/demo/r117-17-editorial.sqlite
 * then:
 *   UI_PLAYWRIGHT_MODULE=/home/z/.npm-global/lib/node_modules/playwright \
 *   node tools/test-r117-17-editorial-matrix.mjs
 */
import fs from "node:fs/promises";
import path from "node:path";
const base = process.env.UI_BASE_URL || "http://127.0.0.1:3000";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(base).hostname)) throw new Error("Local synthetic demo only.");
const playwrightModule = await import((process.env.UI_PLAYWRIGHT_MODULE || "playwright").replace(/\/$/, "") + "/index.mjs");
const chromium = playwrightModule.chromium ?? playwrightModule.default?.chromium;
const out = path.resolve(process.env.UI_EVIDENCE_DIR || "review-r117/evidence-local/editorial-matrix");
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

const EDITOR = "admin"; // the demo administrator persona (role admin -> content.manage)

/** The floating demo-persona picker is a demo affordance that can overlap
 * workflow controls; it is not part of this journey — remove it. */
const hideDemoPicker = (page) => page.evaluate(() => { document.querySelectorAll(".demo-session-picker").forEach(el => { el.style.display = "none"; }); }).catch(() => {});
async function reselect(skin, target, title) {
  if (skin.key === "heritage") await target.locator(".heritage-studio-queue-item", { hasText: title }).first().click();
  else if (skin.key === "equidata-elite") await target.locator(".edx-newsroom-queue-item", { hasText: title }).first().click();
  else if (skin.key === "fei-classic") await target.locator(".fei-content-admin-rows button", { hasText: title }).first().click();
  else if (skin.key === "retro-astra") await target.locator("tr", { hasText: title }).locator("button", { hasText: /Edit|ویرایش/ }).first().click();
  // classic-registry renders the row actions directly — no selection needed.
  await target.waitForTimeout(400);
}

/** Per-skin surfaces. `editor` describes how to drive the real editorial UI. */
const SKINS = [
  {
    key: "heritage", url: "/newsroom/studio", frontend: null,
    open: async (page) => {
      await page.locator("#heritage-news-editor").waitFor({ state: "visible" });
      await page.getByLabel("English title", { exact: true }).fill("");
    },
    fill: async (page, title, body) => {
      await page.getByLabel("English title", { exact: true }).fill(title);
      await page.getByLabel("English body", { exact: true }).fill(body);
    },
    readiness: "[data-surface='editorial-readiness']",
    saveButton: "Save post",
    workflow: "[data-surface='editorial-workflow']",
    previewSurface: "[data-surface='editorial-preview']",
    historySurface: "[data-surface='editorial-history']",
  },
  {
    key: "equidata-elite", url: "/f/equidata-elite/newsroom", frontend: null,
    open: async (page) => {
      await page.locator("#edx-news-editor").waitFor({ state: "visible" });
    },
    fill: async (page, title, body) => {
      await page.getByLabel("English title", { exact: true }).fill(title);
      await page.getByLabel("English body", { exact: true }).fill(body);
    },
    readiness: "[data-surface='editorial-readiness']",
    saveButton: "Save post",
    workflow: "[data-surface='editorial-workflow']",
    previewSurface: "[data-surface='editorial-preview']",
    historySurface: "[data-surface='editorial-history']",
  },
  {
    key: "fei-classic", url: "/f/fei-classic/management", frontend: null,
    open: async (page) => {
      await page.locator(".fei-content-admin-editor").waitFor({ state: "visible" });
    },
    fill: async (page, title, body) => {
      await page.getByLabel("English title", { exact: true }).fill(title);
      await page.getByLabel("English body", { exact: true }).fill(body);
    },
    readiness: "[data-surface='editorial-readiness']",
    saveButton: "Create post",
    workflow: "[data-surface='editorial-workflow']",
    previewSurface: "[data-surface='editorial-preview']",
    historySurface: "[data-surface='editorial-history']",
  },
  {
    key: "retro-astra", url: "/f/retro-astra/newsroom", frontend: null,
    open: async (page) => {
      await page.locator("#newsroom-editor").waitFor({ state: "visible" });
    },
    fill: async (page, title, body) => {
      await page.getByLabel("English title", { exact: true }).fill(title);
      await page.getByLabel("English body", { exact: true }).fill(body);
    },
    readiness: "[data-surface='editorial-readiness']",
    saveButton: "Save post",
    workflow: "[data-surface='editorial-workflow']",
    previewSurface: "[data-surface='editorial-preview']",
    historySurface: "[data-surface='editorial-history']",
  },
  {
    key: "classic-registry", url: "/f/classic-registry/#/admin?tab=content", frontend: null, hashApp: true,
    open: async (target) => {
      // The classic frontend renders inside an iframe — navigate its hash app
      // to the admin content tab and wait for the governed workflow buttons.
      await target.evaluate(() => { location.hash = "#/admin?tab=content"; });
      await target.locator("[data-action='add-content']").waitFor({ state: "visible" });
    },
    fill: async (target, title, body) => {
      await target.locator("[data-action='add-content']").click();
      await target.locator("#content-create-form [name='title_en']").fill(title);
      await target.locator("#content-create-form [name='body_en']").fill(body);
    },
    readiness: null,
    saveButton: null,
    workflow: null,
    previewSurface: "[data-surface='editorial-preview']",
    historySurface: "[data-surface='editorial-history']",
    modalSave: true,
  },
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

const publicSlugs = async (page) => {
  const list = await apiFetch(page, "/api/content/posts?limit=50");
  return (list.body?.posts ?? []).map(post => post.slug);
};

async function perSkinJourney(skin) {
  stage(`skin ${skin.key}`);
  const stamp = Date.now().toString(36);
  const title = `R117-17 Editorial Matrix ${skin.key} ${stamp}`;
  const ctx = await session(EDITOR, "en");
  const { page, csrfToken } = ctx;
  // The classic frontend renders inside a same-origin iframe — every UI
  // interaction targets that frame; the React skins target the page itself.
  let target = null;
  const openSurface = async () => {
    await page.goto(base + skin.url, { waitUntil: "domcontentloaded" });
    await hideDemoPicker(page);
    target = skin.hashApp ? await classicFrame(page) : page;
    await skin.open(target);
  };
  try {
    await openSurface();

    // ---- DRAFT: staged bilingual draft through the real UI ----
    await skin.fill(target, title, `Complete English body for the ${skin.key} editorial matrix journey. The Persian edition stays empty in this staged draft.`);
    if (skin.modalSave) {
      await target.locator(".modal-foot .btn-primary").click();
      await target.waitForLoadState("load").catch(() => {});
      await target.locator("[data-action='add-content']").waitFor({ state: "visible" });
    } else {
      await target.getByRole("button", { name: skin.saveButton, exact: true }).click();
      await target.locator(skin.readiness).waitFor({ state: "visible" });
    }
    const slugGuess = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 72);
    let slug = null;
    for (let attempt = 0; attempt < 10 && !slug; attempt++) {
      const slugs = await publicSlugs(page);
      slug = slugs.find(candidate => candidate.startsWith(slugGuess.slice(0, 40))) ?? null;
      if (!slug) await page.waitForTimeout(400);
    }
    const adminList = await apiFetch(page, "/api/admin/content/posts?limit=100", {}, csrfToken);
    const savedPost = (adminList.body?.posts ?? []).find(post => post.title_en === title);
    check(skin.key, "DRAFT the staged bilingual draft is saved with honest separate indicators", Boolean(savedPost) && savedPost.language_completeness.en === "complete" && savedPost.language_completeness.fa === "missing" && savedPost.media_publication_rights === "no_media", { id: savedPost?.id, language_completeness: savedPost?.language_completeness, media_publication_rights: savedPost?.media_publication_rights });
    if (skin.readiness) {
      const readinessText = await target.locator(skin.readiness).innerText().catch(() => "");
      check(skin.key, "DRAFT the editor shows EN complete / FA missing as separate live badges", /EN/i.test(readinessText) && /FA/i.test(readinessText) && /complete/i.test(readinessText) && /missing/i.test(readinessText), { readinessText: readinessText.slice(0, 120) });
    }
    // Public read routes never serve the draft.
    const draftPublicSlugs = await publicSlugs(page);
    check(skin.key, "PREVIEW the public list does NOT serve the draft", !draftPublicSlugs.includes(savedPost?.slug), { slug: savedPost?.slug });
    const draftPublicRead = await apiFetch(page, `/api/content/posts/${encodeURIComponent(savedPost.slug)}`);
    check(skin.key, "PREVIEW the public slug read refuses the draft 404", draftPublicRead.status === 404, { status: draftPublicRead.status });

    // ---- PREVIEW: the editor-only preview with the noindex rule ----
    if (skin.workflow) {
      await target.locator(`${skin.workflow} button`, { hasText: /^Preview$|پیش‌نمایش/ }).first().click();
    } else {
      await target.locator(`[data-action='preview-content'][data-id='${savedPost.id}']`).click();
    }
    await target.locator(skin.previewSurface).first().waitFor({ state: "visible" });
    const previewBanner = await target.locator(skin.previewSurface).first().innerText();
    const robotsMeta = await target.locator("meta[name='robots'][data-r117-preview='true']").count();
    check(skin.key, "PREVIEW the editor-only preview opens with the honest unpublished banner", /unpublished|منتشرنشده/i.test(previewBanner), { banner: previewBanner.slice(0, 140) });
    check(skin.key, "PREVIEW the open preview carries an explicit noindex robots rule", robotsMeta === 1, { robotsMeta });
    await shot(page, `${skin.key}-preview-unpublished`);
    // Close the preview. The click is dispatched programmatically: the
    // floating demo-persona picker can overlap the banner's close button
    // without being part of this journey.
    if (skin.workflow) {
      await target.locator(`${skin.previewSurface} button`, { hasText: /Close preview|بستن پیش‌نمایش/ }).first().evaluate(el => el.click());
    } else {
      await target.locator(".modal-foot .btn-primary").evaluate(el => el.click());
    }
    await page.waitForTimeout(400);

    // ---- PUBLISH: the explicit human action ----
    if (skin.workflow) {
      await target.locator(`${skin.workflow} button`, { hasText: /^Publish$|انتشار$/ }).first().click();
    } else {
      await target.locator(`[data-action='publish-content'][data-id='${savedPost.id}']`).click();
      await target.waitForLoadState("load").catch(() => {});
      await target.locator("[data-action='add-content']").waitFor({ state: "visible" });
    }
    let published = null;
    for (let attempt = 0; attempt < 10 && !published; attempt++) {
      const list = await apiFetch(page, "/api/admin/content/posts?limit=100", {}, csrfToken);
      published = (list.body?.posts ?? []).find(post => post.id === savedPost.id && post.status === "published") ?? null;
      if (!published) await page.waitForTimeout(400);
    }
    check(skin.key, "PUBLISH the explicit publish action serves the post publicly", Boolean(published) && (await publicSlugs(page)).includes(published.slug), { row_version: published?.row_version, published_at: published?.published_at });
    // THE acceptance pin: the English publication never claims a completed Persian translation.
    const publicRead = await apiFetch(page, `/api/content/posts/${encodeURIComponent(published.slug)}`);
    const publicCompleteness = publicRead.body?.post?.language_completeness ?? null;
    check(skin.key, "PUBLISH the public projection reports the Persian edition honestly (missing, not claimed)", publicRead.status === 200 && publicCompleteness?.en === "complete" && publicCompleteness?.fa === "missing", { publicCompleteness });
    await shot(page, `${skin.key}-published`);

    // ---- RETRACT: the explicit action, visible after a FULL reload ----
    if (skin.workflow) {
      await target.locator(`${skin.workflow} button`, { hasText: /^Retract$|بازپس‌گیری$/ }).first().click();
    } else {
      await target.locator(`[data-action='retract-content'][data-id='${savedPost.id}']`).click();
      await target.waitForLoadState("load").catch(() => {});
      await target.locator("[data-action='add-content']").waitFor({ state: "visible" });
    }
    let retracted = null;
    for (let attempt = 0; attempt < 10 && !retracted; attempt++) {
      const list = await apiFetch(page, "/api/admin/content/posts?limit=100", {}, csrfToken);
      retracted = (list.body?.posts ?? []).find(post => post.id === savedPost.id && post.status === "archived") ?? null;
      if (!retracted) await page.waitForTimeout(400);
    }
    // The FULL reload — the retraction must stay visible and the public routes must stay honest.
    await openSurface();
    const afterReload = await apiFetch(page, "/api/admin/content/posts?limit=100", {}, csrfToken);
    const reloadedRow = (afterReload.body?.posts ?? []).find(post => post.id === savedPost.id);
    const publicAfterRetract = await publicSlugs(page);
    const publicReadAfterRetract = await apiFetch(page, `/api/content/posts/${encodeURIComponent(published.slug)}`);
    check(skin.key, "RETRACT the retraction stays visible after a full reload (archived)", Boolean(reloadedRow) && reloadedRow.status === "archived" && reloadedRow.row_version === published.row_version + 1, { status: reloadedRow?.status, row_version: reloadedRow?.row_version });
    check(skin.key, "RETRACT the public list and slug read no longer serve the post", !publicAfterRetract.includes(published.slug) && publicReadAfterRetract.status === 404, { slug: published.slug, slugReadStatus: publicReadAfterRetract.status });
    await shot(page, `${skin.key}-retracted-reloaded`);

    // ---- HISTORY: the immutable version history ----
    if (skin.workflow) {
      // After the full reload the editor is empty — re-select the reloaded
      // post so the per-post workflow actions render again.
      await reselect(skin, target, title);
      await target.locator(`${skin.workflow} button`, { hasText: /Version history|تاریخچه نسخه‌ها/ }).first().click();
      await target.locator(skin.historySurface).first().waitFor({ state: "visible" });
    } else {
      await target.locator(`[data-action='history-content'][data-id='${savedPost.id}']`).click();
      await target.locator(skin.historySurface).first().waitFor({ state: "visible" });
    }
    const historyText = await target.locator(skin.historySurface).first().innerText();
    const revisionsApi = await apiFetch(page, `/api/admin/content/posts/${encodeURIComponent(savedPost.id)}/revisions`, {}, csrfToken);
    const causes = (revisionsApi.body?.revisions ?? []).map(revision => revision.cause);
    check(skin.key, "HISTORY the version history records create -> publish -> retract honestly", causes.slice().sort().join(",") === "create,publish,retract" && /publish/i.test(historyText) && /retract/i.test(historyText), { causes });
    const snapshotHonest = (revisionsApi.body?.revisions ?? []).every(revision => revision.post && revision.post.language_completeness?.en === "complete" && revision.post.language_completeness?.fa === "missing");
    check(skin.key, "HISTORY every immutable snapshot decodes with the honest readiness", snapshotHonest, { revisions: causes.length });
    await shot(page, `${skin.key}-history`);
  } finally {
    await ctx.context.close();
  }
}

/** Shared: the Persian reader labels the English fallback honestly (heritage fa). */
async function persianFallbackJourney() {
  stage("heritage fa reader");
  const ctx = await session(EDITOR, "fa");
  const { page, csrfToken } = ctx;
  try {
    // Land on the app first (same-origin fetches need a real document origin).
    await page.goto(base + "/", { waitUntil: "domcontentloaded" });
    // Publish a fresh EN-only post, then read it in the Persian locale.
    const title = `R117-17 fa fallback ${Date.now().toString(36)}`;
    const create = await apiFetch(page, "/api/admin/content/posts", { method: "POST", data: JSON.stringify({ kind: "news", status: "draft", title_en: title, title_fa: "", summary_en: "", summary_fa: "", body_en: "English body for the honest Persian fallback note.", body_fa: "", tags: [], sources: [] }) }, csrfToken);
    const post = create.body?.post;
    await apiFetch(page, `/api/admin/content/posts/${post.id}/publish`, { method: "POST", data: JSON.stringify({ expected_row_version: post.row_version }) }, csrfToken);
    await page.goto(base + "/newsroom?post=" + post.id, { waitUntil: "domcontentloaded" });
    await hideDemoPicker(page);
    await page.locator(".heritage-news-reader").waitFor({ state: "visible" });
    const note = await page.locator("[data-surface='editorial-fallback-note']").count();
    const noteText = note ? await page.locator("[data-surface='editorial-fallback-note']").first().innerText() : "";
    check("heritage-fa", "READER the Persian reader labels the missing translation honestly (never claims it)", note === 1 && /نسخه اصلی انگلیسی/.test(noteText), { noteText: noteText.slice(0, 120) });
    await shot(page, "heritage-fa-fallback-note");
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
    await persianFallbackJourney();
  } finally {
    await browser.close();
  }
  report.finishedAt = new Date().toISOString();
  const failed = report.failures.length;
  await fs.writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  console.log(`\nEditorial matrix: ${report.checks.length - failed}/${report.checks.length} checks passed; page errors: ${report.pageErrors.length}`);
  if (report.pageErrors.length) console.log(JSON.stringify(report.pageErrors, null, 2));
  if (failed) { console.log(JSON.stringify(report.failures, null, 2)); process.exit(1); }
})();

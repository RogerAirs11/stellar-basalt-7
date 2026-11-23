/** R117-16 real-app CREDENTIAL matrix — the truthful credential
 * demonstration stories across ALL FIVE skins on the named synthetic
 * loopback instance (per the Master AI R117 handoff D24). Closes the
 * trust.credential PARITY_ACCEPTANCE.csv rows per skin on real-stack
 * persisted evidence:
 *   READ   — the PUBLIC per-horse projection renders (statement/field scope
 *            never public; scope_redacted note visible).
 *   ISSUE  — the member attester issues a scoped genetic-test credential
 *            through the real UI (fictional lab issuer, narrow scope); the
 *            row appears and is verified PERSISTED after a FULL reload.
 *   VERIFY — the public verification panel shows the honest CURRENT state.
 *   PRIVATE— the attester's snapshot review is refused (403 boundary
 *            visible in the UI).
 * Shared (API + heritage UI): the issuer OWNER (second principal) revokes
 * and supersedes through the real UI — the visible status flips while the
 * snapshot digest stays IDENTICAL (never rewritten); a real elapsed expiry
 * flips a credential to expired with the digest preserved; stranger/anonymous
 * issuance refused; the media-under-genetic-lab narrow-scope refusal; the
 * owner's snapshot review authorized; Persian fa copy verified (heritage).
 *
 * Loopback synthetic demo only (no live tenant). Boot:
 *   python tools/create-demo-database.py --output data/demo/r118-agent.sqlite
 *   npm run dev:demo -- data/demo/r118-agent.sqlite
 * then:
 *   UI_PLAYWRIGHT_MODULE=/home/z/.npm-global/lib/node_modules/playwright \
 *   node tools/test-r117-16-credential-matrix.mjs
 */
import fs from "node:fs/promises";
import path from "node:path";
const base = process.env.UI_BASE_URL || "http://127.0.0.1:3000";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(base).hostname)) throw new Error("Local synthetic demo only.");
const playwrightModule = await import((process.env.UI_PLAYWRIGHT_MODULE || "playwright").replace(/\/$/, "") + "/index.mjs");
const chromium = playwrightModule.chromium ?? playwrightModule.default?.chromium;
const out = path.resolve(process.env.UI_EVIDENCE_DIR || "review-r117/evidence-local/credential-matrix");
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

const HORSE = 900000017;          // DEMO Azin (owner_a) with verified genetic test 980000008
const ATTESTER = "staff";         // the lab issuer's ATTESTER (issues)
const OWNER = "owner_a";          // the lab issuer's OWNER (revokes/supersedes/reviews) — second principal
const STRANGER = "owner_b";       // no membership anywhere
const LAB_ISSUER_NAME = "DEMO Fictional Genetics Laboratory";

const SKINS = [
  { key: "heritage", url: `/horse/${HORSE}`, frontend: null, tab: null },
  { key: "equidata-elite", url: `/horse/${HORSE}`, frontend: "equidata-elite", tab: "RECORDS" },
  { key: "fei-classic", url: `/horse/${HORSE}`, frontend: "fei-classic", tab: "Records" },
  { key: "retro-astra", url: "/f/retro-astra/collections/credentials", frontend: null, tab: null, horseInput: true },
  { key: "classic-registry", url: "/f/classic-registry/credential-desk", frontend: null, tab: null, horseInput: true },
];

let browser;
async function session(persona, locale = "en", frontend = null) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, reducedMotion: "reduce" });
  await context.addInitScript(({ locale, origin, frontend }) => {
    if (location.origin !== origin) return;
    localStorage.setItem("registry-locale", locale);
    if (frontend) localStorage.setItem("registry-frontend", frontend);
  }, { locale, origin: new URL(base).origin, frontend });
  const auth = await context.request.post(base + "/api/auth/demo-admin", { headers: { Origin: base }, data: { persona } });
  if (!auth.ok()) throw new Error(`Demo login ${persona}: ${auth.status()}`);
  const csrfToken = (await auth.json().catch(() => null))?.csrfToken ?? null;
  const page = await context.newPage();
  page.setDefaultTimeout(25000);
  page.on("pageerror", error => report.pageErrors.push({ persona, locale, skin: page.url(), error: error.message }));
  return { context, page, csrfToken };
}

/** Same-origin fetch from a live page (cookies + csrf). */
const apiFetch = (page, pathn, init = {}, csrfToken = null) => page.evaluate(async ({ pathn, init, origin, csrfToken }) => {
  const { data, ...rest } = init || {};
  const response = await fetch(new URL(pathn, origin).href, { ...rest, body: data, headers: { ...(init?.headers || {}), "content-type": "application/json", ...(csrfToken ? { "x-csrf-token": csrfToken } : {}) }, credentials: "same-origin" });
  let body = null; try { body = await response.json(); } catch {}
  return { status: response.status, body };
}, { pathn, init, origin: base, csrfToken });

const labIssuerId = async (page, csrfToken) => {
  const list = await apiFetch(page, "/api/issuers", {}, csrfToken);
  const issuer = list.body?.issuers?.find(row => row.name === LAB_ISSUER_NAME);
  if (!issuer) throw new Error("Fictional lab issuer not seeded in the demo database");
  return issuer.id;
};

const horseCredentialIds = async (page, csrfToken) => {
  const list = await apiFetch(page, `/api/horses/${HORSE}/attestations`, {}, csrfToken);
  return (list.body?.attestations ?? []).map(row => row.id);
};

async function openSkinSurface(page, skin) {
  await page.goto(base + skin.url, { waitUntil: "domcontentloaded" });
  if (skin.tab) {
    await page.locator("button", { hasText: skin.tab }).first().click();
    await page.waitForTimeout(400);
  }
  if (skin.horseInput) {
    await page.locator('input[inputmode="numeric"]').first().fill(String(HORSE));
    await page.locator("button", { hasText: /Show credentials|نمایش اعتبارنامه‌ها/ }).first().click();
    await page.waitForTimeout(600);
  }
  await page.locator('[data-surface="credential-stories"]').first().waitFor({ state: "visible" });
}

const issuedIds = [];

async function perSkinJourney(skin) {
  stage(`skin ${skin.key}`);
  const ctx = await session(ATTESTER, "en", skin.frontend);
  const { page, csrfToken } = ctx;
  try {
    await openSkinSurface(page, skin);
    const issuerId = await labIssuerId(page, csrfToken);
    const before = await horseCredentialIds(page, csrfToken);

    // READ — the public credential surface renders with the fictional-issuer disclosure.
    const section = page.locator('[data-surface="credential-stories"]').first();
    await section.waitFor({ state: "visible" });
    const disclosure = await section.locator("text=/explicitly fictional|صراحتاً خیالی/").first().isVisible().catch(() => false);
    check(skin.key, "read: public credential surface renders with the fictional-issuer disclosure", disclosure);

    // ISSUE — through the real UI form.
    const issueContainer = page.locator('[data-surface="credential-issue"]').first();
    if (skin.key === "heritage") {
      await page.locator("button", { hasText: /Attest under an issuer/ }).first().click();
      await page.waitForTimeout(300);
    }
    const issuerSelect = issueContainer.locator("select").first();
    await issuerSelect.selectOption({ label: LAB_ISSUER_NAME });
    const kindSelect = issueContainer.locator("select").nth(1);
    await kindSelect.selectOption("genetic_test");
    await issueContainer.locator('input[placeholder="980000008"]').fill("980000008");
    await issueContainer.locator("button", { hasText: /Issue credential|صدور اعتبارنامه/ }).first().click();
    await page.waitForTimeout(1200);
    const afterIssue = await horseCredentialIds(page, csrfToken);
    const newIds = afterIssue.filter(id => !before.includes(id));
    check(skin.key, "issue: scoped genetic-test credential issued through the real UI", newIds.length === 1, { newId: newIds[0] ?? null });
    if (newIds[0]) issuedIds.push(newIds[0]);
    const rowLocator = page.locator(`[data-surface="credential-row"][data-attestation-id="${newIds[0] ?? ""}"]`);
    const rowVisible = newIds[0] ? await rowLocator.first().isVisible().catch(() => false) : false;
    check(skin.key, "issue: the new row renders", rowVisible);
    // READ (rows) — the public projection is metadata-only (scope redacted).
    if (newIds[0]) {
      const redactionNote = await rowLocator.locator("text=/Public metadata only|فراداده عمومی/").first().isVisible().catch(() => false);
      check(skin.key, "read: the row carries the scope-redaction note (statement/scope stay private)", redactionNote);
    }

    // VERIFY — the public verification panel shows the honest CURRENT state.
    if (newIds[0]) {
      await rowLocator.locator("button", { hasText: /^Verify$|^راستی‌آزمایی$/ }).first().click();
      await page.waitForTimeout(900);
      const verifyPanel = rowLocator.locator('[data-surface="credential-verify"]').first();
      const verifyText = (await verifyPanel.innerText().catch(() => "")).slice(0, 600);
      check(skin.key, "verify: public verification shows CURRENT", /current|معتبر/i.test(verifyText) && /State|وضعیت/.test(verifyText), { excerpt: verifyText.slice(0, 120) });
      // PRIVATE — the attester's snapshot review is refused (honest boundary).
      await rowLocator.locator("button", { hasText: /Review snapshot \(private\)|بازبینی تصویر/ }).first().click();
      await page.waitForTimeout(900);
      const snapshotPanel = rowLocator.locator('[data-surface="credential-snapshot-review"]').first();
      const snapshotText = (await snapshotPanel.innerText().catch(() => "")).slice(0, 400);
      check(skin.key, "private: attester snapshot review refused (403 boundary)", /Refused|رد شد/.test(snapshotText), { excerpt: snapshotText.slice(0, 100) });
      await shot(page, `${skin.key}-issued-verified`);
    }

    // PERSISTED — a FULL reload keeps the row.
    if (newIds[0]) {
      await page.reload({ waitUntil: "domcontentloaded" });
      if (skin.tab) { await page.locator("button", { hasText: skin.tab }).first().click(); await page.waitForTimeout(400); }
      if (skin.horseInput) {
        await page.locator('input[inputmode="numeric"]').first().fill(String(HORSE));
        await page.locator("button", { hasText: /Show credentials|نمایش اعتبارنامه‌ها/ }).first().click();
        await page.waitForTimeout(600);
      }
      const persisted = await page.locator(`[data-surface="credential-row"][data-attestation-id="${newIds[0]}"]`).first().waitFor({ state: "visible", timeout: 15000 }).then(() => true).catch(() => false);
      check(skin.key, "persisted: the credential row survives a full reload", persisted);
      await shot(page, `${skin.key}-persisted`);
    }
  } finally {
    await ctx.context.close();
  }
}

async function sharedJourneys() {
  stage("shared owner journeys (heritage UI)");
  const ctx = await session(OWNER, "en", null);
  const { page, csrfToken } = ctx;
  try {
    await openSkinSurface(page, SKINS[0]);
    // The public digest BEFORE any transition (immutable-snapshot baseline).
    const verifyBefore = async (id) => (await apiFetch(page, `/api/attestations/${id}/verify`, {}, csrfToken)).body;
    const revokeId = issuedIds[issuedIds.length - 1]; // newest (classic-registry's)
    const before = await verifyBefore(revokeId);
    check("shared", "owner: baseline verification captured (digest)", before?.snapshot?.content_digest?.length === 64, { digest: before?.snapshot?.content_digest?.slice(0, 12) });

    // REVOKE through the real UI (issuer OWNER — second principal).
    const row = page.locator(`[data-surface="credential-row"][data-attestation-id="${revokeId}"]`).first();
    await row.locator("button", { hasText: /Owner actions|اقدامات مالک/ }).first().click();
    await page.waitForTimeout(300);
    await row.locator('[data-surface="credential-owner-actions"] input').first().fill("Fictional demo revocation by the issuer owner");
    await row.locator("button", { hasText: /^Revoke$|^لغو$/ }).first().click();
    await page.waitForTimeout(1200);
    const afterRevoke = await verifyBefore(revokeId);
    check("shared", "owner revoke: visible status flips to revoked", afterRevoke?.status === "revoked" && afterRevoke?.verification_state === "revoked");
    check("shared", "owner revoke: the recorded snapshot digest is IDENTICAL (never rewritten)", afterRevoke?.snapshot?.content_digest === before?.snapshot?.content_digest);
    const revokedRow = await row.isVisible().catch(() => false);
    check("shared", "owner revoke: the row still renders (history visible)", revokedRow, {});
    await shot(page, "owner-revoked");

    // SUPERSEDE through the real UI — original superseded + replacement current.
    const supersedeId = issuedIds[issuedIds.length - 2];
    const supersedeBefore = await verifyBefore(supersedeId);
    const row2 = page.locator(`[data-surface="credential-row"][data-attestation-id="${supersedeId}"]`).first();
    await row2.locator("button", { hasText: /Owner actions|اقدامات مالک/ }).first().click();
    await page.waitForTimeout(300);
    const ownerPanel = row2.locator('[data-surface="credential-owner-actions"]');
    await ownerPanel.locator("input").nth(0).fill("Fictional corrected statement");
    await ownerPanel.locator("input").nth(1).fill("Fictional replacement statement; still no actual laboratory test.");
    await row2.locator("button", { hasText: /Supersede with replacement|جایگزینی با نسخه جدید/ }).first().click();
    await page.waitForTimeout(1200);
    const afterSupersede = await verifyBefore(supersedeId);
    check("shared", "owner supersede: original flips to superseded", afterSupersede?.verification_state === "superseded");
    check("shared", "owner supersede: the original snapshot digest is IDENTICAL", afterSupersede?.snapshot?.content_digest === supersedeBefore?.snapshot?.content_digest);
    const idsNow = await horseCredentialIds(page, csrfToken);
    const replacementId = idsNow.find(id => !issuedIds.includes(id));
    const replacementVerify = replacementId ? await verifyBefore(replacementId) : null;
    check("shared", "owner supersede: the replacement is CURRENT", replacementVerify?.verification_state === "current", { replacementId });
    if (replacementId) issuedIds.push(replacementId);

    // SNAPSHOT REVIEW — the OWNER is authorized (granted), with the digest.
    const reviewId = issuedIds[0];
    const row3 = page.locator(`[data-surface="credential-row"][data-attestation-id="${reviewId}"]`).first();
    await row3.locator("button", { hasText: /Review snapshot \(private\)|بازبینی تصویر/ }).first().click();
    await page.waitForTimeout(900);
    const snapshotText = (await row3.locator('[data-surface="credential-snapshot-review"]').first().innerText().catch(() => "")).slice(0, 400);
    check("shared", "owner snapshot review: authorized (digest visible)", /authorized|مجاز/.test(snapshotText), { excerpt: snapshotText.slice(0, 100) });
    await shot(page, "owner-snapshot-authorized");
  } finally {
    await ctx.context.close();
  }

  stage("shared expiry + refusal probes (API on live pages)");
  const staff = await session(ATTESTER);
  try {
    const { page, csrfToken } = staff;
    await page.goto(base + "/horse/" + HORSE, { waitUntil: "domcontentloaded" });
    const issuerId = await labIssuerId(page, csrfToken);
    // A REAL elapsed expiry: issue with now+2.5s, wait, verify.
    const expiresAt = new Date(Date.now() + 2500).toISOString();
    const shortLived = await apiFetch(page, `/api/issuers/${issuerId}/attestations`, { method: "POST", data: JSON.stringify({ record_kind: "genetic_test", record_id: "980000008", statement: "Fictional short-lived credential; no actual laboratory test.", expires_at: expiresAt }) }, csrfToken);
    const shortId = shortLived.body?.attestation?.id ?? null;
    check("shared", "expiry: short-lived credential issued", shortLived.status === 201 && Boolean(shortId), { status: shortLived.status });
    if (shortId) {
      const beforeExpire = (await apiFetch(page, `/api/attestations/${shortId}/verify`, {}, csrfToken)).body;
      check("shared", "expiry: starts CURRENT", beforeExpire?.verification_state === "current");
      await new Promise(resolve => setTimeout(resolve, 3500));
      const afterExpire = (await apiFetch(page, `/api/attestations/${shortId}/verify`, {}, csrfToken)).body;
      check("shared", "expiry: flips to EXPIRED after the real window elapses", afterExpire?.verification_state === "expired" && afterExpire?.effective_status === "expired");
      check("shared", "expiry: the snapshot digest is IDENTICAL (preserved history)", afterExpire?.snapshot?.content_digest === beforeExpire?.snapshot?.content_digest);
      issuedIds.push(shortId);
    }
    // Narrow-scope refusal: media under the genetic-test lab.
    const mediaAttempt = await apiFetch(page, `/api/issuers/${issuerId}/attestations`, { method: "POST", data: JSON.stringify({ record_kind: "media", record_id: "media-r16-probe" }) }, csrfToken);
    check("shared", "narrow scope: media under the genetic-test lab refused issuer_scope_required", mediaAttempt.status === 403 && mediaAttempt.body?.error?.code === "issuer_scope_required", { status: mediaAttempt.status, code: mediaAttempt.body?.error?.code });
    // Public projection honesty: the horse rows never carry statement/field_scope.
    const horseRows = (await apiFetch(page, `/api/horses/${HORSE}/attestations`, {}, csrfToken)).body?.attestations ?? [];
    const leaked = horseRows.filter(row => row.statement !== null || row.field_scope !== null || row.scope_redacted !== true);
    check("shared", "public projection: no statement/field_scope in any horse row (scope_redacted)", leaked.length === 0, { rows: horseRows.length });
  } finally {
    await staff.context.close();
  }

  const stranger = await session(STRANGER);
  try {
    const { page, csrfToken } = stranger;
    await page.goto(base + "/horse/" + HORSE, { waitUntil: "domcontentloaded" });
    const issuerId = await labIssuerId(page, csrfToken);
    const attempt = await apiFetch(page, `/api/issuers/${issuerId}/attestations`, { method: "POST", data: JSON.stringify({ record_kind: "genetic_test", record_id: "980000008" }) }, csrfToken);
    check("shared", "stranger: issuance without membership refused 403", attempt.status === 403, { status: attempt.status });
    // A true anonymous request: a fresh context with NO session cookie.
    const anonContext = await browser.newContext();
    const anonResponse = await anonContext.request.post(`${base}/api/issuers/${issuerId}/attestations`, { headers: { Origin: base, "content-type": "application/json" }, data: { record_kind: "genetic_test", record_id: "980000008" } }).catch(() => null);
    await anonContext.close();
    check("shared", "anonymous: unauthenticated issuance refused 401", anonResponse?.status() === 401, { status: anonResponse?.status() ?? "network-error" });
    // The stranger ALSO cannot read the private snapshot.
    if (issuedIds[0]) {
      const snapshotAttempt = await apiFetch(page, `/api/admin/attestations/${issuedIds[0]}/snapshot`, {}, csrfToken);
      check("shared", "stranger: private snapshot review refused 403", snapshotAttempt.status === 403, { status: snapshotAttempt.status });
    }
  } finally {
    await stranger.context.close();
  }
}

async function faCopy() {
  stage("persian copy (heritage fa)");
  const ctx = await session(ATTESTER, "fa", null);
  try {
    const { page } = ctx;
    await openSkinSurface(page, SKINS[0]);
    const section = page.locator('[data-surface="credential-stories"]').first();
    const text = (await section.innerText().catch(() => "")).slice(0, 900);
    const hasFa = /اعتبارنامه|مرجع|راستی‌آزمایی|خیالی/.test(text);
    check("heritage-fa", "fa copy: Persian credential story copy renders", hasFa, { excerpt: text.slice(0, 90) });
    const noRealClaim = /فدراسیون واقعی|تأیید آزمایشگاهی نیست/.test(text);
    check("heritage-fa", "fa copy: the fictional-issuer disclosure renders in Persian", noRealClaim);
    await shot(page, "heritage-fa");
  } finally {
    await ctx.context.close();
  }
}

try {
  browser = await chromium.launch();
  report.browser = browser.version();
  for (const skin of SKINS) await perSkinJourney(skin);
  await sharedJourneys();
  await faCopy();
} catch (error) {
  report.failures.push({ skin: "harness", name: "harness error", okay: false, error: String(error) });
  console.error("HARNESS ERROR", error);
} finally {
  if (browser) await browser.close();
}
report.completedAt = new Date().toISOString();
report.totals = { checks: report.checks.length, failed: report.failures.length, pageErrors: report.pageErrors.length };
await fs.writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2));
console.log(`\nR117-16 credential matrix: ${report.checks.length - report.failures.length}/${report.checks.length} checks, ${report.pageErrors.length} page errors`);
console.log(`evidence: ${out}`);
process.exitCode = report.failures.length === 0 && report.pageErrors.length === 0 ? 0 : 1;

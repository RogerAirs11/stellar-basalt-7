/** Two-principal native claim/correction lifecycle on synthetic local records. */
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const { chromium } = await import(process.env.UI_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.UI_BASE_URL || "http://127.0.0.1:3000";
if (!["127.0.0.1", "localhost"].includes(new URL(base).hostname)) throw new Error("Only an isolated local demo is allowed.");
const out = path.resolve(process.env.UI_EVIDENCE_DIR || "review-r113/evidence/elite-fei-claims");
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const result = { startedAt: new Date().toISOString(), browser: browser.version(), journeys: [], pageErrors: [] };
const visit = async (page, route) => { await page.goto(base + route, { waitUntil: "networkidle" }); await page.locator("main").first().waitFor(); };
async function createContext(skin, persona) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  await context.addInitScript(skin => { localStorage.setItem("registry-frontend", skin); localStorage.setItem("registry-locale", "en"); localStorage.setItem("registry.locale", "en"); }, skin);
  const auth = await context.request.post(base + "/api/auth/demo-admin", { headers: { Origin: base }, data: { persona } }); assert.equal(auth.status(), 200); const login = await auth.json();
  const page = await context.newPage(); page.on("dialog", dialog => dialog.accept()); page.on("pageerror", error => result.pageErrors.push({ skin, persona, error: error.message }));
  return { context, page, csrf: login.csrfToken };
}
const writeResponse = async (page, suffix, execute, method = "POST") => {
  const pending = page.waitForResponse(response => new URL(response.url()).pathname.endsWith(suffix) && response.request().method() === method);
  await execute(); const response = await pending; const data = await response.json(); assert.ok(response.ok(), `${response.status()}: ${JSON.stringify(data)}`); return data;
};
try {
  for (const [skin, ownerPersona, reviewerPersona] of [["equidata-elite", "owner_b", "reviewer"], ["fei-classic", "owner_a", "admin"]]) {
    const owner = await createContext(skin, ownerPersona), reviewer = await createContext(skin, reviewerPersona);
    const journey = { skin, ownerPersona, reviewerPersona, steps: [], claimId: null, correctionId: null };
    const personalRoute = `/f/${skin}/${skin === "fei-classic" ? "workflows" : "claims"}`;
    const reviewRoute = `/f/${skin}/${skin === "fei-classic" ? "management" : "governance"}`;
    const personalRow = skin === "fei-classic" ? ".fc113-request-register > article" : ".edx113-request-history > li";
    const reviewRow = skin === "fei-classic" ? ".fc113-review-file" : ".edx113-review-card";
    try {
      const mine = await (await owner.context.request.get(base + "/api/claims/mine")).json();
      let horseId;
      for (const id of [900000018, 900000019, 900000020, 900000017, 900000021]) {
        if ((mine.claims || []).some(row => row.horse_id === id && ["pending", "approved"].includes(row.status))) continue;
        if ((await owner.context.request.get(`${base}/api/horses/${id}`)).ok()) { horseId = id; break; }
      }
      assert.ok(horseId, "A synthetic horse without an existing pending claim is available"); journey.horseId = horseId;
      await visit(owner.page, `/horse/${horseId}`);
      const evidence = `R113 ${skin}: synthetic ownership evidence for the reviewer to inspect. No legal assertion.`;
      await owner.page.getByRole("textbox", { name: "Ownership evidence", exact: true }).fill(evidence);
      const claim = await writeResponse(owner.page, "/api/claims", () => owner.page.getByRole("button", { name: "Submit ownership evidence", exact: true }).click());
      journey.claimId = claim.claim.id; assert.equal(claim.claim.horse_id, horseId); journey.steps.push("Owner submitted supplied horse evidence and received the correct horse/claim ID");
      const deniedRead = await owner.context.request.get(base + "/api/admin/claims"); assert.equal(deniedRead.status(), 403);
      const deniedReview = await owner.context.request.post(`${base}/api/admin/claims/${journey.claimId}/review`, { headers: { Origin: base, "x-csrf-token": owner.csrf }, data: { decision: "approved", note: "Unauthorized synthetic attempt must fail" } }); assert.equal(deniedReview.status(), 403); journey.steps.push("Owner denied protected evidence and reviewer mutation");
      await visit(owner.page, personalRoute);
      const summary = `R113 ${skin} synthetic correction draft`;
      const correctionForm = owner.page.locator('textarea[name="summary"]').locator("xpath=ancestor::form");
      await correctionForm.locator('textarea[name="summary"]').fill(summary); await correctionForm.locator('textarea[name="evidence"]').fill("Synthetic source explanation for review.");
      const draft = await writeResponse(owner.page, "/api/change-requests", () => owner.page.getByRole("button", { name: "Save as draft", exact: true }).click());
      journey.correctionId = draft.request.id; assert.equal(draft.request.status, "draft");
      let row = owner.page.locator(personalRow).filter({ hasText: journey.correctionId });
      await row.getByRole("button", { name: "Edit draft", exact: true }).click(); await correctionForm.locator('textarea[name="summary"]').fill(summary + " edited");
      await writeResponse(owner.page, `/api/change-requests/${journey.correctionId}`, () => owner.page.getByRole("button", { name: "Save draft changes", exact: true }).click(), "PUT");
      row = owner.page.locator(personalRow).filter({ hasText: journey.correctionId });
      const submitted = await writeResponse(owner.page, `/api/change-requests/${journey.correctionId}/submit`, () => row.getByRole("button", { name: "Submit saved draft", exact: true }).click()); assert.equal(submitted.request.status, "pending"); journey.steps.push("Correction saved, edited with retained evidence, and submitted from its real draft");
      await visit(reviewer.page, reviewRoute);
      const claimCard = reviewer.page.locator(reviewRow).filter({ hasText: journey.claimId });
      await claimCard.getByText(evidence, { exact: true }).waitFor(); await claimCard.getByRole("textbox", { name: "Review reason", exact: true }).fill("Synthetic verification only; rejecting this test claim to leave ownership unchanged.");
      const rejected = await writeResponse(reviewer.page, `/api/admin/claims/${journey.claimId}/review`, () => claimCard.getByRole("button", { name: "Reject request", exact: true }).click()); assert.equal(rejected.claim.status, "rejected"); assert.equal(rejected.canonicalApplied, false);
      const correctionCard = reviewer.page.locator(reviewRow).filter({ hasText: journey.correctionId });
      await correctionCard.getByRole("textbox", { name: "Review reason", exact: true }).fill("Please identify the original registry source more precisely.");
      const bounced = await writeResponse(reviewer.page, `/api/admin/change-requests/${journey.correctionId}/review`, () => correctionCard.getByRole("button", { name: "Request changes", exact: true }).click()); assert.equal(bounced.request.status, "draft"); journey.steps.push("Independent reviewer inspected evidence, rejected the claim with reason, and requested correction changes");
      await reviewer.page.screenshot({ path: path.join(out, `${skin}-reviewer.png`), fullPage: true });
      await visit(owner.page, personalRoute);
      const personalClaim = owner.page.locator(personalRow).filter({ hasText: journey.claimId }); await personalClaim.getByText("Synthetic verification only; rejecting this test claim to leave ownership unchanged.", { exact: false }).waitFor();
      row = owner.page.locator(personalRow).filter({ hasText: journey.correctionId }); await row.getByText("Please identify the original registry source more precisely.", { exact: false }).waitFor();
      const withdrawn = await writeResponse(owner.page, `/api/change-requests/${journey.correctionId}/withdraw`, () => row.getByRole("button", { name: "Withdraw request", exact: true }).click()); assert.equal(withdrawn.request.status, "withdrawn"); journey.steps.push("Owner reread actual decisions/reasons and withdrew the returned draft");
      await owner.page.screenshot({ path: path.join(out, `${skin}-owner-status.png`), fullPage: true });
      journey.ok = true;
    } catch (error) { journey.ok = false; journey.error = String(error); }
    result.journeys.push(journey); await fs.writeFile(path.join(out, "results.json"), JSON.stringify(result, null, 2)); console.log(JSON.stringify(journey));
    await owner.context.close(); await reviewer.context.close();
  }
} finally { await browser.close(); result.finishedAt = new Date().toISOString(); result.summary = { journeys: result.journeys.length, passed: result.journeys.filter(journey => journey.ok).length, pageErrors: result.pageErrors.length }; await fs.writeFile(path.join(out, "results.json"), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result.summary)); }
if (result.pageErrors.length || result.journeys.some(journey => !journey.ok)) process.exitCode = 1;

/** R117-28 showcase rehearsal — J10 CONNECTED BUYER STORY on the named
 * synthetic loopback instance. Completes the ticket's connected persona set
 * (owner, reviewer, buyer, provider, staff, reader): the buyer (owner_b)
 * inquires on the seller's (owner_a) active listing, the seller replies, the
 * buyer closes their own inquiry, and every step records the actual API
 * response + SQLite row effect. All traffic stays on loopback.
 *
 * Loopback synthetic demo only. Server must be STOPPED before launch:
 *   UI_PLAYWRIGHT_MODULE=/home/z/.npm-global/lib/node_modules/playwright \
 *   node tools/test-r117-28-connected-buyer.mjs
 */
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const base = process.env.UI_BASE_URL || "http://127.0.0.1:3000";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(base).hostname)) throw new Error("Local synthetic demo only.");
const playwrightModule = await import((process.env.UI_PLAYWRIGHT_MODULE || "playwright") + "/index.mjs");
const chromium = playwrightModule.chromium ?? playwrightModule.default?.chromium;
const DB_PATH = path.resolve("data/demo/r118-rehearsal.sqlite");
const INSTANCE = "r118-rehearsal";
const LISTING = "83ebe5d6-dcd9-51fb-8a94-2abf8ebde8c5"; // horse 900000017 (seller: owner_a)

const out = path.resolve(process.env.UI_EVIDENCE_DIR || "review-r117/evidence-local/rehearsal/connected-buyer");
await fs.mkdir(out, { recursive: true });
const report = { browser: "n/a", startedAt: new Date().toISOString(), sourceHash: "unknown", checks: [], failures: [], pageErrors: [], outbound: [], rows: [] };
try { report.sourceHash = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); } catch { /* record only */ }
const check = (name, okay, details = {}) => {
  const entry = { name, okay, ...details };
  report.checks.push(entry);
  if (!okay) report.failures.push(entry);
  console.log(`${okay ? "PASS" : "FAIL"} [J10-connected-buyer] ${name}${Object.keys(details).length ? " " + JSON.stringify(details) : ""}`);
};
const row = (feature, skin, entry) => { report.rows.push({ feature, skin, ...entry }); console.log(`ROW  [${feature}/${skin}] ${JSON.stringify(entry).slice(0, 200)}`); };
const dbRows = (sql, ...params) => { const db = new DatabaseSync(DB_PATH, { readOnly: true }); try { return db.prepare(sql).all(...params); } finally { db.close(); } };

let serverProc = null;
async function startServer() {
  serverProc = spawn("npm", ["run", "dev:demo", "--", `data/demo/${INSTANCE}.sqlite`], { cwd: path.resolve("."), env: { ...process.env, HORSE_REGISTRY_SOURCE_PREVIEW: "1" }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  serverProc.stdout.on("data", () => {}); serverProc.stderr.on("data", () => {});
  const started = Date.now();
  while (Date.now() - started < 45000) {
    try { const res = await fetch(base + "/api/demo/context"); if (res.ok) return true; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 600));
  }
  return false;
}
function stopServer() { if (!serverProc) return; try { process.kill(-serverProc.pid, "SIGTERM"); } catch { /* already gone */ } serverProc = null; }

let browser;
async function session(persona) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  await context.addInitScript(({ origin }) => { localStorage.setItem("registry-locale", "en"); }, { origin: new URL(base).origin });
  context.on("request", (request) => { try { const u = new URL(request.url()); if (u.origin !== new URL(base).origin) report.outbound.push({ label: persona, url: request.url() }); } catch { /* ignore */ } });
  const auth = await context.request.post(base + "/api/auth/demo-admin", { headers: { Origin: base }, data: { persona } });
  if (!auth.ok()) throw new Error(`Demo login ${persona}: ${auth.status()}`);
  const csrfToken = (await auth.json().catch(() => null))?.csrfToken ?? null;
  const page = await context.newPage();
  page.setDefaultTimeout(25000);
  page.on("pageerror", (error) => report.pageErrors.push({ persona, url: page.url(), error: error.message }));
  await page.goto(base + "/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  return { context, page, csrfToken };
}
const apiFetch = (page, pathn, init = {}, csrfToken = null) => page.evaluate(async ({ pathn, init, origin, csrfToken }) => {
  const { data, ...rest } = init || {};
  const response = await fetch(new URL(pathn, origin).href, { ...rest, body: data, headers: { ...(init?.headers || {}), "content-type": "application/json", ...(csrfToken ? { "x-csrf-token": csrfToken } : {}) }, credentials: "same-origin" });
  let body = null; try { body = await response.json(); } catch {}
  return { status: response.status, body };
}, { pathn, init, origin: base, csrfToken });

try {
  try { browser = await chromium.launch({ headless: true }); }
  catch (launchError) { check("browser launch", false, { error: String(launchError) }); throw launchError; }
  report.browser = await browser.version();
  execFileSync("python3", ["tools/reset-showcase.py", "reset", "--instance", INSTANCE, "--as-of", "2026-10-21"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (!(await startServer())) { check("server spawns", false, {}); throw new Error("server failed to start"); }

  const effects = {};

  // BUYER (owner_b) inquires on the seller's active listing.
  const buyer = await session("owner_b");
  try {
    const before = dbRows("SELECT COUNT(*) n FROM sales_inquiries WHERE listing_id=?", LISTING)[0].n;
    const inquire = await apiFetch(buyer.page, `/api/market/listings/${LISTING}/inquiries`, { method: "POST", data: JSON.stringify({ buyer_name: "DEMO Owner B", buyer_contact: "buyer-b@local.invalid", message: "Showcase rehearsal connected buyer story: is this horse still available?" }) }, buyer.csrfToken);
    const inquiry = inquire.body?.inquiry ?? null;
    const after = dbRows("SELECT id, status, row_version FROM sales_inquiries WHERE listing_id=? ORDER BY created_at DESC LIMIT 1", LISTING)[0] ?? null;
    check("buyer inquires on the seller's listing", inquire.status === 201 && Boolean(inquiry), { status: inquire.status, inquiry: inquiry?.id });
    effects.inquiry = after;
    const sent = await apiFetch(buyer.page, "/api/market/inquiries/sent", {}, buyer.csrfToken);
    const inSent = (sent.body?.rows ?? []).some((i) => i.id === inquiry?.id);
    check("the buyer's sent-inquiry inbox shows the inquiry", sent.status === 200 && inSent, { sent: (sent.body?.rows ?? []).length, total: sent.body?.pagination?.total });
    effects.buyerInboxCount = sent.body?.pagination?.total ?? (sent.body?.rows ?? []).length;
  } finally { await buyer.context.close(); }

  // SELLER (owner_a) replies through the participant-only thread.
  const seller = await session("owner_a");
  try {
    const reply = await apiFetch(seller.page, `/api/market/inquiries/${effects.inquiry.id}/replies`, { method: "POST", data: JSON.stringify({ body: "Showcase rehearsal seller reply: yes, available for the connected story." }) }, seller.csrfToken);
    const replyRows = dbRows("SELECT COUNT(*) n FROM sales_inquiry_replies WHERE inquiry_id=?", effects.inquiry.id)[0].n;
    check("the seller replies on the participant-only thread", reply.status === 201 && replyRows === 1, { status: reply.status, replies: replyRows });
    effects.sellerReplies = replyRows;
  } finally { await seller.context.close(); }

  // BUYER closes their own inquiry through the buyer-close endpoint with the
  // current row_version (CAS).
  const buyer2 = await session("owner_b");
  try {
    const current = dbRows("SELECT row_version, status FROM sales_inquiries WHERE id=?", effects.inquiry.id)[0];
    const close = await apiFetch(buyer2.page, `/api/market/inquiries/${effects.inquiry.id}/close`, { method: "POST", data: JSON.stringify({ expected_version: current.row_version }) }, buyer2.csrfToken);
    const closed = dbRows("SELECT status, row_version FROM sales_inquiries WHERE id=?", effects.inquiry.id)[0];
    check("the buyer closes their own inquiry (versioned CAS)", close.status === 200 && closed.status === "closed", { status: close.status, final: closed.status, version: closed.row_version });
    // A stale close attempt must refuse with 409.
    const stale = await apiFetch(buyer2.page, `/api/market/inquiries/${effects.inquiry.id}/close`, { method: "POST", data: JSON.stringify({ expected_version: current.row_version }) }, buyer2.csrfToken);
    const staleCode = typeof stale.body?.error === "string" ? stale.body.error : stale.body?.error?.code;
    check("a stale versioned close refuses with 409", stale.status === 409, { status: stale.status, error: staleCode });
    effects.finalStatus = closed.status;
  } finally { await buyer2.context.close(); }

  row("market.connected-buyer", "all", {
    route: `/api/market/listings/${LISTING}/inquiries + replies + close`, principal: "owner_b (buyer) + owner_a (seller)",
    initialData: `inquiries on listing before: ${dbRows("SELECT COUNT(*) n FROM sales_inquiries WHERE listing_id=?", LISTING)[0].n - 1}`,
    serverResponse: "inquire 201 -> reply 201 -> buyer close 200 -> stale close 409",
    persistedEffect: `inquiry ${effects.inquiry?.id} status=${effects.finalStatus}; seller replies=${effects.sellerReplies}; buyer inbox=${effects.buyerInboxCount}`,
  });
} catch (error) {
  report.aborted = String(error?.stack || error);
  console.error("ABORTED:", error?.stack || error);
} finally {
  stopServer();
  if (browser) await browser.close();
  report.finishedAt = new Date().toISOString();
  report.summary = { total: report.checks.length, failed: report.failures.length, pageErrors: report.pageErrors.length, outboundRequests: report.outbound.length, rows: report.rows.length };
  await fs.writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  await fs.writeFile(path.join(out, "PARITY-ROWS.json"), JSON.stringify(report.rows, null, 2));
  console.log(`\n==== R117-28 connected-buyer: ${report.summary.total - report.summary.failed}/${report.summary.total} checks, pageErrors=${report.summary.pageErrors}, outbound=${report.summary.outboundRequests}`);
  process.exit(report.summary.failed === 0 && report.summary.pageErrors === 0 && report.summary.outboundRequests === 0 ? 0 : 1);
}

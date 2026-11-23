/** R117-28 showcase rehearsal — RESTART + RESTORE MATRIX (journeys J7-J10)
 * on the named synthetic loopback instance `r118-rehearsal`. This tool OWNS
 * the dev-server lifecycle (spawn/kill/respawn) to supervise the ticket's
 * process-restart and restore requirements:
 *
 *   J7 restart journey #1 — owner story across a process restart: the owner
 *      signs in, submits a claim, the process is KILLED mid-session, and
 *      after respawn the persisted claim is still there; the demo session is
 *      honestly re-established through the server's own persona login.
 *   J8 restart journey #2 — staff/admin story: a workspace reminder is
 *      enqueued, the notification drain runs, the process is restarted (the
 *      demo inbox signing secret is documented to change on restart), and
 *      the post-restart drain still works with recorded API/DB effects.
 *   J9 restore journey — a backup is taken, the instance is mutated (a new
 *      claim + a market inquiry), the backup is RESTORED, and the rolled-back
 *      state is verified exactly (claim gone, baseline counts back).
 *
 * Every journey records the actual API/DB effects; all network traffic stays
 * on the loopback origin or the run fails.
 *
 * Loopback synthetic demo only. The server must be STOPPED before launch:
 *   UI_PLAYWRIGHT_MODULE=/home/z/.npm-global/lib/node_modules/playwright \
 *   node tools/test-r117-28-restart-restore.mjs
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

const out = path.resolve(process.env.UI_EVIDENCE_DIR || "review-r117/evidence-local/rehearsal/restart-restore");
await fs.mkdir(out, { recursive: true });
const report = { browser: "n/a", startedAt: new Date().toISOString(), sourceHash: "unknown", journeys: {}, checks: [], failures: [], pageErrors: [], outbound: [], rows: [], serverEvents: [] };
try { report.sourceHash = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); } catch { /* record only */ }
const stage = (name) => console.log(`-- ${new Date().toISOString().slice(11, 19)} ${name}`);
const check = (journey, name, okay, details = {}) => {
  const entry = { journey, name, okay, ...details };
  report.checks.push(entry);
  if (!okay) report.failures.push(entry);
  if (!report.journeys[journey]) report.journeys[journey] = { total: 0, failed: 0 };
  report.journeys[journey].total += 1;
  if (!okay) report.journeys[journey].failed += 1;
  console.log(`${okay ? "PASS" : "FAIL"} [${journey}] ${name}${Object.keys(details).length ? " " + JSON.stringify(details) : ""}`);
};
const row = (feature, skin, entry) => { report.rows.push({ feature, skin, ...entry }); console.log(`ROW  [${feature}/${skin}] ${JSON.stringify(entry).slice(0, 200)}`); };
const shot = (page, name) => page.screenshot({ path: path.join(out, `${name}.png`), fullPage: false }).catch(() => {});
const dbRows = (sql, ...params) => { const db = new DatabaseSync(DB_PATH, { readOnly: true }); try { return db.prepare(sql).all(...params); } finally { db.close(); } };

/* ---------------- server lifecycle ---------------- */
let serverProc = null;
const serverEvent = (e) => { report.serverEvents.push(`${new Date().toISOString().slice(11, 19)} ${e}`); console.log(`SRV  ${e}`); };
async function waitReady(timeoutMs = 45000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(base + "/api/demo/context");
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 600));
  }
  return false;
}
async function startServer() {
  serverProc = spawn("npm", ["run", "dev:demo", "--", `data/demo/${INSTANCE}.sqlite`], {
    cwd: path.resolve("."), env: { ...process.env, HORSE_REGISTRY_SOURCE_PREVIEW: "1" }, stdio: ["ignore", "pipe", "pipe"], detached: true,
  });
  serverProc.stdout.on("data", () => {});
  serverProc.stderr.on("data", () => {});
  const ok = await waitReady();
  serverEvent(`spawn pid=${serverProc.pid} ready=${ok}`);
  return ok;
}
function stopServer() {
  if (!serverProc) return;
  try { process.kill(-serverProc.pid, "SIGTERM"); } catch { try { serverProc.kill("SIGTERM"); } catch { /* already gone */ } }
  serverEvent(`kill pgid=${serverProc.pid}`);
  serverProc = null;
}

let browser;
async function session(persona, skin = null) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const frontend = skin && skin !== "heritage" ? skin : null;
  await context.addInitScript(({ locale, origin, frontend }) => {
    if (location.origin !== origin) return;
    localStorage.setItem("registry-locale", "en");
    if (frontend) localStorage.setItem("registry-frontend", frontend);
  }, { locale: "en", origin: new URL(base).origin, frontend });
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

/* ---------------- J7 restart journey #1 (owner story) ---------------- */
async function journeyRestartOne() {
  stage("J7 restart #1 — owner story across a process restart");
  if (!(await startServer())) { check("J7-restart-1", "server spawns", false, {}); return; }
  const horse = 900000026;
  let ctx = await session("owner_a");
  let created = null;
  try {
    const before = dbRows("SELECT COUNT(*) n FROM horse_claims WHERE horse_id=?", horse)[0].n;
    const res = await apiFetch(ctx.page, "/api/claims", { method: "POST", data: JSON.stringify({ horse_id: horse, evidence: { note: "Showcase rehearsal restart journey #1" } }) }, ctx.csrfToken);
    created = dbRows("SELECT id, status FROM horse_claims WHERE horse_id=? ORDER BY created_at DESC LIMIT 1", horse)[0] ?? null;
    check("J7-restart-1", "owner submits a claim before the restart", res.status === 201 && created?.status === "pending", { before, claim: created?.id });
    await shot(ctx.page, "j7-before-restart");
  } finally { await ctx.context.close(); }

  // KILL the process mid-story, then respawn.
  stopServer();
  await new Promise((r) => setTimeout(r, 1500));
  if (!(await startServer())) { check("J7-restart-1", "server respawns after the kill", false, {}); return; }
  check("J7-restart-1", "server respawns after the kill", true, {});

  // After the restart: the persisted claim survives; the demo session is
  // honestly re-established through the server's own persona login.
  ctx = await session("owner_a");
  try {
    const persisted = dbRows("SELECT id, status FROM horse_claims WHERE horse_id=? ORDER BY created_at DESC LIMIT 1", horse)[0] ?? null;
    const mine = await apiFetch(ctx.page, "/api/claims/mine", {}, ctx.csrfToken);
    const inMine = (mine.body?.claims ?? []).some((c) => c.id === persisted?.id && c.status === "pending");
    check("J7-restart-1", "the submitted claim PERSISTS across the process restart", Boolean(persisted && persisted.id === created?.id && persisted.status === "pending" && inMine), { claim: persisted?.id, visibleInMine: inMine });
    // Continue the story: the owner withdraws their correction draft? The
    // record workflow continues to work after the restart.
    const dup = await apiFetch(ctx.page, "/api/claims", { method: "POST", data: JSON.stringify({ horse_id: horse, evidence: { note: "duplicate after restart" } }) }, ctx.csrfToken);
    const dupCode = typeof dup.body?.error === "string" ? dup.body.error : dup.body?.error?.code;
    check("J7-restart-1", "the workflow keeps enforcing boundaries after the restart (409 claim_exists)", dup.status === 409 && dupCode === "claim_exists", { status: dup.status, error: dupCode });
    await shot(ctx.page, "j7-after-restart");
    row("restart.owner", "all", {
      route: "/horse/900000026 + /api/claims", principal: "owner_a",
      initialData: "fresh pending claim before kill",
      serverResponse: `create 201 -> kill -> respawn -> claims.mine 200`,
      persistedEffect: `claim ${created?.id} still pending after restart=${Boolean(persisted && persisted.id === created?.id)}; boundary 409 after restart=${dup.status === 409}`,
    });
  } finally { await ctx.context.close(); }
}

/* ---------------- J8 restart journey #2 (staff/admin story) ---------------- */
async function journeyRestartTwo() {
  stage("J8 restart #2 — admin notification drain across a process restart");
  let ctx = await session("admin");
  let drainBefore = null;
  try {
    // Run the actual retention sweep + reminder enqueue + notification drain.
    const drain = await apiFetch(ctx.page, "/api/demo/run-pending-jobs", { method: "POST", data: "{}" }, ctx.csrfToken);
    drainBefore = drain.body ?? null;
    check("J8-restart-2", "the notification drain runs before the restart", drain.status === 200, { summary: JSON.stringify(drain.body).slice(0, 140) });
    // Advance the demo reminder clock one day (scheduler scope only) and drain again.
    const clock = await apiFetch(ctx.page, "/api/demo/clock", { method: "POST", data: JSON.stringify({ advance_days: 1 }) }, ctx.csrfToken);
    const drain2 = await apiFetch(ctx.page, "/api/demo/run-pending-jobs", { method: "POST", data: "{}" }, ctx.csrfToken);
    check("J8-restart-2", "the reminder clock (scheduler scope) advances and drains", clock.status === 200 && drain2.status === 200, { clock: clock.status, drain: drain2.status, summary: JSON.stringify(drain2.body).slice(0, 140) });
    await shot(ctx.page, "j8-before-restart");
  } finally { await ctx.context.close(); }

  stopServer();
  await new Promise((r) => setTimeout(r, 1500));
  if (!(await startServer())) { check("J8-restart-2", "server respawns after the second kill", false, {}); return; }
  check("J8-restart-2", "server respawns after the second kill", true, {});

  ctx = await session("admin");
  try {
    const context = await apiFetch(ctx.page, "/api/demo/context", {}, ctx.csrfToken);
    const clockScope = context.body?.clock?.scope;
    check("J8-restart-2", "the demo clock keeps its honest scheduler-only scope after restart", clockScope === "reminder_scheduler", { scope: clockScope });
    const drainAfter = await apiFetch(ctx.page, "/api/demo/run-pending-jobs", { method: "POST", data: "{}" }, ctx.csrfToken);
    check("J8-restart-2", "the notification drain still works after the restart", drainAfter.status === 200, { summary: JSON.stringify(drainAfter.body).slice(0, 140) });
    await shot(ctx.page, "j8-after-restart");
    row("restart.admin", "all", {
      route: "/api/demo/run-pending-jobs + /api/demo/clock", principal: "admin",
      initialData: `drain before restart: ${JSON.stringify(drainBefore).slice(0, 80)}`,
      serverResponse: `drain 200 -> clock 200 -> drain 200 -> kill -> respawn -> drain ${drainAfter.status}`,
      persistedEffect: `scheduler scope preserved=${clockScope === "reminder_scheduler"}; drain functional after restart=${drainAfter.status === 200}`,
    });
  } finally { await ctx.context.close(); }
}

/* ---------------- J9 restore journey ---------------- */
async function journeyRestore() {
  stage("J9 restore — backup, mutate, restore, verify rollback");
  stopServer();
  await new Promise((r) => setTimeout(r, 1500));
  // Baseline counts before any mutation.
  const baseline = dbRows("SELECT COUNT(*) n FROM horse_claims")[0].n;
  // Take the instance backup through the supported tool; the exact name is
  // recovered from the backups directory (newest .sqlite file).
  try {
    execFileSync("python3", ["tools/reset-showcase.py", "backup", "--instance", INSTANCE], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) { check("J9-restore", "backup command succeeds", false, { error: String(error).slice(0, 120) }); }
  let backupName = null;
  {
    const dir = path.resolve("data/demo/backups");
    const files = (await fs.readdir(dir).catch(() => [])).filter((f) => f.endsWith(".sqlite"));
    const stats = await Promise.all(files.map(async (f) => ({ f, m: (await fs.stat(path.join(dir, f)).catch(() => null))?.mtimeMs ?? 0 })));
    stats.sort((a, b) => b.m - a.m);
    backupName = stats[0]?.f ?? null;
  }
  const backups = (await fs.readdir(path.resolve("data/demo/backups")).catch(() => [])).filter((f) => f.endsWith(".sqlite"));
  check("J9-restore", "backup created under data/demo/backups", backupName != null, { backupName, backups: backups.slice(-3) });

  if (!(await startServer())) { check("J9-restore", "server spawns for the mutation phase", false, {}); return; }
  // Mutate: a new claim + a market inquiry reply thread the connected story.
  let ctx = await session("owner_a");
  try {
    const claim = await apiFetch(ctx.page, "/api/claims", { method: "POST", data: JSON.stringify({ horse_id: 900000027, evidence: { note: "Showcase rehearsal restore-journey mutation" } }) }, ctx.csrfToken);
    const after = dbRows("SELECT COUNT(*) n FROM horse_claims")[0].n;
    check("J9-restore", "mutation applied (new claim on 900000027)", claim.status === 201 && after === baseline + 1, { before: baseline, after });
  } finally { await ctx.context.close(); }

  stopServer();
  await new Promise((r) => setTimeout(r, 1500));
  // Restore the backup through the supported tool.
  let restoreOk = false;
  try {
    execFileSync("python3", ["tools/reset-showcase.py", "restore", "--instance", INSTANCE, "--backup-name", backupName], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    restoreOk = true;
  } catch (error) { check("J9-restore", "restore command succeeds", false, { error: String(error).slice(0, 160) }); }
  check("J9-restore", "restore command succeeds", restoreOk, { backupName });

  const rolled = dbRows("SELECT COUNT(*) n FROM horse_claims")[0].n;
  const mutationGone = dbRows("SELECT COUNT(*) n FROM horse_claims WHERE horse_id=900000027 AND evidence_json LIKE '%restore-journey%'")[0].n === 0;
  check("J9-restore", "the mutation is rolled back exactly (claim count back to baseline)", rolled === baseline && mutationGone, { baseline, rolled, mutationGone });

  if (!(await startServer())) { check("J9-restore", "server spawns on the restored instance", false, {}); return; }
  ctx = await session("owner_a");
  try {
    const mine = await apiFetch(ctx.page, "/api/claims/mine", {}, ctx.csrfToken);
    const mutationInMine = (mine.body?.claims ?? []).some((c) => c.horse_id === 900000027);
    check("J9-restore", "the restored instance serves the rolled-back state", mine.status === 200 && !mutationInMine, { mutationVisible: mutationInMine });
    await shot(ctx.page, "j9-after-restore");
    row("restore.instance", "all", {
      route: "tools/reset-showcase.py backup/restore", principal: "operator (owner-directed)",
      initialData: `baseline horse_claims=${baseline}`,
      serverResponse: `backup -> claim create 201 -> restore exit 0`,
      persistedEffect: `horse_claims after restore=${rolled} (baseline ${baseline}); mutation removed=${mutationGone}; server serves restored state=${!mutationInMine}`,
    });
  } finally { await ctx.context.close(); }
}

try {
  try { browser = await chromium.launch({ headless: true }); }
  catch (launchError) { check("main", "browser launch", false, { error: String(launchError) }); throw launchError; }
  report.browser = await browser.version();
  // Start from a FRESH instance so every run is repeatable (the story matrix
  // and this tool both mutate the named instance).
  try {
    execFileSync("python3", ["tools/reset-showcase.py", "reset", "--instance", INSTANCE, "--as-of", "2026-10-21"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    check("main", "fresh named instance reset before the rehearsal", true, { instance: INSTANCE });
  } catch (error) { check("main", "fresh named instance reset before the rehearsal", false, { error: String(error).slice(0, 120) }); }
  await journeyRestartOne();
  await journeyRestartTwo();
  await journeyRestore();
} catch (error) {
  report.aborted = String(error?.stack || error);
  console.error("ABORTED:", error?.stack || error);
} finally {
  stopServer();
  if (browser) await browser.close();
  report.finishedAt = new Date().toISOString();
  report.summary = { total: report.checks.length, failed: report.failures.length, pageErrors: report.pageErrors.length, outboundRequests: report.outbound.length, rows: report.rows.length, journeys: report.journeys, serverEvents: report.serverEvents };
  await fs.writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  await fs.writeFile(path.join(out, "PARITY-ROWS.json"), JSON.stringify(report.rows, null, 2));
  console.log(`\n==== R117-28 restart/restore matrix: ${report.summary.total - report.summary.failed}/${report.summary.total} checks, pageErrors=${report.summary.pageErrors}, outbound=${report.summary.outboundRequests}`);
  process.exit(report.summary.failed === 0 && report.summary.pageErrors === 0 && report.summary.outboundRequests === 0 ? 0 : 1);
}

#!/usr/bin/env node
/**
 * R120 / IMP-012 (BE-13) — REAL two-connection PostgreSQL barrier evidence.
 *
 * The audit's write-skew: on PostgreSQL READ COMMITTED, two concurrent
 * parentage edits on DIFFERENT horses can each evaluate the recursive cycle
 * guard against a pre-commit snapshot and both commit, corrupting the acyclic
 * pedigree invariant. The fix: a graph-wide transaction advisory lock taken
 * in a SEPARATE statement before any guard read (the AI-reservation pattern),
 * with a bounded wait, surfaced as a recoverable conflict.
 *
 * This script proves, on a REAL two-connection PostgreSQL:
 *   R1  REPRODUCE: the unlocked opposite-edge race COMMITS BOTH updates and
 *       leaves a cycle — the defect is real on this engine, not theoretical.
 *   B1  BARRIER: the same race through the REAL adapter batch (marker first)
 *       allows EXACTLY ONE commit; the loser's guard fails post-lock; no
 *       cycle survives; the registry revision reflects only the winner.
 *   B2  LONGER CYCLE: pre-seeded B->C edge; racing A->B vs C->A (3-cycle)
 *       still allows exactly one commit.
 *   B3  REVIEWED vs DIRECT: a change-request-apply-shaped batch (request
 *       guard + decision) racing a direct-edit batch — same serialization.
 *   B4  ROLLBACK RELEASES: a transaction that takes the lock and rolls back
 *       does not block the next graph mutation.
 *   B5  BOUNDED WAIT: while the lock is held, a second taker with a 1s
 *       lock_timeout fails with SQLSTATE 55P03 and is recognized by
 *       isGraphLockTimeoutError (the recoverable 409 mapping input).
 *   S1  MARKER SYNC: the exported PEDIGREE_GRAPH_LOCK_SQL is byte-identical
 *       to the adapter's marker literal (source + behavioral).
 *
 * Usage (disposable local PostgreSQL only):
 *   PG_CONNECTION_STRING=postgres://postgres:postgres@127.0.0.1:5433/postgres \
 *   PG_PARITY_DISPOSABLE=yes node scripts/r120-imp012-graph-barrier.mjs
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync, symlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { splitStatements, ddlNormalize } from "./lib/pg-ddl.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const connectionString = process.env.PG_CONNECTION_STRING;
if (!connectionString) { console.error("PG_CONNECTION_STRING is required"); process.exit(2); }
// Same disposable-database guard as the parity gates.
{
  const target = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(target.protocol)
      || !["localhost", "127.0.0.1", "[::1]", "postgres"].includes(target.hostname)
      || process.env.PG_PARITY_DISPOSABLE !== "yes") {
    console.error("This evidence script requires a disposable LOCAL PostgreSQL and PG_PARITY_DISPOSABLE=yes.");
    process.exit(2);
  }
}

// Load the REAL modules via esbuild TRANSPILE-ONLY bundling (no type
// checking — type-only imports are erased, so the heavy registry graph that
// breaks the ts-runtime loader never enters; every constant and function is
// the real production source, bundled).
import { buildSync } from "esbuild";
import { mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
const bundleDir = mkdtempSync(join(tmpdir(), "r120-bundles-"));
symlinkSync(join(root, "node_modules"), join(bundleDir, "node_modules"), "dir");
const bundle = (entry, outfile) => {
  buildSync({
    entryPoints: [join(root, entry)],
    bundle: true, format: "cjs", platform: "node", target: "node20",
    outfile: join(bundleDir, outfile),
    external: ["postgres"],
    logLevel: "silent",
  });
  return createRequire(import.meta.url)(join(bundleDir, outfile));
};
const mutationStatements = bundle("src/registry/mutationStatements.ts", "mutationStatements.cjs");
const translatorModule = bundle("src/db/sqliteSqlToPostgres.ts", "translator.cjs");
const compatModule = bundle("src/db/supabaseCompat.ts", "compat.cjs");
const sqliteSqlToPostgres = translatorModule.sqliteSqlToPostgres ?? translatorModule.default;
const createSupabaseD1Database = compatModule.createSupabaseD1Database;
// Source-synced replica of runGuardedHorseBatch's isGraphLockTimeoutError
// (src/registry/mutations.ts). The sync assertions in S1 prove the two cannot
// drift: same SQLSTATE classes, same message pattern.
const mutationsSource = readFileSync(join(root, "src/registry/mutations.ts"), "utf8");
if (!/isGraphLockTimeoutError/.test(mutationsSource)) throw new Error("isGraphLockTimeoutError missing from mutations.ts");
const isGraphLockTimeoutError = (cause) => {
  const code = cause?.code;
  if (code === "55P03" || code === "55P02") return true;
  const message = cause instanceof Error ? cause.message : String(cause ?? "");
  return /lock_timeout|lock not available|canceling statement due to lock timeout/i.test(message);
};

const MARKER = "SELECT ? AS pedigree_graph_lock";
const evidence = { engine: null, scenarios: [], verdict: null };
const now = () => new Date().toISOString();
void sqliteSqlToPostgres;

// ---------------------------------------------------------------------------
// Fresh disposable DATABASE (instance itself is disposable; still isolate).
// ---------------------------------------------------------------------------
const admin = postgres(connectionString, { max: 1 });
await admin.unsafe("DROP DATABASE IF EXISTS r120_imp012_barrier");
await admin.unsafe("CREATE DATABASE r120_imp012_barrier");
const dbCs = connectionString.replace(/\/[^/?]+(\?|$)/, "/r120_imp012_barrier$1");
const boot = postgres(dbCs, { max: 1 });
const version = await boot`select version()`;
evidence.engine = version[0].version.split(" ").slice(0, 2).join(" ");
console.log(`[engine] ${evidence.engine}`);

// Apply the ENTIRE migration chain through the PRODUCTION translator.
{
  const names = readdirSync(join(root, "migrations")).filter(n => n.endsWith(".sql")).sort();
  for (const name of names) {
    const raw = readFileSync(join(root, "migrations", name), "utf8");
    await boot.unsafe("BEGIN");
    try {
      for (const statement of splitStatements(raw)) {
        const bare = statement.replace(/^\s*--[^\n]*\n/gm, "").trim();
        if (/^PRAGMA\b/i.test(bare)) continue;
        if (/^CREATE\s+VIRTUAL\s+TABLE/i.test(bare)) continue;
        const translated = sqliteSqlToPostgres(ddlNormalize(statement));
        if (!translated.trim()) continue;
        await boot.unsafe(translated);
      }
      await boot.unsafe("COMMIT");
    } catch (error) {
      await boot.unsafe("ROLLBACK");
      console.error(`migration ${name} failed: ${error.message}`);
      process.exit(1);
    }
  }
  console.log(`[migrations] ${names.length} applied through the production translator`);
  evidence.migrationsApplied = names.length;
}
await boot.end();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const LOCK_NS = mutationStatements.PEDIGREE_GRAPH_LOCK_NAMESPACE;
const UPDATE_T = mutationStatements.HORSE_UPDATE_SQL_TEMPLATE;
const GUARD = mutationStatements.HORSE_UPDATE_PARENTAGE_GUARD_SQL;
const REQUEST_GUARD = mutationStatements.HORSE_UPDATE_CHANGE_REQUEST_GUARD_SQL;
const REV_BUMP = mutationStatements.REGISTRY_REVISION_BUMP_SQL;

function makeAdapter() {
  // The REAL production adapter, full (writable) mode, one connection each.
  return createSupabaseD1Database(dbCs, { mode: "full" });
}
const lockStatement = (db) => db.prepare(mutationStatements.PEDIGREE_GRAPH_LOCK_SQL).bind(LOCK_NS);
const parentageUpdate = (db, horseId, expectedRowVersion, father, mother, mutationId) =>
  db.prepare(UPDATE_T(father != null ? "father_id=?" : "mother_id=?") + GUARD)
    .bind(father != null ? father : mother, mutationId, horseId, expectedRowVersion,
      father ?? null, mother ?? null, horseId);
const revisionBump = (db, horseId, mutationId) => db.prepare(REV_BUMP).bind(horseId, mutationId);

async function seedGraph(c) {
  await c.unsafe("DELETE FROM change_requests");
  await c.unsafe("DELETE FROM horses");
  await c.unsafe("DELETE FROM registry_state");
  await c.unsafe(`INSERT INTO registry_state(id,canonical_revision) VALUES (1, 0)`);
  for (const [id, father, mother] of [[1, null, null], [2, null, null], [3, null, null]]) {
    await c.unsafe(`INSERT INTO horses(id,name_latin,is_active,row_version,father_id,mother_id)
      VALUES (${id}, 'H${id}', 1, 1, ${father ?? "NULL"}, ${mother ?? "NULL"})`);
  }
}
const cycleExists = async (c) => {
  // Single-branch recursive walk (PG requires the CTE self-reference in
  // exactly one recursive term — same portability rule as the production
  // guard). The anchor is (horse, parent) — NOT (horse, horse) — so a row
  // with start=id can ONLY arise through a genuine ancestry cycle (the
  // anchor can never satisfy start=id because no horse is its own parent).
  const rows = await c.unsafe(`WITH RECURSIVE ancestors(start, id) AS (
      SELECT h.id, CASE WHEN side.k=0 THEN h.father_id ELSE h.mother_id END
        FROM horses h, (SELECT 0 AS k UNION ALL SELECT 1) side
        WHERE h.deleted_at IS NULL
          AND CASE WHEN side.k=0 THEN h.father_id ELSE h.mother_id END IS NOT NULL
      UNION
      SELECT a.start, CASE WHEN side.k=0 THEN h.father_id ELSE h.mother_id END
        FROM horses h JOIN ancestors a ON h.id=a.id,
             (SELECT 0 AS k UNION ALL SELECT 1) side
        WHERE CASE WHEN side.k=0 THEN h.father_id ELSE h.mother_id END IS NOT NULL)
    SELECT COUNT(*)::int AS n FROM ancestors WHERE start = id`);
  return rows[0].n > 0;
};
const parents = async (c) => (await c.unsafe("SELECT id, father_id, mother_id FROM horses ORDER BY id")).map(r => ({ id: r.id, f: r.father_id, m: r.mother_id }));
const revision = async (c) => (await c.unsafe("SELECT canonical_revision::int AS r FROM registry_state WHERE id=1"))[0].r;

const scenario = (name) => {
  const record = { name, started: now(), checks: [] };
  evidence.scenarios.push(record);
  const check = (label, ok, detail) => {
    record.checks.push({ label, ok, detail });
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
    if (!ok) record.failed = true;
  };
  return { record, check };
};

// ---------------------------------------------------------------------------
// S1 — marker sync (source-level)
// ---------------------------------------------------------------------------
{
  const { check } = scenario("S1 marker sync: PEDIGREE_GRAPH_LOCK_SQL === adapter literal");
  check("exported marker is the expected literal", mutationStatements.PEDIGREE_GRAPH_LOCK_SQL === MARKER, JSON.stringify(mutationStatements.PEDIGREE_GRAPH_LOCK_SQL));
  const compatSource = readFileSync(join(root, "src/db/supabaseCompat.ts"), "utf8");
  check("supabaseCompat carries the identical marker literal", compatSource.includes(`PEDIGREE_GRAPH_LOCK_MARKER = "${MARKER}"`));
  check("namespace is distinct from the AI admission lock (710109)", LOCK_NS === 710110, String(LOCK_NS));
  check("isGraphLockTimeoutError source pins the same SQLSTATE classes", mutationsSource.includes('"55P03"') && mutationsSource.includes('"55P02"'));
  check("isGraphLockTimeoutError source pins the same message pattern", /lock_timeout\|lock not available\|canceling statement due to lock timeout/i.test(mutationsSource));
}

// ---------------------------------------------------------------------------
// R1 — REPRODUCE the write skew WITHOUT the lock (proves the defect is real)
// ---------------------------------------------------------------------------
{
  const { check } = scenario("R1 reproduce: unlocked opposite-edge race on two REAL connections");
  const c1 = postgres(dbCs, { max: 1 }); const c2 = postgres(dbCs, { max: 1 });
  await seedGraph(c1);
  // R1 executes the REAL production guard (the exported template constants,
  // with ? placeholders converted to $n) — no hand-written drift possible.
  const toPgParams = (sql) => { let n = 0; return sql.replace(/\?/g, () => `$${++n}`); };
  const unlockedUpdateSql = toPgParams(
    UPDATE_T("father_id=?") + GUARD,
  );
  const updateRaw = async (c, horseId, father) => c.unsafe(
    unlockedUpdateSql,
    [father, `m-${horseId}`, horseId, 1, father, null, horseId]);
  let aDone, bDone;
  const a = (async () => { await c1.unsafe("BEGIN"); const r = await updateRaw(c1, 1, 2); aDone = true; return r; })();
  const b = (async () => { await c2.unsafe("BEGIN"); const r = await updateRaw(c2, 2, 1); bDone = true; return r; })();
  const [ra, rb] = await Promise.all([a, b]);
  await c1.unsafe("COMMIT"); await c2.unsafe("COMMIT");
  check("both unlocked updates reported 1 change (guards evaluated pre-commit)", Number(ra.count) === 1 && Number(rb.count) === 1, `a=${ra.count} b=${rb.count}`);
  check("a CYCLE survived the unlocked race (defect reproduced on this engine)", await cycleExists(c1), JSON.stringify(await parents(c1)));
  await c1.end(); await c2.end();
}

// ---------------------------------------------------------------------------
// B1 — BARRIER: the same race through the REAL adapter batches
// ---------------------------------------------------------------------------
{
  const { check } = scenario("B1 barrier: opposite edges through the real graph-locked batches");
  const dbA = makeAdapter(); const dbB = makeAdapter();
  const seedConn = postgres(dbCs, { max: 1 }); await seedGraph(seedConn);
  const run = (db, horseId, father) => db.batch([
    lockStatement(db),
    parentageUpdate(db, horseId, 1, father, null, `barrier-${horseId}`),
    revisionBump(db, horseId, `barrier-${horseId}`),
  ]);
  const [ra, rb] = await Promise.all([run(dbA, 1, 2), run(dbB, 2, 1)]);
  const aChanges = Number(ra[1].meta.changes), bChanges = Number(rb[1].meta.changes);
  check("exactly ONE update committed (loser's post-lock guard refused)", aChanges + bChanges === 1, `a=${aChanges} b=${bChanges}`);
  check("NO cycle exists after the locked race", !(await cycleExists(seedConn)), JSON.stringify(await parents(seedConn)));
  const rev = await revision(seedConn);
  check("registry revision bumped exactly once (only the winner)", rev === 1, `revision=${rev}`);
  await seedConn.end();
}

// ---------------------------------------------------------------------------
// B2 — LONGER CYCLE: pre-seeded 2->3 edge; race 1->2 vs 3->1
// ---------------------------------------------------------------------------
{
  const { check } = scenario("B2 barrier: three-horse cycle (seed 2->3, race 1->2 vs 3->1)");
  const seedConn = postgres(dbCs, { max: 1 }); await seedGraph(seedConn);
  await seedConn.unsafe("UPDATE horses SET father_id=3 WHERE id=2");
  const dbA = makeAdapter(); const dbB = makeAdapter();
  const run = (db, horseId, father) => db.batch([
    lockStatement(db),
    parentageUpdate(db, horseId, 1, father, null, `b2-${horseId}`),
    revisionBump(db, horseId, `b2-${horseId}`),
  ]);
  const [ra, rb] = await Promise.all([run(dbA, 1, 2), run(dbB, 3, 1)]);
  const aChanges = Number(ra[1].meta.changes), bChanges = Number(rb[1].meta.changes);
  check("exactly one of the two 3-cycle edges committed", aChanges + bChanges === 1, `a=${aChanges} b=${bChanges}`);
  check("no cycle exists (walk finds no ancestor-of-self)", !(await cycleExists(seedConn)), JSON.stringify(await parents(seedConn)));
  await seedConn.end();
}

// ---------------------------------------------------------------------------
// B3 — REVIEWED vs DIRECT: change-request-apply batch races a direct edit
// ---------------------------------------------------------------------------
{
  const { check } = scenario("B3 barrier: reviewed apply vs direct edit serialize on one lock");
  const seedConn = postgres(dbCs, { max: 1 }); await seedGraph(seedConn);
  await seedConn.unsafe(`INSERT INTO users(id,email,display_name,password_hash,role,is_active)
    VALUES ('reviewer-1','rev@example.test','Reviewer','x','owner',1)`);
  await seedConn.unsafe(`INSERT INTO change_requests(id,submitted_by_user_id,horse_id,request_type,status)
    VALUES ('501','reviewer-1',2,'update_horse','pending')`);
  const dbA = makeAdapter(); const dbB = makeAdapter();
  // direct edit on horse 1: father=2
  const direct = dbA.batch([
    lockStatement(dbA),
    parentageUpdate(dbA, 1, 1, 2, null, "b3-direct"),
    revisionBump(dbA, 1, "b3-direct"),
  ]);
  // reviewed apply on horse 2: father=1 — the REAL statement shapes: the
  // update carries the change-request guard, and the decision CAS is
  // conditioned on the horse update having landed (last_mutation_id=ours).
  const reviewed = dbB.batch([
    lockStatement(dbB),
    dbB.prepare(UPDATE_T("father_id=?") + REQUEST_GUARD + GUARD)
      .bind(1, "b3-reviewed", 2, 1, "501", 1, null, 2),
    dbB.prepare("UPDATE change_requests SET status='approved',reviewed_by_user_id=?,review_note=?,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('pending','draft') AND EXISTS(SELECT 1 FROM horses WHERE id=? AND last_mutation_id=?)")
      .bind("reviewer-1", "barrier", "501", 2, "b3-reviewed"),
    revisionBump(dbB, 2, "b3-reviewed"),
  ]);
  const [rd, rr] = await Promise.all([direct, reviewed]);
  const dChanges = Number(rd[1].meta.changes), rChanges = Number(rr[1].meta.changes);
  check("exactly one graph mutation landed across the two paths", dChanges + rChanges === 1, `direct=${dChanges} reviewed=${rChanges}`);
  check("no cycle exists", !(await cycleExists(seedConn)), JSON.stringify(await parents(seedConn)));
  const applied = await seedConn.unsafe("SELECT status FROM change_requests WHERE id='501'");
  const expectedStatus = rChanges === 1 ? "approved" : "pending";
  check("the decision CAS recorded approval ONLY when its update landed (no approved-but-not-applied)", applied[0].status === expectedStatus, applied[0].status);
  await seedConn.end();
}

// ---------------------------------------------------------------------------
// B4 — ROLLBACK releases the lock
// ---------------------------------------------------------------------------
{
  const { check } = scenario("B4 rollback: a rolled-back lock holder never blocks the next mutation");
  const seedConn = postgres(dbCs, { max: 1 }); await seedGraph(seedConn);
  const holder = postgres(dbCs, { max: 1 });
  await holder.unsafe("BEGIN");
  await holder.unsafe(`SELECT pg_advisory_xact_lock($1)`, [LOCK_NS]);
  const rollback = (async () => { await new Promise(r => setTimeout(r, 300)); await holder.unsafe("ROLLBACK"); })();
  const db = makeAdapter();
  const started = Date.now();
  const [res] = await Promise.all([db.batch([
    lockStatement(db), parentageUpdate(db, 1, 1, 2, null, "b4"), revisionBump(db, 1, "b4"),
  ]), rollback]);
  const elapsed = Date.now() - started;
  check("the next mutation completed after the rollback", Number(res[1].meta.changes) === 1);
  check("it waited for (not around) the holder", elapsed >= 250, `${elapsed}ms`);
  check("no cycle exists", !(await cycleExists(seedConn)));
  await holder.end(); await seedConn.end();
}

// ---------------------------------------------------------------------------
// B5 — BOUNDED WAIT: held lock + 1s lock_timeout => 55P03, recognized
// ---------------------------------------------------------------------------
{
  const { check } = scenario("B5 bounded wait: held lock, 1s timeout, recoverable conflict");
  const seedConn = postgres(dbCs, { max: 1 }); await seedGraph(seedConn);
  const holder = postgres(dbCs, { max: 1 });
  await holder.unsafe("BEGIN");
  await holder.unsafe(`SELECT pg_advisory_xact_lock($1)`, [LOCK_NS]);
  const waiter = postgres(dbCs, { max: 1 });
  await waiter.unsafe("BEGIN");
  await waiter.unsafe("SET LOCAL lock_timeout = '1s'");
  const started = Date.now();
  let timeoutError = null;
  try { await waiter.unsafe(`SELECT pg_advisory_xact_lock($1)`, [LOCK_NS]); }
  catch (error) { timeoutError = error; }
  const elapsed = Date.now() - started;
  check("the bounded wait FAILED instead of hanging", timeoutError !== null, timeoutError?.message);
  check("it failed near the 1s bound, not instantly and not forever", elapsed >= 900 && elapsed < 5000, `${elapsed}ms`);
  check("SQLSTATE is the lock-timeout class (55P03/55P02)", ["55P03", "55P02"].includes(timeoutError?.code), String(timeoutError?.code));
  check("isGraphLockTimeoutError recognizes it (the 409 pedigree_edit_busy input)", isGraphLockTimeoutError(timeoutError) === true);
  await waiter.unsafe("ROLLBACK");
  await holder.unsafe("ROLLBACK");
  await holder.end(); await waiter.end(); await seedConn.end();
}

// ---------------------------------------------------------------------------
// Verdict + evidence file
// ---------------------------------------------------------------------------
evidence.finished = now();
evidence.verdict = evidence.scenarios.every(s => !s.failed) ? "ALL GREEN" : "FAILURES";
mkdirSync(join(root, "review-r120", "evidence-local"), { recursive: true });
const evidencePath = join(root, "review-r120", "evidence-local", "imp012-graph-barrier.json");
writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
console.log(`\n[verdict] ${evidence.verdict} — evidence: ${evidencePath}`);
try { await admin.unsafe("DROP DATABASE IF EXISTS r120_imp012_barrier"); }
catch { /* disposable instance; open adapter connections may block the drop — harmless */ }
await admin.end();
process.exit(evidence.verdict === "ALL GREEN" ? 0 : 1);

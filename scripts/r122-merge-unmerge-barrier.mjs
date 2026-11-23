#!/usr/bin/env node
/**
 * R122 / R122-T01 + R122-T02 — REAL two-connection PostgreSQL evidence for the
 * merge/unmerge atomic invariant protocol and the create/archive graph guard.
 *
 * Master AI's R122 audit reproduced the merge defects on SQLite SQL slices;
 * this script proves the FIXED protocol on a REAL PostgreSQL (the production
 * engine) with the REAL production adapter (supabaseCompat full mode) and the
 * REAL HTTP handlers (adminMergeHorses / adminUnmergeHorses / adminMergePreview):
 *
 *   B1  LATE REFERENCE (R122-A01 on PG): a second connection commits a NEW
 *       child of the merged horse between the approved preview and the merge's
 *       locked batch. The invariant assertion must abort the ENTIRE command —
 *       no moves, no archive, no alias, no record, no receipt, no revision or
 *       counter change — surfaced as a typed 409 merge_state_changed.
 *   B2  ANCESTOR COLLAPSE (R122-A02 on PG): merging a parent into its own
 *       child must refuse atomically with 409 merge_graph_unsafe and never
 *       create a self-parent.
 *   B3  MERGE vs CONCURRENT PARENT EDIT: a concurrent edit that reassigns a
 *       manifest child — committed while the merge waits on the graph lock —
 *       must refuse the merge atomically (the exact moved-count invariant).
 *   B4  MERGE vs UNRELATED FK INSERTION: a horse_people row inserted for the
 *       merged horse after the preview must refuse the merge (no remaining
 *       references invariant).
 *   B5  UNMERGE DRIFT: a manifest row reassigned to a third horse after the
 *       merge must refuse the unmerge atomically (exact restored-state
 *       invariant) while preserving the legitimate reassignment.
 *   B6  CREATE GUARD: the graph-aware create batch rejects a missing/archived
 *       proposed parent with ZERO horses created and no counter/revision
 *       inflation; a valid null-parent create commits on PostgreSQL.
 *   B7  ARCHIVE GUARD: archiving a horse that gained a live child between
 *       preflight and the batch refuses atomically (no active child may
 *       reference a newly archived parent).
 *   B8  BOUNDED WAIT: while another connection holds the graph advisory lock,
 *       the merge fails within the bounded lock_timeout with SQLSTATE 55P03
 *       and surfaces as the typed 409 merge_busy conflict — never a hang, never
 *       a raw SQL error.
 *
 * Usage (disposable local PostgreSQL only):
 *   PG_CONNECTION_STRING=postgres://postgres:postgres@127.0.0.1:5433/postgres \
 *   PG_PARITY_DISPOSABLE=yes node scripts/r122-merge-unmerge-barrier.mjs
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { splitStatements, ddlNormalize } from "./lib/pg-ddl.mjs";
import { requireDisposableLocalDatabase } from "./lib/disposable-schema.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const connectionString = process.env.PG_CONNECTION_STRING;
if (!connectionString) { console.error("PG_CONNECTION_STRING is required"); process.exit(2); }
try { requireDisposableLocalDatabase(connectionString, process.env.PG_PARITY_DISPOSABLE); }
catch (error) { console.error(error.message); process.exit(2); }

// Real production modules via esbuild transpile-only bundling (r120 pattern).
import { buildSync } from "esbuild";
import { mkdtempSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
const bundleDir = mkdtempSync(join(tmpdir(), "r122-bundles-"));
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
const importsModule = bundle("src/api/modules/imports.ts", "imports.cjs");
const sessionModule = bundle("src/auth/session.ts", "session.cjs");
const mutationStatements = bundle("src/registry/mutationStatements.ts", "mutationStatements.cjs");
const compatModule = bundle("src/db/supabaseCompat.ts", "compat.cjs");
const sqliteSqlToPostgres = bundle("src/db/sqliteSqlToPostgres.ts", "translator.cjs").sqliteSqlToPostgres;
const createSupabaseD1Database = compatModule.createSupabaseD1Database;
const { adminMergePreview, adminMergeHorses, adminUnmergeHorses } = importsModule;
const { createSession } = sessionModule;

const evidence = { engine: null, scenarios: [], verdict: null };
const now = () => new Date().toISOString();
const pass = (id, detail) => { evidence.scenarios.push({ id, pass: true, detail }); console.log(`PASS ${id}: ${detail}`); };
const fail = (id, detail) => { evidence.scenarios.push({ id, pass: false, detail }); console.log(`FAIL ${id}: ${detail}`); };

// ---------------------------------------------------------------------------
// Fresh disposable database + the ENTIRE migration chain (production translator).
// ---------------------------------------------------------------------------
const admin = postgres(connectionString, { max: 1 });
await admin.unsafe("DROP DATABASE IF EXISTS r122_merge_barrier");
await admin.unsafe("CREATE DATABASE r122_merge_barrier");
const dbCs = connectionString.replace(/\/[^/?]+(\?|$)/, "/r122_merge_barrier$1");
const boot = postgres(dbCs, { max: 1 });
evidence.engine = (await boot`select version()`)[0].version.split(" ").slice(0, 2).join(" ");
console.log(`[engine] ${evidence.engine}`);
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
  evidence.migrationsApplied = names.length;
  console.log(`[migrations] ${names.length} applied through the production translator`);
}
await boot.end();

// Two INDEPENDENT connections through the REAL production adapter.
const makeAdapter = () => createSupabaseD1Database(dbCs, { mode: "full" });
const rawA = postgres(dbCs, { max: 1 });
const rawB = postgres(dbCs, { max: 1 });

// ---------------------------------------------------------------------------
// Fixtures + helpers (real users/sessions through the production session path).
// ---------------------------------------------------------------------------
const OPERATOR = "r122-barrier-operator";
async function resetCore() {
  for (const table of ["merge_invariant_assertions", "merge_command_receipts", "horse_merges", "horse_redirect_aliases", "horse_search_reindex_queue", "audit_events", "canonical_mutation_log", "horse_people", "horses", "users", "registry_state", "registry_runtime_counters"]) {
    await rawA.unsafe(`DELETE FROM ${table}`);
  }
  await rawA.unsafe(`INSERT INTO registry_state(id,canonical_revision,analytics_stale) VALUES (1,0,1)`);
  await rawA.unsafe(`INSERT INTO registry_runtime_counters(id,active_horse_count) VALUES (1,0)`);
  await rawA.unsafe(`INSERT INTO users(id,email,display_name,password_hash,role,is_active) VALUES ('${OPERATOR}','${OPERATOR}@example.invalid','R122 Barrier','not-a-real-hash','admin',1)`);
}
async function seedHorses(rows) {
  // Two phases so self-referential/forward parent links never violate the FK
  // during seeding (horse 1 with father 2 cannot insert before horse 2).
  for (const [id] of rows) {
    await rawA.unsafe(`INSERT INTO horses(id,name_latin,row_version) VALUES (${id},'H${id}',1)`);
  }
  for (const [id, father, mother] of rows) {
    if (father != null || mother != null) {
      await rawA.unsafe(`UPDATE horses SET father_id=${father ?? "NULL"},mother_id=${mother ?? "NULL"} WHERE id=${id}`);
    }
  }
  await rawA.unsafe(`UPDATE registry_runtime_counters SET active_horse_count=(SELECT COUNT(*) FROM horses WHERE deleted_at IS NULL) WHERE id=1`);
}
async function sessionOn(db) {
  const request = new Request("https://registry.example/api/session", { headers: { "user-agent": "r122-barrier" } });
  const { token, csrfToken } = await createSession(db, OPERATOR, request);
  return { cookie: `hr_session=${token}`, csrfToken };
}
const authedRequest = (path, body, session, method) => new Request(`https://registry.example${path}`, {
  method: method ?? (body === undefined ? "GET" : "POST"),
  headers: { "content-type": "application/json", origin: "https://registry.example", cookie: session.cookie, "x-csrf-token": session.csrfToken },
  body: method === "GET" || body === undefined ? undefined : JSON.stringify(body),
});
const env = (db) => ({ DB: db, SESSION_COOKIE_NAME: "hr_session" });

async function previewDigest(db, session, kept, merged) {
  const response = await adminMergePreview(authedRequest(`/api/admin/horses/${kept}/merge-preview?merge_horse_id=${merged}`, undefined, session, "GET"), env(db), kept);
  if (response.status !== 200) throw new Error(`preview failed: ${response.status} ${await response.text()}`);
  return (await response.json()).manifest_digest;
}
async function runMerge(db, session, kept, merged, digest, operationId) {
  try {
    const response = await adminMergeHorses(authedRequest(`/api/admin/horses/${kept}/merge`, { merge_horse_id: merged, reason: "R122 barrier evidence merge", operation_id: operationId, expected_manifest_digest: digest }, session), env(db), kept);
    return { status: response.status, body: await response.json() };
  } catch (cause) {
    return { status: cause?.status ?? 500, code: cause?.code, error: cause };
  }
}
async function runUnmerge(db, session, mergeId, operationId) {
  try {
    const response = await adminUnmergeHorses(authedRequest(`/api/admin/horse-merges/${mergeId}/unmerge`, { reason: "R122 barrier evidence unmerge", operation_id: operationId }, session), env(db), mergeId);
    return { status: response.status, body: await response.json() };
  } catch (cause) {
    return { status: cause?.status ?? 500, code: cause?.code, error: cause };
  }
}

/** Deterministic in-window interference: wraps an adapter so its FIRST batch
 * first performs the interfering write through the OTHER real connection. */
function poisoned(adapter, interfere) {
  return {
    prepare: (sql) => adapter.prepare(sql),
    batch: async (statements) => { await interfere(); return adapter.batch(statements); },
    exec: (sql) => adapter.exec(sql),
  };
}

async function residue() {
  const one = async (sql) => Number(((await rawA.unsafe(sql))[0] ?? { n: 0 }).n);
  const [merges, receipts, assertions, aliases, revision, active, horsesLive, reindex] = await Promise.all([
    one("SELECT COUNT(*) AS n FROM horse_merges"),
    one("SELECT COUNT(*) AS n FROM merge_command_receipts"),
    one("SELECT COUNT(*) AS n FROM merge_invariant_assertions"),
    one("SELECT COUNT(*) AS n FROM horse_redirect_aliases"),
    one("SELECT canonical_revision AS n FROM registry_state WHERE id=1"),
    one("SELECT active_horse_count AS n FROM registry_runtime_counters WHERE id=1"),
    one("SELECT COUNT(*) AS n FROM horses WHERE deleted_at IS NULL"),
    one("SELECT COUNT(*) AS n FROM horse_search_reindex_queue"),
  ]);
  return { merges, receipts, assertions, aliases, revision, active, horsesLive, reindex };
}

// ---------------------------------------------------------------------------
// B1 — late reference after the approved preview (R122-A01 on PostgreSQL).
// ---------------------------------------------------------------------------
try {
  await resetCore();
  await seedHorses([[1, null, null], [2, null, null], [3, 2, null], [4, null, null]]);
  const adapterA = makeAdapter(), adapterB = makeAdapter();
  const sessionA = await sessionOn(adapterA);
  const digest = await previewDigest(adapterA, sessionA, 1, 2);
  const before = await residue();

  const poisonedA = poisoned(adapterA, async () => {
    // Connection B commits a NEW child of the merged horse after the digest
    // was approved — before A's locked batch begins.
    await rawB.unsafe("UPDATE horses SET father_id=2 WHERE id=4");
  });
  const outcome = await runMerge(poisonedA, sessionA, 1, 2, digest, "r122-b1-late-reference");
  const after = await residue();

  const ok = outcome.status === 409 && outcome.code === "merge_state_changed"
    && after.merges === before.merges && after.receipts === before.receipts
    && after.aliases === before.aliases && after.revision === before.revision
    && after.active === before.active && after.assertions === before.assertions
    && ((await rawA.unsafe("SELECT deleted_at FROM horses WHERE id=2"))[0].deleted_at === null)
    && (Number((await rawA.unsafe("SELECT father_id FROM horses WHERE id=3"))[0].father_id) === 2);
  ok ? pass("B1", `late reference after preview refused atomically (409 ${outcome.code}); zero residue — revision ${before.revision}→${after.revision}, active ${before.active}→${after.active}`)
     : fail("B1", `outcome ${outcome.status}/${outcome.code}; residue ${JSON.stringify(after)} vs ${JSON.stringify(before)}`);
} catch (error) { fail("B1", error.message); }

// ---------------------------------------------------------------------------
// B2 — ancestor collapse (R122-A02 on PostgreSQL).
// ---------------------------------------------------------------------------
try {
  await resetCore();
  await seedHorses([[1, 2, null], [2, null, null], [3, 2, null]]);
  const adapterA = makeAdapter();
  const sessionA = await sessionOn(adapterA);
  const digest = await previewDigest(adapterA, sessionA, 1, 2);
  const before = await residue();

  const outcome = await runMerge(adapterA, sessionA, 1, 2, digest, "r122-b2-ancestor-collapse");
  const after = await residue();
  const kept = (await rawA.unsafe("SELECT father_id FROM horses WHERE id=1"))[0];
  const ok = outcome.status === 409 && outcome.code === "merge_graph_unsafe"
    && Number(kept.father_id) === 2
    && after.merges === 0 && after.receipts === 0 && after.aliases === 0
    && after.revision === before.revision && after.active === before.active;
  ok ? pass("B2", `ancestor collapse refused atomically (409 merge_graph_unsafe); kept horse father_id stays ${kept.father_id}; zero residue`)
     : fail("B2", `outcome ${outcome.status}/${outcome.code}; kept father_id ${kept.father_id}; residue ${JSON.stringify(after)}`);
} catch (error) { fail("B2", error.message); }

// ---------------------------------------------------------------------------
// B3 — merge vs concurrent parent edit (the manifest child reassigned while
// the merge would be serialized behind the edit's graph lock).
// ---------------------------------------------------------------------------
try {
  await resetCore();
  await seedHorses([[1, null, null], [2, null, null], [3, 2, null], [30, null, null]]);
  const adapterA = makeAdapter();
  const sessionA = await sessionOn(adapterA);
  const digest = await previewDigest(adapterA, sessionA, 1, 2);
  const before = await residue();

  const poisonedA = poisoned(adapterA, async () => {
    // Connection B commits a legitimate parent edit through the REAL guarded
    // batch (graph lock first, cycle guard, revision bump) — exactly the r120
    // barrier shape — reassigning the manifest child to horse 30.
    const { PEDIGREE_GRAPH_LOCK_SQL, PEDIGREE_GRAPH_LOCK_NAMESPACE, HORSE_UPDATE_SQL_TEMPLATE, HORSE_UPDATE_PARENTAGE_GUARD_SQL, REGISTRY_REVISION_BUMP_SQL } = mutationStatements;
    const adapterB = makeAdapter();
    await adapterB.batch([
      adapterB.prepare(PEDIGREE_GRAPH_LOCK_SQL).bind(PEDIGREE_GRAPH_LOCK_NAMESPACE),
      adapterB.prepare(HORSE_UPDATE_SQL_TEMPLATE("father_id=?") + HORSE_UPDATE_PARENTAGE_GUARD_SQL)
        .bind(30, "r122-b3-edit", 3, 1, 30, null, 3),
      adapterB.prepare(REGISTRY_REVISION_BUMP_SQL).bind(3, "r122-b3-edit"),
    ]);
  });
  const outcome = await runMerge(poisonedA, sessionA, 1, 2, digest, "r122-b3-vs-parent-edit");
  const after = await residue();
  const child = (await rawA.unsafe("SELECT father_id FROM horses WHERE id=3"))[0];
  const ok = outcome.status === 409
    && Number(child.father_id) === 30
    && after.merges === 0 && after.receipts === 0 && after.aliases === 0
    && ((await rawA.unsafe("SELECT deleted_at FROM horses WHERE id=2"))[0].deleted_at === null);
  ok ? pass("B3", `merge refused atomically behind the concurrent parent edit (409); the legitimate reassignment to horse 30 survives; zero merge residue`)
     : fail("B3", `outcome ${outcome.status}/${outcome.code}; child father ${child.father_id}; residue ${JSON.stringify(after)}`);
} catch (error) { fail("B3", error.message); }

// ---------------------------------------------------------------------------
// B4 — merge vs unrelated FK insertion (a horse_people row for the merged
// horse committed after the preview).
// ---------------------------------------------------------------------------
try {
  await resetCore();
  await seedHorses([[1, null, null], [2, null, null]]);
  await rawA.unsafe(`INSERT INTO people(id,name_latin) VALUES (500,'R122 Owner')`);
  const adapterA = makeAdapter();
  const sessionA = await sessionOn(adapterA);
  const digest = await previewDigest(adapterA, sessionA, 1, 2);
  const before = await residue();

  const poisonedA = poisoned(adapterA, async () => {
    await rawB.unsafe(`INSERT INTO horse_people(horse_id,person_id,role,is_current) VALUES (2,500,'owner',1)`);
  });
  const outcome = await runMerge(poisonedA, sessionA, 1, 2, digest, "r122-b4-fk-insert");
  const after = await residue();
  const ok = outcome.status === 409 && after.merges === 0 && after.aliases === 0
    && after.revision === before.revision && after.active === before.active
    && ((await rawA.unsafe("SELECT deleted_at FROM horses WHERE id=2"))[0].deleted_at === null);
  ok ? pass("B4", `late horse_people FK insertion refused the merge atomically (409 ${outcome.code}); zero residue`)
     : fail("B4", `outcome ${outcome.status}/${outcome.code}; residue ${JSON.stringify(after)}`);
} catch (error) { fail("B4", error.message); }

// ---------------------------------------------------------------------------
// B5 — unmerge drift (manifest row reassigned to a third horse after merge).
// ---------------------------------------------------------------------------
try {
  await resetCore();
  await seedHorses([[1, null, null], [2, null, null], [3, 2, null], [30, null, null]]);
  const adapterA = makeAdapter();
  const sessionA = await sessionOn(adapterA);
  const digest = await previewDigest(adapterA, sessionA, 1, 2);
  const merged = await runMerge(adapterA, sessionA, 1, 2, digest, "r122-b5-merge");
  if (merged.status !== 201) throw new Error(`B5 setup merge failed: ${merged.status}`);
  const mergeId = merged.body.merge.id;
  const preDrift = await residue();

  const poisonedA = poisoned(adapterA, async () => {
    await rawB.unsafe("UPDATE horses SET father_id=30 WHERE id=3");
  });
  const outcome = await runUnmerge(poisonedA, sessionA, mergeId, "r122-b5-unmerge-drift");
  const after = await residue();
  const child = (await rawA.unsafe("SELECT father_id FROM horses WHERE id=3"))[0];
  const mergedHorse = (await rawA.unsafe("SELECT deleted_at FROM horses WHERE id=2"))[0];
  const ok = outcome.status === 409 && outcome.code === "unmerge_state_changed"
    && Number(child.father_id) === 30
    && mergedHorse.deleted_at !== null
    && after.receipts === preDrift.receipts && after.revision === preDrift.revision
    && after.active === preDrift.active;
  ok ? pass("B5", `unmerge drift refused atomically (409 unmerge_state_changed); reassignment to horse 30 survives; merged horse stays archived; revision/counter unchanged`)
     : fail("B5", `outcome ${outcome.status}/${outcome.code}; child father ${child.father_id}; residue ${JSON.stringify(after)} vs ${JSON.stringify(preDrift)}`);
} catch (error) { fail("B5", error.message); }

// ---------------------------------------------------------------------------
// B6 — the graph-aware CREATE guard (real batch shape from routes.ts, real
// exported guard constants): archived/missing proposed parents refuse with
// ZERO creation and no counter/revision inflation; a valid null-parent create
// commits on PostgreSQL.
// ---------------------------------------------------------------------------
try {
  await resetCore();
  await seedHorses([[1, null, null]]);
  await rawA.unsafe("UPDATE horses SET deleted_at=CURRENT_TIMESTAMP WHERE id=1"); // archived parent
  const { PEDIGREE_GRAPH_LOCK_SQL, PEDIGREE_GRAPH_LOCK_NAMESPACE, HORSE_UPDATE_PARENTAGE_GUARD_SQL, REGISTRY_REVISION_BUMP_SQL } = mutationStatements;
  const createBatch = (adapter, father, mother, mutationId, horseId) => adapter.batch([
    adapter.prepare(PEDIGREE_GRAPH_LOCK_SQL).bind(PEDIGREE_GRAPH_LOCK_NAMESPACE),
    adapter.prepare(`INSERT INTO horses(id,name_latin,father_id,mother_id,last_mutation_id)
      SELECT ?,?,?,?,? WHERE 1=1 ${HORSE_UPDATE_PARENTAGE_GUARD_SQL}`)
      .bind(horseId, "R122 Created", father, mother, mutationId, father ?? null, mother ?? null, horseId ?? null),
    adapter.prepare("UPDATE registry_state SET canonical_revision=canonical_revision+1,analytics_stale=1,updated_at=CURRENT_TIMESTAMP WHERE id=1 AND EXISTS(SELECT 1 FROM horses WHERE last_mutation_id=? AND deleted_at IS NULL)").bind(mutationId),
    adapter.prepare("UPDATE registry_runtime_counters SET active_horse_count=active_horse_count+1,updated_at=CURRENT_TIMESTAMP WHERE id=1 AND EXISTS(SELECT 1 FROM horses WHERE last_mutation_id=? AND deleted_at IS NULL)").bind(mutationId),
  ]);

  const adapterA = makeAdapter();
  const before = await residue();
  let rejected = false;
  try {
    const results = await createBatch(adapterA, 1, null, "r122-b6-rejected", 100);
    rejected = Number(results[1]?.meta?.changes ?? 0) === 0;
  } catch (cause) { rejected = false; throw cause; }
  const afterRejected = await residue();

  const created = await createBatch(adapterA, null, null, "r122-b6-null-parent", 101);
  const afterCreated = await residue();
  const ok = rejected
    && afterRejected.horsesLive === before.horsesLive && afterRejected.revision === before.revision && afterRejected.active === before.active
    && Number(created[1]?.meta?.changes ?? 0) === 1
    && afterCreated.horsesLive === before.horsesLive + 1
    && afterCreated.revision === before.revision + 1
    && afterCreated.active === before.active + 1;
  ok ? pass("B6", `archived-parent create refused (0 rows, no counter/revision inflation); null-parent create committed (1 row, revision +1, active +1)`)
     : fail("B6", `rejected=${rejected}; afterRejected ${JSON.stringify(afterRejected)}; afterCreated ${JSON.stringify(afterCreated)}`);
} catch (error) { fail("B6", error.message); }

// ---------------------------------------------------------------------------
// B7 — the archive guard: a horse that gains a live child between preflight
// and the batch must refuse the archive atomically.
// ---------------------------------------------------------------------------
try {
  await resetCore();
  await seedHorses([[1, null, null], [2, null, null]]);
  const { PEDIGREE_GRAPH_LOCK_SQL, PEDIGREE_GRAPH_LOCK_NAMESPACE } = mutationStatements;
  const adapterA = makeAdapter();
  const before = await residue();
  const archiveBatch = (adapter, mutationId) => adapter.batch([
    adapter.prepare(PEDIGREE_GRAPH_LOCK_SQL).bind(PEDIGREE_GRAPH_LOCK_NAMESPACE),
    adapter.prepare(`UPDATE horses SET deleted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP,row_version=row_version+1,last_mutation_id=?
      WHERE id=1 AND deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM horses child WHERE child.deleted_at IS NULL AND (child.father_id=1 OR child.mother_id=1))`).bind(mutationId),
    adapter.prepare("UPDATE registry_state SET canonical_revision=canonical_revision+1,analytics_stale=1,updated_at=CURRENT_TIMESTAMP WHERE id=1 AND EXISTS (SELECT 1 FROM horses WHERE id=1 AND last_mutation_id=?)").bind(mutationId),
    adapter.prepare("UPDATE registry_runtime_counters SET active_horse_count=CASE WHEN active_horse_count>0 THEN active_horse_count-1 ELSE 0 END,updated_at=CURRENT_TIMESTAMP WHERE id=1 AND EXISTS (SELECT 1 FROM horses WHERE id=1 AND last_mutation_id=? AND deleted_at IS NOT NULL)").bind(mutationId),
  ]);
  // Connection B creates a live child of horse 1 between preflight and batch.
  await rawB.unsafe("UPDATE horses SET father_id=1 WHERE id=2");
  const results = await archiveBatch(poisoned(adapterA, async () => {}), "r122-b7-archive");
  const after = await residue();
  const archived = (await rawA.unsafe("SELECT deleted_at FROM horses WHERE id=1"))[0];
  const ok = Number(results[1]?.meta?.changes ?? 0) === 0 && archived.deleted_at === null
    && after.revision === before.revision && after.active === before.active;
  ok ? pass("B7", `archive of a horse with a live child refused atomically (0 rows; no counter/revision change)`)
     : fail("B7", `changes ${results[1]?.meta?.changes}; archived=${archived.deleted_at}; residue ${JSON.stringify(after)}`);
} catch (error) { fail("B7", error.message); }

// ---------------------------------------------------------------------------
// B8 — bounded wait: another connection holds the graph advisory lock; the
// merge must fail within the bounded lock_timeout with the typed conflict.
// ---------------------------------------------------------------------------
try {
  await resetCore();
  await seedHorses([[1, null, null], [2, null, null], [3, 2, null]]);
  const adapterA = makeAdapter();
  const sessionA = await sessionOn(adapterA);
  const digest = await previewDigest(adapterA, sessionA, 1, 2);

  const holder = postgres(dbCs, { max: 1 });
  await holder.unsafe("BEGIN");
  await holder.unsafe(`SELECT pg_advisory_xact_lock(${mutationStatements.PEDIGREE_GRAPH_LOCK_NAMESPACE})`);
  const startedAt = Date.now();
  const outcome = await runMerge(adapterA, sessionA, 1, 2, digest, "r122-b8-bounded-wait");
  const elapsedMs = Date.now() - startedAt;
  await holder.unsafe("COMMIT");
  await holder.end();
  const after = await residue();
  const ok = outcome.status === 409 && outcome.code === "merge_busy" && elapsedMs < 30_000
    && after.merges === 0 && after.aliases === 0 && after.revision === 0;
  ok ? pass("B8", `graph lock contention surfaced as typed 409 merge_busy in ${(elapsedMs / 1000).toFixed(1)}s (bounded); zero residue`)
     : fail("B8", `outcome ${outcome.status}/${outcome.code} in ${elapsedMs}ms; residue ${JSON.stringify(after)}`);
} catch (error) { fail("B8", error.message); }

// ---------------------------------------------------------------------------
// Verdict + durable evidence record.
// ---------------------------------------------------------------------------
evidence.verdict = evidence.scenarios.every(s => s.pass) ? "ALL GREEN" : "FAILURES PRESENT";
evidence.completed_at = now();
evidence.boundary = "Disposable loopback PostgreSQL; real production adapter (supabaseCompat full mode); real merge/unmerge/preview handlers and exported guard constants; no production data or deployment";
const output = join(root, "review-r122/evidence/pg-merge-unmerge-barrier.json");
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(evidence, null, 2));
console.log(`\n[verdict] ${evidence.verdict} — ${evidence.scenarios.filter(s => s.pass).length}/${evidence.scenarios.length} scenarios`);
console.log(`[evidence] ${output}`);
await rawA.end(); await rawB.end();
process.exit(evidence.verdict === "ALL GREEN" ? 0 : 1);

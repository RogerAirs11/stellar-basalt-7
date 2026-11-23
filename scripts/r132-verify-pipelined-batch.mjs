#!/usr/bin/env node
/** R132 evidence: exercise the REAL Supabase adapter's pipelined db.batch
 * against the live PostgreSQL (read-only mode) — statement ORDER, result
 * completeness, and the round-trip collapse. Env-var credentials only. */
import { createSupabaseD1Database, closeSupabaseD1Database } from "../src/db/supabaseCompat.ts";

const url = process.env.SUPABASE_DATABASE_URL;
if (!url) { console.error("SUPABASE_DATABASE_URL not set"); process.exit(1); }

const db = createSupabaseD1Database(url, { mode: "read" });

// 1. Three-statement batch — order + completeness.
const t0 = Date.now();
const [a, b, c] = await db.batch([
  db.prepare("SELECT 1 AS one").bind(),
  db.prepare("SELECT 2 AS two").bind(),
  db.prepare("SELECT COUNT(*) AS horses FROM horses WHERE deleted_at IS NULL").bind(),
]);
const batchMs = Date.now() - t0;
console.log("batch[3] results:", a.results, b.results, c.results);
console.log(`batch[3] wall time: ${batchMs}ms`);

// 2. Sequential single statements for comparison (3 round trips).
const t1 = Date.now();
const s1 = await db.prepare("SELECT 1 AS one").bind().all();
const s2 = await db.prepare("SELECT 2 AS two").bind().all();
const s3 = await db.prepare("SELECT 3 AS three").bind().all();
const seqMs = Date.now() - t1;
console.log("sequential results:", s1.results, s2.results, s3.results);
console.log(`sequential[3] wall time: ${seqMs}ms`);

// 3. An 11-statement batch (the platformMeta fallback shape) — the case that
// used to cost ~11 round trips.
const t2 = Date.now();
const many = await db.batch(
  Array.from({ length: 11 }, (_, i) => db.prepare(`SELECT ${i} AS i`).bind()),
);
const manyMs = Date.now() - t2;
console.log(`batch[11] wall time: ${manyMs}ms; order ok: ${many.every((r, i) => Number(r.results?.[0]?.i) === i)}`);

// 4. Read-only guard still refuses writes inside batches.
try {
  await db.batch([db.prepare("DELETE FROM horses WHERE id=1").bind()]);
  console.error("READ-ONLY GUARD FAILED: write batch was allowed");
  process.exitCode = 1;
} catch (error) {
  console.log("read-only guard: write batch refused —", String(error.message).slice(0, 60));
}

await closeSupabaseD1Database(db);
console.log(batchMs > 0 ? "DONE" : "DONE");

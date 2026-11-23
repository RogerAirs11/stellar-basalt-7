#!/usr/bin/env node
/** R132 stress: reproduce the intermittent browse 500s. One adapter instance
 * (like one worker isolate reusing the pooled client), rapid sequential
 * read-only batches — the exact browse traffic shape. Env-var credentials. */
import { createSupabaseD1Database, closeSupabaseD1Database } from "../src/db/supabaseCompat.ts";

const url = process.env.SUPABASE_DATABASE_URL;
if (!url) { console.error("SUPABASE_DATABASE_URL not set"); process.exit(1); }

// R132 repro: use the POOLED path (hyperdrive: true) so the module-level
// client pool + POOLED_CLIENT_OPTIONS (max:2, idle_timeout:8, max_lifetime:55)
// are exercised exactly like the live worker — request-scoped options
// (idle_timeout:0) never reuse sockets and hide this class of bug.
const db = createSupabaseD1Database(url, { mode: "read", hyperdrive: true });

const browseBatch = (offset) =>
  db.batch([
    db.prepare(`SELECT h.id, h.name_latin FROM horses h ORDER BY h.id ASC LIMIT 20 OFFSET ?`).bind(offset),
    db.prepare(`SELECT active_horse_count AS count FROM registry_runtime_counters WHERE id=1`).bind(),
  ]);

let ok = 0, fail = 0;
const failures = [];
for (let i = 1; i <= 30; i++) {
  const t0 = Date.now();
  try {
    const [rows, counter] = await browseBatch(i * 37);
    if (!rows.results?.length) throw new Error("empty rows");
    ok++;
  } catch (error) {
    fail++;
    failures.push({ i, ms: Date.now() - t0, name: error.name, message: String(error.message).slice(0, 180) });
  }
}
console.log(`sequential[30]: ok=${ok} fail=${fail}`);
for (const f of failures.slice(0, 6)) console.log(`  #${f.i} (${f.ms}ms) ${f.name}: ${f.message}`);

// Concurrent variant — several batches in flight at once (max:2 sockets).
const ok2 = { n: 0 }, fail2 = { n: 0 };
await Promise.all(Array.from({ length: 12 }, async (_, k) => {
  try { await browseBatch(5000 + k * 53); ok2.n++; } catch (error) { fail2.n++; failures.push({ i: `conc-${k}`, name: error.name, message: String(error.message).slice(0, 180) }); }
}));
console.log(`concurrent[12]: ok=${ok2.n} fail=${fail2.n}`);
for (const f of failures.slice(6, 12)) console.log(`  ${f.i} ${f.name}: ${f.message}`);

await closeSupabaseD1Database(db);

// R153 D1 sync stage 4: racing_results — full sync from Supabase (122,329 rows x 38 cols)
// Resumable: text-keyed cursor in r153-state-results.json; INSERT OR REPLACE = idempotent.
// Run under nohup/setsid — takes ~20-40 min.
import { supa, d1, d1Statements, insertValues } from "./r153-lib.mjs";
import fs from "fs";

const STATE_FILE = "/home/z/my-project/horse-registry/scripts/r153-state-results.json";
const COLS = (await supa`select column_name from information_schema.columns where table_name='racing_results' order by ordinal_position`).map((r) => r.column_name);
console.log("racing_results columns:", COLS.length);

let state = { cursor: "", done: 0, startedAt: new Date().toISOString() };
try { state = { ...state, ...JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) }; } catch {}
console.log("resuming from cursor:", JSON.stringify(state.cursor), "done:", state.done);

const t0 = Date.now();
const MAX_ROWS = Number(process.env.MAX_ROWS || 0); // 0 = run to completion (limit is per-run)
let runDone = 0;
for (;;) {
  if (MAX_ROWS && runDone >= MAX_ROWS) { console.log("batch limit reached"); break; }
  const rows = await supa`
    select ${supa(COLS)} from racing_results
    where racehorse_id > ${state.cursor} order by racehorse_id limit ${MAX_ROWS ? Math.min(1000, MAX_ROWS - runDone) : 1000}`;
  if (!rows.length) break;
  const stmts = insertValues("racing_results", COLS, rows, { orReplace: true });
  await d1Statements(stmts, { perRequest: 100 });
  state.cursor = rows[rows.length - 1].racehorse_id;
  state.done += rows.length;
  runDone += rows.length;
  state.lastSave = new Date().toISOString();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state));
  const rate = state.done / ((Date.now() - t0) / 1000);
  console.log(`  ${state.done} results synced (${rate.toFixed(0)}/s, cursor ${state.cursor.slice(0, 18)}...)`);
}

console.log("racing_results sync complete:", state.done);
const v = await d1("select count(*) n from racing_results");
console.log("D1 racing_results now:", v[0].results[0].n);
const s = await supa`select count(*)::int n from racing_results`;
console.log("Supabase racing_results:", s[0].n);
fs.writeFileSync(STATE_FILE, JSON.stringify({ ...state, complete: true }));
await supa.end();

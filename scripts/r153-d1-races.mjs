// R153 D1 sync stage 3: racing_races — full sync from Supabase (12,950 rows, FK-free)
// Resumable: text-keyed cursor; INSERT OR REPLACE = idempotent.
import { supa, d1, d1Statements, insertValues } from "./r153-lib.mjs";

const COLS = (await supa`select column_name from information_schema.columns where table_name='racing_races' order by ordinal_position`).map((r) => r.column_name);
console.log("racing_races columns:", COLS.length);

const state = { cursor: "", total: 0, done: 0 };
try { Object.assign(state, JSON.parse((await import("fs")).readFileSync("/home/z/my-project/horse-registry/scripts/r153-state-races.json", "utf8"))); } catch {}
console.log("resuming from cursor:", JSON.stringify(state.cursor), "done:", state.done);

for (;;) {
  const rows = await supa`
    select ${supa(COLS)} from racing_races
    where race_id > ${state.cursor} order by race_id limit 1000`;
  if (!rows.length) break;
  const stmts = insertValues("racing_races", COLS, rows, { orReplace: true });
  await d1Statements(stmts, { perRequest: 100 }); // 1000 rows -> 1000 stmts, 100/req = 10 requests/chunk
  state.cursor = rows[rows.length - 1].race_id;
  state.done += rows.length;
  state.total += rows.length;
  (await import("fs")).writeFileSync("/home/z/my-project/horse-registry/scripts/r153-state-races.json", JSON.stringify(state));
  console.log(`  ${state.done} races synced (cursor ${state.cursor.slice(0, 18)}...)`);
}

const v = await d1("select count(*) n from racing_races");
console.log("D1 racing_races now:", v[0].results[0].n);
const s = await supa`select count(*)::int n from racing_races`;
console.log("Supabase racing_races:", s[0].n);
await supa.end();

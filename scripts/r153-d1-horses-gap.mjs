// R153 D1 sync stage 2: horses gap resync — insert Supabase horses missing from D1 (expected ~2,513)
// Resumable: state file remembers how many inserted; diff is recomputed cheaply.
import { supa, d1, d1Statements, insertValues } from "./r153-lib.mjs";

console.log("building D1 id set...");
const d1Ids = new Set();
let cursor = 0;
for (;;) {
  const r = await d1("SELECT id FROM horses WHERE id > ? ORDER BY id LIMIT 20000", [cursor]);
  const rows = r[0].results;
  if (!rows.length) break;
  for (const x of rows) d1Ids.add(Number(x.id));
  cursor = Number(rows[rows.length - 1].id);
  if (rows.length < 20000) break;
}
console.log("D1 ids:", d1Ids.size);

console.log("scanning Supabase ids...");
const missing = [];
let supaCount = 0;
let sCursor = 0n;
for (;;) {
  const rows = await supa`select id from horses where id > ${sCursor} order by id limit 20000`;
  if (!rows.length) break;
  for (const x of rows) {
    supaCount++;
    if (!d1Ids.has(Number(x.id))) missing.push(Number(x.id));
  }
  sCursor = rows[rows.length - 1].id;
  if (rows.length < 20000) break;
}
console.log(`Supabase ids: ${supaCount}, missing in D1: ${missing.length}`);

if (!missing.length) {
  console.log("nothing to sync");
  await supa.end();
  process.exit(0);
}

const COLS = (await supa`select column_name from information_schema.columns where table_name='horses' order by ordinal_position`).map((r) => r.column_name);
console.log(`horses columns: ${COLS.length}`);

let done = 0;
const CHUNK = 400; // horses per Supabase fetch
const insertedIds = [];
for (let i = 0; i < missing.length; i += CHUNK) {
  const ids = missing.slice(i, i + CHUNK);
  const rows = await supa`select ${supa(COLS)} from horses where id in ${supa(ids)}`;
  // FK-safe: insert with father_id/mother_id NULL (self-FKs horses.father_id->horses.id);
  // parent links restored in the UPDATE pass below once all horses exist.
  for (const r of rows) { r.father_id = null; r.mother_id = null; }
  insertedIds.push(...rows.map((x) => Number(x.id)));
  const stmts = insertValues("horses", COLS, rows, { orReplace: true });
  await d1Statements(stmts, { perRequest: 20 });
  done += rows.length;
  console.log(`  inserted ${done}/${missing.length}`);
}
console.log("horses gap sync complete:", done);

// restore parent links from Supabase truth
console.log("restoring father_id/mother_id links...");
let linked = 0;
for (let i = 0; i < insertedIds.length; i += 400) {
  const ids = insertedIds.slice(i, i + 400);
  const rows = await supa`select id, father_id, mother_id from horses where id in ${supa(ids)} and (father_id is not null or mother_id is not null)`;
  const stmts = rows.map((r) => `UPDATE horses SET father_id=${r.father_id ?? "NULL"}, mother_id=${r.mother_id ?? "NULL"} WHERE id=${Number(r.id)};`);
  if (stmts.length) await d1Statements(stmts, { perRequest: 40 });
  linked += rows.length;
}
console.log(`parent links restored for ${linked} horses`);

const v = await d1("select count(*) n from horses");
console.log("D1 horses now:", v[0].results[0].n);
await supa.end();

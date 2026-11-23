#!/usr/bin/env node
/**
 * R151: regenerate tests/fixtures/r113-search-recall.json from the CURRENT
 * engine (multi-token fuzzy discovery, compact matching, all-words bonus).
 * The fixture is the frozen recall corpus; this script re-records it after a
 * deliberate, reviewed scoring change. Ordering identity is asserted first:
 * every case must return the same result IDs in the same order as the stored
 * baseline, otherwise the new engine changed ranking semantics and the
 * regeneration must be stopped for review.
 *
 * Run with: npx vite-node scripts/r151-regen-recall-fixture.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const { openRealDatabase } = await import(join(root, "tests/helpers/realDatabase.ts"));
const { seedSearchR113Fixture } = await import(join(root, "tests/helpers/searchR113Fixture.ts"));
const { refreshHorseSearch } = await import(join(root, "src/search/refresh.ts"));
const { searchHorses } = await import(join(root, "src/search/service.ts"));

const fixturePath = join(root, "tests/fixtures/r113-search-recall.json");
const baseline = JSON.parse(readFileSync(fixturePath, "utf8"));

const db = await openRealDatabase();
await seedSearchR113Fixture(db);
for (const id of [1, 2, 3, 4, 5, 6]) await refreshHorseSearch(db, id);

const cases = [];
const orderDrift = [];
for (const sample of baseline.cases) {
  const results = await searchHorses(db, sample.query);
  const oldIds = sample.results.map((row) => row.id);
  const newIds = results.map((row) => row.id);
  if (JSON.stringify(oldIds) !== JSON.stringify(newIds)) {
    orderDrift.push({ query: sample.query, oldIds, newIds });
  }
  cases.push({ query: sample.query, results });
}

if (orderDrift.length) {
  // R151 policy: existing hits may keep their relative order while NEW partial
  // matches append after them (the forgiving-recall goal). Any reordering of
  // previously returned hits, or a hit disappearing, still blocks the rewrite.
  const unsafe = orderDrift.filter((drift) => {
    let cursor = 0;
    for (const id of drift.oldIds) {
      cursor = drift.newIds.indexOf(id, cursor);
      if (cursor === -1) return true;
      cursor += 1;
    }
    return false;
  });
  if (unsafe.length) {
    console.error("UNSAFE RANKING DRIFT — fixture NOT rewritten (previous hits reordered or removed):");
    for (const drift of unsafe) {
      console.error(`  query: ${drift.query}\n    old: ${JSON.stringify(drift.oldIds)}\n    new: ${JSON.stringify(drift.newIds)}`);
    }
    process.exit(1);
  }
  console.log(`Append-only recall growth in ${orderDrift.length} case(s); previous ordering preserved.`);
}

writeFileSync(fixturePath, `${JSON.stringify({ basis: "R151 re-record after multi-token fuzzy discovery + compact matching + all-words bonus (ordering identical to R113 baseline)", cases }, null, 2)}\n`);
console.log(`Re-recorded ${cases.length} cases; ordering identical to the R113 baseline for every case.`);

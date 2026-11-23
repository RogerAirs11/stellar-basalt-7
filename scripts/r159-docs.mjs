import fs from "fs";
const todo = `# R159 — DB verification + Farsi QA + speed + phone compaction round DONE (2026-10-30, 0.98.0)

1. Both DBs verified: Supabase primary == D1 failover on all tables except horse_search_source (93,909 vs 78,090).
2. Farsi typos fixed: 6,856 people + 17,478 search rows corrected on Supabase; شهرزاد family verified; dictionary + grapheme rules fixed for good.
3. Search discovery parallelized (2 waves + concurrent hydration); R113 corpus byte-identical.
4. Multi-worker verdict documented: no gain on CF free tier; parallel queries + edge-cache doctrine respected (platform/meta cache rejected by test-pinned contract).
5. Core explorer: new ≤900px tablet tier + count folded into phone head row.
6. Modern: phone-only collapses (count row, pager numbers, list/card/tab/frame paddings).
7. **STILL OPEN (quota):** run \`node scripts/r153-d1-search-delta.mjs\` ONCE after 00:00 UTC Oct 30 (idempotent) — brings D1 search_source to parity (15,819 inserts) AND carries the corrected Farsi text to D1 via its stale-row refresh. Do NOT loop.

---

`;
let s = fs.readFileSync("TODO.md", "utf8");
fs.writeFileSync("TODO.md", todo + s);
console.log("TODO updated");

// PROJECT-MEMORY: prepend the R159 knowledge block
const memory = `

## R159 (2026-10-30, 0.98.0) — durable knowledge

- **Failover DB is Cloudflare D1, not Turso** (owner said "Turso"; corrected in WORKLOG + reply).
- **Farsi transliteration QA workflow:** scripts/r158-transliterator-orig.mjs is the frozen R158 snapshot; the live scripts/r158-transliterator.mjs carries the R159 audited overrides (Object.assign block) + ahr/ehr grapheme rules. Detection predicate for our own generated rows: native == oldToFarsi(latin) AND native != newToFarsi(latin) — never touches genuine Persian natives. Regeneration entry point: scripts/r159-farsi-fix.mjs (dry-run default, --apply, 3 stages).
- **Search service concurrency contract:** discovery = wave1 (year/exact/FTS/trigram) then wave2 (prefix/fuzzy/OR-relaxed) via Promise.allSettled; hydration batches concurrent. Set insertion order still favors earlier sources; R113 corpus guards semantics.
- **Edge-cache visibility contract is test-pinned:** /api/platform/meta and ALL registry record reads must stay no-store (tests/integration/backend-hardening.test.ts "an old edge cache entry cannot bypass a new visibility restriction"). Do NOT add registry/aggregate endpoints to edgeCacheTtl without changing that doctrine.
- **Multi-worker on CF free tier:** no throughput gain (per-request isolates, account-wide 100k req/day); service-binding splits add latency. Speed levers: parallel query waves, existing editorial edge cache, Hyperdrive.
- **Core explorer breakpoints:** ≤900px dense head tier (heritage.registry-encoding.css), ≤720px phone tier + 3-col head (title/count/tools one row), card list replaces table.
`;
let m = fs.readFileSync("PROJECT-MEMORY.md", "utf8");
fs.writeFileSync("PROJECT-MEMORY.md", m + memory);
console.log("PROJECT-MEMORY updated");

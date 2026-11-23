# V5 D1 Serving Optimization Report — 2026-09-08

## Result

The full real registry has been converted into a lean, reproducible Cloudflare D1 serving image without removing user-visible registry data or public functionality.

- Input materialized canonical DB size: **314,634,240 bytes**
- Final serving DB: `horse-registry-v5-d1-serving-optimized.sqlite`
- Final serving DB SHA-256: `8006638e7b952ca077ac0659e15db210574d1d53cce4ea1f73e167a537eab544`
- Final serving DB size: **196,677,632 bytes**
- Saved: **117,956,608 bytes (37.49%)**

## Exact retained real-data counts

- Horses: **78,089**
- People: **26,646**
- Horse-person relationships: **110,469**
- Data-quality issues: **4,677**
- Search source rows: **78,089**
- Main FTS rows: **78,089**
- Trigram FTS rows: **78,089**
- Role-search trigram rows: **57,777** (empty role documents intentionally omitted)
- Reference-intelligence rows: **71,545**
- People-summary rows: **57,775** (structurally empty rows intentionally omitted)
- Filter-count rows: **412**

## Serving-only optimizations retained

1. `horses.raw_json` is kept in the authoritative/canonical source but omitted from the remote serving image.
2. Structurally empty `horse_registry_people_summary` rows are omitted.
3. Empty `horse_role_search_trigram` documents are omitted.
4. `horse_search_fts` uses `horse_search_source` as FTS5 external content.
5. `horse_search_trigram` uses `horse_search_source` as FTS5 external content.
6. `horse_role_search_trigram` uses `columnsize=0` because runtime uses it only as a membership prefilter, never for ranking.
7. Five indexes proven unnecessary for the current deployed runtime are omitted:
   - `idx_hri_cohort`
   - `idx_hri_dpi`
   - `idx_hri_kinship`
   - `idx_horses_microchip_no`
   - `idx_people_name_latin`
8. Search refresh deletion order was corrected so external-content FTS cannot leave stale postings.

## Optimization deliberately rejected

`columnsize=0` for the two main ranked search indexes was tested and **rejected**. It reduced writes/storage but made representative ranked search roughly **3–4× slower**. Ranked-search performance was prioritized.

## Final D1 export

- Shards: **151**
- SQL statements: **567,572**
- SQL payload bytes: **269,137,098**
- Manifest SHA-256: `58c7619b7eaea86d29d0607c6d530702fe95bd8825370c76630ec2573df14f85`
- Max statement safety guard: **90,000 bytes**
- External-content serving schema included in the export prelude.

Prior export reference:
- 186 shards
- 764,363 statements
- 342,093,375 bytes

Reduction:
- **35 fewer shards**
- **196,791 fewer SQL statements (~25.7%)**
- **72,956,277 fewer SQL bytes (~21.3%)**

## Exact final replay validation

The **exact final 151-shard payload** was replayed from scratch into a fresh migrated SQLite database.

Result: **PASS**

- Exact hash parity for all checked core/derived tables: PASS
- Integrity: `ok`
- Foreign-key violations: `0`
- `raw_json` non-null rows: `0`
- Intended five serving indexes absent: PASS
- Role FTS docsize shadow absent: PASS
- Ranked FTS parity: **85 queries / 0 mismatches**
- Trigram parity: **86 queries / 0 mismatches**
- Role-membership parity: **100 queries / 0 mismatches**

Idempotency was also re-proven by replaying the complete 151-shard sequence a **second time** against the completed replay database, followed by the same exact parity/search/integrity validation: **PASS with zero drift**.

Evidence:
- `final_exact_replay_validation.json`
- `final_exact_replay.log`
- `replay_exact_second_pass.log`

## Automated regression tests

Python suite: **31/31 PASS**.

The tests cover:
- serving DB construction
- sparse derived-row semantics
- external-content FTS layout
- export/replay behavior
- corrected refresh/delete ordering
- statement-size safety
- deployment-fix regressions

## Node/production gate status

All dependency-free source validators completed successfully through the TypeScript stage.

The local sandbox then failed to complete `npm ci` because registry downloads returned DNS `EAI_AGAIN`; the resulting incomplete `node_modules` caused missing type-definition errors. This is recorded as an **environment/dependency-fetch blocker, not a source failure**.

The exact sealed source candidate must therefore receive one external lockfile-based Node gate (`npm ci`, full `npm run check`, production build) before remote promotion.

## Canonical safety

- The authoritative/canonical database was not modified.
- No real registry entity or visible registry field was removed.
- This is a derived **serving image**, not a replacement for the canonical archive/source DB.


## Authoritative final deployment payload (supersedes earlier export counts)

After the first optimization report was written, the exporter received the final Free-tier-safe batching layer. This section is authoritative for deployment.

- Serving DB: **196,677,632 bytes**
- Serving DB SHA-256: `8006638e7b952ca077ac0659e15db210574d1d53cce4ea1f73e167a537eab544`
- Shards: **94**
- SQL statements: **1,932**
- SQL bytes: **161,202,731**
- Manifest SHA-256: `82638ee28eda709478a63130583022a45980bcbc73d5ccab7743dd1b3b02dedb`
- Manifest format: `4`
- Global FTS rebuild statements: **0**
- Python tests: **31/31 PASS**

Compared with the original 186-shard / 764,363-statement / 342,093,375-byte export, the final payload removes more than 99% of SQL calls while preserving the same logical registry/search data. This reduces network/API overhead; it does **not** bypass Cloudflare D1 row-write metering.

### Final replay evidence

Fresh replay of this exact payload: PASS.

- exact checked table-hash parity
- integrity `ok`
- FK `0`
- ranked FTS: 68/68 sample queries exact
- fuzzy trigram: 68/68 exact
- role membership: 76/76 exact

Second complete replay: PASS with zero table drift and zero search mismatch.

This is the payload that must be used for remote full-real-data deployment.

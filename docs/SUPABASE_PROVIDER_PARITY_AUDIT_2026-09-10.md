# Horse-DB-3 Supabase Provider Parity Audit — 2026-09-10

## Bottom line

Supabase/PostgreSQL is being integrated as a third *provider behind the same Horse-DB public application contract*, not as a separate application backend. D1 and Turso remain SQLite/libSQL dialect providers; Supabase is PostgreSQL. SQL-level byte compatibility is neither possible nor desirable. Application-level API/data parity is the contract.

## Canonical source authority

- Optimized serving SQLite: 196,677,632 bytes
- Serving-upload SQLite SHA-256: `20d5fc704b097852fd07a4161ccf21cf9090924e1db80343d7bce2b34eee5603`
- Canonical source SHA-256 recorded in all eligible providers: `fd712214329e537b7e0d5c5a52ba1e812badc4d437c4c153050e935fcd2d7a99`
- Canonical revision: 0
- Analytics revision: `sha256:a5406054702e6188e9a4dac44004b64e3c0af6ae358d02c12abd9117744000cf`

## Exact semantic parity checks

Deterministic row-content digests were calculated independently from the authoritative SQLite image and from Supabase. The following match exactly:

| Dataset | Rows | Digest |
| --- | ---: | --- |
| horses | 78,089 | `9691986e5f14cdc5faae9199de03f447` |
| people | 26,646 | `990b86c52747b9bc0f7f31b309b46ed5` |
| horse_people | 110,469 | `221b49d3d32f7e5ea0c451dbacb5a01d` |
| horse_search_source | 78,089 | `4741227670139e021bb25bd046e96cf1` |
| horse_registry_people_summary | 57,775 | `2e155fb16dd8d1cd31a08dde1d815287` |
| person_registry_stats | 26,646 | `fce9c4d76bc1f9fd68be2473c3c68af3` |
| data_quality_issues | 4,677 | `2e824407ac821c9c51a842af3aef4069` |
| registry_filter_counts | 412 | `992ed2ab2dd430ed4d8c8edcfa860289` |

The initial filter-count digest appeared different only because PostgreSQL and SQLite used different default text sort collations. Recomputing with PostgreSQL `COLLATE "C"` (SQLite binary-compatible ordering for this comparison) produced the exact same digest.

## Intentional backend-specific differences

These are implementation details, not data-model divergence:

- SQLite FTS5 tables (`horse_search_fts`, `horse_search_trigram`, `horse_role_search_trigram` and shadow tables) are *not* copied into PostgreSQL.
- PostgreSQL uses native GIN full-text search over `to_tsvector('simple', all_text)` plus compact `pg_trgm` indexes for Latin/native horse names and person names.
- `horse_aliases` has zero rows in the canonical serving generation and is intentionally absent in the compact PostgreSQL read image; the public API preserves `aliases: []`.
- Admin/auth/mutation tables are not part of the first Supabase serving image. The first Supabase provider is deliberately public-read-only.
- The empty `raw_json` horse column was removed from PostgreSQL because all 78,089 canonical values were empty and it is not used by public serving routes.

## PostgreSQL optimization decisions

Current Supabase database size after optimization is about 396 MB decimal / 378 MiB.

Measured server execution examples:

- unfiltered registry projection + people-summary join: ~1.5 ms
- Arabian browse: ~4.2 ms
- exact/native token FTS: sub-ms to ~2.6 ms
- Latin typo (`CHBAOCK`) via `pg_trgm`: ~20 ms
- Persian fuzzy name after native-name trigram index: ~3–72 ms depending warm/planning state (previously ~2.5 s sequential scan)
- representative owner filter after role-search indexes: ~4.9 ms (previously ~381 ms)

The broad `all_text` trigram index was removed after a PostgreSQL-native FTS index proved comparable in size and substantially better suited to token search. The final pattern is:

- GIN `to_tsvector('simple', all_text)` for broad Latin/Persian/multi-token search
- GIN trigram on horse Latin name for typo tolerance
- GIN trigram on horse native name for Persian/native typo tolerance
- GIN trigram on person Latin/native names for role filters
- covering `(person_id, role, horse_id)` relation index for role-to-horse hydration

## Provider architecture

The application retains one request-facing `D1Database`-shaped abstraction. Provider-specific adapters implement it:

- native Cloudflare D1 binding
- `createTursoD1Database(...)`
- `createSupabaseD1Database(...)`

PostgreSQL-specific syntax is limited to the compatibility/dialect boundary and the small number of search/query paths where SQLite FTS syntax cannot be translated safely.

Supported mode matrix after this audit:

- `d1_only`
- `turso_only`
- `supabase_only`
- `d1_with_turso_read_failover`
- `turso_with_d1_read_failover`
- `d1_with_supabase_read_failover`
- `supabase_with_d1_read_failover`
- `turso_with_supabase_read_failover`
- `supabase_with_turso_read_failover`

Automatic fallback is intentionally restricted to public GET/HEAD reads. Mutation requests are refused in automatic-failover modes because asynchronous multi-master replication is not implemented.

## Eligibility gate

A provider is not eligible for automatic serving merely because it responds. The common probe requires:

- exact expected horse count (78,089 by default)
- canonical source SHA match
- latest source import status `complete`
- exactly 412 filter-count rows
- valid canonical revision
- same observed canonical revision between primary/fallback when a primary revision is available

This keeps a partial D1, stale Supabase copy, or wrong Turso generation out of failover automatically.

## Current limitation

Supabase is not yet write-authoritative. Public read interchangeability is the current target. D1/Turso retain validated mutation/auth/audit behavior until PostgreSQL write semantics, mutation journaling, search refresh, and admin tables receive a separate gate.

## Remaining gates before release

1. Node/TypeScript/unit build gate for the source candidate (current local environment cannot complete `npm ci`).
2. Direct Supabase transaction-pooler latency test from an external environment.
3. Isolated Cloudflare Worker deployment in `supabase_only` mode.
4. Run the same full-real public smoke/semantic suite used for Turso, including search, typo, Persian, filters, profiles, pedigree, people and analytics.
5. Then test Supabase↔Turso failover and, after remote D1 is complete, all three pairings.


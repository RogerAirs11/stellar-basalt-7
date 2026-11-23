# Showcase filter-count acceleration and portability

This v5 experiment adds one small derived table, `registry_filter_counts`, for exact totals on common single-filter registry views.

The table uses ordinary relational SQL only and is designed to map directly to:

- Cloudflare D1 / SQLite
- local SQLite
- Turso/libSQL
- PostgreSQL / Supabase

No new FTS5, SQLite pragma, collation, JSON, trigger, or vendor extension is required by this optimization.

## Correctness rule

`horses` remains canonical. A precomputed total is used only when:

1. exactly one supported exact filter is active;
2. `registry_state.analytics_stale=0`; and
3. `registry_filter_counts.source_revision` matches `registry_state.analytics_source_revision`.

Otherwise the API falls back to the existing exact `COUNT(*)` query.

Supported precomputed dimensions are `breed`, `sex`, `color`, `mainStrain`, `importedFrom`, `lifecycle`, `isImported`, `isSport`, `isStallion`, `hasSportCard`, `hasSire`, and `hasDam`.

Substring searches, free text, year ranges, relationship filters, IDs, sire/dam name filters, and multi-filter combinations retain exact live counts.

This makes the optimization portable and disposable: provider-specific indexes may be added later, but correctness never depends on them.

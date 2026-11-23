# Horse-DB-3 R7 generation-gate fix — 2026-09-10

Scope: narrow public-read automatic failover safety fix only.

Why: the R6 failover admission gate could accept a fallback on a cold primary failure without having observed the primary canonical revision first. Count/source/import/filter checks prevented partial or wrong-source databases, but did not independently pin the deployed canonical/derived serving generation.

R7 changes `src/db/provider.ts` so every provider health probe must also match the deployed generation contract:
- exact canonical revision (current frozen generation: `0`), overridable through `DB_FAILOVER_REQUIRED_CANONICAL_REVISION`;
- `registry_state.analytics_stale = 0`;
- exact analytics source revision `sha256:a5406054702e6188e9a4dac44004b64e3c0af6ae358d02c12abd9117744000cf`, overridable through `DB_FAILOVER_REQUIRED_ANALYTICS_SOURCE_REVISION`;
- registry-overview analytics snapshot source revision matches that generation;
- all 412 filter-count rows are from that same derived generation (MIN/MAX source revision both match).

The existing observed-primary revision comparison remains as a second same-isolate check. Therefore a cold Worker start with an unreachable primary now fails closed if the fallback is a stale-but-complete generation.

No database schema/data/index change. No write-authority change. Automatic failover remains public-read-only.

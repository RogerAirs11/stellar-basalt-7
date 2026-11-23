# Turn 28 (2026-10-23) — quality pass 2 coordination + ar/zh newsroom exposure (0.72.0)

Data-side work lives in sheyhe-scraper (commit 09d0a81). This repo shipped:

## 0.71.2 — serving pin coordination (fail-closed contract)

- Supabase canonical generation refreshed to sha256:c6fea7b1… / 93,892 active
  horses (turn-28 quality pass 2: 1,097 chip-evidence merges + 1,568 name-only
  racing-parent stubs, see sheyhe-scraper docs/WORKLOG.md).
- provider.ts pins bumped: DEFAULT_REQUIRED_SOURCE_SHA / DEFAULT_REQUIRED_HORSES
  = c6fea7b1… / 93_892 (analytics + bare-hex). D1 + Turso lag documented in the
  pin comment (Turso caught up later the same turn; D1 awaits quota reset).
- Gates: npm run check EXIT 0 (1,825 vitest + 268 python + validators);
  build + dist asset gate green; wrangler deploy (Worker d0c814bf).
- Runtime snapshot stats.searchRows patched 93,421 -> 93,892 (jsonb rewrite —
  same post-refresh step as turn 26).

## 0.72.0 — AR/ZH newsroom exposure (turn-24 follow-up COMPLETE)

- ContentPost contract += title_ar/title_zh, summary_ar/summary_zh,
  body_ar/body_zh (decoded ""-defaulted); language_completeness map now covers
  en/fa/ar/zh (honest contentLanguageStatus per edition).
- ContentInputSchema (admin create/update) += optional ar/zh fields;
  normalizeContentInput trims/defaults them; INSERT (29 cols) + UPDATE widened;
  publish guard error payload reports all four editions.
- Frontends: the four editorial-studio surfaces (equidata-elite, fei-classic,
  retro-astra, heritage EditorialStudioPage) draftLanguages now include ar/zh;
  unsaved-preview literals carry the new fields; mock platform client updated.
- Tests: r117-17 editorial workflow expectations extended (ar/zh "missing" on
  en/fa-only fixtures); tsc clean; full check EXIT 0.
- Deployed via wrangler (Worker bb2fedca). LIVE VERIFIED: /api/health ok 0.72.0
  93,892/93,892 searchReady true snapshotStale false; /api/content/posts serves
  all six ar/zh fields + 4-language completeness (cache-busted checks on
  iraho.ir and workers.dev). NOTE: the public posts endpoint is edge-cached —
  cache-bust when verifying field-level changes.

## Housekeeping

- tools/turn26_d1_mirror.py repaired (the turn-27 security scrub had committed
  it with '[h'-stripped syntax corruption) and updated for turn 28
  (c6fea7b1/93,892 ledger + counter). Rerun it AFTER 2026-10-24 00:00 UTC to
  finish the D1 mirror (quota exhausted today by turn-26/27 writes).

-- 0123: horse ratings columns on horse_racing_stats (data-parity migration).
-- The asbdavani.app delta scrape of 2026-10-29 pulled horseRating
-- {ior_1000, ior_1200, ior_mile} for every racing horse (18,690 profiles) and
-- the merge script (asbdavani-scraper/scraper/merge_supabase_2026_10_29.py)
-- added the three columns directly to the canonical Supabase table and the
-- D1 failover replica. This migration re-declares the exact production shape
-- for local dev / test parity (same doctrine as 0104 racing_surfaces).
-- The columns are additive and NULLable; no existing row is rewritten.
-- Portability: SQLite D1 has no ADD COLUMN IF NOT EXISTS — the D1 apply path
-- tolerates "duplicate column name" errors (see 0104 precedent).
ALTER TABLE horse_racing_stats ADD COLUMN ior_1000 INTEGER;
ALTER TABLE horse_racing_stats ADD COLUMN ior_1200 INTEGER;
ALTER TABLE horse_racing_stats ADD COLUMN ior_mile INTEGER;

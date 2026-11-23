-- 0104: R140-G — racing surfaces (dev/test parity DDL).
-- racing_races (12,924) + racing_results (122,063) already exist in the
-- canonical Supabase database (merged from asbdavani.app, import
-- 'merge_sheyhe_asbdavani_2026-10-20'). They were created OUTSIDE the repo,
-- so this migration re-declares the exact production shape for local dev and
-- the test engine. On Supabase/D1 every statement is IF [NOT] EXISTS — the
-- migration is a no-op wherever the tables already exist, and it never
-- touches or rewrites production rows.
--
-- Serving doctrine (from the R140 plan):
--   - identity crosswalk ONLY: racing_results.registry_horse_id is the single
--     join key to horses.id (14,083 linked horses). Name-based matching is
--     forbidden (two different horses can share a name).
--   - every served row is provenance-stamped source=asbdavani, level
--     imported_unverified, until the federation attests otherwise.
--
-- Portability: stock SQLite-compatible DDL only.

CREATE TABLE IF NOT EXISTS racing_races (
  race_id TEXT PRIMARY KEY,
  week_id TEXT,
  week_name TEXT,
  week_date TEXT,
  week_number INTEGER,
  league_id TEXT,
  season TEXT,
  location TEXT,
  round_no INTEGER,
  race_name TEXT,
  status TEXT,
  media TEXT,
  plan_id TEXT,
  plan_name TEXT,
  distance_m INTEGER,
  age_class TEXT,
  blood TEXT,
  breed TEXT,
  condition_name TEXT,
  condition_type TEXT,
  prize_name TEXT,
  prizes TEXT,
  data_origin TEXT
);
CREATE INDEX IF NOT EXISTS idx_racing_races_week_date ON racing_races(week_date DESC, race_id);
CREATE INDEX IF NOT EXISTS idx_racing_races_season ON racing_races(season, week_date DESC);

CREATE TABLE IF NOT EXISTS racing_results (
  racehorse_id TEXT PRIMARY KEY,
  race_id TEXT,
  week_id TEXT,
  week_date TEXT,
  season TEXT,
  location TEXT,
  round_no INTEGER,
  plan_name TEXT,
  distance_m INTEGER,
  number INTEGER,
  rank INTEGER,
  is_run INTEGER,
  time_s NUMERIC,
  weight NUMERIC,
  carried_weight NUMERIC,
  tools_weight NUMERIC,
  entrance_rating INTEGER,
  dl NUMERIC,
  registration_cost NUMERIC,
  owner_text TEXT,
  horse_id TEXT,
  horse_name TEXT,
  horse_sex TEXT,
  horse_birthdate TEXT,
  horse_starts INTEGER,
  horse_p1 INTEGER,
  horse_p2 INTEGER,
  horse_p3 INTEGER,
  sire_id TEXT,
  sire_name TEXT,
  dam_id TEXT,
  dam_name TEXT,
  rider_id TEXT,
  rider_name TEXT,
  coach_id TEXT,
  coach_name TEXT,
  data_origin TEXT,
  registry_horse_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_racing_results_horse ON racing_results(registry_horse_id, week_date DESC);
CREATE INDEX IF NOT EXISTS idx_racing_results_race ON racing_results(race_id, rank);
CREATE INDEX IF NOT EXISTS idx_racing_results_week_date ON racing_results(week_date DESC, race_id);

-- R154 repair: horse_racing_stats was also created OUTSIDE the repo (the
-- asbdavani stats import, R139/R146 era) and never had a parity DDL here, so
-- fresh local/test databases failed migration 0123 (ior_* ALTERs) with
-- "no such table". Re-declared from the live production shape
-- (Supabase information_schema, 2026-10-29), PK on asbdavani_horse_id.
CREATE TABLE IF NOT EXISTS horse_racing_stats (
  asbdavani_horse_id TEXT PRIMARY KEY,
  registry_horse_id TEXT,
  sheyhe_slug TEXT,
  name TEXT,
  starts INTEGER,
  win INTEGER,
  second INTEGER,
  third INTEGER,
  ior TEXT,
  match_method TEXT,
  updated_at TEXT,
  data_origin TEXT
);

-- R47b: Competition records (client requirement: سوابق مسابقات).
-- Ordinary relational SQL only: portable across SQLite/D1/Turso and PostgreSQL/Supabase.
-- Provenance is a first-class column: demo/federation/user rows are distinguishable
-- forever, so illustrative seed data can never masquerade as federation records.

CREATE TABLE IF NOT EXISTS competitions (
  id INTEGER PRIMARY KEY,
  name_native TEXT NOT NULL,
  name_latin TEXT,
  discipline TEXT NOT NULL CHECK (discipline IN ('show_jumping','dressage','endurance','racing','eventing','halter','freestyle')),
  event_date TEXT NOT NULL,
  end_date TEXT,
  venue TEXT NOT NULL,
  city TEXT,
  organizer TEXT,
  tier TEXT NOT NULL DEFAULT 'regional' CHECK (tier IN ('local','regional','national','international')),
  season INTEGER NOT NULL,
  notes TEXT,
  provenance TEXT NOT NULL DEFAULT 'user' CHECK (provenance IN ('demo','federation','user')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_competitions_season ON competitions(season, event_date DESC);
CREATE INDEX IF NOT EXISTS idx_competitions_discipline ON competitions(discipline, event_date DESC);

CREATE TABLE IF NOT EXISTS competition_results (
  id INTEGER PRIMARY KEY,
  competition_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  horse_id INTEGER NOT NULL REFERENCES horses(id) ON DELETE CASCADE,
  rider_name TEXT,
  rider_club TEXT,
  class_name TEXT,
  placement INTEGER,
  placement_text TEXT,
  score TEXT,
  is_eliminated INTEGER NOT NULL DEFAULT 0 CHECK (is_eliminated IN (0,1)),
  is_withdrawn INTEGER NOT NULL DEFAULT 0 CHECK (is_withdrawn IN (0,1)),
  notes TEXT,
  provenance TEXT NOT NULL DEFAULT 'user' CHECK (provenance IN ('demo','federation','user')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(competition_id, horse_id, class_name)
);
CREATE INDEX IF NOT EXISTS idx_competition_results_horse ON competition_results(horse_id, competition_id DESC);
CREATE INDEX IF NOT EXISTS idx_competition_results_comp ON competition_results(competition_id, placement);

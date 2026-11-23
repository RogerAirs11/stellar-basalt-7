-- Master-Ai plan T12: complete profile facts, temporal relations and dates.
--
-- Typed registry dates: every temporal fact now stores value + precision +
-- EXPLICIT calendar (gregorian|solar_hijri). A year-only DOB stays exactly a
-- year — the legacy birth_year column is preserved as the Gregorian BUCKET
-- year used by search/filters, and the typed columns carry the honest fact
-- (see src/registry/dates.ts for the conversion mathematics).
--
-- Places: public birth city/province and current keeping city/province are
-- separate from the private precise address, which is never exposed through
-- any public projection (staff-only reads, DATA_VISIBILITY.md).
--
-- horse_ownership_periods: historical title periods with optional co-ownership
-- shares. Overlap detection is precision-aware and enforced in the application
-- layer (src/registry/relations.ts) because SQLite/Postgres CHECK constraints
-- cannot express interval exclusion. An account signup is NEVER a title
-- transfer (T10 doctrine): periods are staff-curated facts, grants remain
-- permissions.
--
-- horse_lifecycle_events: dated lifecycle history (death, castration,
-- retirement, export, import, other) with uncertain-time honesty.

-- ---------------------------------------------------------------------------
-- horses: typed dates + places (all additive; legacy columns untouched).
-- ---------------------------------------------------------------------------
ALTER TABLE horses ADD COLUMN birth_date_value TEXT;
ALTER TABLE horses ADD COLUMN birth_date_precision TEXT CHECK (birth_date_precision IS NULL OR birth_date_precision IN ('day','month','year'));
ALTER TABLE horses ADD COLUMN birth_date_calendar TEXT CHECK (birth_date_calendar IS NULL OR birth_date_calendar IN ('gregorian','solar_hijri'));
ALTER TABLE horses ADD COLUMN birth_date_source TEXT;

ALTER TABLE horses ADD COLUMN death_date_value TEXT;
ALTER TABLE horses ADD COLUMN death_date_precision TEXT CHECK (death_date_precision IS NULL OR death_date_precision IN ('day','month','year'));
ALTER TABLE horses ADD COLUMN death_date_calendar TEXT CHECK (death_date_calendar IS NULL OR death_date_calendar IN ('gregorian','solar_hijri'));

ALTER TABLE horses ADD COLUMN castration_date_value TEXT;
ALTER TABLE horses ADD COLUMN castration_date_precision TEXT CHECK (castration_date_precision IS NULL OR castration_date_precision IN ('day','month','year'));
ALTER TABLE horses ADD COLUMN castration_date_calendar TEXT CHECK (castration_date_calendar IS NULL OR castration_date_calendar IN ('gregorian','solar_hijri'));

ALTER TABLE horses ADD COLUMN birth_city TEXT;
ALTER TABLE horses ADD COLUMN birth_province TEXT;
ALTER TABLE horses ADD COLUMN keeping_city TEXT;
ALTER TABLE horses ADD COLUMN keeping_province TEXT;
-- Private: precise current address. Never in any public projection or
-- reviewed-change whitelist; editor-direct writes only, owner/staff reads.
ALTER TABLE horses ADD COLUMN precise_address TEXT;

-- Honest backfill: the legacy birth_year column was always year-precision
-- Gregorian data, so the typed projection of an existing row is exactly
-- (year, 'year', 'gregorian'). No January 1 is ever invented by storage.
UPDATE horses
  SET birth_date_value = CAST(birth_year AS TEXT),
      birth_date_precision = 'year',
      birth_date_calendar = 'gregorian'
  WHERE birth_year IS NOT NULL AND birth_date_value IS NULL;

-- ---------------------------------------------------------------------------
-- Ownership periods (historical title; staff-curated, evidence-linked).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS horse_ownership_periods (
  id INTEGER PRIMARY KEY,
  horse_id INTEGER NOT NULL REFERENCES horses(id) ON DELETE CASCADE,
  owner_person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE RESTRICT,
  start_value TEXT NOT NULL,
  start_precision TEXT NOT NULL CHECK (start_precision IN ('day','month','year')),
  start_calendar TEXT NOT NULL CHECK (start_calendar IN ('gregorian','solar_hijri')),
  end_value TEXT,
  end_precision TEXT CHECK (end_precision IS NULL OR end_precision IN ('day','month','year')),
  end_calendar TEXT CHECK (end_calendar IS NULL OR end_calendar IN ('gregorian','solar_hijri')),
  -- NULL share = unstated; when stated, shares of overlapping periods must
  -- sum to <= 100 (enforced in src/registry/relations.ts, precision-aware).
  share_percent REAL CHECK (share_percent IS NULL OR (share_percent > 0 AND share_percent <= 100)),
  evidence_note TEXT,
  source TEXT,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((end_value IS NULL AND end_precision IS NULL AND end_calendar IS NULL)
      OR (end_value IS NOT NULL AND end_precision IS NOT NULL AND end_calendar IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_horse_ownership_periods_horse
  ON horse_ownership_periods(horse_id, owner_person_id);

-- ---------------------------------------------------------------------------
-- Lifecycle events (dated history with uncertain-time honesty).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS horse_lifecycle_events (
  id INTEGER PRIMARY KEY,
  horse_id INTEGER NOT NULL REFERENCES horses(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('death','castration','retirement','export','import','other')),
  date_value TEXT NOT NULL,
  date_precision TEXT NOT NULL CHECK (date_precision IN ('day','month','year')),
  date_calendar TEXT NOT NULL CHECK (date_calendar IN ('gregorian','solar_hijri')),
  uncertain_time INTEGER NOT NULL DEFAULT 0 CHECK (uncertain_time IN (0,1)),
  note TEXT,
  source_ref TEXT,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_horse_lifecycle_events_horse
  ON horse_lifecycle_events(horse_id, event_type);

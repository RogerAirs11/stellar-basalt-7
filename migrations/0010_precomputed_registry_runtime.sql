-- Precomputed registry runtime structures for hot read paths.
-- All structures are rebuildable from canonical tables and preserve API semantics.

CREATE TABLE IF NOT EXISTS registry_runtime_counters (
  id INTEGER PRIMARY KEY CHECK (id=1),
  active_horse_count INTEGER NOT NULL DEFAULT 0 CHECK (active_horse_count >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO registry_runtime_counters(id,active_horse_count)
SELECT 1,COUNT(*) FROM horses WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS person_registry_stats (
  person_id INTEGER PRIMARY KEY REFERENCES people(id) ON DELETE CASCADE,
  owner_count INTEGER NOT NULL DEFAULT 0 CHECK (owner_count >= 0),
  breeder_count INTEGER NOT NULL DEFAULT 0 CHECK (breeder_count >= 0),
  importer_count INTEGER NOT NULL DEFAULT 0 CHECK (importer_count >= 0),
  passport_receiver_count INTEGER NOT NULL DEFAULT 0 CHECK (passport_receiver_count >= 0),
  horse_count INTEGER NOT NULL DEFAULT 0 CHECK (horse_count >= 0),
  source_revision TEXT NOT NULL,
  generated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_person_registry_stats_rank
  ON person_registry_stats(horse_count DESC, person_id);

CREATE TABLE IF NOT EXISTS horse_registry_people_summary (
  horse_id INTEGER PRIMARY KEY REFERENCES horses(id) ON DELETE CASCADE,
  owner_name TEXT,
  owner_name_native TEXT,
  breeder_name TEXT,
  breeder_name_native TEXT,
  importer_name TEXT,
  importer_name_native TEXT,
  passport_receiver_name TEXT,
  passport_receiver_name_native TEXT,
  source_revision TEXT NOT NULL,
  generated_at TEXT NOT NULL
);

-- Exact/facet filter indexes. These support existing equality/boolean semantics;
-- no API behavior or fuzzy-search admission rules change.
CREATE INDEX IF NOT EXISTS idx_horses_active_color_filter
  ON horses(color_desc COLLATE NOCASE, id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_horses_active_strain_filter
  ON horses(main_strain_desc COLLATE NOCASE, id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_horses_active_import_origin_filter
  ON horses(imported_from_desc COLLATE NOCASE, id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_horses_active_lifecycle
  ON horses(is_dead, is_active, id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_horses_active_imported_true
  ON horses(id) WHERE deleted_at IS NULL AND is_imported=1;
CREATE INDEX IF NOT EXISTS idx_horses_active_sport_true
  ON horses(id) WHERE deleted_at IS NULL AND is_sport=1;
CREATE INDEX IF NOT EXISTS idx_horses_active_stallion_true
  ON horses(id) WHERE deleted_at IS NULL AND is_stallion=1;
CREATE INDEX IF NOT EXISTS idx_horses_active_sport_card_true
  ON horses(id) WHERE deleted_at IS NULL AND has_sport_card=1;

-- Role-specific current-link lookups are hot on browse/profile projections.
CREATE INDEX IF NOT EXISTS idx_horse_people_horse_role_current
  ON horse_people(horse_id, role, is_current, person_id);

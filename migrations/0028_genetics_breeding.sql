-- R47b: Structured genetics + breeding records (client phase-2 requirement,
-- delivered early). genetic_tests model disease-marker panel results
-- (SCID/CA/LFS/OLWS/HYPP/... and coat-color loci) with lab provenance and a
-- federation-verified flag. breeding_records model coverings; 'derived'
-- provenance marks records derived deterministically from registered pedigree
-- (sire x dam -> foal), which is real registry data, not invention.
-- Portable relational SQL.

CREATE TABLE IF NOT EXISTS genetic_tests (
  id INTEGER PRIMARY KEY,
  horse_id INTEGER NOT NULL REFERENCES horses(id) ON DELETE CASCADE,
  test_type TEXT NOT NULL,
  test_category TEXT NOT NULL DEFAULT 'disease' CHECK (test_category IN ('disease','coat_color','parentage','diversity','other')),
  result TEXT NOT NULL,
  result_interpretation TEXT,
  lab_name TEXT,
  lab_accession TEXT,
  tested_at TEXT,
  verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0,1)),
  certificate_media_id TEXT,
  notes TEXT,
  provenance TEXT NOT NULL DEFAULT 'user' CHECK (provenance IN ('demo','federation','user')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(horse_id, test_type)
);
CREATE INDEX IF NOT EXISTS idx_genetic_tests_horse ON genetic_tests(horse_id, test_category);
CREATE INDEX IF NOT EXISTS idx_genetic_tests_type ON genetic_tests(test_type, result);

CREATE TABLE IF NOT EXISTS breeding_records (
  id INTEGER PRIMARY KEY,
  sire_id INTEGER NOT NULL REFERENCES horses(id) ON DELETE CASCADE,
  dam_id INTEGER NOT NULL REFERENCES horses(id) ON DELETE CASCADE,
  covering_date TEXT,
  season INTEGER,
  method TEXT CHECK (method IN ('natural','ai_fresh','ai_frozen','embryo_transfer')),
  outcome TEXT NOT NULL DEFAULT 'unknown' CHECK (outcome IN ('planned','pregnant','foaled','failed','unknown')),
  foal_id INTEGER REFERENCES horses(id) ON DELETE SET NULL,
  notes TEXT,
  provenance TEXT NOT NULL DEFAULT 'derived' CHECK (provenance IN ('derived','demo','federation','user')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(sire_id, dam_id, season)
);
CREATE INDEX IF NOT EXISTS idx_breeding_records_sire ON breeding_records(sire_id, season DESC);
CREATE INDEX IF NOT EXISTS idx_breeding_records_dam ON breeding_records(dam_id, season DESC);
CREATE INDEX IF NOT EXISTS idx_breeding_records_foal ON breeding_records(foal_id);

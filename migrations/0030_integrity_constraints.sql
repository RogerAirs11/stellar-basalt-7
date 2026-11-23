-- R59 (review fact-check P0 #5-#8): data-integrity constraints.
--
-- horse_media_blobs: the single-column PRIMARY KEY made every chunk after the
-- first fail with UNIQUE constraint violations (migration 0026 shape bug).
-- Rebuild with the composite PK the design always intended.
CREATE TABLE horse_media_blobs_v2 (
  media_id TEXT NOT NULL REFERENCES horse_media(id) ON DELETE CASCADE,
  chunk INTEGER NOT NULL DEFAULT 0,
  data BLOB NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(media_id, chunk)
);
INSERT INTO horse_media_blobs_v2(media_id, chunk, data, created_at)
  SELECT media_id, chunk, data, created_at FROM horse_media_blobs;
DROP TABLE horse_media_blobs;
ALTER TABLE horse_media_blobs_v2 RENAME TO horse_media_blobs;

-- One verified phone number maps to exactly one account.
CREATE UNIQUE INDEX IF NOT EXISTS uq_phone_identities_phone ON phone_identities(phone_e164);

-- A horse appears at most once per competition class (NULL class treated as
-- its own bucket). Legacy data verified clean before adding this.
CREATE UNIQUE INDEX IF NOT EXISTS uq_competition_results_entry
  ON competition_results(competition_id, horse_id, IFNULL(class_name, ''));

-- genetic_tests: retests must accumulate (one result per horse per test type
-- blocked legitimate re-testing). Uniqueness is now the application layer's
-- "latest result per type" rule; keep lookup indexes.
CREATE TABLE genetic_tests_v2 (
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
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO genetic_tests_v2(id,horse_id,test_type,test_category,result,result_interpretation,lab_name,lab_accession,tested_at,verified,certificate_media_id,notes,provenance,created_at)
  SELECT id,horse_id,test_type,test_category,result,result_interpretation,lab_name,lab_accession,tested_at,verified,certificate_media_id,notes,provenance,created_at FROM genetic_tests;
DROP TABLE genetic_tests;
ALTER TABLE genetic_tests_v2 RENAME TO genetic_tests;
CREATE INDEX IF NOT EXISTS idx_genetic_tests_horse ON genetic_tests(horse_id, test_category);
CREATE INDEX IF NOT EXISTS idx_genetic_tests_type ON genetic_tests(test_type, result);

-- breeding_records: repeated coverings of the same pairing within a season
-- are legitimate (re-breeding after a failed covering). Drop the hard
-- UNIQUE(sire_id, dam_id, season); the application layer treats the newest
-- record per pairing/season as current.
CREATE TABLE breeding_records_v2 (
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
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO breeding_records_v2(id,sire_id,dam_id,covering_date,season,method,outcome,foal_id,notes,provenance,created_at)
  SELECT id,sire_id,dam_id,covering_date,season,method,outcome,foal_id,notes,provenance,created_at FROM breeding_records;
DROP TABLE breeding_records;
ALTER TABLE breeding_records_v2 RENAME TO breeding_records;
CREATE INDEX IF NOT EXISTS idx_breeding_records_sire ON breeding_records(sire_id, season DESC);
CREATE INDEX IF NOT EXISTS idx_breeding_records_dam ON breeding_records(dam_id, season DESC);
CREATE INDEX IF NOT EXISTS idx_breeding_records_foal ON breeding_records(foal_id);

-- horse_claims: the person record to link canonically when a claim is
-- approved (drives the horse_people owner link applied at approval time).
ALTER TABLE horse_claims ADD COLUMN person_id INTEGER REFERENCES people(id) ON DELETE SET NULL;

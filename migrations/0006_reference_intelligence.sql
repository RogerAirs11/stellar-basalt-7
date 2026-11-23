-- Disposable per-horse reference-population intelligence derived from canonical registry data.
-- Rebuilt by tools/build_analytics_snapshot.py whenever sourceRevision/algorithmVersion changes.
CREATE TABLE IF NOT EXISTS horse_reference_intelligence (
  horse_id INTEGER PRIMARY KEY REFERENCES horses(id) ON DELETE CASCADE,
  source_revision TEXT NOT NULL,
  algorithm_version TEXT NOT NULL,
  cohort_key TEXT NOT NULL,
  cohort_label TEXT NOT NULL,
  reference_start_year INTEGER NOT NULL,
  reference_end_year INTEGER NOT NULL,
  reference_population_size INTEGER NOT NULL,
  sample_size INTEGER NOT NULL,
  member_of_reference_cohort INTEGER NOT NULL DEFAULT 0 CHECK(member_of_reference_cohort IN (0,1)),
  pedigree_completeness_percent REAL NOT NULL,
  mean_kinship_percent REAL,
  mean_kinship_standard_error_percent REAL,
  mean_kinship_percentile REAL,
  kinship_rarity_percentile REAL,
  ancestor_rarity_index REAL NOT NULL,
  ancestor_rarity_percentile REAL NOT NULL,
  tail_male_root_id INTEGER,
  tail_male_root_share_percent REAL,
  tail_female_root_id INTEGER,
  tail_female_root_share_percent REAL,
  diversity_preservation_index REAL NOT NULL,
  confidence_grade TEXT NOT NULL,
  generated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hri_cohort ON horse_reference_intelligence(cohort_key);
CREATE INDEX IF NOT EXISTS idx_hri_dpi ON horse_reference_intelligence(cohort_key, diversity_preservation_index DESC);
CREATE INDEX IF NOT EXISTS idx_hri_kinship ON horse_reference_intelligence(cohort_key, mean_kinship_percent ASC);

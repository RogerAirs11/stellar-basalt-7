-- 0101: R140-A — decouple verification from publication for health results.
-- Master-AI finding (confirmed in code): projectGeneticTest equated
-- "verified" with "publishable", so verified disease/health results (SCID
-- carrier, HYPP affected, ...) crossed the public boundary. A registry must
-- treat health data as private-by-default: verification stays a quality gate,
-- while publication requires an explicit disclosure decision (owner consent
-- recorded by staff, or a privileged staff publication).
--
-- `genetic_tests.public_disclosed` = explicit publication permission flag.
--   0 (default) — disease-category rows stay staff-only.
--   1           — the row may cross the public boundary (still only when
--                 verified=1; an unverified result is never published).
-- Non-health categories (coat_color / parentage / diversity / other) keep the
-- existing verified=>public rule; identity and coat facts are registry facts.
--
-- Portability: stock SQLite-compatible DDL (ADD COLUMN + IF NOT EXISTS index),
-- runs on Supabase (PostgreSQL), D1 (SQLite fork) and the local test engine.

ALTER TABLE genetic_tests ADD COLUMN public_disclosed INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_genetic_tests_disclosure
  ON genetic_tests(horse_id, test_category, public_disclosed);

-- Preserve the two pre-existing public People statistics semantics separately.
--
-- Directory (/api/people) counts all canonical horse_people links, including
-- links whose horse has later been archived.  Person profile
-- (/api/people/:id) counts only links to non-archived horses.  The original
-- v3 materialization had only the directory-shaped columns, which made the
-- profile fast path incorrect once archived horses exist.
ALTER TABLE person_registry_stats ADD COLUMN profile_owner_count INTEGER NOT NULL DEFAULT 0 CHECK (profile_owner_count >= 0);
ALTER TABLE person_registry_stats ADD COLUMN profile_breeder_count INTEGER NOT NULL DEFAULT 0 CHECK (profile_breeder_count >= 0);
ALTER TABLE person_registry_stats ADD COLUMN profile_importer_count INTEGER NOT NULL DEFAULT 0 CHECK (profile_importer_count >= 0);
ALTER TABLE person_registry_stats ADD COLUMN profile_passport_receiver_count INTEGER NOT NULL DEFAULT 0 CHECK (profile_passport_receiver_count >= 0);
ALTER TABLE person_registry_stats ADD COLUMN profile_horse_count INTEGER NOT NULL DEFAULT 0 CHECK (profile_horse_count >= 0);

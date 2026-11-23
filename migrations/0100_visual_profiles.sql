-- Migration 0100 (turn 32): visual completeness round.
-- * horses.profile_image_url / profile_image_credit — a representative photo
--   for the horse profile hero. Populated ONLY for prominent records (top
--   racing/sport champions); the credit column always names the photo's
--   origin class so a representative breed photo can never read as a
--   verified passport photo.
-- * competitions.image_url / image_credit — per-event illustrative photo for
--   the competitions page (list thumbnail + detail sheet header).
-- Portability: additive DDL only, identical on SQLite/D1 and PostgreSQL.
ALTER TABLE horses ADD COLUMN profile_image_url TEXT;
ALTER TABLE horses ADD COLUMN profile_image_credit TEXT;
ALTER TABLE competitions ADD COLUMN image_url TEXT;
ALTER TABLE competitions ADD COLUMN image_credit TEXT;

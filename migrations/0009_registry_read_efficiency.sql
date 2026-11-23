-- Read-only registry efficiency indexes.
-- These preserve query semantics while avoiding full-table sort work for the
-- three user-selectable sort columns that previously had no supporting index.
CREATE INDEX IF NOT EXISTS idx_horses_active_breed_sort
  ON horses(breed_desc COLLATE NOCASE, id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_horses_active_sex_sort
  ON horses(sex_desc COLLATE NOCASE, id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_horses_active_place_sort
  ON horses(birth_place_desc COLLATE NOCASE, id) WHERE deleted_at IS NULL;

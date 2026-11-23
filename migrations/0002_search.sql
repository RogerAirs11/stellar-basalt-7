CREATE TABLE IF NOT EXISTS horse_search_source (
  horse_id INTEGER PRIMARY KEY REFERENCES horses(id) ON DELETE CASCADE,
  name_latin TEXT NOT NULL DEFAULT '',
  name_native TEXT NOT NULL DEFAULT '',
  identifiers TEXT NOT NULL DEFAULT '',
  owners TEXT NOT NULL DEFAULT '',
  breeders TEXT NOT NULL DEFAULT '',
  father_name TEXT NOT NULL DEFAULT '',
  mother_name TEXT NOT NULL DEFAULT '',
  places TEXT NOT NULL DEFAULT '',
  breed TEXT NOT NULL DEFAULT '',
  all_text TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE VIRTUAL TABLE IF NOT EXISTS horse_search_fts USING fts5(
  name_latin,
  name_native,
  identifiers,
  owners,
  breeders,
  father_name,
  mother_name,
  places,
  breed,
  all_text,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE VIRTUAL TABLE IF NOT EXISTS horse_search_trigram USING fts5(
  all_text,
  tokenize = 'trigram'
);

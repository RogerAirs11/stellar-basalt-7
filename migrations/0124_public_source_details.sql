-- Optional source-attributed equine facts, deliberately separate from the master row.
CREATE TABLE IF NOT EXISTS horse_public_source_details(horse_id INTEGER NOT NULL,field TEXT NOT NULL,reported_value TEXT NOT NULL,source_slug TEXT NOT NULL,archive_date TEXT NOT NULL,checked_date TEXT,PRIMARY KEY(horse_id,field));

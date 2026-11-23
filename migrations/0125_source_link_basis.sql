-- Expose only the evidence category, never the private identifier or its value.
CREATE TABLE IF NOT EXISTS horse_public_source_basis (horse_id INTEGER PRIMARY KEY,source_slug TEXT NOT NULL,basis TEXT NOT NULL);

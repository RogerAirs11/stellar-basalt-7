-- Portable precomputed totals for the showcase registry's common single-filter paths.
-- Ordinary relational SQL only: compatible as a data model with SQLite/D1/Turso
-- and PostgreSQL/Supabase. Canonical horses remain authoritative.
CREATE TABLE IF NOT EXISTS registry_filter_counts (
  filter_key TEXT NOT NULL,
  filter_value TEXT NOT NULL,
  count_value INTEGER NOT NULL CHECK (count_value >= 0),
  source_revision TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  PRIMARY KEY(filter_key,filter_value)
);

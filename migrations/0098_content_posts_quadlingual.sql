-- 0098: Newsroom quadlingual expansion (turn 24)
-- Adds Arabic + Simplified Chinese columns to content_posts so newsroom
-- articles can be published in 4 languages: fa / en / ar / zh.
-- Pattern mirrors the en/fa columns (NOT NULL DEFAULT '' keeps existing rows valid).
-- R125 portability note: originally authored with PostgreSQL's
-- `ADD COLUMN IF NOT EXISTS` (accepted by D1's SQLite fork and applied live
-- there verbatim), which stock SQLite — node:sqlite and python sqlite3, the
-- local test/validator engines — cannot parse. The guard is dropped here so
-- one file is portable across every provider; idempotent re-application is
-- handled by the appliers (tools/ensure_schema.py skips existing columns;
-- both live ledgers recorded 0098 as applied before this edit).

ALTER TABLE content_posts ADD COLUMN title_ar    TEXT NOT NULL DEFAULT '';
ALTER TABLE content_posts ADD COLUMN title_zh    TEXT NOT NULL DEFAULT '';
ALTER TABLE content_posts ADD COLUMN summary_ar  TEXT NOT NULL DEFAULT '';
ALTER TABLE content_posts ADD COLUMN summary_zh  TEXT NOT NULL DEFAULT '';
ALTER TABLE content_posts ADD COLUMN body_ar     TEXT NOT NULL DEFAULT '';
ALTER TABLE content_posts ADD COLUMN body_zh     TEXT NOT NULL DEFAULT '';

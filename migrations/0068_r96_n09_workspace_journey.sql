-- 0068_r96_n09_workspace_journey.sql
-- R96-N09: timezone-aware reminders + the paid-plan expiry surface.
--
-- Row-preserving, additive only: reminder due dates are interpreted in the
-- creator's stated IANA timezone (default Asia/Tehran); due/overdue buckets
-- and delivery use that zone's local date, never a server-side guess.

ALTER TABLE workspace_tasks ADD COLUMN due_timezone TEXT NOT NULL DEFAULT 'Asia/Tehran';

-- 0102: R140-C — bind submission idempotency keys to a payload fingerprint.
-- Second Master-AI audit: the (submitter, key) unique index alone replays the
-- ORIGINAL receipt even when the replayed body describes a different horse —
-- the second horse silently vanished. With payload_digest stored at create
-- time, the server distinguishes:
--   same key + same digest  -> idempotent replay (unchanged T11 behavior)
--   same key + other digest -> 409 idempotency_conflict (mint a fresh key)
-- NULL digests = legacy rows created before this migration; they keep replay.
-- The client rotates its key after every successful create (same round).
--
-- Portability: stock SQLite-compatible DDL, runs on Supabase (PostgreSQL),
-- D1 (SQLite fork) and the local test engine.

ALTER TABLE change_requests ADD COLUMN payload_digest TEXT;

-- 0040_rate_limit_counters.sql
-- R88 agent plan P05 (live-verification finding): the Cloudflare Workers
-- rate-limiting BINDING, while correctly configured and deployed on this
-- account, currently admits every request (verified 2026-10-03 with a
-- minimal probe worker: limit 3/60s returned success 7 consecutive times —
-- a no-op far beyond the binding's documented eventual consistency).
--
-- This table is the ENFORCEMENT layer: a fixed-window counter per bucket key
-- (per-IP for auth/write/expensive classes, per-hashed-identity for the
-- account class). One atomic upsert per request (INSERT .. ON CONFLICT ..
-- RETURNING count) both records and reads the usage, so concurrent writers
-- cannot under-count (SQLite/D1 serializes writes; the python replay suite
-- executes the exact statement).
--
-- Counters are intentionally tiny and reused in place: each key keeps ONE row
-- (window_start + count) that rolls over when the minute window advances, so
-- storage is bounded by distinct-key cardinality, not by request volume.

CREATE TABLE IF NOT EXISTS rate_limit_counters (
  key TEXT PRIMARY KEY,
  window_start TEXT NOT NULL,
  count INTEGER NOT NULL CHECK (count >= 0)
);

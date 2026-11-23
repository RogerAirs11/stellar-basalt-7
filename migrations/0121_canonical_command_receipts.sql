-- 0121: R148 Task 6 — universal direct-create retry idempotency.
-- A direct canonical creation (POST /api/horses) carries a stable client
-- command key bound to (actor, action, command_key). The receipt commits in
-- the SAME transaction as the creation; an exact retry replays the original
-- result, reuse of the key with different content is refused (409
-- command_key_reuse), and a lost response can be reconciled safely:
--   same actor + action + key + same request digest  -> replay the original
--   same actor + action + key + other request digest -> 409 command_key_reuse
-- One receipt per (actor, action, command_key); concurrent duplicates race on
-- this primary key and only the winner's creation lands.
-- Portability: stock SQLite-compatible DDL (D1 / Supabase / local engine).

CREATE TABLE IF NOT EXISTS canonical_command_receipts (
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  command_key TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (actor_user_id, action, command_key)
);
CREATE INDEX IF NOT EXISTS idx_command_receipts_entity
  ON canonical_command_receipts(entity_type, entity_id, created_at);

-- R117-15 (Master AI R117 handoff D19): widen the command_receipts
-- vocabulary with the two R98-N12 commands that were written into the
-- handlers but never added to the CHECK — 'inquiry.reply' and
-- 'inquiry.buyer_close'. Until now an API caller sending an Idempotency-Key
-- with a reply or a buyer close hit a CHECK failure on every real database
-- (the UI paths never attach keys to those commands, which is why the gap
-- stayed hidden; the R117-15 lost-response acceptance pinned it).
--
-- SQLite cannot ALTER a CHECK constraint, so the table is rebuilt in place
-- (standard SQLite 12-step shape): identical columns, keys and defaults,
-- ONLY the CHECK widened. Every existing row is copied verbatim — no data
-- changes, no fabricated receipts — and the actor index is recreated
-- byte-for-byte.
CREATE TABLE command_receipts_r11715 (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  command TEXT NOT NULL CHECK (command IN ('listing.create','listing.status','listing.renew','inquiry.create','inquiry.status','inquiry.reply','inquiry.buyer_close')),
  target_id TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  status_code INTEGER NOT NULL CHECK (status_code IN (200, 201)),
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO command_receipts_r11715(id,actor_user_id,command,target_id,request_digest,status_code,response_json,created_at)
  SELECT id,actor_user_id,command,target_id,request_digest,status_code,response_json,created_at FROM command_receipts;
DROP TABLE command_receipts;
ALTER TABLE command_receipts_r11715 RENAME TO command_receipts;
CREATE INDEX IF NOT EXISTS idx_command_receipts_actor ON command_receipts(actor_user_id, command, created_at DESC);

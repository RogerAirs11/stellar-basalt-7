-- R88 agent plan P03: versioned marketplace commands.
--
-- row_version: optimistic concurrency for sales_listings and sales_inquiries.
-- Every row starts at 1; every mutable command increments it. Edits must carry
-- the version the client read (expected_version) and a stale write is a 409
-- that reports the current version, so two concurrent editors can never both
-- land silently — the loser is told to reload.
--
-- last_operation_id: the P02 marker discipline applied to marketplace writes.
-- A mutable command stamps its per-call operation id on the row it actually
-- changed; the idempotency receipt INSERT in the same D1 batch is conditioned
-- on THIS marker having landed, so a stale write, a racing second writer or a
-- command that failed its authority/version guard can never mint a receipt for
-- an execution that did not happen.
--
-- command_receipts: idempotency receipts. A client-supplied key is claimed by
-- exactly one successful (actor, command, target) execution; the stored
-- request digest makes replay deterministic (same payload -> the original
-- response is replayed without re-executing) and the same key under a
-- different payload is a conflict. Additive only; existing rows backfill to
-- row_version 1, no data changes.

ALTER TABLE sales_listings ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1);
ALTER TABLE sales_listings ADD COLUMN last_operation_id TEXT;
ALTER TABLE sales_inquiries ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1);
ALTER TABLE sales_inquiries ADD COLUMN last_operation_id TEXT;

CREATE TABLE IF NOT EXISTS command_receipts (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  command TEXT NOT NULL CHECK (command IN ('listing.create','listing.status','listing.renew','inquiry.create','inquiry.status')),
  target_id TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  status_code INTEGER NOT NULL CHECK (status_code IN (200, 201)),
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_command_receipts_actor ON command_receipts(actor_user_id, command, created_at DESC);

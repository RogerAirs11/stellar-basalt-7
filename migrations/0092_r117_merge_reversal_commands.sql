-- R117-19 (Master AI R117 handoff, D31 / NEXT_BACKEND.md D31-B): reversible
-- duplicate resolution — the versioned merge/unmerge commands with idempotent
-- receipts and manifest digests. Additive only; no data changes.
--
-- Guarantees encoded here:
--  - horse_merges gains the reversal-safety columns: manifest_digest (the
--    sha256 the operator approved from a FRESH preview — the merge commits
--    only when the reference set still matches it), policy_version (the
--    horse-reference inventory version the manifest was built under),
--    operation_id / unmerge_operation_id (the idempotency keys of the two
--    commands; partial unique indexes keep NULL rows from colliding).
--  - merge_command_receipts is the immutable command-receipt register for
--    BOTH commands (same doctrine as import_row_reviews): one receipt per
--    caller operation key; an exact same-key retry replays the stored
--    response; a reused key with different content is refused by the handler
--    before any write. The receipt is gated inside the guarded transaction —
--    a losing or demoted writer claims nothing.
--
-- The unmerge replay stays manifest-driven and per-entry value-guarded in the
-- handler: an entry whose current value no longer equals the value the merge
-- wrote is NEVER blindly replayed over (the documented D31-B barrier).

ALTER TABLE horse_merges ADD COLUMN manifest_digest TEXT;
ALTER TABLE horse_merges ADD COLUMN policy_version TEXT;
ALTER TABLE horse_merges ADD COLUMN operation_id TEXT;
ALTER TABLE horse_merges ADD COLUMN unmerge_operation_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_horse_merges_operation_id
  ON horse_merges(operation_id) WHERE operation_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_horse_merges_unmerge_operation_id
  ON horse_merges(unmerge_operation_id) WHERE unmerge_operation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS merge_command_receipts (
  id INTEGER PRIMARY KEY,
  operation_id TEXT NOT NULL UNIQUE,
  command TEXT NOT NULL CHECK (command IN ('merge','unmerge')),
  merge_id INTEGER NOT NULL,
  actor_user_id TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  receipt_json TEXT NOT NULL CHECK (length(receipt_json) <= 8000),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_merge_command_receipts_merge
  ON merge_command_receipts(merge_id, command, created_at DESC);

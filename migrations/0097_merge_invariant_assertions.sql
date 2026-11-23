-- 0097 — R122 / R122-T01: a REAL transaction-aborting invariant assertion for
-- merge/unmerge.
--
-- Master AI R122 audit findings R122-A01/A02/A03: the merge previously used a
-- conditional final receipt INSERT as its only integrity gate. When that gate
-- failed (a late reference appeared after preflight, or the moves would create
-- a self-parent), the earlier statements of the batch — reference moves, the
-- soft-archive and the redirect alias — had ALREADY committed, and an exception
-- raised after the batch could not undo them. A merge could also partially
-- commit without its merge record, and never advanced the canonical revision
-- or the active-horse counter.
--
-- The correction is an explicit, adapter-supported assertion: this table's
-- named CHECK constraint (merge_invariant_required) turns a failed invariant
-- predicate into a constraint violation INSIDE the batch, on every provider
-- (D1 batches, SQLite BEGIN/COMMIT and PostgreSQL transactions are atomic),
-- so the ENTIRE merge/unmerge — moves, archive, alias, record, receipt,
-- revision and counters — rolls back together. Successful assertions remain
-- as durable per-operation evidence of exactly what was true at commit time.
CREATE TABLE IF NOT EXISTS merge_invariant_assertions (
  id INTEGER PRIMARY KEY,
  command TEXT NOT NULL CHECK (command IN ('merge','unmerge')),
  operation_id TEXT NOT NULL,
  kept_horse_id INTEGER NOT NULL,
  merged_horse_id INTEGER NOT NULL,
  ok INTEGER NOT NULL CONSTRAINT merge_invariant_required CHECK (ok = 1),
  asserted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_merge_invariant_assertions_operation
  ON merge_invariant_assertions(operation_id, command, asserted_at DESC);

-- R114-02 (Master AI R113 handoff, NEXT_BACKEND.md D18): additive versioned
-- competition event/result editing. Existing rows backfill to row_version 1;
-- no historical edit receipts are fabricated and no read DTO loses data.
--
-- Guarantees encoded here:
--  - competition_results and competitions each carry a monotonic row_version
--    bumped only by the new versioned update commands (guarded compare-and-set
--    on the exact expected version inside the writer's transaction).
--  - competition_command_receipts stores one immutable receipt per caller
--    operation key. An exact same-key retry replays the stored response; a
--    reused key with different content is refused by the handler (scope check)
--    before any write. status_code 200 = idempotent replay, 201 = new effect.
--  - The legacy natural-key identity (competition_id, horse_id, class_name)
--    is intentionally NOT re-indexed or normalized here: the null/empty
--    class_name collision semantics stay exactly as they are until an
--    explicit class normalization plan is approved (NEXT_BACKEND.md D18 #1).
ALTER TABLE competition_results ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1);
ALTER TABLE competition_results ADD COLUMN updated_at TEXT;
ALTER TABLE competition_results ADD COLUMN last_operation_id TEXT;
ALTER TABLE competitions ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1);
ALTER TABLE competitions ADD COLUMN last_operation_id TEXT;

CREATE TABLE IF NOT EXISTS competition_command_receipts (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  command TEXT NOT NULL CHECK (command IN ('result.create','result.update','event.update')),
  competition_id INTEGER NOT NULL,
  result_id INTEGER,
  request_digest TEXT NOT NULL,
  status_code INTEGER NOT NULL CHECK (status_code IN (200, 201)),
  response_json TEXT NOT NULL CHECK (length(response_json) <= 8000),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_competition_receipts_actor
  ON competition_command_receipts(actor_user_id, command, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_competition_receipts_competition
  ON competition_command_receipts(competition_id, created_at DESC);

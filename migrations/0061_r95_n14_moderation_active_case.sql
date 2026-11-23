-- 0061_r95_n14_moderation_active_case.sql
-- R95-N14: correct moderation deduplication and participant lifecycle.
--
-- The defect being fixed (Master AI F27): 0048 put `status` INSIDE the
-- case-unique key (UNIQUE(reporter_user_id, target_table, target_id, status)).
-- That shape (a) allowed MULTIPLE simultaneously active cases for the same
-- reporter+target whenever their active statuses differed ('new' + 'triaged'
-- could coexist), and (b) BLOCKED a legitimate later report once an earlier
-- case for the same target had already closed with the same resolved status —
-- the operator's decision UPDATE then hit a constraint violation.
--
-- The replacement strategy (reviewed plan N14, item 1):
--   * A PARTIAL unique index over (reporter_user_id, target_table, target_id)
--     restricted to the ACTIVE statuses ('new','triaged','action_pending') —
--     portable to both providers (SQLite/D1 and PostgreSQL both support
--     partial indexes natively). Resolved history never occupies the key, so
--     any number of closed cases (including a second case closing with the
--     SAME resolved status as an earlier one) is legitimate.
--   * A structural one-open-appeal index: UNIQUE(case_id) WHERE status='open'
--     — appeal-creation races can no longer produce two open appeals.
--
-- Because dropping a SQLite TABLE constraint requires a table swap, this
-- migration REPLACES moderation_cases (and rebuilds its three child tables
-- so their foreign keys point at the replacement, never at a dropped table):
-- the order is rename-old-aside -> create replacement -> copy every row ->
-- rebuild each child (create/copy/drop-old/rename) -> drop the old parent.
-- Nothing is erased to satisfy an index: every historical case, event,
-- appeal and suspension row is carried over verbatim (step 6 only MERGES
-- duplicate ACTIVE cases, below).
--
-- New shape on moderation_cases:
--   * status gains 'resolved_merged' (deterministic merge outcome, see below).
--   * merged_into_case_id INTEGER — the link from a merged duplicate to the
--     case that stays active. Deliberately NOT a foreign key: a self-table
--     reference across a table swap is fragile in both engines, and the link
--     is write-once here (migration only) — provenance is the event trail.
--
-- Step 6 (the documented merge/link review, executed deterministically):
-- if the same reporter already has MORE THAN ONE active case for the same
-- target (possible under the old schema), the OLDEST (lowest id) stays
-- active and every younger active case becomes 'resolved_merged' with
-- merged_into_case_id pointing at the keeper, a resolution note explaining
-- the merge, and an append-only 'note' event recording it. Keeper selection
-- uses MIN(id) per group, so the result does not depend on row order or on
-- engine-specific UPDATE visibility.
--
-- Portable relational SQL (SQLite/D1 + Postgres translation verified).

-- 1) Move the old parent aside. SQLite rewrites the children's REFERENCES
--    clauses to the new name; PostgreSQL tracks the relation by id.
ALTER TABLE moderation_cases RENAME TO moderation_cases_legacy_0061;

-- 2) The replacement parent: identical columns, the extended status set, the
--    merge link — and NO status-in-unique-key table constraint.
CREATE TABLE moderation_cases (
  id INTEGER PRIMARY KEY,
  target_table TEXT NOT NULL CHECK (target_table IN ('sales_listings','sales_inquiries','service_requests','directory_profiles')),
  target_id TEXT NOT NULL,
  reporter_user_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('fraud_suspected','misrepresentation','offensive_content','spam','counterfeit_documents','animal_welfare','other')),
  details TEXT,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','triaged','action_pending','resolved_dismissed','resolved_hidden','resolved_reinstated','resolved_merged')),
  severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','urgent')),
  assigned_operator_user_id TEXT,
  resolution_note TEXT,
  merged_into_case_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  last_operation_id TEXT
);

-- 3) Carry every historical case over verbatim. Nothing is deleted.
INSERT INTO moderation_cases (id,target_table,target_id,reporter_user_id,reason,details,status,severity,
  assigned_operator_user_id,resolution_note,created_at,updated_at,resolved_at,last_operation_id)
SELECT id,target_table,target_id,reporter_user_id,reason,details,status,severity,
  assigned_operator_user_id,resolution_note,created_at,updated_at,resolved_at,last_operation_id
FROM moderation_cases_legacy_0061;

-- 4a) Rebuild moderation_case_events against the replacement parent.
--     event_type gains 'standing' (the N14 abuse-standing lifecycle records
--     its actions in the same append-only trail).
CREATE TABLE moderation_case_events_0061 (
  id INTEGER PRIMARY KEY,
  case_id INTEGER NOT NULL REFERENCES moderation_cases(id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('created','assigned','note','decision','appeal','reversal','standing')),
  event_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO moderation_case_events_0061 (id,case_id,actor_user_id,event_type,event_json,created_at)
SELECT id,case_id,actor_user_id,event_type,event_json,created_at FROM moderation_case_events;
DROP TABLE moderation_case_events;
ALTER TABLE moderation_case_events_0061 RENAME TO moderation_case_events;
CREATE INDEX IF NOT EXISTS idx_moderation_case_events_case ON moderation_case_events(case_id, id);

-- 4b) Rebuild moderation_appeals against the replacement parent, and make
--     "one OPEN appeal per case" structural (creation races included).
CREATE TABLE moderation_appeals_0061 (
  id INTEGER PRIMARY KEY,
  case_id INTEGER NOT NULL REFERENCES moderation_cases(id) ON DELETE CASCADE,
  appellant_user_id TEXT NOT NULL,
  statement TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','upheld','overturned')),
  decided_by_user_id TEXT,
  decided_at TEXT,
  decision_note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_operation_id TEXT
);
INSERT INTO moderation_appeals_0061 (id,case_id,appellant_user_id,statement,status,decided_by_user_id,
  decided_at,decision_note,created_at,last_operation_id)
SELECT id,case_id,appellant_user_id,statement,status,decided_by_user_id,
  decided_at,decision_note,created_at,last_operation_id FROM moderation_appeals;
DROP TABLE moderation_appeals;
ALTER TABLE moderation_appeals_0061 RENAME TO moderation_appeals;
CREATE INDEX IF NOT EXISTS idx_moderation_appeals_case ON moderation_appeals(case_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_moderation_appeals_one_open ON moderation_appeals(case_id) WHERE status='open';

-- 4c) Rebuild listing_suspensions against the replacement parent.
CREATE TABLE listing_suspensions_0061 (
  id INTEGER PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES sales_listings(id) ON DELETE CASCADE,
  case_id INTEGER REFERENCES moderation_cases(id) ON DELETE SET NULL,
  suspended_by_user_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  suspended_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reinstated_at TEXT,
  reinstated_by_user_id TEXT
);
INSERT INTO listing_suspensions_0061 (id,listing_id,case_id,suspended_by_user_id,reason,suspended_at,reinstated_at,reinstated_by_user_id)
SELECT id,listing_id,case_id,suspended_by_user_id,reason,suspended_at,reinstated_at,reinstated_by_user_id FROM listing_suspensions;
DROP TABLE listing_suspensions;
ALTER TABLE listing_suspensions_0061 RENAME TO listing_suspensions;
CREATE INDEX IF NOT EXISTS idx_listing_suspensions_listing ON listing_suspensions(listing_id, reinstated_at);

-- 5) Nothing references the legacy parent any more: retire it.
DROP TABLE moderation_cases_legacy_0061;

-- 6) Deterministic merge of duplicate ACTIVE cases (the documented
--    merge/link review). Oldest case per (reporter, target) stays active;
--    every younger active case becomes resolved_merged and links to the
--    keeper. All rows, events and decisions remain (only the active flag
--    moves, with a full provenance note + event per merged case).
UPDATE moderation_cases SET
  status='resolved_merged',
  merged_into_case_id=(SELECT MIN(m2.id) FROM moderation_cases m2
    WHERE m2.status NOT LIKE 'resolved%'
      AND m2.reporter_user_id=moderation_cases.reporter_user_id
      AND m2.target_table=moderation_cases.target_table
      AND m2.target_id=moderation_cases.target_id),
  resolution_note='Duplicate active report for the same target by the same reporter; merged into the oldest case by migration 0061. All evidence preserved; see the surviving case.',
  resolved_at=CURRENT_TIMESTAMP,
  updated_at=CURRENT_TIMESTAMP
WHERE status NOT LIKE 'resolved%'
  AND id<>(SELECT MIN(m2.id) FROM moderation_cases m2
    WHERE m2.status NOT LIKE 'resolved%'
      AND m2.reporter_user_id=moderation_cases.reporter_user_id
      AND m2.target_table=moderation_cases.target_table
      AND m2.target_id=moderation_cases.target_id);

-- The append-only merge events (the actor is the migration itself — this
-- was a data repair, not a human decision; that is recorded honestly).
INSERT INTO moderation_case_events(case_id,actor_user_id,event_type,event_json)
SELECT id,'migration_0061','note',
  '{"migration":"0061","action":"merge_duplicate_active_report","note":"duplicate active report for the same target by the same reporter; the oldest case stays active; this case is linked to it via merged_into_case_id. All evidence and decisions are preserved."}'
FROM moderation_cases WHERE merged_into_case_id IS NOT NULL;

-- 7) The dedupe: one ACTIVE case per reporter per target, on both providers.
--    Closed history is outside the key, so any number of resolved cases for
--    the same target (including identical resolved statuses) is legitimate.
CREATE UNIQUE INDEX IF NOT EXISTS uq_moderation_cases_active
  ON moderation_cases(reporter_user_id, target_table, target_id)
  WHERE status IN ('new','triaged','action_pending');

-- The queue/target indexes moved with the legacy table; recreate them for
-- the replacement.
CREATE INDEX IF NOT EXISTS idx_moderation_cases_queue
  ON moderation_cases(status, severity, created_at);
CREATE INDEX IF NOT EXISTS idx_moderation_cases_target
  ON moderation_cases(target_table, target_id, status);

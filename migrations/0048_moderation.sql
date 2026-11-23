-- 0048_moderation.sql
-- R88 agent plan P16: moderation, reporting and marketplace trust operations.
--
-- Doctrine:
--   1. Content moderation is SEPARATE from registry factual correction: a
--      moderation case never rewrites a horse record. Hiding a reported
--      listing suspends the LISTING; the horse profile stays untouched
--      (the acceptance test pins this).
--   2. Every case keeps its FULL trail: moderation_case_events records
--      creation, assignment, notes, decisions, appeals and reversals as an
--      append-only log — an overturned decision never erases the previous
--      one.
--   3. Appeals are first-class: the reported party can appeal with a
--      statement; an appeal decision (upheld/overturned) is itself an event.
--   4. Listing suspension is a transparent overlay (listing_suspensions),
--      shown on the listing — never a silent delete.
--   5. Support-hours honesty: the machine records triage fields but never
--      claims 24/7 staffing (the queue responses say so explicitly).
--
-- Portable relational SQL (SQLite/D1 + Postgres translation verified).

CREATE TABLE IF NOT EXISTS moderation_cases (
  id INTEGER PRIMARY KEY,
  -- What is being reported: the table + row id (listing / inquiry /
  -- service_request / directory profile). Never a horse record itself.
  target_table TEXT NOT NULL CHECK (target_table IN ('sales_listings','sales_inquiries','service_requests','directory_profiles')),
  target_id TEXT NOT NULL,
  reporter_user_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('fraud_suspected','misrepresentation','offensive_content','spam','counterfeit_documents','animal_welfare','other')),
  details TEXT,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','triaged','action_pending','resolved_dismissed','resolved_hidden','resolved_reinstated')),
  severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','urgent')),
  assigned_operator_user_id TEXT,
  resolution_note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  -- One OPEN case per reporter per target: repeated reporting of the same
  -- thing by the same person appends nothing until the case closes.
  UNIQUE(reporter_user_id, target_table, target_id, status)
);

CREATE INDEX IF NOT EXISTS idx_moderation_cases_queue
  ON moderation_cases(status, severity, created_at);
CREATE INDEX IF NOT EXISTS idx_moderation_cases_target
  ON moderation_cases(target_table, target_id, status);

-- The append-only decision trail: creation, assignment, notes, decisions,
-- appeals, reversals. Nothing here is ever updated or deleted.
CREATE TABLE IF NOT EXISTS moderation_case_events (
  id INTEGER PRIMARY KEY,
  case_id INTEGER NOT NULL REFERENCES moderation_cases(id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('created','assigned','note','decision','appeal','reversal')),
  event_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_moderation_case_events_case
  ON moderation_case_events(case_id, id);

-- Appeals by the REPORTED party (e.g. the listing seller).
CREATE TABLE IF NOT EXISTS moderation_appeals (
  id INTEGER PRIMARY KEY,
  case_id INTEGER NOT NULL REFERENCES moderation_cases(id) ON DELETE CASCADE,
  appellant_user_id TEXT NOT NULL,
  statement TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','upheld','overturned')),
  decided_by_user_id TEXT,
  decided_at TEXT,
  decision_note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_moderation_appeals_case
  ON moderation_appeals(case_id, status);

-- Transparent listing suspension overlay: a suspended listing is hidden from
-- public lists and marked on its detail view; the horse profile is NEVER
-- touched, and reinstatement is a new row state, not a delete.
CREATE TABLE IF NOT EXISTS listing_suspensions (
  id INTEGER PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES sales_listings(id) ON DELETE CASCADE,
  case_id INTEGER REFERENCES moderation_cases(id) ON DELETE SET NULL,
  suspended_by_user_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  suspended_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reinstated_at TEXT,
  reinstated_by_user_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_listing_suspensions_listing
  ON listing_suspensions(listing_id, reinstated_at);

-- P16: expose last confirmed availability. Set by the seller (requires a
-- CURRENT create_listing mandate); shown on the listing so buyers can see
-- how fresh the availability claim is.
ALTER TABLE sales_listings ADD COLUMN availability_confirmed_at TEXT;

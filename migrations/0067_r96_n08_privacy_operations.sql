-- 0067_r96_n08_privacy_operations.sql
-- R96-N08: report deduplication + rate bounds, legal holds before retention
-- minimization, indexed bounded metrics aggregation, and the block-complaint
-- support queue.
--
-- Row-preserving, additive only.

-- One report per (request, reporter) FOREVER: retries can never append a
-- second report for the same lead (the report is a pointer for operators).
CREATE UNIQUE INDEX IF NOT EXISTS idx_service_request_reports_unique_pair
  ON service_request_reports(service_request_id, reporter_user_id);

-- The metrics aggregation reads ONLY this indexed window (never unbounded
-- profile history): provider_person_id + created_at bounds the scan.
CREATE INDEX IF NOT EXISTS idx_service_requests_provider_window
  ON service_requests(provider_person_id, created_at);

-- Dispute / legal holds: a held request is NEVER retention-minimized until
-- an authorized admin releases the hold. One ACTIVE hold per request
-- (released holds stay as history; a new hold may then be placed).
CREATE TABLE IF NOT EXISTS service_request_holds (
  id INTEGER PRIMARY KEY,
  service_request_id INTEGER NOT NULL REFERENCES service_requests(id),
  hold_kind TEXT NOT NULL CHECK (hold_kind IN ('dispute','legal_hold')),
  -- Operator-authored reason (bounded; never the private request note text).
  reason TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  -- Landing gate: the audit row exists only for the batch that actually
  -- placed the hold (a refused duplicate places nothing and audits nothing).
  operation_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  released_at TEXT,
  released_by_user_id TEXT,
  release_reason TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_service_request_holds_one_active
  ON service_request_holds(service_request_id) WHERE released_at IS NULL;

-- The support queue for legitimate complaints and mistaken blocks: a blocked
-- requester files ONE complaint per provider pair (retries append nothing);
-- the PRIVATE block reason is never exposed to the complainant — only
-- operators see the queue.
CREATE TABLE IF NOT EXISTS provider_block_complaints (
  id INTEGER PRIMARY KEY,
  complainant_user_id TEXT NOT NULL,
  provider_person_id INTEGER NOT NULL REFERENCES people(id),
  complaint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  resolution_note TEXT,
  resolved_by_user_id TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(complainant_user_id, provider_person_id)
);

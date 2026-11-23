-- 0066_r96_n05_refund_allocation.sql
-- R96-N05: the precise refund/access allocation ledger.
--
-- The partial unique index (0063) already guarantees one active refund per
-- payment. What was missing is the MONEY side of partial refunds: an
-- immutable, versioned record of WHAT is proposed and approved against the
-- immutable grant-interval ledger, so a partially consumed service can never
-- silently refund the full charge, and totals can never exceed the verified
-- receipt. The env flag REFUND_PARTIAL_POLICY_ENABLED was an honesty gate,
-- not a policy; N05 replaces it with this ledger (approvals of
-- partial_consumed refunds require an APPROVED allocation).
--
-- Also: refund_access_reviews (0063) could be opened but never resolved with
-- grant-specific decisions. Decisions are versioned per grant event and never
-- overwrite history.

ALTER TABLE refund_requests ADD COLUMN allocation_status TEXT NOT NULL DEFAULT 'none'
  CHECK (allocation_status IN ('none','proposed','approved','not_applicable','manual_review'));

CREATE TABLE IF NOT EXISTS refund_allocations (
  id INTEGER PRIMARY KEY,
  refund_request_id INTEGER NOT NULL REFERENCES refund_requests(id),
  -- Policy version: proposals are computed against a specific policy; a
  -- changed policy produces a NEW version (old rows stay immutable).
  policy_version INTEGER NOT NULL,
  charge_amount_minor INTEGER NOT NULL CHECK (charge_amount_minor > 0),
  proposed_amount_minor INTEGER NOT NULL CHECK (proposed_amount_minor >= 0),
  currency TEXT NOT NULL,
  -- Machine-readable basis: grant intervals, consumed/remaining days,
  -- proration math, override justification when operator-entered.
  basis_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','superseded','rejected')),
  proposed_by_user_id TEXT NOT NULL,
  approved_by_user_id TEXT,
  approved_at TEXT,
  approval_note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(refund_request_id, policy_version)
);

CREATE INDEX IF NOT EXISTS idx_refund_allocations_request
  ON refund_allocations(refund_request_id, status);

-- Grant-specific review decisions, versioned: re-resolving a review appends
-- a new decision_version row per grant; history is never rewritten.
-- resolution_operation_id binds each decision row to the resolution batch
-- that wrote it — a resolution whose decisions all failed their grant
-- ownership check cannot mark the review resolved.
CREATE TABLE IF NOT EXISTS refund_access_review_decisions (
  id INTEGER PRIMARY KEY,
  refund_request_id INTEGER NOT NULL REFERENCES refund_requests(id),
  grant_event_id INTEGER NOT NULL REFERENCES entitlement_events(id),
  decision_version INTEGER NOT NULL CHECK (decision_version >= 1),
  decision TEXT NOT NULL CHECK (decision IN ('cancel_interval','retain','credit_review')),
  decided_by_user_id TEXT NOT NULL,
  note TEXT NOT NULL,
  resolution_operation_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(refund_request_id, grant_event_id, decision_version)
);

-- R96: operation-specific refund effects and explicit access reconciliation.
-- STOP if multiple active/confirmed requests already exist for one payment.
-- Run the R96 read-only preflight against a restored copy before migration.
ALTER TABLE refund_requests ADD COLUMN last_operation_id TEXT;
ALTER TABLE refund_requests ADD COLUMN last_from_status TEXT;
ALTER TABLE refund_requests ADD COLUMN confirmation_source TEXT;
ALTER TABLE refund_requests ADD COLUMN access_reconciliation_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (access_reconciliation_status IN ('pending','applied','not_applicable','review_required'));
CREATE UNIQUE INDEX IF NOT EXISTS idx_refund_one_active_attempt
  ON refund_requests(payment_attempt_id)
  WHERE status IN ('requested','approved','provider_pending','confirmed');
CREATE UNIQUE INDEX IF NOT EXISTS idx_refund_operation
  ON refund_requests(last_operation_id) WHERE last_operation_id IS NOT NULL;

ALTER TABLE entitlements ADD COLUMN last_refund_operation_id TEXT;

-- Preserve original grant events. Only directly attributable access is changed.
-- Combined/legacy balances are not zeroed: they enter explicit operator review.
CREATE TABLE IF NOT EXISTS refund_access_adjustments (
  id INTEGER PRIMARY KEY,
  refund_request_id INTEGER NOT NULL REFERENCES refund_requests(id),
  grant_event_id INTEGER NOT NULL REFERENCES entitlement_events(id),
  entitlement_id INTEGER REFERENCES entitlements(id),
  disposition TEXT NOT NULL CHECK (disposition IN ('cancelled','no_live_access','review_required')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(refund_request_id,grant_event_id)
);
CREATE TABLE IF NOT EXISTS refund_access_reviews (
  refund_request_id INTEGER PRIMARY KEY REFERENCES refund_requests(id),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  resolved_by_user_id TEXT,
  resolution_note TEXT
);

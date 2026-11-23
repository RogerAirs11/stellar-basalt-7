-- R95-N06: immutable refund ledger. NEXT UNUSED NUMBER (0055 = N05
-- reconciliation; the Master AI's proposed 0055_refund_ledger name was
-- provisional — their policy: assign after checking the actual repo).
--
-- Doctrine (ticket N06 + P18 settlement doctrine):
--   * A refund REQUEST is not money returned. Statuses record exactly where
--     the money is: requested -> approved (operator) -> provider_pending
--     (unknown provider outcome — stays under review, never "success")
--     -> confirmed (provider reference recorded) or failed/rejected.
--   * The original paid event is NEVER mutated. Refund rows are separate and
--     append-only (refund_events mirrors payment_events discipline).
--   * Deterministic idempotency: ONE refund request per verified attempt
--     (request_key UNIQUE), so a repeated request can never return money
--     twice, and the sum of confirmed refunds can never exceed the confirmed
--     payment (also guarded in the command layer).
--   * Product policy is explicit: kind full_unused (nothing consumed; access
--     reversal cancels the whole granted period) vs partial_consumed (part of
--     the period is gone; requires the owner/accountant proration policy
--     before approval — approval fails closed until that policy exists).
--     Completed service history (grant events, consumed periods) is preserved.
--   * Zarinpal reality (docs S01/S02, checked 2026-10-03): refunds/reversals
--     are initiated from the MERCHANT PANEL / merchant support; there is no
--     public refund API on the standard payment gateway. The provider
--     outcome is therefore RECORDED by an operator from the panel — the
--     ledger never invents a provider reference.
CREATE TABLE IF NOT EXISTS refund_requests (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  payment_attempt_id INTEGER NOT NULL REFERENCES payment_attempts(id),
  -- Deterministic: refund:attempt:<attempt id> — one request per attempt.
  request_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('full_unused','partial_consumed')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL DEFAULT 'IRR' CHECK (currency = 'IRR'),
  status TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested','approved','provider_pending','confirmed','failed','rejected','cancelled')),
  reason TEXT NOT NULL,
  requested_by_user_id TEXT NOT NULL,
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_by_user_id TEXT,
  approved_at TEXT,
  provider_reference TEXT,
  provider_status TEXT,
  decided_at TEXT,
  -- Explicit access-reversal policy for THIS refund (what is cancelled, what
  -- history is preserved) — recorded at request time, applied at confirmation.
  entitlement_policy_json TEXT NOT NULL
  -- NOTE: no UNIQUE(order_id, payment_attempt_id): a terminally failed or
  -- rejected request may be followed by a NEW request (new generation key).
  -- The one-ACTIVE-request-per-attempt guard lives in the command SQL
  -- (NOT EXISTS active statuses), which is what actually prevents returning
  -- money twice.
);

CREATE INDEX IF NOT EXISTS idx_refund_requests_buyer
  ON refund_requests(requested_by_user_id, status);

-- Append-only refund history: every status transition with its evidence.
CREATE TABLE IF NOT EXISTS refund_events (
  id INTEGER PRIMARY KEY,
  refund_request_id INTEGER NOT NULL REFERENCES refund_requests(id) ON DELETE CASCADE,
  actor TEXT NOT NULL CHECK (actor IN ('buyer','operator','provider','system')),
  from_status TEXT,
  to_status TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_refund_events_request
  ON refund_events(refund_request_id, id);

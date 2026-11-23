-- 0050_payments_ledger.sql
-- R88 agent plan P18: verified payments, entitlements and reconciliation.
--
-- Doctrine:
--   1. Verification is SERVER-SIDE: the stored amount and the provider
--      authority are checked against the provider's verify response. A
--      redirect's query status is NEVER trusted.
--   2. Exactly one entitlement event per verified payment: event_key is
--      UNIQUE, so concurrent callbacks / replays can never grant a second
--      period. The entitlement state move and the payment verification land
--      in the SAME batch (one transaction).
--   3. Entitlement lifecycle is SEPARATE from order status: activation,
--      expiry, cancellation and refunds are their own rows; a refund writes
--      a compensating event, never a silent rollback.
--   4. Timeouts stay PENDING: an attempt past its staleness horizon becomes
--      'expired' only through the explicit reconciliation pass with the
--      provider consulted — never by guessing at redirect time.
--   5. Reconciliation exceptions are operator queue rows with traceable
--      resolution; fees are recorded separately from gross amounts.
--
-- Portable relational SQL (SQLite/D1 + Postgres translation verified).

-- Append-only entitlement events: the source of truth for what was granted.
CREATE TABLE IF NOT EXISTS entitlement_events (
  id INTEGER PRIMARY KEY,
  -- Deterministic identity: ONE event per verified payment attempt.
  event_key TEXT NOT NULL UNIQUE,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  payment_attempt_id INTEGER NOT NULL REFERENCES payment_attempts(id) ON DELETE CASCADE,
  buyer_user_id TEXT NOT NULL,
  payer_organization_id INTEGER,
  sku TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('grant','renewal','refund_reversal','cancellation')),
  granted_days INTEGER NOT NULL CHECK (granted_days >= 0),
  activated_at TEXT NOT NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_entitlement_events_buyer
  ON entitlement_events(buyer_user_id, sku, created_at DESC);

-- Current entitlement state (activation/expiry/cancellation separate from
-- order status; a paid order with no entitlement is impossible by design).
CREATE TABLE IF NOT EXISTS entitlements (
  id INTEGER PRIMARY KEY,
  buyer_user_id TEXT NOT NULL,
  payer_organization_id INTEGER,
  sku TEXT NOT NULL,
  source_event_id INTEGER NOT NULL REFERENCES entitlement_events(id) ON DELETE CASCADE,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  activated_at TEXT NOT NULL,
  expires_at TEXT,
  cancelled_at TEXT,
  cancelled_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_entitlements_holder
  ON entitlements(buyer_user_id, sku, active, expires_at);

-- Append-only payment ledger: every attempt state transition with its
-- verification payload (for reconciliation and accountant export).
CREATE TABLE IF NOT EXISTS payment_events (
  id INTEGER PRIMARY KEY,
  payment_attempt_id INTEGER NOT NULL REFERENCES payment_attempts(id) ON DELETE CASCADE,
  actor TEXT NOT NULL CHECK (actor IN ('system','provider','operator','buyer')),
  from_state TEXT,
  to_state TEXT NOT NULL CHECK (to_state IN ('created','redirected','verified','failed','cancelled','expired')),
  payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payment_events_attempt
  ON payment_events(payment_attempt_id, id);

-- Provider settlement facts (from the gateway's reporting/export, recorded
-- by the reconciliation pass) with fees separate from gross.
CREATE TABLE IF NOT EXISTS payment_settlements (
  id INTEGER PRIMARY KEY,
  payment_attempt_id INTEGER NOT NULL REFERENCES payment_attempts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_reference TEXT,
  settled_gross_minor INTEGER NOT NULL CHECK (settled_gross_minor >= 0),
  fee_minor INTEGER NOT NULL DEFAULT 0 CHECK (fee_minor >= 0),
  currency TEXT NOT NULL DEFAULT 'IRR' CHECK (currency = 'IRR'),
  settled_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(payment_attempt_id)
);

-- Reconciliation exceptions: the operator queue with traceable resolution.
CREATE TABLE IF NOT EXISTS reconciliation_cases (
  id INTEGER PRIMARY KEY,
  payment_attempt_id INTEGER REFERENCES payment_attempts(id) ON DELETE SET NULL,
  mismatch_type TEXT NOT NULL CHECK (mismatch_type IN ('missing_settlement','amount_mismatch','duplicate_settlement','stale_unverified')),
  details TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  detected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_by_user_id TEXT,
  resolved_at TEXT,
  resolution_note TEXT
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_cases_open
  ON reconciliation_cases(status, detected_at);

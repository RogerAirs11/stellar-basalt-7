-- R95: additive integrity controls. Run tools/r95-preflight.py on a restored
-- production copy first. Duplicate active attempts/prices/entitlements STOP
-- this migration; never silently delete or merge financial records.
ALTER TABLE orders ADD COLUMN request_digest TEXT;
ALTER TABLE orders ADD COLUMN creation_operation_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_creation_operation ON orders(creation_operation_id)
  WHERE creation_operation_id IS NOT NULL;
ALTER TABLE payment_attempts ADD COLUMN request_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_attempt_request_key ON payment_attempts(request_key)
  WHERE request_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_attempt_one_open ON payment_attempts(order_id)
  WHERE state IN ('created','redirected');
CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_price_one_live ON billing_prices(sku)
  WHERE active=1 AND superseded_at IS NULL;

ALTER TABLE entitlements ADD COLUMN holder_key TEXT;
UPDATE entitlements SET holder_key=CASE
  WHEN payer_organization_id IS NOT NULL THEN 'org:' || payer_organization_id
  ELSE 'user:' || buyer_user_id END WHERE holder_key IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_entitlements_one_active_holder ON entitlements(holder_key,sku)
  WHERE active=1;

-- Each fresh operation carries a random id. All side effects must match that
-- id, NOT merely the existence of an older deterministic event key.
CREATE TABLE IF NOT EXISTS billing_command_receipts (
  operation_id TEXT PRIMARY KEY,
  command_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK(kind IN ('verify','cancel')),
  order_id INTEGER NOT NULL REFERENCES orders(id),
  payment_attempt_id INTEGER REFERENCES payment_attempts(id),
  actor_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Verified provider money that cannot be fulfilled is not silently ignored.
-- This is a manual investigation queue, NOT proof of settlement or refund.
CREATE TABLE IF NOT EXISTS billing_review_cases (
  id INTEGER PRIMARY KEY,
  payment_attempt_id INTEGER NOT NULL REFERENCES payment_attempts(id),
  reason TEXT NOT NULL CHECK(reason IN ('verified_unfulfillable','request_outcome_unknown','stale_unverified','legacy_paid_unreconciled')),
  details_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  resolved_by_user_id TEXT,
  resolution_note TEXT,
  UNIQUE(payment_attempt_id,reason)
);

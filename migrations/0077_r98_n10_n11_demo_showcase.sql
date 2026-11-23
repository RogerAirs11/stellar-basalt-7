-- 0077_r98_n10_n11_demo_showcase.sql
-- R98-N10/N11 demonstration layer: free, honest placeholders for the two
-- capabilities that remain blocked on OWNER-PROVIDED accounts.
--
--   1. N10 payments: a DEMO payment gateway. It speaks the same provider
--      contract as the Zarinpal adapter (issue authority -> hosted pay page
--      -> server-side verify) but settles INSIDE this application's
--      database. No external merchant account exists and no real money can
--      move: every attempt is stored provider='demo' so a demonstration
--      charge and a real charge can never be confused. The real gateway
--      stays fail-closed until the owner supplies merchant credentials AND
--      the terminal-release approval (src/commerce/payments/terminalPolicy).
--   2. N11 notifications: a DEMO email delivery provider (loopback). It
--      records accepted messages in a provider-side demo inbox and settles
--      ONLY through the same HMAC-signed callback path a real provider uses
--      (acceptance is still never delivery). The real provider stays
--      unconfigured until the owner supplies the account.
--   3. The bounded farm offer price (the R98-N10 journey requirement) is
--      seeded by scripts/seed-demo-catalog.mjs — an idempotent OPERATOR
--      action against the live databases, not a migration: pricing stays an
--      explicit operator decision, existing test fixtures stay untouched,
--      and an operator who has already priced this sku keeps their decision
--      (the seed is a no-op on any (sku, version) that already exists).
--
-- Portable relational SQL (SQLite/D1 + Postgres translation verified).

CREATE TABLE IF NOT EXISTS demo_payment_sessions (
  authority TEXT PRIMARY KEY,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL DEFAULT 'IRR' CHECK (currency = 'IRR'),
  -- The server-generated gateway redirect target (never client-supplied).
  callback_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'issued'
    CHECK (status IN ('issued','paid','cancelled','expired')),
  -- Settlement reference assigned by the demo gateway at completion.
  provider_ref TEXT,
  description TEXT NOT NULL,
  issued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_demo_payment_sessions_status
  ON demo_payment_sessions(status, issued_at DESC);

CREATE TABLE IF NOT EXISTS demo_deliveries (
  id INTEGER PRIMARY KEY,
  -- The outbox event key doubles as the provider idempotency key.
  event_key TEXT NOT NULL UNIQUE,
  channel TEXT NOT NULL CHECK (channel IN ('email','sms')),
  purpose TEXT NOT NULL,
  -- Provider-side record (a real provider's dashboard also knows the
  -- address it delivered to; the OUTBOX itself still never stores it).
  to_address TEXT NOT NULL,
  subject TEXT,
  provider_message_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'accepted'
    CHECK (status IN ('accepted','delivered','failed')),
  accepted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  settled_at TEXT,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_demo_deliveries_status
  ON demo_deliveries(status, accepted_at DESC);

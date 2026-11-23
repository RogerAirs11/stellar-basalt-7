-- 0049_billing.sql
-- R88 agent plan P17: billing catalog, orders and unambiguous money units.
--
-- Doctrine:
--   1. MONEY IS EXPLICIT: every stored amount is a safe integer in MINOR
--      units of ONE documented internal currency — IRR (Iranian rial), the
--      official monetary unit. Toman exists only at display/provider
--      boundaries (1 toman = 10 rial, converted by src/commerce/money.ts,
--      never inferred from a numeric size). A 1,900,000-TOMAN plan is stored
--      as 19,000,000 IRR and can never be charged as 1,900,000 rial.
--   2. PRICES ARE IMMUTABLE VERSIONS: repricing inserts a NEW version row
--      and supersedes the old one; an existing order keeps its frozen price
--      snapshot forever (catalog changes never mutate a payable order).
--   3. ORDERS ARE SERVER-COMPUTED: the client submits skus + quantities +
--      an order_key; totals are recomputed from the catalog. A client-
--      supplied total is ignored. The order_key makes duplicate submission
--      create ONE order.
--   4. PAYMENT ATTEMPTS carry the trusted server-side amount, provider,
--      authority/reference and verification state. No card credentials, ever.
--   5. Financial history is append-mostly: rollback NEVER deletes financial
--      records (cancellation is a state, not a DELETE).
--
-- Portable relational SQL (SQLite/D1 + Postgres translation verified).

-- Immutable price versions. A live price = active=1 AND superseded_at IS NULL.
CREATE TABLE IF NOT EXISTS billing_prices (
  id INTEGER PRIMARY KEY,
  -- Stable stock keeping unit, e.g. 'farm_workspace_monthly'.
  sku TEXT NOT NULL,
  -- Version within the sku; (sku, version) is unique. Repricing = new row.
  version INTEGER NOT NULL DEFAULT 1,
  name_en TEXT NOT NULL,
  name_fa TEXT NOT NULL,
  description TEXT,
  -- Minor units of the internal currency (IRR). ALWAYS with currency='IRR'.
  price_minor INTEGER NOT NULL CHECK (price_minor >= 0),
  currency TEXT NOT NULL DEFAULT 'IRR' CHECK (currency = 'IRR'),
  -- Optional entitlement period in days (NULL = one-time purchase).
  period_days INTEGER CHECK (period_days IS NULL OR (period_days >= 1 AND period_days <= 3650)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  superseded_at TEXT,
  UNIQUE(sku, version)
);

CREATE INDEX IF NOT EXISTS idx_billing_prices_sku_live
  ON billing_prices(sku, active, superseded_at);

-- Orders with a frozen price snapshot.
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  -- Client-chosen idempotency key: the same (buyer, order_key) replays the
  -- SAME order — duplicate submission creates one order.
  order_key TEXT NOT NULL,
  buyer_user_id TEXT NOT NULL,
  payer_organization_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','awaiting_payment','paid','cancelled','refunded','partially_refunded')),
  -- Server-computed total from the catalog AT ORDER TIME (minor IRR).
  total_minor INTEGER NOT NULL CHECK (total_minor >= 0),
  currency TEXT NOT NULL DEFAULT 'IRR' CHECK (currency = 'IRR'),
  -- Frozen line-item snapshot: [{sku, price_id, version, title, unit_minor, quantity}].
  price_snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cancelled_at TEXT,
  row_version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(buyer_user_id, order_key)
);

CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders(buyer_user_id, status, created_at DESC);

-- Line items pointing at the EXACT immutable price version used.
CREATE TABLE IF NOT EXISTS order_lines (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  price_id INTEGER NOT NULL REFERENCES billing_prices(id),
  sku TEXT NOT NULL,
  title_en TEXT NOT NULL,
  title_fa TEXT NOT NULL,
  unit_minor INTEGER NOT NULL CHECK (unit_minor >= 0),
  quantity INTEGER NOT NULL CHECK (quantity >= 1 AND quantity <= 100),
  line_total_minor INTEGER NOT NULL CHECK (line_total_minor >= 0)
);

CREATE INDEX IF NOT EXISTS idx_order_lines_order ON order_lines(order_id);

-- Payment attempts (P17 creates them; P18 wires real providers/verification).
CREATE TABLE IF NOT EXISTS payment_attempts (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  -- Provider authority/reference (unique per provider; set when created).
  authority TEXT,
  -- The TRUSTED amount the attempt was opened for (server-side, minor IRR).
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  currency TEXT NOT NULL DEFAULT 'IRR' CHECK (currency = 'IRR'),
  state TEXT NOT NULL DEFAULT 'created'
    CHECK (state IN ('created','redirected','verified','failed','cancelled','expired')),
  verification_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  verified_at TEXT,
  UNIQUE(provider, authority)
);

CREATE INDEX IF NOT EXISTS idx_payment_attempts_order ON payment_attempts(order_id, state);

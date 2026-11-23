-- R47b: Sales marketplace (client requirement: بخش فروش) — for-sale listings let a
-- buyer research a horse (pedigree, competitions, verified documents) before
-- contacting the seller. One active listing per horse. Portable relational SQL.

CREATE TABLE IF NOT EXISTS sales_listings (
  id TEXT PRIMARY KEY,
  horse_id INTEGER NOT NULL REFERENCES horses(id) ON DELETE CASCADE,
  seller_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  seller_contact_name TEXT NOT NULL,
  seller_contact_phone TEXT,
  seller_contact_email TEXT,
  seller_city TEXT,
  asking_price_toman INTEGER CHECK (asking_price_toman IS NULL OR asking_price_toman >= 0),
  price_visible INTEGER NOT NULL DEFAULT 1 CHECK (price_visible IN (0,1)),
  negotiable INTEGER NOT NULL DEFAULT 0 CHECK (negotiable IN (0,1)),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','pending_sale','sold','withdrawn','expired')),
  title TEXT,
  description TEXT,
  view_count INTEGER NOT NULL DEFAULT 0,
  listed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT,
  provenance TEXT NOT NULL DEFAULT 'user' CHECK (provenance IN ('demo','user'))
);
CREATE INDEX IF NOT EXISTS idx_sales_listings_status ON sales_listings(status, listed_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_listings_horse ON sales_listings(horse_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_listings_active_horse ON sales_listings(horse_id) WHERE status IN ('draft','active','pending_sale');

CREATE TABLE IF NOT EXISTS sales_inquiries (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES sales_listings(id) ON DELETE CASCADE,
  buyer_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  buyer_name TEXT NOT NULL,
  buyer_contact TEXT NOT NULL,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','closed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sales_inquiries_listing ON sales_inquiries(listing_id, created_at DESC);

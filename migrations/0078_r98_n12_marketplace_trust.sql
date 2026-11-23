-- 0078_r98_n12_marketplace_trust.sql
-- R98-N12: complete trusted horse sale and inquiry operations.
--
--   1. sales_inquiry_replies: the private reply thread between the buyer and
--      the seller. The initial inquiry message stays the opening entry; every
--      later message is a reply row authored by exactly one participant side.
--      Reads remain participant-only for the whole life of the conversation —
--      INCLUDING after the listing expires, is withdrawn or is sold (old
--      conversations stay permission-protected), while NEW replies require
--      the inquiry to still be open and the author to still be the recorded
--      participant.
--   2. buyer_watchlist: a buyer's saved listings. Bounded (MAX per user is a
--      command-layer constant), idempotent per (user, listing), and readable
--      only by the owner. Saving a listing is a research action, never a
--      claim on the horse.
--   3. marketplace_participant_blocks: either participant side can stop NEW
--      inquiries between two accounts. The refusal the other side receives is
--      NEUTRAL (the blocked party is never told a block exists — the same
--      honest-refusal rule as the service-request provider block). Existing
--      conversations are never deleted; only new contact is refused.
--   4. sales_listings.dossier_id: the OPTIONAL immutable dossier link. A
--      seller with a CURRENT mandate may attach one dossier snapshot THEY
--      created for the SAME horse; the public listing then shows that a
--      dossier is available and links through the existing access-controlled
--      dossier view. Private genetic reports are never copied into the
--      listing — the dossier snapshot is publication-safe by construction
--      and stays a separate, revocable resource.
--
-- Honest-sale invariants carried by the schema:
--   * an expired or withdrawn listing cannot accept a fresh inquiry (the
--     inquiry INSERT predicate already requires status active/pending_sale
--     and a non-expired expires_at);
--   * the seller-mandate badge on the PUBLIC listing detail is computed LIVE
--     at read time (never a stored 'verified' flag that can go stale) — an
--     expired mandate is reported as expired, never as verified ownership;
--   * the platform is an INTRODUCTION service: no escrow, no veterinary
--     inspection and no transaction guarantee is implied by any column here.
--
-- Portable relational SQL (SQLite/D1 + Postgres translation verified).

-- ---------------------------------------------------------------------------
-- 1. Private inquiry reply thread
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales_inquiry_replies (
  id TEXT PRIMARY KEY,
  inquiry_id TEXT NOT NULL REFERENCES sales_inquiries(id) ON DELETE CASCADE,
  author_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_side TEXT NOT NULL CHECK (author_side IN ('buyer','seller')),
  body TEXT NOT NULL CHECK (length(body) > 0 AND length(body) <= 4000),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_operation_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_sales_inquiry_replies_thread
  ON sales_inquiry_replies(inquiry_id, created_at, id);

-- One reply per (inquiry, operation): a retried submission with the same
-- operation id is a no-op, so a network retry never double-posts.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_inquiry_replies_operation
  ON sales_inquiry_replies(inquiry_id, last_operation_id)
  WHERE last_operation_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Buyer saved listings (research watchlist)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS buyer_watchlist (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id TEXT NOT NULL REFERENCES sales_listings(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, listing_id)
);

CREATE INDEX IF NOT EXISTS idx_buyer_watchlist_listing
  ON buyer_watchlist(listing_id);

-- ---------------------------------------------------------------------------
-- 3. Participant blocks (either side; neutral refusal for new contact only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marketplace_participant_blocks (
  blocker_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason_private TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (blocker_user_id, blocked_user_id),
  CHECK (blocker_user_id <> blocked_user_id)
);

-- ---------------------------------------------------------------------------
-- 4. Optional immutable dossier link on a listing
-- ---------------------------------------------------------------------------
ALTER TABLE sales_listings ADD COLUMN dossier_id INTEGER REFERENCES dossier_snapshots(id) ON DELETE SET NULL;

-- A listing can reference at most one dossier; the per-horse active-listing
-- partial unique index (uq_sales_listings_active_horse, 0027) already keeps
-- one live listing per horse.
CREATE INDEX IF NOT EXISTS idx_sales_listings_dossier
  ON sales_listings(dossier_id) WHERE dossier_id IS NOT NULL;

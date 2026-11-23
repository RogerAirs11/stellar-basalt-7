-- 0033_horse_identifiers.sql (T08 — Master-Ai plan: enforce identifier integrity at commit time)
--
-- horse_identifiers holds one row per (kind, issuer_namespace, normalized_value)
-- a live horse claims. New editorial writes maintain their rows in the same
-- transaction as the canonical horse write; the partial UNIQUE index below is
-- what turns the old application-level TOCTOU race (two concurrent creates
-- both passing assertNoLiveHorseDuplicates) into "at most one accepted live
-- identifier" — the loser's whole batch rolls back and surfaces as 409
-- duplicate_identifier.
--
-- Scope rules:
--   * register_no is issuer-scoped. New editorial writes use namespace
--     'registry:platform'. The legacy import's numbers are backfilled under
--     'registry:legacy:unattributed' — the unknown legacy issuer is never
--     guessed (see scripts/audit-identifier-conflicts.mjs).
--   * microchip_no is globally scoped (namespace 'microchip').
--   * uel_no / life_number are backfilled under their own namespaces.
--   * normalized_value keeps leading zeros and unifies Persian/Arabic-Indic
--     digits with ASCII (type-aware normalization in src/registry/identifiers.ts).
--
-- History is preserved: reassigning an identifier supersedes the previous live
-- row (status='superseded'), never deletes it. Legacy duplicate register
-- numbers are NOT deleted or merged — collisions are recorded per pair in
-- identifier_conflicts, the admin resolution queue.

CREATE TABLE IF NOT EXISTS horse_identifiers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  issuer_namespace TEXT NOT NULL,
  normalized_value TEXT NOT NULL,
  raw_value TEXT NOT NULL,
  horse_id INTEGER NOT NULL REFERENCES horses(id),
  status TEXT NOT NULL DEFAULT 'live' CHECK (status IN ('live','superseded','conflict','archived')),
  source_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_horse_identifiers_horse ON horse_identifiers(horse_id,kind,status);
CREATE INDEX IF NOT EXISTS idx_horse_identifiers_lookup ON horse_identifiers(kind,issuer_namespace,normalized_value) WHERE status='live';

-- THE commit-time guarantee: one live row per identifier per namespace.
CREATE UNIQUE INDEX IF NOT EXISTS uq_horse_identifiers_live
  ON horse_identifiers(kind,issuer_namespace,normalized_value) WHERE status='live';

-- Admin conflict queue: every legacy collision found by the backfill is
-- recorded here (kept horse vs conflicting horse) and stays until an operator
-- resolves it. No horse is ever deleted because a duplicate key exists.
CREATE TABLE IF NOT EXISTS identifier_conflicts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  issuer_namespace TEXT NOT NULL,
  normalized_value TEXT NOT NULL,
  raw_value TEXT NOT NULL,
  kept_horse_id INTEGER NOT NULL,
  conflicting_horse_id INTEGER NOT NULL,
  detected_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  resolution_note TEXT
);

CREATE INDEX IF NOT EXISTS idx_identifier_conflicts_open
  ON identifier_conflicts(kind,issuer_namespace,normalized_value) WHERE resolved_at IS NULL;

-- The backfill itself is intentionally NOT inline SQL: type-aware digit
-- normalization is not expressible in portable SQLite DDL. Run
--   node scripts/audit-identifier-conflicts.mjs --report   (dry-run)
--   node scripts/audit-identifier-conflicts.mjs --apply   (idempotent backfill)
-- against the canonical database. The partial unique index above is safe to
-- create before the backfill because the backfill deduplicates: the lowest-id
-- live horse per (kind, namespace, normalized_value) keeps the live row and
-- every other claimant is inserted with status='conflict' plus a queue entry.

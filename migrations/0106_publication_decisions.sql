-- 0106: R144-D02 (Master-AI plan) — versioned publication decisions.
-- Master-AI finding: a bare `genetic_tests.public_disclosed` boolean (0101)
-- records THAT the row may publish, but not WHO decided it, on what basis,
-- when, or whether a later withdrawal superseded an earlier publication.
-- D02: disclosure becomes an append-only, versioned DECISION LOG with a
-- materialized compatibility flag.
--
-- Doctrine (Master-AI plan D02, accepted):
--   - Every publication/withdrawal is a decision row: subject record, exact
--     purpose, approved basis, evidence reference, decision maker, reason,
--     and a per-record monotonic decision_version.
--   - Optimistic concurrency: a caller may pass expected_version; a stale
--     request (one behind the current decision version) is rejected 409 and
--     can NEVER overwrite a newer withdrawal.
--   - `genetic_tests.public_disclosed` stays as the MATERIALIZED projection
--     of the latest decision, updated in the SAME transactional batch as the
--     decision INSERT (UNIQUE(subject_kind, record_id, decision_version)
--     makes concurrent writers exactly-one-winner). SQL-boundary readers
--     (pairing projection, attestations, dossiers) keep reading the
--     materialized column — withdrawal therefore reaches every derived
--     output atomically, with the log as the explainable history.
--   - Compatibility reader: rows with no decision history fall back to the
--     legacy boolean (pre-0106 behavior preserved verbatim).
--
-- Portability: stock SQLite-compatible DDL, runs on Supabase (PostgreSQL),
-- D1 (SQLite fork) and the local test engine.

CREATE TABLE IF NOT EXISTS publication_decisions (
  id TEXT PRIMARY KEY,
  -- Subject scope is versioned deliberately: 'genetic_test' first; later
  -- subjects (media publication, dossier sections) extend the CHECK in a
  -- NEW migration, never by editing this one.
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('genetic_test')),
  -- Subject record id as text (genetic_tests.id), joint with subject_kind.
  record_id TEXT NOT NULL,
  horse_id INTEGER NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('publish','withdraw')),
  -- Per-subject monotonic sequence; UNIQUE makes two racing writers
  -- exactly-one-winner inside the same D1/SQLite batch transaction.
  decision_version INTEGER NOT NULL,
  basis TEXT NOT NULL CHECK (basis IN ('owner_consent','staff_publication','official_basis')),
  purpose TEXT,
  evidence_ref TEXT,
  reason TEXT NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  -- The caller's optimistic-concurrency expectation (null = unconditional
  -- first write). Stored so every 409 conflict is explainable afterwards.
  expected_version INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(subject_kind, record_id, decision_version)
);
CREATE INDEX IF NOT EXISTS idx_publication_decisions_record
  ON publication_decisions(subject_kind, record_id, decision_version);
CREATE INDEX IF NOT EXISTS idx_publication_decisions_horse
  ON publication_decisions(horse_id, created_at);

-- 0109: R146-D05 (Master-AI plan) — field-level claims and conflict resolution.
--
-- Master-AI D05 standard: retain competing field values and parent
-- relationships WITH their sources; connect selected canonical values to
-- explicit decisions; show supporting and contradictory evidence to
-- reviewers; preserve old values and reasons for changes; support reversal
-- of erroneous decisions; prevent a refreshed external source from silently
-- replacing a stronger reviewed value.
--
-- Doctrine:
--   - field_claims is the RETAINED competing evidence: (horse_id, field_name,
--     claimed_value, source). A claim never mutates the canonical row by
--     itself — it waits for an explicit human decision. A claim whose value
--     matches the current canonical value is not stored (no noise); a claim
--     identical to an already-open claim from the same source is not
--     duplicated (idempotent external refreshes).
--   - field_claim_decisions is the append-only decision trail: selecting a
--     claim stores the PREVIOUS canonical value, the applied value, the
--     actor and the reason. Reverting a decision restores the previous
--     canonical value through the same validated mutation path every other
--     write uses, marks the original decision reverted, and appends a
--     'revert' decision — so the audit history can always reconstruct the
--     consistent prior state.
--   - External-refresh protection is enforced in the import apply path:
--     incoming values that DIFFER from an existing canonical fact are no
--     longer silently dropped — they are recorded as pending claims for
--     review (the fill-once rule still forbids the overwrite itself).
--
-- Portability: stock SQLite/PostgreSQL-compatible DDL.

CREATE TABLE IF NOT EXISTS field_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  horse_id INTEGER NOT NULL REFERENCES horses(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  claimed_value TEXT,
  value_kind TEXT NOT NULL DEFAULT 'text' CHECK (value_kind IN ('text','number','date','horse_ref')),
  source_type TEXT NOT NULL CHECK (source_type IN ('import','external_scrape','owner_statement','professional','review','prior_canonical')),
  source_ref TEXT,
  evidence_json TEXT,
  observed_at TEXT,
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','selected','rejected','superseded')),
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_field_claims_horse ON field_claims(horse_id, field_name, review_status);
CREATE INDEX IF NOT EXISTS idx_field_claims_open ON field_claims(review_status, field_name);

CREATE TABLE IF NOT EXISTS field_claim_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  horse_id INTEGER NOT NULL REFERENCES horses(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('select_claim','keep_canonical','revert')),
  claim_id INTEGER REFERENCES field_claims(id) ON DELETE SET NULL,
  previous_canonical_json TEXT,
  applied_value TEXT,
  decided_by TEXT NOT NULL,
  reason TEXT NOT NULL,
  reverted_by_decision_id INTEGER,
  mutation_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_field_claim_decisions_horse ON field_claim_decisions(horse_id, field_name, id);

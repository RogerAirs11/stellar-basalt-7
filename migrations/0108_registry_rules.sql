-- 0108: R146-D04 (Master-AI plan) — the bounded, versioned rules service.
--
-- Master-AI D04 standard: typed rules for identifier conflicts, required
-- evidence, chronology, life status and applicable breed/studbook policies;
-- store rule version, applicability, severity, inputs and outcomes; provide
-- draft -> report_only -> active states; preview changes against existing
-- records before activation; record permitted policy overrides and reasons;
-- keep authorization, identity integrity and pedigree acyclicity as HARD
-- invariants (never rule-driven, never overridable).
--
-- Doctrine:
--   - registry_rules.spec_json / applicability_json are STRUCTURED payloads
--     validated against per-rule-type zod schemas by the engine
--     (src/registry/rulesEngine.ts). There is NO code path that evaluates
--     admin-supplied SQL or JavaScript — an administrator cannot submit
--     executable anything; the spec is data interpreted by bounded code.
--   - registry_rule_versions is the append-only history: every edit bumps
--     `version` and appends a row, so historical decisions can be
--     reconstructed (which rule text was active when an outcome fired).
--   - registry_rule_outcomes records every fail/override an evaluation
--     produced on a canonical write path (passes are not recorded — volume).
--     Overrides carry actor + reason; blockers can never be overridden.
--   - State machine: draft -> report_only -> active -> retired (ordered,
--     enforced in the application layer; retired is terminal).
--   - Zero active rules => every write path behaves exactly as before, so
--     the service ships dark and is turned on rule by rule.
--
-- Portability: stock SQLite/PostgreSQL-compatible DDL.

CREATE TABLE IF NOT EXISTS registry_rules (
  id TEXT PRIMARY KEY,
  rule_type TEXT NOT NULL CHECK (rule_type IN (
    'registration_numbering','studbook_admission','identifier_conflict',
    'required_evidence','chronology','life_status')),
  title TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info','warning','error','blocker')),
  applicability_json TEXT NOT NULL DEFAULT '{}',
  spec_json TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','report_only','active','retired')),
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_registry_rules_state ON registry_rules(state, rule_type);

CREATE TABLE IF NOT EXISTS registry_rule_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id TEXT NOT NULL REFERENCES registry_rules(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  state TEXT NOT NULL,
  title TEXT NOT NULL,
  severity TEXT NOT NULL,
  applicability_json TEXT NOT NULL,
  spec_json TEXT NOT NULL,
  changed_by TEXT,
  change_note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_registry_rule_versions_rule ON registry_rule_versions(rule_id, version);

CREATE TABLE IF NOT EXISTS registry_rule_outcomes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id TEXT NOT NULL,
  rule_version INTEGER NOT NULL,
  subject_type TEXT NOT NULL,
  subject_ref TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('fail','override')),
  detail_json TEXT,
  override_by TEXT,
  override_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_registry_rule_outcomes_subject ON registry_rule_outcomes(subject_type, subject_ref, id);

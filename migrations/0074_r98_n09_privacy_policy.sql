-- R98-N09: operator-approved retention policy per data category, and the
-- subject redaction-request intake that interacts honestly with active holds.
--
-- Doctrine (from the reviewed N09 ticket):
--  - The inherited numeric defaults (RETENTION_DAYS etc.) are CONFIGURATION
--    ASSUMPTIONS, not legal advice and not an operator decision. Until an
--    operator approves a policy for a category, the sweep keeps using the
--    inherited default and every report says so ("inherited_default").
--  - Retiring/re-approving never rewrites history: the previous approved row
--    is marked retired and a NEW versioned row is inserted.
--  - A direct subject redaction request against a request under an ACTIVE
--    dispute/legal hold is RECORDED and DEFERRED, never silently executed and
--    never silently dropped: the hold preserves only minimal legally/
--    operationally required evidence, and the deferral is visible to the
--    operator queue until the hold's authorized release.
-- Additive only: no existing row is rewritten, no history is deleted.

-- Operator-approved retention policies. ONE approved row per data category.
CREATE TABLE IF NOT EXISTS privacy_retention_policies (
  id TEXT PRIMARY KEY,
  data_category TEXT NOT NULL CHECK (data_category IN ('service_request_terminal','audit_dispute_record')),
  retention_days INTEGER NOT NULL CHECK (retention_days BETWEEN 1 AND 3650),
  consent_withdrawal_behavior TEXT NOT NULL CHECK (length(consent_withdrawal_behavior) BETWEEN 10 AND 2000),
  hold_authority TEXT NOT NULL CHECK (length(hold_authority) BETWEEN 10 AND 2000),
  release_requirements TEXT NOT NULL CHECK (length(release_requirements) BETWEEN 10 AND 2000),
  status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('approved','retired')),
  policy_version INTEGER NOT NULL CHECK (policy_version >= 1),
  approved_by_user_id TEXT NOT NULL REFERENCES users(id),
  approved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  retired_at TEXT,
  retired_by_user_id TEXT REFERENCES users(id),
  operation_id TEXT NOT NULL UNIQUE,
  supersedes_policy_id TEXT REFERENCES privacy_retention_policies(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (data_category, policy_version)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_privacy_policy_one_approved
  ON privacy_retention_policies(data_category) WHERE status='approved';

-- Subject (data-subject) redaction requests: bounded intake, operator-visible.
-- status 'deferred_active_hold' is set AT FILING TIME when the referenced
-- request carries an active hold — the subject is told honestly that minimal
-- evidence is preserved under the hold until an authorized release.
CREATE TABLE IF NOT EXISTS subject_redaction_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_user_id TEXT NOT NULL REFERENCES users(id),
  service_request_id INTEGER REFERENCES service_requests(id),
  data_category TEXT NOT NULL CHECK (data_category IN ('service_request_notes','service_request_contact_location')),
  request_note TEXT NOT NULL CHECK (length(request_note) BETWEEN 10 AND 2000),
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','deferred_active_hold','granted','refused')),
  hold_interaction TEXT CHECK (hold_interaction IS NULL OR hold_interaction IN ('none','deferred_to_release')),
  decided_by_user_id TEXT REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT CHECK (decision_note IS NULL OR length(decision_note) BETWEEN 10 AND 2000),
  operation_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_subject_redaction_queue ON subject_redaction_requests(status, created_at);
CREATE INDEX IF NOT EXISTS idx_subject_redaction_subject ON subject_redaction_requests(subject_user_id, created_at);

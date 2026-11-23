-- 0076_r98_n08_credential_evidence.sql
-- R98-N08: real credential evidence and expiry workflows.
--
-- What this migration adds (all additive; existing credential semantics are
-- never rewritten):
--   1. credential_renewal_submissions — the renewal evidence workflow: the
--      HOLDER submits renewal evidence for an expiring/expired credential;
--      a platform reviewer (never the holder) applies new dates with a new
--      evidence pointer, versioned and audited. A rejected submission keeps
--      the OLD dates — absence of dates is never evidence of currency.
--   2. credential_expiry_reminders — reminders to the holder BEFORE expiry,
--      deduplicated per credential per window; revoked and already-expired
--      credentials are not re-reminded. Reminders are notifications, never
--      qualification changes: a reminded credential that is not renewed
--      simply expires.
--
-- Portable relational SQL (SQLite/D1 + Postgres translation verified).

CREATE TABLE IF NOT EXISTS credential_renewal_submissions (
  id INTEGER PRIMARY KEY,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('person','organization')),
  subject_key TEXT NOT NULL,
  person_credential_id INTEGER REFERENCES person_credentials(id) ON DELETE CASCADE,
  organization_credential_id INTEGER REFERENCES organization_credentials(id) ON DELETE CASCADE,
  submitted_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  evidence_media_id TEXT,
  evidence_note TEXT NOT NULL,
  proposed_issued_at TEXT,
  proposed_expires_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','withdrawn')),
  reviewed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TEXT,
  review_note TEXT,
  row_version INTEGER NOT NULL DEFAULT 1,
  last_operation_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((subject_type='person' AND person_credential_id IS NOT NULL AND organization_credential_id IS NULL
      AND subject_key='person:' || CAST(person_credential_id AS TEXT))
      OR (subject_type='organization' AND organization_credential_id IS NOT NULL AND person_credential_id IS NULL
      AND subject_key='organization:' || CAST(organization_credential_id AS TEXT)))
);

CREATE INDEX IF NOT EXISTS idx_credential_renewals_status
  ON credential_renewal_submissions(status, created_at);
CREATE INDEX IF NOT EXISTS idx_credential_renewals_submitter
  ON credential_renewal_submissions(submitted_by_user_id, status);

CREATE TABLE IF NOT EXISTS credential_expiry_reminders (
  id INTEGER PRIMARY KEY,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('person','organization')),
  subject_key TEXT NOT NULL,
  person_credential_id INTEGER REFERENCES person_credentials(id) ON DELETE CASCADE,
  organization_credential_id INTEGER REFERENCES organization_credentials(id) ON DELETE CASCADE,
  holder_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  days_before_expiry INTEGER NOT NULL CHECK (days_before_expiry > 0),
  reminded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(subject_key, days_before_expiry)
);

CREATE INDEX IF NOT EXISTS idx_credential_expiry_reminders_holder
  ON credential_expiry_reminders(holder_user_id, reminded_at DESC);

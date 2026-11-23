-- 0060_r95_n12_consent_lifecycle.sql
-- R95-N12: service consent withdrawal and anti-abuse lifecycle.
--
--   service_provider_blocks: the PROVIDER side of blocking. The requester-side
--   block (0044) stops a requester from re-targeting a provider they blocked;
--   this table stops a provider from receiving NEW leads (and pending optional
--   notices) from an account they blocked. `reason` is PRIVATE: it is operator
--   evidence and is never disclosed to the blocked requester — the create
--   refusal is a neutral lead_refused.
--
--   service_abuse_standing: EXPLICIT moderation standing per account. Absence
--   of a row means 'normal'. A 'restricted'/'suspended' account cannot create
--   service leads (transaction-checked). Standing is set through the
--   moderation workflow (N14) — this table is the recorded state, not a
--   blanket staff-access grant.
--
--   service_requests.consent_updated_at: when the requester withdrew contact
--   consent (share_contact 1 -> 0). Withdrawal is one-way; re-consent means a
--   new request.
--
--   service_requests.note_digest / note_redacted_at: requester redaction
--   replaces the note body with a marker but preserves the SHA-256 of the
--   original bytes — dispute evidence (what was sent) survives without the
--   content. The retention sweep uses the same columns after RETENTION_DAYS.
--
-- Portable relational SQL (SQLite/D1 + Postgres translation verified).

CREATE TABLE IF NOT EXISTS service_provider_blocks (
  id INTEGER PRIMARY KEY,
  provider_person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  blocked_requester_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider_person_id, blocked_requester_user_id)
);

CREATE INDEX IF NOT EXISTS idx_service_provider_blocks_requester
  ON service_provider_blocks(blocked_requester_user_id);

CREATE TABLE IF NOT EXISTS service_abuse_standing (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  standing TEXT NOT NULL DEFAULT 'normal' CHECK (standing IN ('normal','restricted','suspended')),
  reason TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE service_requests ADD COLUMN consent_updated_at TEXT;
ALTER TABLE service_requests ADD COLUMN note_digest TEXT;
ALTER TABLE service_requests ADD COLUMN note_redacted_at TEXT;

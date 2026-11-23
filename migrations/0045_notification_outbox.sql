-- 0045_notification_outbox.sql
-- R88 agent plan P13: transactional notifications and accurate delivery
-- language.
--
-- Doctrine (the acceptance criteria are the proof):
--   1. A 2xx provider reply is ACCEPTANCE, never delivery. `delivered` only
--      exists after a signature-verified provider callback. The status set
--      is explicit: queued -> provider_accepted -> delivered, with failed /
--      dead_letter / suppressed branches.
--   2. The outbox row lands in the SAME batch (transaction) as the business
--      mutation — a rolled-back mutation emits no row, therefore no message.
--      event_key is the unique LOGICAL event identity: replaying the same
--      mutation (idempotent retry) inserts nothing new.
--   3. Repeated callbacks cannot duplicate delivery records or billing
--      counts: notification_deliveries is UNIQUE(event_key) and the status
--      move to delivered is a compare-and-set.
--   4. Suppression is honest and separate: unsubscribed purposes, quiet
--      hours and monthly send limits apply ONLY to non-essential purposes.
--      OTP / password-reset / security mail is essential and never
--      suppressed by marketing preferences.
--   5. No tokens, full phone numbers or message bodies are stored on the
--      outbox row: recipient_masked only, payload points at the purpose's
--      own table (email_verifications / sms_otp_challenges / ...).
--
-- Portable relational SQL (SQLite/D1 + Postgres translation verified).

CREATE TABLE IF NOT EXISTS notification_outbox (
  id INTEGER PRIMARY KEY,
  -- Unique LOGICAL event key, e.g. 'service_request:42:status:v3' — the same
  -- logical mutation replayed must never enqueue twice (ON CONFLICT DO NOTHING).
  event_key TEXT NOT NULL UNIQUE,
  channel TEXT NOT NULL CHECK (channel IN ('email','sms')),
  -- Allowlisted purpose (code-level allowlist; this is the recorded copy).
  purpose TEXT NOT NULL,
  -- Essential purposes (OTP, verification, password reset, security) ignore
  -- unsubscribe/quiet-hours/limits. Non-essential ones respect them.
  essential INTEGER NOT NULL DEFAULT 0 CHECK (essential IN (0,1)),
  recipient_user_id TEXT,
  -- Masked recipient (a***@x.com / +98912***89) — never the full address.
  recipient_masked TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','provider_accepted','delivered','failed','dead_letter','suppressed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Stable machine-readable failure class (never contains codes or bodies).
  last_error TEXT,
  provider_message_id TEXT,
  -- Pointer to the purpose's own row (e.g. 'email_verifications:17').
  payload_ref TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  provider_accepted_at TEXT,
  delivered_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_notification_outbox_due
  ON notification_outbox(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_notification_outbox_recipient
  ON notification_outbox(recipient_user_id, created_at DESC);

-- Exactly-once delivery confirmation: the ONLY table billing counts may use.
CREATE TABLE IF NOT EXISTS notification_deliveries (
  id INTEGER PRIMARY KEY,
  event_key TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_message_id TEXT,
  confirmed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(event_key)
);

-- Raw provider callback audit: every callback is recorded with its signature
-- verification state, so a forged/failed probe is visible without ever
-- mutating outbox state.
CREATE TABLE IF NOT EXISTS notification_callbacks (
  id INTEGER PRIMARY KEY,
  provider TEXT NOT NULL,
  event_key TEXT,
  signature_state TEXT NOT NULL CHECK (signature_state IN ('verified','rejected')),
  payload_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notification_callbacks_event
  ON notification_callbacks(event_key, created_at DESC);

-- Per-user notification preferences. Quiet hours are LOCAL-clock hours of
-- day (0-23) chosen by the user; enforcement converts at drain time.
CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id TEXT PRIMARY KEY,
  -- Comma-separated unsubscribed NON-ESSENTIAL purposes. An unsubscribe
  -- never applies to essential purposes.
  unsubscribed_purposes TEXT NOT NULL DEFAULT '',
  quiet_hour_start INTEGER CHECK (quiet_hour_start IS NULL OR (quiet_hour_start >= 0 AND quiet_hour_start < 24)),
  quiet_hour_end INTEGER CHECK (quiet_hour_end IS NULL OR (quiet_hour_end >= 0 AND quiet_hour_end < 24)),
  -- Optional per-user monthly send cap for non-essential notifications.
  monthly_send_limit INTEGER,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

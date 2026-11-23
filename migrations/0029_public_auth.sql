-- R47b: Public self-registration plumbing (client requirement: ورود/ثبت‌نام + SMS).
-- Email verification tokens, verified phone identities, and OTP challenges.
-- In sandbox/demo deployments the OTP is surfaced in the API response instead of
-- being sent (SMS provider credentials absent); production wires a provider.
-- Portable relational SQL.

CREATE TABLE IF NOT EXISTS email_verifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL DEFAULT 'signup' CHECK (purpose IN ('signup','password_reset')),
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_email_verifications_user ON email_verifications(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS phone_identities (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  phone_e164 TEXT NOT NULL,
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_phone_identities_number ON phone_identities(phone_e164);

CREATE TABLE IF NOT EXISTS sms_otp_challenges (
  id TEXT PRIMARY KEY,
  phone_e164 TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'login' CHECK (purpose IN ('login','registration','verify')),
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sms_otp_phone ON sms_otp_challenges(phone_e164, created_at DESC);

-- Public signups join the existing role model; new columns track the
-- registration provenance and the (optional) linked horse claim that starts the
-- owner-verification workflow right after signup.
ALTER TABLE users ADD COLUMN registration_source TEXT NOT NULL DEFAULT 'staff' CHECK (registration_source IN ('staff','public_signup','sms_signup'));
ALTER TABLE users ADD COLUMN email_verified_at TEXT;
ALTER TABLE users ADD COLUMN display_phone TEXT;

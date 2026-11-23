-- R148: no factor is invented for existing accounts. Secrets are encrypted by
-- a separately configured Worker keyring; recovery codes are hash-only.
CREATE TABLE IF NOT EXISTS auth_mfa_factors (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  factor_version INTEGER NOT NULL DEFAULT 0,
  secret_ciphertext TEXT,
  last_totp_step INTEGER NOT NULL DEFAULT -1,
  pending_id TEXT,
  pending_secret_ciphertext TEXT,
  pending_expires_at TEXT,
  pending_session_id TEXT,
  recovery_generation INTEGER NOT NULL DEFAULT 0,
  recovery_session_id TEXT,
  recovery_until TEXT,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  command_id TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS auth_mfa_recovery_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  factor_version INTEGER NOT NULL,
  generation INTEGER NOT NULL,
  code_hash TEXT NOT NULL UNIQUE,
  used_at TEXT,
  consumed_operation_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_mfa_recovery_user ON auth_mfa_recovery_codes(user_id,factor_version,generation);
CREATE TABLE IF NOT EXISTS auth_mfa_session_assurance (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  factor_version INTEGER NOT NULL,
  token_hash TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  method TEXT NOT NULL CHECK(method='totp')
);
CREATE TABLE IF NOT EXISTS auth_mfa_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_mfa_events_user ON auth_mfa_events(user_id,created_at);
-- A failed check aborts the ENTIRE D1/PostgreSQL batch, including receipts.
-- Rows are inserted and deleted inside the same successful transaction.
CREATE TABLE IF NOT EXISTS auth_mfa_commit_checks (
  id TEXT PRIMARY KEY,
  ok INTEGER NOT NULL CONSTRAINT auth_mfa_authority_current CHECK(ok=1)
);

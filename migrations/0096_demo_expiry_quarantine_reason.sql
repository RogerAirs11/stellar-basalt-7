-- 0096 R120 (R119 remediation follow-on): widen the demo payment session
-- failure_reason vocabulary with the quarantine marker the R119 remediation
-- writes when a persisted demo expiry cannot be parsed as a strict UTC
-- instant ('invalid_expiry_timestamp', IMP-017). The remediation's own new
-- regression ("an invalid persisted demo expiry fails closed and is
-- quarantined") correctly caught that migration 0084's CHECK only allowed
-- 'simulated_decline', so the quarantine UPDATE itself failed with a CHECK
-- error before the honest 410 could be thrown — the session was then left
-- 'issued' instead of expired. Same defect class as the R117-15
-- command_receipts gap (0089).
--
-- SQLite cannot ALTER a CHECK constraint, so the table is rebuilt in place
-- (standard 12-step shape, mirroring 0089): identical columns, keys and
-- defaults, ONLY the CHECK widened. Every existing row is copied verbatim —
-- no data changes, no fabricated sessions — and the status index is
-- recreated byte-for-byte. Demo sessions are disposable demo-environment
-- data by design (the isolated demo triple); production never resolves the
-- demo provider, so no production row can exist.

CREATE TABLE demo_payment_sessions_r120 (
  authority TEXT PRIMARY KEY,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL DEFAULT 'IRR' CHECK (currency = 'IRR'),
  -- The server-generated gateway redirect target (never client-supplied).
  callback_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'issued'
    CHECK (status IN ('issued','paid','cancelled','expired')),
  -- Settlement reference assigned by the demo gateway at completion.
  provider_ref TEXT,
  description TEXT NOT NULL,
  issued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  completed_at TEXT,
  failure_reason TEXT
    CHECK (failure_reason IS NULL OR failure_reason IN ('simulated_decline','invalid_expiry_timestamp'))
);

INSERT INTO demo_payment_sessions_r120(
  authority,amount_minor,currency,callback_url,status,provider_ref,description,issued_at,expires_at,completed_at,failure_reason)
SELECT authority,amount_minor,currency,callback_url,status,provider_ref,description,issued_at,expires_at,completed_at,failure_reason
FROM demo_payment_sessions;

DROP TABLE demo_payment_sessions;
ALTER TABLE demo_payment_sessions_r120 RENAME TO demo_payment_sessions;

CREATE INDEX IF NOT EXISTS idx_demo_payment_sessions_status
  ON demo_payment_sessions(status, issued_at DESC);

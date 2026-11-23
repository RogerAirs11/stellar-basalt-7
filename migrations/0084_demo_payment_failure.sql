-- Explicit fictional provider decline for the isolated demo. The original
-- session terminal state remains cancelled; failure_reason distinguishes a
-- simulated provider failure from a buyer cancellation without altering any
-- real gateway, payment attempt, or entitlement state machine.
ALTER TABLE demo_payment_sessions ADD COLUMN failure_reason TEXT
  CHECK (failure_reason IS NULL OR failure_reason = 'simulated_decline');

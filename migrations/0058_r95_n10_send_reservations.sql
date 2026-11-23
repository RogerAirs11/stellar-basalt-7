-- R95-N10: concurrency-safe send-cap reservation accounting.
--
-- The pre-N10 monthly cap was check-then-act (COUNT the month's accepted
-- rows, then send). Two concurrent drains could both pass the count check
-- and both send, exceeding the user's cap. Reservations make the cap exact:
-- a non-essential send first claims one slot with a conditional increment
-- (reserved_count < cap) on the per-(user, period) row; the claim, the row
-- lock it takes and the acceptance update share the transaction boundary.
-- Essential security traffic (OTP, password reset) never reserves — it is
-- never capped.
CREATE TABLE IF NOT EXISTS notification_send_reservations (
  user_id TEXT NOT NULL,
  -- Calendar month key 'YYYY-MM' (the period the preference cap defines).
  period TEXT NOT NULL CHECK (length(period) = 7 AND substr(period,5,1) = '-'),
  reserved_count INTEGER NOT NULL DEFAULT 0 CHECK (reserved_count >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, period)
);

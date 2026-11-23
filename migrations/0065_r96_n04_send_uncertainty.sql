-- 0065_r96_n04_send_uncertainty.sql
-- R96-N04: uncertain-send reconciliation support.
--
-- The outbox is leased at-least-once dispatch. A network timeout after the
-- request reached the provider ("possible acceptance") must never become a
-- BLIND resend: every email send carries the event key as the provider
-- idempotency key (Resend-style HTTP APIs dedupe on it for a documented
-- window, 24h by default). This migration records WHEN the first delivery
-- attempt of a row happened, so the drain can refuse to resend a row whose
-- idempotency window has expired (dead-letter for operator review) instead of
-- risking an unkeyed duplicate.
--
-- Row-preserving, additive column only; no data is rewritten.

ALTER TABLE notification_outbox ADD COLUMN first_attempt_at TEXT;

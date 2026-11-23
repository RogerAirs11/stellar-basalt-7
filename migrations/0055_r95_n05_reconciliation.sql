-- R95-N05: operator reconciliation workflow for gateway uncertainty.
--
-- Additive only. billing_review_cases already exists (0052); these columns
-- record WHAT evidence a resolution reconciled against and WHICH controlled
-- outcome vocabulary was used. Existing resolved rows keep NULL — their
-- resolutions predate this vocabulary and are not rewritten (financial
-- history is append-only).
--
-- Resolution outcomes (enforced in src/commerce/reconciliation.ts, applied
-- here as data, not CHECK, so the vocabulary can grow only through reviewed
-- code changes):
--   provider_not_paid_confirmed — a recorded operator inquiry shows the
--       provider confirmed not-paid / authority-not-found; the open attempt
--       is released so the buyer may start a NEW attempt on the same order.
--   provider_verified_fulfilled — the buyer-verify path fulfilled the order
--       after the case was opened (verify receipt linked to this attempt).
--   provider_verified_retained  — provider-confirmed money that cannot be
--       auto-fulfilled; retained for the manual accounting path (owner-gated).
--   duplicate_dismissed         — the case duplicated another case for the
--       same attempt; the other case carries the real resolution.
--   operator_error_dismissed    — the case was opened in error; evidence
--       linkage is still required before closing.
ALTER TABLE billing_review_cases ADD COLUMN resolution_outcome TEXT;
ALTER TABLE billing_review_cases ADD COLUMN resolution_evidence_json TEXT;

CREATE INDEX IF NOT EXISTS idx_billing_review_cases_open
  ON billing_review_cases(status, id);

-- Structured operator-inquiry outcomes (R95-N05). Nullable: only
-- operator-inquiry rows carry it. Queryable without JSON parsing so the
-- runtime SQL stays inside the portable SQLite/PostgreSQL translator subset
-- (no json_extract — the SQLite-only syntax would break PostgreSQL parity).
ALTER TABLE payment_events ADD COLUMN inquiry_outcome TEXT;

CREATE INDEX IF NOT EXISTS idx_payment_events_inquiry
  ON payment_events(payment_attempt_id, actor, inquiry_outcome);

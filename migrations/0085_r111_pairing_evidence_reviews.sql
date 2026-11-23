-- Explicit assay mapping. Free-text test labels never select a genetic model.
-- This is an editorial review of an already verified record, not issuer attestation.
CREATE TABLE IF NOT EXISTS genetic_pairing_reviews (
  test_id INTEGER PRIMARY KEY REFERENCES genetic_tests(id),
  assay_key TEXT NOT NULL CHECK (assay_key IN ('SCID','CA','LFS','OAAM1')),
  result_snapshot TEXT NOT NULL,
  test_type_snapshot TEXT NOT NULL,
  review_state TEXT NOT NULL DEFAULT 'accepted' CHECK (review_state IN ('accepted','withdrawn')),
  reviewed_by_user_id TEXT NOT NULL REFERENCES users(id),
  reviewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT,
  row_version INTEGER NOT NULL DEFAULT 1,
  last_operation_id TEXT NOT NULL,
  review_note TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS genetic_pairing_reviews_state ON genetic_pairing_reviews(review_state, expires_at);

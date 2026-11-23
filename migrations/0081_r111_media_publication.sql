-- R111: explicit uploader consent stays separate from editorial review.
-- Additive only. Existing visibility decisions and records remain unchanged.
ALTER TABLE horse_media ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1);
ALTER TABLE horse_media ADD COLUMN last_operation_id TEXT;

-- The operation marker gates the state change, audit and retry receipt.
CREATE INDEX IF NOT EXISTS idx_horse_media_consent_operation ON horse_media(last_operation_id);

CREATE TABLE IF NOT EXISTS media_consent_receipts (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  media_id TEXT NOT NULL,
  consent_state TEXT NOT NULL CHECK (consent_state IN ('private','shared_public')),
  expected_version INTEGER NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Concurrent ingestion must not create two pending copies of the same
-- source assertion. Legacy rows retain their original identity and history;
-- new writes supply a SHA-256 key over the complete source assertion tuple.
ALTER TABLE field_claims ADD COLUMN dedupe_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_field_claims_pending_dedupe
  ON field_claims(dedupe_key)
  WHERE dedupe_key IS NOT NULL AND review_status='pending';

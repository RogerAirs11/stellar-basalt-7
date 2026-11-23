-- Atomic password-reset command marker.
--
-- The token claim, password rotation and session revocation execute in one
-- adapter transaction.  The operation marker lets every downstream statement
-- prove that THIS transaction won the single-use token without relying on
-- SQLite-only changes() behavior or a racy SELECT-before-consume sequence.
ALTER TABLE email_verifications ADD COLUMN consumed_operation_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_verifications_consumed_operation
  ON email_verifications(consumed_operation_id)
  WHERE consumed_operation_id IS NOT NULL;

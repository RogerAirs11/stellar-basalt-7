-- Run tools/r98-preflight.py against a restored copy first. Existing duplicate
-- active memberships require evidence-based adjudication, not automatic deletion.
CREATE UNIQUE INDEX IF NOT EXISTS issuer_one_active_membership ON issuer_memberships(issuer_id,user_id) WHERE status='active';
ALTER TABLE attestations ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE attestations ADD COLUMN last_operation_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS attestation_operation ON attestations(last_operation_id) WHERE last_operation_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS issuer_management_operations (
  id TEXT PRIMARY KEY,
  issuer_id TEXT NOT NULL REFERENCES issuers(id),
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  target_user_id TEXT NOT NULL REFERENCES users(id),
  membership_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('grant','revoke')),
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

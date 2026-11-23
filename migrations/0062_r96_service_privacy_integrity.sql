-- R96: additive service privacy repair. Preserve historic audit rows.
-- Legacy placeholder digests are not repaired here: their original bytes may
-- already be gone. The bounded application sweep records unavailable evidence.
ALTER TABLE service_requests ADD COLUMN retention_minimized_at TEXT;
ALTER TABLE service_requests ADD COLUMN note_digest_status TEXT
  CHECK (note_digest_status IN ('original_sha256','legacy_recorded_sha256','unavailable'));
ALTER TABLE service_provider_blocks ADD COLUMN created_by_user_id TEXT;
ALTER TABLE service_provider_blocks ADD COLUMN creation_operation_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_service_provider_block_operation
  ON service_provider_blocks(creation_operation_id) WHERE creation_operation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_service_requests_retention
  ON service_requests(status, retention_minimized_at, updated_at, id);

ALTER TABLE service_request_blocks ADD COLUMN creation_operation_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_service_requester_block_operation
  ON service_request_blocks(creation_operation_id) WHERE creation_operation_id IS NOT NULL;

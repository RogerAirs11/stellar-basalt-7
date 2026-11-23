-- Additive R98 hold-release operation evidence. Existing history is retained.
-- Historical releases have unknown operation identity; never infer one.
ALTER TABLE service_request_holds ADD COLUMN release_operation_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_service_request_holds_release_operation
  ON service_request_holds(release_operation_id) WHERE release_operation_id IS NOT NULL;

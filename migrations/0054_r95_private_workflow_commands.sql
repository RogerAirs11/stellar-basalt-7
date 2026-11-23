-- R95: additive operation markers bind side effects to successful commands.
ALTER TABLE service_request_receipts ADD COLUMN operation_id TEXT;
ALTER TABLE service_request_receipts ADD COLUMN request_id INTEGER REFERENCES service_requests(id);
ALTER TABLE service_requests ADD COLUMN creation_operation_id TEXT;
ALTER TABLE service_requests ADD COLUMN last_operation_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_service_receipt_operation ON service_request_receipts(operation_id) WHERE operation_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_service_request_creation ON service_requests(creation_operation_id) WHERE creation_operation_id IS NOT NULL;
ALTER TABLE dossier_snapshots ADD COLUMN last_operation_id TEXT;
ALTER TABLE dossier_share_links ADD COLUMN last_operation_id TEXT;
ALTER TABLE moderation_cases ADD COLUMN last_operation_id TEXT;
ALTER TABLE moderation_appeals ADD COLUMN last_operation_id TEXT;
ALTER TABLE notification_outbox ADD COLUMN last_operation_id TEXT;

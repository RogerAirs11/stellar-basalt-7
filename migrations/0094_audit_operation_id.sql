-- Provider-neutral idempotency marker for auditable mutations.
-- JSON extraction in SQL is intentionally avoided because the canonical
-- PostgreSQL path does not translate SQLite json_extract().
ALTER TABLE audit_events ADD COLUMN operation_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_operation
  ON audit_events(action, entity_type, entity_id, operation_id)
  WHERE operation_id IS NOT NULL;

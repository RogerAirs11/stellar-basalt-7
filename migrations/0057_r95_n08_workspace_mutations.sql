-- R95-N08: atomic workspace mutations and exact capacities.
--
-- Additive operation markers (the proven R95 task-completion pattern extended
-- to EVERY workspace mutation): side effects (audit rows) are gated by the
-- random operation id that this command generated, so a retried or raced
-- request can never duplicate audit history, and a FAILED mutation (0 row
-- changes) can never leave a misleading audit trail.
ALTER TABLE workspace_collections ADD COLUMN creation_operation_id TEXT;
ALTER TABLE workspace_collections ADD COLUMN last_operation_id TEXT;
ALTER TABLE workspace_collection_members ADD COLUMN last_operation_id TEXT;
ALTER TABLE workspace_staff_assignments ADD COLUMN last_operation_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_creation_operation
  ON workspace_collections(creation_operation_id) WHERE creation_operation_id IS NOT NULL;

-- R31.9: make conservative provider spend telemetry semantically explicit.
-- Historical actual_cost_usd/reconciled_cost_usd columns are retained for
-- migration compatibility but new runtime code writes the estimate fields.
ALTER TABLE ai_request_ledger ADD COLUMN estimated_billed_cost_usd REAL NOT NULL DEFAULT 0 CHECK (estimated_billed_cost_usd >= 0);
ALTER TABLE ai_cost_reservations ADD COLUMN estimated_billed_cost_usd REAL CHECK (estimated_billed_cost_usd IS NULL OR estimated_billed_cost_usd >= 0);

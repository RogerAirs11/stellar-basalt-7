-- 0122: R149 Gate E — care policy commit columns.
-- Care commands now evaluate the same versioned registry-rule service as the
-- canonical admission paths (handoff Gate E: breed/studbook policy for
-- reproductive method, embryo transfer, genetic/recipient dam, twins/offspring
-- count and required evidence). Every care mutation pins the policy epoch and
-- the evaluated rule set in its OWN private operation receipt, in the SAME
-- transaction as the mutation, the private history, the registry policy
-- receipt (registry_policy_receipts) and the rule outcomes.
-- No new table: registry_rules specs are versioned through the existing
-- registry_rule_versions trail; this migration only extends the care receipt
-- with the policy facts it must be able to prove later.
-- Portability: stock SQLite/PostgreSQL-compatible DDL (both dialects accept
-- ALTER TABLE ... ADD COLUMN with a NULLable INTEGER).

ALTER TABLE equine_care_operations ADD COLUMN policy_revision INTEGER;
ALTER TABLE equine_care_operations ADD COLUMN policy_evaluated_json TEXT;

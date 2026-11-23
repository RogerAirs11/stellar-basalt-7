-- R88 agent plan P02: transactional revocation audit. last_operation_id is a
-- per-call operation marker: the revoke UPDATE stamps it on the row it actually
-- changed, and the matching audit event is an INSERT ... SELECT conditioned on
-- THIS marker having landed. A repeat revoke, a racing second writer or a
-- non-existent target can therefore never mint an audit event for a
-- revocation that did not happen — the audit trail stays exactly as truthful
-- as the state change itself. Additive only; no data mutation, no new table.
ALTER TABLE horse_access_grants ADD COLUMN last_operation_id TEXT;
ALTER TABLE organization_memberships ADD COLUMN last_operation_id TEXT;

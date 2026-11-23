-- R119 remediation / COM-01: immutable entitlement provenance and scope.
-- Existing ledger history is preserved. Real-only/demo-only histories can be
-- classified mechanically; mixed or insufficient histories remain explicitly
-- unclassified and therefore fail closed in production capability readers.

ALTER TABLE entitlement_events ADD COLUMN grant_scope TEXT NOT NULL DEFAULT 'legacy_unclassified'
  CHECK (grant_scope IN ('production','demo','legacy_unclassified'));
ALTER TABLE entitlement_events ADD COLUMN grant_source TEXT NOT NULL DEFAULT 'legacy_unclassified';
ALTER TABLE entitlement_events ADD COLUMN provider_name TEXT;
ALTER TABLE entitlement_events ADD COLUMN provider_event_ref TEXT;

UPDATE entitlement_events
SET grant_scope=CASE
      WHEN EXISTS(SELECT 1 FROM payment_attempts p WHERE p.id=entitlement_events.payment_attempt_id AND p.provider='demo') THEN 'demo'
      WHEN EXISTS(SELECT 1 FROM payment_attempts p WHERE p.id=entitlement_events.payment_attempt_id AND p.provider<>'demo') THEN 'production'
      ELSE 'legacy_unclassified' END,
    grant_source=CASE
      WHEN EXISTS(SELECT 1 FROM payment_attempts p WHERE p.id=entitlement_events.payment_attempt_id) THEN 'verified_payment'
      ELSE 'legacy_unclassified' END,
    provider_name=(SELECT p.provider FROM payment_attempts p WHERE p.id=entitlement_events.payment_attempt_id)
WHERE kind IN ('grant','renewal');

ALTER TABLE entitlements ADD COLUMN grant_scope TEXT NOT NULL DEFAULT 'legacy_unclassified'
  CHECK (grant_scope IN ('production','demo','legacy_unclassified'));

-- Classify an existing active interval only when every grant/renewal event for
-- that holder+SKU has one known scope. Mixed demo/real histories remain
-- legacy_unclassified for explicit finance review rather than losing paid time.
UPDATE entitlements
SET grant_scope=CASE
  WHEN NOT EXISTS(
    SELECT 1 FROM entitlement_events e
    WHERE e.sku=entitlements.sku
      AND ((entitlements.payer_organization_id IS NULL AND e.payer_organization_id IS NULL AND e.buyer_user_id=entitlements.buyer_user_id)
        OR (entitlements.payer_organization_id IS NOT NULL AND e.payer_organization_id=entitlements.payer_organization_id))
      AND e.kind IN ('grant','renewal')
      AND e.grant_scope<>'production'
  ) AND EXISTS(
    SELECT 1 FROM entitlement_events e
    WHERE e.sku=entitlements.sku
      AND ((entitlements.payer_organization_id IS NULL AND e.payer_organization_id IS NULL AND e.buyer_user_id=entitlements.buyer_user_id)
        OR (entitlements.payer_organization_id IS NOT NULL AND e.payer_organization_id=entitlements.payer_organization_id))
      AND e.kind IN ('grant','renewal') AND e.grant_scope='production'
  ) THEN 'production'
  WHEN NOT EXISTS(
    SELECT 1 FROM entitlement_events e
    WHERE e.sku=entitlements.sku
      AND ((entitlements.payer_organization_id IS NULL AND e.payer_organization_id IS NULL AND e.buyer_user_id=entitlements.buyer_user_id)
        OR (entitlements.payer_organization_id IS NOT NULL AND e.payer_organization_id=entitlements.payer_organization_id))
      AND e.kind IN ('grant','renewal')
      AND e.grant_scope<>'demo'
  ) AND EXISTS(
    SELECT 1 FROM entitlement_events e
    WHERE e.sku=entitlements.sku
      AND ((entitlements.payer_organization_id IS NULL AND e.payer_organization_id IS NULL AND e.buyer_user_id=entitlements.buyer_user_id)
        OR (entitlements.payer_organization_id IS NOT NULL AND e.payer_organization_id=entitlements.payer_organization_id))
      AND e.kind IN ('grant','renewal') AND e.grant_scope='demo'
  ) THEN 'demo'
  ELSE 'legacy_unclassified' END;

DROP INDEX IF EXISTS idx_entitlements_one_active_holder;
CREATE UNIQUE INDEX IF NOT EXISTS idx_entitlements_one_active_holder_scope
  ON entitlements(holder_key,sku,grant_scope) WHERE active=1;
CREATE INDEX IF NOT EXISTS idx_entitlement_events_scope
  ON entitlement_events(grant_scope,provider_name,payment_attempt_id);

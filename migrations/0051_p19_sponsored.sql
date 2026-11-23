-- 0051_p19_sponsored.sql
-- R88 agent plan P19: the first paid offers — sponsored visibility plumbing.
--
-- Additive only: a placement expiry on listings. Sponsored placement is:
--   - set by operators for sellers holding an ACTIVE sponsored_visibility
--     entitlement (checked live at set time and audited);
--   - shown ONLY while sponsored_until is in the future, with the bilingual
--     Sponsored/تبلیغ label in every surface that orders by it;
--   - NEVER read by scientific breeding rankings, pedigree quality metrics
--     or credential authenticity (those code paths do not reference this
--     column at all — pinned by tests).
-- The free floor (basic identity, corrections, published safety/provenance)
-- is not represented by any paid column because it is never for sale.

ALTER TABLE sales_listings ADD COLUMN sponsored_until TEXT;
